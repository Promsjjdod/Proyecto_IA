import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_DIR } from '../config.js';
import { db } from '../db.js';

const safeName = /^[^\\/\0\x01-\x1f\x7f]+$/;
const MAX_FILE_BYTES = 1_000_000;
const MAX_PROJECT_ENTRIES = 2_000;
const MAX_PROJECT_STORAGE_BYTES = 100_000_000;
const MAX_PROJECT_REVISION_BYTES = 100_000_000;
const ALLOWED_EXTENSIONS = new Set([
  '.html', '.htm', '.css', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.lua', '.json', '.yaml', '.yml', '.xml', '.md', '.txt', '.csv', '.svg', '.toml', '.ini', '.sh', '.bat', '.gitignore', '.env.example', '.sql', '.graphql', '.vue', '.svelte', '.rs', '.go', '.java', '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.rb', '.swift', '.kt', '.properties', '.config', '.conf', '.log', '.jsonc', '.astro', '.dockerfile',
]);

export function ownedProject(userId: string, projectId: string) {
  const row = db.prepare('SELECT * FROM projects WHERE id=? AND user_id=?').get(projectId, userId) as { id: string; user_id: string; name: string } | undefined;
  if (!row) throw Object.assign(new Error('Proyecto no encontrado.'), { status: 404 });
  const root = path.join(PROJECT_DIR, userId, projectId);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  return { project: row, root };
}

export function cleanRelativePath(input: unknown) {
  const raw = String(input ?? '').replace(/\\/g, '/');
  if (raw.length > 300 || raw.includes('\0') || raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) throw Object.assign(new Error('Ruta no válida.'), { status: 400 });
  const segments = raw.split('/').filter((x) => x && x !== '.');
  if (segments.some((segment) => segment === '..' || segment === '.git' || segment === '.env' || !safeName.test(segment))) throw Object.assign(new Error('Ruta no válida o reservada.'), { status: 400 });
  return segments.join('/');
}

export function projectFilePath(root: string, relative: string, allowMissing = false) {
  const cleaned = cleanRelativePath(relative);
  if (!cleaned) throw Object.assign(new Error('La ruta debe indicar un archivo o carpeta.'), { status: 400 });
  const target = path.resolve(root, ...cleaned.split('/'));
  if (target !== root && !target.startsWith(`${path.resolve(root)}${path.sep}`)) throw Object.assign(new Error('Ruta fuera del proyecto.'), { status: 400 });
  let current = root;
  const parts = cleaned.split('/');
  for (let i = 0; i < parts.length; i += 1) {
    current = path.join(current, parts[i]);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) throw Object.assign(new Error('No se permiten enlaces simbólicos dentro del espacio de trabajo.'), { status: 400 });
      if (i < parts.length - 1 && !stat.isDirectory()) throw Object.assign(new Error('La ruta contiene un componente que no es una carpeta.'), { status: 400 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && allowMissing) break;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });
      throw error;
    }
  }
  return { absolute: target, relative: cleaned };
}

export function validateFileName(relative: string) {
  const base = path.posix.basename(relative);
  if (!base || base.length > 160 || !safeName.test(base)) throw Object.assign(new Error('Nombre de archivo no válido.'), { status: 400 });
  const ext = path.posix.extname(base).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext) && !base.startsWith('.')) throw Object.assign(new Error(`Extensión ${ext || '(sin extensión)'} no permitida.`), { status: 400 });
  if (base === '.env' || base === '.git' || base.startsWith('.git/')) throw Object.assign(new Error('Ese nombre reservado no está permitido.'), { status: 400 });
}

function projectStorage(root: string, targetRelative?: string) {
  let entries = 0;
  let bytes = 0;
  let targetBytes = 0;
  function walk(dir: string, prefix: string, depth: number) {
    if (depth > 150) throw Object.assign(new Error('El árbol del proyecto supera la profundidad permitida.'), { status: 413 });
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.isSymbolicLink()) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(dir, entry.name);
      const stat = fs.lstatSync(absolute);
      entries += 1;
      if (entries > MAX_PROJECT_ENTRIES) throw Object.assign(new Error(`El proyecto admite hasta ${MAX_PROJECT_ENTRIES} archivos y carpetas.`), { status: 413 });
      if (stat.isDirectory()) walk(absolute, relative, depth + 1);
      else if (stat.isFile()) {
        bytes += stat.size;
        if (relative === targetRelative) targetBytes = stat.size;
        if (bytes > MAX_PROJECT_STORAGE_BYTES) throw Object.assign(new Error('El proyecto superó su límite de almacenamiento de 100 MB.'), { status: 413 });
      }
    }
  }
  walk(root, '', 0);
  return { entries, bytes, targetBytes };
}

