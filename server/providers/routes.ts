import { Router } from 'express';
import { db } from '../db.js';
import { encryptSecret, decryptSecret } from '../security.js';
import { ALLOWED_PROVIDER_TYPES, DEFAULT_PROVIDER_URLS } from '../config.js';
import { requireAuth, type AuthRequest } from '../auth.js';
import { validateProviderBase } from './safety.js';
import { discoverModels, testProvider, type ModelSummary } from './index.js';
import type { ProviderRecord } from './types.js';

const router = Router();
router.use(requireAuth);
const providerKinds = new Set(['openai', 'anthropic', 'google', 'deepseek', 'ollama', 'openai-compatible', 'custom']);
function currentAllowedProviderTypes() {
  const row = db.prepare("SELECT value_json FROM app_settings WHERE key='allowed_provider_types'").get() as { value_json: string } | undefined;
  if (!row) return ALLOWED_PROVIDER_TYPES;
  try { return JSON.parse(row.value_json) as string[]; } catch { return ALLOWED_PROVIDER_TYPES; }
}

function parseProvider(row: any) {
  return { id: row.id, type: row.type, name: row.name, baseUrl: row.base_url, hasKey: Boolean(row.secret_encrypted),
    status: row.status, lastCheckedAt: row.last_checked_at, createdAt: row.created_at, updatedAt: row.updated_at };
}
function ownedProvider(userId: string, providerId: string): ProviderRecord {
  const row = db.prepare('SELECT * FROM providers WHERE id=? AND user_id=?').get(providerId, userId) as ProviderRecord | undefined;
  if (!row) throw Object.assign(new Error('Proveedor no encontrado.'), { status: 404 });
  return row;
}
function modelDto(row: any) {
  let capabilities = {};
  try { capabilities = JSON.parse(row.capabilities_json || '{}'); } catch { /* ignore */ }
  return { id: row.model_id, displayName: row.display_name, source: row.source, status: row.status, favorite: Boolean(row.favorite),
    capabilities, contextTokens: row.context_tokens ?? null };
}
function validateProviderName(name: string) {
  if (name.length < 2 || name.length > 80) throw Object.assign(new Error('El nombre del proveedor debe tener entre 2 y 80 caracteres.'), { status: 400 });
}
function sanitizeAuthConfig(input: any) {
  const headerName = String(input?.headerName || 'Authorization').trim();
  const prefix = String(input?.prefix ?? 'Bearer ').slice(0, 50);
  if (!/^[A-Za-z][A-Za-z0-9-]{0,39}$/.test(headerName) || ['cookie', 'host', 'content-length', 'set-cookie'].includes(headerName.toLowerCase())) {
    throw Object.assign(new Error('Nombre de cabecera de autenticación no válido.'), { status: 400 });
  }
  return { headerName, prefix };
}

router.get('/', (req: AuthRequest, res) => {
  const rows = db.prepare('SELECT * FROM providers WHERE user_id=? ORDER BY name').all(req.user!.id) as any[];
  const models = db.prepare('SELECT provider_id,COUNT(*) count FROM provider_models GROUP BY provider_id').all() as { provider_id: string; count: number }[];
  const modelCount = new Map(models.map((m) => [m.provider_id, m.count]));
  res.json(rows.map((row) => ({ ...parseProvider(row), modelCount: modelCount.get(row.id) || 0 })));
});

