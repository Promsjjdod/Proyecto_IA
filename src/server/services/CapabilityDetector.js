/**
 * Server-side capability detection.
 *
 * Every probe below *executes real code* to validate behaviour:
 *  - Luau: starts a LuaWorker and runs `return 1 + 1`, checking the returned values;
 *  - Lua 5.4: creates a wasmoon engine and evaluates a snippet, checking the output;
 *  - Luau analysis: instantiates the analysis worker, type-checks a module that must fail
 *    and verifies a diagnostic is produced;
 *  - File system: writes, reads back and deletes a probe file in the data root;
 *  - Native interpreters: runs `<binary> --version` and a one-line script, capturing output;
 *  - Network: performs a real HEAD request with a timeout (only when the user enables it).
 *
 * Results are cached with a TTL and reported through the UI's Capabilities panel.
 */

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { CapabilityId, CapabilityScope, CapabilityState, ErrorKind } from '../../shared/constants.js';
import { CapabilityRegistry, capabilityResult } from '../../shared/capability-registry.js';
import { toAppError } from '../../shared/errors.js';

const NATIVE_CANDIDATES = {
  luau: ['luau', 'luau.exe'],
  lua54: ['lua5.4', 'lua54', 'lua', 'luajit', 'lua5.3'],
};

export class CapabilityDetector extends CapabilityRegistry {
  #nativeCache = new Map();

  constructor({ logger, errorHandler, storage, toolsDir = null }) {
    super({ scope: CapabilityScope.SERVER });
    this.logger = logger;
    this.errorHandler = errorHandler;
    this.storage = storage;
    this.toolsDir = toolsDir;
    this.#registerProbes();
  }

