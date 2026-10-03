import fs from 'node:fs';
import path from 'node:path';
import { eq, and, desc, asc, like, or } from 'drizzle-orm';
import { db, schema } from '../database/index.js';
import { config } from '../config/env.js';
import { randomId } from '../core/crypto.js';
import { notFound, badRequest, providerOffline } from '../core/errors.js';
import { createLogger } from '../core/logger.js';
import { getAdapter, resolveDefaultProvider, listProviderRecords } from '../providers/registry.js';
import { toolsForAgent } from '../plugins/manager.js';
import { effectivePermissions } from '../tools/permissions.js';
import { executeToolCall } from './tool-exec.service.js';
import { getSettings } from './settings.service.js';
import { memoryContextBlock } from './memory.service.js';

const log = createLogger('chat');

// ---------------------------------------------------------------- chats CRUD

export function createChat(userId, data = {}) {
  const now = Date.now();
  const id = randomId('chat');
  db.insert(schema.chats).values({
    id,
    userId,
    title: data.title || 'New chat',
    model: data.model || '',
    providerId: data.providerId || '',
    agentId: data.agentId || null,
    folder: data.folder || '',
    systemPrompt: data.systemPrompt || '',
    temperature: data.temperature ?? null,
    maxTokens: data.maxTokens ?? null,
    createdAt: now,
    updatedAt: now,
  }).run();
  return getChat(id);
}

export function getChat(id) {
  const row = db.select().from(schema.chats).where(eq(schema.chats.id, id)).get();
  if (!row) throw notFound('Chat not found.');
  return row;
}

export function listChats(userId, { archived = false, folder, query } = {}) {
  const conditions = [eq(schema.chats.userId, userId), eq(schema.chats.archived, archived)];
  if (folder !== undefined) conditions.push(eq(schema.chats.folder, folder));
  if (query) conditions.push(or(like(schema.chats.title, `%${query}%`), like(schema.chats.folder, `%${query}%`)));
  return db.select().from(schema.chats).where(and(...conditions)).orderBy(desc(schema.chats.pinned), desc(schema.chats.updatedAt)).all();
}

export function listFolders(userId) {
  const rows = db.selectDistinct({ folder: schema.chats.folder }).from(schema.chats)
    .where(and(eq(schema.chats.userId, userId), eq(schema.chats.archived, false))).all();
  return rows.map((r) => r.folder).filter(Boolean).sort();
}

export function updateChat(id, patch) {
  getChat(id);
  const set = {};
  for (const [k, v] of Object.entries(patch)) {
    const col = {
      title: 'title', model: 'model', providerId: 'providerId', agentId: 'agentId',
      folder: 'folder', archived: 'archived', pinned: 'pinned', systemPrompt: 'systemPrompt',
      temperature: 'temperature', maxTokens: 'maxTokens',
    }[k];
    if (col) set[col] = v;
  }
  if (Object.keys(set).length) {
    db.update(schema.chats).set(set).where(eq(schema.chats.id, id)).run();
  }
  db.update(schema.chats).set({ updatedAt: Date.now() }).where(eq(schema.chats.id, id)).run();
  return getChat(id);
}

export function deleteChat(id) {
  getChat(id);
  db.delete(schema.messages).where(eq(schema.messages.chatId, id)).run();
  db.delete(schema.chats).where(eq(schema.chats.id, id)).run();
}

export function getMessages(chatId) {
  return db.select().from(schema.messages).where(eq(schema.messages.chatId, chatId)).orderBy(asc(schema.messages.createdAt), asc(schema.messages.id)).all();
}

export function updateMessage(id, content) {
  const row = db.select().from(schema.messages).where(eq(schema.messages.id, id)).get();
  if (!row) throw notFound('Message not found.');
  db.update(schema.messages).set({ content }).where(eq(schema.messages.id, id)).run();
  return { ...row, content };
}

/** Delete the pivot message (optional) and everything stored after it. */
export function deleteMessagesAfter(chatId, messageId, { includePivot = false } = {}) {
  const pivot = db.select().from(schema.messages).where(eq(schema.messages.id, messageId)).get();
  if (!pivot) throw notFound('Message not found.');
  const all = db.select().from(schema.messages).where(eq(schema.messages.chatId, chatId)).all();
  for (const m of all) {
    const after = includePivot ? m.createdAt >= pivot.createdAt : m.createdAt > pivot.createdAt;
    if (after) db.delete(schema.messages).where(eq(schema.messages.id, m.id)).run();
  }
}

// ------------------------------------------------------------ model resolve

export function resolveProviderAndModel({ chat, body, settings }) {
  const providerId = body?.providerId || chat?.providerId || settings.models.defaultProviderId || '';
  let record = null;
  if (providerId) {
    record = listProviderRecords().find((p) => p.id === providerId && p.enabled) || null;
  }
  if (!record) record = resolveDefaultProvider();
  if (!record) {
    if (config.demoMode) {
      record = listProviderRecords().find((p) => p.kind === 'demo');
    }
  }
  if (!record) throw providerOffline('No provider is configured. Add one in Settings → Providers, install Ollama, or enable DEMO mode.');
  const model = body?.model || chat?.model || settings.models.defaultModel || '';
  return { record, model };
}

