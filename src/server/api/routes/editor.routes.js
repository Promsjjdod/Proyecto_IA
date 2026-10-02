/**
 * Editor routes — the real Luau analysis engine exposed to the editor.
 *
 * The client uses these endpoints for type diagnostics, completion, hover documentation
 * and type decoration. When the analyser is unavailable the endpoints answer with a real
 * 503 + explanation (never with fake empty success), so the UI can show "Unavailable" and
 * fall back to the built-in parser.
 */

import { CapabilityId, Dialect } from '../../../shared/constants.js';
import { errors } from '../../../shared/errors.js';
import { expectNumber, expectString } from '../../../shared/protocol.js';

export function registerEditorRoutes(router, ctx) {
  const { analysis, capabilities, shortcuts, commands } = ctx;

  const requireAnalysis = () => {
    const entry = capabilities.get(CapabilityId.ANALYSIS_TYPES);
    if (entry && entry.available === false) {
      throw errors.unavailable('El analizador de Luau', entry.detail ?? 'dependencia ausente', {
        capability: CapabilityId.ANALYSIS_TYPES,
        state: entry.state,
      });
    }
  };

  router.get('/editor/analysis/status', async () => ({
    state: capabilities.get(CapabilityId.ANALYSIS_TYPES) ?? null,
    stats: analysis.stats(),
  }), { description: 'Estado del analizador de Luau' });

  router.post('/editor/analysis/check', async ({ body }) => {
    const source = expectString(body?.source ?? '', 'source', { max: 2 * 1024 * 1024 });
    const module = expectString(body?.module ?? 'main.luau', 'module', { max: 200, allowEmpty: false });
    const mode = body?.mode === undefined ? undefined : expectString(body.mode, 'mode', { max: 20 });
    requireAnalysis();
    const result = await analysis.check({ module, source, mode: mode ?? null, lint: body?.lint ?? null });
    return result;
  }, { body: true, description: 'Analiza tipos y lint de un módulo Luau' });

  router.post('/editor/analysis/complete', async ({ body }) => {
    const source = expectString(body?.source ?? '', 'source', { max: 2 * 1024 * 1024 });
    const module = expectString(body?.module ?? 'main.luau', 'module', { max: 200, allowEmpty: false });
    const line = expectNumber(body?.line ?? 0, 'line', { min: 0, max: 1_000_000, integer: true });
    const character = expectNumber(body?.character ?? 0, 'character', { min: 0, max: 100_000, integer: true });
    requireAnalysis();
    return analysis.complete({ module, source, line, character });
  }, { body: true, description: 'Autocompletado real del motor de Luau' });

  router.post('/editor/analysis/hover', async ({ body }) => {
    const source = expectString(body?.source ?? '', 'source', { max: 2 * 1024 * 1024 });
    const module = expectString(body?.module ?? 'main.luau', 'module', { max: 200, allowEmpty: false });
    const line = expectNumber(body?.line ?? 0, 'line', { min: 0, max: 1_000_000, integer: true });
    const character = expectNumber(body?.character ?? 0, 'character', { min: 0, max: 100_000, integer: true });
    requireAnalysis();
    return analysis.documentation({ module, source, line, character });
  }, { body: true, description: 'Documentación y tipo del símbolo bajo el cursor' });

  router.post('/editor/analysis/type-at', async ({ body }) => {
    const source = expectString(body?.source ?? '', 'source', { max: 2 * 1024 * 1024 });
    const module = expectString(body?.module ?? 'main.luau', 'module', { max: 200, allowEmpty: false });
    const line = expectNumber(body?.line ?? 0, 'line', { min: 0, max: 1_000_000, integer: true });
    const character = expectNumber(body?.character ?? 0, 'character', { min: 0, max: 100_000, integer: true });
    requireAnalysis();
    return analysis.typeAt({ module, source, line, character });
  }, { body: true, description: 'Tipo inferido en una posición' });

  router.post('/editor/analysis/decorate', async ({ body }) => {
    const source = expectString(body?.source ?? '', 'source', { max: 2 * 1024 * 1024 });
    const module = expectString(body?.module ?? 'main.luau', 'module', { max: 200, allowEmpty: false });
    requireAnalysis();
    return analysis.decorate({ module, source });
  }, { body: true, description: 'Añade anotaciones de tipo inferidas al código' });

  router.post('/editor/analysis/modules', async ({ body }) => {
    const source = expectString(body?.source ?? '', 'source', { max: 2 * 1024 * 1024 });
    const module = expectString(body?.module ?? 'main.luau', 'module', { max: 200, allowEmpty: false });
    requireAnalysis();
    return analysis.requiredModules({ module, source });
  }, { body: true, description: 'Módulos requeridos y tipo de retorno del módulo' });

  router.post('/editor/analysis/mode', async ({ body }) => {
    const mode = expectString(body?.mode ?? '', 'mode', { max: 20, allowEmpty: false });
    if (!['nocheck', 'nonstrict', 'strict'].includes(mode)) {
      throw errors.invalid('El modo debe ser nocheck, nonstrict o strict', { received: mode });
    }
    const result = await analysis.check({ module: 'mode-probe.luau', source: 'return 1', mode, lint: undefined });
    return { mode: result.mode, applied: true };
  }, { body: true, description: 'Cambia el modo de análisis del motor' });

  router.post('/editor/analysis/cache/clear', () => analysis.clearCache(), { body: true, description: 'Vacía la caché de análisis' });

  router.get('/editor/shortcuts', () => ({
    shortcuts: shortcuts?.describe?.() ?? [],
    commands: commands?.ids?.() ?? [],
  }), { description: 'Atajos y comandos registrados (referencia del cliente)' });

  router.get('/editor/dialects', () => ({
    dialects: Object.values(Dialect),
  }), { description: 'Dialectos soportados' });
}
