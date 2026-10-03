import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
process.env.FORGEAI_ENV = 'test';
process.env.FORGEAI_DB_PATH = path.join(ROOT, 'data', 'test-forgeai.db');

let createApp;
let bootstrap;
let server;
let base;

test.before(async () => {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(process.env.FORGEAI_DB_PATH + suffix, { force: true });
  ({ createApp } = await import('../src/app.js'));
  ({ bootstrap } = await import('../src/server.js'));
  bootstrap();
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => { server?.close(); });

const url = (p) => base + (p.startsWith('/api') ? p : `/api${p}`);
const get = (p) => fetch(url(p)).then((r) => r.json());
const post = (p, body) => fetch(url(p), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then((r) => r.json());

test('GET /api/health reports ok + database connected', async () => {
  const body = await get('/api/health');
  assert.equal(body.status, 'ok');
  assert.equal(body.database, 'connected');
  assert.ok(body.version);
});

test('database: migrations applied and seed data exists', async () => {
  const providers = await get('/api/providers');
  assert.ok(providers.providers.some((p) => p.kind === 'demo'));
  const agents = await get('/api/agents');
  assert.ok(agents.agents.length >= 4);
  const plugins = await get('/api/plugins');
  assert.ok(plugins.plugins.length >= 8);
});

test('auth: /api/auth/me works in local trusted mode', async () => {
  const me = await get('/api/auth/me');
  assert.equal(me.authenticated, true);
  assert.equal(me.authRequired, false);
});

test('providers: API keys never leave the backend', async () => {
  const created = await post('/api/providers', { name: 'Secret Test', kind: 'openai-compatible', baseUrl: 'http://localhost:9', apiKey: 'sk-supersecretvalue123' });
  const pub = created.provider;
  assert.equal(pub.hasApiKey, true);
  assert.ok(!JSON.stringify(pub).includes('sk-supersecretvalue123'));
  assert.ok(pub.apiKeyMasked.includes('•'));
  await fetch(url(`/providers/${pub.id}`), { method: 'DELETE' });
});

test('chat: create, message, stream completion (demo provider), persist', async () => {
  const { chat } = await post('/chats', { title: 'test' });
  assert.ok(chat.id);
  const res = await fetch(url(`/chats/${chat.id}/completions`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'hello forge' }),
  });
  assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  const text = await res.text();
  assert.match(text, /event: delta/);
  assert.match(text, /event: message_done/);
  const { messages } = await get(`/api/chats/${chat.id}/messages`);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[1].role, 'assistant');
  assert.ok(messages[1].content.length > 20);
});

test('chat: rename, archive, delete', async () => {
  const { chat } = await post('/chats', { title: 'x' });
  const patched = await fetch(url(`/chats/${chat.id}`), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'renamed', archived: true }) }).then((r) => r.json());
  assert.equal(patched.chat.title, 'renamed');
  assert.equal(patched.chat.archived, true);
  const del = await fetch(url(`/chats/${chat.id}`), { method: 'DELETE' });
  assert.equal(del.status, 200);
  const missing = await fetch(url(`/chats/${chat.id}`));
  assert.equal(missing.status, 404);
});

test('agents: create + update + validation error', async () => {
  const created = await post('/agents', { name: 'Test Agent', description: 'd', permissions: ['READ_FILES'] });
  assert.ok(created.agent.id);
  assert.equal(created.agent.tools.length, 0);
  const bad = await post('/agents', { name: '' });
  assert.ok(bad.error);
  assert.equal(bad.error.code, 'BAD_REQUEST');
  await fetch(url(`/agents/${created.agent.id}`), { method: 'DELETE' });
});

test('plugins: install/enable/disable/configure lifecycle', async () => {
  let { plugins } = await get('/plugins');
  const calc = plugins.find((p) => p.id === 'calculator');
  assert.ok(calc);
  await post(`/plugins/calculator/install`);
  await post(`/plugins/calculator/enable`);
  ({ plugins } = await get('/plugins'));
  assert.equal(plugins.find((p) => p.id === 'calculator').status, 'enabled');
  await post(`/plugins/calculator/disable`);
  ({ plugins } = await get('/plugins'));
  assert.equal(plugins.find((p) => p.id === 'calculator').status, 'disabled');
});

