/**
 * ScriptRepository — real script management on top of StorageManager.
 *
 * Layout:
 *   data/scripts/<id>.<ext>   → the source code (plain files: editable outside the app)
 *   data/meta/scripts.json    → metadata index (never the source of truth for content)
 *
 * Every mutation writes the file first, then the index; if the index write fails the
 * in-memory state is rolled back and the error reported, so the two never diverge silently.
 * Content on disk wins: if a file is modified outside the app, `stat` reports the real
 * size/mtime and `syncFromDisk()` reconciles the index.
 */

import path from 'node:path';
import { DEFAULT_SCRIPT_TEMPLATE, Dialect, DialectInfo, ErrorKind, Limits, ScriptCategory, SortMode } from '../../shared/constants.js';
import { AppError, errors, toAppError } from '../../shared/errors.js';
import { expectString, expectStringArray, expectDialect, expectEnum, expectScriptId, isPlainObject } from '../../shared/protocol.js';

const INDEX_FILE = 'meta/scripts.json';

export class ScriptRepository {
  #scripts = new Map();
  #indexDirty = false;
  #flushTimer = null;
  recovered = false;
  corruptPath = null;

  /**
   * @param {{ storage: import('./StorageManager.js').StorageManager, history: import('./HistoryStore.js').HistoryStore, logger, errorHandler, bus }} options
   */
  constructor({ storage, history, logger, errorHandler, bus }) {
    this.storage = storage;
    this.history = history;
    this.logger = logger;
    this.errorHandler = errorHandler;
    this.bus = bus;
  }

