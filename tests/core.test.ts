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
const { streamCompletion, outputTokenLimitFields } = await import('../server/providers/index.js');
const { buildContinuationMessages, appendContinuation } = await import('../server/continuation.js');
const { completionStatusFromReason, effectiveTaskTokenBudget, remainingTaskTokenBudget, shouldAutoContinueGeneration, saveGenerationCheckpoint, loadGenerationCheckpoint } = await import('../server/chats/routes.js');
const paths = await import('../server/workspaces/paths.js');
const { executeWorkflow, validateWorkflow } = await import('../server/workflows/engine.js');
const { generateWorkflowDraft, getWorkflowGeneratorOptions } = await import('../server/workflows/generator.js');
const { PROJECT_DIR, UPLOAD_DIR, DEFAULT_TASK_TOKEN_BUDGET, TASK_TOKEN_BUDGET, MAX_TASK_TOKENS, budgetForMode, outputLimitForRequest, normalizeUsageMode, resolveModelOutputLimit } = await import('../server/config.js');
const { cleanupUnreferencedAttachments } = await import('../server/uploads.js');
const { reserveUsage, settleUsage, estimateTextUnits } = await import('../server/usage.js');

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
  assert.deepEqual(budgetForMode('MAX', { contextTokens: 4096 }), { outputTokens: null, inputContextTokens: 4096 });
  assert.deepEqual(budgetForMode('MAX', { contextTokens: 32768, maxOutputTokens: 2048 }), { outputTokens: 2048, inputContextTokens: 32768 });
  assert.deepEqual(budgetForMode('MAX', { contextTokens: 32768, maxOutputTokens: 99999 }), { outputTokens: 99999, inputContextTokens: 32768 });
  assert.deepEqual(budgetForMode('LOW', { contextTokens: 4096, maxOutputTokens: 128 }), { outputTokens: 128, inputContextTokens: 4096 });
  assert.deepEqual(budgetForMode('MAX', { maxInputTokens: 8192, maxOutputTokens: 2048 }), { outputTokens: 2048, inputContextTokens: 8192 });
  assert.deepEqual(budgetForMode('MAX', { maxInputTokens: 4096, maxOutputTokens: 1024 }), { outputTokens: 1024, inputContextTokens: 4096 });
  const modes = ['LOW', 'MEDIO', 'HIGH', 'MAX'] as const;
  assert.deepEqual(modes.map((mode) => budgetForMode(mode, { contextTokens: 4096 })), modes.map(() => ({ outputTokens: null, inputContextTokens: 4096 })));
  const modeBudgets = modes.map((mode) => budgetForMode(mode, { contextTokens: 100_000, maxInputTokens: 80_000, maxOutputTokens: 16_000 }));
  assert.deepEqual(modeBudgets, modes.map(() => ({ outputTokens: 16_000, inputContextTokens: 80_000 })));
  assert.deepEqual(modes.map((mode) => budgetForMode(mode, { contextTokens: 32_768, maxOutputTokens: 8_192 })), modes.map(() => ({ outputTokens: 8_192, inputContextTokens: 32_768 })));
  assert.deepEqual(modes.map(() => effectiveTaskTokenBudget()), modes.map(() => 1_000_000));
  assert.deepEqual(modes.map(() => outputLimitForRequest({ maxOutputTokens: 4_096 }, 1_000_000, 12_000)), modes.map(() => 4_096));
  assert.deepEqual(modes.map(() => outputLimitForRequest({ maxOutputTokens: 16_384 }, 1_000_000, 12_000)), modes.map(() => 16_384));
  assert.deepEqual(modes.map(() => outputLimitForRequest({ contextTokens: 32_768, maxOutputTokens: 8_192 }, 1_000_000, 12_000)), modes.map(() => 8_192));
  assert.equal(outputLimitForRequest({ contextTokens: 32_768, maxOutputTokens: 8_192 }, 1_000_000, 12_000), 8_192);
  assert.equal(outputLimitForRequest({ contextTokens: 32_768, maxOutputTokens: 8_192 }, 2_000, 30_000), 2_000);
  assert.equal(outputLimitForRequest({ contextTokens: 32_768, maxOutputTokens: 8_192 }, 1_000_000, 31_000), 1_768);
  assert.equal(outputLimitForRequest({ maxInputTokens: 16_000, maxOutputTokens: 8_192 }, 1_000_000, 16_001), 0);
  assert.equal(outputLimitForRequest({ maxInputTokens: 16_000, maxOutputTokens: 8_192 }, 1_000_000, 16_000), 8_192);
  assert.equal(outputLimitForRequest({ maxOutputTokens: 8_192 }, 3_000, 12_000), 3_000);
  assert.equal(outputLimitForRequest({ contextTokens: 32_768, maxOutputTokens: null }, 1_000_000, 12_000), null);
  assert.equal(outputLimitForRequest({ maxOutputTokens: null }, 1_000_000, 12_000), null);
  assert.equal(outputLimitForRequest({ maxOutputTokens: null, maxInputTokens: 10_000 }, 1_000_000, 12_000), 0);
  assert.deepEqual(resolveModelOutputLimit(4096, 2048), { maxOutputTokens: 4096, source: 'provider-metadata' });
  assert.deepEqual(resolveModelOutputLimit(null, 2048), { maxOutputTokens: 2048, source: 'user-configured' });
  assert.deepEqual(resolveModelOutputLimit(null, null), { maxOutputTokens: null, source: 'unknown' });
  assert.deepEqual(outputTokenLimitFields('openai', 4_096), { max_completion_tokens: 4_096 });
  assert.deepEqual(outputTokenLimitFields('openai', 4_096, 'max_tokens'), { max_tokens: 4_096 });
  assert.deepEqual(outputTokenLimitFields('openai-compatible', 4_096, 'max_completion_tokens'), { max_completion_tokens: 4_096 });
  assert.throws(() => outputTokenLimitFields('deepseek', 4_096, 'max_completion_tokens'), /integración/i);
  assert.deepEqual(outputTokenLimitFields('anthropic', 8_192), { max_tokens: 8_192 });
  assert.deepEqual(outputTokenLimitFields('google', 2_048), { generationConfig: { maxOutputTokens: 2_048 } });
  assert.deepEqual(outputTokenLimitFields('deepseek', 6_144), { max_tokens: 6_144 });
  assert.deepEqual(outputTokenLimitFields('openai-compatible', 3_072), { max_tokens: 3_072 });
  assert.deepEqual(outputTokenLimitFields('ollama', 1_024), { max_tokens: 1_024 });
  assert.deepEqual(outputTokenLimitFields('openai', undefined), {});
  for (const providerType of ['openai', 'anthropic', 'google', 'deepseek', 'ollama', 'openai-compatible', 'custom']) {
    assert.deepEqual(outputTokenLimitFields(providerType), {}, `${providerType} must omit an unknown output limit instead of inventing one`);
  }
  assert.equal(normalizeUsageMode('ALTO'), 'HIGH');
  assert.equal(normalizeUsageMode('EXTRA'), 'HIGH');
  assert.ok((db.prepare('PRAGMA table_info(provider_models)').all() as { name: string }[]).some((column) => column.name === 'max_input_tokens'));
  assert.ok((db.prepare('PRAGMA table_info(provider_models)').all() as { name: string }[]).some((column) => column.name === 'max_output_tokens'));
  assert.ok((db.prepare('PRAGMA table_info(provider_models)').all() as { name: string }[]).some((column) => column.name === 'configured_max_output_tokens'));
  assert.ok((db.prepare('PRAGMA table_info(provider_models)').all() as { name: string }[]).some((column) => column.name === 'output_token_parameter'));
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

