/**
 * DashboardView — real state of the environment, nothing simulated.
 *
 * Every number comes from an actual source: `/api/stats`, `/api/session`, `/api/activity`, the
 * runtime manager, the tab controller and the editor diagnostics. If a source is unavailable the
 * card says so instead of showing a invented value.
 *
 * Refreshes are scheduled (never a permanent polling loop): one periodic pass every 5 s while the
 * view is visible, plus event-driven refreshes with a debounce.
 */

import { el } from '../../renderer/utils/dom.js';
import { createScheduler } from '../../renderer/utils/async.js';
import { icon } from '../../ui/icons.js';
import { formatBytes, formatDuration, formatNumber, formatRelative, formatUptime } from '../../renderer/utils/format.js';
import { RuntimeState } from '../../shared/constants.js';
import { labelledButton, panel, statCard } from './helpers.js';

const REFRESH_INTERVAL_MS = 5000;

const STATE_TONE = {
  [RuntimeState.IDLE]: 'info',
  [RuntimeState.RUNNING]: 'accent',
  [RuntimeState.SUCCESS]: 'success',
  [RuntimeState.ERROR]: 'error',
  [RuntimeState.STOPPED]: 'warning',
  [RuntimeState.UNAVAILABLE]: 'muted',
};

export class DashboardView {
  #app;
  #root = null;
  #cards = {};
  #sections = {};
  #visible = false;
  #timer = null;
  #refresh = null;
  #stats = null;
  #sessionStartedAt = Date.now();
  #unsubscribers = [];

  constructor(app) {
    this.#app = app;
    this.#refresh = createScheduler(() => void this.reload(), 250);
  }

  get id() {
    return 'dashboard';
  }

  get title() {
    return 'Panel';
  }