  async load() {
    const result = await this.storage.readJson(INDEX_FILE, { fallback: { version: 1, scripts: [] } });
    this.recovered = result.recovered;
    this.corruptPath = result.corruptPath;
    this.#scripts.clear();
    const incoming = Array.isArray(result.value?.scripts) ? result.value.scripts : [];
    let invalid = 0;
    for (const record of incoming) {
      const normalized = normalizeRecord(record);
      if (!normalized) {
        invalid += 1;
        continue;
      }
      this.#scripts.set(normalized.id, normalized);
    }
    if (invalid > 0) {
      this.errorHandler.report(new AppError({
        message: `Se ignoraron ${invalid} entradas inválidas del índice de scripts`,
        kind: ErrorKind.STORAGE,
        code: 'E_CORRUPT_DATA',
        detail: { invalid, indexFile: INDEX_FILE },
      }), { source: 'ScriptRepository.load' });
    }
    await this.syncFromDisk();
    this.bus.emit('scripts:loaded', { count: this.#scripts.size, recovered: this.recovered });
    this.logger.info(`Índice de scripts cargado (${this.#scripts.size} entradas)`, { source: 'ScriptRepository' });
    return { count: this.#scripts.size, recovered: this.recovered, corruptPath: this.corruptPath, invalid };
  }

  /**
   * Reconciles the index against what is actually on disk:
   *  - removes index entries whose file disappeared;
   *  - imports orphan files found in the scripts directory.
   */
  async syncFromDisk() {
    const diskFiles = await this.storage.list('scripts', { depth: 1, includeFiles: true, maxEntries: 5000 });
    const byFile = new Map(diskFiles.filter((entry) => entry.type === 'file' && !entry.name.endsWith('.tmp')).map((entry) => [entry.relative, entry]));
    let removed = 0;
    let imported = 0;

    for (const [id, record] of [...this.#scripts]) {
      if (!byFile.has(record.file)) {
        this.#scripts.delete(id);
        removed += 1;
      }
    }

    for (const entry of byFile.values()) {
      const exists = [...this.#scripts.values()].some((record) => record.file === entry.relative);
      if (exists) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!['.lua', '.luau', '.lua54', '.txt'].includes(ext)) continue;
      const id = this.#uniqueId(slugify(path.basename(entry.name, ext)));
      const dialect = ext === '.lua54' ? Dialect.LUA54 : Dialect.LUAU;
      this.#scripts.set(id, {
        id,
        name: path.basename(entry.name, ext),
        file: entry.relative,
        dialect,
        category: ScriptCategory.GENERAL,
        tags: ['importado'],
        favorite: false,
        description: 'Script detectado en el directorio de trabajo',
        createdAt: entry.modifiedAt ?? Date.now(),
        updatedAt: entry.modifiedAt ?? Date.now(),
        size: entry.size ?? 0,
        checksum: null,
        runCount: 0,
        errorCount: 0,
        lastRun: null,
        imported: true,
      });
      imported += 1;
    }

    if (removed > 0 || imported > 0) {
      await this.flushIndex();
      this.bus.emit('scripts:changed', { reason: 'sync', removed, imported });
    }
    return { removed, imported, total: this.#scripts.size };
  }

  /* ---------------------------------------------------------------- *
   * Queries
   * ---------------------------------------------------------------- */

  list({ query = '', category = null, tags = [], favoriteOnly = false, dialect = null, sort = SortMode.MODIFIED_DESC, limit = 500 } = {}) {
    let records = [...this.#scripts.values()];
    if (category) records = records.filter((record) => record.category === category);
    if (dialect) records = records.filter((record) => record.dialect === dialect);
    if (favoriteOnly) records = records.filter((record) => record.favorite === true);
    if (Array.isArray(tags) && tags.length > 0) {
      records = records.filter((record) => tags.every((tag) => record.tags.includes(tag)));
    }

    const trimmed = String(query ?? '').trim();
    if (trimmed !== '') {
      const scored = records
        .map((record) => ({ record, score: scoreMatch(record, trimmed) }))
        .filter((entry) => entry.score > 0);
      scored.sort((a, b) => b.score - a.score || b.record.updatedAt - a.record.updatedAt);
      records = scored.map((entry) => entry.record);
      return records.slice(0, limit).map((record) => this.#decorate(record));
    }

    return records.sort(comparatorFor(sort)).slice(0, limit).map((record) => this.#decorate(record));
  }

  /** Search inside the file contents (bounded, real reads). */
  async searchContent(query, { limit = 50, caseSensitive = false, maxFiles = 200 } = {}) {
    const needle = String(query ?? '');
    if (needle.trim() === '') return [];
    const records = [...this.#scripts.values()].slice(0, maxFiles);
    const results = [];
    const matcher = new RegExp(escapeRegExp(needle), caseSensitive ? 'g' : 'gi');
    for (const record of records) {
      if (results.length >= limit) break;
      let content;
      try {
        content = await this.storage.readText(path.join('scripts', record.file), { fallback: '' });
      } catch {
        continue;
      }
      const lines = content.split('\n');
      const matches = [];
      for (let index = 0; index < lines.length && matches.length < 5; index += 1) {
        matcher.lastIndex = 0;
        if (matcher.test(lines[index])) {
          matches.push({ line: index + 1, text: lines[index].slice(0, 240) });
        }
      }
      if (matches.length > 0) {
        results.push({ id: record.id, name: record.name, file: record.file, matches });
      }
    }
    return results;
  }

  get(id) {
    const record = this.#scripts.get(expectScriptId(id));
    if (!record) return null;
    return this.#decorate(record);
  }

  /** Throws a descriptive error instead of returning null (used by HTTP layer). */
  require(id) {
    const record = this.#scripts.get(expectScriptId(id));
    if (!record) throw errors.notFound(`El script "${id}"`, { scriptId: id, kind: ErrorKind.SCRIPT });
    return this.#decorate(record);
  }

  async read(id) {
    const record = this.require(id);
    const content = await this.storage.readText(path.join('scripts', record.file), { fallback: null });
    if (content === null) {
      throw errors.notFound(`El archivo del script "${record.name}"`, { scriptId: id, file: record.file });
    }
    return { record, content };
  }

  /* ---------------------------------------------------------------- *
   * Mutations
   * ---------------------------------------------------------------- */

  async create({ name, content = null, dialect = Dialect.LUAU, category = ScriptCategory.GENERAL, tags = [], description = '' } = {}) {
    const cleanName = expectString(name ?? 'nuevo-script', 'name', { min: 1, max: 120, allowEmpty: false });
    const cleanDialect = expectDialect(dialect);
    const id = this.#uniqueId(slugify(cleanName));
    const ext = cleanDialect === Dialect.LUA54 ? '.lua' : '.luau';
    const file = `${id}${ext}`;
    const body = content === null ? defaultTemplateFor(cleanDialect, cleanName) : expectString(content, 'content', { max: Limits.maxSourceBytes });
    const now = Date.now();
    const record = {
      id,
      name: cleanName,
      file,
      dialect: cleanDialect,
      category: expectEnum(category, 'category', Object.values(ScriptCategory)),
      tags: expectStringArray(tags, 'tags'),
      favorite: false,
      description: expectString(description ?? '', 'description', { max: 500 }),
      createdAt: now,
      updatedAt: now,
      size: 0,
      checksum: null,
      runCount: 0,
      errorCount: 0,
      lastRun: null,
    };

    const writeResult = await this.storage.writeText(path.join('scripts', file), body);
    record.size = writeResult.bytes;
    record.checksum = await this.storage.checksum(path.join('scripts', file));
    this.#scripts.set(id, record);
    await this.flushIndex();
    this.history?.recordActivity({ type: 'script.created', title: `Script creado: ${cleanName}`, scriptId: id });
    this.bus.emit('script:created', { id, name: cleanName });
    this.bus.emit('scripts:changed', { reason: 'create', id });
    return this.#decorate(record);
  }

  async save(id, content, { expectedChecksum = null } = {}) {
    const record = this.require(id);
    const body = expectString(content, 'content', { max: Limits.maxSourceBytes });
    const target = path.join('scripts', record.file);

    if (expectedChecksum && record.checksum && expectedChecksum !== record.checksum) {
      const current = await this.storage.checksum(target).catch(() => null);
      if (current && current !== expectedChecksum) {
        throw new AppError({
          message: `El script "${record.name}" cambió en disco desde que se abrió`,
          code: 'E_CONFLICT',
          kind: ErrorKind.SCRIPT,
          detail: { scriptId: id, expectedChecksum, actualChecksum: current, conflict: true },
        });
      }
    }

    const result = await this.storage.writeText(target, body);
    const raw = this.#scripts.get(id);
    raw.size = result.bytes;
    raw.updatedAt = Date.now();
    raw.checksum = await this.storage.checksum(target);
    raw.imported = false;
    await this.flushIndex();
    this.history?.recordActivity({
      type: 'script.saved',
      title: `Script guardado: ${raw.name}`,
      scriptId: id,
      detail: { bytes: result.bytes },
    });
    this.bus.emit('script:saved', { id, bytes: result.bytes });
    this.bus.emit('scripts:changed', { reason: 'save', id });
    return { record: this.#decorate(raw), bytes: result.bytes, path: result.path };
  }

  async saveAs(id, { name, dialect = null } = {}) {
    const record = this.require(id);
    const { content } = await this.read(id);
    const created = await this.create({
      name: expectString(name, 'name', { min: 1, max: 120, allowEmpty: false }),
      content,
      dialect: dialect ?? record.dialect,
      category: record.category,
      tags: record.tags,
      description: record.description,
    });
    this.history?.recordActivity({
      type: 'script.saved-as',
      title: `Guardado como: ${created.name}`,
      scriptId: created.id,
      detail: { sourceId: id },
    });
    return created;
  }

  async rename(id, newName) {
    const record = this.require(id);
    const cleanName = expectString(newName, 'name', { min: 1, max: 120, allowEmpty: false }).trim();
    if (cleanName === record.name) return record;
    const raw = this.#scripts.get(id);
    const previousName = raw.name;
    raw.name = cleanName;
    raw.updatedAt = Date.now();
    await this.flushIndex();
    this.history?.recordActivity({
      type: 'script.renamed',
      title: `Renombrado: ${previousName} → ${cleanName}`,
      scriptId: id,
      detail: { from: previousName, to: cleanName },
    });
    this.bus.emit('scripts:changed', { reason: 'rename', id });
    return this.#decorate(raw);
  }

  async updateMetadata(id, patch = {}) {
    const raw = this.#scripts.get(expectScriptId(id));
    if (!raw) throw errors.notFound(`El script "${id}"`, { scriptId: id, kind: ErrorKind.SCRIPT });
    const allowed = ['name', 'category', 'tags', 'favorite', 'description', 'dialect'];
    const changed = {};
    for (const [key, value] of Object.entries(patch)) {
      if (!allowed.includes(key)) continue;
      switch (key) {
        case 'name':
          raw.name = expectString(value, 'name', { min: 1, max: 120, allowEmpty: false });
          break;
        case 'category':
          raw.category = expectEnum(value, 'category', Object.values(ScriptCategory));
          break;
        case 'tags':
          raw.tags = expectStringArray(value, 'tags');
          break;
        case 'favorite':
          raw.favorite = value === true;
          break;
        case 'description':
          raw.description = expectString(value ?? '', 'description', { max: 500 });
          break;
        case 'dialect':
          raw.dialect = expectDialect(value);
          break;
        default:
          break;
      }
      changed[key] = raw[key];
    }
    raw.updatedAt = Date.now();
    await this.flushIndex();
    this.history?.recordActivity({
      type: 'script.metadata',
      title: `Metadatos actualizados: ${raw.name}`,
      scriptId: raw.id,
      detail: { changed: Object.keys(changed) },
    });
    this.bus.emit('scripts:changed', { reason: 'metadata', id: raw.id });
    return this.#decorate(raw);
  }

  async toggleFavorite(id) {
    const record = this.require(id);
    return this.updateMetadata(id, { favorite: !record.favorite });
  }

  async duplicate(id, { name = null } = {}) {
    const record = this.require(id);
    const { content } = await this.read(id);
    const baseName = name ?? `${record.name} (copia)`;
    const created = await this.create({
      name: baseName,
      content,
      dialect: record.dialect,
      category: record.category,
      tags: record.tags,
      description: record.description,
    });
    this.history?.recordActivity({ type: 'script.duplicated', title: `Duplicado: ${record.name}`, scriptId: created.id });
    return created;
  }

  async remove(id, { soft = true } = {}) {
    const record = this.require(id);
    const raw = this.#scripts.get(id);
    const result = await this.storage.remove(path.join('scripts', record.file), { soft });
    this.#scripts.delete(id);
    try {
      await this.flushIndex();
    } catch (err) {
      // Roll back the in-memory change so state matches disk.
      this.#scripts.set(id, raw);
      throw err;
    }
    this.history?.recordActivity({
      type: 'script.deleted',
      title: `Script eliminado: ${record.name}`,
      detail: { soft, trashPath: result.trashPath ?? null, id },
    });
    this.bus.emit('script:deleted', { id, name: record.name, soft });
    this.bus.emit('scripts:changed', { reason: 'delete', id });
    return { ok: true, id, trashed: soft, trashPath: result.trashPath ?? null };
  }

  /** Imports a script from raw content (uploaded or read from an allow-listed path). */
  async importScript({ name, content, dialect = null, category = ScriptCategory.GENERAL, tags = ['importado'] }) {
    const cleanName = expectString(name, 'name', { min: 1, max: 160, allowEmpty: false });
    const body = expectString(content, 'content', { max: Limits.maxSourceBytes });
    const guessed = dialect ?? guessDialectFromName(cleanName);
    const record = await this.create({ name: cleanName.replace(/\.[A-Za-z0-9]+$/, ''), content: body, dialect: guessed, category, tags });
    this.history?.recordActivity({ type: 'script.imported', title: `Script importado: ${record.name}`, scriptId: record.id });
    return record;
  }

  /** Reads a file from an allow-listed absolute location (project root or home). */
  async importFromPath(absolutePath) {
    const content = await this.storage.readText(absolutePath, { allowAbsolute: true });
    const name = path.basename(absolutePath);
    return this.importScript({ name, content, dialect: guessDialectFromName(name) });
  }

  /** Returns the real absolute path so the caller can stream/download it. */
  async exportToPath(id, targetPath) {
    const record = this.require(id);
    const source = path.join('scripts', record.file);
    const result = await this.storage.copy(source, targetPath, { allowAbsolute: true, overwrite: true });
    this.history?.recordActivity({
      type: 'script.exported',
      title: `Script exportado: ${record.name}`,
      scriptId: id,
      detail: { target: result.to },
    });
    return result;
  }

  /** Raw bytes + filename for HTTP download. */
  async exportPayload(id) {
    const record = this.require(id);
    const content = await this.storage.readText(path.join('scripts', record.file), { fallback: '' });
    // The exported file keeps a single extension, even when the script name already has one.
    const extension = record.dialect === Dialect.LUA54 ? '.lua' : '.luau';
    const base = record.name.replace(/\.(lua|luau|lua54)$/i, '');
    return { filename: `${base || record.name}${extension}`, content };
  }

  /** Records the outcome of a real execution against a script. */
  async recordRun(id, execution) {
    const raw = this.#scripts.get(id);
    if (!raw) return null;
    raw.runCount = (raw.runCount ?? 0) + 1;
    if (!execution.ok && !execution.stats?.cancelled) raw.errorCount = (raw.errorCount ?? 0) + 1;
    raw.lastRun = {
      at: Date.now(),
      state: execution.state,
      durationMs: execution.stats?.durationMs ?? null,
      engineId: execution.engineId ?? null,
      error: execution.error?.message ?? null,
    };
    await this.flushIndex();
    this.bus.emit('scripts:changed', { reason: 'run', id });
    return this.#decorate(raw);
  }

  /** Aggregated real statistics (dashboard). */
  stats() {
    const records = [...this.#scripts.values()];
    const byCategory = {};
    const byDialect = {};
    let totalBytes = 0;
    let favorites = 0;
    let neverRun = 0;
    let lastModifiedAt = null;
    for (const record of records) {
      byCategory[record.category] = (byCategory[record.category] ?? 0) + 1;
      byDialect[record.dialect] = (byDialect[record.dialect] ?? 0) + 1;
      totalBytes += record.size ?? 0;
      if (record.favorite) favorites += 1;
      if ((record.runCount ?? 0) === 0) neverRun += 1;
      if (lastModifiedAt === null || record.updatedAt > lastModifiedAt) lastModifiedAt = record.updatedAt;
    }
    const allTags = new Set();
    for (const record of records) for (const tag of record.tags) allTags.add(tag);
    return {
      total: records.length,
      favorites,
      neverRun,
      totalBytes,
      byCategory,
      byDialect,
      tags: [...allTags].sort(),
      lastModifiedAt,
      totalRuns: records.reduce((sum, record) => sum + (record.runCount ?? 0), 0),
      totalErrors: records.reduce((sum, record) => sum + (record.errorCount ?? 0), 0),
    };
  }

  /* ---------------------------------------------------------------- *
   * Internals
   * ---------------------------------------------------------------- */

  #decorate(record) {
    return {
      ...record,
      tags: [...record.tags],
      extension: path.extname(record.file),
      dialectInfo: DialectInfo[record.dialect] ?? null,
      preview: null,
    };
  }

  #uniqueId(base) {
    let candidate = base === '' ? 'script' : base;
    let counter = 1;
    while (this.#scripts.has(candidate)) {
      counter += 1;
      candidate = `${base}-${counter}`;
    }
    return candidate;
  }

  async flushIndex() {
    try {
      await this.storage.writeJson(INDEX_FILE, {
        version: 1,
        updatedAt: Date.now(),
        scripts: [...this.#scripts.values()],
      });
      this.#indexDirty = false;
      return { ok: true };
    } catch (err) {
      this.#indexDirty = true;
      const appError = toAppError(err, {
        kind: ErrorKind.STORAGE,
        message: 'No se pudo guardar el índice de scripts',
      });
      this.errorHandler.report(appError, { source: 'ScriptRepository.flushIndex' });
      throw appError;
    }
  }

  get indexDirty() {
    return this.#indexDirty;
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function slugify(value) {
  const base = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return base === '' ? 'script' : base;
}

function defaultTemplateFor(dialect, name) {
  if (dialect === Dialect.LUA54) {
    return `-- ${name}\n-- Lua 5.4\n\nlocal function main()\n  print("Hola desde Lumen Studio (Lua 5.4)")\nend\n\nmain()\n`;
  }
  return DEFAULT_SCRIPT_TEMPLATE.replace('Nuevo script Luau', name);
}

function guessDialectFromName(name) {
  const lower = String(name).toLowerCase();
  if (lower.endsWith('.lua54')) return Dialect.LUA54;
  return Dialect.LUAU;
}

function normalizeRecord(record) {
  if (!isPlainObject(record)) return null;
  const id = typeof record.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(record.id) ? record.id : null;
  if (!id) return null;
  const file = typeof record.file === 'string' && record.file !== '' && !record.file.includes('..') ? record.file : null;
  if (!file) return null;
  const dialect = Object.values(Dialect).includes(record.dialect) ? record.dialect : Dialect.LUAU;
  return {
    id,
    name: typeof record.name === 'string' && record.name.trim() !== '' ? record.name : path.basename(file, path.extname(file)),
    file,
    dialect,
    category: Object.values(ScriptCategory).includes(record.category) ? record.category : ScriptCategory.GENERAL,
    tags: Array.isArray(record.tags) ? record.tags.filter((tag) => typeof tag === 'string').slice(0, 32) : [],
    favorite: record.favorite === true,
    description: typeof record.description === 'string' ? record.description.slice(0, 500) : '',
    createdAt: Number.isFinite(record.createdAt) ? record.createdAt : Date.now(),
    updatedAt: Number.isFinite(record.updatedAt) ? record.updatedAt : Date.now(),
    size: Number.isFinite(record.size) ? record.size : 0,
    checksum: typeof record.checksum === 'string' ? record.checksum : null,
    runCount: Number.isFinite(record.runCount) ? record.runCount : 0,
    errorCount: Number.isFinite(record.errorCount) ? record.errorCount : 0,
    lastRun: isPlainObject(record.lastRun) ? record.lastRun : null,
    imported: record.imported === true,
  };
}

function comparatorFor(sort) {
  switch (sort) {
    case SortMode.NAME_ASC:
      return (a, b) => a.name.localeCompare(b.name, 'es');
    case SortMode.NAME_DESC:
      return (a, b) => b.name.localeCompare(a.name, 'es');
    case SortMode.MODIFIED_ASC:
      return (a, b) => a.updatedAt - b.updatedAt;
    case SortMode.CREATED_DESC:
      return (a, b) => b.createdAt - a.createdAt;
    case SortMode.SIZE_DESC:
      return (a, b) => (b.size ?? 0) - (a.size ?? 0);
    case SortMode.RUNS_DESC:
      return (a, b) => (b.runCount ?? 0) - (a.runCount ?? 0);
    case SortMode.FAVORITES_FIRST:
      return (a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt;
    case SortMode.MODIFIED_DESC:
    default:
      return (a, b) => b.updatedAt - a.updatedAt;
  }
}

/** Simple, predictable scoring: exact name > prefix > substring > tag > description. */
export function scoreMatch(record, query) {
  const needle = query.toLowerCase();
  const name = record.name.toLowerCase();
  let score = 0;
  if (name === needle) score += 120;
  if (name.startsWith(needle)) score += 60;
  if (name.includes(needle)) score += 40;
  for (const tag of record.tags) {
    const lower = tag.toLowerCase();
    if (lower === needle) score += 30;
    else if (lower.includes(needle)) score += 18;
  }
  if (record.category.toLowerCase().includes(needle)) score += 12;
  if (record.description.toLowerCase().includes(needle)) score += 8;
  if (score > 0 && record.favorite) score += 5;
  return score;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
