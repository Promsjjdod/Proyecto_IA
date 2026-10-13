type TextContentBlock = {
  type?: unknown;
  text?: unknown;
  refusal?: unknown;
};

export function providerTextContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';

  return value.map((block: unknown) => {
    if (typeof block === 'string') return block;
    if (!block || typeof block !== 'object' || Array.isArray(block)) return '';
    const item = block as TextContentBlock;
    if (item.type === 'refusal') return typeof item.refusal === 'string' ? item.refusal : '';
    if (typeof item.type !== 'string' || !['text', 'output_text', 'text_delta'].includes(item.type)) return '';
    if (typeof item.text === 'string') return item.text;
    return item.type === 'text' && typeof item.refusal === 'string' ? item.refusal : '';
  }).join('');
}
