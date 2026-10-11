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
const { parseProviderSSE } = await import('../server/providers/sse.js');
const { streamCompletion } = await import('../server/providers/index.js');
const paths = await import('../server/workspaces/paths.js');
const { executeWorkflow, validateWorkflow } = await import('../server/workflows/engine.js');
const { generateWorkflowDraft, getWorkflowGeneratorOptions } = await import('../server/workflows/generator.js');
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
  assert.deepEqual(budgetForMode('MAX', { contextTokens: 4096 }), { outputTokens: 3584, inputContextTokens: 512 });
  assert.deepEqual(budgetForMode('MAX', { contextTokens: 32768, maxOutputTokens: 2048 }), { outputTokens: 2048, inputContextTokens: 30720 });
  assert.deepEqual(budgetForMode('MAX', { contextTokens: 32768, maxOutputTokens: 99999 }), { outputTokens: 6000, inputContextTokens: 26768 });
  assert.deepEqual(budgetForMode('LOW', { contextTokens: 4096, maxOutputTokens: 128 }), { outputTokens: 128, inputContextTokens: 3000 });
  assert.deepEqual(budgetForMode('MAX', { maxInputTokens: 8192, maxOutputTokens: 2048 }), { outputTokens: 2048, inputContextTokens: 8192 });
  assert.deepEqual(budgetForMode('MAX', { maxInputTokens: 4096, maxOutputTokens: 1024 }), { outputTokens: 1024, inputContextTokens: 4096 });
  const modeBudgets = (['LOW', 'MEDIO', 'ALTO', 'EXTRA', 'MAX'] as const).map((mode) => budgetForMode(mode, { contextTokens: 100_000 }));
  assert.deepEqual(modeBudgets.map((budget) => budget.outputTokens), [512, 1200, 2400, 4000, 6000]);
  assert.deepEqual(modeBudgets.map((budget) => budget.inputContextTokens), [3000, 6000, 12000, 20000, 32000]);
  assert.equal(budgetForMode('MAX', { contextTokens: 256 }).outputTokens, 0);
  assert.ok((db.prepare('PRAGMA table_info(provider_models)').all() as { name: string }[]).some((column) => column.name === 'max_input_tokens'));
  assert.ok((db.prepare('PRAGMA table_info(provider_models)').all() as { name: string }[]).some((column) => column.name === 'max_output_tokens'));
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

test('provider SSE parsing survives split CRLF frames and reports missing or truncated finishes', async () => {
  const source = [
    'data: {"choices":[{"delta":{"content":"first "},"finish_reason":null}]}\r\n\r\n',
    'data: {"choices":[{"delta":{"content":"second"},"finish_reason":null}]}\r\n\r\n',
    'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\r\n\r\n',
    'data: [DONE]\r\n\r\n',
  ].join('');
  const bytes = new TextEncoder().encode(source);
  const chunks = [bytes.slice(0, 15), bytes.slice(15, 87), bytes.slice(87, 91), bytes.slice(91)];
  const body = new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } });
  const events = [];
  for await (const item of parseProviderSSE(new Response(body), 'openai')) events.push(item);
  assert.equal(events.filter((item) => item.type === 'delta').map((item: any) => item.text).join(''), 'first second');
  assert.deepEqual(events.filter((item) => item.type === 'finish'), [{ type: 'finish', reason: 'openai:length', complete: false, truncated: true }]);

  const missingBody = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"ok"}}]}\r\n\r\ndata: [DONE]\r\n\r\n')); controller.close(); } });
  const missing = [];
  for await (const item of parseProviderSSE(new Response(missingBody), 'openai')) missing.push(item);
  assert.deepEqual(missing.at(-1), { type: 'finish', reason: 'stream:done-without-finish-reason', complete: false, truncated: false });
});

