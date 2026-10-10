import { decryptSecret, redactedError } from '../security.js';
import { safeProviderFetch } from './safety.js';
import type { CanonicalMessage, ProviderRecord, StreamEvent, ToolCall, ToolDefinition } from './types.js';
import { MODE_POLICIES, type UsageMode } from '../config.js';

export type ModelSummary = { id: string; displayName: string; contextTokens?: number };

function policyFor(mode: UsageMode, outputTokenLimit?: number) {
  const base = MODE_POLICIES[mode] || MODE_POLICIES.MEDIO;
  const requested = Number.isSafeInteger(outputTokenLimit) && Number(outputTokenLimit) > 0 ? Number(outputTokenLimit) : base.outputTokens;
  return { ...base, outputTokens: Math.min(base.outputTokens, requested) };
}

function secretOf(provider: ProviderRecord) {
  return decryptSecret(provider.secret_encrypted);
}
function apiBase(provider: ProviderRecord) { return provider.base_url.replace(/\/+$/, ''); }
function endpoint(provider: ProviderRecord, suffix: string) { return new URL(`${apiBase(provider)}${suffix}`); }
function providerMessage(provider: ProviderRecord, message: string) {
  const secret = secretOf(provider);
  const cleaned = redactedError(message, secret);
  if (/401|unauthorized|invalid.*key|invalid api key/i.test(cleaned)) return 'Credenciales rechazadas. Revisa la clave y los permisos del proveedor.';
  if (/403|forbidden|permission/i.test(cleaned)) return 'El proveedor denegó el acceso. Comprueba los permisos de la cuenta y del modelo.';
  if (/429|rate.?limit|quota|resource exhausted/i.test(cleaned)) return 'El proveedor alcanzó un límite de solicitudes o cuota. Espera un momento o revisa tu cuenta externa.';
  if (/404|not found/i.test(cleaned)) return 'Endpoint o modelo no encontrado. Comprueba la URL base y el identificador exacto del modelo.';
  return cleaned || `Error al comunicarse con ${provider.name}.`;
}

function authHeaders(provider: ProviderRecord, json = true) {
  const secret = secretOf(provider);
  const config = JSON.parse(provider.auth_config_json || '{}') as { headerName?: string; prefix?: string };
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (json) headers['Content-Type'] = 'application/json';
  if (provider.type === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    if (secret) headers['x-api-key'] = secret;
  } else if (provider.type !== 'google' && secret) {
    const header = config.headerName?.trim() || 'Authorization';
    const prefix = config.prefix ?? (header.toLowerCase() === 'authorization' ? 'Bearer ' : '');
    headers[header] = `${prefix}${secret}`;
  }
  return headers;
}
function googleUrl(provider: ProviderRecord, suffix: string) {
  const url = endpoint(provider, suffix);
  const secret = secretOf(provider);
  if (secret) url.searchParams.set('key', secret);
  return url;
}
function modelIdForGoogle(id: string) { return id.replace(/^models\//, ''); }

async function responseError(provider: ProviderRecord, response: Response): Promise<never> {
  const body = await response.text().catch(() => '');
  let detail = body;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string };
    detail = parsed.error?.message || parsed.message || body;
  } catch { /* plain-text upstream error */ }
  const generic = `Proveedor respondió HTTP ${response.status}${detail ? `: ${detail}` : ''}`;
  throw new Error(providerMessage(provider, generic));
}

async function fetchModels(provider: ProviderRecord): Promise<ModelSummary[]> {
  let url: URL;
  if (provider.type === 'google') url = googleUrl(provider, '/models');
  else if (provider.type === 'ollama') {
    const base = apiBase(provider).replace(/\/v1$/i, '');
    url = new URL(`${base}/api/tags`);
  } else url = endpoint(provider, '/models');
  const response = await safeProviderFetch(provider, url, { method: 'GET', headers: authHeaders(provider, false) });
  if (!response.ok) return responseError(provider, response);
  const result = await response.json() as any;
  if (provider.type === 'google') {
    const items = Array.isArray(result.models) ? result.models : [];
    return items.filter((m: any) => typeof m.name === 'string').map((m: any) => ({
      id: modelIdForGoogle(m.name), displayName: m.displayName || modelIdForGoogle(m.name),
      ...(Number.isFinite(m.inputTokenLimit) ? { contextTokens: m.inputTokenLimit } : {}),
    }));
  }
  if (provider.type === 'ollama') {
    const items = Array.isArray(result.models) ? result.models : [];
    return items.filter((m: any) => typeof m.name === 'string').map((m: any) => ({
      id: m.name, displayName: m.name, ...(Number.isFinite(m.context_length) ? { contextTokens: m.context_length } : {}),
    }));
  }
  const items = Array.isArray(result.data) ? result.data : Array.isArray(result.models) ? result.models : [];
  return items.filter((m: any) => typeof m.id === 'string').map((m: any) => {
    const context = m.context_length ?? m.context_window ?? m.max_input_tokens;
    return { id: m.id, displayName: m.display_name || m.name || m.id,
      ...(Number.isFinite(context) ? { contextTokens: Number(context) } : {}) };
  });
}

