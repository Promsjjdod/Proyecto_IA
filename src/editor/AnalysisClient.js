/**
 * AnalysisClient — the editor's bridge to the real Luau analysis engine.
 *
 * Analysis runs in the server (`LuauAnalysisService` → `@luau-rs/luau/analysis`), because that
 * is where the engine is available and shared across documents. This client:
 *   - deduplicates identical in-flight requests (typing fast must not queue dozens of calls);
 *   - keeps a small result cache keyed by content hash + position;
 *   - respects the capability state: when the analyser is unavailable it stops calling and
 *     reports the real dependency once, instead of silently degrading.
 *
 * Positions travel as **zero-based** `{line, character}` (the engine's convention).
 */

import { ErrorCode } from '../shared/constants.js';
import { AppError } from '../shared/errors.js';

const CACHE_LIMIT = 60;

export class AnalysisClient {
  #cache = new Map();
  #inflight = new Map();
  #unsupportedReason = null;
  #supported = null;
  #stats = { requests: 0, failures: 0, cacheHits: 0, deduped: 0, totalMs: 0, lastError: null, lastAt: null };

  constructor({ apiClient, capabilities, logger, errorBus, serverAvailable = true }) {
    this.apiClient = apiClient;
    this.capabilities = capabilities;
    this.logger = logger;
    this.errorBus = errorBus;
    this.serverAvailable = serverAvailable;
  }

  get supported() {
    return this.#supported === true && this.serverAvailable;
  }

  get reason() {
    if (!this.serverAvailable) {
      return 'El análisis de tipos requiere el servidor local (la API de análisis vive en él).';
    }
    return this.#unsupportedReason;
  }

  get stats() {
    return { ...this.#stats, cache: this.#cache.size, inflight: this.#inflight.size, supported: this.supported };
  }

  /** Asks the server whether the analyser really works (it compiles a probe module). */
  async probe() {
    if (!this.serverAvailable) {
      this.#supported = false;
      this.#unsupportedReason = 'El servidor local no está disponible';
      return { ok: false, reason: this.#unsupportedReason };
    }
    try {
      const status = await this.apiClient.get('/api/editor/analysis/status', { timeoutMs: 15_000 });
      const state = status?.state ?? null;
      const available = state?.available === true || state?.state === 'AVAILABLE' || state?.state === 'FALLBACK';
      this.#supported = available;
      this.#unsupportedReason = available ? null : (state?.detail ?? 'El analizador de Luau no está disponible en el servidor');
      return { ok: available, reason: this.#unsupportedReason, state };
    } catch (err) {
      this.#supported = false;
      this.#unsupportedReason = `No se pudo comprobar el analizador: ${err.message}`;
      return { ok: false, reason: this.#unsupportedReason, error: err };
    }
  }

  /** Type + lint diagnostics for a module. */
  async check({ module, source, mode = null, lint = null }) {
    if (!this.supported) return this.#unavailable('check');
    return this.#request('check', { module, source, mode, lint }, '/api/editor/analysis/check', {
      timeoutMs: 25_000,
      cacheKey: (payload) => `check:${mode ?? ''}:${lint ?? ''}:${hash(payload.source)}`,
    });
  }

  /** Completions at a zero-based position. */
  async complete({ module, source, line, character }) {
    if (!this.supported) return { entries: [], reason: this.reason };
    return this.#request('complete', { module, source, line, character }, '/api/editor/analysis/complete', {
      timeoutMs: 12_000,
      cacheKey: (payload) => `complete:${payload.line}:${payload.character}:${hash(payload.source)}`,
    });
  }

