#!/usr/bin/env node
/**
 * ForgeAI production-ish start:
 *  - migrates/seeds the database
 *  - builds the frontend if needed
 *  - serves the built SPA on FORGEAI_FRONTEND_PORT with /api proxied to the backend
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
process.env.FORGEAI_ENV = process.env.FORGEAI_ENV || 'production';

const PORT = Number(process.env.FORGEAI_PORT || 8000);
const FE_PORT = Number(process.env.FORGEAI_FRONTEND_PORT || 3000);
const LAN = process.env.FORGEAI_LAN === 'true';
const HOST = LAN ? '0.0.0.0' : (process.env.FORGEAI_HOST || '127.0.0.1');

console.log('\x1b[1mForgeAI start\x1b[0m (production mode)');

const mig = spawnSync(process.execPath, ['scripts/migrate.mjs'], { cwd: ROOT, stdio: 'inherit' });
if (mig.status !== 0) process.exit(1);

const dist = path.join(ROOT, 'frontend', 'dist');
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.log('Building frontend…');
  const build = spawnSync('npm', ['run', 'build', '--workspace', 'frontend'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (build.status !== 0) process.exit(1);
}

const backend = spawn(process.execPath, ['backend/src/server.js'], { cwd: ROOT, stdio: 'inherit', env: process.env });
backend.on('exit', (code) => process.exit(code ?? 0));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.map': 'application/json',
};

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  if (url.startsWith('/api')) {
    try {
      const headers = { ...req.headers, host: `127.0.0.1:${PORT}` };
      delete headers['content-length'];
      const upstream = await fetch(`http://127.0.0.1:${PORT}${url}`, {
        method: req.method,
        headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : req,
        // @ts-expect-error node allows duplex streaming bodies
        duplex: 'half',
      });
      res.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
      if (!upstream.body) { res.end(); return; }
      const reader = upstream.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    } catch {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'BACKEND_UNREACHABLE', message: 'The ForgeAI backend is not responding on port ' + PORT } }));
    }
    return;
  }
  let file = path.join(dist, url.split('?')[0]);
  if (!file.startsWith(dist)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
  const ext = path.extname(file);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' });
  fs.createReadStream(file).pipe(res);
});

server.listen(FE_PORT, HOST, () => {
  console.log(`\n  ForgeAI is running:
    App      →  http://localhost:${FE_PORT}
    API      →  http://localhost:${PORT}/api
${LAN ? '    LAN      →  enabled (0.0.0.0)\n' : ''}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { backend.kill(sig); server.close(); process.exit(0); });
}
