/**
 * NativeLuaEngine — runs a script with a *real* native interpreter found on the system
 * (`luau` or `lua5.4`), or with the one built locally by
 * `npm run setup -- --build-luau` into `tools/bin`.
 *
 * Everything here is genuine: the interpreter is executed as a child process with the
 * script written to a temporary file, stdout/stderr are streamed, the exit code decides
 * the final state and cancellation is a real `SIGKILL`.
 *
 * The engine is *disabled by default* (`execution.allowNativeEngines`) because running a
 * native binary is a different trust level than the sandboxed WASM runtimes. When the
 * setting is off, the engine reports itself as unavailable with that exact reason.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { CapabilityState, ErrorCode, Limits, LogLevel, RuntimeState } from '../../../shared/constants.js';
import { parseRuntimeLocation } from '../../../shared/protocol.js';
import { BaseEngine } from './BaseEngine.js';
import { runProcess } from '../../services/CapabilityDetector.js';

export class NativeLuaEngine extends BaseEngine {
  /**
   * @param {object} options
   * @param {string} options.dialect       'luau' | 'lua54'
   * @param {string[]} options.candidates  Binary names to look for, in order of preference.
   * @param {() => boolean} [options.isEnabled] Whether the user allowed native engines.
   */
  constructor(options) {
    super(options);
    this.dialectName = options.dialect;
    this.candidates = options.candidates;
    this.isEnabled = options.isEnabled ?? (() => true);
    this.resolved = null;
  }

  get id() {
    return this.dialectName === 'luau' ? 'native.luau' : 'native.lua54';
  }

  get limits() {
    return {
      cancel: true,
      cancelMode: 'kill',
      timeout: true,
      memoryLimit: false,
      streaming: true,
      isolation: 'child-process',
      returnValues: false,
      requires: [`nativeBinary:${this.candidates[0]}`, 'execution.allowNativeEngines'],
    };
  }

  async probe() {
    if (!this.isEnabled()) {
      return {
        state: CapabilityState.UNAVAILABLE,
        detail: 'Los intérpretes nativos están desactivados en Ajustes → Ejecución → "Permitir intérpretes nativos".',
        data: { disabledBySetting: true },
      };
    }
    const failures = [];
    for (const candidate of this.candidates) {
      const resolved = await this.#resolve(candidate);
      if (!resolved) {
        failures.push(`${candidate}: no encontrado en PATH ni en tools/bin`);
        continue;
      }
      const version = await runProcess(resolved.path, ['--version'], { timeoutMs: 5000 });
      const probe = await runProcess(resolved.path, ['-e', 'print(6*7)'], { timeoutMs: 5000 });
      if (probe.stdout.trim() !== '42') {
        failures.push(`${candidate}: la prueba de comportamiento no imprimió 42 ("${(probe.stdout || probe.stderr).trim().slice(0, 80)}")`);
        continue;
      }
      this.resolved = resolved;
      const versionLine = `${version.stdout}${version.stderr}`.trim().split('\n')[0] || 'versión desconocida';
      return {
        state: CapabilityState.AVAILABLE,
        detail: `Intérprete nativo operativo: ${resolved.path} (${versionLine})`,
        data: { path: resolved.path, version: versionLine, source: resolved.source },
      };
    }
    return {
      state: CapabilityState.UNAVAILABLE,
      detail: `No hay intérprete nativo utilizable. ${failures.join('; ')}`,
      data: { tried: this.candidates, failures },
    };
  }

  async #resolve(name) {
    if (this.toolsDir) {
      for (const candidate of [name, `${name}-bin`, `${name}-cli`]) {
        const full = path.join(this.toolsDir, candidate);
        const stat = await fsp.stat(full).catch(() => null);
        if (stat?.isFile()) return { path: full, source: 'tools' };
      }
    }
    const dirs = [...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean), '/usr/local/bin', '/usr/bin', '/bin', '/opt/homebrew/bin'];
    for (const dir of dirs) {
      const full = path.join(dir, name);
      const stat = await fsp.stat(full).catch(() => null);
      if (!stat?.isFile()) continue;
      await fsp.access(full, 0o1).catch(() => null); // X_OK check
      return { path: full, source: 'path' };
    }
    return null;
  }

  async execute({ executionId, source, name = 'script.luau', options = {}, hooks = {}, signal = null }) {
    const startedAt = Date.now();
    const availability = await this.probeCached({ ttlMs: 15_000 });
    if (availability.state !== CapabilityState.AVAILABLE) {
      return this.buildResult({
        executionId,
        ok: false,
        state: RuntimeState.UNAVAILABLE,
        error: {
          code: ErrorCode.UNAVAILABLE,
          kind: 'RUNTIME',
          label: 'Motor no disponible',
          message: `${this.label} no está disponible en este entorno`,
          detail: { requirement: availability.detail, engine: this.id, probe: availability.data },
        },
        startedAt,
      });
    }

    const interpreter = this.resolved ?? (await this.#resolve(this.candidates[0]));
    if (!interpreter) {
      return this.buildResult({
        executionId,
        ok: false,
        state: RuntimeState.UNAVAILABLE,
        error: {
          code: ErrorCode.UNAVAILABLE,
          kind: 'RUNTIME',
          label: 'Motor no disponible',
          message: 'El intérprete nativo dejó de estar disponible después de la comprobación',
          detail: { engine: this.id },
        },
        startedAt,
      });
    }

    const tmpDir = this.dataDir ? path.join(this.dataDir, 'tmp') : path.join(process.cwd(), 'data', 'tmp');
    await fsp.mkdir(tmpDir, { recursive: true });
    const scriptFile = path.join(tmpDir, `native-${executionId}-${sanitize(name)}`);
    await fsp.writeFile(scriptFile, source, 'utf8');

    const outputs = [];
    const emit = (text, level, stream) => {
      if (!text) return;
      const entry = { level, stream, text, timestamp: Date.now() };
      outputs.push(entry);
      hooks.onOutput?.(entry);
    };

    const timeoutMs = options.timeoutMs ?? Limits.defaultTimeoutMs;
    const outputLimitBytes = options.outputLimitBytes ?? Limits.defaultOutputLimitBytes;
    let truncated = false;
    let timedOut = false;
    let cancelled = false;

    const result = await new Promise((resolve) => {
      let settled = false;
      const child = spawn(interpreter.path, [scriptFile], {
        cwd: tmpDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
        windowsHide: true,
      });

      let captured = 0;
      const kill = () => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      };

      const timer = timeoutMs > 0
        ? setTimeout(() => {
          timedOut = true;
          kill();
        }, timeoutMs)
        : null;

      const abortListener = () => {
        cancelled = true;
        kill();
      };
      signal?.addEventListener?.('abort', abortListener, { once: true });

      this.activeExecutions.set(executionId, async () => {
        cancelled = true;
        kill();
      });

      const finish = (payload) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        signal?.removeEventListener?.('abort', abortListener);
        this.activeExecutions.delete(executionId);
        resolve(payload);
      };

      const consume = (chunk, stream, level) => {
        const text = chunk.toString('utf8');
        if (captured >= outputLimitBytes) {
          if (!truncated) {
            truncated = true;
            emit('\n[Lumen] Salida truncada: se alcanzó el límite configurado.\n', LogLevel.WARNING, 'stderr');
          }
          return;
        }
        captured += text.length;
        emit(text.replace(/\n$/, ''), level, stream);
      };

      child.stdout.on('data', (chunk) => consume(chunk, 'stdout', LogLevel.OUTPUT));
      child.stderr.on('data', (chunk) => consume(chunk, 'stderr', LogLevel.WARNING));
      child.on('error', (err) => finish({ code: -1, signal: null, spawnError: err }));
      child.on('close', (code, sig) => finish({ code, signal: sig, spawnError: null }));
    });

    await fsp.rm(scriptFile, { force: true }).catch(() => {});

    const durationMs = Date.now() - startedAt;
    const stats = {
      durationMs,
      cancelled,
      timedOut,
      truncated,
      outputBytes: outputs.reduce((sum, entry) => sum + entry.text.length, 0),
      exitCode: result.code ?? null,
      peakMemoryBytes: null,
    };

    if (cancelled) {
      return this.buildResult({
        executionId,
        ok: false,
        state: RuntimeState.STOPPED,
        outputs,
        error: {
          code: ErrorCode.CANCELLED,
          kind: 'RUNTIME',
          label: 'Ejecución cancelada',
          message: 'La ejecución nativa fue cancelada y el proceso terminó',
          detail: { engine: this.id, interpreter: interpreter.path },
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
          message: `La ejecución excedió el límite de ${timeoutMs} ms`,
          detail: { engine: this.id, timeoutMs },
        },
        stats,
        startedAt,
      });
    }
    if (result.spawnError) {
      return this.buildResult({
        executionId,
        ok: false,
        state: RuntimeState.ERROR,
        outputs,
        error: {
          code: ErrorCode.RUNTIME,
          kind: 'INTERNAL',
          label: 'Error del motor',
          message: `No se pudo ejecutar el intérprete nativo: ${result.spawnError.message}`,
          detail: { engine: this.id, interpreter: interpreter.path },
        },
        stats,
        startedAt,
      });
    }

    if (result.code === 0) {
      return this.buildResult({
        executionId,
        ok: true,
        state: RuntimeState.SUCCESS,
        outputs,
        returnValues: [],
        stats,
        startedAt,
      });
    }

    const stderrText = outputs.filter((entry) => entry.stream === 'stderr').map((entry) => entry.text).join('\n');
    const location = parseRuntimeLocation(stderrText.trim(), { defaultFile: name });
    return this.buildResult({
      executionId,
      ok: false,
      state: RuntimeState.ERROR,
      outputs,
      error: {
        code: ErrorCode.RUNTIME,
        kind: 'RUNTIME',
        label: 'Error de ejecución',
        message: location.cleanMessage || stderrText.trim() || `El intérprete terminó con código ${result.code}`,
        detail: {
          file: location.file ?? name,
          line: location.line,
          exitCode: result.code,
          engine: this.id,
          interpreter: interpreter.path,
        },
      },
      stats,
      startedAt,
    });
  }
}

function sanitize(name) {
  return String(name).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64) || 'script';
}
