import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config/env.js';
import { parse, idSchema, z, safeFileName } from '../core/validate.js';
import { badRequest } from '../core/errors.js';
import * as files from '../services/file.service.js';
import { getSettings } from '../services/settings.service.js';

export const fileRoutes = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024, files: 10 },
});

fileRoutes.get('/workspaces', (_req, res) => {
  res.json({ workspaces: files.listWorkspaces() });
});

fileRoutes.get('/files', (req, res) => {
  res.json({
    files: files.listFiles({
      workspaceId: req.query.workspaceId ? String(req.query.workspaceId) : undefined,
      folder: req.query.folder === undefined ? undefined : String(req.query.folder),
      query: req.query.q ? String(req.query.q) : undefined,
    }),
    stats: files.folderStats(),
    maxUploadMb: getSettings().files.maxUploadMb,
  });
});

fileRoutes.post('/files/upload', upload.array('files', 10), (req, res) => {
  const maxMb = getSettings().files.maxUploadMb || 25;
  const folder = typeof req.body?.folder === 'string' ? req.body.folder : '';
  const stored = [];
  for (const file of req.files || []) {
    if (file.size > maxMb * 1024 * 1024) throw badRequest(`"${file.originalname}" exceeds the ${maxMb} MB upload limit.`);
    stored.push(files.storeUpload({
      buffer: file.buffer,
      originalName: safeFileName(file.originalname),
      mime: file.mimetype,
      folder,
    }));
  }
  if (!stored.length) throw badRequest('No files received.');
  res.status(201).json({ files: stored });
});

fileRoutes.get('/files/:id', (req, res) => {
  const id = parse(idSchema, req.params.id, 'file id');
  const row = files.getFile(id);
  res.json({ file: row, preview: files.preview(row, getSettings().files.previewMaxKb) });
});

fileRoutes.get('/files/:id/content', (req, res) => {
  const id = parse(idSchema, req.params.id, 'file id');
  const row = files.getFile(id);
  const abs = files.absolutePath(row);
  if (!fs.existsSync(abs)) throw badRequest('File content missing on disk.');
  res.setHeader('Content-Type', row.mime);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row.name)}"`);
  fs.createReadStream(abs).pipe(res);
});

fileRoutes.get('/files/:id/download', (req, res) => {
  const id = parse(idSchema, req.params.id, 'file id');
  const row = files.getFile(id);
  const abs = files.absolutePath(row);
  res.setHeader('Content-Type', row.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(row.name)}"`);
  fs.createReadStream(abs).pipe(res);
});

fileRoutes.patch('/files/:id', (req, res) => {
  const id = parse(idSchema, req.params.id, 'file id');
  const body = parse(z.object({ name: z.string().max(180).optional(), folder: z.string().max(120).optional() }), req.body, 'file');
  let row = files.getFile(id);
  if (body.name !== undefined) row = files.renameFile(id, body.name);
  if (body.folder !== undefined) row = files.moveFile(id, body.folder);
  res.json({ file: row });
});

fileRoutes.delete('/files/:id', (req, res) => {
  const id = parse(idSchema, req.params.id, 'file id');
  files.deleteFile(id);
  res.json({ ok: true });
});

/** Browse the repository workspace tree (read-only, for the Files page). */
fileRoutes.get('/workspace-tree', (req, res) => {
  const requested = String(req.query.path || '');
  const root = config.workspaceRoot;
  const clean = requested.replace(/\\/g, '/').replace(/^\/+/, '');
  const abs = path.resolve(root, clean);
  if (!abs.startsWith(root)) throw badRequest('Path escapes the workspace root.');
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw badRequest('Not a directory.');
  const entries = fs.readdirSync(abs, { withFileTypes: true })
    .filter((e) => !['node_modules', '.git', '.arena'].includes(e.name))
    .map((e) => ({
      name: e.name,
      type: e.isDirectory() ? 'dir' : 'file',
      path: clean ? `${clean}/${e.name}` : e.name,
      size: e.isFile() ? fs.statSync(path.join(abs, e.name)).size : undefined,
    }))
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  res.json({ path: clean, entries: entries.slice(0, 500) });
});