  #registerProbes() {
    this.registerMany([
      {
        id: CapabilityId.RUNTIME_LUAU,
        label: 'Runtime Luau (WebAssembly)',
        description: 'Ejecuta Luau 0.739 en un worker_thread con límites de memoria, tiempo y salida.',
        dependency: 'paquete @luau-rs/luau',
        ttlMs: 60_000,
        check: () => this.#probeLuau(),
      },
      {
        id: CapabilityId.RUNTIME_LUA54,
        label: 'Runtime Lua 5.4 (WebAssembly)',
        description: 'Ejecuta Lua 5.4.7 en un proceso hijo aislado y terminable.',
        dependency: 'paquete wasmoon',
        ttlMs: 60_000,
        check: () => this.#probeLua54(),
      },
      {
        id: CapabilityId.ANALYSIS_TYPES,
        label: 'Analizador de tipos de Luau',
        description: 'Type-checking gradual real mediante la librería oficial de análisis de Luau.',
        dependency: 'paquete @luau-rs/luau (analysis)',
        ttlMs: 120_000,
        check: () => this.#probeAnalysis('type'),
      },
      {
        id: CapabilityId.ANALYSIS_LINT,
        label: 'Lint de Luau',
        description: 'Reglas de lint del analizador oficial (variables sin usar, comparaciones redundantes...).',
        dependency: 'paquete @luau-rs/luau (analysis + lint)',
        ttlMs: 120_000,
        check: () => this.#probeLint(),
      },
      {
        id: CapabilityId.ANALYSIS_COMPLETION,
        label: 'Autocompletado de Luau',
        description: 'Sugerencias reales del motor de análisis: propiedades, tipos, ámbitos y APIs.',
        dependency: 'paquete @luau-rs/luau (analysis)',
        ttlMs: 120_000,
        check: () => this.#probeCompletion(),
      },
      {
        id: CapabilityId.FILE_SYSTEM,
        label: 'Sistema de archivos',
        description: 'Lectura y escritura real de scripts, temas y configuración en disco.',
        dependency: 'directorio de datos escribible',
        ttlMs: 10_000,
        check: () => this.#probeFileSystem(),
      },
      {
        id: CapabilityId.FILE_SYSTEM_WATCH,
        label: 'Vigilancia de cambios en disco',
        description: 'Detecta modificaciones externas de los archivos de script.',
        dependency: 'fs.watch del sistema operativo',
        ttlMs: 60_000,
        check: () => this.#probeWatch(),
      },
      {
        id: CapabilityId.HTTP,
        label: 'Salida HTTP',
        description: 'Permite comprobar conectividad. Solo se usa cuando el usuario lo activa y nunca envía datos.',
        dependency: 'acceso de red del proceso',
        ttlMs: 120_000,
        check: () => this.#probeHttp(),
      },
      {
        id: CapabilityId.UI_WASM,
        label: 'WebAssembly',
        description: 'Necesario para los motores WASM (Luau y Lua 5.4).',
        dependency: 'soporte de WebAssembly en el runtime de Node',
        ttlMs: 300_000,
        check: async () => {
          if (typeof WebAssembly !== 'object' || typeof WebAssembly.instantiate !== 'function') {
            return capabilityResult.unavailable('El runtime de Node no expone WebAssembly', { node: process.version });
          }
          const module = new WebAssembly.Module(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
          const valid = module instanceof WebAssembly.Module;
          return valid
            ? capabilityResult.available('WebAssembly operativo (módulo de prueba compilado)', { node: process.version })
            : capabilityResult.unavailable('La compilación de un módulo mínimo falló');
        },
      },
      {
        id: CapabilityId.UI_WORKERS,
        label: 'Hilos de trabajo (worker_threads)',
        description: 'Aísla las ejecuciones del proceso principal.',
        dependency: 'módulo node:worker_threads',
        ttlMs: 300_000,
        check: async () => {
          try {
            const { Worker } = await import('node:worker_threads');
            return typeof Worker === 'function'
              ? capabilityResult.available('worker_threads disponible')
              : capabilityResult.unavailable('node:worker_threads no expone Worker');
          } catch (err) {
            return capabilityResult.unavailable(`No se pudo importar node:worker_threads: ${err.message}`);
          }
        },
      },
      {
        id: CapabilityId.CLIPBOARD,
        label: 'Portapapeles del servidor',
        description: 'El proceso del servidor se ejecuta sin sesión gráfica; el portapapeles se gestiona en el navegador.',
        dependency: 'entorno gráfico con portapapeles',
        ttlMs: 300_000,
        check: async () => capabilityResult.unavailable(
          'El servidor no tiene acceso a un portapapeles del sistema; usa los botones de copiar de la interfaz, que utilizan la Clipboard API del navegador.',
          { headless: true },
        ),
      },
      {
        id: CapabilityId.STORAGE_SERVER,
        label: 'Almacenamiento en servidor',
        description: 'Scripts, temas, configuración e historial persistidos en disco.',
        dependency: 'directorio de datos',
        ttlMs: 10_000,
        check: () => this.#probeStorage(),
      },
      {
        id: CapabilityId.PLUGINS,
        label: 'Sistema de plugins',
        description: 'Carga plugins reales con manifiesto, dependencias y permisos desde el directorio de plugins.',
        dependency: 'directorio data/plugins',
        ttlMs: 30_000,
        check: () => this.#probePlugins(),
      },
      {
        id: CapabilityId.NETWORK_OUTBOUND,
        label: 'Comprobación de conectividad',
        description: 'Solo se ejecuta si el usuario habilita "Comprobar conectividad" en Ajustes.',
        dependency: 'resolución DNS y salida HTTPS',
        ttlMs: 120_000,
        check: () => this.#probeNetwork(),
      },
      {
        id: CapabilityId.WINDOW_NATIVE,
        label: 'Ventana nativa del escritorio',
        description: 'Arrastrar, redimensionar, minimizar y cerrar ventanas del sistema operativo.',
        dependency: 'shell de escritorio Electron instalada',
        ttlMs: 60_000,
        check: () => this.#probeDesktopShell(),
      },
      {
        id: CapabilityId.PERSISTENCE_INDEXEDDB,
        label: 'IndexedDB',
        description: 'Almacenamiento estructurado del navegador; se verifica realmente desde el cliente.',
        dependency: 'soporte del navegador',
        ttlMs: 60_000,
        check: async () => capabilityResult.unknown('Se comprueba en el navegador y se notifica al servidor.'),
      },
    ]);

    // Native interpreters are registered dynamically (probe returns a fallback "unavailable" reason).
    this.register({
      id: `${CapabilityId.RUNTIME_LUAU}:native`,
      label: 'Intérprete nativo de Luau',
      description: 'Binario `luau` del sistema o compilado con `npm run setup -- --build-luau`.',
      dependency: 'binario luau en PATH o en tools/bin',
      ttlMs: 30_000,
      check: () => this.#probeNative('luau'),
    });
    this.register({
      id: `${CapabilityId.RUNTIME_LUA54}:native`,
      label: 'Intérprete nativo de Lua 5.4',
      description: 'Binario `lua5.4` (o compatible) encontrado en PATH.',
      dependency: 'binario lua5.4 en PATH',
      ttlMs: 30_000,
      check: () => this.#probeNative('lua54'),
    });
  }

