/**
 * LuauAnalysisService — real Luau type checking, linting and completion.
 *
 * Wraps `AnalysisWorker` from `@luau-rs/luau/analysis/worker` (the official Luau analysis
 * library compiled to WebAssembly) and exposes editor-friendly operations:
 *
 *  - check(module, source)         → diagnostics (type errors, lint warnings) with 0-based ranges
 *  - complete(module, source, pos) → real completion entries (properties, bindings, keywords, types)
 *  - typeAt / inspect              → inferred type of the symbol under the cursor
 *  - documentation                 → the Luau documentation symbol for hover
 *  - decorate                      → full source with inferred type annotations
 *
 * Robustness:
 *  - queries are serialised (the worker accepts one at a time) through a promise chain;
 *  - results are memoised by content hash so typing does not re-run the analyser repeatedly;
 *  - any worker failure tears it down and rebuilds it on the next query, and the capability
 *    is reported as unavailable instead of pretending the analysis happened.
 */

import crypto from 'node:crypto';
import { CapabilityState, ErrorCode, ErrorKind } from '../../shared/constants.js';
import { AppError, toAppError } from '../../shared/errors.js';

const CACHE_LIMIT = 400;

export class LuauAnalysisService {
  #worker = null;
  #chain = Promise.resolve();
  #cache = new Map();
  #stats = { checks: 0, completions: 0, cacheHits: 0, failures: 0, totalMs: 0, lastAt: null };
  #initializing = null;
  #disposed = false;

  constructor({ logger, errorHandler, capabilities }) {
    this.logger = logger;
    this.errorHandler = errorHandler;
    this.capabilities = capabilities;
    this.settings = null;
    this.available = null;
  }

  setSettings(settings) {
    this.settings = settings;
  }

  /* ---------------------------------------------------------------- *
   * Lifecycle
   * ---------------------------------------------------------------- */

  async #getWorker() {
    if (this.#disposed) throw new AppError({ message: 'El servicio de análisis está cerrado', code: ErrorCode.UNAVAILABLE, kind: ErrorKind.EDITOR });
    if (this.#worker) return this.#worker;
    if (this.#initializing) return this.#initializing;
    this.#initializing = (async () => {
      try {
        const { AnalysisWorker } = await import('@luau-rs/luau/analysis/worker');
        const mode = this.#mode();
        const lint = this.#lintEnabled();
        const worker = new AnalysisWorker({ mode, lint });
        this.#worker = worker;
        this.logger.info(`Analizador Luau inicializado (modo ${mode}, lint ${lint ? 'activo' : 'inactivo'})`, { source: 'LuauAnalysisService' });
        return worker;
      } catch (err) {
        const appError = toAppError(err, {
          kind: ErrorKind.EDITOR,
          code: ErrorCode.UNAVAILABLE,
          message: 'No se pudo inicializar el analizador de Luau',
          detail: { dependency: '@luau-rs/luau/analysis' },
        });
        this.errorHandler.report(appError, { source: 'LuauAnalysisService.init' });
        throw appError;
      } finally {
        this.#initializing = null;
      }
    })();
    return this.#initializing;
  }