test('token-limit reasons and large task budgets are handled without duplicating output', async () => {
  assert.equal(completionStatusFromReason('openai:max_output_tokens'), 'incomplete');
  assert.equal(completionStatusFromReason('anthropic:stop'), 'complete');
  assert.equal(completionStatusFromReason('stream:done-without-finish-reason'), 'incomplete');
  assert.equal(TASK_TOKEN_BUDGET, 1_000_000);
  assert.equal(MAX_TASK_TOKENS, 1_000_000);
  assert.equal(DEFAULT_TASK_TOKEN_BUDGET, 1_000_000);
  assert.equal(effectiveTaskTokenBudget(500_000), 500_000);
  assert.equal(effectiveTaskTokenBudget(2_000_000), 1_000_000);
  assert.equal(effectiveTaskTokenBudget(Number.MAX_SAFE_INTEGER + 1), 1_000_000);
  assert.equal(remainingTaskTokenBudget(800_000), 200_000);
  assert.equal(shouldAutoContinueGeneration('openai:max_completion_tokens', 'incomplete', 800_000), true);
  assert.equal(shouldAutoContinueGeneration('stream:done-without-finish-reason', 'unverified', 800_000), true);
  assert.equal(shouldAutoContinueGeneration('openai:max_completion_tokens', 'incomplete', 1_000_000), false);
  assert.equal(shouldAutoContinueGeneration('stop', 'complete', 250_000), false);
  assert.equal(appendContinuation('hello world', 'hello world again'), 'hello world again');
  assert.equal(appendContinuation('hello world', 'world again'), 'hello world again');
  assert.equal(appendContinuation('prefix/hello', 'prefix/hello/again'), 'prefix/hello/again');
  assert.equal(appendContinuation('abcXYZ123', 'XYZ123def'), 'abcXYZ123def');
  assert.equal(appendContinuation('first second', 'third fourth'), 'first secondthird fourth');
  const longTail = 'x'.repeat(2048);
  assert.equal(appendContinuation(`prior${longTail}`, `${longTail}following`), `prior${longTail}following`);
  const continuedMessages = buildContinuationMessages(
    [{ role: 'user', content: 'Original task' }],
    'generated'.repeat(20_000),
    'Continue without repeating.',
    { contextTokens: 32_768, maxInputTokens: 30_000, maxOutputTokens: 8_192 },
    1_000_000,
  );
  assert.equal(continuedMessages.at(-2)?.role, 'assistant');
  assert.ok(continuedMessages.at(-2)!.content.length < 'generated'.repeat(20_000).length);
  assert.ok(estimateTextUnits(continuedMessages.map((message) => message.content).join('\n')) + 8_192 <= 32_768);
  const user = insertTestUser('checkpoint@nexus.test');
  const chatId = crypto.randomUUID();
  db.prepare('INSERT INTO chats(id,user_id,title,project_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(chatId, user.id, 'Checkpoint test', null, new Date().toISOString(), new Date().toISOString());
  const checkpointId = saveGenerationCheckpoint({ userId: user.id, chatId, status: 'incomplete', currentText: 'primer fragmento', reason: 'max_output_tokens', nextStep: 'resume-next-pass' });
  const saved = loadGenerationCheckpoint(user.id, chatId);
  assert.equal(saved?.currentText, 'primer fragmento');
  assert.equal(saved?.status, 'incomplete');
  assert.equal(checkpointId.id.length > 0, true);
});

test('provider adapters send the model-specific output-token ceiling upstream', async (t) => {
  const requestBodies: any[] = [];
  let rejectWithRateLimit = false;
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      requestBodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (rejectWithRateLimit) {
        response.writeHead(429, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: 'account-specific rate limit exceeded' } }));
        return;
      }
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
  const modes = ['LOW', 'MEDIO', 'HIGH', 'MAX'] as const;
  for (const mode of modes) {
    const events = [];
    for await (const event of streamCompletion(provider, 'mock-model', [{ role: 'user', content: 'hello' }], mode, undefined, 1024)) events.push(event);
    assert.equal(events.find((event) => event.type === 'delta')?.text, 'ok');
    assert.equal((events.find((event) => event.type === 'finish') as any)?.complete, true);
  }
  assert.deepEqual(requestBodies.map((body) => body.max_tokens), modes.map(() => 1024));
  rejectWithRateLimit = true;
  await assert.rejects((async () => {
    for await (const _event of streamCompletion(provider, 'mock-model', [{ role: 'user', content: 'retry me' }], 'MEDIO')) void _event;
  })(), /account-specific rate limit exceeded/i);
});

