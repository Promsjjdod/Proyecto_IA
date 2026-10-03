import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { config } from '../config/env.js';
import { db, schema } from '../database/index.js';
import { encryptSecret, decryptSecret } from '../core/crypto.js';
import { notFound, badRequest } from '../core/errors.js';
import { createLogger } from '../core/logger.js';
import { getTool, invalidateToolCache } from '../tools/registry.js';
import { imageProviderStatus } from '../services/image.service.js';
import * as github from '../services/github.service.js';

const log = createLogger('plugins');

/** A plugin pack = /plugins/<id>/plugin.json (+ optional index.js exporting tools). */
export function scanPacks() {
  const dir = config.packsDir.plugins;
  if (!fs.existsSync(dir)) return [];
  const packs = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(dir, entry.name, 'plugin.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      packs.push({ ...manifest, dir: path.join(dir, entry.name), hasModule: fs.existsSync(path.join(dir, entry.name, 'index.js')) });
    } catch (err) {
      log.warn(`invalid plugin manifest in ${entry.name}`, { error: err.message });
    }
  }
  return packs;
}

const moduleCache = new Map();

/** Synchronous view used by the tool registry: builtin tools exposed by enabled plugins. */
export function enabledPluginToolsSync() {
  const rows = db.select().from(schema.plugins).where(eq(schema.plugins.status, 'enabled')).all();
  const packs = new Map(scanPacks().map((p) => [p.id, p]));
  const out = [];
  for (const row of rows) {
    const pack = packs.get(row.id);
    if (!pack) continue;
    for (const name of row.tools || []) {
      const builtin = getTool(name);
      if (builtin && !out.some((t) => t.name === name)) out.push({ ...builtin, pluginId: row.id });
    }
    if (pack.hasModule) {
      const cached = moduleCache.get(`${row.id}:tools`);
      if (cached) out.push(...cached);
    }
  }
  return out;
}

/** Async load of plugin-contributed (index.js) tools, cached. */
export async function loadPluginModuleTools(pack) {
  if (!pack.hasModule) return [];
  const key = `${pack.id}:tools`;
  if (moduleCache.has(key)) return moduleCache.get(key);
  try {
    const mod = await import(path.join(pack.dir, 'index.js'));
    const tools = typeof mod.createTools === 'function' ? mod.createTools({ config, log }) : (mod.tools || []);
    moduleCache.set(key, tools);
    return tools;
  } catch (err) {
    log.error(`plugin ${pack.id} module failed`, { error: err.message });
    moduleCache.set(key, []);
    markError(pack.id, err.message);
    return [];
  }
}

function markError(id, message) {
  db.update(schema.plugins).set({ status: 'error', updatedAt: Date.now() }).where(eq(schema.plugins.id, id)).run();
  log.error(`plugin ${id} marked as error`, { message });
}

/** Register packs found on disk into the DB (keeps user status/config). */
export function syncPlugins() {
  const packs = scanPacks();
  const seen = new Set();
  const now = Date.now();
  for (const pack of packs) {
    seen.add(pack.id);
    const existing = db.select().from(schema.plugins).where(eq(schema.plugins.id, pack.id)).get();
    if (!existing) {
      db.insert(schema.plugins).values({
        id: pack.id,
        name: pack.name,
        description: pack.description || '',
        icon: pack.icon || '▣',
        version: pack.version || '0.1.0',
        author: pack.author || 'ForgeAI',
        category: pack.category || 'Utilities',
        permissions: pack.permissions || [],
        tools: pack.tools || [],
        config: pack.defaultConfig || {},
        configSchema: pack.configSchema || { fields: [] },
        status: pack.defaultStatus === 'enabled' ? 'enabled' : pack.defaultStatus === 'disabled' ? 'disabled' : 'not_installed',
        source: 'builtin',
        installedAt: pack.defaultStatus === 'enabled' || pack.defaultStatus === 'disabled' ? now : null,
        updatedAt: now,
      }).run();
    } else {
      db.update(schema.plugins).set({
        name: pack.name,
        description: pack.description || '',
        icon: pack.icon || existing.icon,
        version: pack.version || existing.version,
        author: pack.author || existing.author,
        category: pack.category || existing.category,
        permissions: pack.permissions || [],
        tools: pack.tools || [],
        configSchema: pack.configSchema || existing.configSchema,
        updatedAt: now,
      }).where(eq(schema.plugins.id, pack.id)).run();
    }
  }
  // packs removed from disk: keep the row but flag it
  for (const row of db.select().from(schema.plugins).where(eq(schema.plugins.source, 'builtin')).all()) {
    if (!seen.has(row.id) && row.status !== 'not_installed') {
      db.update(schema.plugins).set({ status: 'error', updatedAt: now }).where(eq(schema.plugins.id, row.id)).run();
    }
  }
  recomputeStatuses();
}

