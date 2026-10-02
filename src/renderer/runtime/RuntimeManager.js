/**
 * RuntimeManager (client) — the single entry point for executing code from the UI.
 *
 * It owns the real runtimes:
 *   - **browser** adapters (`LuauBrowserRuntime`, `Lua54BrowserRuntime`) — WebAssembly in
 *     terminable workers, with live output and real cancellation;
 *   - **server** engines through `POST /api/runtime/execute`, whose output is streamed back
 *     over the SSE channel.
 *
 * Responsibilities: engine inventory and selection, the state machine
 * (`IDLE → RUNNING → SUCCESS | ERROR | STOPPED | UNAVAILABLE`), output aggregation, real
 * cancellation, statistics and event emission. Nothing is simulated: when no engine can run
 * the requested dialect the result is `UNAVAILABLE` and it says which dependency is missing.
 */

import { CapabilityId, Dialect, ErrorCode, ErrorKind, RuntimeState, SseEvent } from '../../shared/constants.js';
import { AppError } from '../../shared/errors.js';
import { Lua54BrowserRuntime } from './adapters/Lua54BrowserRuntime.js';
import { LuauBrowserRuntime, describeLuauValue } from './adapters/LuauBrowserRuntime.js';

const MAX_HISTORY = 100;

export class RuntimeManager {
  #adapters = new Map();
  #engines = [];
  #serverEngines = [];
  #queue = [];
  #active = null;
  #history = [];
  #state = RuntimeState.IDLE;
  #stateDetail = { label: 'En espera', reason: null };
  #predictions = { executed: 0, success: 0, error: 0, stopped: 0, unavailable: 0, failuresByCode: {}, totalDurationMs: 0, longestMs: 0 };
  #stateListeners = new Set();
  #executionListeners = new Set();
  #subscribers = new Set();
  #disposers = [];
  #serverEngineSource = 'unavailable';
  /** Salidas ya entregadas por SSE por ejecución, para no duplicarlas al recibir el resultado. */
  #deliveredOutputs = new Map();

  constructor({ apiClient, capabilities, settings, logger, eventBus, notifications, errorBus, eventStream }) {
    this.apiClient = apiClient;
    this.capabilities = capabilities;
    this.settings = settings;
    this.logger = logger;
    this.eventBus = eventBus;
    this.notifications = notifications;
    this.errorBus = errorBus;
    this.eventStream = eventStream;
    this.origin = 'browser';
  }

  get state() {
    return this.#state;
  }

