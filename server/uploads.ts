import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { UPLOAD_DIR } from './config.js';
import { requireAuth, type AuthRequest } from './auth.js';

const router = Router();
router.use(requireAuth);
const uploader = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const allowed = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/javascript', 'text/javascript', 'text/css', 'application/xml', 'text/xml']);
    if (!allowed.has(file.mimetype)) return callback(new Error('Formato no admitido. Adjunta PNG, JPG, WebP, GIF o archivos de texto/código.'));
    callback(null, true);
  },
});
const MAX_TEXT_BYTES = 1_000_000;
const MAX_USER_ATTACHMENT_BYTES = 100_000_000;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const TEXT_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/javascript', 'text/javascript', 'text/css', 'application/xml', 'text/xml']);

router.post('/', (req: AuthRequest, res, next) => {
  uploader.single('file')(req, res, (error) => {
    if (error) return res.status(400).json({ error: error.message || 'No se pudo cargar el archivo.' });
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ error: 'Selecciona un archivo.' });
      if (TEXT_TYPES.has(file.mimetype) && file.size > MAX_TEXT_BYTES) return res.status(413).json({ error: 'Los archivos de texto adjuntos están limitados a 1 MB.' });
      if (!IMAGE_TYPES.has(file.mimetype) && !TEXT_TYPES.has(file.mimetype)) return res.status(415).json({ error: 'Tipo de archivo no admitido.' });
      const storedBytes = (db.prepare('SELECT COALESCE(SUM(size),0) AS total FROM attachments WHERE user_id=?').get(req.user!.id) as { total: number }).total;
      if (storedBytes + file.size > MAX_USER_ATTACHMENT_BYTES) return res.status(413).json({ error: 'La cuenta alcanzó el límite de 100 MB para adjuntos almacenados.' });
      const id = crypto.randomUUID();
      const userDir = path.join(UPLOAD_DIR, req.user!.id, 'attachments');
      fs.mkdirSync(userDir, { recursive: true, mode: 0o700 });
      const diskPath = path.join(userDir, `${id}.bin`);
      fs.writeFileSync(diskPath, file.buffer, { mode: 0o600, flag: 'wx' });
      const name = path.basename(file.originalname).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180) || 'adjunto';
      db.prepare('INSERT INTO attachments(id,user_id,original_name,mime_type,size,disk_path,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(id, req.user!.id, name, file.mimetype, file.size, diskPath, new Date().toISOString());
      res.status(201).json({ id, name, mimeType: file.mimetype, size: file.size, isImage: IMAGE_TYPES.has(file.mimetype) });
    } catch (e) { next(e); }
  });
});

router.get('/:attachmentId', (req: AuthRequest, res, next) => {
  try {
    const row = db.prepare('SELECT * FROM attachments WHERE id=? AND user_id=?').get(req.params.attachmentId, req.user!.id) as any;
    if (!row || !fs.existsSync(row.disk_path)) return res.status(404).json({ error: 'Adjunto no encontrado.' });
    res.setHeader('Content-Type', row.mime_type);
    res.setHeader('Content-Length', row.size);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `inline; filename="${String(row.original_name).replace(/["\\\r\n]/g, '_')}"`);
    fs.createReadStream(row.disk_path).pipe(res);
  } catch (error) { next(error); }
});

router.delete('/:attachmentId', (req: AuthRequest, res, next) => {
  try {
    const row = db.prepare('SELECT * FROM attachments WHERE id=? AND user_id=?').get(req.params.attachmentId, req.user!.id) as any;
    if (row) {
      fs.rmSync(row.disk_path, { force: true });
      db.prepare('DELETE FROM attachments WHERE id=? AND user_id=?').run(row.id, req.user!.id);
    }
    res.json({ ok: true });
  } catch (error) { next(error); }
});

export function cleanupUnreferencedAttachments(userId?: string, candidates?: string[]) {
  if (candidates && candidates.length === 0) return 0;
  const rows = userId
    ? candidates
      ? db.prepare(`SELECT id,user_id FROM attachments WHERE user_id=? AND id IN (${candidates.map(() => '?').join(',')})`).all(userId, ...candidates) as { id: string; user_id: string }[]
      : db.prepare('SELECT id,user_id FROM attachments WHERE user_id=?').all(userId) as { id: string; user_id: string }[]
    : db.prepare('SELECT id,user_id FROM attachments').all() as { id: string; user_id: string }[];
  const messages = userId
    ? db.prepare('SELECT attachments_json FROM messages WHERE user_id=?').all(userId)
    : db.prepare('SELECT user_id,attachments_json FROM messages').all();
  const referenced = new Set<string>();
  for (const row of messages as any[]) {
    let attachments: any[] = [];
    try { attachments = JSON.parse(row.attachments_json || '[]'); } catch { /* corrupt old metadata does not keep orphan files indefinitely */ }
    for (const attachment of attachments) if (typeof attachment?.id === 'string') referenced.add(`${row.user_id || userId}:${attachment.id}`);
  }
  let removed = 0;
  for (const row of rows) {
    if (referenced.has(`${row.user_id}:${row.id}`)) continue;
    const safePath = path.join(UPLOAD_DIR, row.user_id, 'attachments', `${row.id}.bin`);
    fs.rmSync(safePath, { force: true });
    db.prepare('DELETE FROM attachments WHERE id=? AND user_id=?').run(row.id, row.user_id);
    removed += 1;
  }
  return removed;
}

export default router;
export { IMAGE_TYPES, TEXT_TYPES };
