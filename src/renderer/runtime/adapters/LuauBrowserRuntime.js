/**
 * Luau browser runtime adapter.
 *
 * Uses the real `@luau-rs/luau` worker client (vendored verbatim under `public/vendor/`
 * and resolved by the import map). `print` events arrive while the script runs, so the
 * console shows live output; results come back with their Lua types.
 *
 * Cancellation has two real stages:
 *   1. the execution's `AbortSignal` asks the runtime to interrupt (the Luau VM counts
 *      interrupts and stops cooperatively);
 *   2. if the script does not stop within a short grace period, the worker is terminated
 *      (hard stop) and a fresh worker is created for the next run.
 */

import { LuaWorker } from '@luau-rs/luau/worker';
import { ErrorCode, ErrorKind, RuntimeState } from '../../../shared/constants.js';
import { AppError, toAppError } from '../../../shared/errors.js';
import { parseRuntimeLocation, parseRuntimeTraceback } from '../../../shared/protocol.js';

const GRACE_PERIOD_MS = 400;

export class LuauBrowserRuntime {
  #worker = null;
  #active = null;
  #counter = 0;
  #executions = 0;
  #terminations = 0;
  #disposed = false;
  #startupMs = null;
  #printListener = null;
  #readyAt = null;

  constructor({ logger = null, defaults = {} } = {}) {
    this.logger = logger;
    this.id = 'browser.luau.wasm';
    this.label = 'Luau (navegador)';
    this.dialect = 'luau';
    this.mode = 'browser';
    this.defaults = {
      memoryLimitBytes: defaults.memoryLimitBytes ?? 64 * 1024 * 1024,
      interruptLimit: defaults.interruptLimit ?? 500_000,
      outputLimitBytes: defaults.outputLimitBytes ?? 256 * 1024,
    };
  }

  get available() {
    return !this.#disposed && this.#worker !== null;
  }

