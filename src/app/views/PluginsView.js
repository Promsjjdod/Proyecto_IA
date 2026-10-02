/**
 * PluginsView — real plugin management: discovery, enable/disable, reload, rescan, uninstall,
 * manifest inspection (dependencies, permissions, activation events) and per-plugin errors.
 *
 * A plugin that cannot run says exactly why: missing dependency, incompatible API version, broken
 * manifest, execution error or isolation unavailable in this browser.
 */

import { el } from '../../renderer/utils/dom.js';
import { icon } from '../../ui/icons.js';
import { formatBytes, formatDateTime } from '../../renderer/utils/format.js';
import { badge, emptyState, iconButton, kvList, labelledButton, panel } from './helpers.js';

export class PluginsView {
  #app;
  #root = null;
  #nodes = {};
  #unsubscribers = [];
  #selectedId = null;
  #visible = false;

  constructor(app) {
    this.#app = app;
  }

  get id() {
    return 'plugins';
  }

  get title() {
    return 'Plugins';
  }

  mount() {
    this.#root = el('div.view.plugins');
    const header = el('div.view__header', null, [
      el('span.view__title', { text: 'Plugins' }),
      el('span.view__subtitle', { text: 'Extensiones aisladas en workers, con permisos declarados' }),
      el('div.toolbar__spacer'),
      el('div.toolbar__group', null, [
        labelledButton({ label: 'Volver a escanear', iconName: 'refresh', size: 'sm', onClick: () => void this.#rescan() }),
        labelledButton({ label: 'Abrir carpeta', iconName: 'folder', size: 'sm', onClick: () => this.#app.showDataFolder('plugins') }),
      ]),
    ]);
    this.#nodes.subtitle = header.querySelector('.view__subtitle');

    const list = el('div.list', { attrs: { role: 'listbox', 'aria-label': 'Plugins instalados' } });
    const listPane = el('div.view__pane.view__pane--grow', null, [el('div.view__scroll', { style: { padding: '0' } }, [list])]);
    const detail = el('div.view__pane.view__pane--side.plugins__detail');
    this.#nodes.list = list;
    this.#nodes.detail = detail;

    this.#root.append(header, el('div.view__body', null, [listPane, detail]));
    return this.#root;
  }

  async activate() {
    this.#visible = true;
    this.#unsubscribers.push(this.#app.plugins.subscribe(() => this.#renderList()));
    await this.#app.plugins.refresh().catch(() => {});
    this.#renderList();
    void this.#renderDetail(null);
  }

  deactivate() {
    this.#visible = false;
    for (const unsubscribe of this.#unsubscribers.splice(0)) unsubscribe?.();
  }

  async reload() {
    await this.#app.plugins.refresh().catch(() => {});
    this.#renderList();
  }

  #renderList() {
    const host = this.#app.plugins;
    const plugins = host.list();
    const stats = host.stats();
    this.#nodes.subtitle.textContent = `${plugins.length} detectados · ${stats.running ?? 0} en ejecución · ${stats.commands ?? 0} comandos aportados`;
    const list = this.#nodes.list;

    if (!host.available) {
      list.replaceChildren(emptyState({
        title: 'Los plugins no pueden ejecutarse en este entorno',
        message: host.unavailableReason,
        iconName: 'puzzle',
      }));
      return;
    }
    if (plugins.length === 0) {
      list.replaceChildren(emptyState({
        title: 'No hay plugins instalados',
        message: 'Coloca una carpeta con plugin.json e index.js en la carpeta de plugins y pulsa «Volver a escanear».',
        iconName: 'puzzle',
        action: labelledButton({ label: 'Abrir carpeta de plugins', iconName: 'folder', onClick: () => this.#app.showDataFolder('plugins') }),
      }));
      return;
    }

    list.replaceChildren(...plugins.map((plugin) => {
      const selected = plugin.id === this.#selectedId;
      const broken = plugin.problems?.length > 0 || plugin.lastError !== null || plugin.resolvable === false;
      return el(`div.list__row.plugin${selected ? '.is-selected' : ''}${broken ? '.is-error' : ''}`, {
        attrs: { role: 'option', 'aria-selected': selected ? 'true' : 'false', tabindex: '0' },
        on: {
          click: () => {
            this.#selectedId = plugin.id;
            this.#renderList();
            void this.#renderDetail(plugin);
          },
          keydown: (event) => {
            if (event.key === 'Enter') {
              this.#selectedId = plugin.id;
              void this.#renderDetail(plugin);
            }
          },
        },
      }, [
        el('span.list__title', null, [icon('puzzle', { size: 'sm' }), el('span', { text: plugin.name })]),
        el('div.plugin__main', null, [
          el('div.plugin__title', { text: `v${plugin.version ?? '—'} · API ${plugin.apiVersion ?? '—'}` }),
          el('div.plugin__description', { text: plugin.problems?.[0] ?? plugin.description ?? 'Sin descripción' }),
          el('div.plugin__meta', {
            text: [
              plugin.author ? `por ${plugin.author}` : null,
              plugin.builtin ? 'incluido' : 'de usuario',
              plugin.permissions.length > 0 ? `${plugin.permissions.length} permisos` : 'sin permisos',
            ].filter(Boolean).join(' · '),
          }),
        ]),
        el('div.plugin__actions', null, [
          plugin.missingDependencies?.length > 0 ? badge('dependencias', 'warning') : null,
          plugin.resolvable === false ? badge('no resoluble', 'error') : null,
          plugin.lastError ? badge('con errores', 'error') : null,
          badge(plugin.enabled ? 'activo' : 'desactivado', plugin.enabled ? 'success' : 'muted'),
          badge(host.list().find((item) => item.id === plugin.id)?.running ? 'en ejecución' : plugin.enabled ? 'detenido' : '—', plugin.enabled ? 'info' : 'muted'),
          el('span', { text: '' }),
        ]),
      ]);
    }));
  }

  async #renderDetail(plugin) {
    const body = this.#nodes.detail;
    if (!plugin) {
      body.replaceChildren(emptyState({
        title: 'Selecciona un plugin',
        message: 'Verás su manifiesto, sus permisos, sus comandos y sus errores.',
        iconName: 'puzzle',
      }));
      return;
    }
    const commands = plugin.commands ?? [];
    const running = plugin.running === true;
    body.replaceChildren(
      el('div.scripts__detail-title', null, [
        el('div', null, [
          el('h2', { text: plugin.name }),
          el('div.list__meta', { text: `${plugin.id} · v${plugin.version ?? '—'} · ${plugin.builtin ? 'incluido' : 'de usuario'}` }),
        ]),
        iconButton({ iconName: 'refresh', title: 'Recargar este plugin', onClick: () => void this.#reload(plugin) }),
      ]),
      el('p', { text: plugin.description ?? 'Sin descripción.' }),
      kvList([
        ['Autor', plugin.author ?? '—'],
        ['Licencia', plugin.license ?? '—'],
        ['API', plugin.apiVersion ?? '—'],
        ['Estado', plugin.enabled ? (running ? 'activo y en ejecución' : 'activo (detenido)') : 'desactivado'],
        ['Dependencias', plugin.dependencies.length > 0 ? plugin.dependencies.join(', ') : 'ninguna'],
        ['Dependencias faltantes', plugin.missingDependencies.length > 0 ? plugin.missingDependencies.join(', ') : 'ninguna'],
        ['Eventos de activación', plugin.activationEvents.length > 0 ? plugin.activationEvents.join(', ') : 'onStartup (por defecto)'],
        ['Carpeta', plugin.directory ?? '—'],
        ['Tamaño', plugin.sizeBytes ? `${formatBytes(plugin.sizeBytes)} (${plugin.entry ?? 'index.js'})` : '—'],
        ['Modificado', plugin.modifiedAt ? formatDateTime(plugin.modifiedAt) : '—'],
      ]),
      el('div', null, [
        el('div.card__hint', { text: 'Permisos declarados' }),
        el('div.chip-list', null, plugin.permissions.length > 0
          ? plugin.permissions.map((permission) => el('span.chip', { text: permission }))
          : [el('span.chip', { text: 'ninguno' })]),
      ]),
      el('div.btn-group', { style: { marginTop: '10px', flexWrap: 'wrap' } }, [
        labelledButton({
          label: plugin.enabled ? 'Desactivar' : 'Activar',
          iconName: plugin.enabled ? 'close' : 'check',
          size: 'sm',
          variant: plugin.enabled ? 'ghost' : 'primary',
          onClick: () => void this.#toggle(plugin),
        }),
        labelledButton({ label: 'Recargar', iconName: 'refresh', size: 'sm', onClick: () => void this.#reload(plugin) }),
        labelledButton({ label: 'Desinstalar', iconName: 'trash', size: 'sm', variant: 'danger', onClick: () => void this.#uninstall(plugin), disabled: plugin.canUninstall !== true }),
      ]),
      commands.length > 0
        ? panel({
          title: `Comandos aportados (${commands.length})`,
          iconName: 'terminal',
          flush: true,
          body: el('div.list', null, commands.map((commandId) => el('div.list__row', null, [
            el('div.list__main', null, [
              el('div.list__title', { text: commandId }),
              el('div.list__meta', { text: 'Disponible en la paleta de comandos (Ctrl+Shift+P)' }),
            ]),
          ]))),
        })
        : null,
      plugin.problems?.length > 0
        ? panel({
          title: 'Problemas del manifiesto',
          iconName: 'alert-triangle',
          body: el('div', null, plugin.problems.map((problem) => el('div.diagnostic.diagnostic--error', null, [
            icon('x-circle', { size: 'sm' }),
            el('span', { text: problem }),
          ]))),
        })
        : null,
      plugin.lastError
        ? panel({
          title: 'Último error registrado',
          iconName: 'bug',
          body: el('div', null, [
            el('div.diagnostic.diagnostic--error', null, [
              icon('x-circle', { size: 'sm' }),
              el('span', { text: plugin.lastError.message }),
            ]),
            el('div.list__meta', { text: `fase ${plugin.lastError.phase ?? 'runtime'} · ${plugin.lastError.timestamp ? formatDateTime(plugin.lastError.timestamp) : ''}` }),
            plugin.lastError.stack ? el('pre.code', { text: plugin.lastError.stack }) : null,
          ]),
        })
        : null,
    );
  }

  async #toggle(plugin) {
    try {
      if (plugin.enabled) {
        await this.#app.plugins.disable(plugin.id);
        this.#app.notifications.info(`Plugin «${plugin.name}» desactivado`);
      } else {
        await this.#app.plugins.enable(plugin.id);
        this.#app.notifications.success(`Plugin «${plugin.name}» activado`);
      }
      this.#renderList();
      void this.#renderDetail(this.#app.plugins.list().find((item) => item.id === plugin.id));
    } catch (err) {
      this.#app.notifications.error(`No se pudo cambiar el estado de «${plugin.name}»: ${err.message}`);
    }
  }

  async #reload(plugin) {
    try {
      await this.#app.plugins.reload(plugin.id);
      this.#app.notifications.success(`Plugin «${plugin.name}» recargado`);
      this.#renderList();
      void this.#renderDetail(this.#app.plugins.list().find((item) => item.id === plugin.id));
    } catch (err) {
      this.#app.notifications.error(`No se pudo recargar «${plugin.name}»: ${err.message}`);
    }
  }

  async #rescan() {
    try {
      const result = await this.#app.plugins.rescan();
      this.#app.notifications.success(`Reescaneo completado: ${result.discovered} plugins${result.errors?.length ? ` · ${result.errors.length} problemas` : ''}`);
      await this.#app.plugins.init();
      this.#renderList();
      void this.#renderDetail(null);
    } catch (err) {
      this.#app.notifications.error(`No se pudo volver a escanear: ${err.message}`);
    }
  }

  async #uninstall(plugin) {
    const confirmed = this.#app.settings.get('general.confirmDestructive') === false
      ? true
      : await this.#app.dialogs.confirm({
        title: 'Desinstalar plugin',
        message: `Se moverá «${plugin.name}» a la papelera de la carpeta de datos.`,
        confirmLabel: 'Desinstalar',
        danger: true,
      });
    if (!confirmed) return;
    try {
      await this.#app.plugins.uninstall(plugin.id);
      this.#app.notifications.success(`Plugin «${plugin.name}» desinstalado`);
      this.#selectedId = null;
      this.#renderList();
      void this.#renderDetail(null);
    } catch (err) {
      this.#app.notifications.error(`No se pudo desinstalar «${plugin.name}»: ${err.message}`);
    }
  }

  get element() {
    return this.#root;
  }
}
