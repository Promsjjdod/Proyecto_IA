/**
 * LayoutStore — single owner of the persisted layout document (`/api/layout`).
 *
 * The window controller (geometry, panel sizes) and the session controller (view, sidebar, zoom)
 * both need to persist parts of the same document, so they go through this store: writes are
 * merged with the in-memory copy instead of overwriting each other, and they are debounced.
 */

import { createScheduler } from '../renderer/utils/async.js';

export class LayoutStore {
  #apiClient;
  #logger;
  #layout = null;
  #loaded = false;
  #flush;

  constructor({ apiClient, logger }) {
    this.#apiClient = apiClient;
    this.#logger = logger;
    this.#flush = createScheduler(() => void this.flush(), 800);
  }

  get value() {
    return this.#layout ? { ...this.#layout } : null;
  }

  get loaded() {
    return this.#loaded;
  }

  async init() {
    await this.refresh();
    return { ok: true, hasLayout: this.#layout !== null, keys: this.#layout ? Object.keys(this.#layout).length : 0 };
  }

  async refresh() {
    try {
      const payload = await this.#apiClient.get('/api/layout');
      this.#layout = payload?.layout && typeof payload.layout === 'object' ? { ...payload.layout } : null;
      this.#loaded = true;
      return this.#layout;
    } catch (err) {
      this.#logger?.warn(`No se pudo leer la disposición guardada: ${err.message}`, { source: 'LayoutStore' });
      this.#loaded = true;
      return null;
    }
  }

  /** WindowController contract: returns the stored layout object (or null). */
  async loadLayout() {
    if (!this.#loaded) await this.refresh();
    return this.#layout;
  }

  /** WindowController contract: merges a patch and schedules the write. */
  async saveLayout(patch) {
    if (!patch || typeof patch !== 'object') return { ok: false, reason: 'el parche de disposición debe ser un objeto' };
    this.#layout = { ...(this.#layout ?? {}), ...patch, savedAt: new Date().toISOString() };
    this.#flush();
    return { ok: true, layout: { ...this.#layout } };
  }

  /** Immediate (awaitable) write, used on view change and before unload. */
  async flush() {
    if (!this.#layout) return { ok: true, skipped: 'sin cambios' };
    try {
      await this.#apiClient.put('/api/layout', { layout: this.#layout });
      return { ok: true, savedAt: this.#layout.savedAt };
    } catch (err) {
      this.#logger?.warn(`No se pudo guardar la disposición: ${err.message}`, { source: 'LayoutStore' });
      return { ok: false, error: err };
    }
  }
}
