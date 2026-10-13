import type { StreamEvent } from './types.js';
import { providerTextContent } from './content.js';

function tokenCount(value: unknown) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : undefined;
}

function usageEvent(value: any): StreamEvent | null {
  const inputTokens = tokenCount(value?.prompt_tokens ?? value?.input_tokens ?? value?.promptTokenCount);
  const outputTokens = tokenCount(value?.completion_tokens ?? value?.output_tokens ?? value?.candidatesTokenCount);
  return inputTokens !== undefined || outputTokens !== undefined ? { type: 'usage', inputTokens, outputTokens } : null;
}

function finishEvent(providerType: string, reason: unknown): StreamEvent | null {
  if (typeof reason !== 'string' || !reason) return null;
  const normalized = reason.toLowerCase();
  const truncated = ['length', 'max_tokens', 'max_tokens_reached', 'max_output_tokens', 'max_completion_tokens', 'token_limit_reached'].includes(normalized);
  const incompleteByStreamClosure = normalized.includes('without-finish-reason') || normalized.includes('closed-without-finish') || normalized.includes('done-without-finish');
  const complete = !truncated && !incompleteByStreamClosure && ['stop', 'end_turn', 'stop_sequence', 'message_stop', 'finished_stop', 'tool_calls', 'tool_call', 'tool_use', 'function_call', 'response'].includes(normalized);
  return { type: 'finish', reason: `${providerType}:${reason}`, complete, truncated: truncated || incompleteByStreamClosure };
}

function parseFrame(block: string) {
  let event = '';
  const data: string[] = [];
  for (const line of block.split(/\r\n|\r|\n/)) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (!data.length) return { event, payload: null, sentinel: false };
  const raw = data.join('\n');
  if (raw.trim() === '[DONE]') return { event, payload: null, sentinel: true };
  try { return { event, payload: JSON.parse(raw), sentinel: false }; }
  catch { throw new Error('El proveedor devolvió un evento SSE inválido.'); }
}

function frameEvents(providerType: string, frame: ReturnType<typeof parseFrame>): StreamEvent[] {
  if (frame.sentinel || !frame.payload) return [];
  const payload = frame.payload as any;
  if (frame.event === 'error' || payload.error) {
    const detail = typeof payload.error?.message === 'string' ? payload.error.message
      : typeof payload.message === 'string' ? payload.message : 'Error de streaming del proveedor.';
    throw new Error(detail.slice(0, 1000));
  }
  const result: StreamEvent[] = [];
  if (providerType === 'anthropic') {
    const usage = usageEvent(payload.usage);
    if (usage) result.push(usage);
    if (payload.type === 'content_block_delta' && payload.delta?.type === 'text_delta' && typeof payload.delta.text === 'string' && payload.delta.text) {
      result.push({ type: 'delta', text: payload.delta.text });
    }
    if (payload.type === 'message_delta') {
      const messageUsage = usageEvent(payload.usage);
      if (messageUsage) result.push(messageUsage);
      const finish = finishEvent(providerType, payload.delta?.stop_reason);
      if (finish) result.push(finish);
    }
    if (payload.type === 'message_stop') {
      // Anthropic's message_stop is a protocol-level confirmation if a stop reason was omitted.
      result.push({ type: 'finish', reason: 'anthropic:message_stop', complete: true, truncated: false });
    }
    return result;
  }
  if (providerType === 'google') {
    const usage = usageEvent(payload.usageMetadata);
    if (usage) result.push(usage);
    for (const candidate of payload.candidates || []) {
      const text = providerTextContent(candidate.content?.parts);
      if (text) result.push({ type: 'delta', text });
      const finish = finishEvent(providerType, candidate.finishReason);
      if (finish) result.push(finish);
    }
    return result;
  }
  const usage = usageEvent(payload.usage);
  if (usage) result.push(usage);
  for (const choice of payload.choices || []) {
    const content = choice.delta?.content ?? choice.message?.content;
    if (typeof content === 'string' && content) result.push({ type: 'delta', text: content });
    else if (Array.isArray(content)) {
      const text = providerTextContent(content);
      if (text) result.push({ type: 'delta', text });
    }
    const finish = finishEvent(providerType, choice.finish_reason);
    if (finish) result.push(finish);
  }
  return result;
}

/** Parses SSE frames independent of transport chunk boundaries, including CRLF and CR framing. */
export async function* parseProviderSSE(response: Response, providerType: string): AsyncGenerator<StreamEvent> {
  if (!response.body) throw new Error('El proveedor devolvió una respuesta vacía.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let gotSentinel = false;
  let gotFinish = false;
  let reachedEof = false;
  const boundaryPattern = /(?:\r\n|\r|\n){2}/;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) { reachedEof = true; buffer += decoder.decode(); }
      else buffer += decoder.decode(chunk.value, { stream: true });
      let boundary = boundaryPattern.exec(buffer);
      while (boundary) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const frame = parseFrame(block);
        gotSentinel ||= frame.sentinel;
        for (const event of frameEvents(providerType, frame)) {
          if (event.type === 'finish') {
            if (gotFinish) continue;
            gotFinish = true;
          }
          yield event;
        }
        boundary = boundaryPattern.exec(buffer);
      }
      if (chunk.done) break;
    }
    if (buffer.trim()) {
      const frame = parseFrame(buffer);
      gotSentinel ||= frame.sentinel;
      for (const event of frameEvents(providerType, frame)) {
        if (event.type === 'finish') {
          if (gotFinish) continue;
          gotFinish = true;
        }
        yield event;
      }
    }
    if (!gotFinish) {
      yield { type: 'finish', reason: gotSentinel ? 'stream:done-without-finish-reason' : 'stream:closed-without-finish-reason', complete: false, truncated: false };
    }
  } finally {
    if (!reachedEof) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