test('chat integration continues long output across requests without duplication and preserves partial output on failure', async (t) => {
  const { createApp } = await import('../server/index.js');
  const { setCsrfToken, streamChat } = await import('../web/src/api.js');
  const calls: { body: any; scenario: 'complete' | 'multi' | 'fail' }[] = [];
  let scenario: 'complete' | 'multi' | 'fail' = 'complete';
  const firstPart = '<!doctype html><html><body><main>Primera parte';
  const secondPart = 'Primera parte y segunda parte</main></body></html>';
  const expectedHtml = firstPart + ' y segunda parte</main></body></html>';
  const mockProvider = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const isContinuation = body.messages.some((message: any) => message.role === 'user' && /No repitas/.test(message.content));
      const scenarioRequest = calls.filter((call) => call.scenario === scenario).length;
      calls.push({ body, scenario });
      if (scenario === 'fail' && isContinuation) {
        response.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: 'simulated continuation failure' } }));
        return;
      }
      const multiParts = ['Fragmento A', 'Fragmento A y fragmento B', 'fragmento B y fragmento C'];
      const text = scenario === 'multi' ? multiParts[scenarioRequest] : isContinuation ? secondPart : firstPart;
      const finishReason = scenario === 'multi' ? scenarioRequest < 2 ? 'length' : 'stop' : isContinuation ? 'stop' : 'length';
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end([
        `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 1024 } })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finishReason }] })}\n\n`,
        'data: [DONE]\n\n',
      ].join(''));
    });
  });
  const providerPort = await listen(mockProvider, '::');
  t.after(() => close(mockProvider));
  const previousAllowlist = process.env.OLLAMA_ALLOWED_URLS;
  process.env.OLLAMA_ALLOWED_URLS = `http://localhost:${providerPort}`;
  t.after(() => { process.env.OLLAMA_ALLOWED_URLS = previousAllowlist || 'http://localhost:11434,http://127.0.0.1:11434,http://[::1]:11434'; });

  const apiServer = createApp().listen(0, '127.0.0.1');
  await once(apiServer, 'listening');
  t.after(() => close(apiServer));
  const address = apiServer.address();
  assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const registrationResponse = await fetch(`${origin}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Chat integration', email: 'chat-continuation@nexus.test', password: 'A-very-long-test-password-123' }),
  });
  assert.equal(registrationResponse.status, 201);
  const cookie = registrationResponse.headers.get('set-cookie')!.split(';', 1)[0];
  const registration = await registrationResponse.json() as any;
  setCsrfToken(registration.csrfToken);
  const userId = registration.user.id as string;
  db.prepare('UPDATE users SET credits=1000000,daily_limit=1000000,monthly_limit=1000000 WHERE id=?').run(userId);
  const now = new Date().toISOString();
  const providerId = crypto.randomUUID();
  const modelId = 'mock-html-model';
  db.prepare(`INSERT INTO providers(id,user_id,type,name,base_url,status,created_at,updated_at)
    VALUES(?,?,'ollama','Continuation mock',?,'connected',?,?)`).run(providerId, userId, `http://localhost:${providerPort}/v1`, now, now);
  db.prepare(`INSERT INTO provider_models(id,provider_id,model_id,display_name,source,status,context_tokens,max_input_tokens,max_output_tokens,created_at,updated_at)
    VALUES(?,?,?,?,'manual','available',32768,24000,4096,?,?)`).run(crypto.randomUUID(), providerId, modelId, modelId, now, now);
  const createChat = () => {
    const chatId = crypto.randomUUID();
    db.prepare('INSERT INTO chats(id,user_id,title,project_id,created_at,updated_at) VALUES(?,?,?,NULL,?,?)')
      .run(chatId, userId, 'HTML continuation integration', now, now);
    return chatId;
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/api/')) {
      const headers = new Headers(init?.headers);
      headers.set('Cookie', cookie);
      return originalFetch(`${origin}${input}`, { ...init, headers });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; setCsrfToken(''); });

  const collectedFor = async (chatId: string, mode = 'MEDIO') => {
    let html = '';
    const finishes: any[] = [];
    const errors: string[] = [];
    const done = await streamChat(chatId, { content: 'Genera una página HTML', providerId, modelId, mode }, new AbortController().signal, {
      onDelta: (text) => { html += text; },
      onFinish: (finish) => finishes.push(finish),
      onError: (message) => errors.push(message),
    });
    return { html, finishes, errors, done };
  };

  try {
    const successfulChatId = createChat();
    const successful = await collectedFor(successfulChatId);
    const successfulCalls = calls.filter((call) => call.scenario === 'complete');
    assert.equal(successfulCalls.length, 2, 'the route must issue a second provider request after finish_reason=length');
    assert.deepEqual(successfulCalls.map((call) => call.body.max_tokens), [4096, 4096]);
    assert.ok(successfulCalls[1].body.messages.some((message: any) => message.role === 'assistant' && message.content === firstPart));
    assert.ok(successfulCalls[1].body.messages.some((message: any) => message.role === 'user' && /No repitas/.test(message.content)));
    assert.equal(successful.html, expectedHtml, 'the frontend stream consumer must receive the combined HTML exactly once');
    assert.deepEqual(successful.finishes.map((finish) => finish.status), ['incomplete', 'complete']);
    assert.equal(successful.done.completionStatus, 'complete');
    const savedSuccess = db.prepare("SELECT content,meta_json FROM messages WHERE chat_id=? AND role='assistant'").get(successfulChatId) as any;
    assert.equal(savedSuccess.content, expectedHtml);
    const successMeta = JSON.parse(savedSuccess.meta_json);
    assert.equal(successMeta.status, 'complete');
    assert.equal(successMeta.providerUsage.outputTokens, 2048, 'output usage is summed across provider calls, not estimated from the final character count');
    assert.equal(successMeta.providerUsage.inputTokens, 100);
    assert.equal(successMeta.estimatedCredits, 2148);
    for (const mode of ['LOW', 'HIGH', 'MAX']) {
      const modeChatId = createChat();
      const modeResult = await collectedFor(modeChatId, mode);
      assert.equal(modeResult.html, expectedHtml);
      assert.equal(modeResult.done.completionStatus, 'complete');
    }
    const allSuccessfulCalls = calls.filter((call) => call.scenario === 'complete');
    assert.equal(allSuccessfulCalls.length, 8, 'each of LOW, MEDIO, HIGH, and MAX completes through two requests');
    assert.deepEqual(allSuccessfulCalls.map((call) => call.body.max_tokens), allSuccessfulCalls.map(() => 4096));

    db.prepare('UPDATE provider_models SET max_output_tokens=NULL,configured_max_output_tokens=NULL WHERE provider_id=? AND model_id=?').run(providerId, modelId);
    const unknownLimitChatId = createChat();
    const unknownLimit = await collectedFor(unknownLimitChatId, 'MAX');
    const unknownLimitCalls = calls.filter((call) => call.scenario === 'complete').slice(-2);
    assert.equal(unknownLimit.done.completionStatus, 'complete');
    assert.equal(unknownLimit.html, expectedHtml);
    assert.equal(unknownLimitCalls.length, 2);
    assert.ok(unknownLimitCalls.every((call) => !Object.hasOwn(call.body, 'max_tokens')), 'unknown provider limit must rely on the API default');

    scenario = 'multi';
    const multiChatId = createChat();
    const multi = await collectedFor(multiChatId);
    const multiCalls = calls.filter((call) => call.scenario === 'multi');
    assert.equal(multiCalls.length, 3);
    assert.equal(multi.html, 'Fragmento A y fragmento B y fragmento C');
    assert.deepEqual(multi.finishes.map((finish) => finish.status), ['incomplete', 'incomplete', 'complete']);
    assert.equal(multi.done.completionStatus, 'complete');
    const multiSaved = db.prepare("SELECT content,meta_json FROM messages WHERE chat_id=? AND role='assistant'").get(multiChatId) as any;
    assert.equal(multiSaved.content, multi.html);
    assert.equal(JSON.parse(multiSaved.meta_json).providerUsage.outputTokens, 3072);

    scenario = 'fail';
    const failedChatId = createChat();
    const failed = await collectedFor(failedChatId);
    const failedCalls = calls.filter((call) => call.scenario === 'fail');
    assert.equal(failedCalls.length, 2, 'the second provider request must be attempted in the failure case too');
    assert.equal(failed.html, firstPart, 'the frontend retains the partial response');
    assert.equal(failed.errors.length, 1);
    assert.match(failed.errors[0], /simulated continuation failure/i);
    assert.equal(failed.done.completionStatus, 'incomplete');
    const savedFailure = db.prepare("SELECT content,meta_json FROM messages WHERE chat_id=? AND role='assistant'").get(failedChatId) as any;
    assert.equal(savedFailure.content, firstPart);
    assert.equal(JSON.parse(savedFailure.meta_json).status, 'incomplete');
    assert.equal(JSON.parse(savedFailure.meta_json).providerUsage.outputTokens, 1024);
    const checkpoint = db.prepare('SELECT status,current_text,next_step FROM generation_checkpoints WHERE chat_id=?').get(failedChatId) as any;
    assert.equal(checkpoint.status, 'incomplete');
    assert.equal(checkpoint.current_text, firstPart);
    assert.equal(checkpoint.next_step, 'retry-or-resume');
  } finally {
    globalThis.fetch = originalFetch;
    setCsrfToken('');
  }
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

