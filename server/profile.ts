import { Router } from 'express';
import { db } from './db.js';
import { requireAuth, type AuthRequest } from './auth.js';
import { MODE_POLICIES } from './config.js';

const router = Router();
router.use(requireAuth);
const modes = new Set(Object.keys(MODE_POLICIES));
router.patch('/account', (req: AuthRequest, res) => {
  const name = String(req.body?.name || '').trim();
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'El nombre debe tener entre 2 y 80 caracteres.' });
  db.prepare('UPDATE users SET name=? WHERE id=?').run(name, req.user!.id);
  res.json({ name });
});
router.patch('/preferences', (req: AuthRequest, res) => {
  const user = req.user!;
  let preferences: Record<string, any> = {};
  try { preferences = JSON.parse(user.preferences_json || '{}'); } catch { /* reset corrupt preference */ }
  const patch = req.body?.preferences;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return res.status(400).json({ error: 'Preferencias no válidas.' });
  if (patch.theme !== undefined) {
    if (!['dark', 'light', 'system'].includes(patch.theme)) return res.status(400).json({ error: 'Tema no válido.' });
    preferences.theme = patch.theme;
  }
  if (patch.defaultMode !== undefined) {
    const mode = String(patch.defaultMode).toUpperCase();
    if (!modes.has(mode)) return res.status(400).json({ error: 'Modo predeterminado no válido.' });
    preferences.defaultMode = mode;
  }
  if (patch.defaultProviderId !== undefined) {
    const id = patch.defaultProviderId ? String(patch.defaultProviderId) : null;
    if (id && !db.prepare('SELECT 1 FROM providers WHERE id=? AND user_id=?').get(id, user.id)) return res.status(400).json({ error: 'Proveedor predeterminado no disponible.' });
    preferences.defaultProviderId = id;
  }
  if (patch.defaultModelId !== undefined) {
    const model = patch.defaultModelId ? String(patch.defaultModelId) : null;
    if (model && (!preferences.defaultProviderId || !db.prepare('SELECT 1 FROM provider_models WHERE provider_id=? AND model_id=?').get(preferences.defaultProviderId, model))) return res.status(400).json({ error: 'Modelo predeterminado no disponible para el proveedor seleccionado.' });
    preferences.defaultModelId = model;
  }
  if (patch.voiceLanguage !== undefined) {
    const language = String(patch.voiceLanguage);
    if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(language)) return res.status(400).json({ error: 'Idioma de voz no válido.' });
    preferences.voiceLanguage = language;
  }
  if (patch.voiceEnabled !== undefined) preferences.voiceEnabled = Boolean(patch.voiceEnabled);
  if (patch.preferredMaxProviderId !== undefined) {
    const providerId = patch.preferredMaxProviderId ? String(patch.preferredMaxProviderId) : null;
    if (providerId && !db.prepare('SELECT 1 FROM providers WHERE id=? AND user_id=?').get(providerId, user.id)) return res.status(400).json({ error: 'El proveedor MAX preferido no pertenece a esta cuenta.' });
    preferences.preferredMaxProviderId = providerId;
  }
  if (patch.preferredMaxModelId !== undefined) {
    const model = patch.preferredMaxModelId ? String(patch.preferredMaxModelId) : null;
    if (model && (!preferences.preferredMaxProviderId || !db.prepare('SELECT 1 FROM provider_models WHERE provider_id=? AND model_id=?').get(preferences.preferredMaxProviderId, model))) return res.status(400).json({ error: 'El modelo MAX preferido no pertenece al proveedor seleccionado.' });
    preferences.preferredMaxModelId = model;
  }
  db.prepare('UPDATE users SET preferences_json=? WHERE id=?').run(JSON.stringify(preferences), user.id);
  res.json({ preferences });
});
router.get('/credits', (req: AuthRequest, res) => {
  const user = req.user!;
  const row = db.prepare(`SELECT COALESCE(SUM(CASE WHEN status='complete' THEN credits ELSE 0 END),0) spent FROM usage WHERE user_id=?`).get(user.id) as { spent: number };
  res.json({ plan: 'FREE', credits: user.credits, dailyLimit: user.daily_limit, monthlyLimit: user.monthly_limit, role: user.role, lifetimeInternalUnits: row.spent, administrator: user.role === 'admin', plans: [
    { name: 'FREE', status: 'current', billing: null }, { name: 'PRO', status: 'coming-soon', billing: null }, { name: 'MAX', status: 'coming-soon', billing: null },
  ] });
});
export default router;
