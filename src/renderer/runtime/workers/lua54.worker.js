/**
 * Lua 5.4 execution worker (browser).
 *
 * The Lua state built by wasmoon cannot be interrupted from the outside, so this worker is
 * *terminable*: the main thread stops a runaway script with `worker.terminate()` and gets a
 * truthful `STOPPED` result. Inside the VM the same wall-clock hook as the server runner
 * aborts a runaway script gracefully (so partial output and `E_TIMEOUT` are reported by the
 * script itself before the hard termination is needed).
 *
 * Protocol (structured messages, never strings):
 *   main → worker: { type: 'init', wasmUrl? }
 *                  { type: 'execute', id, source, name, options }
 *                  { type: 'ping', id }
 *   worker → main: { type: 'ready', version }
 *                  { type: 'output', id, level: 'INFO'|'WARNING', stream, text }
 *                  { type: 'result', id, ok, values, error, stats }
 *                  { type: 'pong', id }
 *                  { type: 'fatal', message, stack }
 *
 * The execution prelude is shared with the Node runner (`src/shared/lua54-prelude.js`), so a
 * script behaves identically in both hosts.
 */

import { LuaFactory } from 'wasmoon';
import { LUA54_PRELUDE, normalizeLua54Options } from '../../../shared/lua54-prelude.js';

const DEFAULT_WASM_URL = '/vendor/wasmoon/glue.wasm';

let factoryPromise = null;
let wasmUrl = DEFAULT_WASM_URL;
let ready = false;

function getFactory() {
  if (!factoryPromise) {
    factoryPromise = Promise.resolve().then(() => new LuaFactory(wasmUrl));
  }
  return factoryPromise;
}

/** Posts a message to the main thread, never throwing from inside a callback. */
function post(message) {
  try {
    self.postMessage(message);
  } catch (err) {
    // Structured-clone failures (non-transferable values) must be reported, not swallowed.
    self.postMessage({ type: 'fatal', message: `No se pudo enviar el mensaje "${message?.type}": ${err.message}` });
  }
}

async function run({ id, source, name, options }) {
  const normalized = normalizeLua54Options(options);
  const startedAt = Date.now();
  const encoder = new TextEncoder();
  let outputBytes = 0;
  let truncated = false;
  let responded = false;
  let engine = null;

  const emit = (text, stream, level) => {
    if (truncated) return;
    const value = typeof text === 'string' ? text : String(text);
    const bytes = encoder.encode(value).length;
    if (outputBytes + bytes > normalized.outputLimitBytes) {
      const remaining = Math.max(0, normalized.outputLimitBytes - outputBytes);
      if (remaining > 0) {
        post({ type: 'output', id, level, stream, text: value.slice(0, remaining) });
      }
      outputBytes = normalized.outputLimitBytes;
      truncated = true;
      post({
        type: 'output',
        id,
        level: 'WARNING',
        stream: 'stderr',
        text: `\n[Lumen] Salida truncada: se alcanzó el límite de ${normalized.outputLimitBytes} bytes.\n`,
      });
      return;
    }
    outputBytes += bytes;
    post({ type: 'output', id, level, stream, text: value });
  };

  try {
    const factory = await getFactory();
    engine = await factory.createEngine();
    if (normalized.memoryLimitBytes) {
      engine.global.setMemoryMax(normalized.memoryLimitBytes);
    }

    engine.global.set('__lumen_output', (text) => emit(text, 'stdout', 'INFO'));
    engine.global.set('__lumen_error_output', (text) => emit(text, 'stderr', 'WARNING'));
    engine.global.set('__lumen_name', name);
    engine.global.set('__lumen_source', source);
    engine.global.set('__lumen_hook_count', normalized.interruptLimit);
    engine.global.set('__lumen_timeout_ms', normalized.timeoutMs);
    engine.global.set('__lumen_now', () => Date.now());
    engine.global.set('__lumen_started_ms', startedAt);
    engine.global.set('__lumen_report', (payload) => {
      if (responded) return;
      responded = true;
      const result = payload && typeof payload === 'object' ? payload : { ok: false };
      let values = [];
      if (typeof result.valuesJson === 'string' && result.valuesJson !== '') {
        try {
          const parsed = JSON.parse(result.valuesJson);
          if (Array.isArray(parsed)) values = parsed;
        } catch (err) {
          values = [{ type: 'string', value: `<valores no serializables: ${err.message}>` }];
        }
      }
      post({
        type: 'result',
        id,
        ok: result.ok === true,
        values,
        error: result.ok === true
          ? null
          : {
            kind: result.kind === 'syntax' ? 'syntax' : result.kind === 'timeout' ? 'timeout' : 'runtime',
            message: typeof result.message === 'string' ? result.message : 'Error desconocido en el script',
            traceback: typeof result.traceback === 'string' ? result.traceback : null,
          },
        stats: {
          durationMs: Date.now() - startedAt,
          outputBytes,
          truncated,
          interrupted: result.interrupted === true,
          memoryBytes: readMemory(engine),
        },
      });
    });

    await engine.doString(LUA54_PRELUDE);
  } catch (err) {
    post({
      type: 'result',
      id,
      ok: false,
      values: [],
      error: {
        kind: 'internal',
        message: `El entorno de ejecución de Lua 5.4 falló: ${err?.message ?? String(err)}`,
        traceback: err?.stack ?? null,
      },
      stats: { durationMs: Date.now() - startedAt, outputBytes, truncated, interrupted: false, memoryBytes: readMemory(engine) },
    });
  } finally {
    try {
      engine?.global?.close?.();
    } catch {
      /* the engine may already be unusable if a limit aborted it */
    }
  }
}

function readMemory(engine) {
  try {
    return engine?.global?.getMemoryUsed?.() ?? null;
  } catch {
    return null;
  }
}

self.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;
  switch (message.type) {
    case 'init': {
      if (typeof message.wasmUrl === 'string' && message.wasmUrl !== '') wasmUrl = message.wasmUrl;
      ready = true;
      post({ type: 'ready', version: describeRuntime(), wasmUrl });
      break;
    }
    case 'execute': {
      void run(message);
      break;
    }
    case 'ping': {
      post({ type: 'pong', id: message.id, ready, wasmUrl });
      break;
    }
    default:
      post({ type: 'fatal', message: `Mensaje desconocido en el worker de Lua 5.4: ${message.type}` });
  }
});

function describeRuntime() {
  return 'Lua 5.4.7 (wasmoon)';
}

post({ type: 'ready', version: describeRuntime(), wasmUrl, passive: true });

self.addEventListener('error', (event) => {
  post({ type: 'fatal', message: event.message, stack: event.error?.stack ?? null });
});

self.addEventListener('unhandledrejection', (event) => {
  post({ type: 'fatal', message: `Promesa rechazada en el worker: ${event.reason?.message ?? String(event.reason)}`, stack: event.reason?.stack ?? null });
});
