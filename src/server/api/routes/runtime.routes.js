/**
 * Runtime routes — engines, execution, cancellation, status and history.
 *
 * The execution endpoint performs the whole real flow: engine resolution, execution with
 * limits, cancellation support, history recording. Streaming output is delivered out of band
 * through the SSE channel (`runtime.output`), not through this response.
 */

import { Dialect, Limits, RuntimeState } from '../../../shared/constants.js';
import { errors } from '../../../shared/errors.js';
import { expectString, normalizeExecutionRequest } from '../../../shared/protocol.js';

export function registerRuntimeRoutes(router, ctx) {
  const { runtime, history, capabilities, bus } = ctx;

  router.get('/runtime/engines', async ({ query }) => ({
    engines: await runtime.engineReport({ force: query.force === 'true' }),
    state: runtime.status().state,
  }), { description: 'Motores disponibles con límites reales y disponibilidad medida' });

  router.get('/runtime/status', () => runtime.status(), { description: 'Estado actual del runtime (ejecuciones activas, cola)' });

  router.get('/runtime/stats', () => ({ stats: runtime.stats(), status: runtime.status() }), { description: 'Estadísticas de ejecución' });

  router.post('/runtime/execute', async ({ body, clientId }) => {
    const request = normalizeExecutionRequest(body ?? {});
    runtime.setExecutionOrigin({
      scriptId: body?.scriptId ?? null,
      scriptName: request.options.scriptName ?? null,
    });
    const startedAt = Date.now();
    const result = await runtime.execute({
      source: request.source,
      dialect: request.dialect,
      engineId: request.engineId,
      options: request.options,
      origin: { clientId, channel: 'api', scriptId: body?.scriptId ?? null, scriptName: request.options.scriptName ?? null },
    });
    const payload = {
      execution: result,
      requestedEngine: request.engineId,
      wallMs: Date.now() - startedAt,
    };
    if (!result.ok && result.state === RuntimeState.UNAVAILABLE) {
      // The HTTP status mirrors the real outcome so clients cannot mistake it for success.
      throw errors.unavailable('La ejecución', result.error?.detail?.requirement ?? 'motor de ejecución', {
        executionId: result.executionId,
        dialect: request.dialect,
        engineDetail: result.error?.message,
        engines: (await runtime.listEngines()).map((engine) => ({ id: engine.id, state: engine.state, detail: engine.detail })),
      });
    }
    return payload;
  }, { body: true, description: 'Ejecuta código y devuelve el resultado real' });

  router.post('/runtime/cancel', async ({ body }) => {
    const executionId = expectString(body?.executionId ?? '', 'executionId', { min: 1, max: 64, allowEmpty: false });
    const outcome = await runtime.cancel(executionId);
    if (!outcome.stopped) {
      return { ok: false, executionId, reason: outcome.reason, state: runtime.status().state };
    }
    bus.emit('runtime:cancel-requested', { executionId, source: 'api' });
    return { ok: true, executionId, reason: null };
  }, { body: true, description: 'Cancela una ejecución activa' });

  router.post('/runtime/cancel-all', async () => ({
    cancelled: await runtime.cancelAll(),
    status: runtime.status(),
  }), { body: true, description: 'Cancela todas las ejecuciones activas' });

  router.post('/runtime/validate', async ({ body }) => {
    // Real syntax/type validation without executing anything: uses the Luau analyser.
    const request = normalizeExecutionRequest({ ...body, source: body?.source ?? ' ' });
    if (request.dialect !== Dialect.LUAU) {
      return {
        dialect: request.dialect,
        supported: false,
        message: 'La validación previa con el analizador de Luau solo aplica al dialecto Luau; para Lua 5.4 la comprobación se realiza al ejecutar.',
        diagnostics: [],
      };
    }
    const result = await ctx.analysis.check({
      module: body?.scriptName ? `${body.scriptName}.luau` : 'main.luau',
      source: body?.source ?? '',
    });
    return { dialect: request.dialect, supported: true, diagnostics: result.diagnostics, durationMs: result.durationMs };
  }, { body: true, description: 'Analiza el código sin ejecutarlo (tipos + lint)' });

  router.get('/runtime/history', ({ query }) => {
    const limit = query.limit ? Math.min(Number.parseInt(query.limit, 10) || 100, Limits.maxHistoryEntries) : 100;
    return {
      executions: history.list({ limit, kind: 'execution' }),
      stats: history.stats(),
    };
  }, { description: 'Historial de ejecuciones reales' });

  router.delete('/runtime/history', async () => {
    const result = await history.clear();
    bus.emit('history:cleared', result);
    return result;
  }, { description: 'Vacía el historial de ejecuciones y actividad' });

  router.get('/runtime/limits', () => ({
    limits: {
      timeoutMs: { min: Limits.minTimeoutMs, max: Limits.maxTimeoutMs, default: Limits.defaultTimeoutMs },
      memoryLimitBytes: { min: Limits.minMemoryLimitBytes, max: Limits.maxMemoryLimitBytes, default: Limits.defaultMemoryLimitBytes },
      outputLimitBytes: { min: 1024, max: 16 * 1024 * 1024, default: Limits.defaultOutputLimitBytes },
      maxSourceBytes: Limits.maxSourceBytes,
      maxConsoleEntries: Limits.maxConsoleEntries,
    },
    capabilities: capabilities.availabilityMap(),
  }), { description: 'Límites realmente aplicables por los motores' });
}
