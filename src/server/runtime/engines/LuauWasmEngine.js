/**
 * LuauWasmEngine — real Luau 0.739 execution through `@luau-rs/luau`.
 *
 * Genuine guarantees provided by the upstream runtime and used here:
 *  - each execution gets a fresh, sandboxed Lua state inside a worker thread (off the main thread);
 *  - `memoryLimitBytes`, `outputLimitBytes`, `interruptLimit` and result limits are enforced by the VM;
 *  - `print` is streamed to the host as events (real streaming);
 *  - `AbortSignal` interrupts a running execution;
 *  - the complete traceback is returned in the error message.
 */

import { CapabilityState, ErrorCode, Limits, LogLevel, RuntimeState } from '../../../shared/constants.js';
import { parseRuntimeLocation, parseRuntimeTraceback } from '../../../shared/protocol.js';
import { BaseEngine, mapLuauErrorKind } from './BaseEngine.js';

export class LuauWasmEngine extends BaseEngine {
  #WorkerClass = null;
  #loadError = null;

  get id() {
    return 'server.luau.wasm';
  }

  get limits() {
    return {
      cancel: true,
      cancelMode: 'abort',
      timeout: true,
      memoryLimit: true,
      streaming: true,
      isolation: 'worker-thread',
      returnValues: true,
      requires: ['worker_threads', 'WebAssembly'],
    };
  }

