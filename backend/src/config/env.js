import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repository root (the folder that contains backend/, frontend/, ...) */
export const REPO_ROOT = path.resolve(here, '..', '..', '..');

dotenv.config({ path: path.join(REPO_ROOT, '.env'), quiet: true });

function str(key, fallback = '') {
  const v = process.env[key];
  return v === undefined || v === null || v === '' ? fallback : v;
}
function bool(key, fallback = false) {
  const v = str(key, '').trim().toLowerCase();
  if (v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v);
}
function int(key, fallback) {
  const n = parseInt(str(key, ''), 10);
  return Number.isFinite(n) ? n : fallback;
}
function list(key, fallback = []) {
  const v = str(key, '');
  if (!v.trim()) return fallback;
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

const envName = str('FORGEAI_ENV', 'development');
const isTest = envName === 'test' || process.env.NODE_ENV === 'test';

/**
 * LAN access: bind to 0.0.0.0 so other devices on the same network can reach
 * the app. Never touches firewall / Internet exposure.
 */
const lanEnabled = bool('FORGEAI_LAN', false);

export const config = {
  env: envName,
  isTest,
  isProd: envName === 'production',
  version: JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version,
  app: {
    name: 'ForgeAI',
    tagline: 'Build. Think. Create.',
  },
  // LAN mode wins over FORGEAI_HOST: binding 0.0.0.0 on a private network is
  // what makes http://IP-LOCAL:port reachable from other devices.
  host: lanEnabled ? '0.0.0.0' : str('FORGEAI_HOST', '127.0.0.1'),
  port: int('FORGEAI_PORT', 8000),
  frontendPort: int('FORGEAI_FRONTEND_PORT', 3000),
  lan: lanEnabled,
  logLevel: str('FORGEAI_LOG_LEVEL', isTest ? 'ERROR' : 'INFO').toUpperCase(),
  corsOrigins: list('FORGEAI_CORS_ORIGINS', [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]),
  dbPath: path.isAbsolute(str('FORGEAI_DB_PATH', ''))
    ? str('FORGEAI_DB_PATH')
    : path.join(REPO_ROOT, str('FORGEAI_DB_PATH', isTest ? 'data/test-forgeai.db' : 'data/forgeai.db')),
  secretKey: str('FORGEAI_SECRET_KEY', ''),
  authPassword: str('FORGEAI_AUTH_PASSWORD', ''),
  rateLimitMax: int('FORGEAI_RATE_LIMIT_MAX', 600),
  demoMode: bool('FORGEAI_DEMO_MODE', true),
  uploadsDir: path.join(REPO_ROOT, 'uploads'),
  generatedDir: path.join(REPO_ROOT, 'generated'),
  imagesDir: path.join(REPO_ROOT, 'generated', 'images'),
  videosDir: path.join(REPO_ROOT, 'generated', 'videos'),
  logsDir: path.join(REPO_ROOT, 'data', 'logs'),
  dataDir: path.join(REPO_ROOT, 'data'),
  packsDir: {
    agents: path.join(REPO_ROOT, 'agents'),
    plugins: path.join(REPO_ROOT, 'plugins'),
    providers: path.join(REPO_ROOT, 'providers'),
    tools: path.join(REPO_ROOT, 'tools'),
  },
  workspaceRoot: path.resolve(REPO_ROOT, str('FORGEAI_WORKSPACE_ROOT', '')),
  terminalAllowlist: list('FORGEAI_TERMINAL_ALLOWLIST', [
    'ls', 'cat', 'rg', 'grep', 'node', 'npm', 'git', 'python3', 'tsc', 'vite',
  ]),
  toolPermissions: list('FORGEAI_TOOL_PERMISSIONS', ['READ_FILES', 'NETWORK_ACCESS']),
  ollamaBaseUrl: str('OLLAMA_BASE_URL', 'http://localhost:11434'),
  github: {
    clientId: str('GITHUB_CLIENT_ID', ''),
    clientSecret: str('GITHUB_CLIENT_SECRET', ''),
    pat: str('GITHUB_PAT', ''),
    callbackUrl: `http://localhost:${int('FORGEAI_PORT', 8000)}/api/github/oauth/callback`,
  },
};

/** All permission groups known to the permission system. */
export const PERMISSIONS = [
  'READ_FILES',
  'WRITE_FILES',
  'EXECUTE_COMMANDS',
  'NETWORK_ACCESS',
  'GITHUB_ACCESS',
];

export function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
    }
  }
  return out;
}