/** needs_configuration wins over enabled when required config or services are missing. */
export function recomputeStatuses() {
  const packs = new Map(scanPacks().map((p) => [p.id, p]));
  for (const row of db.select().from(schema.plugins).all()) {
    if (row.status === 'not_installed' || row.status === 'disabled' || row.status === 'error') continue;
    const pack = packs.get(row.id);
    const required = pack?.requiresConfig || [];
    const missing = required.filter((f) => !row.config?.[f]);
    let serviceIssue = null;
    if (pack?.requiresService === 'image-provider') {
      const st = imageProviderStatus();
      if (!st.configured && !config.demoMode) serviceIssue = 'No image provider configured (and DEMO mode is off).';
    }
    if (pack?.requiresService === 'github') {
      const st = github.status();
      if (!st.connected && !config.github.pat) serviceIssue = 'GitHub account not connected.';
    }
    const next = missing.length ? 'needs_configuration' : serviceIssue ? 'needs_configuration' : row.status === 'installed' ? 'installed' : 'enabled';
    if (next !== row.status) {
      db.update(schema.plugins).set({ status: next, updatedAt: Date.now() }).where(eq(schema.plugins.id, row.id)).run();
    }
  }
}

export function listPlugins() {
  recomputeStatuses();
  const packs = new Map(scanPacks().map((p) => [p.id, p]));
  return db.select().from(schema.plugins).all().map((row) => ({
    ...row,
    onDisk: packs.has(row.id),
    requiresConfig: packs.get(row.id)?.requiresConfig || [],
    requiresService: packs.get(row.id)?.requiresService || null,
    readme: packs.get(row.id)?.readme || null,
  }));
}

function getRow(id) {
  const row = db.select().from(schema.plugins).where(eq(schema.plugins.id, id)).get();
  if (!row) throw notFound(`Plugin "${id}" not found.`);
  return row;
}

export function installPlugin(id) {
  const row = getRow(id);
  if (!scanPacks().some((p) => p.id === id)) throw badRequest('Plugin pack not found on disk; nothing to install.');
  db.update(schema.plugins).set({ status: 'installed', installedAt: Date.now(), updatedAt: Date.now() }).where(eq(schema.plugins.id, id)).run();
  log.info('plugin installed', { id });
  return getRow(id);
}

export function enablePlugin(id) {
  const row = getRow(id);
  if (row.status === 'not_installed') throw badRequest('Install the plugin first.');
  const pack = scanPacks().find((p) => p.id === id);
  const missing = (pack?.requiresConfig || []).filter((f) => !row.config?.[f]);
  if (missing.length) {
    db.update(schema.plugins).set({ status: 'needs_configuration', updatedAt: Date.now() }).where(eq(schema.plugins.id, id)).run();
    throw badRequest(`Plugin needs configuration: ${missing.join(', ')}.`);
  }
  db.update(schema.plugins).set({ status: 'enabled', updatedAt: Date.now() }).where(eq(schema.plugins.id, id)).run();
  invalidateToolCache();
  log.info('plugin enabled', { id });
  recomputeStatuses();
  return getRow(id);
}

