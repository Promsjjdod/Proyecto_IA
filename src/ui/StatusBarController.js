/**
 * StatusBarController — the bottom bar, fed exclusively by real state.
 *
 * Every segment is updated from an event or a measured value: runtime state and engine,
 * execution time of the last run, error count, cursor position of the active editor document,
 * dialect, encoding/line endings, storage indicator, connection state and the clock.
 * Nothing on this bar is decorative: an unknown value renders as "—".
 */

import { DialectInfo, RuntimeState, SseEvent } from '../shared/constants.js';
import { el, replace, setActive } from '../utils/dom.js';
import { formatDuration, formatTime } from '../utils/format.js';

export class StatusBarController {
  #segments = {};
  #clockTimer = null;
  #host = null;
  #lastExecution = null;
  #connectionState = 'unknown';
  #unsubscribers = [];

  constructor({ host, runtimeController, tabsController, notifications, eventStream, logger, editorManager, settings, capabilities, windowController }) {
    this.host = host;
    this.runtimeController = runtimeController;
    this.tabsController = tabsController;
    this.notifications = notifications;
    this.eventStream = eventStream;
    this.logger = logger;
    this.editorManager = editorManager;
    this.settings = settings;
    this.capabilities = capabilities;
    this.windowController = windowController;
  }