async function pickModel(adapter, requested, settings) {
  if (requested) return requested;
  if (settings.models.defaultModel) return settings.models.defaultModel;
  try {
    const models = await adapter.listModels();
    if (models.length) return models[0].id;
  } catch { /* ignore */ }
  return '';
}

// ------------------------------------------------------------- completions

function attachmentContext(attachments) {
  const blocks = [];
  for (const att of attachments || []) {
    try {
      const row = db.select().from(schema.files).where(eq(schema.files.id, att.fileId)).get();
      if (!row) continue;
      const abs = path.resolve(config.uploadsDir, path.basename(row.storagePath));
      if (!fs.existsSync(abs)) continue;
      const st = fs.statSync(abs);
      if (st.size > 200_000) { blocks.push(`[Attached file ${row.name}: too large to inline (${st.size} bytes)]`); continue; }
      if (/^text\/|json|xml|csv|markdown|javascript|typescript/.test(row.mime) || /\.(txt|md|csv|json|js|ts|py|html|css)$/i.test(row.name)) {
        blocks.push(`[Attached file: ${row.name}]\n\`\`\`\n${fs.readFileSync(abs, 'utf8').slice(0, 12000)}\n\`\`\``);
      } else {
        blocks.push(`[Attached file: ${row.name} (${row.mime}, ${st.size} bytes) - binary, not inlined]`);
      }
    } catch (err) {
      log.warn('attachment inline failed', { error: err.message });
    }
  }
  return blocks.join('\n\n');
}

/**
 * Run one completion (with tool-call loop) and stream events through `send`.
 *
 * Events: delta, tool_event, approval_required (via approvals bus), usage,
 * message_done, error.
 */
