import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, type AuthRequest } from '../auth.js';

const router = Router();
router.use(requireAuth);
const allowedTools = new Set(['read_files', 'write_files']);
const allowedIcons = new Set(['sparkles', 'code', 'globe', 'gamepad', 'blocks', 'file-search', 'workflow', 'image', 'audio', 'bot', 'pen']);
const allowedModes = new Set(['LOW', 'MEDIO', 'ALTO', 'EXTRA', 'MAX']);
function parseJson(value: string, fallback: any) { try { return JSON.parse(value || JSON.stringify(fallback)); } catch { return fallback; } }
function dto(row: any) {
  return { id: row.id, name: row.name, description: row.description, icon: row.icon, instructions: row.instructions, providerId: row.provider_id, modelId: row.model_id,
    mode: row.mode, tools: parseJson(row.tools_json, []), limits: parseJson(row.limits_json, {}), builtin: Boolean(row.is_builtin), createdAt: row.created_at, updatedAt: row.updated_at };
}
function ownedAgent(userId: string, id: string) {
  const row = db.prepare('SELECT * FROM agents WHERE id=? AND user_id=?').get(id, userId) as any;
  if (!row) throw Object.assign(new Error('Agente no encontrado.'), { status: 404 });
  return row;
}
function validateFields(input: any, current?: any) {
  input = input || {};
  const name = String(input.name ?? current?.name ?? '').trim();
  const description = String(input.description ?? current?.description ?? '').trim();
  const icon = String(input.icon ?? current?.icon ?? 'sparkles');
  const instructions = String(input.instructions ?? current?.instructions ?? '').trim();
  const providerId = input.providerId === undefined ? current?.provider_id || null : (input.providerId ? String(input.providerId) : null);
  const modelId = input.modelId === undefined ? current?.model_id || null : (input.modelId ? String(input.modelId) : null);
  const mode = String(input.mode ?? current?.mode ?? 'MEDIO').toUpperCase();
  const tools = input.tools === undefined ? parseJson(current?.tools_json || '[]', []) : input.tools;
  const limits = input.limits === undefined ? parseJson(current?.limits_json || '{}', {}) : input.limits;
  if (name.length < 2 || name.length > 80) throw Object.assign(new Error('El nombre del agente debe tener entre 2 y 80 caracteres.'), { status: 400 });
  if (description.length > 240) throw Object.assign(new Error('La descripción no puede superar 240 caracteres.'), { status: 400 });
  if (!allowedIcons.has(icon)) throw Object.assign(new Error('Icono no permitido.'), { status: 400 });
  if (instructions.length < 5 || instructions.length > 8000) throw Object.assign(new Error('Las instrucciones deben tener entre 5 y 8 000 caracteres.'), { status: 400 });
  if (!allowedModes.has(mode)) throw Object.assign(new Error('Modo no válido.'), { status: 400 });
  if (!Array.isArray(tools) || tools.some((tool: any) => !allowedTools.has(tool))) throw Object.assign(new Error('Una o más herramientas no están disponibles.'), { status: 400 });
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) throw Object.assign(new Error('Límites no válidos.'), { status: 400 });
  const maxActions = Number(limits.maxActions ?? 8);
  const timeoutSeconds = Number(limits.timeoutSeconds ?? 120);
  if (!Number.isInteger(maxActions) || maxActions < 1 || maxActions > 8 || !Number.isInteger(timeoutSeconds) || timeoutSeconds < 15 || timeoutSeconds > 300) {
    throw Object.assign(new Error('Límites fuera del rango permitido (1–8 acciones, 15–300 segundos).'), { status: 400 });
  }
  const normalizedLimits = { maxActions, timeoutSeconds, fileAccess: Boolean(limits.fileAccess ?? tools.length > 0),
    imageAccess: Boolean(limits.imageAccess), audioAccess: Boolean(limits.audioAccess), memoryEnabled: Boolean(limits.memoryEnabled) };
  return { name, description, icon, instructions, providerId, modelId, mode, tools: [...new Set(tools)], limits: normalizedLimits };
}
function checkBinding(userId: string, providerId: string | null, modelId: string | null) {
  if (modelId && !providerId) throw Object.assign(new Error('Selecciona un proveedor para el modelo.'), { status: 400 });
  if (!providerId) return;
  if (!db.prepare('SELECT 1 FROM providers WHERE id=? AND user_id=?').get(providerId, userId)) throw Object.assign(new Error('El proveedor seleccionado no pertenece a tu cuenta.'), { status: 400 });
  if (modelId && !db.prepare('SELECT 1 FROM provider_models WHERE provider_id=? AND model_id=?').get(providerId, modelId)) throw Object.assign(new Error('El modelo seleccionado no está configurado para ese proveedor.'), { status: 400 });
}

