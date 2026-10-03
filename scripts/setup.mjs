#!/usr/bin/env node
/**
 * ForgeAI first-run setup.
 * Checks Node/npm, creates .env, installs dependencies, migrates and seeds.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const fail = (m) => { console.error(`  \x1b[31m✗\x1b[0m ${m}`); process.exit(1); };

console.log('\n\x1b[1mForgeAI setup\x1b[0m — Build. Think. Create.\n');

// 1. Node / npm
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  fail(`Node.js >= 22.12 is required (found ${process.versions.node}). Install from https://nodejs.org`);
}
ok(`Node.js ${process.versions.node}`);
const npm = spawnSync('npm', ['--version'], { encoding: 'utf8' });
if (npm.status !== 0) fail('npm not found in PATH.');
ok(`npm ${npm.stdout.trim()}`);

// 2. .env
const envPath = path.join(ROOT, '.env');
if (!fs.existsSync(envPath)) {
  fs.copyFileSync(path.join(ROOT, '.env.example'), envPath);
  // generate a real secret key so sessions/encryption are safe out of the box
  const secret = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  let content = fs.readFileSync(envPath, 'utf8');
  content = content.replace('FORGEAI_SECRET_KEY=change-me-to-a-64-char-hex-string', `FORGEAI_SECRET_KEY=${secret}`);
  fs.writeFileSync(envPath, content);
  ok('Created .env from .env.example (with a generated secret key).');
} else {
  ok('.env already present - left untouched.');
}

// 3. Dependencies
if (!fs.existsSync(path.join(ROOT, 'node_modules', 'express')) || !fs.existsSync(path.join(ROOT, 'node_modules', 'vite'))) {
  console.log('  … installing dependencies (first run can take a minute)');
  const inst = spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: ROOT, stdio: 'inherit' });
  if (inst.status !== 0) fail('npm install failed. See output above.');
  ok('Dependencies installed.');
} else {
  ok('Dependencies already installed.');
}

// 4. Runtime dirs
for (const dir of ['data', 'data/logs', 'uploads', 'generated/images', 'generated/videos']) {
  fs.mkdirSync(path.join(ROOT, dir), { recursive: true });
}
ok('Runtime directories ready (data/, uploads/, generated/).');

// 5. Database migrations + seed + plugin sync
const boot = spawnSync(process.execPath, ['scripts/migrate.mjs'], { cwd: ROOT, stdio: 'inherit' });
if (boot.status !== 0) fail('Database migration failed.');
ok('Database migrated & seeded.');

console.log(`
\x1b[1mSetup complete.\x1b[0m

  Start everything with:
    npm run dev          (or start.bat on Windows)

  Then open:
    http://localhost:3000

  Optional next steps:
    - install Ollama (https://ollama.com) and pull a model - ForgeAI detects it automatically
    - add an OpenAI-compatible API key in Settings → Providers
    - enable LAN access: set FORGEAI_LAN=true in .env (or npm run dev:lan)
`);
