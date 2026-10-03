import { eq, and, like, desc } from 'drizzle-orm';
import { db, schema } from '../database/index.js';
import { randomId } from '../core/crypto.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('memory');

/**
 * Memory system with three scopes: conversation, agent, workspace.
 * Secrets are redacted before anything is persisted.
 */
const SECRET_LOOKALIKE =
  /(sk-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{10,}|gho_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|api[_-]?key\s*[:=]\s*\S+|password\s*[:=]\s*\S+|token\s*[:=]\s*\S+)/i;

export function containsSecret(text) {
  return SECRET_LOOKALIKE.test(String(text || ''));
}

export function sanitizeMemoryContent(text) {
  const value = String(text || '');
  if (!containsSecret(value)) return value;
  log.warn('refused to store memory entry containing a secret-looking value');
  return value.replace(SECRET_LOOKALIKE, '[redacted-secret]');
}

export function remember({ scope, ownerId = '', kind = 'fact', content }) {
  const clean = sanitizeMemoryContent(content).trim();
  if (!clean) return null;
  const now = Date.now();
  const existing = db.select().from(schema.memories)
    .where(and(eq(schema.memories.scope, scope), eq(schema.memories.ownerId, ownerId), eq(schema.memories.content, clean)))
    .get();
  if (existing) {
    db.update(schema.memories).set({ updatedAt: now }).where(eq(schema.memories.id, existing.id)).run();
    return existing.id;
  }
  const id = randomId('mem');
  db.insert(schema.memories).values({ id, scope, ownerId, kind, content: clean.slice(0, 4000), createdAt: now, updatedAt: now }).run();
  return id;
}

export function recall({ scope, ownerId = '', query, limit = 8 }) {
  const rows = db.select().from(schema.memories)
    .where(and(eq(schema.memories.scope, scope), eq(schema.memories.ownerId, ownerId)))
    .orderBy(desc(schema.memories.updatedAt))
    .all();
  const q = String(query || '').toLowerCase();
  const scored = rows
    .map((r) => ({ ...r, score: q ? (r.content.toLowerCase().includes(q) ? 2 : 0) + overlapScore(q, r.content.toLowerCase()) : 1 }))
    .filter((r) => !q || r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  if (scored.length) {
    const now = Date.now();
    for (const r of scored) db.update(schema.memories).set({ lastUsedAt: now }).where(eq(schema.memories.id, r.id)).run();
  }
  return scored.map(({ score, ...r }) => r);
}

function overlapScore(query, content) {
  const words = query.split(/\s+/).filter((w) => w.length > 3);
  return words.filter((w) => content.includes(w)).length;
}

export function listMemories({ scope, ownerId = '', limit = 200 } = {}) {
  const q = db.select().from(schema.memories);
  const rows = scope
    ? q.where(and(eq(schema.memories.scope, scope), eq(schema.memories.ownerId, ownerId))).all()
    : q.all();
  return rows.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

export function forget(id) {
  db.delete(schema.memories).where(eq(schema.memories.id, id)).run();
}

export function clearScope({ scope, ownerId = '' }) {
  db.delete(schema.memories).where(and(eq(schema.memories.scope, scope), eq(schema.memories.ownerId, ownerId))).run();
}

/** Build a memory block to prepend to the system prompt for a run. */
export function memoryContextBlock({ agent, chatId, settings }) {
  const mem = agent?.memory || { conversation: true, agent: true, workspace: false };
  const blocks = [];
  if (mem.agent !== false && settings?.memory?.agentMemory !== false) {
    const facts = recall({ scope: 'agent', ownerId: agent?.id || '', limit: 6 });
    if (facts.length) blocks.push(`[Agent memory]\n${facts.map((f) => `- ${f.content}`).join('\n')}`);
  }
  if (mem.workspace !== false && settings?.memory?.workspaceMemory === true) {
    const facts = recall({ scope: 'workspace', ownerId: '', limit: 6 });
    if (facts.length) blocks.push(`[Workspace memory]\n${facts.map((f) => `- ${f.content}`).join('\n')}`);
  }
  if (mem.conversation !== false && settings?.memory?.conversationMemory !== false && chatId) {
    const facts = recall({ scope: 'conversation', ownerId: chatId, limit: 4 });
    if (facts.length) blocks.push(`[Conversation notes]\n${facts.map((f) => `- ${f.content}`).join('\n')}`);
  }
  return blocks.join('\n\n');
}