export async function runCompletion({ chatId, userId, body, send, signal }) {
  const settings = getSettings();
  const chat = getChat(chatId);

  // edit / regenerate semantics
  if (body.editMessageId) {
    updateMessage(body.editMessageId, body.content);
    deleteMessagesAfter(chatId, body.editMessageId);
  } else if (body.regenerate) {
    const msgs = getMessages(chatId);
    const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
    if (lastAssistant) deleteMessagesAfter(chatId, lastAssistant.id, { includePivot: true });
  } else {
    const now = Date.now();
    const extra = attachmentContext(body.attachments);
    const content = extra ? `${body.content}\n\n${extra}` : body.content;
    db.insert(schema.messages).values({
      id: randomId('msg'), chatId, role: 'user', content, createdAt: now,
      meta: body.attachments?.length ? { attachments: body.attachments } : null,
    }).run();
    if (chat.title === 'New chat' && body.content.trim()) {
      const title = body.content.trim().replace(/\s+/g, ' ').slice(0, 48);
      db.update(schema.chats).set({ title: title || 'New chat' }).where(eq(schema.chats.id, chatId)).run();
    }
  }

  const { record, model: requestedModel } = resolveProviderAndModel({ chat, body, settings });
  const adapter = getAdapter(record);
  const model = await pickModel(adapter, requestedModel, settings);
  if (!model) {
    send('error', { message: `Provider "${record.name}" has no reachable model. Check Settings → Providers or pull a model in Ollama.`, code: 'NO_MODEL' });
    return;
  }

  const agent = chat.agentId ? db.select().from(schema.agents).where(eq(schema.agents.id, chat.agentId)).get() : null;
  const granted = effectivePermissions(agent);
  const tools = agent ? await toolsForAgent(agent) : [];
  const usableTools = tools.filter((t) => (t.permissions || []).every((p) => granted.includes(p)) || t.dangerous);
  const functionDefs = adapter.supportsTools() && usableTools.length
    ? usableTools.map((t) => t.toFunctionDef())
    : [];

  const history = getMessages(chatId)
    .filter((m) => ['user', 'assistant'].includes(m.role))
    .slice(-(settings.memory.maxConversationMessages || 24));

  const systemParts = [];
  const baseSystem = chat.systemPrompt || agent?.systemPrompt || '';
  if (baseSystem) systemParts.push(baseSystem);
  if (record.kind === 'demo') {
    systemParts.push('You are running in ForgeAI DEMO mode: your output is simulated locally. Say so briefly if asked about your nature.');
  }
  const memBlock = memoryContextBlock({ agent, chatId, settings });
  if (memBlock) systemParts.push(memBlock);
  systemParts.push('You are ForgeAI, a local AI workspace. When using tools, report actions, tools used, results and errors - never private reasoning.');

  const messages = [
    { role: 'system', content: systemParts.join('\n\n') },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  const ctx = {
    userId,
    chatId,
    agent,
    granted,
    workspaceRoot: config.workspaceRoot,
  };

  const maxIter = settings.advanced.toolLoopMaxIterations || 6;
  const startedAll = Date.now();
  let totalIn = 0;
  let totalOut = 0;
  let speed = null;

  for (let iteration = 0; iteration < maxIter; iteration += 1) {
    const assistantText = [];
    let toolCalls = null;
    let error = null;
    const started = Date.now();
    let outTokens = 0;

    const stream = adapter.streamChat({
      messages,
      model,
      temperature: chat.temperature ?? agent?.temperature ?? 0.7,
      maxTokens: chat.maxTokens ?? agent?.maxTokens,
      tools: functionDefs,
      signal,
    });

    for await (const event of stream) {
      if (signal?.aborted) break;
      if (event.type === 'delta') {
        assistantText.push(event.text);
        outTokens += Math.max(1, Math.round(event.text.length / 4));
        send('delta', { text: event.text });
      } else if (event.type === 'usage') {
        if (event.promptTokens) totalIn = event.promptTokens;
        if (event.completionTokens) outTokens = event.completionTokens;
        if (event.tokensPerSec) speed = event.tokensPerSec;
      } else if (event.type === 'tool_calls') {
        toolCalls = event.calls;
      } else if (event.type === 'error') {
        error = event;
      }
    }

    if (signal?.aborted) {
      send('message_done', { aborted: true });
      return;
    }

    if (error) {
      persistAssistant({ chatId, model, providerId: record.id, agentId: agent?.id, content: assistantText.join(''), error: error.message });
      send('error', { message: error.message, code: error.code || 'PROVIDER_ERROR', actions: ['retry', 'settings', 'change-provider'] });
      return;
    }

    const text = assistantText.join('');
    const durationMs = Date.now() - started;
    if (!speed && durationMs > 0) speed = +((outTokens / durationMs) * 1000).toFixed(1);

    if (!toolCalls || !toolCalls.length) {
      const row = persistAssistant({
        chatId, model, providerId: record.id, agentId: agent?.id, content: text,
        tokensIn: totalIn || null, tokensOut: outTokens, tokensPerSec: speed, durationMs,
      });
      db.update(schema.chats).set({ model, providerId: record.id, updatedAt: Date.now() }).where(eq(schema.chats.id, chatId)).run();
      send('usage', { promptTokens: totalIn, completionTokens: outTokens, tokensPerSec: speed, durationMs });
      send('message_done', { messageId: row.id, model, providerId: record.id, demo: record.kind === 'demo', tokensIn: totalIn, tokensOut: outTokens, tokensPerSec: speed, durationMs });
      return;
    }

    // tool-call round
    persistAssistant({
      chatId, model, providerId: record.id, agentId: agent?.id, content: text,
      meta: { toolCalls: toolCalls.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments })) },
    });
    messages.push({
      role: 'assistant',
      content: text,
      tool_calls: toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments || {}) } })),
    });

    for (const call of toolCalls) {
      const tool = usableTools.find((t) => t.name === call.name);
      if (!tool) {
        const msg = `Tool "${call.name}" is not available for this agent.`;
        messages.push({ role: 'tool', tool_call_id: call.id, content: msg });
        send('tool_event', { phase: 'failed', tool: call.name, error: msg });
        continue;
      }
      const result = await executeToolCall(tool, call.arguments, { ...ctx, taskId: null }, { notify: (e, d) => send(e, d), settings });
      const content = result.ok
        ? JSON.stringify({ summary: result.summary, data: result.data }).slice(0, 12000)
        : JSON.stringify({ error: result.error });
      messages.push({ role: 'tool', tool_call_id: call.id, content });
      persistToolMessage(chatId, tool.name, result, call);
    }
    // loop again so the model can react to tool results
  }

  send('message_done', { model, providerId: record.id, stopped: true, note: 'Tool iteration limit reached.' });
  log.warn('tool loop limit reached', { chatId, iterations: maxIter });
}

function persistAssistant({ chatId, model, providerId, agentId, content, tokensIn, tokensOut, tokensPerSec, durationMs, error, meta }) {
  const id = randomId('msg');
  db.insert(schema.messages).values({
    id, chatId, role: 'assistant', content: content || '', model, providerId, agentId: agentId || null,
    tokensIn: tokensIn ?? null, tokensOut: tokensOut ?? null, tokensPerSec: tokensPerSec ?? null,
    durationMs: durationMs ?? null, error: error || null, meta: meta || null, createdAt: Date.now(),
  }).run();
  return { id };
}

function persistToolMessage(chatId, toolName, result, call) {
  db.insert(schema.messages).values({
    id: randomId('msg'),
    chatId,
    role: 'tool',
    content: result.ok ? result.summary : `error: ${result.error}`,
    model: null,
    providerId: null,
    meta: { tool: toolName, ok: result.ok, callId: call.id, data: truncateData(result.data) },
    createdAt: Date.now(),
  }).run();
}

function truncateData(data) {
  try {
    const s = JSON.stringify(data);
    return s && s.length > 4000 ? JSON.parse(s.slice(0, 4000)) : data;
  } catch {
    return undefined;
  }
}
