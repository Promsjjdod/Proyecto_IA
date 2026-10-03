import { ProviderAdapter, cleanMessages } from './base.js';
import { sseLines } from './openai-compatible.js';

/**
 * Generic HTTP provider for inference gateways that do not follow the exact
 * OpenAI contract. Configurable per provider record:
 *   - chatPath      request path appended to baseUrl
 *   - responseMode  'openai-sse' | 'json-text' | 'ndjson-ollama'
 *   - headers       arbitrary custom headers
 *   - bodyParams    arbitrary extra body parameters
 */
export class CustomProvider extends ProviderAdapter {
  supportsTools() { return this.record.responseMode !== 'json-text'; }

  base() { return String(this.record.baseUrl || '').replace(/\/+$/, ''); }

  headers() {
    const h = { 'Content-Type': 'application/json', ...(this.record.headers || {}) };
    if (this.apiKey && !Object.keys(h).some((k) => k.toLowerCase() === 'authorization')) {
      h.Authorization = `Bearer ${this.apiKey}`;
    }
    return h;
  }

  async listModels() {
    try {
      const res = await fetch(`${this.base()}/models`, { headers: this.headers(), signal: AbortSignal.timeout(6000) });
      if (!res.ok) return [];
      const body = await res.json();
      const list = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
      return list.map((m) => ({ id: m.id || m.name, name: m.id || m.name, context: this.record.contextWindow || null, size: null, status: 'available' }));
    } catch {
      return [];
    }
  }

  async *streamChat(request) {
    const mode = this.record.responseMode || 'openai-sse';
    const stream = mode !== 'json-text';
    let res;
    try {
      res = await fetch(this.base() + (this.record.chatPath || '/chat/completions'), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model: request.model,
          messages: cleanMessages(request.messages),
          stream,
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
          ...(stream && request.tools?.length ? { tools: request.tools } : {}),
          ...(this.record.bodyParams || {}),
        }),
        signal: request.signal,
      });
    } catch (err) {
      yield { type: 'error', message: this.wrapNetworkError(err, this.base()).message, code: 'PROVIDER_OFFLINE' };
      return;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      yield { type: 'error', message: `Provider returned HTTP ${res.status}. ${text.slice(0, 300)}`, code: `HTTP_${res.status}` };
      return;
    }

    if (mode === 'json-text') {
      const body = await res.json();
      const text = body?.choices?.[0]?.message?.content
        ?? body?.output ?? body?.text ?? body?.result ?? body?.completion
        ?? (typeof body === 'string' ? body : JSON.stringify(body));
      if (text) yield { type: 'delta', text: String(text) };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }

    if (mode === 'ndjson-ollama') {
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const part of res.body) {
        buffer += decoder.decode(part, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          try {
            const data = JSON.parse(line);
            if (data?.message?.content) yield { type: 'delta', text: data.message.content };
          } catch { /* skip */ }
        }
      }
      yield { type: 'done', finishReason: 'stop' };
      return;
    }

    // openai-sse
    for await (const chunk of sseLines(res.body)) {
      if (chunk === '[DONE]') break;
      let data;
      try { data = JSON.parse(chunk); } catch { continue; }
      const delta = data?.choices?.[0]?.delta?.content ?? data?.choices?.[0]?.text;
      if (delta) yield { type: 'delta', text: delta };
      if (data?.usage) {
        yield { type: 'usage', promptTokens: data.usage.prompt_tokens ?? null, completionTokens: data.usage.completion_tokens ?? null };
      }
    }
    yield { type: 'done', finishReason: 'stop' };
  }
}
