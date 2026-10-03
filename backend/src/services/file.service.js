import fs from 'node:fs';
import path from 'node:path';
import { eq, and, like, or, desc } from 'drizzle-orm';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { db, schema } from '../database/index.js';
import { config } from '../config/env.js';
import { randomId, sha256 } from '../core/crypto.js';
import { notFound, badRequest } from '../core/errors.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('files');

const KIND_BY_EXT = {
  '.txt': 'text', '.md': 'markdown', '.csv': 'csv', '.json': 'json',
  '.js': 'code', '.jsx': 'code', '.ts': 'code', '.tsx': 'code', '.py': 'code',
  '.html': 'html', '.css': 'code', '.pdf': 'pdf', '.docx': 'docx', '.zip': 'zip',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.svg': 'image', '.webp': 'image',
};

export function kindFor(name, mime) {
  const ext = path.extname(name).toLowerCase();
  if (KIND_BY_EXT[ext]) return KIND_BY_EXT[ext];
  if (mime?.startsWith('image/')) return 'image';
  if (mime?.startsWith('text/')) return 'text';
  return 'binary';
}

export function defaultWorkspace() {
  let ws = db.select().from(schema.workspaces).limit(1).all()[0];
  if (!ws) {
    ws = { id: randomId('ws'), name: 'Default Workspace', description: 'Local files uploaded to ForgeAI.', root: 'uploads', createdAt: Date.now() };
    db.insert(schema.workspaces).values(ws).run();
  }
  return ws;
}

export function listWorkspaces() {
  defaultWorkspace();
  return db.select().from(schema.workspaces).all();
}

export function listFiles({ workspaceId, folder, query } = {}) {
  const ws = workspaceId || defaultWorkspace().id;
  const conds = [eq(schema.files.workspaceId, ws)];
  if (folder !== undefined) conds.push(eq(schema.files.folder, folder));
  if (query) conds.push(or(like(schema.files.name, `%${query}%`), like(schema.files.folder, `%${query}%`)));
  return db.select().from(schema.files).where(and(...conds)).orderBy(desc(schema.files.createdAt)).all();
}

export function getFile(id) {
  const row = db.select().from(schema.files).where(eq(schema.files.id, id)).get();
  if (!row) throw notFound('File not found.');
  return row;
}

export function absolutePath(row) {
  const abs = path.resolve(config.uploadsDir, path.basename(row.storagePath));
  if (!abs.startsWith(path.resolve(config.uploadsDir))) throw badRequest('Invalid storage path.');
  return abs;
}

export function storeUpload({ buffer, originalName, mime, folder = '' }) {
  fs.mkdirSync(config.uploadsDir, { recursive: true });
  const ext = path.extname(originalName).toLowerCase();
  const id = randomId('file');
  const storageName = `${id}${ext}`;
  fs.writeFileSync(path.join(config.uploadsDir, storageName), buffer);
  const now = Date.now();
  const row = {
    id,
    workspaceId: defaultWorkspace().id,
    folder: String(folder || '').replace(/^\/+|\/+$/g, '').slice(0, 120),
    name: originalName,
    originalName,
    mime: mime || 'application/octet-stream',
    size: buffer.length,
    storagePath: storageName,
    kind: kindFor(originalName, mime),
    createdAt: now,
    updatedAt: now,
  };
  db.insert(schema.files).values(row).run();
  log.info('file stored', { id, name: originalName, size: buffer.length });
  return row;
}

export function renameFile(id, name) {
  const row = getFile(id);
  const clean = String(name).replace(/[/\\]/g, '_').slice(0, 180);
  if (!clean) throw badRequest('Invalid file name.');
  db.update(schema.files).set({ name: clean, updatedAt: Date.now() }).where(eq(schema.files.id, id)).run();
  return getFile(id);
}

export function moveFile(id, folder) {
  getFile(id);
  const clean = String(folder || '').replace(/^\/+|\/+$/g, '').slice(0, 120);
  db.update(schema.files).set({ folder: clean, updatedAt: Date.now() }).where(eq(schema.files.id, id)).run();
  return getFile(id);
}

export function deleteFile(id) {
  const row = getFile(id);
  try { fs.rmSync(absolutePath(row), { force: true }); } catch (err) { log.warn('delete failed', { error: err.message }); }
  db.delete(schema.files).where(eq(schema.files.id, id)).run();
}

/** Text-ish preview payload for the UI. Binary types return null content. */
export function preview(row, maxKb = 1024) {
  const abs = absolutePath(row);
  if (!fs.existsSync(abs)) throw notFound('File content missing on disk.');
  const st = fs.statSync(abs);
  const base = { id: row.id, name: row.name, kind: row.kind, mime: row.mime, size: st.size };
  const cap = maxKb * 1024;

  if (['text', 'markdown', 'code', 'html', 'csv', 'json'].includes(row.kind)) {
    const buf = fs.readFileSync(abs).subarray(0, cap);
    const content = buf.toString('utf8');
    if (row.kind === 'csv') {
      const lines = content.split(/\r?\n/).slice(0, 200);
      return { ...base, content, table: lines.filter(Boolean).map((l) => l.split(',')) };
    }
    return { ...base, content, truncated: st.size > cap };
  }
  if (row.kind === 'image' || row.kind === 'pdf') {
    return { ...base, binary: true, streamUrl: `/api/files/${row.id}/content` };
  }
  if (row.kind === 'docx') {
    try {
      const data = new Uint8Array(fs.readFileSync(abs));
      const unzipped = unzipSync(data, { filter: (f) => f.name === 'word/document.xml' });
      const xml = unzipped['word/document.xml'] ? strFromU8(unzipped['word/document.xml']) : '';
      const text = xml
        .replace(/<w:p[ >]/g, '\n<w:p ')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .trim();
      return { ...base, content: text.slice(0, cap), truncated: text.length > cap };
    } catch (err) {
      return { ...base, error: `Could not parse DOCX: ${err.message}` };
    }
  }
  if (row.kind === 'zip') {
    try {
      const data = new Uint8Array(fs.readFileSync(abs).subarray(0, 60_000_000));
      const names = [];
      unzipSync(data, { filter: (f) => { names.push(f.name); return false; } });
      return { ...base, zipEntries: names.slice(0, 300), totalEntries: names.length };
    } catch (err) {
      return { ...base, error: `Could not read ZIP: ${err.message}` };
    }
  }
  return { ...base, binary: true, streamUrl: `/api/files/${row.id}/content` };
}

export function folderStats() {
  const rows = db.select().from(schema.files).all();
  const total = rows.reduce((a, r) => a + r.size, 0);
  return { count: rows.length, totalBytes: total };
}

export { sha256, strToU8, zipSync };
