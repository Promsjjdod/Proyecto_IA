/**
 * System routes — health, capabilities, diagnostics, logs, statistics and activity.
 *
 * Everything returned here is measured: process metrics come from `process`, capability
 * entries from real probes, statistics from the runtime supervisor's own counters and
 * incident lists from the ErrorHandler. Nothing is estimated or invented.
 */

import os from 'node:os';
import path from 'node:path';
import { APP, CapabilityScope, SseEvent } from '../../../shared/constants.js';
import { errors } from '../../../shared/errors.js';

export function registerSystemRoutes(router, ctx) {
  const { capabilities, runtime, history, errorHandler, logger, storage, analysis, plugins, app, sse, scripts } = ctx;

  router.get('/health', () => ({
    ok: true,
    app: { name: APP.name, version: APP.version, id: APP.id },
    startedAt: app.startedAt,
    uptimeMs: Date.now() - app.startedAt,
    pid: process.pid,
    node: process.version,
  }), { description: 'Estado básico del servidor' });

  router.get('/capabilities', async ({ query }) => {
    const force = query.force === 'true';
    await capabilities.detect({ force });
    return {
      summary: capabilities.summary(),
      entries: capabilities.snapshot(),
      scope: CapabilityScope.SERVER,
    };
  }, { description: 'Capacidades detectadas realmente en el servidor' });

  router.get('/capabilities/engines', async ({ query }) => ({
    engines: await runtime.engineReport({ force: query.force === 'true' }),
  }), { description: 'Motores de ejecución con su disponibilidad medida' });

  /** The browser reports its own capabilities so the UI shows one merged, truthful view. */
  router.post('/capabilities/report', ({ body }) => {
    if (!Array.isArray(body?.entries)) {
      throw errors.invalid('El informe de capacidades debe incluir una lista "entries"', { received: typeof body?.entries });
    }
    const merged = capabilities.mergeExternal(body.entries, { scope: body.scope ?? CapabilityScope.BROWSER });
    ctx.bus.emit('capabilities:changed', { reason: 'client-report', count: merged.length });
    sse.broadcast(SseEvent.CAPABILITIES, { reason: 'client-report', entries: merged });
    return { ok: true, merged: merged.length, summary: capabilities.summary() };
  }, { body: true, description: 'Registra las capacidades detectadas por el navegador' });

  router.get('/stats', async () => {
    const runtimeStatus = runtime.status();
    const analysisStats = analysis.stats();
    const storageDescription = await storage.describe();
    return {
      runtime: runtimeStatus,
      analysis: analysisStats,
      storage: {
        ...storageDescription,
        scriptsOnDisk: scripts.stats().total,
      },
      history: history.stats(),
      errors: errorHandler.stats(),
      plugins: plugins.stats(),
      capabilities: capabilities.summary(),
      api: router.stats(),
      sse: sse.stats(),
      process: processStats(),
      host: hostStats(),
      uptimeMs: Date.now() - app.startedAt,
      startedAt: app.startedAt,
    };
  }, { description: 'Estadísticas reales de todos los subsistemas' });

  router.get('/logs', ({ query }) => {
    const limit = clampInt(query.limit, 200, 1, 2000);
    const level = typeof query.level === 'string' && query.level !== '' ? query.level.toUpperCase() : null;
    return {
      entries: logger.recent(limit, level),
      file: logger.fileStatus,
      levels: ['TRACE', 'DEBUG', 'INFO', 'SUCCESS', 'WARNING', 'ERROR'],
    };
  }, { description: 'Registro en memoria del servidor (con estado del archivo de log)' });

  /**
   * Unified logging: the browser sends its own log entries (including UI incidents) here so
   * `data/logs/lumen.log` contains the complete session, and connected clients see them too.
   */
  router.post('/system/log', ({ body }) => {
    const level = typeof body?.level === 'string' ? body.level.toUpperCase() : 'INFO';
    const message = typeof body?.message === 'string' ? body.message.slice(0, 4000) : '';
    if (message === '') {
      throw errors.invalid('El registro necesita un mensaje', { received: Object.keys(body ?? {}) });
    }
    const entry = logger.log(
      ['TRACE', 'DEBUG', 'INFO', 'SUCCESS', 'WARNING', 'ERROR'].includes(level) ? level : 'INFO',
      message,
      {
        source: typeof body?.source === 'string' ? body.source.slice(0, 60) : 'cliente',
        file: typeof body?.file === 'string' ? body.file.slice(0, 400) : null,
        line: Number.isInteger(body?.line) ? body.line : null,
        data: body?.data && typeof body.data === 'object' ? body.data : null,
      },
    );
    ctx.bus.emit('log:entry', entry);
    return { ok: true, accepted: Boolean(entry) };
  }, { body: true, description: 'Registra una entrada de log enviada por el cliente' });

  router.get('/errors', ({ query }) => {
    const limit = clampInt(query.limit, 50, 1, 200);
    return {
      incidents: errorHandler.incidents(limit),
      stats: errorHandler.stats(),
    };
  }, { description: 'Incidentes de error registrados con su traza' });

  router.delete('/errors', () => ({ cleared: errorHandler.clear() }), { description: 'Vacía la lista de incidentes' });

  router.get('/activity', ({ query }) => {
    const limit = clampInt(query.limit, 100, 1, 500);
    const kind = typeof query.kind === 'string' && query.kind !== '' ? query.kind : null;
    return {
      records: history.list({ limit, kind }),
      stats: history.stats(),
    };
  }, { description: 'Actividad reciente (archivos y ejecuciones)' });

  router.get('/diagnostics', async () => {
    const engines = await runtime.listEngines();
    const capabilitySummary = capabilities.summary();
    const problems = [];
    for (const entry of capabilities.snapshot()) {
      if (!entry.available) {
        problems.push({
          id: entry.id,
          label: entry.label,
          scope: entry.scope,
          detail: entry.detail,
          dependency: entry.dependency,
        });
      }
    }
    return {
      app: { name: APP.name, version: APP.version, startedAt: app.startedAt, uptimeMs: Date.now() - app.startedAt },
      summary: capabilitySummary,
      engines,
      unavailable: problems,
      storage: await storage.describe(),
      routes: router.describe(),
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        electron: process.versions.electron ?? null,
        cwd: process.cwd(),
        dataRoot: storage.root,
        toolsDir: app.toolsDir ?? null,
        env: {
          LUMEN_DATA_DIR: process.env[APP.dataDirEnvVar] ?? null,
          LUMEN_PORT: process.env[APP.portEnvVar] ?? null,
        },
      },
      sse: sse.stats(),
    };
  }, { description: 'Diagnóstico completo: capacidades, motores, rutas y entorno' });

  router.post('/diagnostics/capabilities/refresh', async () => {
    const entries = await capabilities.detect({ force: true });
    const engines = await runtime.listEngines({ force: true });
    return { entries, engines };
  }, { description: 'Fuerza una nueva comprobación de capacidades y motores' });

  router.get('/workspace/tree', async ({ query }) => {
    const depth = clampInt(query.depth, 3, 1, 6);
    const target = typeof query.path === 'string' && query.path !== '' ? query.path : 'workspace';
    const entries = await storage.list(target, { depth, includeFiles: true, maxEntries: 3000 });
    return {
      root: storage.root,
      path: path.relative(storage.root, storage.resolveSafe(target)) || '.',
      absolute: storage.resolveSafe(target),
      entries: entries.map((entry) => ({ ...entry, path: path.relative(storage.root, entry.path) })),
    };
  }, { description: 'Árbol real de archivos del área de trabajo' });

  router.get('/routes', () => ({ routes: router.describe() }), { description: 'Tabla de rutas de la API' });
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function processStats() {
  const memory = process.memoryUsage();
  return {
    pid: process.pid,
    node: process.version,
    uptimeSeconds: Math.round(process.uptime()),
    memory: {
      rss: memory.rss,
      heapTotal: memory.heapTotal,
      heapUsed: memory.heapUsed,
      external: memory.external,
      arrayBuffers: memory.arrayBuffers ?? 0,
    },
    cpu: process.cpuUsage(),
    activeHandles: process._getActiveHandles?.().length ?? null,
    activeRequests: process._getActiveRequests?.().length ?? null,
  };
}

export function hostStats() {
  return {
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model ?? null,
    loadAverage: os.loadavg(),
    totalMemoryBytes: os.totalmem(),
    freeMemoryBytes: os.freemem(),
    systemUptimeSeconds: Math.round(os.uptime()),
    tmpDir: os.tmpdir(),
  };
}
