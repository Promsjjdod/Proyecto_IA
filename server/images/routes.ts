import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { UPLOAD_DIR } from '../config.js';
import { requireAuth, type AuthRequest } from '../auth.js';
import { decryptSecret, redactedError } from '../security.js';
import { safeProviderFetch } from '../providers/safety.js';
import type { ProviderRecord } from '../providers/types.js';
import { reserveUsage, releaseUsage, settleUsage, estimateTextUnits } from '../usage.js';

const router = Router();
router.use(requireAuth);
const MAX_USER_IMAGE_BYTES = 250_000_000;
const MAX_IMAGE_RESPONSE_BYTES = 30_000_000;
const pendingImageBytes = new Map<string, number>();
function storedImageBytes(userId: string) {
  const rows = db.prepare('SELECT relative_path FROM images WHERE user_id=?').all(userId) as { relative_path: string }[];
  const root = path.resolve(UPLOAD_DIR, userId, 'images');
  return rows.reduce((total, row) => {
    const absolute = path.resolve(UPLOAD_DIR, userId, row.relative_path);
    if (!absolute.startsWith(`${root}${path.sep}`)) return total;
    try { const stat = fs.statSync(absolute); return total + (stat.isFile() ? stat.size : 0); } catch { return total; }
  }, 0);
}
function reserveImageStorage(userId: string) {
  const reserved = pendingImageBytes.get(userId) || 0;
  if (storedImageBytes(userId) + reserved + MAX_IMAGE_RESPONSE_BYTES > MAX_USER_IMAGE_BYTES) return false;
  pendingImageBytes.set(userId, reserved + MAX_IMAGE_RESPONSE_BYTES);
  return true;
}
function releaseImageStorage(userId: string) {
  const remaining = Math.max(0, (pendingImageBytes.get(userId) || 0) - MAX_IMAGE_RESPONSE_BYTES);
  if (remaining) pendingImageBytes.set(userId, remaining); else pendingImageBytes.delete(userId);
}
function providerRecord(userId: string, id: string) {
  const provider = db.prepare('SELECT * FROM providers WHERE id=? AND user_id=?').get(id, userId) as ProviderRecord | undefined;
  if (!provider) throw Object.assign(new Error('Proveedor de imágenes no encontrado.'), { status: 404 });
  if (!['openai', 'openai-compatible', 'custom'].includes(provider.type)) throw Object.assign(new Error('La generación de imágenes por el endpoint OpenAI Images solo está habilitada para OpenAI y proveedores compatibles. Este proveedor no ofrece un adaptador de imagen implementado.'), { status: 400 });
  if (!provider.secret_encrypted) throw Object.assign(new Error('El proveedor no tiene una clave API configurada.'), { status: 400 });
  decryptSecret(provider.secret_encrypted);
  return provider;
}
function imageDto(row: any) { return { id: row.id, modelId: row.model_id, prompt: row.prompt, mimeType: row.mime_type, createdAt: row.created_at, fileUrl: `/api/images/${row.id}/file` }; }

