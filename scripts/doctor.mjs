#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = (label, ok, detail = '') => console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label}${detail ? ` — ${detail}` : ''}`);

console.log('\n\x1b[1mForgeAI doctor\x1b[0m\n');
check(`Node.js ${process.versions.node}`, process.versions.node >= '22.12.0' || Number(process.versions.node.split('.')[0]) > 22, '>= 22.12 required');
check('.env exists', fs.existsSync(path.join(ROOT, '.env')), 'run npm run setup');
check('dependencies installed', fs.existsSync(path.join(ROOT, 'node_modules', 'express')) && fs.existsSync(path.join(ROOT, 'node_modules', 'vite')));
check('database file', fs.existsSync(path.join(ROOT, 'data', 'forgeai.db')), 'created on first run');
check('brand assets', fs.existsSync(path.join(ROOT, 'assets', 'brand', 'logo-main.png')));
check('plugin packs', fs.existsSync(path.join(ROOT, 'plugins')), '9 builtin packs expected');

const portFree = (port) => new Promise((resolve) => {
  const srv = net.createServer();
  srv.once('error', () => resolve(false));
  srv.once('listening', () => srv.close(() => resolve(true)));
  srv.listen(port, '127.0.0.1');
});
const free8000 = await portFree(8000);
const free3000 = await portFree(3000);
check('port 8000 free', free8000, free8000 ? '' : 'another process is using it (FORGEAI_PORT to change)');
check('port 3000 free', free3000, free3000 ? '' : 'another process is using it (FORGEAI_FRONTEND_PORT to change)');
console.log('');
