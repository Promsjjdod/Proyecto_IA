import { ProviderAdapter } from './base.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Built-in DEMO provider.
 *
 * Keeps the entire workspace usable with zero configuration. Every response
 * is simulated locally and the UI tags it with a visible DEMO badge, so there
 * is never any confusion about what is real model output.
 */
export class DemoProvider extends ProviderAdapter {
  supportsTools() { return false; }
  supportsStreaming() { return true; }

  async listModels() {
    return [
      { id: 'forge-demo-1', name: 'Forge Demo 1 (simulated)', context: 8192, size: null, status: 'demo' },
      { id: 'forge-demo-mini', name: 'Forge Demo Mini (simulated)', context: 4096, size: null, status: 'demo' },
    ];
  }

  buildResponse(request) {
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
    const prompt = (lastUser?.content || '').trim();
    const snippet = prompt.length > 140 ? `${prompt.slice(0, 140)}…` : prompt || 'your request';
    const asksCode = /code|function|script|bug|fix|implement|regex|sql|component/i.test(prompt);
    const asksList = /list|steps|plan|compare|options|ideas/i.test(prompt);
    const model = request.model || 'forge-demo-1';

    if (asksCode) {
      return [
        `Here is a working starting point for **${snippet}**:`,
        '',
        '```js',
        '// ForgeAI demo output - simulated locally, no external model was called.',
        'export function solve(input) {',
        '  const cleaned = String(input).trim();',
        '  if (!cleaned) throw new Error("Empty input");',
        '  return cleaned',
        '    .split(/\\s+/)',
        '    .map((word) => word[0].toUpperCase() + word.slice(1))',
        '    .join(" ");',
        '}',
        '```',
        '',
        'Notes:',
        '- Input is validated before processing (fail fast, clear errors).',
        '- The function is pure, so it is trivial to unit test.',
        '- Swap the body for your real domain logic; the contract stays stable.',
        '',
        'Want me to adapt this to TypeScript, add tests, or wire it into a route?',
      ].join('\n');
    }

    if (asksList) {
      return [
        `A practical breakdown for **${snippet}**:`,
        '',
        '1. **Clarify the goal** - write the desired outcome in one sentence before touching tools.',
        '2. **Inventory what exists** - files, dependencies and current behaviour.',
        '3. **Smallest useful slice** - deliver one vertical cut end to end.',
        '4. **Verify** - run the project, check the output, read the errors.',
        '5. **Iterate** - extend only after the slice is proven.',
        '',
        'This is simulated demo output: connect a provider in **Settings → Providers**',
        '(or install Ollama) to get real model answers with the same interface.',
      ].join('\n');
    }

    return [
      `You said: *${snippet}*`,
      '',
      'I am the built-in **ForgeAI demo responder**, so this answer is generated locally',
      'without any model provider. Everything around it is fully functional: streaming,',
      'markdown rendering, chat history, agents, tools, files and the WORK task runner.',
      '',
      'To get real model output, open **Settings → Providers** and either:',
      '- enable the **Ollama** provider (models are detected from your local instance), or',
      '- add any **OpenAI-compatible** endpoint with a base URL and API key.',
      '',
      'Ask me for `code`, a `plan` or a `list` and I will show the matching demo format.',
    ].join('\n');
  }

  async *streamChat(request) {
    const text = this.buildResponse(request);
    const words = text.split(/(\s+)/);
    const started = Date.now();
    let out = 0;
    for (const w of words) {
      if (request.signal?.aborted) {
        yield { type: 'done', finishReason: 'abort' };
        return;
      }
      yield { type: 'delta', text: w };
      out += Math.max(1, Math.round(w.length / 4));
      await sleep(12 + Math.random() * 22);
    }
    const secs = (Date.now() - started) / 1000;
    yield {
      type: 'usage',
      promptTokens: Math.round((request.messages.map((m) => m.content || '').join(' ').length) / 4),
      completionTokens: out,
      tokensPerSec: secs > 0 ? +(out / secs).toFixed(1) : null,
    };
    yield { type: 'done', finishReason: 'stop', demo: true };
  }
}
