/**
 * Lua 5.4 browser runtime adapter.
 *
 * Owns a terminable Web Worker that hosts the real wasmoon (Lua 5.4.7) runtime. Because a
 * WebAssembly Lua state cannot be interrupted cooperatively, cancellation is a genuine
 * `worker.terminate()`; the adapter then recreates the worker for the next run and reports
 * the execution as `STOPPED` with `E_CANCELLED`.
 *
 * The adapter never pretends: if the worker cannot be created (no module workers, missing
 * vendor files) `init()` reports the real reason and the runtime stays UNAVAILABLE.
 */

import { ErrorCode, ErrorKind, LogLevel, RuntimeState } from '../../../shared/constants.js';

const STOP_CODES = Object.freeze({ cancel: ErrorCode.CANCELLED, timeout: ErrorCode.TIMEOUT, unload: ErrorCode.CANCELLED });

export class Lua54BrowserRuntime {
  #worker = null;
  #ready = null;
  #readyResolve = null;
  #pending = new Map();
  #counter = 0;
  #executions = 0;
  #terminations = 0;
  #disposed = false;
  #fatalError = null;
  #lastReadyInfo = null;

  constructor({ workerUrl = '/build/lua54.worker.js', wasmUrl = '/vendor/wasmoon/glue.wasm', logger = null, timeoutMs = 10_000 } = {}) {
    this.workerUrl = workerUrl;
    this.wasmUrl = wasmUrl;
    this.logger = logger;
    this.initTimeoutMs = timeoutMs;
    this.id = 'browser.lua54.wasm';
    this.label = 'Lua 5.4 (navegador)';
    this.dialect = 'lua54';
    this.mode = 'browser';
  }

  get available() {
    return this.#ready !== null && !this.#disposed && this.#worker !== null;
  }

  get info() {
    return this.#lastReadyInfo;
  }

