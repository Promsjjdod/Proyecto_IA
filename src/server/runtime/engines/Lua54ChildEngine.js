/**
 * Lua54ChildEngine — real Lua 5.4.7 (wasmoon/WASM) executed in a *child process*.
 *
 * Isolation and control that this adapter genuinely provides:
 *  - a separate OS process per execution (a crash or an infinite loop cannot take the
 *    server down);
 *  - hard cancellation through `SIGKILL` (reported as `STOPPED`, never as success);
 *  - hard timeout through `SIGKILL` with `timedOut: true` in the stats;
 *  - a soft, in-VM timeout via `debug.sethook` that produces a normal Lua error first;
 *  - streaming output: `print`/`io.write` lines are forwarded as they are produced;
 *  - output limit enforced inside the runner (marked `truncated`).
 *
 * What it does NOT provide (reported honestly through the capability panel):
 *  - a configurable memory limit: the WASM module's heap is fixed by the build.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { CapabilityState, ErrorCode, Limits, LogLevel, RuntimeState } from '../../../shared/constants.js';
import { parseRuntimeLocation, parseRuntimeTraceback } from '../../../shared/protocol.js';
import { BaseEngine } from './BaseEngine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER_PATH = path.join(HERE, '..', 'lua54-runner.mjs');
const MARKER = '@@LUMEN@@';

export class Lua54ChildEngine extends BaseEngine {
  #modulePath = null;

  get id() {
    return 'server.lua54.wasm';
  }

  get limits() {
    return {
      cancel: true,
      cancelMode: 'kill',
      timeout: true,
      memoryLimit: false,
      streaming: true,
      isolation: 'child-process',
      returnValues: true,
      requires: ['child_process', 'WebAssembly', 'wasmoon'],
    };
  }

  #resolveModule() {
    if (this.#modulePath) return this.#modulePath;
    try {
      this.#modulePath = fileURLToPath(import.meta.resolve('wasmoon'));
    } catch (err) {
      this.#modulePath = null;
      throw new Error(`No se pudo resolver el paquete wasmoon: ${err.message}`);
    }
    return this.#modulePath;
  }

  async probe() {
    try {
      this.#resolveModule();
    } catch (err) {
      return { state: CapabilityState.UNAVAILABLE, detail: err.message, data: { dependency: 'wasmoon' } };
    }
    const outcome = await this.#runChild(
      { source: 'return string.format("%s/%d", _VERSION, 6 * 7)', name: 'probe.lua', options: { timeoutMs: 20000, outputLimitBytes: 64 * 1024, interruptLimit: 0 } },
      { executionId: `probe-${Date.now()}`, onOutput: () => {} },
    );
    if (!outcome.ok) {
      return {
        state: CapabilityState.UNAVAILABLE,
        detail: `La ejecución de prueba falló: ${outcome.error?.message ?? 'sin detalle'}`,
        data: { error: outcome.error },
      };
    }
    // Return values are `{type, value}` descriptors (normalised for the API); unwrap for the probe.
    const raw = outcome.result?.values?.[0] ?? null;
    const version = raw && typeof raw === 'object' && 'value' in raw ? raw.value : raw;
    if (!String(version ?? '').includes('42')) {
      return { state: CapabilityState.UNAVAILABLE, detail: `Resultado inesperado en la prueba: ${JSON.stringify(raw)}`, data: { raw } };
    }
    return {
      state: CapabilityState.AVAILABLE,
      detail: `Lua 5.4 operativo en proceso aislado (${version})`,
      data: { version, memoryLimit: false },
    };
  }

  async execute({ executionId, source, name = 'script.lua', options = {}, hooks = {}, signal = null }) {
    const startedAt = Date.now();
    const timeoutMs = options.timeoutMs ?? Limits.defaultTimeoutMs;
    const outputLimitBytes = options.outputLimitBytes ?? Limits.defaultOutputLimitBytes;

    let timedOut = false;
    let cancelled = false;
    let killTimer = null;
    /** Set once the child process exists so cancel() can really kill it. */
    let killChild = null;

    const outputs = [];
    /** Receives already-structured entries from `#runChild` (level/stream/text). */
    const emit = (entry) => {
      if (!entry || entry.text === undefined || entry.text === null || entry.text === '') return;
      const normalized = {
        level: entry.level ?? LogLevel.OUTPUT,
        stream: entry.stream ?? 'stdout',
        text: typeof entry.text === 'string' ? entry.text : String(entry.text),
        timestamp: entry.timestamp ?? Date.now(),
      };
      outputs.push(normalized);
      hooks.onOutput?.(normalized);
    };

    // Registered *before* spawning so an immediate cancel still reaches the process.
    this.activeExecutions.set(executionId, async () => {
      cancelled = true;
      killChild?.();
    });

    const outcome = await this.#runChild(
      {
        source,
        name,
        options: {
          timeoutMs,
          outputLimitBytes,
          interruptLimit: typeof options.interruptLimit === 'number' ? options.interruptLimit : Limits.defaultInterruptLimit,
        },
      },
      {
        executionId,
        onOutput: emit,
        onSpawn: (handle) => {
          killChild = handle.kill;
          if (timeoutMs > 0) {
            // The in-VM soft timeout should fire first; this is the hard backstop.
            killTimer = setTimeout(() => {
              timedOut = true;
              handle.kill();
            }, timeoutMs + 750);
          }
        },
        signal,
        onCancelRequested: () => {
          cancelled = true;
        },
      },
    );

    if (killTimer) clearTimeout(killTimer);
    this.activeExecutions.delete(executionId);

    const stats = {
      durationMs: Date.now() - startedAt,
      outputBytes: outputs.reduce((sum, entry) => sum + entry.text.length, 0),
      truncated: outcome.truncated === true,
      cancelled: cancelled && !timedOut,
      timedOut,
      exitCode: outcome.exitCode ?? null,
      peakMemoryBytes: null,
    };

    if (cancelled && !timedOut) {
      return this.buildResult({
        executionId,
        ok: false,
        state: RuntimeState.STOPPED,
        outputs,
        error: {
          code: ErrorCode.CANCELLED,
          kind: 'RUNTIME',
          label: 'Ejecución cancelada',
          message: 'La ejecución de Lua 5.4 fue cancelada y el proceso se terminó',
          detail: { engine: this.id, isolation: 'child-process' },
        },
        stats,
        startedAt,
      });
    }

    if (timedOut) {
      return this.buildResult({
        executionId,
        ok: false,
        state: RuntimeState.ERROR,
        outputs,
        error: {
          code: ErrorCode.TIMEOUT,
          kind: 'RUNTIME',
          label: 'Tiempo excedido',
          message: `La ejecución excedió el límite de ${timeoutMs} ms y el proceso fue terminado`,
          detail: { engine: this.id, timeoutMs, isolation: 'child-process' },
        },
        stats,
        startedAt,
      });
    }

    if (!outcome.result) {
      return this.buildResult({
        executionId,
        ok: false,
        state: RuntimeState.ERROR,
        outputs,
        error: {
          code: ErrorCode.RUNTIME,
          kind: 'INTERNAL',
          label: 'Error del motor',
          message: outcome.error?.message ?? 'El proceso de Lua 5.4 no devolvió ningún resultado',
          detail: { engine: this.id, exitCode: outcome.exitCode ?? null, stderr: (outcome.stderrTail ?? '').slice(0, 4000) },
        },
        stats,
        startedAt,
      });
    }

    const result = outcome.result;
    stats.durationMs = result.stats?.durationMs ?? stats.durationMs;
    stats.truncated = result.stats?.truncated === true || stats.truncated;
    stats.outputBytes = result.stats?.outputBytes ?? stats.outputBytes;

    if (result.ok) {
      return this.buildResult({
        executionId,
        ok: true,
        state: RuntimeState.SUCCESS,
        outputs,
        returnValues: (result.values ?? []).map((value) => normalizeLuaValue(value)),
        stats,
        startedAt,
      });
    }

    const message = result.error?.message ?? 'Error desconocido';
    const location = parseRuntimeLocation(message, { defaultFile: name });

    // The in-VM guard aborts the script when the wall clock exceeds the timeout: report it
    // as a real timeout (not as a user error) and keep the flag consistent with reality.
    if (result.error?.kind === 'timeout' || result.stats?.interrupted === true) {
      return this.buildResult({
        executionId,
        ok: false,
        state: RuntimeState.ERROR,
        outputs,
        error: {
          code: ErrorCode.TIMEOUT,
          kind: 'RUNTIME',
          label: 'Tiempo excedido',
          message: `La ejecución excedió el límite de ${timeoutMs} ms y fue interrumpida dentro de la máquina virtual`,
          detail: {
            file: location.file ?? name,
            line: location.line,
            engine: this.id,
            timeoutMs,
            rawMessage: message,
          },
        },
        stats: { ...stats, timedOut: true, durationMs: timeoutMs },
        startedAt,
      });
    }

    return this.buildResult({
      executionId,
      ok: false,
      state: RuntimeState.ERROR,
      outputs,
      error: {
        code: result.error?.kind === 'syntax' ? ErrorCode.SYNTAX : ErrorCode.RUNTIME,
        kind: result.error?.kind === 'syntax' ? 'PARSE' : 'RUNTIME',
        label: result.error?.kind === 'syntax' ? 'Error de sintaxis' : 'Error de ejecución',
        message: location.cleanMessage || message,
        detail: {
          file: location.file ?? name,
          line: location.line,
          traceback: parseRuntimeTraceback(result.error?.traceback ?? message),
          engine: this.id,
          rawMessage: message,
        },
      },
      stats,
      startedAt,
    });
  }

  /**
   * Spawns the runner, streams its stdout and resolves with the parsed outcome.
   * The returned promise never rejects: transport problems become structured errors.
   */
  #runChild(job, { onOutput = () => {}, onSpawn = null, signal = null, onCancelRequested = null } = {}) {
    return new Promise((resolve) => {
      let settled = false;
      let stdoutBuffer = '';
      let stderrTail = '';
      let exitCode = null;
      let spawnError = null;
      let result = null;
      let truncated = false;

      const finish = (error = null) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener?.('abort', abortListener);
        resolve({ ok: !error && result?.ok === true, result, error, exitCode, stderrTail, truncated });
      };

      const child = spawn(process.execPath, ['--no-warnings', RUNNER_PATH], {
        cwd: path.resolve(HERE, '..', '..', '..'),
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, LUMEN_RUNNER: '1' },
        windowsHide: true,
      });

      const kill = () => {
        if (child.exitCode !== null) return;
        try {
          child.kill('SIGKILL');
        } catch {
          /* the process may have just exited */
        }
      };

      const abortListener = () => {
        onCancelRequested?.();
        kill();
      };
      signal?.addEventListener?.('abort', abortListener, { once: true });

      onSpawn?.({ kill, pid: child.pid });

      child.on('error', (err) => {
        spawnError = err;
        finish({
          code: ErrorCode.RUNTIME,
          kind: 'INTERNAL',
          label: 'Error del motor',
          message: `No se pudo iniciar el proceso de Lua 5.4: ${err.message}`,
          detail: { engine: this.id },
        });
      });

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdoutBuffer += chunk;
        let index = stdoutBuffer.indexOf('\n');
        while (index !== -1) {
          const line = stdoutBuffer.slice(0, index);
          stdoutBuffer = stdoutBuffer.slice(index + 1);
          this.#handleLine(line, { onOutput, setResult: (value) => { result = value; }, setTruncated: () => { truncated = true; } });
          index = stdoutBuffer.indexOf('\n');
        }
        if (stdoutBuffer.length > 0 && !stdoutBuffer.startsWith(MARKER)) {
          // Partial human-readable output from the runtime itself (warnings, etc.)
          onOutput({ level: LogLevel.DEBUG, stream: 'stdout', text: stdoutBuffer, timestamp: Date.now() });
          stdoutBuffer = '';
        }
      });

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        stderrTail = `${stderrTail}${chunk}`.slice(-8192);
        const text = chunk.trim();
        if (text !== '') onOutput({ level: LogLevel.WARNING, stream: 'stderr', text, timestamp: Date.now() });
      });

      child.on('close', (code) => {
        exitCode = code;
        if (stdoutBuffer.trim() !== '') {
          this.#handleLine(stdoutBuffer, { onOutput, setResult: (value) => { result = value; }, setTruncated: () => { truncated = true; } });
        }
        if (!result && !spawnError) {
          finish({
            code: ErrorCode.RUNTIME,
            kind: 'INTERNAL',
            label: 'Proceso terminado',
            message: `El proceso de Lua 5.4 terminó con código ${code} sin producir un resultado`,
            detail: { engine: this.id, exitCode: code, stderr: stderrTail.slice(-4000) },
          });
          return;
        }
        finish(null);
      });

      try {
        child.stdin.write(JSON.stringify(job));
        child.stdin.end();
      } catch (err) {
        finish({
          code: ErrorCode.RUNTIME,
          kind: 'INTERNAL',
          label: 'Error del motor',
          message: `No se pudo enviar el script al proceso de Lua 5.4: ${err.message}`,
          detail: { engine: this.id },
        });
      }
    });
  }

  #handleLine(line, { onOutput, setResult, setTruncated }) {
    if (line === '') return;
    if (!line.startsWith(MARKER)) {
      onOutput({ level: LogLevel.OUTPUT, stream: 'stdout', text: line, timestamp: Date.now() });
      return;
    }
    let message;
    try {
      message = JSON.parse(line.slice(MARKER.length));
    } catch {
      onOutput({ level: LogLevel.WARNING, stream: 'stderr', text: `Mensaje ilegible del runner: ${line.slice(0, 200)}`, timestamp: Date.now() });
      return;
    }
    if (message.t === 'out') {
      if (message.text === '') return;
      onOutput({
        level: message.level ?? (message.s === 'stderr' ? LogLevel.WARNING : LogLevel.OUTPUT),
        stream: message.s === 'stderr' ? 'stderr' : 'stdout',
        text: message.text,
        timestamp: Date.now(),
      });
      return;
    }
    if (message.t === 'result') {
      if (message.stats?.truncated) setTruncated();
      setResult(message);
    }
  }
}

/** `{type, value}` descriptors produced inside the VM are passed through; plain values are described. */
function normalizeLuaValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.type === 'string' && 'value' in value) {
    const type = value.type === 'number' && Number.isInteger(value.value) ? 'integer' : value.type;
    return { type, value: value.value };
  }
  return describeLuaValue(value);
}

function describeLuaValue(value) {
  if (value === null || value === undefined) return { type: 'nil', value: null };
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { type: 'number', value: 'nan' };
    if (value === Infinity) return { type: 'number', value: 'inf' };
    if (value === -Infinity) return { type: 'number', value: '-inf' };
    return { type: Number.isInteger(value) ? 'integer' : 'number', value };
  }
  if (typeof value === 'string' || typeof value === 'boolean') return { type: typeof value, value };
  if (Array.isArray(value)) return { type: 'table', value };
  if (typeof value === 'object') return { type: 'table', value };
  return { type: 'table', value: String(value) };
}