  async #loadWorker() {
    if (this.#WorkerClass) return this.#WorkerClass;
    if (this.#loadError) throw this.#loadError;
    try {
      const mod = await import('@luau-rs/luau/worker');
      this.#WorkerClass = mod.LuaWorker;
      return this.#WorkerClass;
    } catch (err) {
      this.#loadError = err;
      throw err;
    }
  }

  async probe() {
    try {
      const LuaWorker = await this.#loadWorker();
      const worker = new LuaWorker();
      try {
        const outcome = await worker.execute('local acc = 0\nfor i = 1, 100 do acc += i end\nreturn acc', { timing: true });
        if (!outcome.result.ok || outcome.result.values?.[0] !== 5050) {
          return {
            state: CapabilityState.UNAVAILABLE,
            detail: `La ejecución de prueba devolvió ${JSON.stringify(outcome.result.values)} en lugar de 5050`,
            data: { error: outcome.result.error },
          };
        }
        return {
          state: CapabilityState.AVAILABLE,
          detail: `Luau 0.739 operativo (worker_thread, ${Math.round(outcome.durationMs)} ms)`,
          data: {
            memoryLimitBytes: Limits.defaultMemoryLimitBytes,
            peakMemoryBytes: outcome.result.peakLuaMemoryBytes,
            interruptCount: outcome.result.interruptCount,
          },
        };
      } finally {
        worker.terminate?.();
      }
    } catch (err) {
      return {
        state: CapabilityState.UNAVAILABLE,
        detail: `No se pudo inicializar el runtime de Luau: ${err.message}`,
        data: { dependency: '@luau-rs/luau' },
      };
    }
  }

  async execute({ executionId, source, name = 'script.luau', options = {}, hooks = {}, signal = null }) {
    const startedAt = Date.now();
    const outputs = [];
    const emit = (text, level = LogLevel.OUTPUT, stream = 'stdout') => {
      if (text === '' || text === undefined || text === null) return;
      const entry = { level, stream, text, timestamp: Date.now() };
      outputs.push(entry);
      hooks.onOutput?.(entry);
    };

    let LuaWorker;
    try {
      LuaWorker = await this.#loadWorker();
    } catch (err) {
      return this.buildResult({
        executionId,
        ok: false,
        state: RuntimeState.UNAVAILABLE,
        error: {
          code: ErrorCode.UNAVAILABLE,
          kind: 'RUNTIME',
          label: 'Runtime no disponible',
          message: 'El runtime de Luau (WASM) no pudo cargarse en el servidor',
          detail: { dependency: '@luau-rs/luau', reason: err.message },
        },
        startedAt,
      });
    }

    const timeoutMs = options.timeoutMs ?? Limits.defaultTimeoutMs;
    const memoryLimitBytes = options.memoryLimitBytes ?? Limits.defaultMemoryLimitBytes;
    const outputLimitBytes = options.outputLimitBytes ?? Limits.defaultOutputLimitBytes;
    const timeoutForBudget = timeoutMs > 0 ? timeoutMs : Limits.maxTimeoutMs;

    const worker = new LuaWorker();
    const abortController = new AbortController();
    let abortedBy = null;
    let timedOut = false;

    const abort = (reason) => {
      if (abortedBy !== null) return;
      abortedBy = reason;
      abortController.abort();
      // The AbortSignal stops the VM; terminating is the hard fallback so we can never
      // leave a hot loop running in a worker thread.
      setTimeout(() => {
        try {
          worker.terminate?.();
        } catch {
          /* already gone */
        }
      }, 250).unref?.();
    };

    this.activeExecutions.set(executionId, async () => abort('cancelled'));
    const externalAbortListener = () => abort('cancelled');
    signal?.addEventListener?.('abort', externalAbortListener, { once: true });

    const timer = timeoutMs > 0
      ? setTimeout(() => {
        timedOut = true;
        abort('timeout');
      }, timeoutMs)
      : null;

    const onPrint = (event) => emit(event.text, LogLevel.OUTPUT, 'stdout');
    worker.addEventListener('print', onPrint);

    try {
      const outcome = await worker.execute(source, {
        entryName: name,
        signal: abortController.signal,
        timing: true,
        memoryLimitBytes,
        outputLimitBytes,
        interruptLimit: Math.min(200_000_000, Math.max(Limits.defaultInterruptLimit, Math.round(timeoutForBudget * 250))),
      });

      const durationMs = outcome?.durationMs ?? (Date.now() - startedAt);
      const result = outcome?.result ?? outcome ?? {};
      const stats = {
        durationMs,
        peakMemoryBytes: result.peakLuaMemoryBytes ?? null,
        interrupts: result.interruptCount ?? null,
        outputBytes: outputs.reduce((sum, entry) => sum + entry.text.length, 0),
        truncated: result.outputTruncated === true,
        cancelled: abortedBy === 'cancelled',
        timedOut: abortedBy === 'timeout',
      };

      if (result.ok) {
        return this.buildResult({
          executionId,
          ok: true,
          state: RuntimeState.SUCCESS,
          outputs,
          returnValues: (result.values ?? []).map(describeLuauValue),
          stats,
          startedAt,
        });
      }

      const errorInfo = describeLuauError(result.error, { timedOut, cancelled: abortedBy === 'cancelled', timeoutMs });
      return this.buildResult({
        executionId,
        ok: false,
        state: abortedBy === 'cancelled' ? RuntimeState.STOPPED : RuntimeState.ERROR,
        outputs,
        error: errorInfo,
        stats,
        startedAt,
      });
    } catch (err) {
      const timedOutNow = timedOut;
      const cancelled = abortedBy === 'cancelled';
      const message = String(err?.message ?? err);
      const location = parseRuntimeLocation(message, { defaultFile: name });
      return this.buildResult({
        executionId,
        ok: false,
        state: cancelled ? RuntimeState.STOPPED : RuntimeState.ERROR,
        outputs,
        error: {
          code: cancelled ? ErrorCode.CANCELLED : timedOutNow ? ErrorCode.TIMEOUT : ErrorCode.RUNTIME,
          kind: cancelled || timedOutNow ? 'RUNTIME' : 'INTERNAL',
          label: cancelled ? 'Ejecución cancelada' : timedOutNow ? 'Tiempo excedido' : 'Error del motor',
          message: cancelled
            ? 'La ejecución fue cancelada por el usuario'
            : timedOutNow
              ? `La ejecución excedió el límite de ${timeoutMs} ms`
              : message,
          detail: { file: location.file, line: location.line, traceback: parseRuntimeTraceback(message), engine: this.id },
          stack: err?.stack ?? null,
        },
        stats: {
          durationMs: Date.now() - startedAt,
          cancelled,
          timedOut: timedOutNow,
          outputBytes: outputs.reduce((sum, entry) => sum + entry.text.length, 0),
        },
        startedAt,
      });
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener?.('abort', externalAbortListener);
      worker.removeEventListener('print', onPrint);
      this.activeExecutions.delete(executionId);
      try {
        worker.terminate?.();
      } catch {
        /* ignore */
      }
    }
  }
}

function describeLuauError(error, { timedOut, cancelled, timeoutMs }) {
  if (!error) {
    return {
      code: ErrorCode.RUNTIME,
      kind: 'RUNTIME',
      label: 'Error de ejecución',
      message: 'La ejecución falló sin detalles disponibles',
      detail: {},
    };
  }
  const { code, kind, label } = mapLuauErrorKind(error.kind);
  const rawMessage = typeof error.message === 'string' ? error.message : String(error.message ?? error);
  const location = parseRuntimeLocation(rawMessage, { defaultFile: null });

  if (cancelled) {
    return {
      code: ErrorCode.CANCELLED,
      kind: 'RUNTIME',
      label: 'Ejecución cancelada',
      message: 'La ejecución fue cancelada por el usuario',
      detail: { file: location.file, line: location.line, engine: 'server.luau.wasm' },
    };
  }
  if (timedOut || error.kind === 'interrupted') {
    return {
      code: ErrorCode.TIMEOUT,
      kind: 'RUNTIME',
      label: 'Tiempo excedido',
      message: timedOut
        ? `La ejecución excedió el límite de ${timeoutMs} ms y fue detenida`
        : 'La ejecución fue interrumpida por el runtime al agotar su presupuesto de instrucciones',
      detail: {
        file: location.file,
        line: location.line,
        traceback: parseRuntimeTraceback(rawMessage),
        engine: 'server.luau.wasm',
        rawMessage,
      },
    };
  }
  return {
    code,
    kind,
    label,
    message: location.cleanMessage || rawMessage,
    detail: {
      file: location.file,
      line: location.line,
      traceback: parseRuntimeTraceback(rawMessage),
      rawMessage,
      engine: 'server.luau.wasm',
      luauKind: error.kind,
    },
  };
}

/** Converts a detached Luau value into a JSON-safe value plus a type label. */
export function describeLuauValue(value) {
  if (value === null || value === undefined) return { type: 'nil', value: null };
  if (value instanceof Uint8Array) return { type: 'buffer', value: `buffer(${value.length} bytes)` };
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { type: 'number', value: 'nan' };
    if (!Number.isFinite(value)) return { type: 'number', value: value > 0 ? 'inf' : '-inf' };
    return { type: Number.isInteger(value) ? 'integer' : 'number', value };
  }
  if (typeof value === 'string' || typeof value === 'boolean') return { type: typeof value, value };
  if (typeof value === 'bigint') return { type: 'integer', value: Number(value) };
  if (value && typeof value === 'object' && typeof value.toString === 'function' && value.constructor?.name === 'LuaVector') {
    return { type: 'vector', value: value.toString() };
  }
  if (Array.isArray(value)) return { type: 'table', value: value.map((item) => describeLuauValue(item).value) };
  if (value instanceof Map) {
    const entries = [...value.entries()].slice(0, 200).map(([key, item]) => [String(describeLuauValue(key).value), describeLuauValue(item).value]);
    return { type: 'table', value: Object.fromEntries(entries) };
  }
  if (typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value).slice(0, 200)) output[key] = describeLuauValue(item).value;
    return { type: 'table', value: output };
  }
  return { type: 'table', value: String(value) };
}
