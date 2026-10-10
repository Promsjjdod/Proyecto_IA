import { Router } from 'express';
import { db } from './db.js';
import { requireAdmin, requireAuth, type AuthRequest } from './auth.js';
import { ALLOWED_PROVIDER_TYPES } from './config.js';

const router = Router();
router.use(requireAuth, requireAdmin);
const knownTypes = new Set(['openai', 'anthropic', 'google', 'deepseek', 'ollama', 'openai-compatible', 'custom']);
function setting(key: string, fallback: unknown) {
  const row = db.prepare('SELECT value_json FROM app_settings WHERE key=?').get(key) as { value_json: string } | undefined;
  if (!row) return fallback;
  try { return JSON.parse(row.value_json); } catch { return fallback; }
}
function audit(actorId: string, action: string, targetId: string | null, details: Record<string, unknown>) {
  db.prepare('INSERT INTO audit_log(id,actor_user_id,action,target_user_id,details_json,created_at) VALUES(?,?,?,?,?,?)')
    .run(crypto.randomUUID(), actorId, action, targetId, JSON.stringify(details), new Date().toISOString());
}
router.get('/dashboard', (_req: AuthRequest, res) => {
  const counts = db.prepare(`SELECT COUNT(*) users, SUM(CASE WHEN role='admin' THEN 1 ELSE 0 END) admins FROM users`).get() as any;
  const usage = db.prepare(`SELECT COUNT(*) operations,SUM(CASE WHEN status='complete' THEN credits ELSE 0 END) spent,SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed FROM usage`).get() as any;
  const projects = db.prepare('SELECT COUNT(*) count FROM projects').get() as { count: number };
  const workflows = db.prepare('SELECT COUNT(*) count FROM workflows').get() as { count: number };
  const errors = db.prepare(`SELECT id,actor_user_id,action,target_user_id,details_json,created_at FROM audit_log ORDER BY created_at DESC LIMIT 50`).all() as any[];
  res.json({ users: Number(counts.users || 0), admins: Number(counts.admins || 0), operations: Number(usage.operations || 0), internalCreditsSpent: Number(usage.spent || 0), failedOperations: Number(usage.failed || 0), projects: projects.count, workflows: workflows.count,
    allowedProviderTypes: setting('allowed_provider_types', ALLOWED_PROVIDER_TYPES), audit: errors.map((e) => ({ id: e.id, actorUserId: e.actor_user_id, action: e.action, targetUserId: e.target_user_id, details: JSON.parse(e.details_json || '{}'), createdAt: e.created_at })) });
});
router.get('/users', (_req: AuthRequest, res) => {
  const rows = db.prepare(`SELECT u.id,u.email,u.name,u.role,u.credits,u.daily_limit,u.monthly_limit,u.created_at,
    (SELECT COUNT(*) FROM usage x WHERE x.user_id=u.id) operations,
    (SELECT COALESCE(SUM(credits),0) FROM usage x WHERE x.user_id=u.id AND x.status='complete') spent
    FROM users u ORDER BY u.created_at DESC LIMIT 500`).all() as any[];
  res.json(rows.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, credits: u.credits, dailyLimit: u.daily_limit, monthlyLimit: u.monthly_limit,
    operations: u.operations, creditsSpent: u.spent, createdAt: u.created_at })));
});
router.patch('/users/:userId', (req: AuthRequest, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.userId) as any;
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const current = req.user!;
  const dailyLimit = req.body?.dailyLimit === undefined ? target.daily_limit : Number(req.body.dailyLimit);
  const monthlyLimit = req.body?.monthlyLimit === undefined ? target.monthly_limit : Number(req.body.monthlyLimit);
  const credits = req.body?.credits === undefined ? target.credits : Number(req.body.credits);
  const role = req.body?.role === undefined ? target.role : String(req.body.role);
  if (![dailyLimit, monthlyLimit, credits].every((v) => Number.isSafeInteger(v) && v >= 0 && v <= 10_000_000)) return res.status(400).json({ error: 'Los límites y créditos deben ser enteros entre 0 y 10 000 000.' });
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Rol no válido.' });
  if (target.id === current.id && role !== 'admin') return res.status(400).json({ error: 'No puedes quitarte el rol de administrador desde esta sesión.' });
  db.prepare('UPDATE users SET role=?,credits=?,daily_limit=?,monthly_limit=? WHERE id=?').run(role, credits, dailyLimit, monthlyLimit, target.id);
  audit(current.id, 'user.updated', target.id, { role, credits, dailyLimit, monthlyLimit });
  res.json({ id: target.id, email: target.email, name: target.name, role, credits, dailyLimit, monthlyLimit });
});
router.get('/settings', (_req: AuthRequest, res) => {
  res.json({ allowedProviderTypes: setting('allowed_provider_types', ALLOWED_PROVIDER_TYPES), defaultDailyLimit: setting('default_daily_limit', 5000), defaultMonthlyLimit: setting('default_monthly_limit', 50000) });
});
router.patch('/settings', (req: AuthRequest, res) => {
  const current = req.user!;
  const currentTypes = setting('allowed_provider_types', ALLOWED_PROVIDER_TYPES) as string[];
  const types = req.body?.allowedProviderTypes === undefined ? currentTypes : req.body.allowedProviderTypes;
  if (!Array.isArray(types) || types.some((value) => typeof value !== 'string' || !knownTypes.has(value))) return res.status(400).json({ error: 'Lista de proveedores no válida.' });
  const daily = req.body?.defaultDailyLimit === undefined ? setting('default_daily_limit', 5000) : Number(req.body.defaultDailyLimit);
  const monthly = req.body?.defaultMonthlyLimit === undefined ? setting('default_monthly_limit', 50000) : Number(req.body.defaultMonthlyLimit);
  if (![daily, monthly].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 10_000_000)) return res.status(400).json({ error: 'Límites predeterminados no válidos.' });
  const now = new Date().toISOString();
  const put = db.prepare('INSERT INTO app_settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at');
  put.run('allowed_provider_types', JSON.stringify([...new Set(types)]), now);
  put.run('default_daily_limit', JSON.stringify(daily), now);
  put.run('default_monthly_limit', JSON.stringify(monthly), now);
  audit(current.id, 'settings.updated', null, { allowedProviderTypes: types, defaultDailyLimit: daily, defaultMonthlyLimit: monthly });
  res.json({ allowedProviderTypes: [...new Set(types)], defaultDailyLimit: daily, defaultMonthlyLimit: monthly });
});
router.get('/usage', (_req: AuthRequest, res) => {
  const rows = db.prepare(`SELECT u.id,u.user_id,u.operation,u.credits,u.reserved,u.status,u.meta_json,u.created_at,users.email FROM usage u JOIN users ON users.id=u.user_id ORDER BY u.created_at DESC LIMIT 200`).all() as any[];
  res.json(rows.map((row) => ({ id: row.id, userId: row.user_id, email: row.email, operation: row.operation, credits: row.credits, reserved: row.reserved, status: row.status, meta: JSON.parse(row.meta_json || '{}'), createdAt: row.created_at })));
});
export default router;
