import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { config } from '../config/env.js';
import { defineTool, cap, toolResult } from './base.js';
import { filesystemTools } from './filesystem.js';
import { terminalTools } from './terminal.js';
import { calculatorTools } from './calculator.js';
import { networkTools } from './network.js';
import { workspaceTools, githubTools } from './workspace.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('tools');

/**
 * Declarative tool packs live in /tools at the repository root: JSON files
 * describing HTTP-based tools that run through the same permission system.
 */
function loadDeclarativeTools() {
  const dir = config.packsDir.tools;
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    try {
      const pack = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (!pack?.id || pack.kind !== 'http') continue;
      out.push(buildHttpTool(pack));
    } catch (err) {
      log.warn(`could not load tool pack ${file}`, { error: err.message });
    }
  }
  return out;
}

function buildHttpTool(pack) {
  const fields = {};
  const jsonSchemaProps = {};
  for (const f of pack.input || []) {
    const desc = f.description || f.name;
    if (f.type === 'number') fields[f.name] = z.number({ description: desc });
    else if (f.type === 'boolean') fields[f.name] = z.boolean({ description: desc });
    else fields[f.name] = z.string({ description: desc }).max(4000);
    if (!f.optional) fields[f.name] = f.type === 'number' ? z.number(desc) : f.type === 'boolean' ? z.boolean(desc) : z.string(desc).min(1).max(4000);
    jsonSchemaProps[f.name] = { type: f.type === 'number' ? 'number' : f.type === 'boolean' ? 'boolean' : 'string', description: desc };
  }
  const tool = defineTool({
    name: pack.id,
    description: pack.description || pack.id,
    permissions: pack.permissions || ['NETWORK_ACCESS'],
    dangerous: Boolean(pack.dangerous),
    source: 'pack',
    schema: z.object(fields),
    async execute(args) {
      const url = interpolate(pack.endpoint?.url || '', args);
      const method = pack.endpoint?.method || 'GET';
      const headers = Object.fromEntries(Object.entries(pack.endpoint?.headers || {}).map(([k, v]) => [k, interpolate(String(v), args)]));
      const body = pack.endpoint?.body ? interpolate(pack.endpoint.body, args) : undefined;
      const res = await fetch(url, { method, headers, ...(body ? { body } : {}), signal: AbortSignal.timeout(20000) });
      const text = await res.text();
      return toolResult(`${pack.id} -> HTTP ${res.status}`, { status: res.status, body: cap(text, 8000) });
    },
  });
  const original = tool.toFunctionDef.bind(tool);
  tool.toFunctionDef = () => {
    const def = original();
    def.function.parameters = { type: 'object', properties: jsonSchemaProps, required: (pack.input || []).filter((f) => !f.optional).map((f) => f.name) };
    return def;
  };
  return tool;
}

function interpolate(template, args) {
  return String(template).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, key) => {
    const v = args[key];
    return v === undefined ? '' : encodeURIComponent(String(v));
  });
}

const builtinTools = [
  ...filesystemTools,
  ...terminalTools,
  ...calculatorTools,
  ...networkTools,
  ...workspaceTools,
  ...githubTools,
];

let cache = null;

/** All tools: builtin + declarative packs + tools contributed by enabled plugins. */
export function allTools({ includeDisabledPlugins = false, pluginTools = [] } = {}) {
  if (!cache) cache = [...builtinTools, ...loadDeclarativeTools()];
  return [...cache, ...pluginTools];
}

export function invalidateToolCache() {
  cache = null;
}

export function getTool(name, extra = []) {
  return allTools({ pluginTools: extra }).find((t) => t.name === name) || null;
}

export function toolCatalog() {
  return allTools().map((t) => ({
    name: t.name,
    description: t.description,
    permissions: t.permissions,
    dangerous: t.dangerous,
    source: t.source,
    pluginId: t.pluginId,
  }));
}
