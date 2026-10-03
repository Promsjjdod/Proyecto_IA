import { eq } from 'drizzle-orm';
import { db, schema } from '../database/index.js';
import { decryptSecret, maskSecret } from '../core/crypto.js';
import { notFound } from '../core/errors.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { OllamaProvider } from './ollama.js';
import { CustomProvider } from './custom.js';
import { DemoProvider } from './demo.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('providers');

const KINDS = {
  'openai-compatible': OpenAICompatibleProvider,
  ollama: OllamaProvider,
  custom: CustomProvider,
  demo: DemoProvider,
};

export const PROVIDER_KINDS = Object.keys(KINDS);

export function getProviderRecord(id) {
  const rec = db.select().from(schema.providers).where(eq(schema.providers.id, id)).get();
  if (!rec) throw notFound(`Provider "${id}" not found.`);
  return rec;
}

export function listProviderRecords() {
  return db.select().from(schema.providers).all();
}

/** Build an adapter instance for a provider record (API key decrypted in memory only). */
export function getAdapter(recordOrId) {
  const record = typeof recordOrId === 'string' ? getProviderRecord(recordOrId) : recordOrId;
  const Cls = KINDS[record.kind];
  if (!Cls) throw notFound(`Unknown provider kind "${record.kind}".`);
  let apiKey = null;
  try {
    apiKey = record.apiKeyEnc ? decryptSecret(record.apiKeyEnc) : null;
  } catch (err) {
    log.warn('could not decrypt provider key', { provider: record.id, error: err.message });
  }
  return new Cls(record, { apiKey });
}

/** Default provider = flagged default, else first enabled, else demo (if demo mode). */
export function resolveDefaultProvider() {
  const all = listProviderRecords();
  const enabled = all.filter((p) => p.enabled);
  const def = enabled.find((p) => p.isDefault) || enabled[0];
  return def || null;
}

/** Public shape: never includes the raw API key. */
export function publicProvider(record) {
  let apiKey = null;
  try { apiKey = record.apiKeyEnc ? decryptSecret(record.apiKeyEnc) : null; } catch { apiKey = null; }
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    baseUrl: record.baseUrl,
    apiVersion: record.apiVersion,
    hasApiKey: Boolean(apiKey),
    apiKeyMasked: apiKey ? maskSecret(apiKey) : null,
    headers: record.headers || {},
    bodyParams: record.bodyParams || {},
    contextWindow: record.contextWindow,
    tags: record.tags || [],
    icon: record.icon,
    pricingInput: record.pricingInput,
    pricingOutput: record.pricingOutput,
    enabled: record.enabled,
    isDefault: record.isDefault,
    responseMode: record.responseMode,
    chatPath: record.chatPath,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Quick connectivity probe used by Settings and System Status. */
export async function probeProvider(record) {
  const adapter = getAdapter(record);
  const started = Date.now();
  try {
    if (record.kind === 'demo') {
      return { ok: true, latencyMs: Date.now() - started, models: await adapter.listModels(), message: 'Demo provider (simulated).' };
    }
    const models = await adapter.listModels();
    return { ok: true, latencyMs: Date.now() - started, models, message: models.length ? `${models.length} model(s) reachable.` : 'Reachable (no model list exposed).' };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - started, models: [], message: err.message };
  }
}
