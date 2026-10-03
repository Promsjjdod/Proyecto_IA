import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { config, PERMISSIONS } from '../config/env.js';
import { db, schema } from '../database/index.js';
import { randomId } from '../core/crypto.js';
import { bus, emit } from '../core/events.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('permissions');

/** Permissions granted globally through env / Security settings. */
export function globalPermissions() {
  const fromSettings = db.select().from(schema.settings).where(eq(schema.settings.key, 'security.toolPermissions')).get();
  const list = Array.isArray(fromSettings?.value) ? fromSettings.value : config.toolPermissions;
  return list.filter((p) => PERMISSIONS.includes(p));
}

/** Effective permissions for a run = global ∩ (agent permissions when present). */
export function effectivePermissions(agent) {
  const global = new Set(globalPermissions());
  if (!agent?.permissions?.length) return [...global];
  return agent.permissions.filter((p) => global.has(p));
}

/**
 * Check a tool against granted permissions.
 * Returns { ok: true } or { ok: false, missing: [...] }.
 */
export function checkToolPermissions(tool, granted) {
  const missing = (tool.permissions || []).filter((p) => !granted.includes(p));
  if (missing.length) return { ok: false, missing };
  return { ok: true };
}

const pending = new Map();

/**
 * Ask the user (through the UI) to approve a dangerous or non-granted tool
 * call. Resolves when POST /api/approvals/:id arrives or after timeout.
 */
export function requestApproval({ tool, args, missing, chatId, taskId, timeoutMs = 300000 }) {
  const id = randomId('apr');
  const now = Date.now();
  db.insert(schema.approvals).values({
    id,
    chatId: chatId || null,
    taskId: taskId || null,
    tool: tool.name,
    args,
    permissions: missing.length ? missing : (tool.permissions || []),
    status: 'pending',
    createdAt: now,
  }).run();

  const payload = {
    id,
    tool: tool.name,
    description: tool.description,
    args,
    missing,
    dangerous: tool.dangerous,
    chatId: chatId || null,
    taskId: taskId || null,
  };
  emit(`approval:${chatId || 'global'}`, { type: 'approval_required', ...payload });
  emit('approvals', { type: 'approval_required', ...payload });
  log.info('approval requested', { id, tool: tool.name, missing });

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        resolveApprovalRecord(id, 'denied', 'Timed out waiting for user decision.');
        resolve({ approved: false, reason: 'Approval timed out.' });
      }
    }, timeoutMs);
    pending.set(id, (decision, note) => {
      clearTimeout(timer);
      pending.delete(id);
      resolve(decision === 'approved' ? { approved: true } : { approved: false, reason: note || 'Denied by user.' });
    });
  });
}

export function resolveApproval(id, decision, note) {
  const waiter = pending.get(id);
  const rec = resolveApprovalRecord(id, decision, note);
  if (!rec) return null;
  emit(`approval:${rec.chatId || 'global'}`, { type: 'approval_resolved', id, status: decision });
  emit('approvals', { type: 'approval_resolved', id, status: decision });
  if (waiter) waiter(decision, note);
  return rec;
}

function resolveApprovalRecord(id, decision, note) {
  const rec = db.select().from(schema.approvals).where(eq(schema.approvals.id, id)).get();
  if (!rec || rec.status !== 'pending') return null;
  db.update(schema.approvals)
    .set({ status: decision, decisionNote: note || null, resolvedAt: Date.now() })
    .where(eq(schema.approvals.id, id))
    .run();
  return rec;
}

export function listApprovals({ status } = {}) {
  const all = db.select().from(schema.approvals).all();
  return (status ? all.filter((a) => a.status === status) : all)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export const approvalDecisionSchema = z.object({
  decision: z.enum(['approved', 'denied']),
  note: z.string().max(500).optional(),
});