test('workflow graph validates cycles and executes persisted transforms with internal quotas', async (t) => {
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

  const workflowRequests: any[] = [];
  let failWorkflowContinuation = false;
  const workflowProviderServer = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      workflowRequests.push(body);
      const continuation = body.messages.some((message: any) => message.role === 'user' && message.content.includes('Continúa exactamente después'));
      if (continuation && failWorkflowContinuation) {
        response.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: 'simulated workflow run continuation failure' } }));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        choices: [{ message: { content: continuation ? 'Fragmento A y B' : 'Fragmento A' }, finish_reason: continuation ? 'stop' : 'length' }],
        usage: { prompt_tokens: 40, completion_tokens: 12 },
      }));
    });
  });
  const workflowProviderPort = await listen(workflowProviderServer, '::');
  t.after(() => close(workflowProviderServer));
  const previousWorkflowAllowlist = process.env.OLLAMA_ALLOWED_URLS;
  process.env.OLLAMA_ALLOWED_URLS = `http://localhost:${workflowProviderPort}`;
  t.after(() => { process.env.OLLAMA_ALLOWED_URLS = previousWorkflowAllowlist || 'http://localhost:11434,http://127.0.0.1:11434,http://[::1]:11434'; });
  const workflowProviderId = crypto.randomUUID();
  const workflowModelId = 'unknown-output-workflow-model';
  db.prepare('INSERT INTO providers(id,user_id,type,name,base_url,secret_encrypted,auth_config_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(workflowProviderId, user.id, 'ollama', 'Unknown-output workflow mock', `http://localhost:${workflowProviderPort}/v1`, '', '{}', 'connected', now, now);
  db.prepare('INSERT INTO provider_models(id,provider_id,model_id,display_name,source,status,context_tokens,max_input_tokens,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(crypto.randomUUID(), workflowProviderId, workflowModelId, workflowModelId, 'manual', 'ready', 8192, 6144, now, now);
  const aiNodes = [
    { id: 'ai-start', type: 'start', config: {} },
    { id: 'ai-input', type: 'input', config: {} },
    { id: 'ai-work', type: 'ai', config: { providerId: workflowProviderId, modelId: workflowModelId, mode: 'MAX', prompt: '{{result}}' } },
    { id: 'ai-output', type: 'output', config: {} },
  ];
  const aiEdges = [{ source: 'ai-start', target: 'ai-input' }, { source: 'ai-input', target: 'ai-work' }, { source: 'ai-work', target: 'ai-output' }];
  const aiWorkflowId = crypto.randomUUID();
  db.prepare('INSERT INTO workflows(id,user_id,name,description,nodes_json,edges_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(aiWorkflowId, user.id, 'Unknown output AI', '', JSON.stringify(aiNodes), JSON.stringify(aiEdges), now, now);
  const aiWorkflow = db.prepare('SELECT * FROM workflows WHERE id=?').get(aiWorkflowId) as any;
  const aiResult = await executeWorkflow(user, aiWorkflow, 'Complete this task');
  assert.equal(aiResult.status, 'complete');
  assert.equal(aiResult.output.text, 'Fragmento A y B');
  assert.equal(workflowRequests.length, 2);
  assert.ok(workflowRequests.every((body) => !Object.hasOwn(body, 'max_tokens')));

  failWorkflowContinuation = true;
  await assert.rejects(executeWorkflow(user, aiWorkflow, 'Preserve partial result'), (error: any) => {
    assert.equal(error.status, 502);
    assert.match(error.message, /simulated workflow run continuation failure/i);
    assert.equal(error.partialOutput, 'Fragmento A');
    return true;
  });
  const failedWorkflowRun = db.prepare("SELECT output_json,status FROM workflow_runs WHERE workflow_id=? AND status='failed' ORDER BY started_at DESC LIMIT 1").get(aiWorkflowId) as any;
  assert.equal(failedWorkflowRun.status, 'failed');
  assert.equal(JSON.parse(failedWorkflowRun.output_json).text, 'Fragmento A');

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
  let continuationChunks: string[] | null = null;
  let continuationIndex = 0;
  let failContinuation = false;
  const requestBodies: any[] = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requestBodies.push(body);
      const continuing = body.messages.some((message: any) => message.role === 'assistant');
      if (continuationChunks && continuing && failContinuation) {
        response.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: 'simulated workflow continuation failure' } }));
        return;
      }
      const chunkIndex = continuationChunks ? continuationIndex++ : -1;
      const content = chunkIndex >= 0 ? continuationChunks![chunkIndex] : responseText;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: chunkIndex === 0 ? 'length' : 'stop' }], usage: { prompt_tokens: 121, completion_tokens: 47 } }));
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
  assert.equal(requestBodies.at(-1)?.max_tokens, 4096);
  assert.equal(generated.nodes.find((node) => node.type === 'ai')?.config?.providerId, middle.providerId);
  assert.equal(generated.nodes.find((node) => node.type === 'ai')?.config?.modelId, middle.modelId);
  assert.equal(generated.usage.estimated, false);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM workflows WHERE user_id=?').get(user.id) as any).count, 0);

  db.prepare('UPDATE provider_models SET max_output_tokens=NULL,configured_max_output_tokens=NULL WHERE provider_id=? AND model_id=?').run(middle.providerId, middle.modelId);
  const completePlanText = JSON.stringify(plan);
  const planSplit = Math.floor(completePlanText.length / 2);
  continuationChunks = [completePlanText.slice(0, planSplit), completePlanText.slice(planSplit)];
  continuationIndex = 0;
  const unknownLimitStart = requestBodies.length;
  const generatedWithUnknownLimit = await generateWorkflowDraft(user, 'Procesá el texto de entrada y devolvé el resultado.', middle.providerId, middle.modelId, crypto.randomUUID());
  const unknownLimitRequests = requestBodies.slice(unknownLimitStart);
  assert.equal(generatedWithUnknownLimit.nodes.length, plan.nodes.length);
  assert.equal(unknownLimitRequests.length, 2);
  assert.ok(unknownLimitRequests.every((body) => !Object.hasOwn(body, 'max_tokens')));
  assert.equal(unknownLimitRequests[1].messages.some((message: any) => message.role === 'assistant' && message.content === continuationChunks![0]), true);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM workflows WHERE user_id=?').get(user.id) as any).count, 0);

  continuationIndex = 0;
  failContinuation = true;
  const partialText = continuationChunks[0];
  await assert.rejects(generateWorkflowDraft(user, 'Procesá el texto de entrada y devolvé el resultado.', middle.providerId, middle.modelId, crypto.randomUUID()), (error: any) => {
    assert.equal(error.status, 502);
    assert.match(error.message, /simulated workflow continuation failure/i);
    assert.equal(error.partialOutput, partialText);
    return true;
  });
  failContinuation = false;
  continuationChunks = null;

  responseText = JSON.stringify({ ...plan, edges: [...plan.edges, { source: 'output', target: 'start' }] });
  await assert.rejects(generateWorkflowDraft(user, 'Procesá el texto de entrada y devolvé el resultado.', alpha.providerId, alpha.modelId, crypto.randomUUID()), (error: any) => error.status === 422 && error.code === 'INVALID_GENERATED_WORKFLOW');
  assert.equal(requestBodies.at(-1)?.model, alpha.modelId);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM workflows WHERE user_id=?').get(user.id) as any).count, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM usage WHERE user_id=? AND operation='workflow-generator' AND status='complete'").get(user.id) as any).count, 3);
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
  assert.equal(savedModelLimits.maxOutputTokens, 4096);
  assert.equal(savedModelLimits.providerMaxOutputTokens, 4096);
  assert.equal(savedModelLimits.configuredMaxOutputTokens, 2048);
  assert.equal(savedModelLimits.outputLimitSource, 'provider-metadata');
  assert.equal(savedModelLimits.outputTokenParameter, null);
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
  assert.equal(manualModel.configuredMaxOutputTokens, 1024);
  assert.equal(manualModel.outputLimitSource, 'user-configured');
  const addUnknownModel = await fetch(`${origin}/api/providers/${firstProviderId}/models`, {
    method: 'POST', headers: { Cookie: first.cookie, 'X-CSRF-Token': first.body.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: 'unknown-output-test' }),
  });
  assert.equal(addUnknownModel.status, 201);
  const unknownModel = await addUnknownModel.json() as any;
  assert.equal(unknownModel.maxOutputTokens, null);
  assert.equal(unknownModel.outputLimitSource, 'unknown');
  const setOutputParameter = await fetch(`${origin}/api/providers/${firstProviderId}/models/manual-output-test`, {
    method: 'PATCH', headers: { Cookie: first.cookie, 'X-CSRF-Token': first.body.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ outputTokenParameter: 'max_tokens' }),
  });
  assert.equal(setOutputParameter.status, 200);
  assert.equal((await setOutputParameter.json() as any).outputTokenParameter, 'max_tokens');
  const rereadModel = await fetch(`${origin}/api/providers/${firstProviderId}/models`, { headers: { Cookie: first.cookie } });
  const rereadManualModel = (await rereadModel.json() as any[]).find((model) => model.id === 'manual-output-test');
  assert.equal(rereadManualModel.configuredMaxOutputTokens, 1024);
  assert.equal(rereadManualModel.outputTokenParameter, 'max_tokens');
  let metadataAvailable = true;
  const metadataServer = http.createServer((request, response) => {
    if (request.url !== '/api/tags') { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ models: [
      { name: 'synced-model', ...(metadataAvailable ? { max_output_tokens: 7777 } : {}) },
      { name: 'synced-model-small', ...(metadataAvailable ? { max_output_tokens: 1024 } : {}) },
    ] }));
  });
  const metadataPort = await listen(metadataServer, '::');
  t.after(() => close(metadataServer));
  const previousOllamaAllowlist = process.env.OLLAMA_ALLOWED_URLS;
  process.env.OLLAMA_ALLOWED_URLS = `http://localhost:${metadataPort}`;
  t.after(() => { process.env.OLLAMA_ALLOWED_URLS = previousOllamaAllowlist || 'http://localhost:11434,http://127.0.0.1:11434,http://[::1]:11434'; });
  const metadataProviderId = crypto.randomUUID();
  db.prepare('INSERT INTO providers(id,user_id,type,name,base_url,secret_encrypted,auth_config_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(metadataProviderId, first.body.user.id, 'ollama', 'Metadata mock', `http://localhost:${metadataPort}`, '', '{}', 'connected', now, now);
  const addConfiguredSyncModel = await fetch(`${origin}/api/providers/${metadataProviderId}/models`, {
    method: 'POST', headers: { Cookie: first.cookie, 'X-CSRF-Token': first.body.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: 'synced-model', maxOutputTokens: 512 }),
  });
  assert.equal(addConfiguredSyncModel.status, 201);
  const syncModels = await fetch(`${origin}/api/providers/${metadataProviderId}/models/sync`, {
    method: 'POST', headers: { Cookie: first.cookie, 'X-CSRF-Token': first.body.csrfToken, 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(syncModels.status, 200);
  const syncedModels = (await syncModels.json() as any).models as any[];
  const syncedModel = syncedModels.find((model) => model.id === 'synced-model');
  assert.equal(syncedModel.providerMaxOutputTokens, 7777);
  assert.equal(syncedModel.configuredMaxOutputTokens, 512);
  assert.equal(syncedModel.maxOutputTokens, 7777);
  assert.equal(syncedModel.outputLimitSource, 'provider-metadata');
  const syncedModelSmall = syncedModels.find((model) => model.id === 'synced-model-small');
  assert.equal(syncedModelSmall.maxOutputTokens, 1024);
  metadataAvailable = false;
  const resync = await fetch(`${origin}/api/providers/${metadataProviderId}/models/sync`, {
    method: 'POST', headers: { Cookie: first.cookie, 'X-CSRF-Token': first.body.csrfToken, 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(resync.status, 200);
  const resyncedModels = (await resync.json() as any).models as any[];
  const resyncedModel = resyncedModels.find((model) => model.id === 'synced-model');
  assert.equal(resyncedModel.providerMaxOutputTokens, null);
  assert.equal(resyncedModel.configuredMaxOutputTokens, 512);
  assert.equal(resyncedModel.maxOutputTokens, 512);
  assert.equal(resyncedModel.outputLimitSource, 'user-configured');
  const unsupportedOutputParameter = await fetch(`${origin}/api/providers/${metadataProviderId}/models/synced-model`, {
    method: 'PATCH', headers: { Cookie: first.cookie, 'X-CSRF-Token': first.body.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ outputTokenParameter: 'max_completion_tokens' }),
  });
  assert.equal(unsupportedOutputParameter.status, 400);

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
