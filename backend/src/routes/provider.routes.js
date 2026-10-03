import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db, schema } from '../database/index.js';
import { parse, providerSchema, idSchema, z } from '../core/validate.js';
import { encryptSecret, randomId } from '../core/crypto.js';
import { notFound, badRequest } from '../core/errors.js';
import * as providers from '../providers/registry.js';
import { getAdapter } from '../providers/registry.js';
import { config } from '../config/env.js';

export const providerRoutes = Router();

providerRoutes.get('/providers', (_req, res) => {
  res.json({ providers: providers.listProviderRecords().map(providers.publicProvider), kinds: providers.PROVIDER_KINDS });
});

providerRoutes.post('/providers', (req, res) => {
  const body = parse(providerSchema, req.body, 'provider');
  const id = randomId('prv');
  const now = Date.now();
  if (body.isDefault) db.update(schema.providers).set({ isDefault: false }).run();
  db.insert(schema.providers).values({
    id,
    name: body.name,
    kind: body.kind,
    baseUrl: body.baseUrl,
    apiVersion: body.apiVersion,
    apiKeyEnc: body.apiKey ? encryptSecret(body.apiKey) : null,
    headers: body.headers,
    bodyParams: body.bodyParams,
    contextWindow: body.contextWindow,
    tags: body.tags,
    icon: body.icon,
    pricingInput: body.pricingInput,
    pricingOutput: body.pricingOutput,
    enabled: body.enabled,
    isDefault: body.isDefault,
    responseMode: body.responseMode,
    chatPath: body.chatPath,
    createdAt: now,
    updatedAt: now,
  }).run();
  res.status(201).json({ provider: providers.publicProvider(providers.getProviderRecord(id)) });
});

providerRoutes.patch('/providers/:id', (req, res) => {
  const id = parse(idSchema, req.params.id, 'provider id');
  const record = providers.getProviderRecord(id);
  const body = parse(providerSchema.partial(), req.body, 'provider');
  const set = { updatedAt: Date.now() };
  const map = {
    name: 'name', kind: 'kind', baseUrl: 'baseUrl', apiVersion: 'apiVersion', headers: 'headers',
    bodyParams: 'bodyParams', contextWindow: 'contextWindow', tags: 'tags', icon: 'icon',
    pricingInput: 'pricingInput', pricingOutput: 'pricingOutput', enabled: 'enabled',
    responseMode: 'responseMode', chatPath: 'chatPath',
  };
  for (const [k, col] of Object.entries(map)) if (body[k] !== undefined) set[col] = body[k];
  if (body.apiKey !== undefined) set.apiKeyEnc = body.apiKey ? encryptSecret(body.apiKey) : null;
  if (body.isDefault !== undefined) {
    if (body.isDefault) db.update(schema.providers).set({ isDefault: false }).run();
    set.isDefault = body.isDefault;
  }
  if (record.kind === 'demo' && (body.kind !== undefined && body.kind !== 'demo')) throw badRequest('The demo provider cannot change kind.');
  db.update(schema.providers).set(set).where(eq(schema.providers.id, id)).run();
  res.json({ provider: providers.publicProvider(providers.getProviderRecord(id)) });
});

providerRoutes.delete('/providers/:id', (req, res) => {
  const id = parse(idSchema, req.params.id, 'provider id');
  const record = providers.getProviderRecord(id);
  if (record.kind === 'demo') throw badRequest('The built-in demo provider cannot be deleted (it can be disabled).');
  db.delete(schema.providers).where(eq(schema.providers.id, id)).run();
  db.delete(schema.modelsCache).where(eq(schema.modelsCache.providerId, id)).run();
  res.json({ ok: true });
});

providerRoutes.post('/providers/:id/probe', async (req, res) => {
  const id = parse(idSchema, req.params.id, 'provider id');
  const record = providers.getProviderRecord(id);
  res.json(await providers.probeProvider(record));
});

/** Live model list for a provider (Ollama detection included). */
providerRoutes.get('/providers/:id/models', async (req, res) => {
  const id = parse(idSchema, req.params.id, 'provider id');
  const record = providers.getProviderRecord(id);
  const adapter = getAdapter(record);
  try {
    const models = await adapter.listModels();
    const now = Date.now();
    db.delete(schema.modelsCache).where(eq(schema.modelsCache.providerId, id)).run();
    for (const m of models) {
      db.insert(schema.modelsCache).values({
        providerId: id, modelId: m.id, name: m.name, context: m.context ?? null,
        size: m.size ?? null, status: m.status, updatedAt: now,
      }).onConflictDoUpdate({
        target: [schema.modelsCache.providerId, schema.modelsCache.modelId],
        set: { name: m.name, context: m.context ?? null, size: m.size ?? null, status: m.status, updatedAt: now },
      }).run();
    }
    res.json({ models, reachable: true, ollama: record.kind === 'ollama' ? { baseUrl: record.baseUrl || config.ollamaBaseUrl } : undefined });
  } catch (err) {
    res.json({ models: [], reachable: false, error: err.message });
  }
});

/** Aggregate model picker data: providers + cached/live models. */
providerRoutes.get('/models', async (_req, res) => {
  const records = providers.listProviderRecords().filter((p) => p.enabled);
  const out = [];
  for (const record of records) {
    try {
      const adapter = getAdapter(record);
      const models = await adapter.listModels();
      out.push({ provider: providers.publicProvider(record), models, reachable: true });
    } catch {
      const cached = db.select().from(schema.modelsCache).where(eq(schema.modelsCache.providerId, record.id)).all();
      out.push({ provider: providers.publicProvider(record), models: cached, reachable: false });
    }
  }
  res.json({ providers: out });
});

providerRoutes.get('/ollama/status', async (_req, res) => {
  const record = providers.listProviderRecords().find((p) => p.kind === 'ollama');
  if (!record) { res.json({ configured: false }); return; }
  const probe = await providers.probeProvider(record);
  res.json({ configured: true, ok: probe.ok, message: probe.message, models: probe.models, baseUrl: record.baseUrl || config.ollamaBaseUrl });
});
