import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db, schema } from '../database/index.js';
import { parse, agentSchema, idSchema } from '../core/validate.js';
import { randomId } from '../core/crypto.js';
import { notFound } from '../core/errors.js';
import { PERMISSIONS } from '../config/env.js';
import { toolCatalog } from '../tools/registry.js';
import { listPlugins } from '../plugins/manager.js';

export const agentRoutes = Router();

function getAgent(id) {
  const row = db.select().from(schema.agents).where(eq(schema.agents.id, id)).get();
  if (!row) throw notFound('Agent not found.');
  return row;
}

agentRoutes.get('/agents', (_req, res) => {
  res.json({ agents: db.select().from(schema.agents).all() });
});

agentRoutes.get('/agents/options', (_req, res) => {
  res.json({
    tools: toolCatalog(),
    plugins: listPlugins().map((p) => ({ id: p.id, name: p.name, icon: p.icon, status: p.status, tools: p.tools })),
    permissions: PERMISSIONS,
  });
});

agentRoutes.post('/agents', (req, res) => {
  const body = parse(agentSchema, req.body, 'agent');
  const id = randomId('agt');
  const now = Date.now();
  db.insert(schema.agents).values({ id, ...body, builtin: false, createdAt: now, updatedAt: now }).run();
  res.status(201).json({ agent: getAgent(id) });
});

agentRoutes.get('/agents/:id', (req, res) => {
  res.json({ agent: getAgent(parse(idSchema, req.params.id, 'agent id')) });
});

agentRoutes.patch('/agents/:id', (req, res) => {
  const id = parse(idSchema, req.params.id, 'agent id');
  getAgent(id);
  const body = parse(agentSchema.partial(), req.body, 'agent');
  db.update(schema.agents).set({ ...body, updatedAt: Date.now() }).where(eq(schema.agents.id, id)).run();
  res.json({ agent: getAgent(id) });
});

agentRoutes.delete('/agents/:id', (req, res) => {
  const id = parse(idSchema, req.params.id, 'agent id');
  const agent = getAgent(id);
  if (agent.builtin) {
    db.update(schema.agents).set({ enabled: false, updatedAt: Date.now() }).where(eq(schema.agents.id, id)).run();
    res.json({ ok: true, note: 'Built-in agents are disabled instead of deleted.' });
    return;
  }
  db.delete(schema.agents).where(eq(schema.agents.id, id)).run();
  res.json({ ok: true });
});