  get info() {
    return { readyAt: this.#readyAt, startupMs: this.#startupMs, executions: this.#executions, terminations: this.#terminations };
  }

  /** Creates the worker client and waits for its first execution round-trip. */
  async init() {
    if (this.#disposed) return { ok: false, error: 'El runtime fue liberado' };
    if (this.#worker) return { ok: true, startupMs: this.#startupMs };

    if (typeof Worker !== 'function') {
      return { ok: false, error: 'El navegador no implementa Web Workers' };
    }

    const startedAt = performance.now();
    try {
      this.#worker = new LuaWorker();
      this.#printListener = (event) => {
        const active = this.#active;
        if (!active) return;
        const text = typeof event?.text === 'string' ? event.text : String(event?.text ?? '');
        const entry = { level: 'INFO', stream: 'stdout', text, timestamp: Date.now() };
        active.outputs.push(entry);
        active.onOutput?.(entry);
      };
      this.#worker.addEventListener('print', this.#printListener);
    } catch (err) {
      this.#worker = null;
      return { ok: false, error: `No se pudo crear el worker de Luau: ${err.message}` };
    }

    // Real verification: run the smallest possible program and check the value it returns.
    try {
      const outcome = await this.#worker.execute('return 1 + 1', { entryName: 'lumen-boot-check.luau', timing: true });
      const result = outcome?.result ?? outcome;
      if (!result?.ok || result.values?.[0] !== 2) {
        const message = result?.error?.message ?? 'la comprobación de arranque no devolvió el valor esperado';
        this.#hardStop();
        return { ok: false, error: `El runtime de Luau no superó la comprobación de arranque: ${message}` };
      }
      this.#startupMs = Math.round((performance.now() - startedAt) * 100) / 100;
      this.#readyAt = Date.now();
      return { ok: true, startupMs: this.#startupMs };
    } catch (err) {
      this.#hardStop();
      return { ok: false, error: `El runtime de Luau falló al arrancar: ${err.message}` };
    }
  }

  /**
   * Executes a Luau script.
   * @param {{ source: string, name?: string, options?: object, onOutput?: Function, signal?: AbortSignal }} request
   */
  async execute({ source, name = 'script.luau', options = {}, onOutput = null, signal = null }) {
    if (this.#disposed) return this.#unavailable('El runtime fue liberado');
    if (signal?.aborted) return this.#stopped('La ejecución se canceló antes de iniciar');

    if (!this.#worker) {
      const started = await this.init();
      if (!started.ok) return this.#unavailable(started.error ?? 'El runtime de Luau no está disponible');
    }
    if (this.#active) {
      return this.#unavailable('Ya hay una ejecución en curso en este runtime (una por vez)');
    }

    const id = `luau-${++this.#counter}`;
    this.#executions += 1;
    const startedAt = Date.now();
    const controller = new AbortController();
    const outputs = [];
    let settle = null;
    let timedOut = false;
    let cancelled = false;
    let timer = null;
    let graceTimer = null;

    const stopped = { controller, get cancelled() { return cancelled; } };
    this.#active = { id, outputs, onOutput, startedAt, controller, markCancel: (reason) => { cancelled = true; if (reason === 'timeout') timedOut = true; } };

    const onExternalAbort = () => {
      this.#active?.markCancel('cancel');
      controller.abort();
      this.#scheduleHardStop('cancel');
    };
    signal?.addEventListener?.('abort', onExternalAbort, { once: true });

    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 0;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        this.#active?.markCancel('timeout');
        controller.abort();
        this.#scheduleHardStop('timeout');
      }, timeoutMs);
    }

    try {
      const withTiming = options.timing !== false;
      const outcome = await this.#worker.execute(source, {
        entryName: name,
        signal: controller.signal,
        timing: withTiming,
        memoryLimitBytes: options.memoryLimitBytes ?? this.defaults.memoryLimitBytes,
        interruptLimit: options.interruptLimit ?? this.defaults.interruptLimit,
        outputLimitBytes: options.outputLimitBytes ?? this.defaults.outputLimitBytes,
        disabledBuiltins: options.disabledBuiltins ?? undefined,
      });
      const result = withTiming ? outcome?.result ?? outcome : outcome;
      const durationMs = withTiming && Number.isFinite(outcome?.durationMs) ? outcome.durationMs : Date.now() - startedAt;
      settle = this.#buildResult({ id, name, result, outputs, durationMs, cancelled, timedOut });
      return settle;
    } catch (err) {
      // An aborted execution rejects: report it as STOPPED, never as an internal failure.
      if (cancelled || timedOut || signal?.aborted) {
        settle = this.#stopped(
          timedOut
            ? `La ejecución excedió el límite de ${timeoutMs} ms`
            : 'La ejecución fue detenida por el usuario',
          { outputs, timedOut, durationMs: Date.now() - startedAt },
        );
        return settle;
      }
      const appError = toAppError(err, {
        kind: ErrorKind.RUNTIME,
        code: ErrorCode.RUNTIME,
        message: 'El runtime de Luau falló',
        detail: { engine: this.id, scriptName: name },
      });
      settle = {
        ok: false,
        state: RuntimeState.ERROR,
        outputs,
        returnValues: [],
        error: appError.toJSON ? appError.toJSON() : { code: ErrorCode.RUNTIME, kind: ErrorKind.RUNTIME, label: 'Error', message: appError.message },
        stats: { durationMs: Date.now() - startedAt, cancelled: false, timedOut: false },
      };
      return settle;
    } finally {
      if (timer) clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      signal?.removeEventListener?.('abort', onExternalAbort);
      this.#active = null;
      void stopped;
    }
  }

  /** If the cooperative interrupt does not settle quickly, terminate the worker. */
  #scheduleHardStop(reason) {
    if (!this.#worker) return;
    const worker = this.#worker;
    setTimeout(() => {
      if (this.#active && this.#worker === worker) {
        this.#terminations += 1;
        this.logger?.warn?.(`La interrupción cooperativa no detuvo el script; se termina el worker de Luau (${reason})`, {
          source: 'LuauBrowserRuntime',
        });
        this.#hardStop();
      }
    }, GRACE_PERIOD_MS);
  }

  #buildResult({ id, name, result, outputs, durationMs, cancelled, timedOut }) {
    const ok = result?.ok === true;
    const stats = {
      durationMs: Math.round((Number.isFinite(durationMs) ? durationMs : 0) * 100) / 100,
      outputBytes: outputs.reduce((total, entry) => total + entry.text.length, 0),
      truncated: result?.outputTruncated === true,
      peakMemoryBytes: result?.peakLuaMemoryBytes ?? null,
      interrupts: result?.interruptCount ?? null,
      cancelled,
      timedOut,
      hardTerminate: false,
    };
    if (ok) {
      return {
        ok: true,
        state: RuntimeState.SUCCESS,
        outputs,
        returnValues: (result.values ?? []).map((value) => describeLuauValue(value)),
        error: null,
        stats,
      };
    }
    const kind = result?.error?.kind ?? 'runtime';
    const rawMessage = result?.error?.message ?? 'Error desconocido';
    const location = parseRuntimeLocation(rawMessage, { defaultFile: name });
    const wasInterrupted = timedOut || cancelled || kind === 'interrupted';
    const code = wasInterrupted
      ? (timedOut ? ErrorCode.TIMEOUT : ErrorCode.CANCELLED)
      : kind === 'syntax' || kind === 'compile' || kind === 'input'
        ? ErrorCode.SYNTAX
        : kind === 'host' || kind === 'conversion'
          ? ErrorCode.INTERNAL
          : ErrorCode.RUNTIME;
    const appError = new AppError({
      code,
      kind: kind === 'host' || kind === 'conversion' ? ErrorKind.RUNTIME : ErrorKind.RUNTIME,
      label: describeLuauErrorKind(kind, timedOut),
      message: location.cleanMessage || rawMessage,
      detail: {
        engine: this.id,
        scriptName: name,
        luaKind: kind,
        file: location.file ?? name,
        line: location.line,
        column: location.column,
        traceback: parseRuntimeTraceback(rawMessage),
        rawMessage,
      },
    });
    return {
      ok: false,
      state: wasInterrupted ? RuntimeState.STOPPED : RuntimeState.ERROR,
      outputs,
      returnValues: [],
      error: appError.toJSON(),
      stats: { ...stats, cancelled: wasInterrupted },
    };
  }

  #stopped(message, { outputs = [], timedOut = false, durationMs = 0 } = {}) {
    const appError = new AppError({
      code: timedOut ? ErrorCode.TIMEOUT : ErrorCode.CANCELLED,
      kind: ErrorKind.RUNTIME,
      label: timedOut ? 'Tiempo excedido' : 'Ejecución detenida',
      message,
      detail: { engine: this.id, hardTerminate: this.#terminations > 0 },
    });
    return {
      ok: false,
      state: RuntimeState.STOPPED,
      outputs,
      returnValues: [],
      error: appError.toJSON(),
      stats: { durationMs, cancelled: true, timedOut, outputBytes: outputs.reduce((total, entry) => total + entry.text.length, 0) },
    };
  }

  #unavailable(reason) {
    return {
      ok: false,
      state: RuntimeState.UNAVAILABLE,
      outputs: [],
      returnValues: [],
      error: {
        code: ErrorCode.UNAVAILABLE,
        kind: ErrorKind.RUNTIME,
        label: 'Runtime no disponible',
        message: reason,
        detail: { engine: this.id, requirement: 'vendor/@luau-rs/luau (npm run build) + Web Workers' },
      },
      stats: { durationMs: 0, cancelled: false, timedOut: false },
    };
  }

  /** Stops the active execution (cooperative first, hard terminate as backstop). */
  cancel(reason = 'cancel') {
    if (!this.#active) return { ok: false, stopped: false, reason: 'sin ejecución activa' };
    const id = this.#active.id;
    this.#active.markCancel(reason);
    this.#active.controller.abort();
    this.#scheduleHardStop(reason);
    return { ok: true, stopped: true, executionId: id, reason };
  }

  cancelAll(reason = 'cancel') {
    return this.cancel(reason);
  }

  /** Health check: really creates the worker and runs the `1 + 1` program. */
  async probe() {
    const startedAt = performance.now();
    const result = await this.init();
    return { ...result, durationMs: Math.round((performance.now() - startedAt) * 100) / 100 };
  }

  #hardStop() {
    const worker = this.#worker;
    this.#worker = null;
    if (this.#printListener && worker) {
      try {
        worker.removeEventListener('print', this.#printListener);
      } catch {
        /* the worker is already gone */
      }
    }
    try {
      worker?.terminate();
    } catch {
      /* already terminated */
    }
  }

  dispose() {
    this.#disposed = true;
    this.cancel('unload');
    this.#hardStop();
  }
}

