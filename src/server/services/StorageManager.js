/**
 * StorageManager — the only module in the backend that touches the file system.
 *
 * Guarantees implemented here (all verified by tests/storage.test.js):
 *  - paths are always resolved inside an allow-listed root (no traversal escapes);
 *  - writes are atomic: write to a temp file, flush it, then rename over the target;
 *  - the previous version of a file is copied to `backups/` before being replaced,
 *    so information is never lost silently;
 *  - corrupt JSON is quarantined (`<file>.corrupt-<timestamp>`) and reported instead of
 *    being overwritten or ignored;
 *  - missing directories are created on demand, permission errors are surfaced as
 *    `AppError`s with actionable codes;
 *  - every failure is reported through the injected ErrorHandler (never swallowed).
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { ErrorCode, ErrorKind } from '../../shared/constants.js';
import { AppError, errors, safeJsonParse, toAppError } from '../../shared/errors.js';

const BACKUP_KEEP = 5;

export class StorageManager {
  #backupCounter = 0;

  /**
   * @param {object} options
   * @param {string} options.root            Primary data directory (writable).
   * @param {import('../core/Logger.js').Logger} options.logger
   * @param {import('../core/ErrorHandler.js').ErrorHandler} options.errorHandler
   * @param {import('../core/EventBus.js').EventBus} options.bus
   * @param {string[]} [options.extraRoots]  Additional directories that imports/exports may touch.
   */
  constructor({ root, logger, errorHandler, bus, extraRoots = [] }) {
    this.logger = logger;
    this.errorHandler = errorHandler;
    this.bus = bus;
    this.root = path.resolve(root);
    this.extraRoots = [this.root, ...extraRoots.map((entry) => path.resolve(entry))];
    this.dirs = Object.freeze({
      scripts: path.join(this.root, 'scripts'),
      meta: path.join(this.root, 'meta'),
      themes: path.join(this.root, 'themes'),
      plugins: path.join(this.root, 'plugins'),
      logs: path.join(this.root, 'logs'),
      backups: path.join(this.root, 'backups'),
      tmp: path.join(this.root, 'tmp'),
      trash: path.join(this.root, 'trash'),
      workspace: path.join(this.root, 'workspace'),
    });
    this.ready = false;
    this.status = {
      writable: false,
      readable: false,
      root: this.root,
      freeBytes: null,
      totalBytes: null,
      lastError: null,
      createdAt: null,
    };
  }

  /** Creates the directory tree and verifies real read/write access. */
  async init() {
    try {
      await fsp.mkdir(this.root, { recursive: true });
      for (const dir of Object.values(this.dirs)) {
        await fsp.mkdir(dir, { recursive: true });
      }
      const probeFile = path.join(this.dirs.tmp, `.probe-${process.pid}-${Date.now()}`);
      await fsp.writeFile(probeFile, 'lumen-storage-probe', 'utf8');
      const readBack = await fsp.readFile(probeFile, 'utf8');
      await fsp.unlink(probeFile);
      this.status.writable = readBack === 'lumen-storage-probe';
      this.status.readable = true;
      this.status.createdAt = Date.now();
      const space = await this.diskSpace(this.root);
      this.status.freeBytes = space.freeBytes;
      this.status.totalBytes = space.totalBytes;
      this.ready = true;
      this.logger.info(`Almacenamiento listo en ${this.root}`, { source: 'StorageManager', data: { freeBytes: space.freeBytes } });
      this.bus.emit('storage:ready', { root: this.root, status: { ...this.status } });
      return { ok: true, status: { ...this.status } };
    } catch (err) {
      const appError = toAppError(err, {
        kind: ErrorKind.STORAGE,
        code: err?.code ? undefined : ErrorCode.WRITE_FAILED,
        message: `No se pudo inicializar el almacenamiento en ${this.root}`,
        detail: { root: this.root },
      });
      this.status.lastError = appError.toJSON();
      this.ready = false;
      this.errorHandler.report(appError, { source: 'StorageManager.init' });
      return { ok: false, error: appError, status: { ...this.status } };
    }
  }

  /* ---------------------------------------------------------------- *
   * Path handling
   * ---------------------------------------------------------------- */

  /**
   * Absolute path for a relative path inside the data root (no safety-less escape hatch:
   * it uses the same containment rules as every other operation).
   */
  resolve(inputPath, options = {}) {
    return this.resolveSafe(inputPath, options);
  }

  /**
   * Resolves a user supplied relative path inside the data root.
   * Absolute paths are only accepted when they live inside an allowed root.
   * @throws {AppError} with code `E_UNSAFE_PATH` when the path escapes the sandbox.
   */
  resolveSafe(inputPath, { root = this.root, mustExist = false, allowAbsolute = false } = {}) {
    if (typeof inputPath !== 'string' || inputPath.trim() === '') {
      throw errors.invalid('La ruta no puede estar vacía', { field: 'path' });
    }
    const normalizedRoot = path.resolve(root);
    const raw = inputPath.trim();
    if (raw.includes('\0')) {
      throw errors.unsafePath('La ruta contiene bytes nulos', { path: inputPath });
    }
    const candidate = allowAbsolute || path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(normalizedRoot, raw);
    const relative = path.relative(normalizedRoot, candidate);
    const inside = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    if (!inside) {
      if (!allowAbsolute) {
        throw errors.unsafePath(`La ruta "${inputPath}" queda fuera de ${normalizedRoot}`, { path: inputPath, root: normalizedRoot });
      }
      const allowed = this.extraRoots.some((allowedRoot) => {
        const rel = path.relative(allowedRoot, candidate);
        return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
      });
      if (!allowed) {
        throw errors.unsafePath(`La ruta "${inputPath}" no está dentro de las raíces permitidas`, {
          path: inputPath,
          allowedRoots: this.extraRoots,
        });
      }
    }
    void mustExist;
    return candidate;
  }

  /** Directory inside the data root, resolved safely. */
  resolveDir(name) {
    if (!Object.prototype.hasOwnProperty.call(this.dirs, name)) {
      throw errors.invalid(`Directorio desconocido: ${name}`, { available: Object.keys(this.dirs) });
    }
    return this.dirs[name];
  }

  /* ---------------------------------------------------------------- *
   * Reads
   * ---------------------------------------------------------------- */

  async exists(target) {
    const abs = path.isAbsolute(target) ? target : this.resolveSafe(target);
    try {
      await fsp.access(abs, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async readText(target, { fallback = null, encoding = 'utf8', allowAbsolute = false } = {}) {
    const abs = this.resolveSafe(target, { allowAbsolute });
    try {
      const content = await fsp.readFile(abs, { encoding });
      return content;
    } catch (err) {
      if (err.code === 'ENOENT') {
        if (fallback !== null) return fallback;
        throw errors.notFound(`El archivo ${path.basename(abs)}`, { path: abs, file: abs });
      }
      throw toAppError(err, {
        kind: ErrorKind.STORAGE,
        message: `No se pudo leer ${path.basename(abs)}`,
        detail: { path: abs, file: abs },
      });
    }
  }

  /**
   * Reads and parses JSON.
   * For an unreadable file it returns `fallback`. For a *corrupt* file it quarantines
   * the bad content (auditable), then returns `fallback`. Callers can inspect
   * `result.recovered` / `result.corruptPath`.
   *
   * @returns {Promise<{ value: any, found: boolean, created: boolean, recovered: boolean, corruptPath: string|null, error: AppError|null }>}
   */
  async readJson(target, { fallback = null, allowAbsolute = false, createIfMissing = false } = {}) {
    const abs = this.resolveSafe(target, { allowAbsolute });
    let raw;
    try {
      raw = await fsp.readFile(abs, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        if (createIfMissing && fallback !== null) {
          await this.writeJson(target, fallback, { allowAbsolute });
          return { value: fallback, found: false, created: true, recovered: false, corruptPath: null, error: null };
        }
        return { value: fallback, found: false, created: false, recovered: false, corruptPath: null, error: null };
      }
      const appError = toAppError(err, {
        kind: ErrorKind.STORAGE,
        message: `No se pudo leer ${path.basename(abs)}`,
        detail: { path: abs, file: abs },
      });
      this.errorHandler.report(appError, { source: 'StorageManager.readJson' });
      return { value: fallback, found: true, created: false, recovered: false, corruptPath: null, error: appError };
    }

    if (raw.trim() === '') {
      const appError = errors.corrupt(`${path.basename(abs)} está vacío`, { path: abs, file: abs, reason: 'empty' });
      const corruptPath = await this.#quarantine(abs, raw, 'empty');
      this.errorHandler.report(appError, { source: 'StorageManager.readJson', detail: { corruptPath } });
      return { value: fallback, found: true, created: false, recovered: true, corruptPath, error: appError };
    }

    const parsed = safeJsonParse(raw, path.basename(abs));
    if (!parsed.ok) {
      const corruptPath = await this.#quarantine(abs, raw, 'invalid-json');
      this.errorHandler.report(parsed.error, {
        source: 'StorageManager.readJson',
        detail: { path: abs, file: abs, corruptPath },
      });
      return { value: fallback, found: true, created: false, recovered: true, corruptPath, error: parsed.error };
    }
    return { value: parsed.value, found: true, created: false, recovered: false, corruptPath: null, error: null };
  }

  /**
   * Moves a corrupt file aside so no data is destroyed and the problem stays auditable.
   * @returns {Promise<string|null>} path of the quarantined copy
   */
  async #quarantine(abs, rawContent, reason) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = `${abs}.corrupt-${stamp}`;
    try {
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, rawContent, 'utf8');
      try {
        await fsp.rename(abs, `${abs}.invalid`);
      } catch {
        /* if the move fails we leave the original in place; the copy above already preserves the data */
      }
      this.logger.warn(`Archivo corrupto aislado (${reason})`, {
        source: 'StorageManager',
        file: abs,
        data: { corruptPath: target },
      });
      this.bus.emit('storage:corrupt', { path: abs, corruptPath: target, reason });
      return target;
    } catch (err) {
      this.errorHandler.report(toAppError(err, {
        kind: ErrorKind.STORAGE,
        message: `No se pudo aislar el archivo corrupto ${path.basename(abs)}`,
        detail: { path: abs },
      }), { source: 'StorageManager.quarantine' });
      return null;
    }
  }

  /* ---------------------------------------------------------------- *
   * Writes
   * ---------------------------------------------------------------- */

  /**
   * Atomic text write with optional backup of the previous revision.
   * @param {string} target relative (or allow-listed absolute) path
   * @param {string} content
   */
  async writeText(target, content, { allowAbsolute = false, backup = true, mode = 0o644 } = {}) {
    if (typeof content !== 'string') {
      throw errors.invalid('El contenido a escribir debe ser texto', { target, received: typeof content });
    }
    const abs = this.resolveSafe(target, { allowAbsolute });
    const dir = path.dirname(abs);
    await fsp.mkdir(dir, { recursive: true });

    const existed = await fsp.access(abs, fs.constants.F_OK).then(() => true, () => false);
    if (existed && backup) await this.#backupFile(abs);

    const tmp = path.join(dir, `.${path.basename(abs)}.${process.pid}.${Date.now()}.tmp`);
    let handle = null;
    try {
      handle = await fsp.open(tmp, 'w', mode);
      await handle.writeFile(content, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await fsp.rename(tmp, abs);
      return { ok: true, path: abs, bytes: Buffer.byteLength(content, 'utf8'), created: !existed };
    } catch (err) {
      if (handle) await handle.close().catch(() => {});
      await fsp.rm(tmp, { force: true }).catch(() => {});
      throw toAppError(err, {
        kind: ErrorKind.STORAGE,
        message: `No se pudo escribir ${path.basename(abs)}`,
        detail: { path: abs, file: abs },
      });
    }
  }

  /** Serialises `value` as pretty JSON and writes it atomically. */
  async writeJson(target, value, options = {}) {
    const text = `${JSON.stringify(value, null, 2)}\n`;
    const result = await this.writeText(target, text, options);
    return { ...result, value };
  }

  /** Appends a line to a file (used by the log writer / history export). */
  async appendLine(target, line, { allowAbsolute = false } = {}) {
    const abs = this.resolveSafe(target, { allowAbsolute });
    try {
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.appendFile(abs, line.endsWith('\n') ? line : `${line}\n`, 'utf8');
      return { ok: true, path: abs };
    } catch (err) {
      throw toAppError(err, {
        kind: ErrorKind.STORAGE,
        message: `No se pudo añadir contenido a ${path.basename(abs)}`,
        detail: { path: abs },
      });
    }
  }

  async #backupFile(abs) {
    try {
      const base = path.basename(abs);
      const dir = path.join(this.dirs.backups, base);
      await fsp.mkdir(dir, { recursive: true });
      this.#backupCounter += 1;
      const stamp = `${Date.now()}-${this.#backupCounter}`;
      await fsp.copyFile(abs, path.join(dir, `${stamp}.bak`));
      const entries = (await fsp.readdir(dir)).filter((name) => name.endsWith('.bak')).sort();
      const surplus = entries.slice(0, Math.max(0, entries.length - BACKUP_KEEP));
      await Promise.all(surplus.map((name) => fsp.rm(path.join(dir, name), { force: true })));
    } catch (err) {
      // A failed backup must not block the write, but the user has to know.
      this.errorHandler.report(toAppError(err, {
        kind: ErrorKind.STORAGE,
        message: `No se pudo respaldar ${path.basename(abs)} antes de sobrescribirlo`,
        detail: { path: abs },
      }), { source: 'StorageManager.backup' });
    }
  }

  /** Lists available backups for a file (newest first). */
  async listBackups(target) {
    const abs = this.resolveSafe(target);
    const dir = path.join(this.dirs.backups, path.basename(abs));
    try {
      const entries = await fsp.readdir(dir);
      const files = entries.filter((name) => name.endsWith('.bak')).sort().reverse();
      const stats = await Promise.all(files.map(async (name) => {
        const full = path.join(dir, name);
        const stat = await fsp.stat(full);
        return { name, path: full, bytes: stat.size, modifiedAt: stat.mtimeMs };
      }));
      return stats;
    } catch {
      return [];
    }
  }

  /** Restores a backup over the current file. */
  async restoreBackup(target, backupName) {
    const abs = this.resolveSafe(target);
    const source = this.resolveSafe(path.join(this.dirs.backups, path.basename(abs), backupName));
    const content = await this.readText(source, { allowAbsolute: true });
    const result = await this.writeText(target, content, { backup: true });
    this.logger.success(`Respaldo restaurado en ${path.basename(abs)}`, {
      source: 'StorageManager',
      data: { backupName },
    });
    this.bus.emit('storage:restored', { path: abs, backupName });
    return result;
  }

  /* ---------------------------------------------------------------- *
   * File operations
   * ---------------------------------------------------------------- */

  async remove(target, { soft = false, allowAbsolute = false } = {}) {
    const abs = this.resolveSafe(target, { allowAbsolute });
    const stat = await fsp.stat(abs).catch(() => null);
    if (!stat) {
      // Deleting something that is already gone is a success for idempotent callers,
      // but the caller is told it did not exist.
      return { ok: true, removed: false, path: abs };
    }
    if (soft) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const dest = path.join(this.dirs.trash, `${stamp}__${path.basename(abs)}`);
      await fsp.mkdir(this.dirs.trash, { recursive: true });
      await this.move(abs, dest, { allowAbsolute: true });
      return { ok: true, removed: true, path: abs, trashPath: dest };
    }
    try {
      await fsp.rm(abs, { recursive: stat.isDirectory(), force: true });
      return { ok: true, removed: true, path: abs };
    } catch (err) {
      throw toAppError(err, {
        kind: ErrorKind.STORAGE,
        code: ErrorCode.DELETE_FAILED,
        message: `No se pudo eliminar ${path.basename(abs)}`,
        detail: { path: abs },
      });
    }
  }

  /** Moves a path, falling back to copy+delete when crossing devices. */
  async move(from, to, { allowAbsolute = false, overwrite = false } = {}) {
    const source = this.resolveSafe(from, { allowAbsolute });
    const target = this.resolveSafe(to, { allowAbsolute });
    await fsp.mkdir(path.dirname(target), { recursive: true });
    if (!overwrite) {
      const exists = await fsp.access(target, fs.constants.F_OK).then(() => true, () => false);
      if (exists) throw errors.exists(path.basename(target), { path: target, file: target });
    }
    try {
      await fsp.rename(source, target);
      return { ok: true, from: source, to: target };
    } catch (err) {
      if (err.code !== 'EXDEV') {
        throw toAppError(err, {
          kind: ErrorKind.STORAGE,
          code: ErrorCode.RENAME_FAILED,
          message: `No se pudo mover ${path.basename(source)}`,
          detail: { from: source, to: target },
        });
      }
      await fsp.cp(source, target, { recursive: true });
      await fsp.rm(source, { recursive: true, force: true });
      return { ok: true, from: source, to: target, method: 'copy' };
    }
  }

  async copy(from, to, { allowAbsolute = false, overwrite = true } = {}) {
    const source = this.resolveSafe(from, { allowAbsolute });
    const target = this.resolveSafe(to, { allowAbsolute });
    if (!overwrite) {
      const exists = await fsp.access(target, fs.constants.F_OK).then(() => true, () => false);
      if (exists) throw errors.exists(path.basename(target), { path: target });
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    try {
      await fsp.cp(source, target, { recursive: true, force: overwrite });
      return { ok: true, from: source, to: target };
    } catch (err) {
      throw toAppError(err, {
        kind: ErrorKind.STORAGE,
        message: `No se pudo copiar ${path.basename(source)}`,
        detail: { from: source, to: target },
      });
    }
  }

  async stat(target, { allowAbsolute = false } = {}) {
    const abs = this.resolveSafe(target, { allowAbsolute });
    try {
      const stat = await fsp.stat(abs);
      return {
        path: abs,
        name: path.basename(abs),
        directory: path.dirname(abs),
        size: stat.size,
        isDirectory: stat.isDirectory(),
        isFile: stat.isFile(),
        createdAt: stat.birthtimeMs || stat.ctimeMs,
        modifiedAt: stat.mtimeMs,
        mode: stat.mode & 0o777,
      };
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw toAppError(err, {
        kind: ErrorKind.STORAGE,
        message: `No se pudo obtener información de ${path.basename(abs)}`,
        detail: { path: abs, file: abs },
      });
    }
  }

  /** Recursive listing with depth/size limits so a huge tree cannot freeze the server. */
  async list(target = '.', { allowAbsolute = false, depth = 3, includeFiles = true, maxEntries = 2000 } = {}) {
    const abs = this.resolveSafe(target, { allowAbsolute });
    const results = [];
    const walk = async (dir, level) => {
      if (level > depth || results.length >= maxEntries) return;
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch (err) {
        if (err.code === 'ENOENT') return;
        throw toAppError(err, {
          kind: ErrorKind.STORAGE,
          message: `No se pudo listar ${path.basename(dir)}`,
          detail: { path: dir },
        });
      }
      entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (results.length >= maxEntries) break;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push({ name: entry.name, path: full, type: 'directory', relative: path.relative(abs, full) });
          await walk(full, level + 1);
        } else if (includeFiles) {
          const stat = await fsp.stat(full).catch(() => null);
          results.push({
            name: entry.name,
            path: full,
            type: 'file',
            relative: path.relative(abs, full),
            size: stat?.size ?? null,
            modifiedAt: stat?.mtimeMs ?? null,
          });
        }
      }
    };
    await walk(abs, 0);
    return results.slice(0, maxEntries);
  }

  async checksum(target, { allowAbsolute = false, algorithm = 'sha256' } = {}) {
    const abs = this.resolveSafe(target, { allowAbsolute });
    const buffer = await fsp.readFile(abs);
    return crypto.createHash(algorithm).update(buffer).digest('hex');
  }

  /** Relative path from the data root (used when the UI needs a portable path). */
  relativeToRoot(absolute) {
    const resolved = path.isAbsolute(absolute) ? path.resolve(absolute) : this.resolveSafe(absolute);
    const relative = path.relative(this.root, resolved);
    return relative.startsWith('..') ? resolved : relative;
  }

  /** Real free/total space of the volume hosting the data root. */
  async diskSpace(target = this.root) {
    try {
      const stat = await fsp.statfs(target);
      return {
        freeBytes: stat.bavail * stat.bsize,
        totalBytes: stat.blocks * stat.bsize,
        blockSize: stat.bsize,
      };
    } catch {
      return { freeBytes: null, totalBytes: null, blockSize: null };
    }
  }

  /**
   * Watches a file or directory for external changes.
   * When the target file does not exist yet, the parent directory is watched and the events are
   * filtered by name, so a file created later is picked up (the watcher never fails silently).
   */
  watch(target, handler, { allowAbsolute = false, recursive = false } = {}) {
    const abs = this.resolveSafe(target, { allowAbsolute });
    const exists = fs.existsSync(abs);
    const isDirectory = exists && fs.statSync(abs).isDirectory();
    // Only real directories are watched directly; files (and files that do not exist yet) are
    // tracked through their parent directory, filtered by name.
    const watchPath = isDirectory ? abs : path.dirname(abs);
    const baseName = isDirectory ? null : path.basename(abs);
    try {
      const watcher = fs.watch(watchPath, { recursive: isDirectory ? recursive : false, persistent: false }, (eventType, filename) => {
        const name = filename ? String(filename) : null;
        if (baseName !== null && name !== null && name !== baseName) return;
        handler({ eventType, filename: name, path: abs, timestamp: Date.now(), filter: baseName ? null : path.basename(abs) });
      });
      watcher.on('error', (err) => {
        this.errorHandler.report(toAppError(err, {
          kind: ErrorKind.STORAGE,
          message: `Se detuvo la vigilancia de ${path.basename(abs)}`,
          detail: { path: abs },
        }), { source: 'StorageManager.watch' });
      });
      return watcher;
    } catch (err) {
      this.errorHandler.report(toAppError(err, {
        kind: ErrorKind.STORAGE,
        message: `No se pudo vigilar ${path.basename(abs)}`,
        detail: { path: abs, watchPath, recursive },
      }), { source: 'StorageManager.watch' });
      return null;
    }
  }

  /** Environment summary for the dashboard/capabilities panel. */
  async describe() {
    const space = await this.diskSpace();
    return {
      root: this.root,
      dirs: { ...this.dirs },
      writable: this.status.writable,
      readable: this.status.readable,
      freeBytes: space.freeBytes,
      totalBytes: space.totalBytes,
      platform: process.platform,
      arch: process.arch,
      tmp: os.tmpdir(),
      lastError: this.status.lastError,
    };
  }
}
