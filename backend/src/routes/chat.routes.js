import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '../database/index.js';
import { parse, chatCreateSchema, chatUpdateSchema, messageSendSchema, idSchema } from '../core/validate.js';
import { attachSSE, bus } from '../core/events.js';
import { runCompletion, getChat, getMessages, updateMessage } from '../services/chat.service.js';
import * as chats from '../services/chat.service.js';
import { listApprovals } from '../tools/permissions.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('routes:chat');
export const chatRoutes = Router();

chatRoutes.get('/chats', (req, res) => {
  const archived = req.query.archived === 'true';
  const folder = req.query.folder === undefined ? undefined : String(req.query.folder);
  res.json({
    chats: chats.listChats(req.user.id, { archived, folder, query: req.query.q ? String(req.query.q) : undefined }),
    folders: chats.listFolders(req.user.id),
  });
});

chatRoutes.post('/chats', (req, res) => {
  const body = parse(chatCreateSchema, req.body, 'chat');
  res.status(201).json({ chat: chats.createChat(req.user.id, body) });
});

chatRoutes.get('/chats/:id', (req, res) => {
  const id = parse(idSchema, req.params.id, 'chat id');
  const chat = chats.getChat(id);
  res.json({ chat, messages: chats.getMessages(id) });
});

chatRoutes.patch('/chats/:id', (req, res) => {
  const id = parse(idSchema, req.params.id, 'chat id');
  const body = parse(chatUpdateSchema, req.body, 'chat');
  res.json({ chat: chats.updateChat(id, body) });
});

chatRoutes.delete('/chats/:id', (req, res) => {
  const id = parse(idSchema, req.params.id, 'chat id');
  chats.deleteChat(id);
  res.json({ ok: true });
});

chatRoutes.patch('/messages/:id', (req, res) => {
  const body = parse(z.object({ content: z.string().max(200000) }), req.body, 'message');
  res.json({ message: updateMessage(req.params.id, body.content) });
});

chatRoutes.delete('/messages/:id', (req, res) => {
  const msg = db.select().from(schema.messages).where(eq(schema.messages.id, req.params.id)).get();
  if (msg) chats.deleteMessagesAfter(msg.chatId, msg.id, { includePivot: true });
  res.json({ ok: true });
});

/** Pending approvals for the current session (chat or work). */
chatRoutes.get('/approvals', (_req, res) => {
  res.json({ approvals: listApprovals({ status: 'pending' }) });
});

/**
 * Streaming completion endpoint (Server-Sent Events).
 * Events: delta | tool_event | usage | message_done | error | approval_*
 */
chatRoutes.post('/chats/:id/completions', async (req, res) => {
  const id = parse(idSchema, req.params.id, 'chat id');
  const body = parse(messageSendSchema, req.body, 'message');
  getChat(id);

  const sse = attachSSE(req, res);
  const controller = new AbortController();
  res.on('close', () => controller.abort());

  const approvalListener = (event) => {
    if (event.chatId === id) sse.send(event.type === 'approval_required' ? 'approval_required' : 'approval_resolved', event);
  };
  bus.on('approvals', approvalListener);

  try {
    await runCompletion({
      chatId: id,
      userId: req.user.id,
      body,
      signal: controller.signal,
      send: (event, data) => sse.send(event, data),
    });
  } catch (err) {
    log.error('completion failed', { chatId: id, error: err.message });
    sse.send('error', { message: 'The completion failed unexpectedly. Check System Status → Logs.', code: 'INTERNAL' });
  } finally {
    bus.off('approvals', approvalListener);
    sse.close();
  }
});

/** Message history only (used by polling fallbacks and tests). */
chatRoutes.get('/chats/:id/messages', (req, res) => {
  const id = parse(idSchema, req.params.id, 'chat id');
  res.json({ messages: getMessages(id) });
});
