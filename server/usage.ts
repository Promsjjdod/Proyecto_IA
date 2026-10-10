import { db } from './db.js';
import type { AuthUser } from './auth.js';

export class QuotaError extends Error { status = 429; }

function monthStart(date = new Date()) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString(); }
function dayStart(date = new Date()) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString(); }

export function reserveUsage(user: AuthUser, idempotencyKey: string, operation: string, estimatedInputTokens: number, outputBudget: number, meta: Record<string, unknown> = {}) {
  if (!idempotencyKey || idempotencyKey.length > 100) throw Object.assign(new Error('Identificador de solicitud no válido.'), { status: 400 });
  const reserved = Math.max(1, Math.ceil(estimatedInputTokens) + Math.max(1, Math.ceil(outputBudget)));
  const now = new Date().toISOString();
  const reserve = db.transaction(() => {
    const duplicate = db.prepare('SELECT id,status FROM usage WHERE user_id=? AND idempotency_key=?').get(user.id, idempotencyKey) as { id: string; status: string } | undefined;
    if (duplicate) throw Object.assign(new Error('Esta solicitud ya se procesó o está en curso. No se repitió para evitar consumo duplicado.'), { status: 409 });
    if (user.role !== 'admin') {
      const current = db.prepare('SELECT credits,daily_limit,monthly_limit FROM users WHERE id=?').get(user.id) as { credits: number; daily_limit: number; monthly_limit: number };
      const dayUsage = (db.prepare(`SELECT COALESCE(SUM(CASE WHEN status='reserved' THEN reserved WHEN status='complete' THEN credits ELSE 0 END),0) total FROM usage WHERE user_id=? AND created_at>=?`).get(user.id, dayStart()) as { total: number }).total;
      const monthUsage = (db.prepare(`SELECT COALESCE(SUM(CASE WHEN status='reserved' THEN reserved WHEN status='complete' THEN credits ELSE 0 END),0) total FROM usage WHERE user_id=? AND created_at>=?`).get(user.id, monthStart()) as { total: number }).total;
      if (current.credits < reserved) throw new QuotaError(`Créditos insuficientes para reservar hasta ${reserved} unidades internas. Saldo: ${current.credits}.`);
      if (dayUsage + reserved > current.daily_limit) throw new QuotaError(`Se superaría el límite diario de ${current.daily_limit} unidades. Reduce el modo o inténtalo mañana.`);
      if (monthUsage + reserved > current.monthly_limit) throw new QuotaError(`Se superaría el límite mensual de ${current.monthly_limit} unidades.`);
      db.prepare('UPDATE users SET credits=credits-? WHERE id=?').run(reserved, user.id);
    }
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO usage(id,user_id,idempotency_key,operation,credits,reserved,status,meta_json,created_at,updated_at)
      VALUES(?,?,?,?,0,?,'reserved',?,?,?)`).run(id, user.id, idempotencyKey, operation, user.role === 'admin' ? 0 : reserved, JSON.stringify({ ...meta, reservation: reserved, adminBypass: user.role === 'admin' }), now, now);
    return { id, reserved: user.role === 'admin' ? 0 : reserved, adminBypass: user.role === 'admin' };
  });
  return reserve.immediate();
}

export function settleUsage(userId: string, reservation: { id: string; reserved: number; adminBypass: boolean }, actualCredits: number, metadata: Record<string, unknown> = {}) {
  const estimate = Number.isFinite(actualCredits) ? Math.max(0, Math.ceil(actualCredits)) : 0;
  const now = new Date().toISOString();
  const settle = db.transaction(() => {
    const entry = db.prepare('SELECT status,reserved,created_at FROM usage WHERE id=? AND user_id=?').get(reservation.id, userId) as { status: string; reserved: number; created_at: string } | undefined;
    if (!entry || entry.status !== 'reserved') return;
    let charged = reservation.adminBypass ? 0 : estimate;
    if (!reservation.adminBypass) {
      const current = db.prepare('SELECT credits,daily_limit,monthly_limit FROM users WHERE id=?').get(userId) as { credits: number; daily_limit: number; monthly_limit: number } | undefined;
      if (!current) throw new Error('La cuenta desapareció mientras se conciliaba el consumo.');
      const created = new Date(entry.created_at);
      const dayFrom = dayStart(created);
      const dayTo = new Date(Date.parse(dayFrom) + 86_400_000).toISOString();
      const monthFrom = monthStart(created);
      const monthTo = new Date(Date.UTC(created.getUTCFullYear(), created.getUTCMonth() + 1, 1)).toISOString();
      const usageSql = `SELECT COALESCE(SUM(CASE WHEN status='reserved' THEN reserved WHEN status='complete' THEN credits ELSE 0 END),0) total FROM usage WHERE user_id=? AND created_at>=? AND created_at<?`;
      const dayUsage = (db.prepare(usageSql).get(userId, dayFrom, dayTo) as { total: number }).total;
      const monthUsage = (db.prepare(usageSql).get(userId, monthFrom, monthTo) as { total: number }).total;
      const currentReservation = Number(entry.reserved) || 0;
      const maxByCredits = Math.max(0, current.credits + currentReservation);
      const maxByDay = Math.max(0, current.daily_limit - Math.max(0, dayUsage - currentReservation));
      const maxByMonth = Math.max(0, current.monthly_limit - Math.max(0, monthUsage - currentReservation));
      charged = Math.min(estimate, maxByCredits, maxByDay, maxByMonth);
      const creditAdjustment = currentReservation - charged;
      if (creditAdjustment > 0) db.prepare('UPDATE users SET credits=credits+? WHERE id=?').run(creditAdjustment, userId);
      else if (creditAdjustment < 0) db.prepare('UPDATE users SET credits=credits-? WHERE id=?').run(-creditAdjustment, userId);
    }
    db.prepare(`UPDATE usage SET credits=?,reserved=0,status='complete',meta_json=?,updated_at=? WHERE id=?`).run(
      charged, JSON.stringify({ ...metadata, estimatedInternalUnits: estimate, chargedInternalUnits: charged, quotaCapped: charged < estimate, adminBypass: reservation.adminBypass }), now, reservation.id,
    );
  });
  settle.immediate();
}

export function releaseUsage(userId: string, reservation: { id: string; reserved: number; adminBypass: boolean }, status: 'failed' | 'cancelled', metadata: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  const release = db.transaction(() => {
    const entry = db.prepare('SELECT status FROM usage WHERE id=? AND user_id=?').get(reservation.id, userId) as { status: string } | undefined;
    if (!entry || entry.status !== 'reserved') return;
    if (!reservation.adminBypass && reservation.reserved) db.prepare('UPDATE users SET credits=credits+? WHERE id=?').run(reservation.reserved, userId);
    db.prepare('UPDATE usage SET status=?,reserved=0,credits=0,meta_json=?,updated_at=? WHERE id=?').run(status, JSON.stringify(metadata), now, reservation.id);
  });
  release.immediate();
}

export function estimateTextUnits(text: string) { return Math.ceil(Buffer.byteLength(text, 'utf8') / 4); }
