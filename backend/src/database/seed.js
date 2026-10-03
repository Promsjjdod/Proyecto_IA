import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { config } from '../config/env.js';
import { db, schema } from './index.js';
import { encryptSecret, randomId } from '../core/crypto.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('seed');

function readPackDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; }
    })
    .filter(Boolean);
}

/** First-run seeding: providers, agents, plugins, workspace, settings. Idempotent. */
export function seed() {
  const now = Date.now();

  // ---- providers from /providers packs
  const existingProviders = new Set(db.select().from(schema.providers).all().map((p) => p.id));
  for (const pack of readPackDir(config.packsDir.providers)) {
    if (pack.template || existingProviders.has(pack.id)) continue;
    let enabled = pack.enabled !== false;
    let apiKey = '';
    let baseUrl = pack.baseUrl || '';
    if (pack.requiresEnv?.length) {
      const hasAll = pack.requiresEnv.every((k) => process.env[k]);
      if (!hasAll) { enabled = false; continue; }
      apiKey = process.env.OPENAI_COMPATIBLE_API_KEY || '';
      baseUrl = process.env.OPENAI_COMPATIBLE_BASE_URL || baseUrl;
    }
    if (pack.kind === 'ollama') baseUrl = process.env.OLLAMA_BASE_URL || baseUrl;
    if (pack.kind === 'demo' && !config.demoMode) { enabled = false; }
    db.insert(schema.providers).values({
      id: pack.id,
      name: pack.name,
      kind: pack.kind,
      baseUrl,
      apiVersion: '',
      apiKeyEnc: apiKey ? encryptSecret(apiKey) : null,
      headers: {},
      bodyParams: {},
      contextWindow: pack.contextWindow || 128000,
      tags: pack.tags || [],
      icon: pack.icon || '◆',
      pricingInput: pack.pricingInput || 0,
      pricingOutput: pack.pricingOutput || 0,
      enabled,
      isDefault: Boolean(pack.isDefault) && config.demoMode,
      responseMode: pack.responseMode || 'openai-sse',
      chatPath: pack.chatPath || '/chat/completions',
      createdAt: now,
      updatedAt: now,
    }).run();
    log.info('seeded provider', { id: pack.id, enabled });
  }
  // ensure a default exists
  const anyDefault = db.select().from(schema.providers).where(eq(schema.providers.isDefault, true)).get();
  if (!anyDefault) {
    const fallback = db.select().from(schema.providers).where(eq(schema.providers.enabled, true)).all()[0];
    if (fallback) db.update(schema.providers).set({ isDefault: true }).where(eq(schema.providers.id, fallback.id)).run();
  }

  // ---- agents from /agents packs
  const existingAgents = new Set(db.select().from(schema.agents).all().map((a) => a.id));
  for (const pack of readPackDir(config.packsDir.agents)) {
    if (existingAgents.has(pack.id)) continue;
    db.insert(schema.agents).values({
      id: pack.id,
      name: pack.name,
      description: pack.description || '',
      avatar: pack.avatar || '◈',
      model: pack.model || '',
      providerId: pack.providerId || '',
      systemPrompt: pack.systemPrompt || '',
      tools: pack.tools || [],
      plugins: pack.plugins || [],
      memory: pack.memory || { conversation: true, agent: true, workspace: false, retention: 'persistent' },
      contextWindow: pack.contextWindow || 128000,
      temperature: pack.temperature ?? 0.7,
      maxTokens: pack.maxTokens || 4096,
      permissions: pack.permissions || ['READ_FILES'],
      builtin: true,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    }).run();
    log.info('seeded agent', { id: pack.id });
  }

  // ---- default workspace
  if (!db.select().from(schema.workspaces).all().length) {
    db.insert(schema.workspaces).values({
      id: randomId('ws'),
      name: 'Default Workspace',
      description: 'Local files uploaded to ForgeAI.',
      root: 'uploads',
      createdAt: now,
    }).run();
  }

  // ---- local user
  if (!db.select().from(schema.users).all().length) {
    db.insert(schema.users).values({ id: 'local', name: 'Local User', email: null, passwordHash: null, role: 'owner', createdAt: now }).run();
  }
}