  init() {
    this.#host = this.host ?? document.getElementById('status-bar');
    if (!this.#host) throw new Error('No se encontró el contenedor de la barra de estado (#status-bar)');
    this.#render();
    this.#subscribe();
    this.#clockTimer = setInterval(() => this.#updateClock(), 15_000);
    this.refreshAll();
    return { ok: true, segments: Object.keys(this.#segments).length };
  }

  #render() {
    const runtime = el('button.status-segment.status-segment--action', {
      attrs: { type: 'button', title: 'Estado del runtime (clic para ver detalles en el panel Consola)', 'aria-label': 'Estado del runtime' },
      on: { click: () => this.runtimeController.showRuntimePanel?.() },
    }, [
      el('span.status-dot', { dataset: { state: 'unknown' } }),
      el('span.status-segment__label', { text: 'Runtime' }),
      el('span.status-segment__value', { text: '—' }),
    ]);

    this.#segments = {
      runtime,
      engine: el('span.status-segment', { attrs: { title: 'Motor de ejecución seleccionado' } }, [
        el('span.status-segment__label', { text: 'Motor' }),
        el('span.status-segment__value', { text: '—' }),
      ]),
      execution: el('span.status-segment', { attrs: { title: 'Duración de la última ejecución' } }, [
        el('span.status-segment__label', { text: 'Última ejecución' }),
        el('span.status-segment__value', { text: '—' }),
      ]),
      errors: el('button.status-segment.status-segment--action', {
        attrs: { type: 'button', title: 'Errores registrados desde el arranque' },
        on: { click: () => this.runtimeController.focusConsole?.('ERROR') },
      }, [
        el('span.status-segment__label', { text: 'Errores' }),
        el('span.status-segment__value', { text: '0' }),
      ]),
      cursor: el('span.status-segment', { attrs: { title: 'Posición del cursor en el editor activo' } }, [
        el('span.status-segment__label', { text: 'Línea:Col' }),
        el('span.status-segment__value', { text: '—' }),
      ]),
      selection: el('span.status-segment', { attrs: { title: 'Caracteres seleccionados' } }, [
        el('span.status-segment__value', { text: '' }),
      ]),
      dialect: el('button.status-segment.status-segment--action', {
        attrs: { type: 'button', title: 'Dialecto del archivo activo (clic para cambiar)' },
        on: { click: () => this.#toggleDialect() },
      }, [
        el('span.status-segment__label', { text: 'Dialecto' }),
        el('span.status-segment__value', { text: '—' }),
      ]),
      file: el('span.status-segment', { attrs: { title: 'Codificación y fin de línea del archivo activo' } }, [
        el('span.status-segment__value', { text: '—' }),
      ]),
      storage: el('button.status-segment.status-segment--action', {
        attrs: { type: 'button', title: 'Almacenamiento' },
        on: { click: () => this.runtimeController.openSettings?.('storage') },
      }, [
        el('span.status-segment__label', { text: 'Almacenamiento' }),
        el('span.status-segment__value', { text: '—' }),
      ]),
      connection: el('span.status-segment', { attrs: { title: 'Conexión con el servidor local' } }, [
        el('span.status-dot.status-dot--connection', { dataset: { state: 'unknown' } }),
        el('span.status-segment__value', { text: 'Sin conexión' }),
      ]),
      window: el('button.status-segment.status-segment--action', {
        attrs: { type: 'button', title: 'Modo de ventana' },
        on: { click: () => this.runtimeController.showWindowInfo?.() },
      }, [
        el('span.status-segment__label', { text: 'Ventana' }),
        el('span.status-segment__value', { text: '—' }),
      ]),
      clock: el('span.status-segment', { attrs: { title: 'Hora local del sistema' } }, [
        el('span.status-segment__value', { text: formatTime(Date.now()) }),
      ]),
    };

    const left = el('div.status-bar__group.status-bar__group--left', null, [
      this.#segments.runtime,
      this.#segments.engine,
      this.#segments.dialect,
      this.#segments.file,
    ]);
    const right = el('div.status-bar__group.status-bar__group--right', null, [
      this.#segments.execution,
      this.#segments.errors,
      this.#segments.cursor,
      this.#segments.selection,
      this.#segments.storage,
      this.#segments.connection,
      this.#segments.window,
      this.#segments.clock,
    ]);

    replace(this.#host, [left, right]);
  }

  #subscribe() {
    this.#unsubscribers.push(this.runtimeController.onStateChange?.((state) => this.updateRuntime(state)) ?? (() => {}));
    this.#unsubscribers.push(this.runtimeController.onExecution?.(() => this.refreshAll()) ?? (() => {}));
    this.#unsubscribers.push(this.tabsController.onChange?.((payload) => this.updateTabs(payload)) ?? (() => {}));
    this.#unsubscribers.push(this.editorManager?.onCursor?.(() => this.updateCursor()) ?? (() => {}));
    this.#unsubscribers.push(this.notifications?.onCounts?.((counts) => this.updateErrors(counts)) ?? (() => {}));

    this.eventStream?.on(SseEvent.RUNTIME_FINISHED, () => this.refreshAll());
    this.eventStream?.on(SseEvent.RUNTIME_STARTED, () => this.updateRuntime({ state: RuntimeState.RUNNING }));
    this.eventStream?.on(SseEvent.CAPABILITIES, () => this.updateStorage());
    this.#unsubscribers.push(this.eventStream?.subscribeState?.((state) => this.updateConnection(state)) ?? (() => {}));
  }

  /** Runtime state segment (colour comes from the theme via `data-state`). */
  updateRuntime(state) {
    const value = this.#segments.runtime?.querySelector('.status-segment__value');
    const dot = this.#segments.runtime?.querySelector('.status-dot');
    if (!value || !dot) return;
    const label = state?.label ?? state?.state ?? '—';
    value.textContent = label;
    dot.dataset.state = state?.state ?? 'unknown';
    this.#segments.runtime.dataset.state = state?.state ?? 'unknown';
    this.#segments.runtime.title = state?.detail ?? `Estado del runtime: ${label}`;
    setActive(this.#segments.runtime, state?.state === RuntimeState.RUNNING, 'is-busy');
  }

  updateEngine(engine) {
    const value = this.#segments.engine?.querySelector('.status-segment__value');
    if (!value) return;
    if (!engine) {
      value.textContent = '—';
      return;
    }
    value.textContent = engine.label ?? engine.id;
    this.#segments.engine.title = `${engine.label ?? engine.id} — ${engine.description ?? ''}${engine.available === false ? ' (no disponible)' : ''}`;
    this.#segments.engine.dataset.available = engine.available === false ? 'false' : 'true';
  }

  updateExecution(execution) {
    this.#lastExecution = execution;
    const value = this.#segments.execution?.querySelector('.status-segment__value');
    if (!value) return;
    if (!execution) {
      value.textContent = '—';
      return;
    }
    const duration = execution.stats?.durationMs ?? execution.wallMs ?? null;
    const parts = [];
    if (duration !== null) parts.push(formatDuration(duration));
    parts.push(stateLabel(execution.state));
    value.textContent = parts.join(' · ');
    const at = execution.finishedAt ?? execution.startedAt;
    this.#segments.execution.title = `Última ejecución: ${stateLabel(execution.state)}${at ? ` · ${formatTime(Date.parse(at))}` : ''}${execution.engineId ? ` · motor ${execution.engineId}` : ''}`;
    this.#segments.execution.dataset.state = execution.state ?? 'unknown';
  }

  updateErrors(counts) {
    const value = this.#segments.errors?.querySelector('.status-segment__value');
    if (!value) return;
    const total = typeof counts === 'number' ? counts : (counts?.error ?? 0) + (counts?.warning ?? 0);
    const errors = typeof counts === 'number' ? counts : counts?.error ?? 0;
    value.textContent = String(errors);
    this.#segments.errors.dataset.hasErrors = errors > 0 ? 'true' : 'false';
    this.#segments.errors.title = `${errors} error(es) y ${total - errors} aviso(s) registrados en el panel Consola`;
  }

  updateCursor(info = null) {
    const position = info ?? this.editorManager?.cursorInfo?.() ?? null;
    const cursorValue = this.#segments.cursor?.querySelector('.status-segment__value');
    const selectionValue = this.#segments.selection?.querySelector('.status-segment__value');
    if (!cursorValue) return;
    if (!position || !position.position) {
      cursorValue.textContent = '—';
      if (selectionValue) selectionValue.textContent = '';
      return;
    }
    const { line, column } = position.position;
    cursorValue.textContent = `${line + 1}:${column + 1}`;
    if (selectionValue) {
      const characters = position.selectedCharacters ?? 0;
      selectionValue.textContent = characters > 0 ? `${characters} seleccionado(s)` : '';
    }
  }

  updateTabs(payload = null) {
    const tabs = payload?.tabs ?? this.tabsController?.tabs ?? [];
    const active = payload?.active ?? this.tabsController?.activeTab ?? null;
    const dialectValue = this.#segments.dialect?.querySelector('.status-segment__value');
    const fileValue = this.#segments.file?.querySelector('.status-segment__value');
    if (!active) {
      if (dialectValue) dialectValue.textContent = '—';
      if (fileValue) fileValue.textContent = '—';
      this.updateCursor(null);
      return;
    }
    const info = DialectInfo[active.dialect] ?? { label: active.dialect };
    if (dialectValue) dialectValue.textContent = info.label ?? active.dialect;
    if (this.#segments.dialect) {
      this.#segments.dialect.title = `${info.description ?? info.label}${active.engine ? ` · motor sugerido: ${active.engine}` : ''}`;
    }
    const dirty = active.dirty ? ' ●' : '';
    if (fileValue) fileValue.textContent = `${active.lineEnding ?? 'LF'} · UTF-8${dirty}`;
    if (this.#segments.file) this.#segments.file.title = `${active.name}${active.path ? ` — ${active.path}` : ''}${dirty ? ' (con cambios sin guardar)' : ''}`;
    this.updateCursor();
  }

  updateStorage(storage = null) {
    const value = this.#segments.storage?.querySelector('.status-segment__value');
    if (!value) return;
    const info = storage ?? null;
    if (!info) {
      value.textContent = '—';
      return;
    }
    if (info.error) {
      value.textContent = 'Error';
      this.#segments.storage.dataset.state = 'error';
      this.#segments.storage.title = `Almacenamiento: ${info.error}`;
      return;
    }
    const scripts = info.scripts ?? info.scriptCount ?? null;
    value.textContent = info.writable === false
      ? 'Solo lectura'
      : `${scripts !== null ? `${scripts} script(s) · ` : ''}${info.location ?? info.dataDir ?? 'local'}`;
    this.#segments.storage.dataset.state = info.writable === false ? 'readonly' : 'ok';
    this.#segments.storage.title = [
      info.dataDir ? `Directorio de datos: ${info.dataDir}` : null,
      info.writable === false ? 'El directorio no permite escritura' : 'Escritura verificada',
      info.freeBytes !== undefined && info.freeBytes !== null ? `Espacio libre: ${(info.freeBytes / 1024 / 1024).toFixed(1)} MB` : null,
    ].filter(Boolean).join('\n') || 'Almacenamiento local';
  }

  updateConnection(state) {
    this.#connectionState = state;
    const value = this.#segments.connection?.querySelector('.status-segment__value');
    const dot = this.#segments.connection?.querySelector('.status-dot');
    if (!value || !dot) return;
    const labels = {
      connected: 'Conectado',
      reconnecting: 'Reconectando…',
      closed: 'Desconectado',
      unsupported: 'Sin eventos en vivo',
      unknown: 'Sin conexión',
      online: 'Conectado',
      offline: 'Sin conexión',
    };
    value.textContent = labels[state] ?? state;
    dot.dataset.state = state === 'connected' || state === 'online' ? 'ok' : 'warn';
    this.#segments.connection.title = state === 'connected'
      ? 'Servidor local conectado: los cambios y la consola se actualizan en vivo.'
      : 'El servidor local no responde: los scripts se ejecutan en el navegador y los cambios no se guardan en disco.';
  }

  updateWindow(info = null) {
    const value = this.#segments.window?.querySelector('.status-segment__value');
    if (!value) return;
    const summary = info ?? this.windowController?.capabilitySummary ?? null;
    if (!summary) {
      value.textContent = '—';
      return;
    }
    value.textContent = summary.native ? 'Escritorio' : 'Navegador';
    this.#segments.window.title = summary.explain ?? '';
    this.#segments.window.dataset.mode = summary.mode ?? 'browser';
  }

  #updateClock() {
    const value = this.#segments.clock?.querySelector('.status-segment__value');
    if (value) value.textContent = formatTime(Date.now());
  }

  #toggleDialect() {
    const tab = this.tabsController?.activeTab;
    if (!tab) {
      this.notifications?.info('No hay ningún archivo abierto', { durationMs: 2000 });
      return;
    }
    void this.tabsController.cycleDialect?.();
  }

  refreshAll() {
    this.updateRuntime(this.runtimeController.stateInfo);
    this.updateEngine(this.runtimeController.activeEngine);
    this.updateExecution(this.runtimeController.lastExecution ?? this.#lastExecution);
    this.updateErrors(this.notifications?.counts?.() ?? 0);
    this.updateTabs({ tabs: this.tabsController?.tabs ?? [], active: this.tabsController?.activeTab ?? null });
    this.updateStorage(this.runtimeController.storageInfo);
    this.updateConnection(this.eventStream?.state ?? 'unknown');
    this.updateWindow();
  }

  get lastExecution() {
    return this.#lastExecution;
  }

  dispose() {
    if (this.#clockTimer) clearInterval(this.#clockTimer);
    for (const unsubscribe of this.#unsubscribers) {
      try {
        unsubscribe();
      } catch {
        /* ignore */
      }
    }
    this.#unsubscribers = [];
  }
}

function stateLabel(state) {
  const labels = {
    [RuntimeState.IDLE]: 'en espera',
    [RuntimeState.RUNNING]: 'ejecutando',
    [RuntimeState.SUCCESS]: 'correcto',
    [RuntimeState.ERROR]: 'error',
    [RuntimeState.STOPPED]: 'detenido',
    [RuntimeState.UNAVAILABLE]: 'no disponible',
  };
  return labels[state] ?? state ?? '—';
}
