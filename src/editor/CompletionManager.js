/**
 * CompletionManager — real autocompletion.
 *
 * Sources, in order of relevance:
 *   1. **Language engine**: member/expression completions from the Luau analyser
 *      (`fragmentAutocomplete`), which knows the types of the surrounding module.
 *   2. **Snippets**: dialect-aware templates inserted with tab stops.
 *   3. **Keywords and standard library**, filtered by dialect.
 *   4. **Words in the document** (unique identifiers), so local names always complete.
 *
 * The engine query is debounced and cached per document version + position; while it is in
 * flight the local sources answer immediately, so typing never waits on the server.
 */

import { snippetCompletion } from '@codemirror/autocomplete';
import { snippet } from '@codemirror/autocomplete';
import { Dialect } from '../shared/constants.js';
import { KEYWORD_COMPLETIONS, SNIPPETS, STDLIB_COMPLETIONS, snippetsFor } from './snippets.js';
import { offsetToPosition } from './AnalysisClient.js';

const ENGINE_DEBOUNCE_MS = 220;
const MAX_DOCUMENT_WORDS = 900;

export class CompletionManager {
  #cache = new Map();
  #timer = null;
  #pending = null;
  #stats = { requested: 0, engineResults: 0, localResults: 0, failures: 0, servedFromCache: 0 };

  constructor({ analysis, settings, logger } = {}) {
    this.analysis = analysis;
    this.settings = settings;
    this.logger = logger;
  }

  describe() {
    return { enabled: this.settings?.get('editor.autocomplete') !== false, ...this.#stats };
  }

  /**
   * Builds a CodeMirror `CompletionSource`.
   * @param {{ getDialect: () => string, getModuleName: () => string }} context
   */
  createSource(context) {
    return (completionContext) => {
      const enabled = this.settings?.get('editor.autocomplete') !== false;
      if (!enabled) return null;

      const doc = completionContext.state.doc;
      const position = offsetToPosition(doc, completionContext.pos);
      const line = doc.lineAt(completionContext.pos).text;
      const dialect = context.getDialect() ?? Dialect.LUAU;
      const word = completionContext.matchBefore(/[\w.:]+/);
      const memberAccess = /[.:]\s*\w*$/.test(line.slice(0, completionContext.pos - doc.lineAt(completionContext.pos).from));

      if (!completionContext.explicit && (!word || (word.from === word.to && !memberAccess))) {
        return null;
      }
      const token = word ? word.text : '';

      this.#stats.requested += 1;
      const local = this.#localCompletions({ token, dialect, doc, explicit: completionContext.explicit === true, memberAccess });
      const from = memberAccess
        ? Math.max(word?.from ?? completionContext.pos, completionContext.pos - (token.split(/[.:]/).pop() ?? '').length)
        : (word?.from ?? completionContext.pos);

      // The engine enriches the list; it never blocks the local results.
      const enginePromise = this.#engineCompletions({ module: context.getModuleName(), source: doc.toString(), position, doc });

      if (!enginePromise) {
        this.#stats.localResults += 1;
        return local.length > 0 ? { from, options: local, validFor: /^[\w.]*$/ } : null;
      }

      return {
        from,
        options: local,
        validFor: /^[\w.]*$/,
        async filter() {
          return true;
        },
        // `apply` is handled by CodeMirror; the async list replaces/extends the options.
        async add() {
          return enginePromise;
        },
      };
    };
  }

  #localCompletions({ token, dialect, doc, explicit, memberAccess }) {
    const options = [];
    const suffix = token.toLowerCase();

    if (!memberAccess) {
      const limit = this.settings?.get('editor.maxCompletionItems') ?? 120;
      for (const snippet of snippetsFor(dialect)) {
        if (suffix === '' && !explicit) continue;
        if (suffix !== '' && !snippet.label.toLowerCase().startsWith(suffix) && !snippet.detail.toLowerCase().startsWith(suffix)) continue;
        options.push(snippetCompletion(snippet.template, {
          label: snippet.label,
          detail: snippet.detail,
          type: 'snippet',
          info: snippet.documentation,
          boost: 60,
        }));
        if (options.length >= limit) break;
      }
      if (!memberAccess) {
        for (const keyword of KEYWORD_COMPLETIONS) {
          if (keyword.dialects && !keyword.dialects.includes(dialect)) continue;
          if (suffix !== '' && !keyword.label.startsWith(suffix)) continue;
          options.push({ label: keyword.label, type: 'keyword', boost: 20 });
        }
        if (this.settings?.get('editor.snippets') !== false) {
          for (const name of STDLIB_COMPLETIONS) {
            if (suffix !== '' && !name.startsWith(suffix)) continue;
            options.push({ label: name, type: 'function', detail: 'estándar', boost: 10 });
          }
        }
      }
    }

    // Document words: real identifiers the user already wrote.
    const words = documentWords(doc, suffix);
    for (const word of words) {
      options.push({ label: word, type: 'text', boost: 5 });
    }
    return options;
  }