export async function discoverModels(provider: ProviderRecord): Promise<ModelSummary[]> {
  try { return await fetchModels(provider); }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido al listar modelos.';
    throw new Error(providerMessage(provider, message));
  }
}

function openAIContent(message: CanonicalMessage): string | Array<Record<string, unknown>> {
  if (message.role !== 'user' || !message.images?.length) return message.content;
  return [
    { type: 'text', text: message.content },
    ...message.images.map((image) => ({ type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.data.toString('base64')}` } })),
  ];
}
function anthropicContent(message: CanonicalMessage): string | Array<Record<string, unknown>> {
  if (message.role !== 'user' || !message.images?.length) return message.content;
  return [
    { type: 'text', text: message.content },
    ...message.images.map((image) => ({ type: 'image', source: { type: 'base64', media_type: image.mime, data: image.data.toString('base64') } })),
  ];
}
function prepareOpenAIMessages(messages: CanonicalMessage[]) {
  const result: any[] = [];
  for (const message of messages) {
    result.push({ role: message.role, content: openAIContent(message), ...(message.toolCalls ? { tool_calls: message.toolCalls.map((c) => ({
      id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments) },
    })) } : {}) });
    if (message.toolResults) for (const item of message.toolResults) result.push({ role: 'tool', tool_call_id: item.id, content: item.content });
  }
  return result;
}
function prepareAnthropicMessages(messages: CanonicalMessage[]) {
  let system = '';
  const result: any[] = [];
  for (const message of messages) {
    if (message.role === 'system') { system += `${system ? '\n\n' : ''}${message.content}`; continue; }
    const content = message.toolCalls
      ? [...(message.content ? [{ type: 'text', text: message.content }] : []), ...message.toolCalls.map((call) => ({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments }))]
      : anthropicContent(message);
    result.push({ role: message.role, content });
    if (message.toolResults) result.push({ role: 'user', content: message.toolResults.map((item) => ({ type: 'tool_result', tool_use_id: item.id, content: item.content })) });
  }
  return { system, messages: result };
}
function prepareGoogleContents(messages: CanonicalMessage[]) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const contents = messages.filter((m) => m.role !== 'system').map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [
      ...(m.content ? [{ text: m.content }] : []),
      ...(m.role === 'user' ? (m.images || []).map((image) => ({ inlineData: { mimeType: image.mime, data: image.data.toString('base64') } })) : []),
    ],
  }));
  return { system, contents };
}

async function parseSSE(response: Response, provider: ProviderRecord, signal?: AbortSignal): Promise<AsyncGenerator<string>> {
  if (!response.body) throw new Error('El proveedor devolvió una respuesta vacía.');
  const streamBody = response.body!;
  async function* iterate() {
    const reader = streamBody.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        if (signal?.aborted) throw signal.reason || new Error('Solicitud cancelada.');
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let separator = buffer.indexOf('\n\n');
        while (separator >= 0) {
          const block = buffer.slice(0, separator).replace(/\r/g, '');
          buffer = buffer.slice(separator + 2);
          const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
          if (data && data !== '[DONE]') {
            let event: any;
            try { event = JSON.parse(data); } catch { throw new Error('El proveedor devolvió un evento SSE inválido.'); }
            if (provider.type === 'anthropic') {
              if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) yield event.delta.text;
              if (event.type === 'error') throw new Error(providerMessage(provider, event.error?.message || 'Error de streaming.'));
            } else if (provider.type === 'google') {
              const text = event.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('');
              if (text) yield text;
            } else {
              const text = event.choices?.[0]?.delta?.content;
              if (typeof text === 'string' && text) yield text;
              else if (Array.isArray(text)) for (const part of text) if (typeof part.text === 'string') yield part.text;
            }
          }
          separator = buffer.indexOf('\n\n');
        }
      }
      if (buffer.trim()) {
        const data = buffer.replace(/\r/g, '').split('\n').find((line) => line.startsWith('data:'))?.slice(5).trim();
        if (data && data !== '[DONE]') {
          const event = JSON.parse(data) as any;
          const text = event.choices?.[0]?.delta?.content || event.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('');
          if (typeof text === 'string' && text) yield text;
        }
      }
    } finally { reader.releaseLock(); }
  }
  return iterate();
}

export async function* streamCompletion(provider: ProviderRecord, model: string, messages: CanonicalMessage[], mode: UsageMode, signal?: AbortSignal, outputTokenLimit?: number): AsyncGenerator<StreamEvent> {
  const policy = policyFor(mode, outputTokenLimit);
  try {
    let url: URL;
    let body: unknown;
    const headers = authHeaders(provider);
    if (provider.type === 'google') {
      const prepared = prepareGoogleContents(messages);
      url = googleUrl(provider, `/models/${encodeURIComponent(modelIdForGoogle(model))}:streamGenerateContent?alt=sse`);
      body = { ...(prepared.system ? { systemInstruction: { parts: [{ text: prepared.system }] } } : {}), contents: prepared.contents, generationConfig: { maxOutputTokens: policy.outputTokens } };
    } else if (provider.type === 'anthropic') {
      const prepared = prepareAnthropicMessages(messages);
      url = endpoint(provider, '/messages');
      body = { model, max_tokens: policy.outputTokens, ...(prepared.system ? { system: prepared.system } : {}), messages: prepared.messages, stream: true };
    } else {
      url = endpoint(provider, '/chat/completions');
      body = { model, messages: prepareOpenAIMessages(messages), max_tokens: policy.outputTokens, stream: true };
    }
    const response = await safeProviderFetch(provider, url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!response.ok) return await responseError(provider, response);
    const stream = await parseSSE(response, provider, signal);
    for await (const text of stream) yield { type: 'delta', text };
  } catch (error) {
    const message = error instanceof Error ? error.message : `No se pudo contactar con ${provider.name}.`;
    throw new Error(providerMessage(provider, message));
  }
}

export async function completeText(provider: ProviderRecord, model: string, messages: CanonicalMessage[], mode: UsageMode, signal?: AbortSignal, outputTokenLimit?: number) {
  const policy = policyFor(mode, outputTokenLimit);
  try {
    let url: URL;
    let body: unknown;
    const headers = authHeaders(provider);
    if (provider.type === 'google') {
      const prepared = prepareGoogleContents(messages);
      url = googleUrl(provider, `/models/${encodeURIComponent(modelIdForGoogle(model))}:generateContent`);
      body = { ...(prepared.system ? { systemInstruction: { parts: [{ text: prepared.system }] } } : {}), contents: prepared.contents, generationConfig: { maxOutputTokens: policy.outputTokens } };
    } else if (provider.type === 'anthropic') {
      const prepared = prepareAnthropicMessages(messages);
      url = endpoint(provider, '/messages');
      body = { model, max_tokens: policy.outputTokens, ...(prepared.system ? { system: prepared.system } : {}), messages: prepared.messages };
    } else {
      url = endpoint(provider, '/chat/completions');
      body = { model, messages: prepareOpenAIMessages(messages), max_tokens: policy.outputTokens };
    }
    const response = await safeProviderFetch(provider, url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!response.ok) return await responseError(provider, response);
    const result = await response.json() as any;
    if (provider.type === 'google') return { text: result.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '', usage: result.usageMetadata };
    if (provider.type === 'anthropic') return { text: result.content?.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('') || '', usage: result.usage };
    return { text: result.choices?.[0]?.message?.content || '', usage: result.usage };
  } catch (error) {
    throw new Error(providerMessage(provider, error instanceof Error ? error.message : `No se pudo contactar con ${provider.name}.`));
  }
}

export async function completeWithTools(provider: ProviderRecord, model: string, messages: CanonicalMessage[], mode: UsageMode, tools: ToolDefinition[], signal?: AbortSignal, outputTokenLimit?: number) {
  if (!['openai', 'openai-compatible', 'custom', 'deepseek', 'anthropic'].includes(provider.type)) {
    throw new Error('La integración de herramientas está preparada para APIs OpenAI compatibles y Anthropic; este proveedor no tiene formato de herramientas implementado.');
  }
  const policy = policyFor(mode, outputTokenLimit);
  try {
    const headers = authHeaders(provider);
    let url: URL;
    let body: unknown;
    if (provider.type === 'anthropic') {
      const prepared = prepareAnthropicMessages(messages);
      url = endpoint(provider, '/messages');
      body = { model, max_tokens: policy.outputTokens, ...(prepared.system ? { system: prepared.system } : {}), messages: prepared.messages,
        tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.schema })) };
    } else {
      url = endpoint(provider, '/chat/completions');
      body = { model, messages: prepareOpenAIMessages(messages), max_tokens: policy.outputTokens,
        tools: tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.schema } })), tool_choice: 'auto' };
    }
    const response = await safeProviderFetch(provider, url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!response.ok) return await responseError(provider, response);
    const result = await response.json() as any;
    if (provider.type === 'anthropic') {
      const blocks = result.content || [];
      return { text: blocks.filter((p: any) => p.type === 'text').map((p: any) => p.text).join(''),
        calls: blocks.filter((p: any) => p.type === 'tool_use').map((p: any) => ({ id: p.id, name: p.name, arguments: p.input || {} })) as ToolCall[] };
    }
    const message = result.choices?.[0]?.message || {};
    return { text: typeof message.content === 'string' ? message.content : '', calls: (message.tool_calls || []).map((call: any) => {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function?.arguments || '{}'); } catch { throw new Error('El modelo devolvió argumentos de herramienta con formato JSON inválido.'); }
      return { id: call.id, name: call.function?.name, arguments: args };
    }) as ToolCall[] };
  } catch (error) {
    throw new Error(providerMessage(provider, error instanceof Error ? error.message : `No se pudieron invocar herramientas en ${provider.name}.`));
  }
}

export async function testProvider(provider: ProviderRecord) {
  const models = await discoverModels(provider);
  return { count: models.length, firstModels: models.slice(0, 5).map((model) => model.id) };
}

export function supportsToolProtocol(type: string) {
  return ['openai', 'openai-compatible', 'custom', 'deepseek', 'anthropic'].includes(type);
}
