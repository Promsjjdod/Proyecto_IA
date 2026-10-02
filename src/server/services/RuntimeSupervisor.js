/**
 * RuntimeSupervisor — orchestrates every execution engine.
 *
 * Responsibilities (all real, no simulation):
 *  - keeps the engine registry with *measured* availability;
 *  - picks an engine from the dialect + user preference, or explains why none is usable;
 *  - queues executions with a real concurrency limit and reports queue wait time;
 *  - streams state changes and output through the event bus (consumed by the SSE endpoint);
 *  - cancels executions through the engine's own mechanism (abort signal or SIGKILL);
 *  - accumulates truthful statistics and delegates history recording to HistoryStore.
 */

import { CapabilityState, Dialect, EngineDialect, EngineId, ErrorCode, ErrorKind, Limits, RuntimeState } from '../../shared/constants.js';
import { AppError, errors, toAppError } from '../../shared/errors.js';
import { normalizeExecutionResult } from '../../shared/protocol.js';
import { LuauWasmEngine } from '../runtime/engines/LuauWasmEngine.js';
import { Lua54ChildEngine } from '../runtime/engines/Lua54ChildEngine.js';
import { NativeLuaEngine } from '../runtime/engines/NativeLuaEngine.js';

const MAX_CONCURRENT = 3;