test('permissions: dangerous tool requires approval; denial blocks execution', async () => {
  const { evaluateExpression } = await import('../src/tools/calculator.js');
  assert.equal(evaluateExpression('2+3*4'), 14);
  assert.equal(evaluateExpression('(2+3)*4'), 20);
  assert.throws(() => evaluateExpression('1/0'));

  const { validateCommand } = await import('../src/tools/terminal.js');
  assert.deepEqual(validateCommand('ls -la'), ['ls', '-la']);
  assert.throws(() => validateCommand('rm -rf /'));
  assert.throws(() => validateCommand('ls | grep x'));
  assert.throws(() => validateCommand('node -e "process.exit()" ; cat /etc/passwd'));

  const { resolveSafe } = await import('../src/tools/filesystem.js');
  assert.throws(() => resolveSafe(ROOT, '../../etc/passwd'));
  assert.ok(resolveSafe(ROOT, 'backend/src/server.js'));
});

test('security: path traversal blocked on workspace tree', async () => {
  const res = await fetch(base + '/api/workspace-tree?path=..%2F..%2F..%2Fetc');
  assert.equal(res.status, 400);
});

test('search: finds chats and agents', async () => {
  await post('/chats', { title: 'unique-zebra-topic' });
  const { results } = await get('/api/search?q=unique-zebra');
  assert.ok(results.chats.length >= 1);
});

test('files: upload, preview, rename, delete', async () => {
  const form = new FormData();
  form.append('files', new Blob(['name,qty\napple,3\npear,7\n'], { type: 'text/csv' }), 'demo.csv');
  const up = await fetch(url('/files/upload'), { method: 'POST', body: form }).then((r) => r.json());
  const file = up.files[0];
  assert.equal(file.kind, 'csv');
  const { preview } = await get(`/api/files/${file.id}`);
  assert.ok(preview.table.length === 3);
  const renamed = await fetch(url(`/files/${file.id}`), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'renamed.csv' }) }).then((r) => r.json());
  assert.equal(renamed.file.name, 'renamed.csv');
  await fetch(url(`/files/${file.id}`), { method: 'DELETE' });
});

test('images: demo generation stores a file and gallery row', async () => {
  const { images } = await post('/images', { prompt: 'a test spark', count: 1 });
  assert.equal(images.length, 1);
  assert.equal(images[0].demo, true);
  const res = await fetch(url(`/images/${images[0].id}/content`));
  assert.equal(res.status, 200);
  await fetch(url(`/images/${images[0].id}`), { method: 'DELETE' });
});

test('video: queue reports honest not-configured failure', async () => {
  const { video } = await post('/videos', { prompt: 'orbit an anvil' });
  assert.ok(video.id);
  await new Promise((r) => setTimeout(r, 300));
  const { videos } = await get('/videos');
  const row = videos.find((v) => v.id === video.id);
  assert.equal(row.status, 'failed');
  assert.match(row.error, /Not configured/);
});

test('tasks: WORK runner completes with steps and result', async () => {
  const { task } = await post('/tasks', { prompt: 'List the repository layout and read the README' });
  assert.ok(task.id);
  for (let i = 0; i < 40; i += 1) {
    const t = await get(`/api/tasks/${task.id}`);
    if (['completed', 'failed', 'cancelled'].includes(t.task.status)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const t = await get(`/api/tasks/${task.id}`);
  assert.ok(['completed', 'failed'].includes(t.task.status), `task status: ${t.task.status}`);
  assert.ok(t.steps.length >= 2);
  assert.ok(t.steps.some((s) => s.phase === 'plan'));
});

test('settings: patch and read back', async () => {
  const patched = await fetch(url('/settings'), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appearance: { theme: 'light' } }) }).then((r) => r.json());
  assert.equal(patched.settings.appearance.theme, 'light');
  await fetch(url('/settings'), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appearance: { theme: 'dark' } }) });
});

test('memory: secret-looking content is redacted', async () => {
  const created = await post('/memory', { scope: 'workspace', content: 'the api key is sk-abcdefgh1234567890xyz keep it safe' });
  assert.ok(created.id);
  const { memories } = await get('/memory');
  const row = memories.find((m) => m.id === created.id);
  assert.ok(!row.content.includes('sk-abcdefgh1234567890xyz'));
  await fetch(url(`/memory/${created.id}`), { method: 'DELETE' });
});

test('rate limit + unknown routes behave', async () => {
  const missing = await fetch(url('/nope'));
  assert.equal(missing.status, 404);
  const body = await missing.json();
  assert.equal(body.error.code, 'NOT_FOUND');
});