  #mode() {
    try {
      const mode = this.settings?.get?.('editor.analysisMode') ?? 'nonstrict';
      return ['nocheck', 'nonstrict', 'strict'].includes(mode) ? mode : 'nonstrict';
    } catch {
      return 'nonstrict';
    }
  }

  #lintEnabled() {
    try {
      return this.settings?.get?.('editor.lintOnType') !== false;
    } catch {
      return true;
    }
  }

  /** Restarts the worker when the user changes the analysis mode. */
  async reconfigure() {
    if (!this.#worker) return;
    this.#disposeWorker();
    this.#cache.clear();
    return this.#getWorker();
  }

  #disposeWorker() {
    const worker = this.#worker;
    this.#worker = null;
    if (!worker) return;
    try {
      worker[Symbol.dispose]?.();
    } catch {
      /* the worker may already be gone */
    }
  }

  async dispose() {
    this.#disposed = true;
    this.#disposeWorker();
    this.#cache.clear();
  }

  /** Real availability check (runs a check with a deliberate type error). */
  async probe() {
    try {
      const worker = await this.#getWorker();
      worker.setModule('probe.luau', 'local value: number = "text"\nreturn value\n');
      const result = await worker.check('probe.luau');
      const found = (result?.diagnostics ?? []).some((entry) => entry.kind === 'type' && entry.severity === 'error');
      if (!found) {
        return { state: CapabilityState.UNAVAILABLE, detail: 'El analizador no detectó el error de tipo de la muestra' };
      }
      return {
        state: CapabilityState.AVAILABLE,
        detail: `Analizador Luau operativo en modo ${this.#mode()}`,
        data: { mode: this.#mode(), lint: this.#lintEnabled() },
      };
    } catch (err) {
      return { state: CapabilityState.UNAVAILABLE, detail: `El analizador no está disponible: ${err.message}`, data: { dependency: '@luau-rs/luau/analysis' } };
    }
  }

  /* ---------------------------------------------------------------- *
   * Public API
   * ---------------------------------------------------------------- */

  /**
   * Type checks a module.
   * @param {{ module: string, source: string, mode?: string, lint?: boolean, environment?: string }} request
   */
  async check({ module = 'main.luau', source, mode = null, lint = null, environment = undefined }) {
    const text = requireSource(source);
    const key = `check:${mode ?? this.#mode()}:${lint ?? this.#lintEnabled()}:${hash(text)}`;
    const cached = this.#cacheGet(key);
    if (cached) return { ...cached, cached: true };

    const started = Date.now();
    return this.#enqueue(async () => {
      const worker = await this.#getWorker();
      try {
        if (mode && mode !== this.#mode()) worker.setMode(mode);
        if (lint !== null) worker.setLint(lint);
        worker.setModule(module, text, undefined, environment);
        const result = await worker.check(module);
        const diagnostics = (result?.diagnostics ?? []).map((entry) => ({
          code: String(entry.code),
          kind: entry.kind,
          severity: entry.severity,
          module: entry.module,
          message: entry.message,
          range: {
            start: { line: entry.location.begin.line, character: entry.location.begin.column },
            end: { line: entry.location.end.line, character: entry.location.end.column },
          },
          line: entry.location.begin.line + 1,
          column: entry.location.begin.column + 1,
        }));
        const payload = {
          diagnostics,
          timeoutModules: result?.timeoutModules ?? [],
          mode: mode ?? this.#mode(),
          lint: lint ?? this.#lintEnabled(),
          durationMs: Date.now() - started,
          cached: false,
        };
        this.#cacheSet(key, payload);
        this.#stats.checks += 1;
        this.#stats.totalMs += payload.durationMs;
        this.#stats.lastAt = Date.now();
        return payload;
      } catch (err) {
        this.#fail(err, 'check');
        throw err;
      }
    });
  }

  /**
   * Real Lua/Luau completion from the analysis engine.
   * @param {{ module: string, source: string, line: number, character: number }} request  0-based positions
   */
  async complete({ module = 'main.luau', source, line, character }) {
    const text = requireSource(source);
    const position = { line: ensureInt(line, 'line'), column: ensureInt(character, 'character') };
    const key = `complete:${hash(text)}:${position.line}:${position.column}`;
    const cached = this.#cacheGet(key);
    if (cached) return { ...cached, cached: true };

    const started = Date.now();
    return this.#enqueue(async () => {
      const worker = await this.#getWorker();
      try {
        worker.setModule(module, text);
        const result = await worker.fragmentAutocomplete(module, text, position);
        const entries = (result?.result?.entries ?? []).map((entry) => ({
          label: entry.label,
          kind: entry.kind,
          type: entry.type ?? null,
          documentation: entry.documentationSymbol ?? null,
          deprecated: entry.deprecated === true,
          insertText: entry.insertText ?? entry.label,
          parentheses: entry.parentheses ?? 'none',
          tags: entry.tags ?? [],
          replaceDotWithColon: entry.replaceDotWithColon === true,
        }));
        const payload = {
          status: result?.status ?? 'fallback',
          context: result?.result?.context ?? 'unknown',
          entries,
          durationMs: Date.now() - started,
          cached: false,
        };
        this.#cacheSet(key, payload);
        this.#stats.completions += 1;
        this.#stats.totalMs += payload.durationMs;
        this.#stats.lastAt = Date.now();
        return payload;
      } catch (err) {
        this.#fail(err, 'complete');
        throw err;
      }
    });
  }

  /** Type of the symbol at a position (0-based). */
  async typeAt({ module = 'main.luau', source, line, character }) {
    const text = requireSource(source);
    return this.#enqueue(async () => {
      const worker = await this.#getWorker();
      worker.setModule(module, text);
      const position = { line: ensureInt(line, 'line'), column: ensureInt(character, 'character') };
      const inspection = await worker.inspectAt(module, position);
      const type = await worker.typeAt(module, position).catch(() => undefined);
      return {
        name: inspection?.name ?? null,
        type: type ?? inspection?.type ?? null,
        inspection: inspection ?? null,
      };
    });
  }

  /** Hover documentation for the symbol at a position. */
  async documentation({ module = 'main.luau', source, line, character }) {
    const text = requireSource(source);
    return this.#enqueue(async () => {
      const worker = await this.#getWorker();
      worker.setModule(module, text);
      const position = { line: ensureInt(line, 'line'), column: ensureInt(character, 'character') };
      const documentation = await worker.documentationSymbolAt(module, position);
      const inspection = await worker.inspectAt(module, position);
      return { documentation: documentation ?? null, name: inspection?.name ?? null, type: inspection?.type ?? null };
    });
  }

  /** Returns the source with inferred type annotations (Luau's `decorateWithTypes`). */
  async decorate({ module = 'main.luau', source }) {
    const text = requireSource(source);
    return this.#enqueue(async () => {
      const worker = await this.#getWorker();
      worker.setModule(module, text);
      const decorated = worker.decorateWithTypes(module) ?? null;
      return { decorated, changed: decorated !== null && decorated !== text };
    });
  }

  /** Requires modules graph for the "dependencies" view. */
  async requiredModules({ module = 'main.luau', source }) {
    const text = requireSource(source);
    return this.#enqueue(async () => {
      const worker = await this.#getWorker();
      worker.setModule(module, text);
      const modules = worker.requiredModules(module) ?? [];
      const returnType = worker.moduleReturnType(module) ?? null;
      return { modules, returnType };
    });
  }

  /** Real usage statistics of the analyser (dashboard). */
  stats() {
    return {
      ...this.#stats,
      averageMs: this.#stats.checks + this.#stats.completions > 0
        ? this.#stats.totalMs / (this.#stats.checks + this.#stats.completions)
        : null,
      cacheSize: this.#cache.size,
      workerAlive: this.#worker !== null,
      mode: this.#mode(),
      lint: this.#lintEnabled(),
    };
  }

  /* ---------------------------------------------------------------- *
   * Internals
   * ---------------------------------------------------------------- */

  /** Serialises every query so the worker never receives two at once. */
  #enqueue(task) {
    const run = this.#chain.then(task, task);
    // Keep the chain alive regardless of individual failures.
    this.#chain = run.then(() => undefined, () => undefined);
    return run;
  }

  #fail(err, operation) {
    this.#stats.failures += 1;
    const appError = toAppError(err, {
      kind: ErrorKind.EDITOR,
      message: `El analizador de Luau falló durante "${operation}"`,
      detail: { operation },
    });
    this.errorHandler.report(appError, { source: 'LuauAnalysisService' });
    this.capabilities?.reportFailure?.('analysis.types', appError, { label: 'Analizador de tipos de Luau' });
    // A crashed worker is discarded so the next query rebuilds a healthy one.
    this.#disposeWorker();
    this.#cache.clear();
  }

  #cacheGet(key) {
    const hit = this.#cache.get(key);
    if (!hit) return null;
    this.#stats.cacheHits += 1;
    // Refresh LRU position.
    this.#cache.delete(key);
    this.#cache.set(key, hit);
    return hit;
  }

  #cacheSet(key, value) {
    this.#cache.set(key, value);
    if (this.#cache.size > CACHE_LIMIT) {
      const oldest = this.#cache.keys().next().value;
      this.#cache.delete(oldest);
    }
  }

  clearCache() {
    const size = this.#cache.size;
    this.#cache.clear();
    return { cleared: size };
  }
}

function hash(text) {
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, 20);
}

function requireSource(source) {
  if (typeof source !== 'string') {
    throw new AppError({
      message: 'El análisis necesita el código fuente como texto',
      code: ErrorCode.INVALID_ARGUMENT,
      kind: ErrorKind.EDITOR,
      detail: { received: typeof source },
    });
  }
  return source;
}

function ensureInt(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    throw new AppError({
      message: `La posición "${field}" debe ser un entero positivo`,
      code: ErrorCode.INVALID_ARGUMENT,
      kind: ErrorKind.EDITOR,
      detail: { field, received: value },
    });
  }
  return value;
}