  get stats() {
    return { executions: this.#executions, terminations: this.#terminations, pending: this.#pending.size, available: this.available };
  }

  /** Starts the worker and waits for its real `ready` message. */
  async init() {
    if (this.#disposed) return { ok: false, error: 'El runtime fue liberado' };
    if (this.#worker) return { ok: true, version: this.#lastReadyInfo?.version ?? null };

    if (typeof Worker !== 'function') {
      this.#fatalError = 'El navegador no implementa Web Workers';
      return { ok: false, error: this.#fatalError };
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (payload) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(payload);
      };
      const timer = setTimeout(() => {
        this.#fatalError = `El worker de Lua 5.4 no respondió en ${this.initTimeoutMs} ms`;
        this.#teardown();
        finish({ ok: false, error: this.#fatalError });
      }, this.initTimeoutMs);

      try {
        this.#worker = new Worker(this.workerUrl, { type: 'module', name: 'lumen-lua54' });
      } catch (err) {
        this.#fatalError = `No se pudo crear el worker de Lua 5.4: ${err.message}`;
        finish({ ok: false, error: this.#fatalError });
        return;
      }

      this.#worker.addEventListener('message', (event) => this.#onMessage(event.data));
      this.#worker.addEventListener('error', (event) => {
        this.#fatalError = `Error en el worker de Lua 5.4: ${event.message || 'desconocido'}`;
        this.logger?.error?.(new Error(this.#fatalError), { source: 'Lua54BrowserRuntime' });
        this.#failPending(this.#fatalError);
        finish({ ok: false, error: this.#fatalError });
      });
      this.#worker.addEventListener('messageerror', () => {
        this.#fatalError = 'El worker de Lua 5.4 envió datos no clonables';
        finish({ ok: false, error: this.#fatalError });
      });

      this.#ready = finish;
      this.#worker.postMessage({ type: 'init', wasmUrl: this.wasmUrl });
    });
  }

  #onMessage(message) {
    if (!message || typeof message !== 'object') return;
    switch (message.type) {
      case 'ready': {
        this.#lastReadyInfo = { version: message.version, wasmUrl: message.wasmUrl, at: Date.now() };
        this.#ready?.({ ok: true, version: message.version, wasmUrl: message.wasmUrl });
        break;
      }
      case 'output': {
        const entry = this.#pending.get(message.id);
        if (!entry) return;
        entry.outputs.push({ level: message.level ?? LogLevel.INFO, stream: message.stream ?? 'stdout', text: message.text, timestamp: Date.now() });
        entry.onOutput?.({ level: message.level ?? LogLevel.INFO, stream: message.stream ?? 'stdout', text: message.text });
        break;
      }
      case 'result': {
        const entry = this.#pending.get(message.id);
        if (!entry) return;
        this.#pending.delete(message.id);
        entry.finish(this.#buildResult(entry, message));
        break;
      }
      case 'fatal': {
        this.#fatalError = message.message ?? 'Fallo desconocido del worker de Lua 5.4';
        this.logger?.error?.(new Error(this.#fatalError), { source: 'Lua54BrowserRuntime', data: { stack: message.stack } });
        this.#failPending(this.#fatalError);
        break;
      }
      case 'pong':
        break;
      default:
        break;
    }
  }

  #buildResult(entry, message) {
    if (message.ok) {
      return {
        ok: true,
        state: RuntimeState.SUCCESS,
        outputs: entry.outputs,
        returnValues: Array.isArray(message.values) ? message.values : [],
        error: null,
        stats: { ...message.stats, cancelled: false, timedOut: false },
      };
    }
    const kind = message.error?.kind ?? 'runtime';
    const timedOut = kind === 'timeout' || message.stats?.interrupted === true;
    return {
      ok: false,
      state: RuntimeState.ERROR,
      outputs: entry.outputs,
      returnValues: [],
      error: {
        code: timedOut ? ErrorCode.TIMEOUT : kind === 'syntax' ? ErrorCode.SYNTAX : ErrorCode.RUNTIME,
        kind: ErrorKind.RUNTIME,
        label: timedOut ? 'Tiempo excedido' : kind === 'syntax' ? 'Error de sintaxis' : 'Error en tiempo de ejecución',
        message: message.error?.message ?? 'Error desconocido',
        detail: {
          engine: this.id,
          scriptName: entry.name,
          traceback: message.error?.traceback ?? null,
          parse: parseLuaLocation(message.error?.message ?? '', entry.name),
        },
      },
      stats: { ...message.stats, cancelled: false, timedOut },
    };
  }

  #failPending(reason) {
    for (const [id, entry] of this.#pending) {
      this.#pending.delete(id);
      entry.finish({
        ok: false,
        state: RuntimeState.ERROR,
        outputs: entry.outputs,
        returnValues: [],
        error: { code: ErrorCode.INTERNAL, kind: ErrorKind.RUNTIME, label: 'Fallo del runtime', message: reason, detail: { engine: this.id } },
        stats: { durationMs: Date.now() - entry.startedAt, cancelled: false, timedOut: false, outputBytes: entry.outputs.reduce((sum, item) => sum + item.text.length, 0) },
      });
    }
  }

  /**
   * Executes a script.
   * @param {{ source: string, name?: string, options?: object, onOutput?: Function, signal?: AbortSignal }} request
   */
  async execute({ source, name = 'script.lua', options = {}, onOutput = null, signal = null }) {
    if (this.#disposed) {
      return this.#unavailable('El runtime fue liberado');
    }
    if (!this.#worker) {
      const started = await this.init();
      if (!started.ok) return this.#unavailable(started.error ?? 'El runtime de Lua 5.4 no está disponible');
    }
    if (!this.available) {
      return this.#unavailable(this.#fatalError ?? 'El runtime de Lua 5.4 no está disponible');
    }
    if (signal?.aborted) {
      return this.#cancelledBeforeStart();
    }

    const id = `lua54-${++this.#counter}`;
    this.#executions += 1;

    const result = await new Promise((resolve) => {
      const entry = {
        id,
        name,
        startedAt: Date.now(),
        outputs: [],
        onOutput,
        finish: (payload) => {
          signal?.removeEventListener?.('abort', onAbort);
          resolve(payload);
        },
      };
      const onAbort = () => {
        // Real cancellation: the worker is terminated, the Lua state dies with it.
        this.cancel('cancel', id);
      };
      this.#pending.set(id, entry);
      signal?.addEventListener?.('abort', onAbort, { once: true });
      try {
        this.#worker.postMessage({
          type: 'execute',
          id,
          source,
          name,
          options: {
            timeoutMs: options.timeoutMs ?? null,
            outputLimitBytes: options.outputLimitBytes ?? null,
            interruptLimit: options.interruptLimit ?? null,
            memoryLimitBytes: options.memoryLimitBytes ?? null,
          },
        });
      } catch (err) {
        this.#pending.delete(id);
        entry.finish({
          ok: false,
          state: RuntimeState.ERROR,
          outputs: entry.outputs,
          returnValues: [],
          error: { code: ErrorCode.INTERNAL, kind: ErrorKind.RUNTIME, label: 'Fallo al enviar el script', message: err.message, detail: { engine: this.id } },
          stats: { durationMs: 0, cancelled: false, timedOut: false },
        });
      }
    });

    return result;
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
        detail: { engine: this.id, requirement: 'npm run build (vendor/wasmoon) + Web Workers' },
      },
      stats: { durationMs: 0, cancelled: false, timedOut: false },
    };
  }

  #cancelledBeforeStart() {
    return {
      ok: false,
      state: RuntimeState.STOPPED,
      outputs: [],
      returnValues: [],
      error: { code: ErrorCode.CANCELLED, kind: ErrorKind.RUNTIME, label: 'Cancelado', message: 'La ejecución se canceló antes de iniciar', detail: { engine: this.id } },
      stats: { durationMs: 0, cancelled: true, timedOut: false },
    };
  }

  /**
   * Stops the running execution by terminating the worker (the only real way to stop WASM
   * Lua) and reports the pending execution as STOPPED.
   */
  cancel(reason = 'cancel', executionId = null) {
    const code = STOP_CODES[reason] ?? ErrorCode.CANCELLED;
    const targets = executionId ? [executionId] : [...this.#pending.keys()];
    const stopped = [];
    for (const id of targets) {
      const entry = this.#pending.get(id);
      if (!entry) continue;
      this.#pending.delete(id);
      this.#terminations += 1;
      stopped.push(id);
      entry.finish({
        ok: false,
        state: RuntimeState.STOPPED,
        outputs: entry.outputs,
        returnValues: [],
        error: {
          code,
          kind: ErrorKind.RUNTIME,
          label: reason === 'timeout' ? 'Tiempo excedido' : 'Ejecución detenida',
          message: reason === 'timeout'
            ? 'La ejecución excedió el límite de tiempo y el worker fue terminado'
            : 'La ejecución se detuvo y el estado de Lua fue destruido (terminate)',
          detail: { engine: this.id, reason, hardTerminate: true },
        },
        stats: {
          durationMs: Date.now() - entry.startedAt,
          cancelled: true,
          timedOut: reason === 'timeout',
          terminated: true,
        },
      });
    }
    if (stopped.length > 0) {
      // The WASM state is gone: the worker is recreated lazily by the next execution.
      this.#teardown();
      this.#ready = null;
    }
    return { ok: stopped.length > 0, stopped, reason };
  }

  cancelAll(reason = 'cancel') {
    return this.cancel(reason, null);
  }

  #teardown() {
    try {
      this.#worker?.terminate();
    } catch {
      /* already gone */
    }
    this.#worker = null;
  }

  /** Health check used by the capability detector: really starts the worker. */
  async probe({ timeoutMs = 8000 } = {}) {
    const wasReady = this.#ready !== null;
    const startedAt = Date.now();
    const result = await Promise.race([
      this.init(),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: `Sin respuesta en ${timeoutMs} ms` }), timeoutMs)),
    ]);
    return { ...result, durationMs: Date.now() - startedAt, alreadyRunning: wasReady };
  }

  dispose() {
    this.#disposed = true;
    this.cancelAll('unload');
    this.#teardown();
    this.#pending.clear();
    this.#ready = null;
  }
}

/** Parses `name:line: message` from a Lua error, keeping the real positions. */
export function parseLuaLocation(message, fallbackName) {
  const match = /^([^\s:]+):(\d+):\s*([\s\S]*)$/.exec(message ?? '');
  if (!match) return { file: fallbackName, line: null, message: message ?? null };
  return { file: match[1], line: Number(match[2]), message: match[3] };
}
