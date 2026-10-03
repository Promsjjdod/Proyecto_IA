import { eq } from 'drizzle-orm';
import { db, schema } from '../database/index.js';

export const DEFAULT_SETTINGS = {
  general: {
    appName: 'ForgeAI',
    tagline: 'Build. Think. Create.',
    language: 'en',
    demoBanner: true,
  },
  appearance: {
    theme: 'system', // dark | light | system
    accent: 'ember', // ember | cobalt | moss | violet
    density: 'comfortable', // comfortable | compact
    sidebarCollapsed: false,
    fontSize: 15,
    codeFontSize: 13,
  },
  models: {
    defaultProviderId: '',
    defaultModel: '',
    showTokenStats: true,
    showSpeed: true,
  },
  memory: {
    conversationMemory: true,
    agentMemory: true,
    workspaceMemory: false,
    maxConversationMessages: 24,
  },
  files: {
    maxUploadMb: 25,
    previewMaxKb: 1024,
  },
  security: {
    toolPermissions: null, // null = use env default
    requireApprovalForDangerous: true,
    rateLimitMax: null,
  },
  advanced: {
    streamResponses: true,
    toolLoopMaxIterations: 6,
    logLevel: null,
  },
};

export function getSettings() {
  const rows = db.select().from(schema.settings).all();
  const out = structuredClone(DEFAULT_SETTINGS);
  for (const row of rows) {
    if (out[row.key] && typeof out[row.key] === 'object' && !Array.isArray(out[row.key])) {
      out[row.key] = { ...out[row.key], ...(row.value || {}) };
    } else {
      out[row.key] = row.value;
    }
  }
  return out;
}

export function getSetting(section, key, fallback) {
  const all = getSettings();
  const value = all?.[section]?.[key];
  return value === undefined || value === null ? fallback : value;
}

export function updateSettings(patch) {
  const now = Date.now();
  for (const [section, values] of Object.entries(patch || {})) {
    if (!DEFAULT_SETTINGS[section]) continue;
    const current = getSettings()[section] || {};
    const next = { ...current, ...(typeof values === 'object' && values !== null ? values : { value: values }) };
    db.insert(schema.settings)
      .values({ key: section, value: next, updatedAt: now })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value: next, updatedAt: now } })
      .run();
  }
  return getSettings();
}
