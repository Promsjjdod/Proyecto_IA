/**
 * Lua 5.4 runner — executes a script inside an isolated child process using wasmoon.
 *
 * Why a child process: the WASM Lua state cannot be interrupted from the outside, so the
 * supervisor needs a real, hard way to stop a runaway script (`SIGKILL`). The runner also
 * enforces a *soft* limit from inside the VM with `debug.sethook`.
 *
 * Protocol (line based on stdout):
 *   @@LUMEN@@{"t":"out","s":"stdout","text":"..."}   → user output / print
 *   @@LUMEN@@{"t":"result", ...}                     → final execution result (single line)
 * Anything else on stdout/stderr coming from user code is forwarded verbatim as `out`.
 *
 * The user's source is compiled with `load(source, "@name", "bt")`, so error messages and
 * line numbers refer to the original script — no wrapper offsets.
 */

import { LuaFactory } from 'wasmoon';
import { LUA54_PRELUDE, normalizeLua54Options } from '../../shared/lua54-prelude.js';

const MARKER = '@@LUMEN@@';
const encoder = new TextEncoder();

let outputBytes = 0;
let outputLimitBytes = 256 * 1024;
let truncated = false;
let responded = false;

function send(payload) {
  process.stdout.write(`${MARKER}${JSON.stringify(payload)}\n`);
}

/** Emits user output respecting the configured byte budget. */
function emitOutput(text, stream = 'stdout') {
  if (truncated) return;
  const bytes = encoder.encode(text).length;
  if (outputBytes + bytes > outputLimitBytes) {
    const remaining = Math.max(0, outputLimitBytes - outputBytes);
    const slice = remaining > 0 ? text.slice(0, remaining) : '';
    if (slice !== '') send({ t: 'out', s: stream, text: slice });
    outputBytes += remaining;
    truncated = true;
    send({ t: 'out', s: 'stderr', text: `\n[Lumen] Salida truncada: se alcanzó el límite de ${outputLimitBytes} bytes.\n`, level: 'WARNING' });
    return;
  }
  outputBytes += bytes;
  send({ t: 'out', s: stream, text });
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const raw = await readStdin();
  let job;
  try {
    job = JSON.parse(raw);
  } catch (err) {
    send({ t: 'result', ok: false, error: { kind: 'internal', message: `Job inválido: ${err.message}` } });
    return;
  }

  const source = typeof job.source === 'string' ? job.source : '';
  const scriptName = typeof job.name === 'string' && job.name.trim() !== '' ? job.name : 'script.lua';
  const options = normalizeLua54Options(job.options ?? {});
  outputLimitBytes = options.outputLimitBytes;
  const hookCount = options.interruptLimit;
  const startedAt = Date.now();

  const factory = new LuaFactory();
  let lua;
  try {
    lua = await factory.createEngine();
    // Real allocator limit: when exceeded, Lua raises "not enough memory" inside the script
    // instead of letting the WASM heap grow without bound.
    if (options.memoryLimitBytes) {
      lua.global.setMemoryMax(options.memoryLimitBytes);
    }
  } catch (err) {
    send({
      t: 'result',
      ok: false,
      error: { kind: 'internal', message: `No se pudo inicializar el runtime de Lua 5.4: ${err.message}` },
      stats: { durationMs: Date.now() - startedAt },
    });
    return;
  }

  try {
    // --- bridge functions exposed to Lua -------------------------------------
    lua.global.set('__lumen_output', (text) => {
      emitOutput(typeof text === 'string' ? text : String(text), 'stdout');
    });
    lua.global.set('__lumen_error_output', (text) => {
      emitOutput(typeof text === 'string' ? text : String(text), 'stderr');
    });
    lua.global.set('__lumen_report', (payload) => {
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
      } else if (Array.isArray(result.values)) {
        values = result.values;
      }
      send({
        t: 'result',
        ok: result.ok === true,
        values,
        error: result.ok === true ? null : {
          kind: result.kind === 'syntax' ? 'syntax' : result.kind === 'timeout' ? 'timeout' : 'runtime',
          message: typeof result.message === 'string' ? result.message : 'Error desconocido en el script',
          traceback: typeof result.traceback === 'string' ? result.traceback : null,
        },
        stats: {
          durationMs: Date.now() - startedAt,
          outputBytes,
          truncated,
          interrupted: result.interrupted === true,
        },
      });
    });
    lua.global.set('__lumen_name', scriptName);
    lua.global.set('__lumen_source', source);
    lua.global.set('__lumen_hook_count', hookCount);
    lua.global.set('__lumen_timeout_ms', options.timeoutMs);
    // Host clock: the in-VM guard must measure *real* elapsed time, not instruction counts
    // (a tight `while true do end` loop burns a million instructions in a few milliseconds).
    lua.global.set('__lumen_now', () => Date.now());
    lua.global.set('__lumen_started_ms', startedAt);

    // --- support library installed inside the VM (shared with the browser worker) ---
    await lua.doString(LUA54_PRELUDE);
  } catch (err) {
    send({
      t: 'result',
      ok: false,
      error: { kind: 'internal', message: `El entorno de ejecución falló: ${err.message}` },
      stats: { durationMs: Date.now() - startedAt, outputBytes, truncated },
    });
  } finally {
    try {
      lua.global.close?.();
    } catch {
      /* the engine can already be torn down when the parent kills the process */
    }
    // Give the event loop one tick so the result line reaches the pipe before exiting.
    setImmediate(() => process.exit(0));
  }
}

main().catch((err) => {
  send({ t: 'result', ok: false, error: { kind: 'internal', message: `Fallo del runner: ${err?.message ?? err}` } });
  process.exit(1);
});
