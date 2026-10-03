import { ProviderAdapter, cleanMessages, formatBytes } from './base.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('provider:ollama');

/**
 * Native Ollama adapter (https://github.com/ollama/ollama/blob/main/docs/api.md).
 * Models are always detected live from the API - nothing is assumed installed.
 */
export class OllamaProvider extends ProviderAdapter {
  supportsTools() { return true; }

  base() { return String(this.record.baseUrl || 'http://localhost:11434').replace(/\/+$/, ''); }

  headers() {
    const h = { 'Content-Type': 'application/json', ...(this.record.headers || {}) };
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  async listModels() {
    let tags;
    try {
      const res = await fetch(`${this.base()}/api/tags`, { headers: this.headers(), signal: AbortSignal.timeout(6000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      tags = await res.json();
    } catch (err) {
      log.debug('ollama unreachable', { error: err.message });
      throw this.wrapNetworkError(err, this.base());
    }
    const loaded = new Set();
    try {
      const ps = await fetch(`${this.base()}/api/ps`, { headers: this.headers(), signal: AbortSignal.timeout(4000) });
      if (ps.ok) {
        const j = await ps.json();
        for (const m of j?.models || []) loaded.add(m.name);
      }
    } catch { /* ps is optional */ }

    const models = [];
    for (const m of tags?.models || []) {
      let context = null;
      try {
        const show = await fetch(`${this.base()}/api/show`, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({ name: m.name }),
          signal: AbortSignal.timeout(4000),
        });
        if (show.ok) {
          const j = await show.json();
          const info = j?.model_info || {};
          const key = Object.keys(info).find((k) => k.endsWith('.context_length'));
          if (key) context = info[key];
        }
      } catch { /* context unknown */ }
      models.push({
        id: m.name,
        name: m.name,
        context,
        size: formatBytes(m.size),
        status: loaded.has(m.name) ? 'loaded' : 'available',
        family: m.details?.family || null,
        parameterSize: m.details?.parameter_size || null,
      });
    }
    return models;
  }

  async *streamChat(request) {
    let res;
    try {
      res = await fetch(`${this.base()}/api/chat`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model: request.model,
          messages: cleanMessages(request.messages),
          stream: true,
          ...(request.tools?.length ? { tools: request.tools } : {}),
          options: {
            ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
            ...(request.maxTokens ? { num_predict: request.maxTokens } : {}),
          },
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
      let message = `Ollama returned HTTP ${res.status}.`;
      try { message = JSON.parse(text)?.error || message; } catch { /* default */ }
      yield { type: 'error', message, code: `HTTP_${res.status}` };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let toolCalls = [];
    let usage = null;
    for await (const part of res.body) {
      buffer += decoder.decode(part, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let data;
        try { data = JSON.parse(line); } catch { continue; }
        if (data?.message?.content) yield { type: 'delta', text: data.message.content };
        if (data?.message?.tool_calls?.length) {
          toolCalls = toolCalls.concat(data.message.tool_calls.map((tc, i) => ({
            id: `ollama_${Date.now()}_${i}`,
            name: tc.function?.name,
            arguments: tc.function?.arguments || {},
          })));
        }
        if (data?.done) {
          const secs = (data.eval_duration || 0) / 1e9;
          usage = {
            promptTokens: data.prompt_eval_count ?? null,
            completionTokens: data.eval_count ?? null,
            tokensPerSec: secs > 0 && data.eval_count ? +(data.eval_count / secs).toFixed(1) : null,
          };
        }
      }
    }
    if (toolCalls.length) yield { type: 'tool_calls', calls: toolCalls };
    if (usage) yield { type: 'usage', promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, tokensPerSec: usage.tokensPerSec };
    yield { type: 'done', finishReason: 'stop' };
  }
}
