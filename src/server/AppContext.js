/**
 * AppContext — the composition root.
 *
 * Creates every service once, wires their dependencies explicitly (no globals, no circular
 * imports) and exposes an ordered `init()` / `shutdown()` lifecycle. Each step reports the
 * real outcome; if a critical step fails the context stays in a consistent, inspectable state.
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { APP, CapabilityId, Dialect, ErrorKind, HttpStatus, SseEvent } from '../shared/constants.js';
import { toAppError } from '../shared/errors.js';
import { CATEGORY_INFO } from '../shared/settings-schema.js';
import { EventBus } from './core/EventBus.js';
import { Logger } from './core/Logger.js';
import { ErrorHandler } from './core/ErrorHandler.js';
import { StorageManager } from './services/StorageManager.js';
import { SettingsStore } from './services/SettingsStore.js';
import { ThemeStore } from './services/ThemeStore.js';
import { HistoryStore } from './services/HistoryStore.js';
import { ScriptRepository } from './services/ScriptRepository.js';
import { CapabilityDetector } from './services/CapabilityDetector.js';
import { RuntimeSupervisor } from './services/RuntimeSupervisor.js';
import { LuauAnalysisService } from './services/LuauAnalysisService.js';
import { PluginManager } from './services/PluginManager.js';
import { BuildService, PROJECT_ROOT } from './BuildService.js';
import { SseHub } from './api/SseHub.js';
import { ApiRouter } from './api/ApiRouter.js';
import { StaticServer } from './http/StaticServer.js';
import { registerSystemRoutes } from './api/routes/system.routes.js';
import { registerScriptRoutes } from './api/routes/scripts.routes.js';
import { registerRuntimeRoutes } from './api/routes/runtime.routes.js';
import { registerEditorRoutes } from './api/routes/editor.routes.js';
import { registerConfigRoutes } from './api/routes/config.routes.js';
import { registerPluginRoutes } from './api/routes/plugins.routes.js';
import { ScriptCategory } from '../shared/constants.js';

export class AppContext {
  constructor({ options = {} } = {}) {
    this.options = options;
    this.projectRoot = options.projectRoot ?? PROJECT_ROOT;
    this.dataRoot = path.resolve(options.dataDir ?? path.join(this.projectRoot, 'data'));
    this.publicDir = path.join(this.projectRoot, 'public');
    this.toolsDir = path.join(this.projectRoot, 'tools', 'bin');
    this.builtinPluginsDir = path.join(this.projectRoot, 'plugins');
    this.startedAt = Date.now();
    this.ready = false;
    this.initResults = [];

    this.bus = new EventBus({ label: 'AppEvents', recentLimit: 120 });
    this.logger = new Logger({
      directory: path.join(this.dataRoot, 'logs'),
      label: 'lumen',
      minLevel: options.logLevel ?? 'TRACE',
      mirrorToConsole: options.mirrorLogs !== false,
    });
    this.errorHandler = new ErrorHandler({
      logger: this.logger,
      bus: this.bus,
      onFatal: options.onFatal ?? null,
    });
    this.bus.on('log:entry', () => {}, { once: false });
    // Every log entry is also published so SSE clients receive it in real time.
    const originalLog = this.logger.log.bind(this.logger);
    this.logger.log = (level, message, meta) => {
      const entry = originalLog(level, message, meta);
      if (entry) this.bus.emit('log:entry', entry);
      return entry;
    };

    this.storage = new StorageManager({
      root: this.dataRoot,
      logger: this.logger,
      errorHandler: this.errorHandler,
      bus: this.bus,
      extraRoots: [this.projectRoot, os.homedir()],
    });
    this.history = new HistoryStore({
      storage: this.storage,
      logger: this.logger,
      errorHandler: this.errorHandler,
      bus: this.bus,
    });
    this.scripts = new ScriptRepository({
      storage: this.storage,
      history: this.history,
      logger: this.logger,
      errorHandler: this.errorHandler,
      bus: this.bus,
    });
    this.settings = new SettingsStore({
      storage: this.storage,
      logger: this.logger,
      errorHandler: this.errorHandler,
      bus: this.bus,
      capabilities: null,
    });
    this.themes = new ThemeStore({
      storage: this.storage,
      logger: this.logger,
      errorHandler: this.errorHandler,
      bus: this.bus,
    });
    this.capabilities = new CapabilityDetector({
      logger: this.logger,
      errorHandler: this.errorHandler,
      storage: this.storage,
      toolsDir: this.toolsDir,
    });
    this.settings.capabilities = this.capabilities;
    this.analysis = new LuauAnalysisService({
      logger: this.logger,
      errorHandler: this.errorHandler,
      capabilities: this.capabilities,
    });
    this.analysis.setSettings(this.settings);
    this.runtime = new RuntimeSupervisor({
      logger: this.logger,
      errorHandler: this.errorHandler,
      bus: this.bus,
      history: this.history,
      storage: this.storage,
      settings: this.settings,
      capabilities: this.capabilities,
      toolsDir: this.toolsDir,
      dataDir: this.dataRoot,
    });
    this.plugins = new PluginManager({
      storage: this.storage,
      logger: this.logger,
      errorHandler: this.errorHandler,
      bus: this.bus,
      builtinDir: fs.existsSync(this.builtinPluginsDir) ? this.builtinPluginsDir : null,
    });
    this.sse = new SseHub({
      logger: this.logger,
      errorHandler: this.errorHandler,
      bus: this.bus,
    });
    this.build = new BuildService({
      logger: this.logger,
      errorHandler: this.errorHandler,
      projectRoot: this.projectRoot,
      publicDir: this.publicDir,
    });
    this.router = new ApiRouter({
      logger: this.logger,
      errorHandler: this.errorHandler,
      prefix: '/api',
    });
    this.static = new StaticServer({
      roots: [
        { prefix: '/vendor', dir: path.join(this.publicDir, 'vendor') },
        { prefix: '/build', dir: path.join(this.publicDir, 'build') },
        { prefix: '', dir: this.publicDir },
      ],
      indexFile: path.join(this.publicDir, 'index.html'),
      logger: this.logger,
      errorHandler: this.errorHandler,
    });

    this.#registerRoutes();
    this.#registerCapabilityBridge();
  }

  #registerRoutes() {
    const ctx = {
      app: this,
      bus: this.bus,
      logger: this.logger,
      errorHandler: this.errorHandler,
      storage: this.storage,
      history: this.history,
      scripts: this.scripts,
      settings: this.settings,
      themes: this.themes,
      capabilities: this.capabilities,
      runtime: this.runtime,
      analysis: this.analysis,
      plugins: this.plugins,
      sse: this.sse,
      build: this.build,
      scriptCategories: { ...CATEGORY_INFO, ...ScriptCategory },
      shortcuts: null,
      commands: null,
    };
    this.routeContext = ctx;
    registerSystemRoutes(this.router, ctx);
    registerScriptRoutes(this.router, ctx);
    registerRuntimeRoutes(this.router, ctx);
    registerEditorRoutes(this.router, ctx);
    registerConfigRoutes(this.router, ctx);
    registerPluginRoutes(this.router, ctx);

    // Capability reports are mirrored into the event bus for the SSE stream.
    this.capabilities.onChange((entry) => {
      this.bus.emit('capabilities:changed', {
        id: entry.id,
        label: entry.label,
        scope: entry.scope,
        state: entry.state,
        available: entry.available,
        detail: entry.detail,
      });
    });
  }

  #registerCapabilityBridge() {
    // Runtime and analysis availability are surfaced as capabilities so the UI can gate
    // features with real, measured information.
    this.capabilities.registerMany([
      {
        id: CapabilityId.RUNTIME_STREAMING,
        label: 'Salida en vivo',
        description: 'La salida de los scripts se muestra mientras se produce.',
        dependency: 'motores con streaming (Luau WASM)',
        ttlMs: 20_000,
        check: async () => {
          const engines = await this.runtime.listEngines();
          const streamers = engines.filter((engine) => engine.available && engine.limits?.streaming);
          return streamers.length > 0
            ? { state: 'AVAILABLE', detail: `Transmisión en vivo mediante: ${streamers.map((engine) => engine.label).join(', ')}` }
            : { state: 'UNAVAILABLE', detail: 'Ningún motor disponible soporta transmisión incremental de salida' };
        },
      },
      {
        id: CapabilityId.RUNTIME_CANCEL,
        label: 'Cancelación de ejecuciones',
        description: 'Es posible detener un script en ejecución.',
        dependency: 'motores con cancelación (abort o SIGKILL)',
        ttlMs: 20_000,
        check: async () => {
          const engines = await this.runtime.listEngines();
          const cancelables = engines.filter((engine) => engine.available && engine.limits?.cancel);
          return cancelables.length > 0
            ? { state: 'AVAILABLE', detail: `Cancelación disponible en: ${cancelables.map((engine) => `${engine.label} (${engine.limits.cancelMode})`).join(', ')}` }
            : { state: 'UNAVAILABLE', detail: 'Ningún motor disponible permite cancelar una ejecución' };
        },
      },
      {
        id: CapabilityId.RUNTIME_TIMEOUT,
        label: 'Límite de tiempo',
        description: 'Un script puede detenerse automáticamente al exceder el tiempo configurado.',
        dependency: 'motores con límite de tiempo',
        ttlMs: 20_000,
        check: async () => {
          const engines = await this.runtime.listEngines();
          const bounded = engines.filter((engine) => engine.available && engine.limits?.timeout);
          return bounded.length > 0
            ? { state: 'AVAILABLE', detail: `Límite de tiempo soportado por: ${bounded.map((engine) => engine.label).join(', ')}` }
            : { state: 'UNAVAILABLE', detail: 'Ningún motor disponible puede imponer un límite de tiempo' };
        },
      },
      {
        id: CapabilityId.RUNTIME_MEMORY_LIMIT,
        label: 'Límite de memoria',
        description: 'El estado de Lua puede limitarse a una cantidad de memoria concreta.',
        dependency: 'motores con memoryLimitBytes',
        ttlMs: 20_000,
        check: async () => {
          const engines = await this.runtime.listEngines();
          const bounded = engines.filter((engine) => engine.available && engine.limits?.memoryLimit);
          return bounded.length > 0
            ? { state: 'AVAILABLE', detail: `Límite de memoria soportado por: ${bounded.map((engine) => engine.label).join(', ')}` }
            : {
              state: 'UNAVAILABLE',
              detail: 'El motor de Lua 5.4 usa un módulo WASM con memoria fija: el límite configurable solo aplica al runtime de Luau.',
            };
        },
      },
    ]);
  }

  /** Ordered initialisation. Returns a detailed report of every step. */
  async init({ buildIfNeeded = true, watch = false, checkNetwork = null } = {}) {
    const steps = [];
    const step = async (name, fn, { critical = false } = {}) => {
      const started = Date.now();
      try {
        const result = await fn();
        steps.push({ name, ok: true, ms: Date.now() - started, result: summarize(result) });
        return result;
      } catch (err) {
        const appError = toAppError(err, { kind: ErrorKind.INTERNAL, message: `El paso "${name}" falló` });
        this.errorHandler.report(appError, { source: `AppContext.init.${name}` });
        steps.push({ name, ok: false, ms: Date.now() - started, error: appError.toJSON(), critical });
        if (critical) throw appError;
        return null;
      }
    };

    this.errorHandler.installProcessGuards();
    const logInfo = await step('logger', () => this.logger.openFile(), { critical: false });
    this.logger.info(`${APP.name} ${APP.version} iniciando…`, {
      source: 'AppContext',
      data: { node: process.version, platform: process.platform, dataRoot: this.dataRoot, logFile: logInfo?.path ?? null },
    });

    await step('storage', () => this.storage.init(), { critical: true });
    await step('history', () => this.history.load());
    await step('settings', () => this.settings.load());
    await step('themes', () => this.themes.load());
    await step('scripts', () => this.scripts.load());
    await step('plugins', () => this.plugins.load());

    const networkEnabled = checkNetwork ?? this.#networkCheckEnabled();
    await step('capabilities', () => this.capabilities.detectAll({ force: true, checkNetwork: networkEnabled }));

    this.sse.subscribeToBus();

    if (buildIfNeeded) {
      await step('build', async () => {
        if (!this.build.needsRebuild()) {
          const verification = await this.build.verify();
          if (verification.ok) return { skipped: true, verification };
        }
        const result = await this.build.build({ minify: !watch, sourcemap: true });
        if (!result.ok) throw result.error;
        return result;
      }, { critical: true });
    }
    if (watch) {
      this.buildWatcher = await step('build-watch', () => this.build.watch());
    }

    await step('storage-watch', async () => {
      if (this.settings.get('storage.watchExternalChanges') !== true) return { skipped: true, reason: 'desactivado en Ajustes' };
      const capability = this.capabilities.get(CapabilityId.FILE_SYSTEM_WATCH);
      if (capability && !capability.available) return { skipped: true, reason: capability.detail };
      return this.#startStorageWatcher();
    });

    this.ready = true;
    this.initResults = steps;
    this.bus.emit('app:ready', { steps: steps.map((entry) => ({ name: entry.name, ok: entry.ok, ms: entry.ms })) });
    this.logger.success(`${APP.name} listo (${steps.filter((entry) => entry.ok).length}/${steps.length} pasos correctos)`, { source: 'AppContext' });
    return { ok: steps.every((entry) => entry.ok || !entry.critical), steps };
  }

  #networkCheckEnabled() {
    try {
      return this.settings.get('storage.checkNetwork') === true;
    } catch {
      return false;
    }
  }

  #startStorageWatcher() {
    const watcher = this.storage.watch('scripts', (event) => {
      this.bus.emit('scripts:external-change', event);
      this.sse.broadcast(SseEvent.SCRIPT_CHANGED, { reason: 'external', file: event.filename, eventType: event.eventType });
    });
    if (!watcher) return { ok: false, reason: 'fs.watch no disponible' };
    this.storageWatcher = watcher;
    watcher.on('close', () => {
      if (this.storageWatcher === watcher) this.storageWatcher = null;
    });
    return { ok: true };
  }

  /** Health payload used by /api/health and the CLI banner. */
  health() {
    return {
      ready: this.ready,
      uptimeMs: Date.now() - this.startedAt,
      capabilities: this.capabilities.summary(),
      runtimeState: this.runtime.status().state,
      scripts: this.scripts.stats().total,
      plugins: this.plugins.stats(),
      storage: { root: this.storage.root, writable: this.storage.status.writable },
      build: { builtAt: this.build.builtAt, error: this.build.lastError },
      dialiects: Object.values(Dialect),
    };
  }

  /** Graceful shutdown: stops streaming, cancels executions and flushes pending writes. */
  async shutdown({ reason = 'shutdown' } = {}) {
    this.logger.info(`Cierre solicitado (${reason})`, { source: 'AppContext' });
    const results = [];
    const attempt = async (name, fn) => {
      try {
        await fn();
        results.push({ name, ok: true });
      } catch (err) {
        results.push({ name, ok: false, message: toAppError(err).message });
      }
    };

    await attempt('sse', () => this.sse.closeAll('La aplicación se está deteniendo'));
    await attempt('runtime', () => this.runtime.shutdown());
    await attempt('build-watch', async () => {
      await this.buildWatcher?.close?.();
    });
    await attempt('storage-watch', async () => {
      this.storageWatcher?.close?.();
    });
    await attempt('analysis', () => this.analysis.dispose());
    await attempt('history', () => this.history.flush());
    await attempt('settings', () => this.settings.persist());
    await attempt('logger', () => this.logger.close());
    this.ready = false;
    return { ok: results.every((entry) => entry.ok), results };
  }

  /** Real diagnostics bundle (used by `npm run doctor` and the About view). */
  async diagnostics() {
    return {
      app: { name: APP.name, version: APP.version, startedAt: this.startedAt },
      init: this.initResults,
      health: this.health(),
      capabilities: {
        summary: this.capabilities.summary(),
        entries: this.capabilities.snapshot(),
      },
      engines: await this.runtime.listEngines(),
      runtime: this.runtime.stats(),
      analysis: this.analysis.stats(),
      storage: await this.storage.describe(),
      plugins: this.plugins.stats(),
      build: this.build.stats(),
      api: this.router.stats(),
      errors: this.errorHandler.stats(),
    };
  }

  static status = HttpStatus;
}

function summarize(result) {
  if (result === null || result === undefined) return null;
  if (typeof result !== 'object') return result;
  const keys = ['ok', 'count', 'total', 'skipped', 'reason', 'builtAt', 'durationMs', 'path', 'status'];
  const output = {};
  for (const key of keys) {
    if (key in result) output[key] = result[key];
  }
  return Object.keys(output).length > 0 ? output : { keys: Object.keys(result).slice(0, 6) };
}
