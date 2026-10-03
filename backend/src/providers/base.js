import { providerOffline } from '../core/errors.js';

/**
 * Base class for all chat providers.
 *
 * A provider adapter must implement:
 *   - listModels(): Promise<ModelInfo[]>
 *   - streamChat(request): AsyncGenerator<StreamEvent>
 *
 * StreamEvent shapes:
 *   { type: 'delta', text }
 *   { type: 'tool_calls', calls: [{ id, name, arguments }] }
 *   { type: 'usage', promptTokens, completionTokens }
 *   { type: 'done', finishReason, tokensPerSec }
 *   { type: 'error', message, code }
 */
export class ProviderAdapter {
  constructor(record, { apiKey = null } = {}) {
    this.record = record;
    this.apiKey = apiKey;
    this.kind = record.kind;
  }

  get id() { return this.record.id; }
  get name() { return this.record.name; }

  supportsTools() { return false; }
  supportsStreaming() { return true; }

  async listModels() { return []; }
  async *streamChat() { throw new Error('streamChat not implemented'); }

  /** Human-readable connection error. */
  wrapNetworkError(err, baseUrl) {
    const cause = err?.cause?.code || err?.code || '';
    const hint = /ECONNREFUSED/.test(cause)
      ? 'Connection refused - is the service running?'
      : /ENOTFOUND|EAI_AGAIN/.test(cause)
        ? 'Host not found - check the base URL.'
        : /ETIMEDOUT/.test(cause)
          ? 'Connection timed out.'
          : '';
    return providerOffline(`Unable to connect to provider${baseUrl ? ` (${baseUrl})` : ''}.${hint ? ` ${hint}` : ''}`);
  }
}

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return null;
  const n = Number(bytes);
  if (!Number.isFinite(n)) return String(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** Convert OpenAI-style message list to plain objects (strip undefined). */
export function cleanMessages(messages) {
  return messages.map((m) => {
    const out = { role: m.role, content: m.content ?? '' };
    if (m.name) out.name = m.name;
    if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
    if (m.tool_calls) out.tool_calls = m.tool_calls;
    return out;
  });
}