router.get('/', (req: AuthRequest, res) => {
  const rows = db.prepare('SELECT * FROM images WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(req.user!.id) as any[];
  res.json(rows.map(imageDto));
});
router.post('/generate', async (req: AuthRequest, res, next) => {
  let reservation: ReturnType<typeof reserveUsage> | undefined;
  let storageReserved = false;
  try {
    const prompt = String(req.body?.prompt || '').trim();
    const modelId = String(req.body?.modelId || '').trim();
    const providerId = String(req.body?.providerId || '');
    const size = String(req.body?.size || '1024x1024');
    if (!prompt || prompt.length > 4000) return res.status(400).json({ error: 'Escribe una instrucción de 1 a 4 000 caracteres.' });
    if (!modelId || modelId.length > 120) return res.status(400).json({ error: 'Introduce el identificador real del modelo de imagen.' });
    if (!['1024x1024', '1536x1024', '1024x1536', '1792x1024', '1024x1792'].includes(size)) return res.status(400).json({ error: 'Dimensión no admitida por el adaptador.' });
    if (req.body?.confirmResourceUse !== true) return res.status(400).json({ error: 'Confirma que esta generación puede consumir recursos de la API externa.' });
    const provider = providerRecord(req.user!.id, providerId);
    const apiKey = decryptSecret(provider.secret_encrypted);
    if (!reserveImageStorage(req.user!.id)) return res.status(413).json({ error: 'La cuenta debe liberar espacio antes de generar más imágenes (límite: 250 MB).' });
    storageReserved = true;
    const requestId = String(req.header('idempotency-key') || req.body?.requestId || crypto.randomUUID());
    reservation = reserveUsage(req.user!, requestId, 'image-generation', estimateTextUnits(prompt), 512, { providerId, modelId, size });
    const authConfig = JSON.parse(provider.auth_config_json || '{}') as { headerName?: string; prefix?: string };
    const headerName = authConfig.headerName?.trim() || 'Authorization';
    const prefix = authConfig.prefix ?? 'Bearer ';
    const url = new URL(`${provider.base_url.replace(/\/+$/, '')}/images/generations`);
    const response = await safeProviderFetch(provider, url, { method: 'POST', headers: {
      'Content-Type': 'application/json', Accept: 'application/json', [headerName]: `${prefix}${apiKey}`,
    }, body: JSON.stringify({ model: modelId, prompt, size, n: 1, response_format: 'b64_json' }) });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      let detail = body;
      try { detail = JSON.parse(body)?.error?.message || body; } catch { /* ignore */ }
      const safe = redactedError(detail, apiKey);
      if (response.status === 401) throw new Error('Credenciales rechazadas por el servicio de imágenes.');
      if (response.status === 429) throw new Error('El servicio de imágenes alcanzó su cuota o límite de solicitudes.');
      throw new Error(`El servicio de imágenes respondió HTTP ${response.status}: ${safe.slice(0, 350)}`);
    }
    const result = await response.json() as any;
    const base64 = result.data?.[0]?.b64_json;
    if (typeof base64 !== 'string' || base64.length > 40_000_000) {
      throw new Error('El proveedor no devolvió una imagen base64 dentro del límite. Este adaptador no descarga URLs externas de imagen por seguridad.');
    }
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length < 8 || bytes.length > MAX_IMAGE_RESPONSE_BYTES || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('La respuesta no era una imagen PNG válida.');
    const id = crypto.randomUUID();
    const userDir = path.join(UPLOAD_DIR, req.user!.id, 'images');
    fs.mkdirSync(userDir, { recursive: true, mode: 0o700 });
    const filePath = path.join(userDir, `${id}.png`);
    fs.writeFileSync(filePath, bytes, { mode: 0o600, flag: 'wx' });
    const relativePath = `images/${id}.png`;
    const now = new Date().toISOString();
    db.prepare('INSERT INTO images(id,user_id,provider_id,model_id,prompt,relative_path,mime_type,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id, req.user!.id, providerId, modelId, prompt, relativePath, 'image/png', now);
    const charged = estimateTextUnits(prompt) + 512;
    settleUsage(req.user!.id, reservation, charged, { providerId, modelId, size, estimated: true });
    res.status(201).json({ ...imageDto({ id, model_id: modelId, prompt, mime_type: 'image/png', created_at: now }), size: bytes.length });
  } catch (error) {
    if (reservation) releaseUsage(req.user!.id, reservation, 'failed', { error: error instanceof Error ? error.message : 'Error desconocido' });
    next(error);
  } finally {
    if (storageReserved) releaseImageStorage(req.user!.id);
  }
});
router.get('/:imageId/file', (req: AuthRequest, res, next) => {
  try {
    const image = db.prepare('SELECT * FROM images WHERE id=? AND user_id=?').get(req.params.imageId, req.user!.id) as any;
    if (!image) return res.status(404).json({ error: 'Imagen no encontrada.' });
    const absolute = path.join(UPLOAD_DIR, req.user!.id, image.relative_path);
    if (!fs.existsSync(absolute)) return res.status(404).json({ error: 'El archivo de imagen no está disponible.' });
    res.setHeader('Content-Type', image.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${image.id}.png"`);
    res.setHeader('Cache-Control', 'private, no-store');
    fs.createReadStream(absolute).pipe(res);
  } catch (error) { next(error); }
});
router.delete('/:imageId', (req: AuthRequest, res) => {
  const image = db.prepare('SELECT * FROM images WHERE id=? AND user_id=?').get(req.params.imageId, req.user!.id) as any;
  if (!image) return res.status(404).json({ error: 'Imagen no encontrada.' });
  fs.rmSync(path.join(UPLOAD_DIR, req.user!.id, image.relative_path), { force: true });
  db.prepare('DELETE FROM images WHERE id=? AND user_id=?').run(image.id, req.user!.id);
  res.json({ ok: true });
});
export default router;
