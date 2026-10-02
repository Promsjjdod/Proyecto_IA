/**
 * ScriptManager (client) — the scripts the user actually owns.
 *
 * Every operation maps to a real API call that reads or writes files on disk through the
 * server's atomic storage layer (backups, checksum conflict detection, trash). The manager
 * keeps the UI honest: it reports conflicts when a file changed on disk, never loses unsaved
 * content (the editor keeps the text and the user decides), and it surfaces the server's
 * errors instead of swallowing them.
 */

import { Dialect, ScriptCategory, SortMode } from '../shared/constants.js';
import { AppError } from '../shared/errors.js';

export class ScriptManager {
  #scripts = new Map();
  #order = [];
  #stats = { created: 0, saved: 0, deleted: 0, imported: 0, exported: 0, duplicates: 0, renames: 0, conflicts: 0, restore: 0 };
  #categories = [];
  #tags = [];
  #subscribers = new Set();
  #filters = { query: '', category: null, dialect: null, tags: [], favoriteOnly: false, sort: SortMode.MODIFIED_DESC };
  #serverAvailable = true;

  constructor({ apiClient, logger, errorBus, notifications, eventBus, editor, storage }) {
    this.apiClient = apiClient;
    this.logger = logger;
    this.errorBus = errorBus;
    this.notifications = notifications;
    this.eventBus = eventBus;
    this.editor = editor;
    this.storage = storage;
  }

  get scripts() {
    return this.#order.map((id) => this.describe(id)).filter(Boolean);
  }

  get size() {
    return this.#scripts.size;
  }