  get stateInfo() {
    return { state: this.#state, ...this.#stateDetail };
  }

  get activeExecution() {
    return this.#active ? { ...this.#active, outputs: [...this.#active.outputs] } : null;
  }

  get isRunning() {
    return this.#active !== null;
  }

  get lastExecution() {
    return this.#history[0] ?? null;
  }

  get history() {
    return [...this.#history];
  }

  get engines() {
    return this.#engines.map((engine) => ({ ...engine }));
  }

  get activeEngine() {
    return this.resolveEngine() ?? null;
  }

  /** Real adapter statistics (executions, terminations, startup times). */
  get adapters() {
    return Object.fromEntries([...this.#adapters].map(([id, adapter]) => [id, adapter.info ?? adapter.stats ?? {}]));
  }

  async init() {
    // 1. Browser adapters exist as soon as the module loads; availability is *probed*.
    this.#adapters.set('browser.luau.wasm', new LuauBrowserRuntime({
      logger: this.logger,
      defaults: this.#browserDefaults(),
    }));
    this.#adapters.set('browser.lua54.wasm', new Lua54BrowserRuntime({
      logger: this.logger,
      wasmUrl: '/vendor/wasmoon/glue.wasm',
    }));

    this.#rebuildInventory();

    // 2. Server engines: real inventory from the supervisor.
    await this.refreshServerEngines();

    // 3. Probe the browser runtimes in the background (a probe really starts a worker).
    void this.probeBrowserRuntimes();

    // 4. Live output from server executions.
    this.#wireEventStream();

    // 5. Settings that affect execution are re-read on change.
    this.#disposers.push(this.settings.subscribe((values, detail) => {
      if ((detail.changed ?? []).some((key) => key.startsWith('execution.'))) this.#rebuildInventory();
      if ((detail.changed ?? []).includes('execution.allowNativeEngines')) void this.refreshServerEngines();
    }));

    return { ok: true, engines: this.#engines.length, serverEngineSource: this.#serverEngineSource };
  }

  #browserDefaults() {
    const memoryMb = this.settings?.get('execution.memoryLimitMb') ?? 64;
    const outputKb = this.settings?.get('execution.outputLimitKb') ?? 256;
    return {
      memoryLimitBytes: memoryMb > 0 ? memoryMb * 1024 * 1024 : null,
      outputLimitBytes: outputKb > 0 ? outputKb * 1024 : 256 * 1024,
    };
  }

  /* ------------------------------------------------------------------ *
   * Inventory
   * ------------------------------------------------------------------ */

  #rebuildInventory() {
    const defaults = this.#browserDefaults();
    for (const adapter of this.#adapters.values()) {
      if (adapter.defaults) Object.assign(adapter.defaults, defaults);
    }

    const browserEngines = [...this.#adapters].map(([id, adapter]) => ({
      id,
      label: adapter.label,
      dialect: adapter.dialect,
      mode: 'browser',
      available: adapter.available || this.capabilities?.isAvailable(adapter.dialect === Dialect.LUAU ? CapabilityId.RUNTIME_LUAU : CapabilityId.RUNTIME_LUA54) === true,
      probed: adapter.available,
      requirements: adapter.dialect === Dialect.LUAU
        ? ['Web Workers', 'vendor/@luau-rs (npm run build)']
        : ['Web Workers', 'vendor/wasmoon (npm run build)'],
      capabilities: adapter.dialect === Dialect.LUAU
        ? { streaming: true, cancel: 'abort-signal + terminate', timeout: true, memoryLimit: true }
        : { streaming: true, cancel: 'terminate', timeout: true, memoryLimit: true },
    }));

    this.#engines = [...browserEngines, ...this.#serverEngines];
  }

  async refreshServerEngines({ force = false } = {}) {
    try {
      const payload = await this.apiClient.get('/api/runtime/engines', { query: force ? { force: '1' } : undefined });
      this.#serverEngines = (payload.engines ?? []).map((engine) => ({
        id: engine.id,
        label: engine.label ?? engine.id,
        dialect: engine.dialect,
        mode: 'server',
        available: engine.available === true,
        probed: true,
        requirements: engine.requirement ? [engine.requirement] : [],
        detail: engine.detail ?? null,
        capabilities: {
          streaming: engine.capabilities?.streaming !== false,
          cancel: engine.capabilities?.cancel === true,
          timeout: engine.capabilities?.timeout !== false,
          memoryLimit: engine.capabilities?.memoryLimit === true,
        },
      }));
      this.#serverEngineSource = 'server';
    } catch (err) {
      this.#serverEngines = [];
      this.#serverEngineSource = 'unavailable';
      this.logger?.warn(`No se pudo obtener el inventario de motores del servidor (${err.message})`, { source: 'RuntimeManager' });
    }
    this.#rebuildInventory();
    this.#notifySubscribers({ reason: 'engines' });
    return { engines: this.#serverEngines.length, source: this.#serverEngineSource };
  }

  /** Really starts the browser runtimes so availability is measured, not guessed. */
  async probeBrowserRuntimes() {
    const results = {};
    for (const [id, adapter] of this.#adapters) {
      const started = performance.now();
      try {
        const outcome = await adapter.init();
        results[id] = { ok: outcome.ok === true, error: outcome.ok ? null : outcome.error, durationMs: Math.round((performance.now() - started) * 100) / 100 };
        if (outcome.ok) {
          this.logger?.info(`Runtime disponible: ${adapter.label} (arranque ${results[id].durationMs} ms)`, { source: 'RuntimeManager' });
        } else {
          this.logger?.warn(`Runtime no disponible: ${adapter.label} — ${outcome.error}`, { source: 'RuntimeManager' });
        }
      } catch (err) {
        results[id] = { ok: false, error: err.message, durationMs: Math.round((performance.now() - started) * 100) / 100 };
        this.errorBus?.report(err, { source: `RuntimeManager:${id}` });
      }
    }
    this.#rebuildInventory();
    this.#notifySubscribers({ reason: 'probe', results });
    return results;
  }

  /**
   * Resolves which engine runs a request, honouring the explicit id, then the user
   * preference, then the dialect default (browser first, server as fallback).
   */
  resolveEngine({ engineId = null, dialect = null } = {}) {
    if (engineId) {
      const explicit = this.#engines.find((engine) => engine.id === engineId);
      if (explicit) return explicit;
    }
    const preferred = this.settings?.get('execution.enginePreference') ?? 'auto';
    const targetDialect = dialect ?? this.settings?.get('execution.defaultDialect') ?? Dialect.LUAU;

    if (preferred !== 'auto') {
      const byId = this.#engines.find((engine) => engine.id === preferred || engine.dialect === preferred);
      if (byId) return byId;
    }

    const candidates = this.#engines.filter((engine) => engine.dialect === targetDialect);
    const browser = candidates.find((engine) => engine.mode === 'browser' && engine.available);
    if (browser) return browser;
    const server = candidates.find((engine) => engine.mode === 'server' && engine.available);
    if (server) return server;
    return candidates[0] ?? null;
  }

  /** Explains, with real data, why nothing can run a dialect. */
  unavailableReport(dialect) {
    const candidates = this.#engines.filter((engine) => engine.dialect === dialect);
    const browserCapability = dialect === Dialect.LUAU ? CapabilityId.RUNTIME_LUAU : CapabilityId.RUNTIME_LUA54;
    const capability = this.capabilities?.get(browserCapability);
    return {
      dialect,
      engines: candidates.map((engine) => ({ id: engine.id, label: engine.label, mode: engine.mode, available: engine.available, requirements: engine.requirements, detail: engine.detail ?? null })),
      capability: capability ? { state: capability.state, detail: capability.detail, dependency: capability.dependency } : null,
      requirement: candidates.length === 0
        ? 'no hay ningún motor registrado para este dialecto'
        : candidates.every((engine) => engine.mode === 'server')
          ? 'el servidor local no está disponible y no hay motor en el navegador'
          : 'las dependencias del runtime no están instaladas o el navegador no las soporta',
    };
  }

  /* ------------------------------------------------------------------ *
   * Execution
   * ------------------------------------------------------------------ */

  /**
   * Runs a script.
   * @param {{ source: string, name?: string, dialect?: string, engineId?: string, options?: object, origin?: string, tabId?: string|null }} request
   * @returns {Promise<object>} the execution record (never throws).
   */
  async execute({ source, name = 'script', dialect = null, engineId = null, options = {}, origin = 'user', tabId = null }) {
    if (typeof source !== 'string' || source.trim() === '') {
      const error = new AppError({ code: ErrorCode.INVALID_ARGUMENT, kind: ErrorKind.RUNTIME, message: 'No hay código para ejecutar' });
      return this.#recordUnavailable(null, error.toJSON(), { name, origin, dialect });
    }

    const engine = this.resolveEngine({ engineId, dialect });
    if (!engine) {
      const report = this.unavailableReport(dialect ?? this.settings?.get('execution.defaultDialect'));
      const error = new AppError({
        code: ErrorCode.UNAVAILABLE,
        kind: ErrorKind.RUNTIME,
        label: 'Runtime no disponible',
        message: `No hay ningún motor disponible para ${dialect ?? 'este dialecto'}`,
        detail: report,
      });
      const record = this.#recordUnavailable(engine, error.toJSON(), { name, origin, dialect });
      this.notifications?.warn(`No se puede ejecutar: ${report.requirement}`, { durationMs: 6000 });
      return record;
    }
    if (!engine.available) {
      const error = new AppError({
        code: ErrorCode.UNAVAILABLE,
        kind: ErrorKind.RUNTIME,
        label: 'Runtime no disponible',
        message: `El motor "${engine.label}" no está disponible`,
        detail: this.unavailableReport(engine.dialect),
      });
      const record = this.#recordUnavailable(engine, error.toJSON(), { name, origin, dialect: engine.dialect });
      this.notifications?.warn(`${engine.label}: ${error.detail.requirement}`, { durationMs: 6000 });
      return record;
    }
    if (engine.mode === 'browser' && this.#active) {
      const error = new AppError({
        code: ErrorCode.UNAVAILABLE,
        kind: ErrorKind.RUNTIME,
        label: 'Runtime ocupado',
        message: 'Ya hay una ejecución en curso',
        detail: { executionId: this.#active.id },
      });
      return this.#recordUnavailable(engine, error.toJSON(), { name, origin, dialect: engine.dialect });
    }

    const executionId = `exec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const timeoutMs = options.timeoutMs ?? this.settings?.get('execution.timeoutMs') ?? 5000;
    const startedAt = Date.now();
    const controller = new AbortController();

    this.#active = {
      id: executionId,
      engineId: engine.id,
      engineLabel: engine.label,
      mode: engine.mode,
      name,
      dialect: engine.dialect,
      origin,
      tabId,
      outputs: [],
      startedAt,
      controller,
      isActive: true,
    };
    this.#setState(RuntimeState.RUNNING, {
      label: `Ejecutando ${name}`,
      engine: engine.label,
      executionId,
      origin,
    });
    this.eventBus?.emit('runtime:started', { executionId, engineId: engine.id, name, mode: engine.mode, origin });

    let result;
    if (engine.mode === 'browser') {
      result = await this.#executeBrowser(engine, { executionId, source, name, options: { ...options, timeoutMs }, controller });
    } else {
      result = await this.#executeServer(engine, { executionId, source, name, options: { ...options, timeoutMs }, controller });
    }

    const finishedAt = Date.now();
    const record = {
      executionId,
      engineId: engine.id,
      engineLabel: engine.label,
      mode: engine.mode,
      dialect: engine.dialect,
      name,
      origin,
      tabId,
      ok: result.ok === true,
      state: result.state,
      outputs: result.outputs ?? [],
      returnValues: result.returnValues ?? [],
      error: result.error ?? null,
      stats: {
        ...result.stats,
        durationMs: result.stats?.durationMs ?? finishedAt - startedAt,
        queuedMs: 0,
        wallMs: finishedAt - startedAt,
      },
      startedAt,
      finishedAt,
      capabilities: engine.capabilities ?? null,
    };

    this.#active = null;
    this.#record(record);
    this.#notifySubscribers({ reason: 'execution', record });
    return record;
  }

  async #executeBrowser(engine, { executionId, source, name, options, controller }) {
    const adapter = this.#adapters.get(engine.id);
    if (!adapter) {
      return {
        ok: false,
        state: RuntimeState.UNAVAILABLE,
        outputs: [],
        error: new AppError({ code: ErrorCode.UNAVAILABLE, kind: ErrorKind.RUNTIME, message: `El adaptador "${engine.id}" no existe` }).toJSON(),
      };
    }
    const streamOutput = this.settings?.get('execution.streamOutput') !== false;
    const onOutput = (entry) => {
      if (!this.#active || this.#active.id !== executionId) return;
      this.#active.outputs.push(entry);
      if (streamOutput) this.eventBus?.emit('runtime:output', { executionId, ...entry });
    };
    try {
      return await adapter.execute({
        source,
        name,
        options,
        onOutput,
        signal: controller.signal,
      });
    } catch (err) {
      const appError = new AppError({
        code: ErrorCode.RUNTIME,
        kind: ErrorKind.RUNTIME,
        label: 'Fallo del runtime',
        message: err?.message ?? String(err),
        detail: { engine: engine.id, stack: err?.stack ?? null },
      });
      return { ok: false, state: RuntimeState.ERROR, outputs: this.#active?.outputs ?? [], returnValues: [], error: appError.toJSON(), stats: { durationMs: 0 } };
    }
  }

  async #executeServer(engine, { executionId, source, name, options, controller }) {
    const outputs = [];
    const onServerEvent = { started: null, output: null, finished: null };
    try {
      const payload = await this.apiClient.post('/api/runtime/execute', {
        source,
        name,
        dialect: engine.dialect,
        engineId: engine.id,
        options: { timeoutMs: options.timeoutMs, sourceMap: false },
        origin: this.#active?.origin ?? 'user',
      }, { signal: controller.signal, timeoutMs: Math.max(10_000, (options.timeoutMs ?? 5000) + 20_000) });
      const execution = payload.execution ?? {};
      const entries = execution.outputs ?? [];
      /**
       * El flujo SSE normal entrega la salida en vivo mientras el script se ejecuta. Si no está
       * disponible (navegador sin `EventSource`, conexión caída o reconexión en curso) la salida
       * se publica aquí, de modo que la consola nunca se queda sin el resultado real.
       */
      const delivered = this.#deliveredOutputs.get(executionId) ?? 0;
      for (let index = 0; index < entries.length; index += 1) {
        outputs.push(entries[index]);
        if (index >= delivered && entries[index]?.text) {
          this.eventBus?.emit('runtime:output', { executionId, ...entries[index] });
        }
      }
      this.#deliveredOutputs.delete(executionId);
      return {
        ok: execution.ok === true,
        state: execution.state ?? RuntimeState.ERROR,
        outputs,
        returnValues: execution.returnValues ?? [],
        error: execution.error ?? null,
        stats: { ...(execution.stats ?? {}), queuedMs: 0 },
      };
    } catch (err) {
      if (controller.signal.aborted || err?.code === ErrorCode.CANCELLED) {
        return {
          ok: false,
          state: RuntimeState.STOPPED,
          outputs,
          returnValues: [],
          error: new AppError({ code: ErrorCode.CANCELLED, kind: ErrorKind.RUNTIME, label: 'Ejecución detenida', message: 'La ejecución en el servidor fue cancelada', detail: { engine: engine.id } }).toJSON(),
          stats: { cancelled: true, timedOut: false, durationMs: 0 },
        };
      }
      const appError = err?.name === 'AppClientError'
        ? err
        : new AppError({ code: ErrorCode.NETWORK_FAILED, kind: ErrorKind.NETWORK, message: err?.message ?? String(err) });
      return {
        ok: false,
        state: appError.code === ErrorCode.NETWORK_FAILED ? RuntimeState.UNAVAILABLE : RuntimeState.ERROR,
        outputs,
        returnValues: [],
        error: appError.toJSON ? appError.toJSON() : { code: ErrorCode.NETWORK_FAILED, message: appError.message },
        stats: { durationMs: 0, cancelled: false, timedOut: false },
      };
    } finally {
      void onServerEvent;
    }
  }

  /** Streams output of server-side executions into the console while they run. */
  #wireEventStream() {
    if (!this.eventStream) return;
    const onOutput = (payload) => {
      if (!payload?.executionId) return;
      this.#deliveredOutputs.set(payload.executionId, (this.#deliveredOutputs.get(payload.executionId) ?? 0) + 1);
      this.eventBus?.emit('runtime:output', payload);
    };
    for (const event of [SseEvent.RUNTIME_OUTPUT, SseEvent.RUNTIME_STARTED, SseEvent.RUNTIME_FINISHED, SseEvent.RUNTIME_CANCEL_REQUESTED]) {
      const disposer = this.eventStream.on(event, (payload) => {
        if (event === SseEvent.RUNTIME_OUTPUT) onOutput(payload);
        else this.eventBus?.emit(event, payload);
      });
      if (typeof disposer === 'function') this.#disposers.push(disposer);
    }
  }

  /* ------------------------------------------------------------------ *
   * Cancellation
   * ------------------------------------------------------------------ */

  /**
   * Cancels the running execution (browser: cooperative + terminate; server: real POST).
   * @returns {Promise<{ok: boolean, stopped: boolean, reason: string, executionId: string|null}>}
   */
  async cancel(reason = 'user') {
    const active = this.#active;
    if (!active) return { ok: false, stopped: false, reason: 'sin ejecución activa', executionId: null };

    if (active.mode === 'browser') {
      const adapter = this.#adapters.get(active.engineId);
      const outcome = adapter?.cancel('cancel') ?? { ok: false };
      active.controller.abort();
      this.#setState(RuntimeState.STOPPED, {
        label: 'Ejecución detenida',
        executionId: active.id,
        reason,
      });
      this.eventBus?.emit('runtime:cancel-requested', { executionId: active.id, engineId: active.engineId, mode: 'browser', reason });
      return { ok: true, stopped: outcome.ok !== false, reason, executionId: active.id };
    }

    try {
      const payload = await this.apiClient.post('/api/runtime/cancel', { executionId: active.id, reason });
      active.controller.abort();
      this.#setState(RuntimeState.STOPPED, { label: 'Cancelación solicitada', executionId: active.id, reason });
      this.eventBus?.emit('runtime:cancel-requested', { executionId: active.id, engineId: active.engineId, mode: 'server', reason });
      return { ok: true, stopped: true, reason, executionId: active.id, response: payload };
    } catch (err) {
      const appError = new AppError({
        code: ErrorCode.NETWORK_FAILED,
        kind: ErrorKind.NETWORK,
        label: 'No se pudo cancelar',
        message: `La petición de cancelación falló: ${err.message}`,
      });
      this.errorBus?.report(appError, { source: 'RuntimeManager.cancel' });
      return { ok: false, stopped: false, reason: err.message, executionId: active.id };
    }
  }

  async cancelAll() {
    const active = this.#active;
    const outcome = await this.cancel('cancel-all');
    // The server may still hold queued executions: ask it to flush them too.
    try {
      await this.apiClient.post('/api/runtime/cancel-all', { reason: 'cancel-all' });
    } catch {
      /* the server already stopped everything or is unreachable */
    }
    return { ...outcome, hadActive: Boolean(active) };
  }

  #recordUnavailable(engine, error, { name, origin, dialect }) {
    const record = {
      executionId: `exec-unavailable-${Date.now().toString(36)}`,
      engineId: engine?.id ?? null,
      engineLabel: engine?.label ?? 'Sin motor',
      mode: engine?.mode ?? null,
      dialect: dialect ?? engine?.dialect ?? null,
      name,
      origin,
      ok: false,
      state: RuntimeState.UNAVAILABLE,
      outputs: [],
      returnValues: [],
      error,
      stats: { durationMs: 0, cancelled: false, timedOut: false, wallMs: 0 },
      startedAt: Date.now(),
      finishedAt: Date.now(),
    };
    this.#record(record);
    this.#notifySubscribers({ reason: 'execution', record });
    return record;
  }

  /* ------------------------------------------------------------------ *
   * History, statistics and events
   * ------------------------------------------------------------------ */

  #record(record) {
    this.#history.unshift(record);
    if (this.#history.length > MAX_HISTORY) this.#history.pop();

    this.#predictions.executed += 1;
    this.#predictions[record.state === RuntimeState.SUCCESS ? 'success' : record.state === RuntimeState.STOPPED ? 'stopped' : record.state === RuntimeState.UNAVAILABLE ? 'unavailable' : 'error'] += 1;
    const durationMs = record.stats?.durationMs ?? 0;
    if (Number.isFinite(durationMs) && durationMs > 0) {
      this.#predictions.totalDurationMs += durationMs;
      this.#predictions.longestMs = Math.max(this.#predictions.longestMs, durationMs);
    }
    if (record.error?.code) {
      this.#predictions.failuresByCode[record.error.code] = (this.#predictions.failuresByCode[record.error.code] ?? 0) + 1;
    }

    this.#setState(record.state, {
      label: recordLabel(record.state),
      executionId: record.executionId,
      engine: record.engineLabel,
      error: record.error ? { code: record.error.code, message: record.error.message } : null,
    });
    this.eventBus?.emit('runtime:finished', {
      executionId: record.executionId,
      state: record.state,
      ok: record.ok,
      durationMs,
      error: record.error?.code ?? null,
      engineId: record.engineId,
    });
    if (this.settings?.get('execution.recordHistory') === false) {
      this.#history = this.#history.filter((entry) => entry.executionId !== record.executionId);
    }
  }

  #setState(state, detail) {
    const normalized = Object.values(RuntimeState).includes(state) ? state : RuntimeState.IDLE;
    const unchanged = this.#state === normalized && JSON.stringify(this.#stateDetail) === JSON.stringify({ label: detail.label ?? '', reason: detail.reason ?? null });
    this.#state = normalized;
    this.#stateDetail = { label: detail.label ?? normalized, reason: detail.reason ?? null, ...detail };
    if (unchanged) return;
    for (const listener of [...this.#stateListeners]) {
      try {
        listener(this.stateInfo);
      } catch (err) {
        this.logger?.error?.(err, { source: 'RuntimeManager.stateListener' });
      }
    }
  }

  onStateChange(listener) {
    this.#stateListeners.add(listener);
    return () => this.#stateListeners.delete(listener);
  }

  onExecution(listener) {
    this.#executionListeners.add(listener);
    return () => this.#executionListeners.delete(listener);
  }

  /** Generic subscription used by the dashboard (engines, executions, state). */
  subscribe(listener) {
    this.#subscribers.add(listener);
    return () => this.#subscribers.delete(listener);
  }

  #notifySubscribers(payload) {
    for (const listener of [...this.#subscribers]) {
      try {
        listener(payload, this.stats());
      } catch (err) {
        this.logger?.error?.(err, { source: 'RuntimeManager.subscriber' });
      }
    }
    if (payload.reason === 'execution') {
      for (const listener of [...this.#executionListeners]) {
        try {
          listener(payload.record);
        } catch (err) {
          this.logger?.error?.(err, { source: 'RuntimeManager.executionListener' });
        }
      }
    }
  }

  stats() {
    let known = 0;
    for (const engine of this.#engines) if (!engine.available) known += 1;
    return {
      executed: this.#predictions.executed,
      success: this.#predictions.success,
      error: this.#predictions.error,
      stopped: this.#predictions.stopped,
      unavailable: this.#predictions.unavailable,
      failuresByCode: { ...this.#predictions.failuresByCode },
      totalDurationMs: Math.round(this.#predictions.totalDurationMs),
      averageDurationMs: this.#predictions.executed > 0 ? Math.round(this.#predictions.totalDurationMs / this.#predictions.executed) : 0,
      longestMs: Math.round(this.#predictions.longestMs),
      engines: this.#engines.length,
      unavailableEngines: known,
      state: this.#state,
      queue: this.#queue.length,
      running: this.#active ? { executionId: this.#active.id, engineId: this.#active.engineId, mode: this.#active.mode, startedAt: this.#active.startedAt } : null,
      historyEntries: this.#history.length,
      serverEngineSource: this.#serverEngineSource,
      mode: this.mode,
    };
  }

  /** Where execution currently happens: browser, server or both. */
  get mode() {
    const browserAvailable = this.#engines.some((engine) => engine.mode === 'browser' && engine.available);
    const serverAvailable = this.#engines.some((engine) => engine.mode === 'server' && engine.available);
    if (browserAvailable && serverAvailable) return 'dual';
    if (browserAvailable) return 'browser';
    if (serverAvailable) return 'server';
    return 'none';
  }

  clearHistory() {
    const cleared = this.#history.length;
    this.#history = [];
    this.#notifySubscribers({ reason: 'history-cleared' });
    return { cleared };
  }

  /** Re-check every engine (capability panel / "volver a comprobar"). */
  async refresh({ force = true } = {}) {
    const probe = await this.probeBrowserRuntimes();
    await this.refreshServerEngines({ force });
    return { probe, engines: this.#engines.map((engine) => ({ id: engine.id, available: engine.available, mode: engine.mode })) };
  }

  snapshot() {
    return {
      state: this.stateInfo,
      mode: this.mode,
      engines: this.engines,
      stats: this.stats(),
      lastExecution: this.lastExecution ? {
        executionId: this.lastExecution.executionId,
        state: this.lastExecution.state,
        engineId: this.lastExecution.engineId,
        name: this.lastExecution.name,
        finishedAt: this.lastExecution.finishedAt,
        durationMs: this.lastExecution.stats?.durationMs ?? null,
      } : null,
      adapters: this.adapters,
    };
  }

  dispose() {
    for (const disposer of this.#disposers) {
      try {
        disposer();
      } catch {
        /* ignore */
      }
    }
    this.#disposers = [];
    for (const adapter of this.#adapters.values()) adapter.dispose?.();
    this.#adapters.clear();
    this.#stateListeners.clear();
    this.#executionListeners.clear();
    this.#subscribers.clear();
    this.#queue = [];
    this.#active = null;
  }
}

function recordLabel(state) {
  switch (state) {
    case RuntimeState.SUCCESS: return 'Última ejecución correcta';
    case RuntimeState.ERROR: return 'Última ejecución con errores';
    case RuntimeState.STOPPED: return 'Última ejecución detenida';
    case RuntimeState.UNAVAILABLE: return 'Runtime no disponible';
    case RuntimeState.RUNNING: return 'Ejecutando';
    default: return 'En espera';
  }
}

export { describeLuauValue };