export function disablePlugin(id) {
  getRow(id);
  db.update(schema.plugins).set({ status: 'disabled', updatedAt: Date.now() }).where(eq(schema.plugins.id, id)).run();
  invalidateToolCache();
  log.info('plugin disabled', { id });
  return getRow(id);
}

export function uninstallPlugin(id) {
  getRow(id);
  db.update(schema.plugins).set({ status: 'not_installed', installedAt: null, updatedAt: Date.now() }).where(eq(schema.plugins.id, id)).run();
  invalidateToolCache();
  return getRow(id);
}

export function configurePlugin(id, values) {
  const row = getRow(id);
  const pack = scanPacks().find((p) => p.id === id);
  const fields = pack?.configSchema?.fields || [];
  const next = { ...row.config };
  for (const [key, value] of Object.entries(values || {})) {
    const field = fields.find((f) => f.name === key);
    if (field?.secret) {
      next[key] = value === '' ? '' : encryptSecret(value);
      next[`${key}_set`] = Boolean(value);
    } else {
      next[key] = value;
    }
  }
  db.update(schema.plugins).set({ config: next, updatedAt: Date.now() }).where(eq(schema.plugins.id, id)).run();
  moduleCache.delete(`${id}:tools`);
  recomputeStatuses();
  return getRow(id);
}

/**
 * Collect every tool definition available to an agent run:
 * tools referenced by name + tools exposed by the agent's enabled plugins
 * (including tools defined in plugin index.js modules).
 */
export async function toolsForAgent(agent) {
  const enabledRows = db.select().from(schema.plugins).where(eq(schema.plugins.status, 'enabled')).all();
  const packs = new Map(scanPacks().map((p) => [p.id, p]));
  const wantedPlugins = new Set(agent?.plugins || []);
  const tools = [];
  const push = (t) => { if (t && !tools.some((x) => x.name === t.name)) tools.push(t); };

  for (const name of agent?.tools || []) push(getTool(name));

  for (const row of enabledRows) {
    const relevant = wantedPlugins.size === 0 || wantedPlugins.has(row.id);
    if (!relevant) continue;
    for (const name of row.tools || []) push(getTool(name));
    const pack = packs.get(row.id);
    if (pack?.hasModule) {
      for (const t of await loadPluginModuleTools(pack)) push({ ...t, pluginId: row.id });
    }
  }
  return tools.filter(Boolean);
}

/** Decrypted config map for enabled plugins: { pluginId: { field: value } }. */
export function getPluginConfigs() {
  const rows = db.select().from(schema.plugins).where(eq(schema.plugins.status, 'enabled')).all();
  const out = {};
  for (const row of rows) {
    const plain = {};
    for (const [k, v] of Object.entries(row.config || {})) {
      if (k.endsWith('_set')) continue;
      if (row.config[`${k}_set`]) {
        try { plain[k] = decryptSecret(v); } catch { plain[k] = ''; }
      } else plain[k] = v;
    }
    out[row.id] = plain;
  }
  return out;
}

/** Config of the enabled plugin that owns/exposes a given tool. */
export function pluginConfigForTool(toolName, toolPluginId) {
  const configs = getPluginConfigs();
  if (toolPluginId && configs[toolPluginId]) return configs[toolPluginId];
  const rows = db.select().from(schema.plugins).where(eq(schema.plugins.status, 'enabled')).all();
  const owner = rows.find((r) => (r.tools || []).includes(toolName));
  return owner ? configs[owner.id] : undefined;
}

/** Public config view: secret values never leave the backend. */
export function publicConfig(row) {
  const out = {};
  for (const [k, v] of Object.entries(row.config || {})) {
    if (k.endsWith('_set')) continue;
    const isSecret = Boolean(row.config[`${k}_set`]);
    out[k] = isSecret ? (v ? '••••••••' : '') : v;
  }
  return out;
}