  get filters() {
    return { ...this.#filters };
  }

  get categories() {
    return [...this.#categories];
  }

  get tags() {
    return [...this.#tags];
  }

  get serverAvailable() {
    return this.#serverAvailable;
  }

  describe(id) {
    const script = this.#scripts.get(id);
    if (!script) return null;
    return {
      ...script,
      open: this.editor?.hasDocument(id) ?? false,
      dirty: this.editor?.isDirty(id) ?? false,
    };
  }

  get(id) {
    return this.#scripts.get(id) ?? null;
  }

  has(id) {
    return this.#scripts.has(id);
  }

  async init() {
    await this.refresh();
    return { ok: this.#serverAvailable, scripts: this.#scripts.size, categories: this.#categories.length };
  }

  /** Loads the list (with the active filters) and the categories in use. */
  async refresh() {
    try {
      const payload = await this.apiClient.get('/api/scripts', {
        query: {
          q: this.#filters.query || undefined,
          category: this.#filters.category || undefined,
          dialect: this.#filters.dialect || undefined,
          tags: this.#filters.tags.length > 0 ? this.#filters.tags.join(',') : undefined,
          favorite: this.#filters.favoriteOnly ? 'true' : undefined,
          sort: this.#filters.sort,
          limit: '500',
        },
        timeoutMs: 15_000,
      });
      const list = payload.scripts ?? [];
      this.#scripts.clear();
      this.#order = [];
      for (const record of list) {
        this.#scripts.set(record.id, record);
        this.#order.push(record.id);
      }
      this.#serverAvailable = true;
      await this.#loadCategories();
      this.#notify({ reason: 'refresh', count: list.length });
      return { ok: true, count: list.length, stats: payload.stats ?? null };
    } catch (err) {
      this.#serverAvailable = false;
      this.errorBus?.report(err, { source: 'ScriptManager.refresh', kind: 'SCRIPT' });
      this.#notify({ reason: 'refresh-failed', error: err.message });
      return { ok: false, error: err.message };
    }
  }

  async #loadCategories() {
    try {
      const payload = await this.apiClient.get('/api/scripts/categories', { timeoutMs: 10_000 });
      this.#categories = payload.categories ?? [];
      this.#tags = payload.tags ?? [];
    } catch {
      // Categories are a convenience: keep the built-in list when the endpoint is down.
      this.#categories = Object.values(ScriptCategory);
      this.#tags = [];
    }
  }

  setFilters(patch) {
    this.#filters = { ...this.#filters, ...patch };
    this.#notify({ reason: 'filters' });
    return this.refresh();
  }

  /* ------------------------------------------------------------------ *
   * CRUD
   * ------------------------------------------------------------------ */

  async create({ name, content = null, dialect = Dialect.LUAU, category = ScriptCategory.EXAMPLES, tags = [], description = '', open = true } = {}) {
    try {
      const payload = await this.apiClient.post('/api/scripts', { name, content, dialect, category, tags, description }, { timeoutMs: 15_000 });
      const script = payload.script;
      this.#scripts.set(script.id, script);
      this.#order.unshift(script.id);
      this.#stats.created += 1;
      if (open) await this.open(script.id);
      this.#notify({ reason: 'created', id: script.id });
      this.notifications?.success(`Script creado: ${script.name}`);
      return { ok: true, script };
    } catch (err) {
      const error = err?.name === 'AppClientError' ? err : new AppError({ message: err.message, kind: 'SCRIPT' });
      this.errorBus?.report(error, { source: 'ScriptManager.create', kind: 'SCRIPT' });
      this.notifications?.error(`No se pudo crear el script: ${error.message}`);
      return { ok: false, error };
    }
  }

  /** Reads the content from disk and opens it in a tab. */
  async open(id, { focus = true } = {}) {
    try {
      const payload = await this.apiClient.get(`/api/scripts/${encodeURIComponent(id)}/content`, { timeoutMs: 20_000 });
      this.#scripts.set(payload.id, payload.metadata ?? this.#scripts.get(id) ?? { id, name: payload.name, dialect: payload.dialect });
      this.editor?.openDocument({
        id: payload.id,
        name: payload.name,
        content: payload.content,
        dialect: payload.dialect,
        path: payload.metadata?.relativePath ?? null,
      });
      if (focus) this.editor?.setActive(payload.id);
      this.#notify({ reason: 'opened', id });
      return { ok: true, script: payload };
    } catch (err) {
      this.errorBus?.report(err, { source: 'ScriptManager.open', kind: 'SCRIPT' });
      this.notifications?.error(`No se pudo abrir el script: ${err.message}`);
      return { ok: false, error: err };
    }
  }

  /**
   * Saves the editor content to disk.
   * A checksum conflict (file changed outside the app) is reported and, unless `force` is
   * set, the save is refused so the user decides what to keep.
   */
  async save(id, { content = null, force = false, recordExecution = null, silent = false } = {}) {
    const text = content ?? this.editor?.getValue(id);
    if (typeof text !== 'string') {
      return { ok: false, error: new AppError({ message: 'No hay contenido para guardar', kind: 'SCRIPT' }) };
    }
    const record = this.#scripts.get(id) ?? null;
    try {
      const payload = await this.apiClient.put(`/api/scripts/${encodeURIComponent(id)}/content`, {
        content: text,
        checksum: force ? null : (record?.checksum ?? null),
        recordExecution: Boolean(recordExecution),
        execution: recordExecution ?? undefined,
      }, { timeoutMs: 30_000 });
      this.#scripts.set(payload.script.id, payload.script);
      this.editor?.markSaved(id, { content: text });
      this.#stats.saved += 1;
      this.eventBus?.emit('script:saved', { id, bytes: payload.bytes });
      if (!silent) this.notifications?.success(`Guardado: ${payload.script.name} (${payload.bytes} bytes)`);
      this.#notify({ reason: 'saved', id });
      return { ok: true, script: payload.script, bytes: payload.bytes };
    } catch (err) {
      if (err?.code === 'E_CONFLICT' || /checksum/i.test(err?.message ?? '')) {
        this.#stats.conflicts += 1;
        return { ok: false, conflict: true, error: err };
      }
      this.errorBus?.report(err, { source: 'ScriptManager.save', kind: 'STORAGE' });
      if (!silent) this.notifications?.error(`No se pudo guardar: ${err.message}`);
      return { ok: false, error: err };
    }
  }

  async saveAs(id, { name, dialect = null, open = true } = {}) {
    try {
      const payload = await this.apiClient.post(`/api/scripts/${encodeURIComponent(id)}/save-as`, { name, dialect }, { timeoutMs: 20_000 });
      const script = payload.script;
      this.#scripts.set(script.id, script);
      this.#order.unshift(script.id);
      const content = this.editor?.getValue(id) ?? '';
      if (open) {
        this.editor?.openDocument({ id: script.id, name: script.name, content, dialect: script.dialect });
        this.editor?.markSaved(script.id, { content });
      }
      this.#notify({ reason: 'save-as', id: script.id });
      this.notifications?.success(`Copia creada: ${script.name}`);
      return { ok: true, script };
    } catch (err) {
      this.errorBus?.report(err, { source: 'ScriptManager.saveAs', kind: 'STORAGE' });
      this.notifications?.error(`No se pudo guardar una copia: ${err.message}`);
      return { ok: false, error: err };
    }
  }

  async rename(id, name) {
    try {
      const payload = await this.apiClient.post(`/api/scripts/${encodeURIComponent(id)}/rename`, { name }, { timeoutMs: 15_000 });
      this.#scripts.set(payload.script.id, payload.script);
      this.editor?.renameDocument(id, payload.script.name, payload.script.relativePath ?? null);
      this.#stats.renames += 1;
      this.#notify({ reason: 'renamed', id });
      return { ok: true, script: payload.script };
    } catch (err) {
      this.errorBus?.report(err, { source: 'ScriptManager.rename', kind: 'STORAGE' });
      return { ok: false, error: err };
    }
  }

  async duplicate(id, name = null) {
    try {
      const payload = await this.apiClient.post(`/api/scripts/${encodeURIComponent(id)}/duplicate`, { name }, { timeoutMs: 15_000 });
      this.#scripts.set(payload.script.id, payload.script);
      this.#order.unshift(payload.script.id);
      this.#stats.duplicates += 1;
      this.#notify({ reason: 'duplicated', id: payload.script.id });
      return { ok: true, script: payload.script };
    } catch (err) {
      this.errorBus?.report(err, { source: 'ScriptManager.duplicate', kind: 'STORAGE' });
      return { ok: false, error: err };
    }
  }

  async remove(id, { hard = false } = {}) {
    try {
      const payload = await this.apiClient.delete(`/api/scripts/${encodeURIComponent(id)}`, { query: hard ? { hard: 'true' } : undefined });
      this.#scripts.delete(id);
      this.#order = this.#order.filter((entry) => entry !== id);
      this.#stats.deleted += 1;
      this.#notify({ reason: 'removed', id });
      return { ok: true, ...payload };
    } catch (err) {
      this.errorBus?.report(err, { source: 'ScriptManager.remove', kind: 'STORAGE' });
      return { ok: false, error: err };
    }
  }

  async restore(id, backupName) {
    try {
      const payload = await this.apiClient.post(`/api/scripts/${encodeURIComponent(id)}/restore`, { backup: backupName }, { timeoutMs: 20_000 });
      this.#scripts.set(payload.script.id, payload.script);
      this.#stats.restore += 1;
      await this.open(id);
      this.#notify({ reason: 'restored', id });
      return { ok: true, ...payload };
    } catch (err) {
      this.errorBus?.report(err, { source: 'ScriptManager.restore', kind: 'STORAGE' });
      return { ok: false, error: err };
    }
  }

  async backups(id) {
    try {
      const payload = await this.apiClient.get(`/api/scripts/${encodeURIComponent(id)}/backups`, { timeoutMs: 15_000 });
      return { ok: true, backups: payload.backups ?? [] };
    } catch (err) {
      return { ok: false, error: err, backups: [] };
    }
  }

  async history(id, limit = 50) {
    try {
      const payload = await this.apiClient.get(`/api/scripts/${encodeURIComponent(id)}/history`, { query: { limit: String(limit) }, timeoutMs: 15_000 });
      return { ok: true, ...payload };
    } catch (err) {
      return { ok: false, error: err, records: [] };
    }
  }

  async setFavorite(id, favorite) {
    try {
      const payload = await this.apiClient.post(`/api/scripts/${encodeURIComponent(id)}/favorite`, { favorite }, { timeoutMs: 10_000 });
      this.#scripts.set(id, payload.script);
      this.#notify({ reason: 'favorite', id, favorite: payload.script.favorite });
      return { ok: true, script: payload.script };
    } catch (err) {
      this.errorBus?.report(err, { source: 'ScriptManager.setFavorite', kind: 'SCRIPT' });
      return { ok: false, error: err };
    }
  }

  async updateMetadata(id, patch) {
    try {
      const payload = await this.apiClient.patch(`/api/scripts/${encodeURIComponent(id)}`, patch, { timeoutMs: 10_000 });
      this.#scripts.set(id, payload.script);
      this.#notify({ reason: 'metadata', id });
      return { ok: true, script: payload.script };
    } catch (err) {
      this.errorBus?.report(err, { source: 'ScriptManager.updateMetadata', kind: 'SCRIPT' });
      return { ok: false, error: err };
    }
  }

  /* ------------------------------------------------------------------ *
   * Import / export
   * ------------------------------------------------------------------ */

  /** Imports from a file the user picked in the browser. */
  async importFile(file, { category = ScriptCategory.IMPORTED } = {}) {
    if (!file) return { ok: false, error: new AppError({ message: 'No se seleccionó ningún archivo', kind: 'SCRIPT' }) };
    const maxBytes = 4 * 1024 * 1024;
    if (file.size > maxBytes) {
      return { ok: false, error: new AppError({ message: `El archivo supera el límite de ${maxBytes / 1024 / 1024} MB`, kind: 'SCRIPT' }) };
    }
    let content;
    try {
      content = await file.text();
    } catch (err) {
      this.errorBus?.report(err, { source: 'ScriptManager.importFile', kind: 'STORAGE' });
      return { ok: false, error: err };
    }
    const format = contentTypeFor(file.name);
    const name = file.name.replace(/\.[^.]+$/, '') || 'importado';
    try {
      const payload = await this.apiClient.post('/api/scripts/import', {
        content,
        name,
        dialect: format.dialect,
        category,
      }, { timeoutMs: 30_000 });
      const script = payload.script;
      this.#scripts.set(script.id, script);
      this.#order.unshift(script.id);
      this.#stats.imported += 1;
      await this.open(script.id);
      this.#notify({ reason: 'imported', id: script.id });
      return { ok: true, script, warnings: payload.warnings ?? [] };
    } catch (err) {
      this.errorBus?.report(err, { source: 'ScriptManager.importFile', kind: 'STORAGE' });
      return { ok: false, error: err };
    }
  }

  /** Imports a file that already lives inside an allowed directory on this machine. */
  async importPath(path) {
    try {
      const payload = await this.apiClient.post('/api/scripts/import', { path }, { timeoutMs: 30_000 });
      const script = payload.script;
      this.#scripts.set(script.id, script);
      this.#order.unshift(script.id);
      this.#stats.imported += 1;
      await this.open(script.id);
      return { ok: true, script };
    } catch (err) {
      this.errorBus?.report(err, { source: 'ScriptManager.importPath', kind: 'STORAGE' });
      return { ok: false, error: err };
    }
  }

  /** Downloads the script as a file (real Blob download). */
  async exportDownload(id) {
    const script = this.#scripts.get(id);
    const filename = `${(script?.name ?? id).replace(/[^\w.-]+/g, '_')}${script?.dialect === Dialect.LUA54 ? '.lua' : '.luau'}`;
    try {
      const result = await this.apiClient.download(`/api/scripts/${encodeURIComponent(id)}/export`, { filename });
      this.#stats.exported += 1;
      this.#notify({ reason: 'exported', id });
      return { ok: true, filename, bytes: result?.bytes ?? null };
    } catch (err) {
      this.errorBus?.report(err, { source: 'ScriptManager.exportDownload', kind: 'STORAGE' });
      return { ok: false, error: err };
    }
  }

  /** Writes the script to a directory on this machine (server-side path). */
  async exportTo(id, path) {
    try {
      const payload = await this.apiClient.post(`/api/scripts/${encodeURIComponent(id)}/export-to`, { path }, { timeoutMs: 20_000 });
      this.#stats.exported += 1;
      return { ok: true, ...payload };
    } catch (err) {
      this.errorBus?.report(err, { source: 'ScriptManager.exportTo', kind: 'STORAGE' });
      return { ok: false, error: err };
    }
  }

  async runOnServer(id, { engineId = null, timeoutMs = 5000, recordExecution = false } = {}) {
    try {
      const payload = await this.apiClient.post(`/api/scripts/${encodeURIComponent(id)}/run`, { engineId, timeoutMs, recordExecution }, { timeoutMs: Math.max(15_000, timeoutMs + 15_000) });
      return { ok: true, ...payload };
    } catch (err) {
      this.errorBus?.report(err, { source: 'ScriptManager.runOnServer', kind: 'RUNTIME' });
      return { ok: false, error: err };
    }
  }

  async syncFromDisk() {
    try {
      const payload = await this.apiClient.post('/api/scripts/sync', {}, { timeoutMs: 30_000 });
      await this.refresh();
      this.#notify({ reason: 'synced', result: payload.result });
      return { ok: true, result: payload.result };
    } catch (err) {
      this.errorBus?.report(err, { source: 'ScriptManager.syncFromDisk', kind: 'STORAGE' });
      return { ok: false, error: err };
    }
  }

  /** Search by name/metadata or inside the contents of every script. */
  async search(term, { inContent = false, limit = 60 } = {}) {
    try {
      const payload = await this.apiClient.get('/api/scripts/search', {
        query: { q: term, content: inContent ? 'true' : undefined },
        timeoutMs: 25_000,
      });
      return { ok: true, results: payload.results ?? [], searchedContent: payload.searchedContent === true, limit };
    } catch (err) {
      return { ok: false, error: err, results: [] };
    }
  }

  getStats() {
    return { ...this.#stats, total: this.#scripts.size };
  }

  subscribe(listener) {
    this.#subscribers.add(listener);
    return () => this.#subscribers.delete(listener);
  }

  #notify(payload) {
    for (const listener of [...this.#subscribers]) {
      try {
        listener(payload, this.scripts);
      } catch (err) {
        this.logger?.error?.(err, { source: 'ScriptManager.subscriber' });
      }
    }
  }
}

/** File extension → dialect/category guess used by the importer. */
export function contentTypeFor(filename) {
  const lower = String(filename ?? '').toLowerCase();
  if (lower.endsWith('.lua')) return { dialect: Dialect.LUA54, label: 'Lua 5.4' };
  if (lower.endsWith('.luau')) return { dialect: Dialect.LUAU, label: 'Luau' };
  return { dialect: Dialect.LUAU, label: 'Luau (por defecto)' };
}
