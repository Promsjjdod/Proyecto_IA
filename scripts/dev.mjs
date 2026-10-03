#!/usr/bin/env node
/**
 * ForgeAI dev launcher: backend (8000) + frontend (3000) with clean shutdown.
 * Flags: --backend-only | --frontend-only | --lan
 */
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const backendOnly = args.includes('--backend-only');
const frontendOnly = args.includes('--frontend-only');
const lan = args.includes('--lan');

// load .env so both children (and the vite config) see the same settings
const env = { ...process.env };
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in env)) env[m[1]] = m[2];
  }
}
if (lan) env.FORGEAI_LAN = 'true';

const children = [];
function start(name, command, cmdArgs, color) {
  const child = spawn(command, cmdArgs, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        out(prefix + line);
      }
    });
  };
  pipe(child.stdout, (l) => process.stdout.write(l + '\n'));
  pipe(child.stderr, (l) => process.stderr.write(l + '\n'));
  child.on('exit', (code) => {
    process.stdout.write(`${prefix} exited with code ${code}\n`);
    shutdown(code ?? 0);
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try { c.kill('SIGTERM'); } catch { /* already dead */ }
  }
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

function lanIps() {
  const out = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

const port = Number(env.FORGEAI_PORT || 8000);
const fePort = Number(env.FORGEAI_FRONTEND_PORT || 3000);

console.log('\n\x1b[1mForgeAI dev mode\x1b[0m');
if (!fs.existsSync(path.join(ROOT, '.env'))) {
  console.log('  \x1b[33m!\x1b[0m no .env found - run: npm run setup');
}
if (!backendOnly) start('frontend', 'npm', ['run', 'dev', '--workspace', 'frontend'], '36');
if (!frontendOnly) start('backend', process.execPath, [path.join(ROOT, 'backend', 'src', 'server.js')], '33');

setTimeout(() => {
  console.log(`
  Frontend  →  http://localhost:${fePort}
  Backend   →  http://localhost:${port}/api   (health: /api/health)
${lan || env.FORGEAI_LAN === 'true' ? lanIps().map((ip) => `  LAN       →  http://${ip}:${fePort}\n`).join('') : '  LAN access off (npm run dev:lan to enable on your local network)'}
  Ctrl+C stops both servers.
`);
}, 1200);