function describeLuauErrorKind(kind, timedOut) {
  if (timedOut || kind === 'interrupted') return 'Ejecución interrumpida';
  switch (kind) {
    case 'syntax':
    case 'compile':
    case 'input':
      return 'Error de sintaxis';
    case 'memory':
      return 'Memoria excedida';
    case 'conversion':
      return 'Error al convertir un valor';
    case 'host':
      return 'Error del host';
    default:
      return 'Error en tiempo de ejecución';
  }
}

/** Converts a detached Luau value into the `{ type, value }` shape the UI renders. */
export function describeLuauValue(value, depth = 0) {
  if (value === null || value === undefined) return { type: 'nil', value: null };
  const kind = typeof value;
  if (kind === 'number') {
    if (Number.isNaN(value)) return { type: 'number', value: 'nan' };
    if (value === Infinity) return { type: 'number', value: 'inf' };
    if (value === -Infinity) return { type: 'number', value: '-inf' };
    return { type: Number.isInteger(value) ? 'integer' : 'number', value };
  }
  if (kind === 'bigint') return { type: 'integer', value: value.toString() };
  if (kind === 'string' || kind === 'boolean') return { type: kind, value };
  if (value instanceof Uint8Array) return { type: 'buffer', value: `${value.byteLength} bytes` };
  if (depth >= 3) return { type: 'table', value: '<profundidad máxima>' };
  if (value instanceof Map) {
    const entries = {};
    let count = 0;
    for (const [key, item] of value) {
      if (count >= 100) break;
      entries[String(key)] = describeLuauValue(item, depth + 1).value;
      count += 1;
    }
    return { type: 'table', value: entries };
  }
  if (Array.isArray(value)) return { type: 'table', value: value.slice(0, 100).map((item) => describeLuauValue(item, depth + 1).value) };
  if (kind === 'object') {
    const entries = {};
    let count = 0;
    for (const [key, item] of Object.entries(value)) {
      if (count >= 100) break;
      entries[key] = describeLuauValue(item, depth + 1).value;
      count += 1;
    }
    return { type: 'table', value: entries };
  }
  return { type: 'table', value: String(value) };
}
