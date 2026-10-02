/**
 * SessionController — persistence of the working session and the window layout.
 *
 * Restores what the user was doing (view, open tabs, unsaved drafts when enabled) and keeps the
 * layout (sidebar state, active view, zoom) on disk through the real API (`/api/session`,
 * `/api/layout`). Saving is debounced and never blocks the UI; failures are reported through the
 * notification manager instead of being swallowed.
 */

import { createScheduler } from '../renderer/utils/async.js';

const SESSION_VERSION = 1;
const LAYOUT_VERSION = 1;

export class SessionController {
  #app;
  #session = null;
  #save = null;
  #restored = false;
  #unsubscribers = [];

  constructor(app) {
    this.#app = app;
    this.#save = createScheduler(() => void this.saveNow({ silent: true }), 1200);
  }

  get lastSavedAt() {
    return this.#session?.savedAt ?? null;
  }

  get view() {
    return this.#app.layoutStore?.value?.view ?? this.#session?.view ?? null;
  }

  get restorableTabs() {
    return this.#session?.tabs?.length ?? 0;
  }

  get snapshot() {
    return { session: this.#session ? { ...this.#session } : null, layout: this.#app.layoutStore?.value ?? null };
  }

  async init() {
    const [sessionResult] = await Promise.allSettled([this.#app.apiClient.get('/api/session')]);
    if (sessionResult.status === 'fulfilled') this.#session = normalizeSession(sessionResult.value.session);
    else this.#app.logger.warn(`No se pudo leer la sesión guardada: ${sessionResult.reason?.message ?? 'error'}`, { source: 'SessionController' });
    await this.#app.layoutStore?.init?.().catch(() => {});

    this.#unsubscribers.push(
      this.#app.tabs.onChange(() => this.#schedule()),
      this.#app.editor.onEvent((event) => {
        if (event.type === 'dirty' || event.type === 'close') this.#schedule();
      }),
    );
    window.addEventListener('beforeunload', () => void this.saveNow({ silent: true, sync: true }));
    return { ok: true, hasSession: this.#session !== null, tabs: this.restorableTabs };
  }

  /** Applies the stored layout; called by the App right after the chrome is built. */
  applyLayout() {
    const layout = this.#app.layoutStore?.value ?? null;
    if (!layout) return { ok: true, applied: false };
    const applied = {};
    if (typeof layout.sidebar === 'string') {
      this.#app.setSidebar(layout.sidebar);
      applied.sidebar = layout.sidebar;
    }
    if (Number.isFinite(layout.zoom)) {
      const editor = this.#app.editor;
      const target = Math.min(40, Math.max(8, layout.zoom));
      editor?.setZoom?.(target);
      applied.zoom = target;
    }
    return { ok: true, applied: true, ...applied };
  }

  /**
   * Restores the previous session: reopens the stored tabs and shows the last view.
   * Honours `general.restoreSession` and `general.restoreOpenTabs`.
   */
  async restore() {
    if (this.#restored) return { ok: true, alreadyRestored: true };
    this.#restored = true;
    const session = this.#session;
    if (!session) return { ok: true, restored: false, reason: 'no hay ninguna sesión guardada' };
    if (this.#app.settings.get('general.restoreSession') === false) {
      return { ok: true, restored: false, reason: 'la restauración de sesión está desactivada en Ajustes › General' };
    }

    const settings = this.#app.settings;
    const restored = { tabs: 0, drafts: 0, view: null, failures: [] };
    if (settings.get('general.restoreOpenTabs') !== false) {
      const maxTabs = settings.get('performance.maxOpenTabs') ?? 20;
      for (const tab of (session.tabs ?? []).slice(0, maxTabs)) {
        try {
          if (tab.id && this.#app.scripts.has(tab.id)) {
            await this.#app.scripts.open(tab.id, { focus: false });
          } else if (tab.content !== null && tab.content !== undefined) {
            // Unsaved draft without a script on disk: reopen it as a real document.
            this.#app.editor.openDocument({
              id: tab.id ?? `draft-${Math.random().toString(36).slice(2, 8)}`,
              name: tab.name ?? 'borrador.luau',
              content: tab.content,
              dialect: tab.dialect ?? 'luau',
            });
            restored.drafts += 1;
          } else {
            restored.failures.push(`${tab.name ?? tab.id ?? 'pestaña'}: ya no existe`);
            continue;
          }
          restored.tabs += 1;
        } catch (err) {
          restored.failures.push(`${tab.name ?? tab.id}: ${err.message}`);
        }
      }
      if (session.activeTabId) this.#app.tabs.activate(session.activeTabId);
    }

    const view = settings.get('general.startupView') === 'last' ? (session.view ?? null) : null;
    if (view && this.#app.views.has(view)) {
      this.#app.switchView(view);
      restored.view = view;
    }
    if (restored.failures.length > 0) {
      this.#app.notifications.warn(
        `No se pudieron restaurar ${restored.failures.length} pestañas de la sesión anterior: ${restored.failures.slice(0, 3).join(' · ')}`,
        { durationMs: 8000, source: 'SessionController' },
      );
      for (const failure of restored.failures) {
        this.#app.console.warn(`Sesión anterior: ${failure}`, { source: 'SessionController' });
      }
    }
    this.#app.logger.info(`Sesión restaurada: ${restored.tabs} pestañas, vista ${restored.view ?? 'panel'}`, { source: 'SessionController' });
    return { ok: true, restored: restored.tabs > 0 || restored.view !== null, ...restored };
  }

  /** Persists the current session and layout (debounced from tab/editor events). */
  #schedule() {
    this.#save();
  }

  /** Public debounced save — the App calls it when the view changes. */
  schedule() {
    this.#schedule();
    return { ok: true };
  }

  async saveNow({ silent = false, sync = false } = {}) {
    const tabs = (this.#app.tabs?.tabs ?? []).map((tab) => ({
      id: tab.id,
      name: tab.name,
      dialect: tab.dialect,
      path: tab.path ?? null,
      saved: tab.saved === true,
      content: tab.dirty && this.#app.settings.get('storage.saveDrafts') === true
        ? (this.#app.editor?.getValue(tab.id) ?? null)
        : null,
    }));
    const session = {
      version: SESSION_VERSION,
      savedAt: Date.now(),
      view: this.#app.activeView,
      sidebar: this.#app.sidebarMode,
      activeTabId: this.#app.tabs?.activeId ?? null,
      tabs,
    };
    const layout = {
      version: LAYOUT_VERSION,
      view: this.#app.activeView,
      sidebar: this.#app.sidebarMode,
      zoom: this.#app.editor?.zoom ?? null,
    };

    try {
      const request = this.#app.apiClient.put('/api/session', { session });
      const layoutRequest = this.#app.layoutStore ? this.#app.layoutStore.saveLayout(layout).then(() => this.#app.layoutStore.flush()) : Promise.resolve();
      if (!sync) await Promise.all([request, layoutRequest]);
      this.#session = session;
      if (!silent) this.#app.logger.debug('Sesión guardada', { source: 'SessionController' });
      return { ok: true, tabs: tabs.length };
    } catch (err) {
      if (!silent) this.#app.notifications.error(`No se pudo guardar la sesión: ${err.message}`);
      else this.#app.logger.warn(`No se pudo guardar la sesión: ${err.message}`, { source: 'SessionController' });
      return { ok: false, error: err };
    }
  }

  async clear() {
    try {
      await this.#app.apiClient.delete('/api/session');
      this.#session = null;
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err };
    }
  }

  dispose() {
    for (const unsubscribe of this.#unsubscribers.splice(0)) unsubscribe?.();
  }
}

function normalizeSession(session) {
  if (!session || typeof session !== 'object') return null;
  return {
    version: session.version ?? 1,
    savedAt: Number.isFinite(session.savedAt) ? session.savedAt : null,
    view: typeof session.view === 'string' ? session.view : null,
    sidebar: typeof session.sidebar === 'string' ? session.sidebar : null,
    activeTabId: session.activeTabId ?? null,
    tabs: Array.isArray(session.tabs) ? session.tabs : [],
  };
}