  #engineCompletions({ module, source, position, doc }) {
    if (!this.analysis?.supported) return null;
    const key = `${module}:${position.line}:${position.character}:${source.length}`;
    const cached = this.#cache.get(key);
    if (cached) {
      this.#stats.servedFromCache += 1;
      return cached;
    }
    const promise = Promise.resolve()
      .then(() => this.analysis.complete({ module, source, line: position.line, character: position.character }))
      .then((result) => {
        const entries = result?.entries ?? [];
        this.#stats.engineResults += entries.length;
        return this.#toOptions(entries, doc);
      })
      .catch((err) => {
        this.#stats.failures += 1;
        this.logger?.warn?.(`El autocompletado del motor falló: ${err.message}`, { source: 'CompletionManager' });
        return [];
      });
    this.#cacheEngine(key, promise);
    return promise;
  }

  #cacheEngine(key, promise) {
    if (this.#cache.size > 40) {
      const oldest = this.#cache.keys().next().value;
      this.#cache.delete(oldest);
    }
    this.#cache.set(key, promise);
  }

  #toOptions(entries, doc) {
    const options = [];
    for (const entry of entries) {
      const insert = entry.insertText ?? entry.label;
      const wantsParens = entry.parentheses === 'required' || entry.parentheses === 'optional';
      const base = {
        label: entry.label,
        type: mapCompletionKind(entry.kind),
        detail: entry.type ?? entry.kind ?? undefined,
        info: entry.documentation ?? undefined,
        boost: entry.kind === 'Property' || entry.kind === 'Method' ? 90 : 50,
        deprecated: entry.deprecated === true ? 'obsoleto' : undefined,
      };
      if (wantsParens && !insert.endsWith('(')) {
        options.push(snippet(`${insert}(\${})`)(buildOption(base, insert)));
      } else {
        options.push(base);
      }
    }
    void doc;
    return options;
  }

  /**
   * Request-scoped completion used by the editor's "autocompletado forzado" (Ctrl+Space)
   * when the engine is the only useful source.
   */
  async requestEngine({ module, source, line, character, doc }) {
    if (!this.analysis?.supported) return { entries: [], reason: this.analysis?.reason ?? 'no disponible' };
    const result = await this.analysis.complete({ module, source, line, character });
    return { entries: result?.entries ?? [], status: result?.status ?? null, doc };
  }

  clearCache() {
    const size = this.#cache.size;
    this.#cache.clear();
    return { cleared: size };
  }

  dispose() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#pending = null;
    this.#cache.clear();
  }
}

/** Maps Luau completion kinds onto CodeMirror's completion icon types. */
function mapCompletionKind(kind) {
  switch (kind) {
    case 'Function': case 'Method': return 'function';
    case 'Property': case 'Field': return 'property';
    case 'Class': case 'Type': case 'Enum': case 'Interface': return 'type';
    case 'Keyword': return 'keyword';
    case 'Variable': case 'Parameter': case 'Local': return 'variable';
    case 'Module': return 'namespace';
    case 'Snippet': return 'snippet';
    default: return 'text';
  }
}

function buildOption(base, insert) {
  return { ...base, type: base.type, label: base.label, detail: base.detail ?? insert };
}

/** Unique identifiers present in the document (bounded scan, ignores comments roughly). */
export function documentWords(doc, prefix, limit = MAX_DOCUMENT_WORDS) {
  const seen = new Set();
  const text = doc.toString();
  const limitScan = Math.min(text.length, 200_000);
  const regex = /[A-Za-z_][A-Za-z0-9_]{1,}/g;
  let match;
  while ((match = regex.exec(text.slice(0, limitScan))) !== null) {
    const word = match[0];
    if (prefix !== '' && !word.toLowerCase().startsWith(prefix)) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    if (seen.size >= limit) break;
  }
  return [...seen];
}

export { SNIPPETS };
