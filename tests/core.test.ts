import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ai-tests-'));
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = testDataDir;
process.env.PROVIDER_ENCRYPTION_KEY = 'test-only-key-that-is-never-used-outside-this-process';
process.env.OLLAMA_ALLOWED_URLS = 'http://localhost:11434,http://127.0.0.1:11434,http://[::1]:11434';

const { db } = await import('../server/db.js');
const { encryptSecret, decryptSecret } = await import('../server/security.js');
const safety = await import('../server/providers/safety.js');
const paths = await import('../server/workspaces/paths.js');
const { executeWorkflow, validateWorkflow } = await import('../server/workflows/engine.js');
const { PROJECT_DIR, UPLOAD_DIR, budgetForMode } = await import('../server/config.js');
const { cleanupUnreferencedAttachments } = await import('../server/uploads.js');
const { reserveUsage, settleUsage } = await import('../server/usage.js');

function insertTestUser(email: string) {
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)')
    .run(id, email, 'Test user', 'test-hash', 'user', new Date().toISOString());
  return db.prepare('SELECT * FROM users WHERE id=?').get(id) as any;
}

async function listen(server: http.Server, host = '127.0.0.1') {
  server.listen(0, host);
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return address.port;
}

async function close(server: http.Server) {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

after(() => {
  db.close();
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

test('credential encryption, provider allowlists, and DNS-pinned requests', async (t) => {
  assert.deepEqual(budgetForMode('MAX', 4096), { outputTokens: 3584, inputContextTokens: 512 });
  assert.equal(budgetForMode('MAX', 256).outputTokens, 0);
  const encrypted = encryptSecret('test-secret-value');
  assert.notEqual(encrypted, 'test-secret-value');
  assert.equal(decryptSecret(encrypted), 'test-secret-value');

  assert.equal(safety.isPrivateAddress('127.0.0.1'), true);
  assert.equal(safety.isPrivateAddress('10.12.0.9'), true);
  assert.equal(safety.isPrivateAddress('::1'), true);
  assert.equal(safety.isPrivateAddress('203.0.113.20'), true);
  await assert.rejects(safety.validateProviderBase({ type: 'ollama', base_url: 'http://127.0.0.1:11435' }), /no está permitida/i);
  process.env.OLLAMA_ALLOWED_URLS = 'http://metadata.google.internal:11434';
  await assert.rejects(safety.validateProviderBase({ type: 'ollama', base_url: 'http://metadata.google.internal:11434' }), /metadatos de nube/i);
  await assert.rejects(safety.validateProviderBase({ type: 'openai', base_url: 'http://api.example.com/v1' }), /HTTPS/i);
  process.env.OLLAMA_ALLOWED_URLS = 'http://localhost:11434,http://127.0.0.1:11434,http://[::1]:11434';
  await assert.rejects(safety.safeExternalFetch(new URL('https://127.0.0.1/')), /dirección pública/i);

  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' }).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('pinned-response');
  });
  const port = await listen(server, '::');
  t.after(() => close(server));
  const origin = `http://localhost:${port}`;
  process.env.OLLAMA_ALLOWED_URLS = origin;
  const provider = { id: 'provider-test', user_id: 'user-test', type: 'ollama', name: 'Local test', base_url: origin, secret_encrypted: '', auth_config_json: '{}' };
  const response = await safety.safeProviderFetch(provider, new URL(`${origin}/health`));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'pinned-response');
  await assert.rejects(safety.safeProviderFetch(provider, new URL(`${origin}/redirect`)), /redirección bloqueada/i);
  await close(server);
  process.env.OLLAMA_ALLOWED_URLS = 'http://localhost:11434,http://127.0.0.1:11434,http://[::1]:11434';
});