export class RuntimeSupervisor {
  #engines = new Map();
  #queue = [];
  #running = new Map();
  #counter = 0;
  #stats = {
    total: 0,
    byState: { IDLE: 0, RUNNING: 0, SUCCESS: 0, ERROR: 0, STOPPED: 0, UNAVAILABLE: 0 },
    byEngine: {},
    totalDurationMs: 0,
    durations: [],
    lastExecution: null,
    startedAt: Date.now(),
  };

  constructor({ logger, errorHandler, bus, history, storage, settings, capabilities, toolsDir = null, dataDir = null }) {
    this.logger = logger;
    this.errorHandler = errorHandler;
    this.bus = bus;
    this.history = history;
    this.storage = storage;
    this.settings = settings;
    this.capabilities = capabilities;
    this.toolsDir = toolsDir;
    this.dataDir = dataDir;
    this.#registerEngines();
  }

  #registerEngines() {
    const common = { logger: this.logger, errorHandler: this.errorHandler, toolsDir: this.toolsDir, dataDir: this.dataDir };
    const engines = [
      new LuauWasmEngine(common),
      new Lua54ChildEngine(common),
      new NativeLuaEngine({
        ...common,
        dialect: 'luau',
        candidates: ['luau', 'luau-bin'],
        isEnabled: () => this.#nativeEnginesAllowed(),
      }),
      new NativeLuaEngine({
        ...common,
        dialect: 'lua54',
        candidates: ['lua5.4', 'lua54', 'lua5.3', 'lua'],
        isEnabled: () => this.#nativeEnginesAllowed(),
      }),
    ];
    for (const engine of engines) this.#engines.set(engine.id, engine);
  }

  #nativeEnginesAllowed() {
    if (!this.settings) return false;
    try {
      return this.settings.get('execution.allowNativeEngines') === true;
    } catch {
      return false;
    }
  }

  get engines() {
    return [...this.#engines.values()];
  }

  getEngine(id) {
    return this.#engines.get(id) ?? null;
  }

  /**
   * Real, measured availability for every engine.
   * @param {{ force?: boolean }} [options]
   */
  async listEngines({ force = false } = {}) {
    const results = [];
    for (const engine of this.#engines.values()) {
      const probe = await engine.probeCached({ force, ttlMs: 30_000 });
      results.push({
        ...engine.status(),
        state: probe.state,
        available: probe.state === CapabilityState.AVAILABLE || probe.state === CapabilityState.FALLBACK,
        detail: probe.detail,
        data: probe.data ?? null,
        requirements: engine.limits.requires,
      });
    }
    return results;
  }

  /** Engines that can really run the given dialect right now. */
  async availableEngines(dialect, { force = false } = {}) {
    const all = await this.listEngines({ force });
    return all.filter((entry) => entry.dialect === dialect && entry.available);
  }

  /**
   * Chooses the engine for a request. Preference order:
   *  1. explicit `engineId` from the client (if available);
   *  2. `execution.enginePreference` setting (if not `auto`);
   *  3. first available engine for the dialect in registration order.
   * Throws `AppError` with code `E_UNAVAILABLE` and a full explanation when nothing works.
   */
  async resolveEngine({ dialect, engineId = null, force = false }) {
    const requestedId = engineId ?? this.#preferenceFor(dialect);
    if (requestedId) {
      const engine = this.#engines.get(requestedId);
      if (!engine) {
        throw new AppError({
          message: `El motor "${requestedId}" no existe`,
          code: ErrorCode.INVALID_ARGUMENT,
          kind: ErrorKind.RUNTIME,
          detail: { engineId: requestedId, known: [...this.#engines.keys()] },
        });
      }
      if (engine.dialect !== dialect) {
        throw new AppError({
          message: `El motor "${requestedId}" ejecuta ${engine.dialect}, no ${dialect}`,
          code: ErrorCode.INVALID_ARGUMENT,
          kind: ErrorKind.RUNTIME,
          detail: { engineId: requestedId, engineDialect: engine.dialect, requestedDialect: dialect },
        });
      }
      const probe = await engine.probeCached({ force, ttlMs: 15_000 });
      if (probe.state === CapabilityState.AVAILABLE || probe.state === CapabilityState.FALLBACK) {
        return { engine, probe, requested: true };
      }
      // An explicit choice that is unavailable must fail loudly; falling back silently
      // would mean running the script somewhere the user did not ask for.
      throw new AppError({
        message: `${engine.label} no está disponible: ${probe.detail ?? 'sin detalle'}`,
        code: ErrorCode.UNAVAILABLE,
        kind: ErrorKind.RUNTIME,
        detail: {
          engineId: requestedId,
          requestedDialect: dialect,
          requirement: probe.detail,
          probe: probe.data ?? null,
          alternatives: (await this.availableEngines(dialect)).map((entry) => ({ id: entry.id, label: entry.label })),
        },
      });
    }

    const candidates = await this.availableEngines(dialect, { force });
    if (candidates.length === 0) {
      const all = await this.listEngines({ force });
      throw new AppError({
        message: `No hay ningún motor disponible para ${dialect === Dialect.LUAU ? 'Luau' : 'Lua 5.4'}`,
        code: ErrorCode.UNAVAILABLE,
        kind: ErrorKind.RUNTIME,
        detail: {
          dialect,
          engines: all.map((entry) => ({ id: entry.id, state: entry.state, detail: entry.detail })),
          requirement: 'Instala las dependencias del proyecto (npm install) y ejecuta `npm run doctor` para ver el diagnóstico completo.',
        },
      });
    }
    const chosen = this.#engines.get(candidates[0].id);
    return { engine: chosen, probe: { state: candidates[0].state, detail: candidates[0].detail, data: candidates[0].data }, requested: false };
  }

  #preferenceFor(dialect) {
    if (!this.settings) return null;
    let preference = 'auto';
    try {
      preference = this.settings.get('execution.enginePreference');
    } catch {
      preference = 'auto';
    }
    if (!preference || preference === 'auto') return null;
    const engine = this.#engines.get(preference);
    if (!engine) return null;
    return engine.dialect === dialect ? preference : null;
  }

  /**
   * Runs a script. Resolves with the canonical `ExecutionResult`.
   * @param {{ source: string, dialect: string, engineId?: string|null, options?: object, origin?: object, signal?: AbortSignal }} request
   */
  async execute(request) {
    const { source, dialect, engineId = null, options = {}, origin = {}, signal = null } = request;
    const executionId = this.#nextId();
    const enqueuedAt = Date.now();

    this.bus.emit('runtime:queued', {
      executionId,
      dialect,
      engineId,
      origin,
      queuedAt: enqueuedAt,
      queueLength: this.#queue.length,
      running: this.#running.size,
    });

    if (this.#running.size >= MAX_CONCURRENT) {
      await this.#enqueueWait();
    }

    let resolved;
    try {
      resolved = await this.resolveEngine({ dialect, engineId });
    } catch (err) {
      const appError = err instanceof AppError ? err : toAppError(err, { kind: ErrorKind.RUNTIME });
      const result = normalizeExecutionResult({
        executionId,
        engineId: engineId ?? null,
        dialect,
        ok: false,
        state: RuntimeState.UNAVAILABLE,
        error: appError,
        stats: { queuedMs: Date.now() - enqueuedAt },
      });
      this.#recordResult(result);
      return result;
    }

    const { engine, probe } = resolved;
    const queuedMs = Date.now() - enqueuedAt;
    this.bus.emit('runtime:started', {
      executionId,
      engineId: engine.id,
      engineLabel: engine.label,
      dialect,
      origin,
      startedAt: Date.now(),
      queuedMs,
      engineDetail: probe.detail,
    });

    const outputs = [];
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    signal?.addEventListener?.('abort', abortFromCaller, { once: true });

    const hooks = {
      onOutput: (entry) => {
        outputs.push(entry);
        this.bus.emit('runtime:output', { executionId, engineId: engine.id, entry });
      },
    };

    this.#running.set(executionId, { engineId: engine.id, startedAt: Date.now(), cancel: () => engine.cancel(executionId) });

    try {
      const raw = await engine.execute({
        executionId,
        source,
        name: origin.scriptName ?? (dialect === Dialect.LUAU ? 'script.luau' : 'script.lua'),
        options,
        hooks,
        signal: controller.signal,
      });
      const result = normalizeExecutionResult(raw, { executionId, engineId: engine.id, dialect });
      result.stats.queuedMs = queuedMs;
      this.#recordResult(result);
      return result;
    } catch (err) {
      const appError = toAppError(err, {
        kind: ErrorKind.RUNTIME,
        message: `El motor ${engine.id} falló de forma inesperada`,
        detail: { executionId, engineId: engine.id, origin },
      });
      this.errorHandler.report(appError, { source: 'RuntimeSupervisor.execute' });
      const result = normalizeExecutionResult({
        executionId,
        engineId: engine.id,
        dialect,
        ok: false,
        state: RuntimeState.ERROR,
        outputs,
        error: appError,
        stats: { queuedMs, durationMs: Date.now() - enqueuedAt },
      });
      this.#recordResult(result);
      return result;
    } finally {
      signal?.removeEventListener?.('abort', abortFromCaller);
      this.#running.delete(executionId);
      this.#pumpQueue();
    }
  }

  /** Cancels a running execution through the engine that owns it. */
  async cancel(executionId) {
    const record = this.#running.get(executionId);
    if (!record) {
      return { ok: false, stopped: false, reason: 'La ejecución no está activa', executionId };
    }
    const engine = this.#engines.get(record.engineId);
    if (!engine) {
      return { ok: false, stopped: false, reason: 'El motor ya no está registrado', executionId };
    }
    const outcome = await engine.cancel(executionId);
    this.bus.emit('runtime:cancel-requested', { executionId, engineId: engine.id, ...outcome });
    return { ok: outcome.stopped, ...outcome, executionId };
  }

  async cancelAll() {
    const results = [];
    for (const [executionId, record] of this.#running) {
      const engine = this.#engines.get(record.engineId);
      if (!engine) continue;
      results.push({ executionId, ...(await engine.cancel(executionId)) });
    }
    return results;
  }

  /** Real status of the runtime used by the dashboard and the status bar. */
  status() {
    const state = this.#running.size > 0
      ? RuntimeState.RUNNING
      : this.#stats.lastExecution?.state ?? RuntimeState.IDLE;
    return {
      state,
      activeExecutions: this.#running.size,
      maxConcurrent: MAX_CONCURRENT,
      queueLength: this.#queue.length,
      active: [...this.#running.entries()].map(([executionId, record]) => ({
        executionId,
        engineId: record.engineId,
        startedAt: record.startedAt,
        elapsedMs: Date.now() - record.startedAt,
      })),
      lastExecution: this.#stats.lastExecution,
      stats: this.stats(),
      uptimeMs: Date.now() - this.#stats.startedAt,
    };
  }

  /** Truthful counters: every value comes from a completed execution. */
  stats() {
    const durations = this.#stats.durations;
    const sorted = [...durations].sort((a, b) => a - b);
    return {
      total: this.#stats.total,
      byState: { ...this.#stats.byState },
      byEngine: { ...this.#stats.byEngine },
      averageDurationMs: durations.length > 0 ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null,
      medianDurationMs: sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : null,
      fastestDurationMs: sorted.length > 0 ? sorted[0] : null,
      slowestDurationMs: sorted.length > 0 ? sorted[sorted.length - 1] : null,
      totalDurationMs: this.#stats.totalDurationMs,
      lastExecution: this.#stats.lastExecution,
      startedAt: this.#stats.startedAt,
    };
  }

  /* ---------------------------------------------------------------- *
   * Internals
   * ---------------------------------------------------------------- */

  #recordResult(result) {
    this.#stats.total += 1;
    this.#stats.byState[result.state] = (this.#stats.byState[result.state] ?? 0) + 1;
    if (result.engineId) {
      const entry = this.#stats.byEngine[result.engineId] ?? { total: 0, success: 0, error: 0, stopped: 0, totalMs: 0 };
      entry.total += 1;
      entry.totalMs += result.stats.durationMs ?? 0;
      if (result.state === RuntimeState.SUCCESS) entry.success += 1;
      else if (result.state === RuntimeState.STOPPED) entry.stopped += 1;
      else entry.error += 1;
      this.#stats.byEngine[result.engineId] = entry;
    }
    if (typeof result.stats.durationMs === 'number') {
      this.#stats.totalDurationMs += result.stats.durationMs;
      this.#stats.durations.push(result.stats.durationMs);
      if (this.#stats.durations.length > 500) this.#stats.durations.shift();
    }
    this.#stats.lastExecution = {
      executionId: result.executionId,
      engineId: result.engineId,
      dialect: result.dialect,
      state: result.state,
      durationMs: result.stats.durationMs,
      finishedAt: result.finishedAt,
      errorMessage: result.error?.message ?? null,
    };

    this.bus.emit('runtime:finished', {
      executionId: result.executionId,
      engineId: result.engineId,
      dialect: result.dialect,
      state: result.state,
      ok: result.ok,
      durationMs: result.stats.durationMs,
      error: result.error,
      returnValues: result.returnValues,
      outputCount: result.outputs.length,
    });

    if (this.settings?.get?.('execution.recordHistory') !== false) {
      this.history?.recordExecution?.(result, { scriptId: this.#currentScriptId ?? null, scriptName: this.#currentScriptName ?? null });
    }
    return result;
  }

  #currentScriptId = null;
  #currentScriptName = null;

  /** Lets the API layer attach the script identity to the history record. */
  setExecutionOrigin({ scriptId = null, scriptName = null } = {}) {
    this.#currentScriptId = scriptId;
    this.#currentScriptName = scriptName;
  }

  #nextId() {
    this.#counter += 1;
    return `ex${Date.now().toString(36)}${this.#counter.toString(36)}`;
  }

  #enqueueWait() {
    return new Promise((resolve) => {
      this.#queue.push(resolve);
      this.bus.emit('runtime:queue-changed', { queueLength: this.#queue.length });
    });
  }

  #pumpQueue() {
    if (this.#queue.length > 0 && this.#running.size < MAX_CONCURRENT) {
      const next = this.#queue.shift();
      this.bus.emit('runtime:queue-changed', { queueLength: this.#queue.length });
      next?.();
    }
  }

  /** Releases engine-side resources (called during shutdown). */
  async shutdown() {
    const cancelled = await this.cancelAll();
    for (const engine of this.#engines.values()) {
      try {
        await engine.cancelAll();
      } catch {
        /* best effort */
      }
    }
    this.#queue = [];
    return { cancelled };
  }

  /** How many requests each engine serves (dashboard + diagnostics). */
  async engineReport({ force = false } = {}) {
    const engines = await this.listEngines({ force });
    return engines.map((engine) => ({
      ...engine,
      executedInSession: this.#stats.byEngine[engine.id]?.total ?? 0,
      limits: engine.limits,
    }));
  }

  static get limits() {
    return Limits;
  }

  static get dialectMap() {
    return EngineDialect;
  }

  static get knownEngineIds() {
    return Object.values(EngineId);
  }
}
