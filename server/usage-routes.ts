import { Router } from 'express';
import { db } from './db.js';
import { requireAuth, type AuthRequest } from './auth.js';

const router = Router();
router.use(requireAuth);
function safeParse(value: string) { try { return JSON.parse(value || '{}'); } catch { return {}; } }
router.get('/', (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const daily = (db.prepare(`SELECT COALESCE(SUM(credits),0) value FROM usage WHERE user_id=? AND status='complete' AND created_at>=?`).get(userId, day) as { value: number }).value;
  const monthly = (db.prepare(`SELECT COALESCE(SUM(credits),0) value FROM usage WHERE user_id=? AND status='complete' AND created_at>=?`).get(userId, month) as { value: number }).value;
  const rows = db.prepare('SELECT * FROM usage WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(userId) as any[];
  res.json({ credits: req.user!.credits, daily: { used: daily, limit: req.user!.daily_limit }, monthly: { used: monthly, limit: req.user!.monthly_limit },
    adminBypass: req.user!.role === 'admin', history: rows.map((row) => ({ id: row.id, operation: row.operation, credits: row.credits, status: row.status, meta: safeParse(row.meta_json), createdAt: row.created_at })) });
});
export default router;
