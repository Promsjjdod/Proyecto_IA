/**
 * Script routes — real CRUD over the files on disk plus metadata, search, favourites,
 * history, import and export.
 */

import { Limits, SortMode } from '../../../shared/constants.js';
import { errors } from '../../../shared/errors.js';
import { expectString, expectStringArray, expectDialect, expectEnum, expectScriptId } from '../../../shared/protocol.js';

export function registerScriptRoutes(router, ctx) {
  const { scripts, history, storage, runtime, bus, sse } = ctx;

  router.get('/scripts', ({ query }) => {
    const tags = typeof query.tags === 'string' && query.tags !== '' ? query.tags.split(',').map((tag) => tag.trim()).filter(Boolean) : [];
    const records = scripts.list({
      query: query.q ?? '',
      category: query.category && query.category !== '' ? query.category : null,
      dialect: query.dialect && query.dialect !== '' ? query.dialect : null,
      tags,
      favoriteOnly: query.favorite === 'true',
      sort: Object.values(SortMode).includes(query.sort) ? query.sort : SortMode.MODIFIED_DESC,
      limit: query.limit ? Number.parseInt(query.limit, 10) : 500,
    });
    return { scripts: records, stats: scripts.stats(), sort: query.sort ?? SortMode.MODIFIED_DESC };
  }, { description: 'Lista de scripts con filtros, búsqueda y ordenamiento' });

  router.get('/scripts/stats', () => ({ stats: scripts.stats() }), { description: 'Estadísticas del repositorio de scripts' });

  router.get('/scripts/search', async ({ query }) => {
    const term = expectString(query.q ?? '', 'q', { min: 1, max: 200, allowEmpty: false });
    const inContent = query.content === 'true';
    return {
      query: term,
      results: inContent ? await scripts.searchContent(term, { limit: 60 }) : scripts.list({ query: term, limit: 60 }),
      searchedContent: inContent,
    };
  }, { description: 'Búsqueda por nombre/metadatos y, opcionalmente, dentro del contenido' });

  router.get('/scripts/:id', ({ params }) => ({ script: scripts.require(params.id) }), { description: 'Metadatos de un script' });

  router.get('/scripts/:id/content', async ({ params }) => {
    const { record, content } = await scripts.read(params.id);
    return {
      id: record.id,
      name: record.name,
      dialect: record.dialect,
      content,
      lines: content.split('\n').length,
      bytes: Buffer.byteLength(content, 'utf8'),
      checksum: record.checksum,
      updatedAt: record.updatedAt,
      metadata: record,
    };
  }, { description: 'Contenido y metadatos de un script' });

  router.post('/scripts', async ({ body }) => {
    const script = await scripts.create({
      name: expectString(body?.name ?? 'nuevo-script', 'name', { min: 1, max: 120, allowEmpty: false }),
      content: body?.content === undefined || body?.content === null ? null : expectString(body.content, 'content', { max: Limits.maxSourceBytes }),
      dialect: body?.dialect ? expectDialect(body.dialect) : undefined,
      category: body?.category ?? undefined,
      tags: expectStringArray(body?.tags ?? [], 'tags'),
      description: body?.description ?? '',
    });
    return { script, created: true };
  }, { body: true, description: 'Crea un script nuevo en disco' });

  router.put('/scripts/:id/content', async ({ params, body }) => {
    const content = expectString(body?.content ?? '', 'content', { max: Limits.maxSourceBytes });
    const result = await scripts.save(params.id, content, { expectedChecksum: body?.checksum ?? null });
    const execution = body?.recordExecution === true && body?.execution ? body.execution : null;
    if (execution) await scripts.recordRun(params.id, execution);
    return { script: result.record, bytes: result.bytes, path: storageRelative(ctx, result.path) };
  }, { body: true, description: 'Guarda el contenido de un script (escritura atómica + respaldo)' });

  router.patch('/scripts/:id', async ({ params, body }) => {
    const script = await scripts.updateMetadata(params.id, body ?? {});
    return { script };
  }, { body: true, description: 'Actualiza nombre, categoría, tags, favorito o descripción' });

  router.post('/scripts/:id/rename', async ({ params, body }) => ({
    script: await scripts.rename(params.id, expectString(body?.name ?? '', 'name', { min: 1, max: 120, allowEmpty: false })),
  }), { body: true, description: 'Renombra un script' });

  router.post('/scripts/:id/duplicate', async ({ params, body }) => ({
    script: await scripts.duplicate(params.id, { name: body?.name ? expectString(body.name, 'name', { max: 120 }) : null }),
  }), { body: true, description: 'Duplica un script' });

  router.post('/scripts/:id/favorite', async ({ params, body }) => {
    const favorite = body?.favorite;
    const current = scripts.require(params.id);
    const script = typeof favorite === 'boolean' && favorite === current.favorite
      ? current
      : await scripts.toggleFavorite(params.id);
    return { script };
  }, { body: true, description: 'Marca o desmarca un script como favorito' });

  router.delete('/scripts/:id', async ({ params, query }) => ({
    ...(await scripts.remove(params.id, { soft: query.hard !== 'true' })),
  }), { description: 'Elimina un script (a la papelera salvo hard=true)' });

  router.post('/scripts/:id/save-as', async ({ params, body }) => ({
    script: await scripts.saveAs(params.id, {
      name: expectString(body?.name ?? '', 'name', { min: 1, max: 120, allowEmpty: false }),
      dialect: body?.dialect ? expectDialect(body.dialect) : null,
    }),
  }), { body: true, description: 'Guarda una copia con otro nombre' });

  router.post('/scripts/import', async ({ body, params }) => {
    // Two real import paths: raw content, or a path inside an allow-listed root.
    if (body?.path) {
      const script = await scripts.importFromPath(expectString(body.path, 'path', { min: 1, max: 1024, allowEmpty: false }));
      return { script, source: 'path' };
    }
    if (typeof body?.content !== 'string') {
      throw errors.invalid('La importación necesita "content" o "path"', { received: Object.keys(body ?? {}) });
    }
    const script = await scripts.importScript({
      name: expectString(body?.name ?? 'importado.luau', 'name', { min: 1, max: 160, allowEmpty: false }),
      content: body.content,
      dialect: body?.dialect ? expectDialect(body.dialect) : null,
      category: body?.category ?? undefined,
      tags: expectStringArray(body?.tags ?? ['importado'], 'tags'),
    });
    return { script, source: 'content' };
  }, { body: true, description: 'Importa un script desde contenido o desde una ruta permitida' });

  router.get('/scripts/:id/export', async ({ params, sendRaw }) => {
    const payload = await scripts.exportPayload(params.id);
    sendRaw(payload.content, {
      contentType: 'text/plain; charset=utf-8',
      filename: payload.filename,
    });
    return undefined;
  }, { description: 'Descarga el script como archivo de texto' });

  router.post('/scripts/:id/export-to', async ({ params, body }) => {
    const target = expectString(body?.path ?? '', 'path', { min: 1, max: 1024, allowEmpty: false });
    const result = await scripts.exportToPath(params.id, target);
    return { ok: true, path: result.to };
  }, { body: true, description: 'Exporta el script a una ruta absoluta permitida' });

  router.post('/scripts/:id/run', async ({ params, body, clientId }) => {
    const { record, content } = await scripts.read(params.id);
    runtime.setExecutionOrigin({ scriptId: record.id, scriptName: record.name });
    const result = await runtime.execute({
      source: content,
      dialect: record.dialect,
      engineId: body?.engineId ?? null,
      options: {
        timeoutMs: body?.timeoutMs,
        memoryLimitBytes: body?.memoryLimitBytes ? body.memoryLimitBytes * 1024 * 1024 : undefined,
        outputLimitBytes: body?.outputLimitBytes,
        scriptName: record.name,
      },
      origin: { scriptId: record.id, scriptName: record.name, clientId, channel: 'api' },
    });
    if (result.ok || result.state !== 'UNAVAILABLE') {
      await scripts.recordRun(record.id, result);
    }
    return { execution: result, script: scripts.require(params.id) };
  }, { body: true, description: 'Ejecuta el script con el motor disponible' });

  /**
   * Records the outcome of an execution that happened in the browser (the server never saw it).
   * The client sends the real execution record; the repository updates run/error counters.
   */
  router.post('/scripts/:id/history', async ({ params, body }) => {
    const execution = body?.execution;
    if (!execution || typeof execution !== 'object' || typeof execution.state !== 'string') {
      throw errors.invalid('Se esperaba el registro real de una ejecución', { field: 'execution' });
    }
    const script = await scripts.recordRun(params.id, {
      ok: execution.ok === true,
      state: execution.state,
      engineId: execution.engineId ?? null,
      stats: { durationMs: Number.isFinite(execution.stats?.durationMs) ? execution.stats.durationMs : null, cancelled: execution.stats?.cancelled === true },
      error: execution.error ? { message: execution.error.message ?? String(execution.error) } : null,
    });
    return { script };
  }, { body: true, description: 'Registra en el historial una ejecución hecha en el navegador' });

  router.get('/scripts/:id/history', ({ params, query }) => {
    const record = scripts.require(params.id);
    const limit = query.limit ? Math.min(Number.parseInt(query.limit, 10) || 50, 200) : 50;
    return {
      scriptId: record.id,
      records: history.list({ limit, scriptId: record.id }),
      runs: record.runCount,
      errors: record.errorCount,
      lastRun: record.lastRun,
    };
  }, { description: 'Historial real de un script' });

  router.get('/scripts/:id/backups', async ({ params }) => {
    const record = scripts.require(params.id);
    return {
      scriptId: record.id,
      backups: await storage.listBackups(`scripts/${record.file}`),
    };
  }, { description: 'Respaldos disponibles de un script' });

  router.post('/scripts/:id/restore', async ({ params, body }) => {
    const record = scripts.require(params.id);
    const backupName = expectString(body?.backup ?? '', 'backup', { min: 1, max: 200, allowEmpty: false });
    const result = await storage.restoreBackup(`scripts/${record.file}`, backupName);
    await scripts.syncFromDisk();
    bus.emit('script:saved', { id: record.id, restored: true });
    sse.broadcast('script.changed', { reason: 'restored', id: record.id });
    return { ok: true, script: scripts.require(params.id), bytes: result.bytes, backupName };
  }, { body: true, description: 'Restaura una versión anterior del script' });

  router.post('/scripts/sync', async () => ({ result: await scripts.syncFromDisk() }), { description: 'Reconcilia el índice con el contenido real del disco' });

  router.get('/scripts/categories', () => ({
    categories: Object.values(ctx.scriptCategories ?? {}),
    tags: scripts.stats().tags,
  }), { description: 'Categorías y etiquetas realmente en uso' });

  void expectScriptId;
  void expectEnum;
}

function storageRelative(ctx, absolute) {
  return ctx.storage.relativeToRoot(absolute);
}