router.get('/', (req: AuthRequest, res) => {
  const rows = db.prepare('SELECT * FROM agents WHERE user_id=? ORDER BY is_builtin DESC,name COLLATE NOCASE').all(req.user!.id) as any[];
  res.json(rows.map(dto));
});
router.post('/', (req: AuthRequest, res, next) => {
  try {
    const value = validateFields(req.body);
    checkBinding(req.user!.id, value.providerId, value.modelId);
    const now = new Date().toISOString(); const id = crypto.randomUUID();
    db.prepare(`INSERT INTO agents(id,user_id,name,description,icon,instructions,provider_id,model_id,mode,tools_json,limits_json,is_builtin,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,0,?,?)`).run(id, req.user!.id, value.name, value.description, value.icon, value.instructions, value.providerId, value.modelId,
      value.mode, JSON.stringify(value.tools), JSON.stringify(value.limits), now, now);
    res.status(201).json(dto(db.prepare('SELECT * FROM agents WHERE id=?').get(id)));
  } catch (error) { next(error); }
});
router.patch('/:agentId', (req: AuthRequest, res, next) => {
  try {
    const current = ownedAgent(req.user!.id, req.params.agentId);
    const value = validateFields(req.body, current);
    checkBinding(req.user!.id, value.providerId, value.modelId);
    const now = new Date().toISOString();
    db.prepare(`UPDATE agents SET name=?,description=?,icon=?,instructions=?,provider_id=?,model_id=?,mode=?,tools_json=?,limits_json=?,updated_at=? WHERE id=?`)
      .run(value.name, value.description, value.icon, value.instructions, value.providerId, value.modelId, value.mode, JSON.stringify(value.tools), JSON.stringify(value.limits), now, current.id);
    res.json(dto(db.prepare('SELECT * FROM agents WHERE id=?').get(current.id)));
  } catch (error) { next(error); }
});
router.post('/:agentId/duplicate', (req: AuthRequest, res, next) => {
  try {
    const source = ownedAgent(req.user!.id, req.params.agentId);
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    const name = `${source.name} (copia)`.slice(0, 80);
    db.prepare(`INSERT INTO agents(id,user_id,name,description,icon,instructions,provider_id,model_id,mode,tools_json,limits_json,is_builtin,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,0,?,?)`).run(id, req.user!.id, name, source.description, source.icon, source.instructions, source.provider_id, source.model_id,
      source.mode, source.tools_json, source.limits_json, now, now);
    res.status(201).json(dto(db.prepare('SELECT * FROM agents WHERE id=?').get(id)));
  } catch (error) { next(error); }
});
router.delete('/:agentId', (req: AuthRequest, res, next) => {
  try {
    ownedAgent(req.user!.id, req.params.agentId);
    if (req.body?.confirm !== true) return res.status(400).json({ error: 'Confirma la eliminación del agente.' });
    db.prepare('DELETE FROM agents WHERE id=? AND user_id=?').run(req.params.agentId, req.user!.id);
    res.json({ ok: true });
  } catch (error) { next(error); }
});
export default router;