test('provider adapters send the model-specific output-token ceiling upstream', async (t) => {
  let requestBody: any;
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    });
  });
  const port = await listen(server, '::');
  t.after(() => close(server));
  const baseUrl = `http://localhost:${port}/v1`;
  const previousAllowlist = process.env.OLLAMA_ALLOWED_URLS;
  process.env.OLLAMA_ALLOWED_URLS = `http://localhost:${port}`;
  t.after(() => { process.env.OLLAMA_ALLOWED_URLS = previousAllowlist || 'http://localhost:11434,http://127.0.0.1:11434,http://[::1]:11434'; });
  const provider = { id: 'test-provider', user_id: 'test-user', type: 'ollama', name: 'Mock local provider', base_url: baseUrl, secret_encrypted: '', auth_config_json: '{}' };
  const events = [];
  for await (const event of streamCompletion(provider, 'mock-model', [{ role: 'user', content: 'hello' }], 'MAX', undefined, 1024)) events.push(event);
  assert.equal(requestBody.max_tokens, 1024);
  assert.equal(events.find((event) => event.type === 'delta')?.text, 'ok');
  assert.equal((events.find((event) => event.type === 'finish') as any)?.complete, true);
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

  const batch = paths.writeProjectFilesAtomically(user.id, projectId, [
    { path: 'site/index.html', content: '<!doctype html><title>Demo</title>' },
    { path: 'site/app.js', content: 'const answer = 42;' },
  ], { validateSyntax: true });
  assert.equal(batch.length, 2);
  assert.equal(batch.find((file) => file.path.endsWith('.js'))?.validationStatus, 'syntax-checked');
  assert.equal(batch.find((file) => file.path.endsWith('.html'))?.validationStatus, 'not-run');
  paths.writeProjectFile(user.id, projectId, 'site/app.js', 'const safe = true;');
  const revisionsBeforeRejectedBatch = (db.prepare('SELECT COUNT(*) AS count FROM file_revisions WHERE project_id=?').get(projectId) as any).count;
  assert.throws(() => paths.writeProjectFilesAtomically(user.id, projectId, [
    { path: 'site/app.js', content: 'const unsafeReplacement = true;' },
    { path: 'site/data.json', content: '{ broken json' },
  ], { validateSyntax: true }), /JSON inválido/i);
  assert.equal(paths.readProjectFile(user.id, projectId, 'site/app.js').content, 'const safe = true;');
  assert.equal(fs.existsSync(path.join(PROJECT_DIR, user.id, projectId, 'site/data.json')), false);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM file_revisions WHERE project_id=?').get(projectId) as any).count, revisionsBeforeRejectedBatch);

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
  await assert.rejects(executeWorkflow(user, { ...workflow, enabled: 0 }, 'should not start'), (error: any) => error.status === 409 && /pausada/i.test(error.message));
  const result = await executeWorkflow(user, workflow, 'hello workflow');
  assert.equal(result.status, 'complete');
  assert.equal(result.output.text, 'HELLO WORKFLOW');
  assert.equal((db.prepare('SELECT status FROM workflow_runs WHERE id=?').get(result.id) as any).status, 'complete');

  const branchNodes = [
    { id: 'branch-start', type: 'start', name: 'Inicio', config: {} },
    { id: 'branch-input', type: 'input', name: 'Entrada', config: {} },
    { id: 'branch-check', type: 'condition', name: '¿Contiene Y?', config: { contains: 'Y' } },
    { id: 'branch-true', type: 'transform', name: 'Mayúsculas', config: { operation: 'uppercase' } },
    { id: 'branch-false', type: 'transform', name: 'Minúsculas', config: { operation: 'lowercase' } },
    { id: 'branch-false-tail', type: 'text', name: 'Solo rama falsa', config: { text: 'BAD' } },
    { id: 'branch-output', type: 'output', name: 'Salida', config: {} },
  ];
  const branchEdges = [
    { source: 'branch-start', target: 'branch-input' },
    { source: 'branch-input', target: 'branch-check' },
    { source: 'branch-check', target: 'branch-true', sourceHandle: 'true' },
    { source: 'branch-check', target: 'branch-false', sourceHandle: 'false' },
    { source: 'branch-false', target: 'branch-false-tail' },
    { source: 'branch-true', target: 'branch-output' },
    { source: 'branch-false-tail', target: 'branch-output' },
  ];
  assert.throws(() => validateWorkflow(branchNodes, [...branchEdges, { source: 'branch-true', target: 'branch-output', sourceHandle: 'false' }]), /rama/i);
  const branchWorkflowId = crypto.randomUUID();
  db.prepare('INSERT INTO workflows(id,user_id,name,description,nodes_json,edges_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(branchWorkflowId, user.id, 'Conditional branch', '', JSON.stringify(branchNodes), JSON.stringify(branchEdges), now, now);
  const branchWorkflow = db.prepare('SELECT * FROM workflows WHERE id=?').get(branchWorkflowId) as any;
  const branchResult = await executeWorkflow(user, branchWorkflow, 'Yes');
  assert.equal(branchResult.output.text, 'YES');
  assert.equal(branchResult.logs.find((log) => log.nodeId === 'branch-false-tail')?.status, 'skipped');
  await assert.rejects(executeWorkflow(user, { id: crypto.randomUUID(), user_id: user.id, nodes_json: JSON.stringify([{ id: 'write', type: 'write_file', config: { path: 'new.txt', content: 'hello' } }]), edges_json: '[]' }, 'input', projectId), /Confirma que este flujo puede escribir archivos/i);
  const invalidWriteNodes = [
    { id: 'write-start', type: 'start', config: {} },
    { id: 'write-json', type: 'write_file', config: { path: 'workflow-output.json', content: '{ invalid json' } },
    { id: 'write-end', type: 'output', config: {} },
  ];
  const invalidWriteEdges = [{ source: 'write-start', target: 'write-json' }, { source: 'write-json', target: 'write-end' }];
  const invalidWriteWorkflowId = crypto.randomUUID();
  db.prepare('INSERT INTO workflows(id,user_id,name,description,nodes_json,edges_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(invalidWriteWorkflowId, user.id, 'Invalid write', '', JSON.stringify(invalidWriteNodes), JSON.stringify(invalidWriteEdges), now, now);
  const invalidWriteWorkflow = db.prepare('SELECT * FROM workflows WHERE id=?').get(invalidWriteWorkflowId) as any;
  await assert.rejects(executeWorkflow(user, invalidWriteWorkflow, 'input', projectId, undefined, true), /JSON inválido/i);
  assert.equal(fs.existsSync(path.join(PROJECT_DIR, user.id, projectId, 'workflow-output.json')), false);
  const balance = (db.prepare('SELECT credits FROM users WHERE id=?').get(user.id) as any).credits;
  assert.ok(balance < 50_000 && balance >= 0);
});

