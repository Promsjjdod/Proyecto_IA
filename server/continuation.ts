import type { ModelTokenLimits } from './config.js';
import type { CanonicalMessage } from './providers/types.js';
import { estimateTextUnits } from './usage.js';

function positiveLimit(value: number | null | undefined) {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

export function appendContinuation(baseText: string, nextChunk: string) {
  if (!nextChunk) return baseText;
  if (!baseText || nextChunk.startsWith(baseText)) return nextChunk;

  const prefixLengths = new Uint32Array(nextChunk.length);
  for (let index = 1, prefixLength = 0; index < nextChunk.length; index += 1) {
    while (prefixLength > 0 && nextChunk[index] !== nextChunk[prefixLength]) prefixLength = prefixLengths[prefixLength - 1];
    if (nextChunk[index] === nextChunk[prefixLength]) prefixLength += 1;
    prefixLengths[index] = prefixLength;
  }

  let overlap = 0;
  for (let index = 0; index < baseText.length; index += 1) {
    while (overlap > 0 && (overlap === nextChunk.length || baseText[index] !== nextChunk[overlap])) overlap = prefixLengths[overlap - 1];
    if (baseText[index] === nextChunk[overlap]) overlap += 1;
  }
  return baseText + nextChunk.slice(overlap);
}

export function buildContinuationMessages(
  baseMessages: CanonicalMessage[],
  generatedText: string,
  instruction: string,
  limits: ModelTokenLimits,
  remainingTaskTokens: number,
): CanonicalMessage[] {
  const contextTokens = positiveLimit(limits.contextTokens);
  const maxInputTokens = positiveLimit(limits.maxInputTokens);
  const maxOutputTokens = positiveLimit(limits.maxOutputTokens);
  const outputBudget = Math.max(0, Math.floor(remainingTaskTokens));
  const requestOutputLimit = maxOutputTokens === null ? outputBudget : Math.min(maxOutputTokens, outputBudget);
  const contextInputLimit = contextTokens === null ? Number.POSITIVE_INFINITY : Math.max(0, contextTokens - requestOutputLimit);
  const inputLimit = Math.min(maxInputTokens ?? Number.POSITIVE_INFINITY, contextInputLimit);
  const fixedInputTokens = estimateTextUnits(baseMessages.map((message) => message.content).join('\n'))
    + baseMessages.reduce((count, message) => count + (message.images?.length || 0) * 750, 0)
    + estimateTextUnits(instruction);
  const continuationTokens = Math.max(0, inputLimit - fixedInputTokens);
  let continuationText = generatedText;
  if (Number.isFinite(continuationTokens)) {
    const maxBytes = Math.floor(continuationTokens * 4);
    const encoded = Buffer.from(generatedText, 'utf8');
    let start = Math.max(0, encoded.length - maxBytes);
    while (start < encoded.length && (encoded[start] & 0xc0) === 0x80) start += 1;
    continuationText = encoded.subarray(start).toString('utf8');
  }
  return [
    ...baseMessages,
    ...(continuationText ? [{ role: 'assistant' as const, content: continuationText }] : []),
    { role: 'user', content: instruction },
  ];
}