function assertProjectEntryCapacity(root: string, relative: string, includesTarget: boolean, storage = projectStorage(root)) {
  let current = root;
  let missingEntries = 0;
  const segments = relative.split('/');
  for (let index = 0; index < segments.length - 1; index += 1) {
    current = path.join(current, segments[index]);
    if (!fs.existsSync(current)) missingEntries += 1;
  }
  if (includesTarget) {
    current = path.join(current, segments.at(-1)!);
    if (!fs.existsSync(current)) missingEntries += 1;
  }
  if (storage.entries + missingEntries > MAX_PROJECT_ENTRIES) throw Object.assign(new Error(`El proyecto admite hasta ${MAX_PROJECT_ENTRIES} archivos y carpetas.`), { status: 413 });
  return storage;
}

export function assertProjectStorage(root: string, relativeInput: unknown, nextBytes: number) {
  if (!Number.isSafeInteger(nextBytes) || nextBytes < 0 || nextBytes > MAX_PROJECT_STORAGE_BYTES) throw Object.assign(new Error('Tamaño de archivo no válido.'), { status: 413 });
  const relative = cleanRelativePath(relativeInput);
  const storage = projectStorage(root, relative);
  assertProjectEntryCapacity(root, relative, true, storage);
  const targetAbsolute = path.resolve(root, ...relative.split('/'));
  const targetBytes = fs.existsSync(targetAbsolute) ? storage.targetBytes : 0;
  if (storage.bytes - targetBytes + nextBytes > MAX_PROJECT_STORAGE_BYTES) throw Object.assign(new Error('El proyecto admite hasta 100 MB de archivos.'), { status: 413 });
}

export function writeProjectFile(userId: string, projectId: string, relativeInput: string, contentInput: unknown) {
  const { root } = ownedProject(userId, projectId);
  const { absolute, relative } = projectFilePath(root, relativeInput, true);
  validateFileName(relative);
  const content = String(contentInput ?? '');
  const contentBytes = Buffer.byteLength(content, 'utf8');
  if (contentBytes > MAX_FILE_BYTES) throw Object.assign(new Error('El tamaño máximo por archivo es 1 MB.'), { status: 413 });
  const exists = fs.existsSync(absolute);
  const existingStat = exists ? fs.statSync(absolute) : null;
  if (existingStat && !existingStat.isFile()) throw Object.assign(new Error('La ruta ya corresponde a una carpeta.'), { status: 400 });
  const old = existingStat && existingStat.size <= MAX_FILE_BYTES ? fs.readFileSync(absolute, 'utf8') : null;
  assertProjectStorage(root, relative, contentBytes);
  const previousRevisionBytes = (db.prepare('SELECT COALESCE(SUM(length(CAST(content AS BLOB))),0) total FROM file_revisions WHERE project_id=? AND user_id=?').get(projectId, userId) as { total: number }).total;
  const nextRevisionBytes = contentBytes + (old !== null ? Buffer.byteLength(old, 'utf8') : 0);
  if (previousRevisionBytes + nextRevisionBytes > MAX_PROJECT_REVISION_BYTES) throw Object.assign(new Error('El historial de versiones del proyecto alcanzó el límite de 100 MB.'), { status: 413 });
  fs.mkdirSync(path.dirname(absolute), { recursive: true, mode: 0o700 });
  fs.writeFileSync(absolute, content, { encoding: 'utf8', mode: 0o600 });
  const now = new Date().toISOString();
  const revision = db.prepare('INSERT INTO file_revisions(id,project_id,user_id,relative_path,content,created_at) VALUES(?,?,?,?,?,?)');
  if (old !== null) revision.run(crypto.randomUUID(), projectId, userId, relative, old, now);
  revision.run(crypto.randomUUID(), projectId, userId, relative, content, now);
  db.prepare(`DELETE FROM file_revisions WHERE id IN (SELECT id FROM file_revisions WHERE project_id=? AND relative_path=? ORDER BY created_at DESC LIMIT -1 OFFSET 25)`).run(projectId, relative);
  db.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(now, projectId);
  return { path: relative, bytes: contentBytes, savedAt: now };
}

