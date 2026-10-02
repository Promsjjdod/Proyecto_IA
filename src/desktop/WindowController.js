/**
 * WindowController — window geometry and controls with honest capability reporting.
 *
 * Two real backends:
 *  - **Native shell** (`window.lumenDesktop`, injected by Electron's preload): real minimise,
 *    maximise, close and geometry persistence performed by the operating system.
 *  - **Browser**: there is no API to move or minimise a browser window. This controller then
 *    provides the operations that *do* exist (fullscreen, layout-driven panel resizing,
 *    persisted panel sizes) and reports the rest as UNAVAILABLE with the missing dependency,
 *    instead of rendering buttons that do nothing.
 */

import { CapabilityId, CapabilityState } from '../shared/constants.js';
import { capabilityResult } from '../shared/capability-registry.js';

const PANEL_LIMITS = Object.freeze({
  sidebarMin: 190,
  sidebarMax: 520,
  sidebarCollapsed: 56,
  consoleMin: 90,
  editorMin: 200,
});

export class WindowController {
  #bridge = null;
  #geometry = null;
  #stateListener = null;
  #persistTimer = null;
  #subscribers = new Set();
  #fullscreen = false;

  constructor({ settings, capabilities, logger, eventBus, notifications, errorBus, storage }) {
    this.settings = settings;
    this.capabilities = capabilities;
    this.logger = logger;
    this.eventBus = eventBus;
    this.notifications = notifications;
    this.errorBus = errorBus;
    this.storage = storage;
    this.mode = 'browser';
    this.supports = {
      move: false,
      resize: false,
      minimize: false,
      maximize: false,
      close: false,
      fullscreen: false,
    };
  }

  async init() {
    this.#bridge = typeof window.lumenDesktop === 'object' && window.lumenDesktop !== null ? window.lumenDesktop : null;
    this.#fullscreen = typeof document.documentElement.requestFullscreen === 'function';

    if (this.#bridge && typeof this.#bridge.info === 'function') {
      this.mode = 'native';
      const info = this.#bridge.info();
      this.supports = {
        move: true,
        resize: true,
        minimize: typeof this.#bridge.minimize === 'function',
        maximize: typeof this.#bridge.maximize === 'function',
        close: typeof this.#bridge.close === 'function',
        fullscreen: this.#fullscreen,
      };
      // Restore the exact geometry remembered by the shell.
      if (info?.geometry) this.#geometry = info.geometry;
      if (typeof this.#bridge.onStateChange === 'function') {
        this.#stateListener = (state) => {
          this.#geometry = { ...this.#geometry, ...state.geometry };
          this.#notify({ geometry: this.#geometry, reason: 'native-state' });
        };
        this.#bridge.onStateChange(this.#stateListener);
      }
    } else {
      this.mode = 'browser';
      this.supports = {
        move: false,
        resize: false,
        minimize: false,
        maximize: this.#fullscreen,
        close: false,
        fullscreen: this.#fullscreen,
      };
      // Restore the panel geometry remembered by the application itself.
      this.#geometry = await this.loadGeometry();
      this.#applyGeometry(this.#geometry);
    }

    await this.#refreshCapabilities();
    document.addEventListener('fullscreenchange', () => {
      this.#fullscreen = document.fullscreenElement !== null;
      this.#notify({ fullscreen: this.#fullscreen, reason: 'fullscreenchange' });
    });

    return { mode: this.mode, supports: { ...this.supports }, geometry: this.#geometry };
  }

  get isNative() {
    return this.mode === 'native' && this.#bridge !== null;
  }

  get geometry() {
    return this.#geometry ? { ...this.#geometry } : null;
  }

  /* --------------------------- Real controls --------------------------- */

  minimize() {
    if (!this.isNative || typeof this.#bridge.minimize !== 'function') {
      return this.#unavailable('minimizar', 'Requiere la shell de escritorio (npm run desktop).');
    }
    try {
      this.#bridge.minimize();
      return { ok: true, action: 'minimize' };
    } catch (err) {
      return this.#failed('minimizar', err);
    }
  }

