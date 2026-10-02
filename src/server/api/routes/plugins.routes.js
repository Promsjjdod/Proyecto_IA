/**
 * Plugin routes — discovery, enablement, entry-point delivery, installation and errors.
 */

import { PLUGIN_API } from '../../services/PluginManager.js';
import { errors } from '../../../shared/errors.js';
import { expectString, isPlainObject } from '../../../shared/protocol.js';

export function registerPluginRoutes(router, ctx) {
  const { plugins, bus } = ctx;

  router.get('/plugins', () => ({
    plugins: plugins.list(),
    stats: plugins.stats(),
    discoveryErrors: plugins.discoveryErrors(),
    api: PLUGIN_API,
  }), { description: 'Plugins detectados con su estado de dependencias' });

  router.get('/plugins/stats', () => ({ stats: plugins.stats(), api: PLUGIN_API }), { description: 'Resumen del sistema de plugins' });

  router.get('/plugins/:id', ({ params }) => {
    const plugin = plugins.get(params.id);
    if (!plugin) throw errors.notFound(`El plugin "${params.id}"`, { pluginId: params.id });
    return { plugin };
  }, { description: 'Detalles de un plugin' });

  /** The renderer fetches this to run the plugin inside a sandboxed Worker. */
  router.get('/plugins/:id/entry', async ({ params }) => {
    const entry = await plugins.getEntry(params.id);
    if (!plugins.isEnabled(params.id)) {
      throw errors.invalid(`El plugin "${params.id}" está desactivado`, { pluginId: params.id, enabled: false });
    }
    return entry;
  }, { description: 'Código del punto de entrada del plugin (para el host aislado)' });

  router.post('/plugins/:id/enable', async ({ params }) => {
    const plugin = await plugins.setEnabled(params.id, true);
    bus.emit('plugins:changed', { reason: 'enable', id: params.id });
    return { plugin };
  }, { body: true, description: 'Activa un plugin (valida dependencias)' });

  router.post('/plugins/:id/disable', async ({ params }) => {
    const plugin = await plugins.setEnabled(params.id, false);
    bus.emit('plugins:changed', { reason: 'disable', id: params.id });
    return { plugin };
  }, { body: true, description: 'Desactiva un plugin' });

  router.post('/plugins/:id/reload', async ({ params }) => ({ plugin: await plugins.reload(params.id) }), { body: true, description: 'Recarga un plugin desde disco' });

  router.post('/plugins/rescan', async () => ({ result: await plugins.rescan(), plugins: plugins.list() }), { body: true, description: 'Vuelve a escanear el directorio de plugins' });

  router.post('/plugins/install', async ({ body }) => {
    const files = body?.files;
    if (!isPlainObject(files)) {
      throw errors.invalid('La instalación necesita un objeto "files" con los archivos del plugin', { keys: Object.keys(body ?? {}) });
    }
    return plugins.install({
      id: body?.id ?? null,
      name: body?.name ?? null,
      files,
      source: typeof body?.source === 'string' ? body.source : null,
    });
  }, { body: true, description: 'Instala un plugin desde su contenido' });

  router.delete('/plugins/:id', async ({ params }) => plugins.uninstall(params.id), { description: 'Desinstala un plugin de usuario (a la papelera)' });

  router.post('/plugins/:id/errors', ({ params, body }) => {
    const record = plugins.reportError(params.id, {
      message: expectString(body?.message ?? 'Error sin mensaje', 'message', { max: 2000 }),
      stack: typeof body?.stack === 'string' ? body.stack.slice(0, 8000) : null,
    }, { phase: typeof body?.phase === 'string' ? body.phase : 'runtime' });
    return { ok: true, record };
  }, { body: true, description: 'Registra un error de plugin reportado por el cliente' });

  router.get('/plugins/api/permissions', () => ({ api: PLUGIN_API }), { description: 'Permisos y eventos de activación soportados' });
}