test('automation page renders an honest empty state with real create actions and no demo workflows', async () => {
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { AutomationPage } = await import('../web/src/components/AutomationPage.js');
  const markup = renderToStaticMarkup(React.createElement(AutomationPage, {
    workflows: [], providers: [], modelsByProvider: {}, agents: [], projects: [], activeProjectId: null,
    onRefresh: () => undefined, onRefreshUsage: () => undefined, onGoProviders: () => undefined, loading: false,
  }));
  assert.match(markup, /Todavía no tenés automatizaciones/);
  assert.match(markup, /Generar con IA/);
  assert.match(markup, /Crear automatización/);
  assert.match(markup, /no se guarda ni se ejecuta/i);
  assert.doesNotMatch(markup, /workflow-list-card/);
  assert.doesNotMatch(markup, /Ejemplo de automatización|Demo workflow/i);
});

test('workflow generator follows provider order, uses adapters, validates plans, and never saves drafts', async (t) => {
  const user = insertTestUser('workflow-generator@nexus.test');
  const userWithoutProviders = insertTestUser('workflow-generator-empty@nexus.test');
  const emptyOptions = getWorkflowGeneratorOptions(userWithoutProviders.id);
  assert.equal(emptyOptions.secondProvider, null);
  assert.match(emptyOptions.secondProviderReason, /al menos dos proveedores/i);
  await assert.rejects(generateWorkflowDraft(userWithoutProviders, 'Convertí el texto de entrada a mayúsculas.'), (error: any) => error.status === 409 && error.code === 'SECOND_PROVIDER_UNAVAILABLE');
  await assert.rejects(generateWorkflowDraft(userWithoutProviders, 'Envía mis tareas de Gmail a Slack.'), (error: any) => error.status === 422 && error.code === 'UNSUPPORTED_REQUEST');

  const plan = {
    name: 'Normalizar texto', description: 'Procesa texto con un modelo seleccionado.',
    nodes: [
      { id: 'start', type: 'start', name: 'Inicio manual', config: {} },
      { id: 'input', type: 'input', name: 'Entrada', config: {} },
      { id: 'ai', type: 'ai', name: 'Procesar texto', config: { prompt: 'Procesa {{result}}', mode: 'MEDIO' } },
      { id: 'output', type: 'output', name: 'Resultado', config: {} },
    ],
    edges: [{ source: 'start', target: 'input' }, { source: 'input', target: 'ai' }, { source: 'ai', target: 'output' }],
  };
  let responseText = JSON.stringify(plan);
  const requestBodies: any[] = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      requestBodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: responseText }, finish_reason: 'stop' }], usage: { prompt_tokens: 121, completion_tokens: 47 } }));
    });
  });
  const port = await listen(server, '::');
  t.after(() => close(server));
  const previousAllowlist = process.env.OLLAMA_ALLOWED_URLS;
  process.env.OLLAMA_ALLOWED_URLS = `http://localhost:${port}`;
  t.after(() => { process.env.OLLAMA_ALLOWED_URLS = previousAllowlist || 'http://localhost:11434,http://127.0.0.1:11434,http://[::1]:11434'; });
  const baseUrl = `http://localhost:${port}/v1`;
  const now = new Date().toISOString();
  const addGeneratorProvider = (name: string, modelId: string) => {
    const providerId = crypto.randomUUID();
    db.prepare(`INSERT INTO providers(id,user_id,type,name,base_url,status,created_at,updated_at) VALUES(?,?,'ollama',?,?,'connected',?,?)`)
      .run(providerId, user.id, name, baseUrl, now, now);
    db.prepare(`INSERT INTO provider_models(id,provider_id,model_id,display_name,source,status,context_tokens,max_input_tokens,max_output_tokens,created_at,updated_at)
      VALUES(?,?,?,?,'manual','available',32768,24000,4096,?,?)`)
      .run(crypto.randomUUID(), providerId, modelId, `${name} model`, now, now);
    return { providerId, modelId };
  };
  const alpha = addGeneratorProvider('Alpha Provider', 'alpha-workflow-model');
  const middle = addGeneratorProvider('Middle Provider', 'middle-workflow-model');
  addGeneratorProvider('Zulu Provider', 'zulu-workflow-model');

  const options = getWorkflowGeneratorOptions(user.id);
  assert.deepEqual(options.providers.map((provider) => provider.name), ['Alpha Provider', 'Middle Provider', 'Zulu Provider']);
  assert.equal(options.secondProvider?.id, middle.providerId);
  assert.equal(options.secondProvider?.modelId, middle.modelId);
  assert.equal(options.secondProvider?.ready, true);
  assert.equal('secret_encrypted' in options.providers[0], false);

  const generated = await generateWorkflowDraft(user, 'Procesá el texto de entrada y devolvé el resultado.', undefined, undefined, crypto.randomUUID());
  assert.equal(generated.generatedBy.providerId, middle.providerId);
  assert.equal(requestBodies.at(-1)?.model, middle.modelId);
  assert.equal(generated.nodes.find((node) => node.type === 'ai')?.config?.providerId, middle.providerId);
  assert.equal(generated.nodes.find((node) => node.type === 'ai')?.config?.modelId, middle.modelId);
  assert.equal(generated.usage.estimated, false);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM workflows WHERE user_id=?').get(user.id) as any).count, 0);

  responseText = JSON.stringify({ ...plan, edges: [...plan.edges, { source: 'output', target: 'start' }] });
  await assert.rejects(generateWorkflowDraft(user, 'Procesá el texto de entrada y devolvé el resultado.', alpha.providerId, alpha.modelId, crypto.randomUUID()), (error: any) => error.status === 422 && error.code === 'INVALID_GENERATED_WORKFLOW');
  assert.equal(requestBodies.at(-1)?.model, alpha.modelId);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM workflows WHERE user_id=?').get(user.id) as any).count, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM usage WHERE user_id=? AND operation='workflow-generator' AND status='complete'").get(user.id) as any).count, 2);
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
  const emptyWorkflowResponse = await fetch(`${origin}/api/workflows`, { headers: { Cookie: first.cookie } });
  assert.equal(emptyWorkflowResponse.status, 200);
  assert.deepEqual(await emptyWorkflowResponse.json(), []);
  const generatorOptionsResponse = await fetch(`${origin}/api/workflows/generator-options`, { headers: { Cookie: first.cookie } });
  assert.equal(generatorOptionsResponse.status, 200);
  assert.equal((await generatorOptionsResponse.json() as any).secondProvider, null);
  const blockedGeneration = await fetch(`${origin}/api/workflows/generate`, {
    method: 'POST', headers: { Cookie: first.cookie, 'X-CSRF-Token': first.body.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ request: 'Procesá el texto que ingrese y devolvé el resultado.' }),
  });
  assert.equal(blockedGeneration.status, 409);
  assert.match((await blockedGeneration.json() as any).error, /segundo proveedor|proveedores/i);
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
  const projectFiles = [
    { path: 'index.html', content: '<!doctype html><html><head><title>Generated project</title></head><body><script src="assets/app.js"></script></body></html>' },
    { path: 'assets/app.js', content: 'document.body.dataset.ready = "yes";' },
    { path: 'assets/site.css', content: 'body { color: teal; }' },
  ];
  for (const file of projectFiles) {
    const response = await fetch(`${origin}/api/projects/${project.id}/file`, {
      method: 'PUT', headers: { Cookie: first.cookie, 'X-CSRF-Token': first.body.csrfToken, 'Content-Type': 'application/json' }, body: JSON.stringify(file),
    });
    assert.equal(response.status, 200);
  }
  const listedProjectFiles = await fetch(`${origin}/api/projects/${project.id}/files`, { headers: { Cookie: first.cookie } });
  assert.equal((await listedProjectFiles.json() as any[]).filter((file) => file.type === 'file').length, 3);
  const editorRead = await fetch(`${origin}/api/projects/${project.id}/file?path=${encodeURIComponent('assets/app.js')}`, { headers: { Cookie: first.cookie } });
  assert.equal((await editorRead.json() as any).content, projectFiles[1].content);
  const previewFile = await fetch(`${origin}/api/projects/${project.id}/preview/index.html`, { headers: { Cookie: first.cookie } });
  assert.equal(previewFile.status, 200);
  assert.match(previewFile.headers.get('content-security-policy') || '', /default-src 'none'/i);
  assert.match(await previewFile.text(), /Generated project/);
  const downloadFile = await fetch(`${origin}/api/projects/${project.id}/download-file?path=index.html`, { headers: { Cookie: first.cookie } });
  assert.equal(downloadFile.status, 200);
  assert.match(await downloadFile.text(), /Generated project/);
  const downloadProject = await fetch(`${origin}/api/projects/${project.id}/download`, { headers: { Cookie: first.cookie } });
  assert.equal(downloadProject.status, 200);
  assert.deepEqual(Buffer.from(await downloadProject.arrayBuffer()).subarray(0, 2), Buffer.from('PK'));

  const flowNodes = [
    { id: 'api-start', type: 'start', name: 'Inicio', config: {}, position: { x: 80, y: 100 } },
    { id: 'api-text', type: 'text', name: 'Transformar', config: { text: '{{input}} guardado' }, position: { x: 390, y: 100 } },
    { id: 'api-output', type: 'output', name: 'Salida', config: {}, position: { x: 700, y: 100 } },
  ];
  const flowEdges = [{ source: 'api-start', target: 'api-text' }, { source: 'api-text', target: 'api-output' }];
  const createFlow = await fetch(`${origin}/api/workflows`, {
    method: 'POST', headers: { Cookie: first.cookie, 'X-CSRF-Token': first.body.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'API flow round-trip', description: 'Persist, edit, run', nodes: flowNodes, edges: flowEdges }),
  });
  assert.equal(createFlow.status, 201);
  const savedFlow = await createFlow.json() as any;
  const loadFlows = await fetch(`${origin}/api/workflows`, { headers: { Cookie: first.cookie } });
  const loadedFlow = (await loadFlows.json() as any[]).find((item) => item.id === savedFlow.id);
  assert.deepEqual(loadedFlow.nodes[1].position, { x: 390, y: 100 });
  const modifiedNodes = loadedFlow.nodes.map((node: any) => node.id === 'api-text' ? { ...node, config: { text: '{{input}} modificado' }, position: { x: 450, y: 160 } } : node);
  const updateFlow = await fetch(`${origin}/api/workflows/${savedFlow.id}`, {
    method: 'PATCH', headers: { Cookie: first.cookie, 'X-CSRF-Token': first.body.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'API flow round-trip', description: 'Updated graph', nodes: modifiedNodes, edges: loadedFlow.edges }),
  });
  assert.equal(updateFlow.status, 200);
  assert.deepEqual(((await updateFlow.json() as any).nodes.find((node: any) => node.id === 'api-text')).position, { x: 450, y: 160 });
  const runFlow = await fetch(`${origin}/api/workflows/${savedFlow.id}/run`, {
    method: 'POST', headers: { Cookie: first.cookie, 'X-CSRF-Token': first.body.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: 'roundtrip' }),
  });
  assert.equal(runFlow.status, 200);
  assert.equal((await runFlow.json() as any).output.text, 'roundtrip modificado');
  const pauseFlow = await fetch(`${origin}/api/workflows/${savedFlow.id}/enabled`, {
    method: 'PATCH', headers: { Cookie: first.cookie, 'X-CSRF-Token': first.body.csrfToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }),
  });
  assert.equal(pauseFlow.status, 200);
  assert.equal((await pauseFlow.json() as any).enabled, false);
  const pausedRun = await fetch(`${origin}/api/workflows/${savedFlow.id}/run`, {
    method: 'POST', headers: { Cookie: first.cookie, 'X-CSRF-Token': first.body.csrfToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ input: 'must not run' }),
  });
  assert.equal(pausedRun.status, 409);
  assert.match((await pausedRun.json() as any).error, /pausada/i);
  const resumeFlow = await fetch(`${origin}/api/workflows/${savedFlow.id}/enabled`, {
    method: 'PATCH', headers: { Cookie: first.cookie, 'X-CSRF-Token': first.body.csrfToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }),
  });
  assert.equal(resumeFlow.status, 200);
  assert.equal((await resumeFlow.json() as any).enabled, true);
  const flowRuns = await fetch(`${origin}/api/workflows/${savedFlow.id}/runs`, { headers: { Cookie: first.cookie } });
  assert.ok((await flowRuns.json() as any[]).some((item) => item.status === 'complete'));

  const deniedAdmin = await fetch(`${origin}/api/admin/dashboard`, { headers: { Cookie: first.cookie } });
  assert.equal(deniedAdmin.status, 403);

  const second = await register('second@nexus.test');
  const otherUserWorkflowPause = await fetch(`${origin}/api/workflows/${savedFlow.id}/enabled`, {
    method: 'PATCH', headers: { Cookie: second.cookie, 'X-CSRF-Token': second.body.csrfToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }),
  });
  assert.equal(otherUserWorkflowPause.status, 404);
  const otherUserProject = await fetch(`${origin}/api/projects/${project.id}/files`, { headers: { Cookie: second.cookie } });
  assert.equal(otherUserProject.status, 404);

  const chatResponse = await fetch(`${origin}/api/chats`, {
    method: 'POST', headers: { Cookie: first.cookie, 'X-CSRF-Token': first.body.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Recoverable chat', projectId: project.id }),
  });
  assert.equal(chatResponse.status, 201);
  const chat = await chatResponse.json() as { id: string };
  const createdAt = new Date().toISOString();
  db.prepare(`INSERT INTO messages(id,chat_id,user_id,role,content,created_at) VALUES(?,?,?,'user','kept after trash',?)`)
    .run(crypto.randomUUID(), chat.id, first.body.user.id, createdAt);
  const deniedTrash = await fetch(`${origin}/api/chats/${chat.id}/restore`, {
    method: 'POST', headers: { Cookie: second.cookie, 'X-CSRF-Token': second.body.csrfToken, 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(deniedTrash.status, 404);
  const moveToTrash = await fetch(`${origin}/api/chats/${chat.id}`, {
    method: 'DELETE', headers: { Cookie: first.cookie, 'X-CSRF-Token': first.body.csrfToken },
  });
  assert.equal(moveToTrash.status, 200);
  assert.equal((await (await fetch(`${origin}/api/chats` , { headers: { Cookie: first.cookie } })).json() as any[]).some((item) => item.id === chat.id), false);
  assert.equal((await (await fetch(`${origin}/api/chats?trash=true`, { headers: { Cookie: first.cookie } })).json() as any[]).some((item) => item.id === chat.id), true);
  const restoreChat = await fetch(`${origin}/api/chats/${chat.id}/restore`, {
    method: 'POST', headers: { Cookie: first.cookie, 'X-CSRF-Token': first.body.csrfToken, 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(restoreChat.status, 200);
  const preservedMessages = await fetch(`${origin}/api/chats/${chat.id}/messages`, { headers: { Cookie: first.cookie } });
  assert.equal((await preservedMessages.json() as any[]).some((item) => item.content === 'kept after trash'), true);
  await fetch(`${origin}/api/chats/${chat.id}`, { method: 'DELETE', headers: { Cookie: first.cookie, 'X-CSRF-Token': first.body.csrfToken } });
  const permanentDelete = await fetch(`${origin}/api/chats/${chat.id}/permanent`, {
    method: 'DELETE', headers: { Cookie: first.cookie, 'X-CSRF-Token': first.body.csrfToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }),
  });
  assert.equal(permanentDelete.status, 200);
  assert.equal((await (await fetch(`${origin}/api/chats?trash=true`, { headers: { Cookie: first.cookie } })).json() as any[]).some((item) => item.id === chat.id), false);

  const now = new Date().toISOString();
  const addTestVisionModel = (userId: string) => {
    const providerId = crypto.randomUUID(); const modelRowId = crypto.randomUUID();
    db.prepare('INSERT INTO providers(id,user_id,type,name,base_url,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      .run(providerId, userId, 'ollama', `Local ${providerId.slice(0, 5)}`, 'http://localhost:11434', now, now);
    db.prepare('INSERT INTO provider_models(id,provider_id,model_id,display_name,source,status,capabilities_json,context_tokens,max_input_tokens,max_output_tokens,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(modelRowId, providerId, 'vision-test', 'Vision test', 'manual', 'ready', JSON.stringify({ vision: false }), 8192, 6144, 4096, now, now);
    return providerId;
  };
  const firstProviderId = addTestVisionModel(first.body.user.id);
  const secondProviderId = addTestVisionModel(second.body.user.id);
  const listModels = await fetch(`${origin}/api/providers/${firstProviderId}/models`, { headers: { Cookie: first.cookie } });
  assert.equal(listModels.status, 200);
  const listedModel = (await listModels.json() as any[]).find((model) => model.id === 'vision-test');
  assert.equal(listedModel.maxInputTokens, 6144);
  assert.equal(listedModel.maxOutputTokens, 4096);
  const saveModelLimits = await fetch(`${origin}/api/providers/${firstProviderId}/models/vision-test`, {
    method: 'PATCH', headers: { Cookie: first.cookie, 'X-CSRF-Token': first.body.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contextTokens: 16384, maxInputTokens: 10240, maxOutputTokens: 2048 }),
  });
  assert.equal(saveModelLimits.status, 200);
  const savedModelLimits = await saveModelLimits.json() as any;
  assert.equal(savedModelLimits.contextTokens, 16384);
  assert.equal(savedModelLimits.maxInputTokens, 10240);
  assert.equal(savedModelLimits.maxOutputTokens, 2048);
  const invalidModelLimit = await fetch(`${origin}/api/providers/${firstProviderId}/models/vision-test`, {
    method: 'PATCH', headers: { Cookie: first.cookie, 'X-CSRF-Token': first.body.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ maxOutputTokens: 0 }),
  });
  assert.equal(invalidModelLimit.status, 400);
  const crossAccountModelLimits = await fetch(`${origin}/api/providers/${firstProviderId}/models/vision-test`, {
    method: 'PATCH', headers: { Cookie: second.cookie, 'X-CSRF-Token': second.body.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ maxOutputTokens: 1 }),
  });
  assert.equal(crossAccountModelLimits.status, 404);
  const addManualModel = await fetch(`${origin}/api/providers/${firstProviderId}/models`, {
    method: 'POST', headers: { Cookie: first.cookie, 'X-CSRF-Token': first.body.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: 'manual-output-test', contextTokens: 8192, maxInputTokens: 6144, maxOutputTokens: 1024 }),
  });
  assert.equal(addManualModel.status, 201);
  const manualModel = await addManualModel.json() as any;
  assert.equal(manualModel.maxInputTokens, 6144);
  assert.equal(manualModel.maxOutputTokens, 1024);

  const imageId = crypto.randomUUID();
  const imageDir = path.join(UPLOAD_DIR, first.body.user.id, 'images');
  fs.mkdirSync(imageDir, { recursive: true });
  const relativeImage = `images/${imageId}.png`;
  fs.writeFileSync(path.join(imageDir, `${imageId}.png`), Buffer.from('89504e470d0a1a0a', 'hex'));
  db.prepare('INSERT INTO images(id,user_id,provider_id,model_id,prompt,relative_path,mime_type,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(imageId, first.body.user.id, firstProviderId, 'image-model', 'test image', relativeImage, 'image/png', now);
  const ownImage = await fetch(`${origin}/api/images/${imageId}/file`, { headers: { Cookie: first.cookie } });
  assert.equal(ownImage.status, 200);
  const deniedImage = await fetch(`${origin}/api/images/${imageId}/file`, { headers: { Cookie: second.cookie } });
  assert.equal(deniedImage.status, 404);
  const firstImageChatResponse = await fetch(`${origin}/api/chats`, {
    method: 'POST', headers: { Cookie: first.cookie, 'X-CSRF-Token': first.body.csrfToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Own image' }),
  });
  const firstImageChat = await firstImageChatResponse.json() as { id: string };
  const secondChatResponse = await fetch(`${origin}/api/chats`, {
    method: 'POST', headers: { Cookie: second.cookie, 'X-CSRF-Token': second.body.csrfToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Image ownership' }),
  });
  const secondChat = await secondChatResponse.json() as { id: string };
  const ownImageChat = await fetch(`${origin}/api/chats/${firstImageChat.id}/messages`,  {
    method: 'POST', headers: { Cookie: first.cookie, 'X-CSRF-Token': first.body.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'analyze image', providerId: firstProviderId, modelId: 'vision-test', imageIds: [imageId] }),
  });
  assert.equal(ownImageChat.status, 400);
  assert.match((await ownImageChat.json() as any).error, /capacidad de imagen/i);
  const crossAccountImageChat = await fetch(`${origin}/api/chats/${secondChat.id}/messages`, {
    method: 'POST', headers: { Cookie: second.cookie, 'X-CSRF-Token': second.body.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'analyze image', providerId: secondProviderId, modelId: 'vision-test', imageIds: [imageId] }),
  });
  assert.equal(crossAccountImageChat.status, 400);
  assert.match((await crossAccountImageChat.json() as any).error, /no está disponible en tu biblioteca/i);

  const logout = await fetch(`${origin}/api/auth/logout`, {
    method: 'POST', headers: { Cookie: first.cookie, 'X-CSRF-Token': first.body.csrfToken },
  });
  assert.equal(logout.status, 200);
  const expired = await fetch(`${origin}/api/projects`, { headers: { Cookie: first.cookie } });
  assert.equal(expired.status, 401);
});