  maximize() {
    if (this.isNative && typeof this.#bridge.maximize === 'function') {
      try {
        const result = this.#bridge.maximize();
        this.#notify({ geometry: this.#geometry, reason: 'maximize' });
        return { ok: true, action: 'maximize', maximized: result?.maximized ?? null };
      } catch (err) {
        return this.#failed('maximizar', err);
      }
    }
    return this.toggleFullscreen();
  }

  close() {
    if (!this.isNative || typeof this.#bridge.close !== 'function') {
      return this.#unavailable('cerrar la ventana', 'El navegador no permite cerrar la pestaña desde código; usa Ctrl+W del navegador.');
    }
    try {
      this.#bridge.close();
      return { ok: true, action: 'close' };
    } catch (err) {
      return this.#failed('cerrar', err);
    }
  }

  async toggleFullscreen() {
    if (!this.#fullscreen) {
      return this.#unavailable('pantalla completa', 'El navegador no expone requestFullscreen.');
    }
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        this.#fullscreen = false;
      } else {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        this.#fullscreen = true;
      }
      return { ok: true, action: 'fullscreen', fullscreen: this.#fullscreen };
    } catch (err) {
      return this.#failed('cambiar a pantalla completa', err);
    }
  }

  /** Moves the window by a delta (native only; real OS-level move). */
  moveBy(dx, dy) {
    if (!this.isNative || typeof this.#bridge.moveBy !== 'function') {
      return this.#unavailable('mover la ventana', 'El navegador no permite mover la ventana del sistema.');
    }
    try {
      const geometry = this.#bridge.moveBy(Math.round(dx), Math.round(dy));
      if (geometry) this.#geometry = { ...this.#geometry, ...geometry };
      this.eventBus?.emit('window:moved', { dx, dy, geometry: this.#geometry });
      return { ok: true, geometry: this.#geometry };
    } catch (err) {
      return this.#failed('mover la ventana', err);
    }
  }

  /** Resizes the window (native only). */
  resize(width, height) {
    if (!this.isNative || typeof this.#bridge.resize !== 'function') {
      return this.#unavailable('redimensionar la ventana', 'El navegador no permite cambiar el tamaño de la ventana del sistema.');
    }
    try {
      const geometry = this.#bridge.resize(Math.round(width), Math.round(height));
      if (geometry) this.#geometry = { ...this.#geometry, ...geometry };
      this.#schedulePersist();
      return { ok: true, geometry: this.#geometry };
    } catch (err) {
      return this.#failed('redimensionar la ventana', err);
    }
  }

  /* --------------------------- Panel geometry --------------------------- */

  /**
   * Clamps and persists the panel sizes (sidebar width, console height). This is the part of
   * "resize" that works in a browser and it is a real, user-visible operation.
   */
  setPanelGeometry(patch, { apply = true, persist = true } = {}) {
    const next = { ...(this.#geometry ?? {}) };
    if (Number.isFinite(patch.sidebarWidth)) {
      next.sidebarWidth = clamp(patch.sidebarWidth, PANEL_LIMITS.sidebarMin, PANEL_LIMITS.sidebarMax);
    }
    if (typeof patch.sidebarCollapsed === 'boolean') next.sidebarCollapsed = patch.sidebarCollapsed;
    if (Number.isFinite(patch.consoleHeight)) next.consoleHeight = Math.max(PANEL_LIMITS.consoleMin, patch.consoleHeight);
    if (Number.isFinite(patch.consoleWidth)) next.consoleWidth = Math.max(260, patch.consoleWidth);
    if (typeof patch.consoleVisible === 'boolean') next.consoleVisible = patch.consoleVisible;
    if (typeof patch.consoleDock === 'string') next.consoleDock = patch.consoleDock;
    this.#geometry = next;
    if (apply) this.#applyGeometry(next);
    if (persist) this.#schedulePersist();
    this.#notify({ geometry: next, reason: 'panel-geometry' });
    return { ok: true, geometry: next };
  }

  #applyGeometry(geometry) {
    if (!geometry) return;
    const root = document.documentElement;
    if (Number.isFinite(geometry.sidebarWidth)) {
      root.style.setProperty('--sidebar-width', `${geometry.sidebarCollapsed ? PANEL_LIMITS.sidebarCollapsed : geometry.sidebarWidth}px`);
    }
    if (Number.isFinite(geometry.consoleHeight)) {
      root.style.setProperty('--console-height', `${geometry.consoleHeight}px`);
    }
    if (typeof geometry.consoleVisible === 'boolean') {
      root.dataset.consoleVisible = geometry.consoleVisible ? 'true' : 'false';
    }
    if (typeof geometry.consoleDock === 'string') {
      root.dataset.consoleDock = geometry.consoleDock;
    }
    if (typeof geometry.sidebarCollapsed === 'boolean') {
      root.dataset.sidebarCollapsed = geometry.sidebarCollapsed ? 'true' : 'false';
    }
  }

  async loadGeometry() {
    const defaults = {
      sidebarWidth: 268,
      sidebarCollapsed: this.settings?.get('general.startSidebarCollapsed') ?? false,
      consoleHeight: 208,
      consoleWidth: 360,
      consoleVisible: true,
      consoleDock: 'bottom',
      savedAt: null,
      source: 'defaults',
    };
    try {
      const remote = await this.storage?.loadLayout?.();
      if (remote && typeof remote === 'object') {
        return {
          ...defaults,
          ...pruneGeometry(remote),
          savedAt: remote.savedAt ?? null,
          source: 'server',
        };
      }
    } catch (err) {
      this.logger?.warn(`No se pudo leer la geometría guardada (${err.message}); se usan los valores por defecto`, { source: 'WindowController' });
    }
    return defaults;
  }

  #schedulePersist() {
    if (this.#persistTimer) clearTimeout(this.#persistTimer);
    this.#persistTimer = setTimeout(() => {
      this.#persistTimer = null;
      void this.persistGeometry();
    }, 600);
  }

  async persistGeometry() {
    const payload = { ...this.#geometry, savedAt: new Date().toISOString() };
    if (this.isNative && typeof this.#bridge.setState === 'function') {
      try {
        this.#bridge.setState({ geometry: { width: this.#geometry?.width, height: this.#geometry?.height, x: this.#geometry?.x, y: this.#geometry?.y, maximized: this.#geometry?.maximized } });
      } catch (err) {
        this.logger?.warn(`La shell no pudo guardar la geometría de la ventana: ${err.message}`, { source: 'WindowController' });
      }
    }
    try {
      await this.storage?.saveLayout?.(payload);
      return { ok: true, persisted: 'server' };
    } catch (err) {
      this.logger?.warn(`No se pudo guardar la disposición del interfaz: ${err.message}`, { source: 'WindowController' });
      return { ok: false, error: err.message };
    }
  }

  async resetGeometry() {
    const defaults = await this.loadGeometry();
    this.#geometry = { ...defaults, sidebarWidth: 268, sidebarCollapsed: false, consoleHeight: 208, consoleVisible: true };
    this.#applyGeometry(this.#geometry);
    await this.persistGeometry();
    this.#notify({ geometry: this.#geometry, reason: 'reset' });
    return { ok: true, geometry: this.#geometry };
  }

  /* --------------------------- Capabilities --------------------------- */

  async #refreshCapabilities() {
    const checks = [
      [CapabilityId.WINDOW_MOVE, this.supports.move, 'mover la ventana', 'Requiere la shell de escritorio (npm run desktop).'],
      [CapabilityId.WINDOW_RESIZE, this.supports.resize, 'redimensionar la ventana', 'Requiere la shell de escritorio. En el navegador se redimensionan los paneles del interfaz, que se guardan igualmente.'],
      [CapabilityId.WINDOW_MINIMIZE, this.supports.minimize, 'minimizar la ventana', 'Requiere la shell de escritorio (npm run desktop).'],
      [CapabilityId.WINDOW_MAXIMIZE, this.supports.maximize, 'maximizar la ventana', 'Requiere la shell de escritorio; en el navegador se ofrece pantalla completa.'],
      [CapabilityId.WINDOW_CLOSE, this.supports.close, 'cerrar la ventana', 'Requiere la shell de escritorio.'],
      [CapabilityId.DESKTOP_SHELL, this.isNative, 'shell de escritorio', 'No se detectó window.lumenDesktop: la aplicación se ejecuta como interfaz web.'],
    ];
    for (const [id, available, action, reason] of checks) {
      if (!this.capabilities) continue;
      this.capabilities.register(id, {
        label: `Ventana: ${action}`,
        dependency: this.isNative ? 'Electron' : 'navegador',
        ttlMs: 60_000,
        check: async () => {
          if (available) {
            return capabilityResult.available(
              this.isNative
                ? `Disponible mediante la shell nativa de Electron (modo actual: ${this.isNative ? 'escritorio' : 'navegador'})`
                : 'Disponible mediante la API de pantalla completa del navegador',
            );
          }
          return this.mode === 'native'
            ? capabilityResult.unavailable(`${reason} La shell está conectada pero no expone esta operación.`)
            : capabilityResult.unavailable(reason, { mode: this.mode });
        },
      });
    }
    await this.capabilities?.detect({ ids: checks.map(([id]) => id), force: true });
  }

  get capabilitySummary() {
    const unavailable = Object.entries(this.supports).filter(([, value]) => !value).map(([key]) => key);
    return {
      mode: this.mode,
      native: this.isNative,
      supports: { ...this.supports },
      unavailable,
      explain: this.isNative
        ? 'Ventana nativa: arrastrar, redimensionar, minimizar, maximizar y cerrar se ejecutan sobre la ventana del sistema operativo.'
        : 'Modo navegador: maximizar equivale a pantalla completa y el tamaño de los paneles se guarda en el servidor. Mover, minimizar y cerrar la ventana del sistema no están disponibles porque el navegador no expone esas operaciones.',
    };
  }

  /* --------------------------- Helpers --------------------------- */

  #unavailable(action, reason) {
    const state = { ok: false, unavailable: true, action, reason };
    this.notifications?.warn(`No se puede ${action}: ${reason}`, { durationMs: 4200 });
    this.eventBus?.emit('window:unavailable', state);
    return state;
  }

  #failed(action, err) {
    const incident = this.errorBus?.report(err, { source: `WindowController:${action}`, kind: 'UI' });
    return { ok: false, action, error: err.message, incident: incident?.id ?? null };
  }

  subscribe(listener) {
    this.#subscribers.add(listener);
    return () => this.#subscribers.delete(listener);
  }

  #notify(payload) {
    for (const listener of [...this.#subscribers]) {
      try {
        listener(payload);
      } catch (err) {
        this.logger?.error(err, { source: 'WindowController.notify' });
      }
    }
  }

  snapshot() {
    return {
      ...this.capabilitySummary,
      geometry: this.geometry,
      fullscreen: this.#fullscreen,
      panelLimits: PANEL_LIMITS,
    };
  }

  dispose() {
    if (this.#persistTimer) clearTimeout(this.#persistTimer);
    if (this.isNative && typeof this.#bridge?.removeStateListener === 'function' && this.#stateListener) {
      try {
        this.#bridge.removeStateListener(this.#stateListener);
      } catch {
        /* the shell may already be gone */
      }
    }
    this.#subscribers.clear();
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function pruneGeometry(source) {
  const allowed = ['sidebarWidth', 'sidebarCollapsed', 'consoleHeight', 'consoleWidth', 'consoleVisible', 'consoleDock', 'width', 'height', 'x', 'y', 'maximized'];
  const output = {};
  for (const key of allowed) {
    if (key in source) output[key] = source[key];
  }
  return output;
}

export { PANEL_LIMITS, CapabilityState };