test('usage settlement refunds unused reservations and cannot exceed account quotas', () => {
  const cappedUser = insertTestUser('quota-cap@nexus.test');
  db.prepare('UPDATE users SET credits=500,daily_limit=100,monthly_limit=100 WHERE id=?').run(cappedUser.id);
  const limitedUser = db.prepare('SELECT * FROM users WHERE id=?').get(cappedUser.id) as any;
  const cappedReservation = reserveUsage(limitedUser, crypto.randomUUID(), 'test', 10, 90);
  settleUsage(cappedUser.id, cappedReservation, 500);
  const cappedUsage = db.prepare('SELECT credits,status,meta_json FROM usage WHERE id=?').get(cappedReservation.id) as any;
  assert.equal(cappedUsage.credits, 100);
  assert.equal(cappedUsage.status, 'complete');
  assert.equal(JSON.parse(cappedUsage.meta_json).quotaCapped, true);
  assert.equal((db.prepare('SELECT credits FROM users WHERE id=?').get(cappedUser.id) as any).credits, 400);
  assert.throws(() => reserveUsage(limitedUser, crypto.randomUUID(), 'test', 1, 1), /límite diario/i);

  const refundUser = insertTestUser('quota-refund@nexus.test');
  db.prepare('UPDATE users SET credits=500,daily_limit=100,monthly_limit=100 WHERE id=?').run(refundUser.id);
  const refundReservation = reserveUsage(refundUser, crypto.randomUUID(), 'test', 20, 30);
  settleUsage(refundUser.id, refundReservation, 20);
  assert.equal((db.prepare('SELECT credits FROM users WHERE id=?').get(refundUser.id) as any).credits, 480);
  assert.equal((db.prepare('SELECT credits FROM usage WHERE id=?').get(refundReservation.id) as any).credits, 20);
});

test('workspace rejects traversal and symbolic links while keeping revisions', () => {
  const user = insertTestUser('paths@nexus.test');
  const projectId = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO projects(id,user_id,name,created_at,updated_at) VALUES(?,?,?,?,?)').run(projectId, user.id, 'Safe project', now, now);
  const written = paths.writeProjectFile(user.id, projectId, 'src/main.ts', 'export const value = 1;');
  assert.equal(written.path, 'src/main.ts');
  assert.equal(paths.readProjectFile(user.id, projectId, 'src/main.ts').content, 'export const value = 1;');
  paths.writeProjectFile(user.id, projectId, 'src/main.ts', 'export const value = 2;');
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM file_revisions WHERE project_id=?').get(projectId) as any).count, 3);
  assert.throws(() => paths.writeProjectFile(user.id, projectId, '../../outside.txt', 'unsafe'), /ruta no válida/i);
  assert.throws(() => paths.writeProjectFile(user.id, projectId, '.env', 'SECRET=bad'), /reservad/i);
  assert.equal(paths.createProjectFolder(user.id, projectId, 'nested/components').path, 'nested/components');
  assert.deepEqual(paths.renameProjectEntry(user.id, projectId, 'nested/components', 'nested/ui'), { from: 'nested/components', to: 'nested/ui' });
  assert.throws(() => paths.createProjectFolder(user.id, projectId, '.env'), /reservad/i);

  const root = path.join(PROJECT_DIR, user.id, projectId);
  const outside = path.join(testDataDir, 'outside');
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'secret.md'), 'not a workspace file');
  fs.symlinkSync(outside, path.join(root, 'linked-outside'));
  assert.throws(() => paths.readProjectFile(user.id, projectId, 'linked-outside/secret.md'), /enlaces simbólicos/i);
});