  /** Documentation/type of the symbol at a position (hover). */
  async hover({ module, source, line, character }) {
    if (!this.supported) return { documentation: null, reason: this.reason };
    return this.#request('hover', { module, source, line, character }, '/api/editor/analysis/hover', {
      timeoutMs: 12_000,
      cacheKey: (payload) => `hover:${payload.line}:${payload.character}:${hash(payload.source)}`,
    });
  }

  async typeAt({ module, source, line, character }) {
    if (!this.supported) return { type: null, reason: this.reason };
    return this.#request('typeAt', { module, source, line, character }, '/api/editor/analysis/type-at', {
      timeoutMs: 12_000,
      cacheKey: (payload) => `type:${payload.line}:${payload.character}:${hash(payload.source)}`,
    });
  }

  /** Source with inferred type annotations (used by the "anotar tipos" action). */
  async decorate({ module, source }) {
    if (!this.supported) return { decorated: null, changed: false, reason: this.reason };
    return this.#request('decorate', { module, source }, '/api/editor/analysis/decorate', {
      timeoutMs: 25_000,
      cacheKey: (payload) => `decorate:${hash(payload.source)}`,
    });
  }

  /** Required modules graph of the document. */
  async modules({ module, source }) {
    if (!this.supported) return { modules: [], returnType: null, reason: this.reason };
    return this.#request('modules', { module, source }, '/api/editor/analysis/modules', {
      timeoutMs: 20_000,
      cacheKey: (payload) => `modules:${hash(payload.source)}`,
    });
  }

  async setMode(mode) {
    if (!this.serverAvailable) return { ok: false, reason: this.reason };
    try {
      const result = await this.apiClient.post('/api/editor/analysis/mode', { mode }, { timeoutMs: 20_000 });
      return { ok: true, mode: result.mode };
    } catch (err) {
      return { ok: false, error: err.message, code: err.code };
    }
  }

  async clearServerCache() {
    try {
      const result = await this.apiClient.post('/api/editor/analysis/cache/clear', {}, { timeoutMs: 8000 });
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  clearCache() {
    const size = this.#cache.size;
    this.#cache.clear();
    return { cleared: size };
  }

  #unavailable(operation) {
    this.#stats.failures += 1;
    this.#stats.lastError = this.reason;
    if (operation === 'complete') return { entries: [], entries_available: false, reason: this.reason };
    return { diagnostics: [], available: false, reason: this.reason };
  }

  async #request(kind, payload, path, { timeoutMs, cacheKey }) {
    const key = cacheKey(payload);
    if (this.#cache.has(key)) {
      this.#stats.cacheHits += 1;
      return { ...this.#cache.get(key), cached: true };
    }
    if (this.#inflight.has(key)) {
      this.#stats.deduped += 1;
      return this.#inflight.get(key);
    }

    const promise = (async () => {
      const started = Date.now();
      this.#stats.requests += 1;
      try {
        const result = await this.apiClient.post(path, payload, { timeoutMs });
        this.#stats.totalMs += Date.now() - started;
        this.#stats.lastAt = Date.now();
        this.#cacheResult(key, result);
        return result;
      } catch (err) {
        this.#stats.failures += 1;
        this.#stats.lastError = err.message;
        if (err?.code === ErrorCode.UNAVAILABLE) {
          this.#supported = false;
          this.#unsupportedReason = err.detail?.requirement
            ? `${err.message} (requiere: ${err.detail.requirement})`
            : err.message;
          this.logger?.warn(`El análisis de Luau dejó de estar disponible: ${this.#unsupportedReason}`, { source: 'AnalysisClient' });
        } else if (err?.name === 'AppClientError' && err.retriable !== true) {
          // A real failure in a request (not the server being down): report but keep working.
          this.errorBus?.report(err, { source: `AnalysisClient.${kind}`, kind: 'EDITOR' });
        }
        if (kind === 'complete') return { entries: [], error: err.message, code: err.code };
        if (kind === 'hover') return { documentation: null, error: err.message };
        if (kind === 'modules') return { modules: [], returnType: null, error: err.message };
        if (kind === 'decorate' || kind === 'typeAt') return { error: err.message, code: err.code };
        return { diagnostics: [], error: err.message, code: err.code };
      } finally {
        this.#inflight.delete(key);
      }
    })();

    this.#inflight.set(key, promise);
    return promise;
  }

  #cacheResult(key, result) {
    if (this.#cache.size >= CACHE_LIMIT) {
      const oldest = this.#cache.keys().next().value;
      this.#cache.delete(oldest);
    }
    this.#cache.set(key, result);
  }

  /** Converts engine diagnostics (0-based LSP ranges) into the editor's shape. */
  static toEditorDiagnostics(diagnostics, doc) {
    const output = [];
    for (const entry of diagnostics ?? []) {
      const range = entry.range ?? null;
      let from = 0;
      let to = 0;
      if (range) {
        from = positionToOffset(doc, range.start);
        to = Math.max(from + 1, positionToOffset(doc, range.end));
      }
      output.push({
        from,
        to: Math.min(to, doc.length),
        severity: entry.severity === 'error' ? 'error' : entry.severity === 'warning' || entry.severity === 'information' ? 'warning' : 'info',
        source: entry.code ? `luau(${entry.code})` : 'luau',
        message: entry.message,
        kind: entry.kind,
        code: entry.code,
        line: entry.line ?? null,
        column: entry.column ?? null,
      });
    }
    return output;
  }
}

/** Zero-based `{line, character}` → absolute document offset. */
export function positionToOffset(doc, position) {
  if (!position) return 0;
  const lineNumber = Math.min(Math.max((position.line ?? 0) + 1, 1), doc.lines);
  const line = doc.line(lineNumber);
  const character = Math.max(0, Math.min(position.character ?? 0, line.length));
  return line.from + character;
}

/** Absolute offset → zero-based `{line, character}`. */
export function offsetToPosition(doc, offset) {
  const clamped = Math.max(0, Math.min(offset, doc.length));
  const line = doc.lineAt(clamped);
  return { line: line.number - 1, character: clamped - line.from };
}

/** Small, fast string hash used only as a cache key. */
export function hash(text) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(36);
}

export { AppError };