router.post('/', async (req: AuthRequest, res, next) => {
  try {
    const type = String(req.body?.type || '').trim();
    if (!providerKinds.has(type) || !currentAllowedProviderTypes().includes(type)) return res.status(400).json({ error: 'Tipo de proveedor no permitido.' });
    const name = String(req.body?.name || '').trim();
    validateProviderName(name);
    const baseUrl = String(req.body?.baseUrl || DEFAULT_PROVIDER_URLS[type] || '').trim().replace(/\/+$/, '');
    if (!baseUrl) return res.status(400).json({ error: 'Configura una URL base para este proveedor.' });
    const apiKey = String(req.body?.apiKey || '').trim();
    if (type !== 'ollama' && !apiKey) return res.status(400).json({ error: 'Introduce la clave API. Ollama puede funcionar sin clave si tu servidor está protegido por red.' });
    if (apiKey.length > 4096) return res.status(400).json({ error: 'La clave es demasiado larga.' });
    const authConfig = type === 'custom' || type === 'openai-compatible' ? sanitizeAuthConfig(req.body?.authConfig) : {};
    const candidate = { type, base_url: baseUrl };
    await validateProviderBase(candidate);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO providers(id,user_id,type,name,base_url,secret_encrypted,auth_config_json,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,'not-tested',?,?)`).run(id, req.user!.id, type, name, baseUrl, encryptSecret(apiKey), JSON.stringify(authConfig), now, now);
    res.status(201).json(parseProvider(db.prepare('SELECT * FROM providers WHERE id=?').get(id)));
  } catch (error) { next(error); }
});

router.patch('/:providerId', async (req: AuthRequest, res, next) => {
  try {
    const provider = ownedProvider(req.user!.id, req.params.providerId);
    const name = req.body?.name === undefined ? provider.name : String(req.body.name).trim();
    const baseUrl = req.body?.baseUrl === undefined ? provider.base_url : String(req.body.baseUrl).trim().replace(/\/+$/, '');
    validateProviderName(name);
    await validateProviderBase({ type: provider.type, base_url: baseUrl });
    const key = req.body?.apiKey ? encryptSecret(String(req.body.apiKey).trim()) : provider.secret_encrypted;
    if (req.body?.apiKey && String(req.body.apiKey).length > 4096) return res.status(400).json({ error: 'La clave es demasiado larga.' });
    const authConfig = req.body?.authConfig ? sanitizeAuthConfig(req.body.authConfig) : JSON.parse(provider.auth_config_json || '{}');
    const now = new Date().toISOString();
    db.prepare(`UPDATE providers SET name=?,base_url=?,secret_encrypted=?,auth_config_json=?,status='not-tested',updated_at=? WHERE id=?`).run(name, baseUrl, key, JSON.stringify(authConfig), now, provider.id);
    res.json(parseProvider(db.prepare('SELECT * FROM providers WHERE id=?').get(provider.id)));
  } catch (error) { next(error); }
});

router.delete('/:providerId', (req: AuthRequest, res, next) => {
  try {
    const provider = ownedProvider(req.user!.id, req.params.providerId);
    db.prepare('DELETE FROM providers WHERE id=? AND user_id=?').run(provider.id, req.user!.id);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.post('/:providerId/test', async (req: AuthRequest, res, next) => {
  try {
    const provider = ownedProvider(req.user!.id, req.params.providerId);
    const result = await testProvider(provider);
    const now = new Date().toISOString();
    db.prepare(`UPDATE providers SET status='connected',last_checked_at=?,updated_at=? WHERE id=?`).run(now, now, provider.id);
    res.json({ ok: true, ...result, checkedAt: now });
  } catch (error) {
    const provider = db.prepare('SELECT id FROM providers WHERE id=? AND user_id=?').get(req.params.providerId, req.user!.id) as { id: string } | undefined;
    if (provider) db.prepare(`UPDATE providers SET status='error',last_checked_at=?,updated_at=? WHERE id=?`).run(new Date().toISOString(), new Date().toISOString(), provider.id);
    next(error);
  }
});

router.get('/:providerId/models', (req: AuthRequest, res, next) => {
  try {
    const provider = ownedProvider(req.user!.id, req.params.providerId);
    const rows = db.prepare('SELECT * FROM provider_models WHERE provider_id=? ORDER BY favorite DESC,display_name COLLATE NOCASE').all(provider.id) as any[];
    res.json(rows.map(modelDto));
  } catch (error) { next(error); }
});

router.post('/:providerId/models/sync', async (req: AuthRequest, res, next) => {
  try {
    const provider = ownedProvider(req.user!.id, req.params.providerId);
    const list = await discoverModels(provider);
    if (list.length > 1000) throw Object.assign(new Error('El proveedor devolvió demasiados modelos; se limitó la sincronización.'), { status: 502 });
    const now = new Date().toISOString();
    const upsert = db.prepare(`INSERT INTO provider_models(id,provider_id,model_id,display_name,source,status,context_tokens,created_at,updated_at)
      VALUES(?,?,?,?,?,'available',?,?,?) ON CONFLICT(provider_id,model_id) DO UPDATE SET display_name=excluded.display_name,status='available',
      context_tokens=COALESCE(excluded.context_tokens,provider_models.context_tokens),source='detected',updated_at=excluded.updated_at`);
    const transaction = db.transaction((models: ModelSummary[]) => {
      const found = new Set(models.map((m) => m.id));
      for (const model of models) upsert.run(crypto.randomUUID(), provider.id, model.id, model.displayName, 'detected', model.contextTokens ?? null, now, now);
      const existing = db.prepare(`SELECT model_id FROM provider_models WHERE provider_id=? AND source='detected'`).all(provider.id) as { model_id: string }[];
      const mark = db.prepare(`UPDATE provider_models SET status='unavailable',updated_at=? WHERE provider_id=? AND model_id=? AND source='detected'`);
      for (const row of existing) if (!found.has(row.model_id)) mark.run(now, provider.id, row.model_id);
      db.prepare(`UPDATE providers SET status='connected',last_checked_at=?,updated_at=? WHERE id=?`).run(now, now, provider.id);
    });
    transaction(list);
    const rows = db.prepare('SELECT * FROM provider_models WHERE provider_id=? ORDER BY favorite DESC,display_name COLLATE NOCASE').all(provider.id) as any[];
    res.json({ detected: list.length, models: rows.map(modelDto), syncedAt: now });
  } catch (error) { next(error); }
});

router.post('/:providerId/models', (req: AuthRequest, res, next) => {
  try {
    const provider = ownedProvider(req.user!.id, req.params.providerId);
    const modelId = String(req.body?.modelId || '').trim();
    const displayName = String(req.body?.displayName || modelId).trim();
    if (!modelId || modelId.length > 200 || /[\0\r\n]/.test(modelId)) return res.status(400).json({ error: 'Identificador de modelo no válido.' });
    if (displayName.length > 200) return res.status(400).json({ error: 'Nombre demasiado largo.' });
    const contextTokens = req.body?.contextTokens === undefined || req.body?.contextTokens === '' ? null : Number(req.body.contextTokens);
    if (contextTokens !== null && (!Number.isInteger(contextTokens) || contextTokens < 256 || contextTokens > 2_000_000)) return res.status(400).json({ error: 'Límite de contexto no válido.' });
    const now = new Date().toISOString();
    const result = db.prepare(`INSERT INTO provider_models(id,provider_id,model_id,display_name,source,status,capabilities_json,context_tokens,created_at,updated_at)
      VALUES(?,?,?,?,?,'unknown','{}',?,?,?) ON CONFLICT(provider_id,model_id) DO UPDATE SET display_name=excluded.display_name,source='manual',status='unknown',context_tokens=excluded.context_tokens,updated_at=excluded.updated_at`)
      .run(crypto.randomUUID(), provider.id, modelId, displayName || modelId, 'manual', contextTokens, now, now);
    const row = db.prepare('SELECT * FROM provider_models WHERE provider_id=? AND model_id=?').get(provider.id, modelId);
    res.status(201).json(modelDto(row));
  } catch (error) { next(error); }
});

router.patch('/:providerId/models/:modelId', (req: AuthRequest, res, next) => {
  try {
    const provider = ownedProvider(req.user!.id, req.params.providerId);
    const model = db.prepare('SELECT * FROM provider_models WHERE provider_id=? AND model_id=?').get(provider.id, req.params.modelId) as any;
    if (!model) return res.status(404).json({ error: 'Modelo no encontrado.' });
    let capabilities: Record<string, boolean> = {};
    try { capabilities = JSON.parse(model.capabilities_json || '{}'); } catch { /* no-op */ }
    if (req.body?.capabilities !== undefined) {
      const allowed = ['vision', 'tools', 'imageGeneration', 'audioInput', 'audioOutput'];
      const next = req.body.capabilities;
      if (!next || typeof next !== 'object' || Array.isArray(next)) return res.status(400).json({ error: 'Capacidades no válidas.' });
      for (const [key, value] of Object.entries(next)) {
        if (!allowed.includes(key) || typeof value !== 'boolean') return res.status(400).json({ error: 'Capacidad no válida.' });
        capabilities[key] = value;
      }
    }
    const favorite = req.body?.favorite === undefined ? model.favorite : Boolean(req.body.favorite);
    const now = new Date().toISOString();
    db.prepare('UPDATE provider_models SET favorite=?,capabilities_json=?,updated_at=? WHERE id=?').run(favorite ? 1 : 0, JSON.stringify(capabilities), now, model.id);
    res.json(modelDto(db.prepare('SELECT * FROM provider_models WHERE id=?').get(model.id)));
  } catch (error) { next(error); }
});

router.delete('/:providerId/models/:modelId', (req: AuthRequest, res, next) => {
  try {
    const provider = ownedProvider(req.user!.id, req.params.providerId);
    db.prepare('DELETE FROM provider_models WHERE provider_id=? AND model_id=?').run(provider.id, req.params.modelId);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

export default router;
