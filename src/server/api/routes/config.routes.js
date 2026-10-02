/**
 * Configuration routes — settings, themes, session/layout persistence.
 */

import { ErrorKind } from '../../../shared/constants.js';
import { errors } from '../../../shared/errors.js';
import { expectString } from '../../../shared/protocol.js';
import { SETTINGS_SCHEMA, SettingsCategory, validateSettingValue, SETTINGS_BY_KEY } from '../../../shared/settings-schema.js';
import { THEME_TOKENS } from '../../../shared/themes.js';

const SESSION_FILE = 'meta/session.json';
const LAYOUT_FILE = 'meta/layout.json';

export function registerConfigRoutes(router, ctx) {
  const { settings, themes, storage, bus, capabilities, analysis, sse } = ctx;

  /* ----------------------------- SETTINGS ----------------------------- */

  router.get('/settings', async () => settings.getPublic(), { description: 'Esquema + valores + disponibilidad de cada ajuste' });

  router.get('/settings/values', () => ({ values: settings.getValues() }), { description: 'Valores actuales de la configuración' });

  router.get('/settings/schema', () => ({
    schema: SETTINGS_SCHEMA,
    categories: Object.values(SettingsCategory),
  }), { description: 'Esquema completo de configuración' });

  router.put('/settings', async ({ body }) => {
    const patch = body?.values && typeof body.values === 'object' ? body.values : body;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw errors.invalid('El cuerpo debe ser un objeto de pares clave/valor', { received: typeof body });
    }
    // `set()` is transactional: it throws (with `detail.errors`) when any value is rejected.
    const result = await settings.set(patch);
    if (Array.isArray(result.changed)) {
      await applySideEffects(result.changed, { settings, analysis, capabilities, bus, sse });
    }
    return { ...result, values: settings.getValues() };
  }, { body: true, description: 'Actualiza uno o varios ajustes (todo o nada, con validación)' });

  router.post('/settings/validate', ({ body }) => {
    const patch = body?.values && typeof body.values === 'object' ? body.values : body;
    const results = [];
    for (const [key, value] of Object.entries(patch ?? {})) {
      const definition = SETTINGS_BY_KEY[key];
      if (!definition) {
        results.push({ key, ok: false, message: 'Configuración desconocida' });
        continue;
      }
      const validation = validateSettingValue(definition, value);
      results.push({ key, ok: validation.ok, message: validation.ok ? null : validation.message, value: validation.ok ? validation.value : undefined });
    }
    return { results, valid: results.every((entry) => entry.ok) };
  }, { body: true, description: 'Valida valores sin aplicarlos' });

  router.post('/settings/reset', async ({ body }) => {
    if (body?.category) {
      const result = await settings.resetCategory(expectString(body.category, 'category', { max: 40, allowEmpty: false }));
      return { ...result, values: settings.getValues() };
    }
    if (!body || Object.keys(body).length === 0) {
      const result = await settings.reset({ all: true });
      return { ...result, values: settings.getValues() };
    }
    const result = await settings.reset({ key: body?.key ? expectString(body.key, 'key', { max: 80, allowEmpty: false }) : null });
    return { ...result, values: settings.getValues() };
  }, { body: true, description: 'Restaura valores por defecto (global, por categoría o por clave)' });

  router.get('/settings/export', async ({ sendRaw }) => {
    const payload = await settings.exportValues();
    sendRaw(JSON.stringify(payload, null, 2), {
      contentType: 'application/json; charset=utf-8',
      filename: 'lumen-settings.json',
    });
    return undefined;
  }, { description: 'Exporta la configuración como archivo JSON' });

  router.post('/settings/import', async ({ body }) => {
    const result = await settings.importValues(body?.config ?? body);
    return { ...result, values: settings.getValues() };
  }, { body: true, description: 'Importa configuración validada' });

  /* ------------------------------ THEMES ------------------------------ */

  router.get('/themes', () => ({
    themes: themes.list(),
    active: settings.get('appearance.theme'),
    accent: settings.get('appearance.accentColor'),
    problems: themes.loadProblems,
    tokenGroups: THEME_TOKENS,
  }), { description: 'Temas disponibles (integrados y personalizados)' });

  router.get('/themes/active', () => {
    const activeId = settings.get('appearance.theme');
    const theme = themes.get(activeId) ?? themes.get(themes.fallbackId());
    return {
      theme,
      requestedId: activeId,
      fellBack: theme.id !== activeId,
      accent: settings.get('appearance.accentColor'),
    };
  }, { description: 'Tema activo con su paleta completa' });

  router.get('/themes/:id', ({ params }) => ({ theme: themes.require(params.id) }), { description: 'Un tema por identificador' });

  router.post('/themes', async ({ body }) => {
    const result = await themes.save(body?.theme ?? body);
    return result;
  }, { body: true, description: 'Crea o actualiza un tema personalizado' });

  router.delete('/themes/:id', async ({ params }) => themes.remove(params.id), { description: 'Elimina un tema personalizado' });

  router.post('/themes/import', async ({ body }) => {
    const text = typeof body?.content === 'string'
      ? body.content
      : JSON.stringify(body?.theme ?? body ?? {});
    return themes.import(text);
  }, { body: true, description: 'Importa un tema desde JSON' });

  router.get('/themes/:id/export', async ({ params, sendRaw }) => {
    const payload = await themes.export(params.id);
    sendRaw(payload.content, { contentType: 'application/json; charset=utf-8', filename: payload.filename });
    return undefined;
  }, { description: 'Exporta un tema como JSON' });

  router.post('/themes/apply', async ({ body }) => {
    const id = expectString(body?.id ?? '', 'id', { min: 1, max: 60, allowEmpty: false });
    const theme = themes.require(id);
    const result = await settings.set({ 'appearance.theme': theme.id });
    return { ok: true, theme, changed: result.changed ?? [] };
  }, { body: true, description: 'Activa un tema (persistido en la configuración)' });

  /* --------------------- SESSION / LAYOUT PERSISTENCE --------------------- */

  router.get('/session', async () => {
    const result = await storage.readJson(SESSION_FILE, { fallback: { version: 1, session: null } });
    return { session: result.value?.session ?? null, recovered: result.recovered, corruptPath: result.corruptPath };
  }, { description: 'Sesión persistida (pestañas, cursores, vista activa)' });

  router.put('/session', async ({ body }) => {
    const session = body?.session ?? body;
    if (!session || typeof session !== 'object') {
      throw errors.invalid('La sesión debe ser un objeto', { received: typeof session });
    }
    const serialized = JSON.stringify(session);
    if (serialized.length > 4 * 1024 * 1024) {
      throw errors.invalid('La sesión excede el tamaño máximo de 4 MB', { bytes: serialized.length });
    }
    await storage.writeJson(SESSION_FILE, { version: 1, updatedAt: Date.now(), session });
    bus.emit('session:saved', { bytes: serialized.length });
    return { ok: true, bytes: serialized.length, savedAt: Date.now() };
  }, { body: true, description: 'Guarda la sesión actual' });

  router.delete('/session', async () => {
    await storage.remove(SESSION_FILE, { soft: true });
    return { ok: true, removed: true };
  }, { description: 'Elimina la sesión guardada' });

  router.get('/layout', async () => {
    const result = await storage.readJson(LAYOUT_FILE, { fallback: { version: 1, layout: null } });
    return { layout: result.value?.layout ?? null };
  }, { description: 'Disposición de paneles persistida' });

  router.put('/layout', async ({ body }) => {
    const layout = body?.layout ?? body;
    if (!layout || typeof layout !== 'object') {
      throw errors.invalid('La disposición debe ser un objeto', { received: typeof layout });
    }
    await storage.writeJson(LAYOUT_FILE, { version: 1, updatedAt: Date.now(), layout });
    return { ok: true, savedAt: Date.now() };
  }, { body: true, description: 'Guarda la disposición de la interfaz' });

  /* ------------------------- STORAGE MAINTENANCE ------------------------- */

  router.get('/storage/info', async () => ({
    storage: await storage.describe(),
    settingsFile: storage.relativeToRoot(storage.resolveSafe('meta/settings.json')),
    themesDir: storage.relativeToRoot(storage.dirs.themes),
    scriptsDir: storage.relativeToRoot(storage.dirs.scripts),
    backupsDir: storage.relativeToRoot(storage.dirs.backups),
    trashDir: storage.relativeToRoot(storage.dirs.trash),
  }), { description: 'Información real del almacenamiento en disco' });

  router.get('/storage/backups', async () => {
    const entries = await storage.list('backups', { depth: 2, includeFiles: true, maxEntries: 500 });
    return { entries: entries.map((entry) => ({ ...entry, path: storage.relativeToRoot(entry.path) })) };
  }, { description: 'Respaldo disponible en disco' });

  router.get('/storage/trash', async () => {
    const entries = await storage.list('trash', { depth: 1, includeFiles: true, maxEntries: 500 });
    return { entries: entries.map((entry) => ({ ...entry, path: storage.relativeToRoot(entry.path) })) };
  }, { description: 'Archivos en la papelera' });

  router.post('/storage/clear-trash', async () => {
    const entries = await storage.list('trash', { depth: 1, includeFiles: true, maxEntries: 1000 });
    let removed = 0;
    const failures = [];
    for (const entry of entries) {
      try {
        await storage.remove(storage.relativeToRoot(entry.path), { soft: false });
        removed += 1;
      } catch (err) {
        failures.push({ path: entry.path, message: err.message });
      }
    }
    return { removed, failures };
  }, { body: true, description: 'Vacía la papelera de forma real' });

  router.get('/files/read', async ({ query }) => {
    const target = expectString(query.path ?? '', 'path', { min: 1, max: 1024, allowEmpty: false });
    const content = await storage.readText(target, { fallback: null, allowAbsolute: query.absolute === 'true' });
    if (content === null) throw errors.notFound(`El archivo ${target}`, { path: target, kind: ErrorKind.STORAGE });
    const stat = await storage.stat(target, { allowAbsolute: query.absolute === 'true' });
    return { path: target, content, stat };
  }, { description: 'Lee un archivo dentro de las raíces permitidas' });

  router.put('/files/write', async ({ body }) => {
    const target = expectString(body?.path ?? '', 'path', { min: 1, max: 1024, allowEmpty: false });
    const content = expectString(body?.content ?? '', 'content', { max: 2 * 1024 * 1024 });
    const result = await storage.writeText(target, content, { allowAbsolute: body?.absolute === 'true' });
    return { ok: true, path: storage.relativeToRoot(result.path), bytes: result.bytes, created: result.created };
  }, { body: true, description: 'Escribe un archivo (atómico, con respaldo)' });
}

/** Side effects that must run when specific settings change. */
async function applySideEffects(changed, { settings, analysis, capabilities, bus, sse }) {
  if (changed.some((key) => key.startsWith('editor.analysis'))) {
    await analysis.reconfigure().catch(() => {});
  }
  if (changed.includes('execution.allowNativeEngines')) {
    const engines = await (async () => {
      try {
        return await capabilities.detect({ ids: ['runtime.luau:native', 'runtime.lua54:native'], force: true });
      } catch {
        return [];
      }
    })();
    sse?.broadcast('capabilities', { reason: 'settings', entries: engines });
  }
  if (changed.includes('storage.checkNetwork')) {
    const enabled = settings.get('storage.checkNetwork') === true;
    const entries = await capabilities.detect({ ids: ['http'], force: enabled }).catch(() => []);
    sse?.broadcast('capabilities', { reason: 'settings', entries });
  }
  bus.emit('settings:side-effects', { changed });
}
