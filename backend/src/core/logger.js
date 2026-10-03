import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/env.js';

const LEVELS = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };

export function redact(value) {
  if (typeof value === 'string') {
    return value
      .replace(/("(?:api[_-]?key|apikey|token|secret|password|authorization|client[_-]?secret)"\s*:\s*")([^"]+)(")/gi, '$1[redacted]$3')
      .replace(/\b(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|gho_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,})\b/g, '[redacted]');
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const isSecret = /api[_-]?key|apikey|token|secret|password|authorization|pat$/i.test(k);
      out[k] = isSecret && typeof v === 'string' && v ? '[redacted]' : redact(v);
    }
    return out;
  }
  return value;
}

let logStream = null;
let streamFailed = false;
function ensureStream() {
  if (logStream || streamFailed || config.isTest) return logStream;
  try {
    fs.mkdirSync(config.logsDir, { recursive: true });
    const file = path.join(config.logsDir, `forgeai-${new Date().toISOString().slice(0, 10)}.log`);
    logStream = fs.createWriteStream(file, { flags: 'a' });
    logStream.on('error', () => { streamFailed = true; logStream = null; });
  } catch {
    streamFailed = true;
    logStream = null;
  }
  return logStream;
}

/** Ring buffer for the System Status / Logs UI (secrets already redacted). */
const ring = [];
const RING_MAX = 500;

export function recentLogs(limit = 200, level) {
  const items = level ? ring.filter((r) => r.level === level) : ring.slice();
  return items.slice(-limit).reverse();
}

function write(level, scope, message, meta) {
  const threshold = LEVELS[config.logLevel] ?? LEVELS.INFO;
  const entry = {
    ts: new Date().toISOString(),
    level,
    scope,
    message: redact(String(message)),
    ...(meta !== undefined ? { meta: redact(meta) } : {}),
  };
  if (LEVELS[level] >= threshold) {
    ring.push(entry);
    if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
    const line = JSON.stringify(entry);
    const stream = ensureStream();
    if (stream) stream.write(line + '\n');
    const paint =
      level === 'ERROR' ? '\x1b[31m' : level === 'WARN' ? '\x1b[33m' : level === 'DEBUG' ? '\x1b[90m' : '\x1b[36m';
    const text = `${entry.ts} ${paint}${level.padEnd(5)}\x1b[0m [${scope}] ${entry.message}${entry.meta !== undefined ? ' ' + JSON.stringify(entry.meta) : ''}`;
    if (level === 'ERROR') console.error(text);
    else if (level === 'WARN') console.warn(text);
    else console.log(text);
  }
}

export function createLogger(scope) {
  return {
    debug: (msg, meta) => write('DEBUG', scope, msg, meta),
    info: (msg, meta) => write('INFO', scope, msg, meta),
    warn: (msg, meta) => write('WARN', scope, msg, meta),
    error: (msg, meta) => write('ERROR', scope, msg, meta),
  };
}

export const log = createLogger('forgeai');
