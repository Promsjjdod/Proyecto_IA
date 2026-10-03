import { like, or, and, eq, desc } from 'drizzle-orm';
import { db, schema } from '../database/index.js';

/** Global search across chats, messages, agents, plugins, files and workspaces. */
export function searchAll(query, { limit = 8 } = {}) {
  const q = `%${String(query || '').toLowerCase()}%`;
  const results = { chats: [], messages: [], agents: [], plugins: [], files: [], workspaces: [] };

  results.chats = db.select({
    id: schema.chats.id, title: schema.chats.title, folder: schema.chats.folder,
    updatedAt: schema.chats.updatedAt, archived: schema.chats.archived,
  }).from(schema.chats)
    .where(or(like(schema.chats.title, q), like(schema.chats.folder, q)))
    .orderBy(desc(schema.chats.updatedAt)).limit(limit).all();

  results.messages = db.select({
    id: schema.messages.id, chatId: schema.messages.chatId, role: schema.messages.role,
    content: schema.messages.content, createdAt: schema.messages.createdAt,
    chatTitle: schema.chats.title,
  }).from(schema.messages)
    .innerJoin(schema.chats, eq(schema.chats.id, schema.messages.chatId))
    .where(like(schema.messages.content, q))
    .orderBy(desc(schema.messages.createdAt)).limit(limit).all()
    .map((m) => ({ ...m, snippet: m.content.slice(0, 220) }));

  results.agents = db.select({
    id: schema.agents.id, name: schema.agents.name, description: schema.agents.description,
    avatar: schema.agents.avatar, enabled: schema.agents.enabled,
  }).from(schema.agents)
    .where(or(like(schema.agents.name, q), like(schema.agents.description, q)))
    .limit(limit).all();

  results.plugins = db.select({
    id: schema.plugins.id, name: schema.plugins.name, description: schema.plugins.description,
    icon: schema.plugins.icon, status: schema.plugins.status, category: schema.plugins.category,
  }).from(schema.plugins)
    .where(or(like(schema.plugins.name, q), like(schema.plugins.description, q)))
    .limit(limit).all();

  results.files = db.select({
    id: schema.files.id, name: schema.files.name, folder: schema.files.folder,
    kind: schema.files.kind, size: schema.files.size, workspaceId: schema.files.workspaceId,
  }).from(schema.files)
    .where(or(like(schema.files.name, q), like(schema.files.folder, q)))
    .limit(limit).all();

  results.workspaces = db.select({
    id: schema.workspaces.id, name: schema.workspaces.name, description: schema.workspaces.description,
  }).from(schema.workspaces)
    .where(or(like(schema.workspaces.name, q), like(schema.workspaces.description, q)))
    .limit(limit).all();

  return results;
}

export function countAll(query) {
  const r = searchAll(query, { limit: 50 });
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.length]));
}
