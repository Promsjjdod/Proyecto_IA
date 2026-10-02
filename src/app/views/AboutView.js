/**
 * AboutView — everything the user needs to understand the environment they are running:
 * versions, real capability states (with the missing dependency when unavailable), the kernel
 * boot report, storage paths and a real diagnostics download.
 */

import { el } from '../../renderer/utils/dom.js';
import { icon } from '../../ui/icons.js';
import { formatBytes, formatDateTime, formatDuration, formatUptime } from '../../renderer/utils/format.js';
import { badge, labelledButton, panel } from './helpers.js';

export class AboutView {
  #app;
  #root = null;
  #nodes = {};
  #visible = false;

  constructor(app) {
    this.#app = app;
  }

  get id() {
    return 'about';
  }

  get title() {
    return 'Acerca de';
  }

  mount() {
    this.#root = el('div.about.view__scroll');
    const logo = el('header.about__head', null, [
      el('div.about__logo', { text: 'L' }),
      el('div', null, [
        el('h1', { text: 'Lumen Studio' }),
        el('p', { text: 'Entorno profesional de edición y ejecución de scripts Lua y Luau.' }),
      ]),
      el('div.toolbar__spacer'),
      el('div.btn-group', null, [
        labelledButton({ label: 'Recomprobar capacidades', iconName: 'refresh', size: 'sm', onClick: () => this.#recheck() }),
        labelledButton({ label: 'Informe de diagnóstico', iconName: 'download', size: 'sm', onClick: () => void this.#downloadDiagnostics() }),
      ]),
    ]);

    const versions = el('div.grid.grid--two');
    const capabilityPanel = panel({
      title: 'Capacidades del entorno',
      iconName: 'shield',
      subtitle: 'Estado real tras la última comprobación',
      flush: true,
      body: el('div', null, [el('div.capability-table')]),
    });
    const bootPanel = panel({
      title: 'Arranque del núcleo',
      iconName: 'cpu',
      subtitle: 'Servicios registrados y su tiempo real de inicialización',
      flush: true,
      body: el('div.list'),
    });
    this.#nodes.versions = versions;
    this.#nodes.capabilities = capabilityPanel.querySelector('.capability-table');
    this.#nodes.boot = bootPanel.querySelector('.list');

    this.#root.append(
      logo,
      versions,
      el('div.grid.grid--two', null, [capabilityPanel, bootPanel]),
    );
    return this.#root;
  }

  async activate() {
    this.#visible = true;
    await this.reload();
  }

  deactivate() {
    this.#visible = false;
  }

  async reload() {
    if (!this.#visible) return;
    await this.#renderVersions();
    this.#renderCapabilities();
    this.#renderBoot();
  }

  async #renderVersions() {
    let health = null;
    let stats = null;
    try {
      health = await this.#app.apiClient.get('/api/health');
    } catch (err) {
      health = { error: err };
    }
    try {
      stats = await this.#app.apiClient.get('/api/stats');
    } catch {
      stats = null;
    }
    const kernel = this.#app.kernel.describe();
    const capabilities = this.#app.capabilities.summary();
    const rows = [
      ['Aplicación', `${health?.app?.name ?? 'Lumen Studio'} ${health?.app?.version ?? ''}`.trim()],
      ['Compilación de la interfaz', typeof __LUMEN_BUILD__ === 'string' ? formatDateTime(Date.parse(__LUMEN_BUILD__)) : 'desconocida'],
      ['Servidor', health?.ok ? `activo desde ${formatUptime(health.uptimeMs)} · Node ${health.node} · PID ${health.pid}` : `no disponible${health?.error ? `: ${health.error.message}` : ''}`],
      ['Plataforma', stats ? `${stats.host?.platform} ${stats.host?.arch} · ${stats.host?.cpus} CPU · ${formatBytes(stats.host?.totalMemoryBytes)} de memoria` : 'no disponible'],
      ['Navegador', navigator.userAgent],
      ['Idioma', document.documentElement.lang],
      ['Servicios del núcleo', `${kernel.length} registrados · ${kernel.filter((service) => service.initialized).length} inicializados`],
      ['Capacidades', `${capabilities.available} de ${capabilities.total} disponibles · ${capabilities.unavailable} no disponibles`],
      ['Rutas de la API', stats ? String(stats.api?.routes ?? '—') : '—'],
      ['Espacio de trabajo', this.#app.storageRoot ?? 'desconocido'],
      ['Sesión de la aplicación', formatUptime(Date.now() - this.#app.startedAt)],
    ];
    this.#nodes.versions.replaceChildren(...rows.map(([label, value]) => el('div.card', null, [
      el('div.card__label', { text: label }),
      el('div.card__value.card__value--sm', { text: String(value) }),
    ])));
  }

  #renderCapabilities() {
    const entries = this.#app.capabilities.snapshot();
    const node = this.#nodes.capabilities;
    node.replaceChildren(
      el('div.capability-table__row.capability-table__row--head', null, [
        el('span', { text: 'Capacidad' }),
        el('span', { text: 'Estado' }),
        el('span', { text: 'Dependencia / detalle' }),
      ]),
      ...entries.map((entry) => el('div.capability-table__row', null, [
        el('span', null, [
          el('strong', { text: entry.label }),
          el('span.card__hint', { text: ` ${entry.id}` }),
        ]),
        el('span', null, [el(`span.capability-state.capability-state--${entry.state}`, { text: entry.state })]),
        el('span', null, [
          entry.available
            ? el('span', { text: entry.detail ?? 'operativa' })
            : el('span', null, [
              el('span', { text: entry.dependency ? `Falta: ${entry.dependency}. ` : '' }),
              el('span', { text: entry.detail ?? 'No disponible en este entorno.' }),
            ]),
        ]),
      ])),
    );
  }

  #renderBoot() {
    const report = this.#app.kernel.bootReport ?? [];
    const node = this.#nodes.boot;
    if (report.length === 0) {
      node.replaceChildren(el('div.list__empty', { text: 'El núcleo todavía no ha registrado su informe.' }));
      return;
    }
    node.replaceChildren(...report.map((step) => el('div.list__row', null, [
      el('div.list__main', null, [
        el('div.list__title', { text: step.label }),
        el('div.list__meta', {
          text: step.ok
            ? `${step.name} · ${formatDuration(step.durationMs ?? 0)}${step.skipped ? ` · ${step.skipped}` : ''}`
            : `falló: ${step.error?.message ?? 'error desconocido'}${step.critical ? ' (crítico)' : ''}`,
        }),
      ]),
      step.ok ? badge('ok', 'success') : badge('error', 'error'),
    ])));
  }

  async #recheck() {
    const result = await this.#app.recheckCapabilities();
    this.#app.notifications.info(result?.message ?? 'Capacidades recompuestas');
    await this.reload();
  }

  async #downloadDiagnostics() {
    const result = await this.#app.downloadDiagnostics();
    if (result.ok) this.#app.notifications.success(`Informe guardado: ${result.filename}`);
    else this.#app.notifications.error(result.error?.message ?? 'No se pudo generar el informe');
  }

  get element() {
    return this.#root;
  }
}