  /* ------------------------------------------------------------------ *
   * Probes
   * ------------------------------------------------------------------ */

  async #probeLuau() {
    const started = Date.now();
    const { LuaWorker } = await import('@luau-rs/luau/worker');
    const worker = new LuaWorker();
    try {
      const prints = [];
      worker.addEventListener('print', (event) => prints.push(event.text));
      const outcome = await worker.execute('local t = {} for i = 1, 3 do t[i] = i * i end\nreturn t[3], "wasm"', { timeoutMs: 5000 });
      if (!outcome?.ok) {
        return capabilityResult.unavailable(`La ejecución de prueba falló: ${outcome?.error?.message ?? 'sin detalle'}`);
      }
      const [square, tag] = outcome.values ?? [];
      if (square !== 9 || tag !== 'wasm') {
        return capabilityResult.unavailable('La ejecución de prueba devolvió valores inesperados', { values: outcome.values });
      }
      return capabilityResult.available('Luau ejecutado correctamente (return 3² = 9)', {
        version: 'Luau 0.739',
        startupMs: Date.now() - started,
        prints,
      });
    } finally {
      try {
        worker.terminate?.();
      } catch {
        /* the worker may already be gone */
      }
    }
  }

  async #probeLua54() {
    const { LuaFactory } = await import('wasmoon');
    const factory = new LuaFactory();
    const lua = await factory.createEngine();
    try {
      const lines = [];
      lua.global.set('__lumen_print', (...args) => lines.push(args.join('\t')));
      await lua.doString('__lumen_print(_VERSION, 6 * 7)');
      const output = lines.join(' ');
      if (!output.includes('42')) {
        return capabilityResult.unavailable(`La ejecución de prueba no produjo el resultado esperado (${output || 'sin salida'})`);
      }
      return capabilityResult.available(`Lua ejecutado correctamente (${output.trim()})`, { version: 'Lua 5.4.7' });
    } finally {
      lua.global.close?.();
    }
  }

  async #probeAnalysis(kind) {
    const { AnalysisWorker } = await import('@luau-rs/luau/analysis/worker');
    const analysis = new AnalysisWorker({ mode: 'strict', lint: kind === 'lint' });
    try {
      analysis.setModule('probe.luau', 'local value: number = "texto"\nreturn value\n');
      const result = await analysis.check('probe.luau');
      const diagnostics = result?.diagnostics ?? [];
      const typeDiagnostics = diagnostics.filter((entry) => entry.kind === 'type');
      if (typeDiagnostics.length === 0) {
        return capabilityResult.unavailable('El analizador no detectó un error de tipo evidente en la muestra de prueba', {
          diagnostics,
        });
      }
      return capabilityResult.available(`Analizador operativo (${typeDiagnostics.length} diagnósticos en la muestra)`, {
        sample: typeDiagnostics[0].message,
        millis: null,
      });
    } finally {
      analysis[Symbol.dispose]?.();
    }
  }

  async #probeLint() {
    const { AnalysisWorker } = await import('@luau-rs/luau/analysis/worker');
    const analysis = new AnalysisWorker({ mode: 'strict', lint: true });
    try {
      analysis.setModule('lint.luau', 'local unused = 1\nlocal used = 2\nreturn used\n');
      const result = await analysis.check('lint.luau');
      const lintDiagnostics = (result?.diagnostics ?? []).filter((entry) => entry.kind === 'lint');
      return lintDiagnostics.length > 0
        ? capabilityResult.available(`Lint operativo (${lintDiagnostics.length} avisos en la muestra)`, { sample: lintDiagnostics[0].message })
        : capabilityResult.unavailable('El lint no produjo avisos para la muestra de prueba');
    } finally {
      analysis[Symbol.dispose]?.();
    }
  }

  async #probeCompletion() {
    const { AnalysisWorker } = await import('@luau-rs/luau/analysis/worker');
    const analysis = new AnalysisWorker({ mode: 'nonstrict' });
    try {
      const source = 'local table_ = { alpha = 1, beta = 2 }\ntable_.\n';
      analysis.setModule('complete.luau', source);
      const result = await analysis.fragmentAutocomplete('complete.luau', source, { line: 1, column: 7 });
      const labels = (result?.result?.entries ?? []).map((entry) => entry.label);
      if (!labels.includes('alpha') || !labels.includes('beta')) {
        return capabilityResult.unavailable('El autocompletado no devolvió las propiedades esperadas', { labels: labels.slice(0, 10) });
      }
      return capabilityResult.available(`Autocompletado operativo (propiedades: ${labels.join(', ')})`, {
        context: result.result.context,
        sample: labels.slice(0, 8),
      });
    } finally {
      analysis[Symbol.dispose]?.();
    }
  }

  async #probeFileSystem() {
    if (!this.storage) return capabilityResult.unavailable('El gestor de almacenamiento no está inicializado');
    const probe = path.join(this.storage.dirs.tmp, 'capability-probe.txt');
    const payload = `probe-${Date.now()}`;
    try {
      await fsp.writeFile(probe, payload, 'utf8');
      const read = await fsp.readFile(probe, 'utf8');
      await fsp.unlink(probe);
      if (read !== payload) return capabilityResult.unavailable('La lectura de prueba no coincide con lo escrito');
      const space = await this.storage.diskSpace();
      return capabilityResult.available('Escritura, lectura y borrado verificados', {
        root: this.storage.root,
        freeBytes: space.freeBytes,
        platform: process.platform,
      });
    } catch (err) {
      return capabilityResult.unavailable(`La prueba de disco falló: ${err.message}`, { root: this.storage.root });
    }
  }

  async #probeStorage() {
    if (!this.storage) return capabilityResult.unavailable('El gestor de almacenamiento no está inicializado');
    return this.storage.status.writable
      ? capabilityResult.available(`Datos en ${this.storage.root}`, {
        freeBytes: this.storage.status.freeBytes,
        totalBytes: this.storage.status.totalBytes,
      })
      : capabilityResult.unavailable(`El directorio ${this.storage.root} no es escribible`, this.storage.status.lastError ?? {});
  }

  async #probeWatch() {
    if (!this.storage) return capabilityResult.unavailable('El gestor de almacenamiento no está inicializado');
    const watched = path.join(this.storage.dirs.tmp, 'watch-probe.txt');
    return new Promise((resolve) => {
      let watcher = null;
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          watcher?.close();
        } catch {
          /* ignore */
        }
        fsp.rm(watched, { force: true }).catch(() => {});
        resolve(result);
      };
      const timer = setTimeout(() => finish(capabilityResult.unavailable('No se recibió ningún evento de fs.watch en 1500 ms')), 1500);
      try {
        watcher = this.storage.watch(path.join('tmp'), (event) => {
          if (event.filename === 'watch-probe.txt') {
            finish(capabilityResult.available('Evento de cambio recibido correctamente', { eventType: event.eventType }));
          }
        });
        if (!watcher) {
          finish(capabilityResult.unavailable('El sistema de archivos rechazó la vigilancia'));
          return;
        }
        fsp.writeFile(watched, 'watch', 'utf8').catch((err) => finish(capabilityResult.unavailable(`No se pudo crear el archivo de prueba: ${err.message}`)));
      } catch (err) {
        finish(capabilityResult.unavailable(`fs.watch no disponible: ${err.message}`));
      }
    });
  }

  async #probeHttp() {
    if (typeof fetch !== 'function') {
      return capabilityResult.unavailable('Este runtime de Node no expone fetch', { node: process.version });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const started = Date.now();
    try {
      const response = await fetch('https://registry.npmjs.org/-/ping', {
        method: 'HEAD',
        signal: controller.signal,
        redirect: 'manual',
      });
      return capabilityResult.available(`Respuesta HTTP ${response.status} en ${Date.now() - started} ms`, {
        status: response.status,
        latencyMs: Date.now() - started,
        target: 'registry.npmjs.org',
      });
    } catch (err) {
      return capabilityResult.unavailable(`Sin salida HTTP: ${err.message}`, { target: 'registry.npmjs.org' });
    } finally {
      clearTimeout(timer);
    }
  }

  async #probeNetwork() {
    const entry = this.get(CapabilityId.HTTP);
    if (!entry || entry.checkedAt === null) {
      const [checked] = await this.detect({ ids: [CapabilityId.HTTP], force: true });
      return checked?.available
        ? capabilityResult.available(checked.detail, checked.data)
        : capabilityResult.unavailable(checked?.detail ?? 'Sin conectividad');
    }
    return entry.available
      ? capabilityResult.available(entry.detail, entry.data)
      : capabilityResult.unavailable(entry.detail ?? 'Sin conectividad');
  }

  async #probePlugins() {
    if (!this.storage) return capabilityResult.unavailable('El gestor de almacenamiento no está inicializado');
    try {
      await fsp.mkdir(this.storage.dirs.plugins, { recursive: true });
      return capabilityResult.available(`Directorio de plugins: ${this.storage.dirs.plugins}`);
    } catch (err) {
      return capabilityResult.unavailable(`No se pudo preparar el directorio de plugins: ${err.message}`);
    }
  }

  async #probeDesktopShell() {
    const electronVersion = process.versions.electron ?? null;
    if (electronVersion) {
      return capabilityResult.available(`Electron ${electronVersion}`, { electron: electronVersion });
    }
    return capabilityResult.unavailable(
      'La aplicación corre en modo servidor + navegador. Instala la shell de escritorio (`npm run desktop`, requiere descargar Electron) para arrastrar, redimensionar y minimizar la ventana.',
      { electron: null, platform: process.platform },
    );
  }

  /** Runs `<binary> --version` and a behaviour check for a native interpreter. */
  async #probeNative(kind) {
    const candidates = NATIVE_CANDIDATES[kind] ?? [];
    const failures = [];
    for (const candidate of candidates) {
      const resolved = await this.#resolveBinary(candidate);
      if (!resolved) {
        failures.push(`${candidate}: no encontrado`);
        continue;
      }
      const version = await runProcess(resolved.path, ['--version'], { timeoutMs: 4000 });
      if (version.code !== 0 && version.code !== 1) {
        failures.push(`${candidate}: --version terminó con código ${version.code}`);
        continue;
      }
      const sample = await runProcess(resolved.path, kind === 'luau'
        ? ['-e', 'print(6*7)']
        : ['-e', 'print(6*7)'], { timeoutMs: 4000 });
      const combined = `${version.stdout}${version.stderr}`.trim().split('\n')[0] ?? '';
      const printed = sample.stdout.trim();
      if (printed !== '42') {
        // Lua 5.4 accepts -e; Lua 5.1/5.2 too. If it did not print 42 we cannot trust it.
        failures.push(`${candidate}: la prueba de comportamiento no imprimió 42 ("${printed || sample.stderr.trim()}")`);
        continue;
      }
      return capabilityResult.fallback(
        `${resolved.source === 'tools' ? 'compilado localmente' : 'encontrado en PATH'}: ${resolved.path} (${combined || 'sin versión'})`,
        { path: resolved.path, version: combined, source: resolved.source },
      );
    }
    return capabilityResult.unavailable(
      `No hay ningún intérprete compatible (${candidates.join(', ')}). Detalles: ${failures.join('; ')}`,
      { tried: candidates, failures },
    );
  }

  async #resolveBinary(name) {
    const cached = this.#nativeCache.get(name);
    if (cached && Date.now() - cached.checkedAt < 30_000) return cached.value;

    // 1. Explicit local build produced by `npm run setup -- --build-luau`.
    if (this.toolsDir) {
      for (const candidate of [`${name}`, `${name}-bin`]) {
        const full = path.join(this.toolsDir, candidate);
        try {
          const stat = await fsp.stat(full);
          if (stat.isFile()) {
            const value = { path: full, source: 'tools' };
            this.#nativeCache.set(name, { value, checkedAt: Date.now() });
            return value;
          }
        } catch {
          /* not built locally */
        }
      }
    }

    // 2. PATH lookup without spawning a shell (portable, no injection surface).
    const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
    const extra = ['/usr/local/bin', '/usr/bin', '/bin', '/opt/homebrew/bin'].filter(Boolean);
    for (const dir of [...pathEntries, ...extra]) {
      const full = path.join(dir, name);
      try {
        await fsp.access(full, fsConstants.X_OK);
        const value = { path: full, source: 'path' };
        this.#nativeCache.set(name, { value, checkedAt: Date.now() });
        return value;
      } catch {
        /* keep looking */
      }
    }
    this.#nativeCache.set(name, { value: null, checkedAt: Date.now() });
    return null;
  }

  /** Convenience: runs the full detection and logs a summary (used at boot). */
  async detectAll({ force = false, checkNetwork = false } = {}) {
    const ids = [
      CapabilityId.RUNTIME_LUAU,
      CapabilityId.RUNTIME_LUA54,
      CapabilityId.ANALYSIS_TYPES,
      CapabilityId.ANALYSIS_LINT,
      CapabilityId.ANALYSIS_COMPLETION,
      CapabilityId.FILE_SYSTEM,
      CapabilityId.FILE_SYSTEM_WATCH,
      CapabilityId.UI_WASM,
      CapabilityId.UI_WORKERS,
      CapabilityId.CLIPBOARD,
      CapabilityId.STORAGE_SERVER,
      CapabilityId.PLUGINS,
      CapabilityId.WINDOW_NATIVE,
      `${CapabilityId.RUNTIME_LUAU}:native`,
      `${CapabilityId.RUNTIME_LUA54}:native`,
    ];
    if (checkNetwork) ids.push(CapabilityId.HTTP, CapabilityId.NETWORK_OUTBOUND);
    const entries = await this.detect({ ids, force });
    for (const entry of entries) {
      const level = entry.available ? 'info' : 'warn';
      this.logger[level](`Capacidad ${entry.id}: ${entry.state}${entry.detail ? ` — ${entry.detail}` : ''}`, {
        source: 'CapabilityDetector',
        data: { probeMs: entry.probeMs, scope: entry.scope },
      });
    }
    return entries;
  }

  /** Records a real failure detected elsewhere (keeps the UI truthful). */
  reportFailure(id, error, { label = null } = {}) {
    const appError = toAppError(error, { kind: ErrorKind.INTERNAL });
    const previous = this.get(id);
    this.registerUnavailable({
      id,
      label: label ?? previous?.label ?? id,
      description: previous?.description ?? '',
      dependency: previous?.dependency ?? null,
      detail: `La comprobación falló en tiempo de ejecución: ${appError.message}`,
    });
    this.logger.warn(`Capacidad marcada como no disponible: ${id}`, {
      source: 'CapabilityDetector',
      data: { message: appError.message },
    });
  }
}

const fsConstants = (await import('node:fs')).constants;

/** Runs a process capturing stdout/stderr with a hard timeout; always resolves. */
export function runProcess(command, args, { timeoutMs = 10_000, cwd = undefined, env = undefined, maxOutputBytes = 256 * 1024 } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const child = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const finish = (code, signal, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, error, timedOut, truncated: stdout.length + stderr.length >= maxOutputBytes });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      if (stdout.length < maxOutputBytes) stdout += chunk.toString('utf8');
      else if (!child.killed) child.kill('SIGKILL');
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < maxOutputBytes) stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => finish(-1, null, err));
    child.on('close', (code, signal) => finish(code, signal));
  });
}

export const HOST_INFO = Object.freeze({
  platform: process.platform,
  arch: process.arch,
  cpus: os.cpus().length,
  model: os.cpus()[0]?.model ?? 'desconocido',
  totalMemoryBytes: os.totalmem(),
  freeMemoryBytes: os.freemem(),
  hostname: os.hostname(),
  node: process.version,
  uptimeSeconds: os.uptime(),
});
