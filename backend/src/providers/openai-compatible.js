import { ProviderAdapter, cleanMessages } from './base.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('provider:openai');

/**
 * Any service implementing POST {baseUrl}{chatPath} with the OpenAI
 * chat.completions contract (streaming SSE supported).
 */
export class OpenAICompatibleProvider extends ProviderAdapter {
  supportsTools() { return true; }

  headers() {
    const h = { 'Content-Type': 'application/json', ...(this.record.headers || {}) };
    if (this.apiKey && !Object.keys(h).some((k) => k.toLowerCase() === 'authorization')) {
      h.Authorization = `Bearer ${this.apiKey}`;
    }
    return h;
  }

  url(pathname) {
    const base = String(this.record.baseUrl || '').replace(/\/+$/, '');
    const p = String(pathname || '/chat/completions');
    return base + (p.startsWith('/') ? p : `/${p}`);
  }

  async listModels() {
    try {
      const res = await fetch(this.url('/models'), { headers: this.headers(), signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const list = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
      return list.map((m) => ({
        id: m.id,
        name: m.id,
        context: this.record.contextWindow || null,
        size: null,
        status: 'available',
      }));
    } catch (err) {
      log.warn('listModels failed', { provider: this.id, error: err.message });
      throw this.wrapNetworkError(err, this.record.baseUrl);
    }
  }

  buildBody(request) {
    const body = {
      model: request.model,
      messages: cleanMessages(request.messages),
      stream: true,
      stream_options: { include_usage: true },
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
      ...(request.tools?.length ? { tools: request.tools, tool_choice: 'auto' } : {}),
      ...(this.record.bodyParams || {}),
    };
    return body;
  }

  async *streamChat(request) {
    let res;
    try {
      res = await fetch(this.url(this.record.chatPath), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(this.buildBody(request)),
        signal: request.signal,
      });
    } catch (err) {
      yield { type: 'error', message: this.wrapNetworkError(err, this.record.baseUrl).message, code: 'PROVIDER_OFFLINE' };
      return;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let message = `Provider returned HTTP ${res.status}.`;
      try {
        const j = JSON.parse(text);
        message = j?.error?.message || j?.message || message;
      } catch { /* keep default */ }
      yield { type: 'error', message, code: `HTTP_${res.status}` };
      return;
    }

    const toolCalls = new Map();
    let finishReason = null;

    for await (const chunk of sseLines(res.body)) {
      if (chunk === '[DONE]') break;
      let data;
      try { data = JSON.parse(chunk); } catch { continue; }
      const choice = data?.choices?.[0];
      if (choice?.delta?.content) yield { type: 'delta', text: choice.delta.content };
      for (const tc of choice?.delta?.tool_calls || []) {
        const idx = tc.index ?? 0;
        const cur = toolCalls.get(idx) || { id: tc.id || `call_${idx}`, name: '', arguments: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.arguments += tc.function.arguments;
        toolCalls.set(idx, cur);
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (data?.usage) {
        yield {
          type: 'usage',
          promptTokens: data.usage.prompt_tokens ?? null,
          completionTokens: data.usage.completion_tokens ?? null,
        };
      }
    }

    if (toolCalls.size) {
      const calls = [...toolCalls.values()].map((c) => {
        let args = {};
        try { args = c.arguments ? JSON.parse(c.arguments) : {}; } catch { args = { raw: c.arguments }; }
        return { id: c.id, name: c.name, arguments: args };
      });
      yield { type: 'tool_calls', calls };
    }
    yield { type: 'done', finishReason: finishReason || 'stop' };
  }
}

/** Parse an SSE byte stream into `data:` payloads. */
export async function* sseLines(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const part of body) {
    buffer += decoder.decode(part, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
  if (buffer.trim().startsWith('data:')) yield buffer.trim().slice(5).trim();
}