test('orphaned attachments are retained while referenced, then removed with their chat', () => {
  assert.equal((db.prepare('PRAGMA foreign_keys').get() as any).foreign_keys, 1);
  const user = insertTestUser('attachments@nexus.test');
  const chatId = crypto.randomUUID();
  const attachmentId = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO chats(id,user_id,title,created_at,updated_at) VALUES(?,?,?,?,?)').run(chatId, user.id, 'Files', now, now);
  const attachmentDir = path.join(UPLOAD_DIR, user.id, 'attachments');
  fs.mkdirSync(attachmentDir, { recursive: true });
  fs.writeFileSync(path.join(attachmentDir, `${attachmentId}.bin`), 'attachment');
  db.prepare('INSERT INTO attachments(id,user_id,original_name,mime_type,size,disk_path,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(attachmentId, user.id, 'note.txt', 'text/plain', 10, path.join(attachmentDir, `${attachmentId}.bin`), now);
  db.prepare(`INSERT INTO messages(id,chat_id,user_id,role,content,attachments_json,created_at) VALUES(?,?,?,'user','note',?,?)`)
    .run(crypto.randomUUID(), chatId, user.id, JSON.stringify([{ id: attachmentId, name: 'note.txt' }]), now);
  assert.equal(cleanupUnreferencedAttachments(user.id, [attachmentId]), 0);
  db.prepare('DELETE FROM chats WHERE id=?').run(chatId);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM messages WHERE chat_id=?').get(chatId) as any).count, 0);
  assert.equal(cleanupUnreferencedAttachments(user.id, [attachmentId]), 1);
  assert.equal(fs.existsSync(path.join(attachmentDir, `${attachmentId}.bin`)), false);
});

test('workflow graph validates cycles and executes persisted transforms with internal quotas', async () => {
  const user = insertTestUser('workflow@nexus.test');
  const projectId = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO projects(id,user_id,name,created_at,updated_at) VALUES(?,?,?,?,?)').run(projectId, user.id, 'Workflow project', now, now);
  const nodes = [
    { id: 'start', type: 'start', name: 'Inicio', config: {} },
    { id: 'input', type: 'input', name: 'Entrada', config: {} },
    { id: 'upper', type: 'transform', name: 'Mayúsculas', config: { operation: 'uppercase' } },
    { id: 'output', type: 'output', name: 'Salida', config: {} },
  ];
  const edges = [
    { source: 'start', target: 'input' },
    { source: 'input', target: 'upper' },
    { source: 'upper', target: 'output' },
  ];
  assert.equal(validateWorkflow(nodes, edges).order.length, nodes.length);
  assert.throws(() => validateWorkflow(nodes, [...edges, { source: 'output', target: 'start' }]), /ciclo/i);
  const workflowId = crypto.randomUUID();
  db.prepare('INSERT INTO workflows(id,user_id,name,description,nodes_json,edges_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(workflowId, user.id, 'Transform', '', JSON.stringify(nodes), JSON.stringify(edges), now, now);
  const workflow = db.prepare('SELECT * FROM workflows WHERE id=?').get(workflowId) as any;
  const result = await executeWorkflow(user, workflow, 'hello workflow');
  assert.equal(result.status, 'complete');
  assert.equal(result.output.text, 'HELLO WORKFLOW');
  assert.equal((db.prepare('SELECT status FROM workflow_runs WHERE id=?').get(result.id) as any).status, 'complete');
  const balance = (db.prepare('SELECT credits FROM users WHERE id=?').get(user.id) as any).credits;
  assert.ok(balance < 50_000 && balance >= 0);
});

test('HTTP API enforces registration, sessions, CSRF, ownership, and admin roles', async (t) => {
  const { createApp } = await import('../server/index.js');
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => close(server));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const register = async (email: string) => {
    const response = await fetch(`${origin}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test User', email, password: 'A-very-long-test-password-123' }),
    });
    assert.equal(response.status, 201);
    const cookieHeader = response.headers.get('set-cookie');
    assert.ok(cookieHeader);
    return { cookie: cookieHeader.split(';', 1)[0], body: await response.json() as any };
  };

  const first = await register('first@nexus.test');
  const unauthorized = await fetch(`${origin}/api/projects`);
  assert.equal(unauthorized.status, 401);
  const noCsrf = await fetch(`${origin}/api/projects`, {
    method: 'POST', headers: { Cookie: first.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Rejected' }),
  });
  assert.equal(noCsrf.status, 403);
  const created = await fetch(`${origin}/api/projects`, {
    method: 'POST', headers: { Cookie: first.cookie, 'X-CSRF-Token': first.body.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Owned project' }),
  });
  assert.equal(created.status, 201);
  const project = await created.json() as { id: string };
  const deniedAdmin = await fetch(`${origin}/api/admin/dashboard`, { headers: { Cookie: first.cookie } });
  assert.equal(deniedAdmin.status, 403);

  const second = await register('second@nexus.test');
  const otherUserProject = await fetch(`${origin}/api/projects/${project.id}/files`, { headers: { Cookie: second.cookie } });
  assert.equal(otherUserProject.status, 404);

  const logout = await fetch(`${origin}/api/auth/logout`, {
    method: 'POST', headers: { Cookie: first.cookie, 'X-CSRF-Token': first.body.csrfToken },
  });
  assert.equal(logout.status, 200);
  const expired = await fetch(`${origin}/api/projects`, { headers: { Cookie: first.cookie } });
  assert.equal(expired.status, 401);
});