export function readProjectFile(userId: string, projectId: string, relativeInput: string) {
  const { root } = ownedProject(userId, projectId);
  const { absolute, relative } = projectFilePath(root, relativeInput);
  const stat = fs.statSync(absolute);
  if (!stat.isFile()) throw Object.assign(new Error('La ruta indicada no es un archivo.'), { status: 400 });
  if (stat.size > MAX_FILE_BYTES) throw Object.assign(new Error('El archivo supera el límite de lectura de 1 MB.'), { status: 413 });
  return { path: relative, content: fs.readFileSync(absolute, 'utf8'), bytes: stat.size, modifiedAt: stat.mtime.toISOString() };
}

export function listProjectFiles(root: string) {
  const results: { path: string; name: string; type: 'file' | 'directory'; bytes?: number; modifiedAt?: string }[] = [];
  function walk(dir: string, prefix: string, depth: number) {
    if (depth > 8 || results.length > 2000) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
    for (const entry of entries) {
      if (entry.name === '.git' || entry.isSymbolicLink()) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(dir, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isDirectory()) { results.push({ path: relative, name: entry.name, type: 'directory' }); walk(absolute, relative, depth + 1); }
      else if (stat.isFile()) results.push({ path: relative, name: entry.name, type: 'file', bytes: stat.size, modifiedAt: stat.mtime.toISOString() });
      if (results.length > 2000) break;
    }
  }
  walk(root, '', 0);
  return results;
}

export function createProjectFolder(userId: string, projectId: string, relativeInput: string) {
  const { root } = ownedProject(userId, projectId);
  const { absolute, relative } = projectFilePath(root, relativeInput, true);
  const base = path.posix.basename(relative);
  if (!base || base.length > 120 || relative.split('/').some((segment) => segment === '.env' || segment === '.git')) throw Object.assign(new Error('Nombre de carpeta no válido.'), { status: 400 });
  if (fs.existsSync(absolute)) throw Object.assign(new Error('Ya existe un archivo o carpeta con esa ruta.'), { status: 409 });
  assertProjectStorage(root, relative, 0);
  fs.mkdirSync(absolute, { recursive: true, mode: 0o700 });
  return { path: relative };
}

export function deleteProjectEntry(userId: string, projectId: string, relativeInput: string, recursive = false) {
  const { root } = ownedProject(userId, projectId);
  const { absolute, relative } = projectFilePath(root, relativeInput);
  const stat = fs.lstatSync(absolute);
  if (stat.isDirectory() && !recursive && fs.readdirSync(absolute).length) throw Object.assign(new Error('La carpeta no está vacía. Confirma la eliminación recursiva.'), { status: 409 });
  fs.rmSync(absolute, { recursive, force: false });
  return { path: relative };
}

export function renameProjectEntry(userId: string, projectId: string, fromInput: string, toInput: string) {
  const { root } = ownedProject(userId, projectId);
  const from = projectFilePath(root, fromInput);
  const to = projectFilePath(root, toInput, true);
  const sourceStat = fs.lstatSync(from.absolute);
  if (sourceStat.isDirectory() && (to.absolute === from.absolute || to.absolute.startsWith(`${from.absolute}${path.sep}`))) throw Object.assign(new Error('No puedes mover una carpeta dentro de sí misma.'), { status: 400 });
  if (sourceStat.isDirectory()) {
    if (to.relative.split('/').some((segment) => segment === '.env' || segment === '.git')) throw Object.assign(new Error('Ese nombre reservado no está permitido.'), { status: 400 });
  } else validateFileName(to.relative);
  assertProjectEntryCapacity(root, to.relative, false);
  fs.mkdirSync(path.dirname(to.absolute), { recursive: true, mode: 0o700 });
  if (fs.existsSync(to.absolute)) throw Object.assign(new Error('Ya existe un archivo o carpeta con ese nombre.'), { status: 409 });
  fs.renameSync(from.absolute, to.absolute);
  return { from: from.relative, to: to.relative };
}

export const MAX_PROJECT_FILE_BYTES = MAX_FILE_BYTES;
export const MAX_PROJECT_STORAGE_BYTES_LIMIT = MAX_PROJECT_STORAGE_BYTES;