  mount() {
    this.#root = el('div.dashboard.view__scroll');

    /* ---------------------------------------------------------------- hero */
    const heroState = el('span.badge');
    const heroSub = el('p.dashboard__hero-sub');
    const heroActions = el('div.btn-group', null, [
      labelledButton({ label: 'Ejecutar', iconName: 'play', variant: 'primary', onClick: () => this.#app.runActive() }),
      labelledButton({ label: 'Detener', iconName: 'stop', onClick: () => this.#app.stopExecution() }),
      labelledButton({ label: 'Nuevo script', iconName: 'plus', onClick: () => this.#app.newScript() }),
      labelledButton({ label: 'Abrir script', iconName: 'folder', onClick: () => this.#app.openPicker() }),
    ]);
    const hero = el('header.dashboard__hero', null, [
      el('div.dashboard__hero-main', null, [
        el('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, [
          el('h1.dashboard__hero-title', { text: 'Panel de control' }),
          heroState,
        ]),
        heroSub,
      ]),
      heroActions,
    ]);
    this.#sections.heroState = heroState;
    this.#sections.heroSub = heroSub;

    /* -------------------------------------------------------------- metrics */
    const grid = el('div.grid.grid--cards', null, [
      this.#cards.scripts = statCard({ label: 'Scripts guardados', iconName: 'scripts' }),
      this.#cards.openTabs = statCard({ label: 'Pestañas abiertas', iconName: 'editor' }),
      this.#cards.executions = statCard({ label: 'Ejecuciones (sesión)', iconName: 'activity' }),
      this.#cards.errors = statCard({ label: 'Errores registrados', iconName: 'alert-triangle' }),
      this.#cards.session = statCard({ label: 'Tiempo de sesión', iconName: 'clock' }),
      this.#cards.lastExecution = statCard({ label: 'Última ejecución', iconName: 'history' }),
      this.#cards.editor = statCard({ label: 'Estado del editor', iconName: 'file-code' }),
      this.#cards.memory = statCard({ label: 'Memoria del servidor', iconName: 'memory' }),
    ]);

    this.#sections.grid = grid;

    /* ------------------------------------------------------------ runtime */
    const runtimeList = el('dl.kv');
    const runtimePanel = panel({
      title: 'Runtime',
      iconName: 'cpu',
      subtitle: 'Motores disponibles, cola y estadísticas reales',
      className: 'dashboard__section',
      body: runtimeList,
      actions: [labelledButton({ label: 'Comprobar', iconName: 'refresh', size: 'sm', onClick: () => this.#app.recheckCapabilities() })],
    });
    this.#sections.runtime = runtimeList;

    /* -------------------------------------------------------- capabilities */
    const capabilityTable = el('div.capability-table');
    const capabilityPanel = panel({
      title: 'Capacidades',
      iconName: 'shield',
      subtitle: 'Lo que este entorno puede hacer de verdad',
      className: 'dashboard__section',
      body: capabilityTable,
      actions: [labelledButton({ label: 'Ver detalles', iconName: 'external-link', size: 'sm', onClick: () => this.#app.switchView('about') })],
    });
    this.#sections.capabilities = capabilityTable;

    /* ------------------------------------------------------------- activity */
    const activityList = el('div.activity');
    const activityPanel = panel({
      title: 'Actividad reciente',
      iconName: 'activity',
      subtitle: 'Ejecuciones, guardados y errores registrados por el servidor',
      className: 'dashboard__section',
      body: activityList,
      actions: [labelledButton({ label: 'Consola', iconName: 'console', size: 'sm', onClick: () => this.#app.switchView('console') })],
    });
    this.#sections.activity = activityList;

    /* -------------------------------------------------------------- storage */
    const storageList = el('dl.kv');
    const storagePanel = panel({
      title: 'Almacenamiento',
      iconName: 'database',
      subtitle: 'Dónde se guardan tus scripts y su configuración',
      className: 'dashboard__section',
      body: storageList,
      actions: [labelledButton({ label: 'Abrir carpeta', iconName: 'folder', size: 'sm', onClick: () => this.#app.showDataFolder() })],
    });
    this.#sections.storage = storageList;

    const twoColumns = el('div.grid.grid--two', null, [runtimePanel, capabilityPanel]);
    this.#sections.runtimePanelBody = runtimeList;
    this.#root.append(hero, grid, twoColumns, el('div.grid.grid--two', null, [activityPanel, storagePanel]));
    return this.#root;
  }

  async activate() {
    this.#visible = true;
    this.#sessionStartedAt = Date.now();
    this.#unsubscribers.push(
      this.#app.runtime.onStateChange(() => this.#refresh.schedule()),
      this.#app.runtime.onExecution(() => this.#refresh.schedule()),
      this.#app.tabs.onChange(() => this.#refresh.schedule()),
      this.#app.scripts.subscribe(() => this.#refresh.schedule()),
      this.#app.errorBus.subscribe(() => this.#refresh.schedule()),
      this.#app.capabilities.onChange(() => this.#refresh.schedule()),
    );
    this.#timer = setInterval(() => void this.reload(), REFRESH_INTERVAL_MS);
    await this.reload();
  }

  deactivate() {
    this.#visible = false;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    for (const unsubscribe of this.#unsubscribers.splice(0)) unsubscribe?.();
  }

  /** Reloads every real source; failures are surfaced, never hidden. */
  async reload() {
    if (!this.#visible) return;
    const results = await Promise.allSettled([
      this.#app.apiClient.get('/api/stats'),
      this.#app.apiClient.get('/api/activity?limit=12'),
    ]);
    const failures = [];
    /**
     * Cada tarjeta se refresca de forma aislada: si una fuente falla se informa con su mensaje
     * real y las demás siguen actualizándose. Sin esto, un error en una tarjeta abortaba el
     * refresco completo y podía realimentarse a través del propio bus de errores.
     */
    const step = (label, render) => {
      try {
        render();
      } catch (err) {
        failures.push(`${label}: ${err?.message ?? String(err)}`);
      }
    };

    if (results[0].status === 'fulfilled') {
      this.#stats = results[0].value;
      step('estadísticas', () => this.#renderStats(results[0].value));
    } else {
      failures.push(`estadísticas: ${results[0].reason?.message ?? 'error'}`);
    }
    if (results[1].status === 'fulfilled') step('actividad', () => this.#renderActivity(results[1].value));
    else failures.push(`actividad: ${results[1].reason?.message ?? 'error'}`);

    step('runtime', () => this.#renderRuntime());
    step('capacidades', () => this.#renderCapabilities());
    step('editor', () => this.#renderEditor());
    step('pestañas', () => this.#renderTabs());
    step('scripts', () => this.#renderScripts());
    try {
      await this.#renderStorage();
    } catch (err) {
      failures.push(`almacenamiento: ${err?.message ?? String(err)}`);
    }

    for (const message of failures) this.#app.logger.warn(`No se pudo actualizar el panel (${message})`, { source: 'DashboardView' });
  }

  #renderStats(stats) {
    const runtime = stats.runtime ?? {};
    const history = stats.history ?? {};
    const errors = stats.errors ?? {};
    this.#sections.heroState.className = `badge badge--${STATE_TONE[runtime.state] ?? 'muted'}`;
    this.#sections.heroState.textContent = `Runtime: ${runtime.state ?? 'desconocido'}`;
    const engine = this.#app.runtime.activeEngine;
    this.#sections.heroSub.textContent = engine
      ? `Motor activo: ${engine.label ?? engine.id} (${engine.id}) · ${runtime.activeExecutions ?? 0} ejecuciones activas · cola ${runtime.queueLength ?? 0}`
      : `Sin motor activo · ${runtime.activeExecutions ?? 0} ejecuciones activas · cola ${runtime.queueLength ?? 0}`;

    const execCount = runtime.stats?.total ?? 0;
    this.#cards.executions.setValue(formatNumber(execCount), `${history.successfulExecutions ?? 0} correctas · ${history.failedExecutions ?? 0} con error`);
    this.#cards.errors.setValue(formatNumber(errors.total ?? 0), errors.lastTimestamp ? `último ${formatRelative(errors.lastTimestamp)}` : 'sin errores registrados');
    this.#cards.lastExecution.setValue(
      runtime.lastExecution ? formatDuration(runtime.lastExecution.durationMs ?? 0) : '—',
      runtime.lastExecution
        ? `${runtime.lastExecution.name ?? 'script'} · ${formatRelative(runtime.lastExecution.startedAt ?? runtime.lastExecution.endedAt)}`
        : 'todavía no se ejecutó nada',
    );
    const memory = stats.process?.memory ?? {};
    this.#cards.memory.setValue(formatBytes(memory.heapUsed ?? 0), `RSS ${formatBytes(memory.rss ?? 0)} · Node ${stats.process?.node ?? '—'}`);
  }

  #renderRuntime() {
    const stats = this.#stats ?? {};
    const runtime = stats.runtime ?? {};
    const analysis = stats.analysis ?? {};
    const engines = this.#app.runtime.engines ?? [];
    const rows = [
      ['Estado', runtime.state ?? 'desconocido'],
      ['Ejecuciones activas', `${runtime.activeExecutions ?? 0} de ${runtime.maxConcurrent ?? '—'} en paralelo · cola ${runtime.queueLength ?? 0}`],
      ['Total de ejecuciones', `${formatNumber(runtime.stats?.total ?? 0)} (éxito ${runtime.stats?.byState?.SUCCESS ?? 0} · error ${runtime.stats?.byState?.ERROR ?? 0} · detenidas ${runtime.stats?.byState?.STOPPED ?? 0})`],
      ['Duración media', runtime.stats?.averageDurationMs === null || runtime.stats?.averageDurationMs === undefined ? 'sin datos' : formatDuration(runtime.stats.averageDurationMs)],
      ['Última ejecución', runtime.lastExecution ? `${runtime.lastExecution.name ?? 'script'} · ${runtime.lastExecution.state ?? ''} · ${formatDuration(runtime.lastExecution.durationMs ?? 0)}` : 'sin datos'],
      ['Motores', engines.length === 0 ? 'ninguno detectado' : engines.map((engine) => `${engine.id} (${engine.state ?? engine.status ?? 'desconocido'})`).join(', ')],
      ['Análisis de tipos', analysis.mode ? `${analysis.mode} · ${analysis.checks ?? 0} comprobaciones · ${analysis.cacheHits ?? 0} aciertos de caché` : 'no disponible'],
    ];
    this.#sections.runtime.replaceChildren(...rows.flatMap(([key, value]) => [el('dt', { text: key }), el('dd', { text: value })]));
  }

  #renderCapabilities() {
    const summary = this.#app.capabilities.summary();
    const entries = this.#app.capabilities.snapshot();
    const node = this.#sections.capabilities;
    const header = el('div.capability-table__row.capability-table__row--head', null, [
      el('span', { text: 'Capacidad' }),
      el('span', { text: 'Estado' }),
      el('span', { text: 'Detalle' }),
    ]);
    const rows = entries.map((entry) => el('div.capability-table__row', null, [
      el('span', { text: entry.label }),
      el('span', null, [el(`span.capability-state.capability-state--${entry.state}`, { text: stateLabel(entry.state) })]),
      el('span', { text: entry.available ? (entry.detail ?? 'operativa') : (entry.dependency ? `falta: ${entry.dependency}` : 'no disponible') }),
    ]));
    node.replaceChildren(
      el('div.capability-summary', { text: `${summary.available} de ${summary.total} capacidades disponibles · ${summary.unavailable} no disponibles · comprobado ${formatRelative(summary.lastCheckAt)}` }),
      header,
      ...rows,
    );
  }

  #renderEditor() {
    const editor = this.#app.editor;
    const diagnostics = editor?.diagnosticsFor?.() ?? [];
    const errors = diagnostics.filter((entry) => entry.severity === 'error').length;
    const warnings = diagnostics.filter((entry) => entry.severity === 'warning').length;
    const active = editor?.activeDocument;
    this.#cards.editor.setValue(
      active ? active.name : 'sin documento',
      active
        ? `${diagnostics.length} diagnósticos (${errors} errores, ${warnings} avisos) · ${formatNumber(editor.getValue?.()?.length ?? 0)} caracteres`
        : 'abre o crea un script para empezar',
    );
  }

  #renderTabs() {
    const tabs = this.#app.tabs;
    const count = tabs?.count ?? 0;
    const dirty = tabs?.dirtyTabs?.().length ?? 0;
    this.#cards.openTabs.setValue(formatNumber(count), `${dirty} sin guardar · ${this.#app.tabs?.stats?.dialects ? Object.entries(this.#app.tabs.stats.dialects).map(([key, value]) => `${key} ${value}`).join(' · ') : 'sin dialectos activos'}`);
  }

  #renderScripts() {
    const scripts = this.#app.scripts;
    const stats = scripts?.getStats?.() ?? {};
    this.#cards.scripts.setValue(formatNumber(stats.total ?? scripts?.size ?? 0), stats.favorites ? `${stats.favorites} favoritos · ${stats.categories ?? 0} categorías` : null);
  }

  async #renderStorage() {
    try {
      const info = await this.#app.apiClient.get('/api/storage/info');
      const storage = info.storage ?? info;
      const entries = [
        ['Carpeta de datos', storage.root ?? '—'],
        ['Scripts', `${formatNumber(storage.counts?.scripts ?? 0)} archivos · ${formatBytes(storage.bytes?.scripts ?? 0)}`],
        ['Historial', `${formatNumber(storage.counts?.history ?? 0)} registros`],
        ['Respaldos', `${formatNumber(storage.counts?.backups ?? 0)} · ${formatBytes(storage.bytes?.backups ?? 0)}`],
        ['Papelera', `${formatNumber(storage.counts?.trash ?? 0)} elementos`],
        ['Espacio libre', storage.disk?.freeBytes ? formatBytes(storage.disk.freeBytes) : 'no disponible'],
      ];
      this.#sections.storage.replaceChildren(...entries.flatMap(([key, value]) => [el('dt', { text: key }), el('dd', { text: String(value) })]));
    } catch (err) {
      this.#sections.storage.replaceChildren(el('dt', { text: 'Almacenamiento' }), el('dd', { text: `no disponible: ${err.message}` }));
    }
  }

  #renderActivity(payload) {
    const records = payload.records ?? [];
    const node = this.#sections.activity;
    if (records.length === 0) {
      node.replaceChildren(el('div.empty', null, [
        icon('activity', { size: 'lg' }),
        el('div.empty__title', { text: 'Todavía no hay actividad' }),
        el('p', { text: 'Ejecuta un script o guarda un archivo y aparecerá aquí.' }),
      ]));
      return;
    }
    node.replaceChildren(...records.slice(0, 12).map((record) => el('div.activity__row', null, [
      el(`span.activity__severity.activity__severity--${severityOf(record)}`, { text: severityLabel(record) }),
      el('div.activity__title', { text: describeActivity(record) }),
      el('span.activity__time', { text: formatRelative(record.timestamp ?? record.at) }),
    ])));
  }

  /** Session clock — updated locally so the card ticks between server refreshes. */
  tick() {
    if (!this.#visible) return;
    const elapsed = Date.now() - this.#sessionStartedAt;
    const boot = this.#stats?.startedAt ? Date.now() - this.#stats.startedAt : null;
    this.#cards.session.setValue(
      formatUptime(elapsed),
      boot === null ? null : `aplicación en marcha desde ${formatUptime(boot)}`,
    );
  }

  get element() {
    return this.#root;
  }
}

function stateLabel(state) {
  return {
    AVAILABLE: 'Disponible',
    UNAVAILABLE: 'No disponible',
    FALLBACK: 'Alternativa',
    UNKNOWN: 'Sin comprobar',
  }[state] ?? state;
}

function severityOf(record) {
  if (record.error || record.state === 'ERROR') return 'error';
  if (record.state === 'STOPPED' || record.timedOut) return 'warning';
  if (record.state === 'SUCCESS' || record.kind === 'script.save') return 'success';
  return 'info';
}

function severityLabel(record) {
  const severity = severityOf(record);
  return { error: 'ERROR', warning: 'AVISO', success: 'OK', info: 'INFO' }[severity];
}

function describeActivity(record) {
  if (record.executed && record.name) return `Ejecución de ${record.name}`;
  if (record.kind === 'script.save') return `Guardado ${record.name ?? record.id ?? ''}`.trim();
  if (record.kind === 'script.delete') return `Script eliminado ${record.name ?? record.id ?? ''}`.trim();
  if (record.kind === 'plugin') return `Plugin ${record.id ?? ''}`.trim();
  if (record.name) return `${record.name} — ${record.state ?? record.kind ?? 'evento'}`;
  return record.message ?? record.kind ?? 'Evento';
}
