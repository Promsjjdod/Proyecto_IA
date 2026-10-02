/**
 * ScriptsView — the script library: filters, list, detail pane with real metadata, history and
 * backups, and every file operation (open, run, rename, duplicate, favourite, export, delete).
 *
 * All data comes from `ScriptManager` (which talks to the real API) — the view never invents a
 * script or a metadata field.
 */

import { el } from '../../renderer/utils/dom.js';
import { createScheduler } from '../../renderer/utils/async.js';
import { icon } from '../../ui/icons.js';
import { formatBytes, formatDateTime, formatNumber, formatRelative } from '../../renderer/utils/format.js';
import { ScriptCategory, SortMode } from '../../shared/constants.js';
import { badge, emptyState, iconButton, kvList, labelledButton, panel, searchInput } from './helpers.js';

const SORT_OPTIONS = [
  { value: SortMode.MODIFIED_DESC, label: 'Modificados (recientes)' },
  { value: SortMode.MODIFIED_ASC, label: 'Modificados (antiguos)' },
  { value: SortMode.NAME_ASC, label: 'Nombre (A→Z)' },
  { value: SortMode.NAME_DESC, label: 'Nombre (Z→A)' },
  { value: SortMode.CREATED_DESC, label: 'Creados (recientes)' },
  { value: SortMode.SIZE_DESC, label: 'Tamaño (mayor primero)' },
];

const CATEGORY_LABELS = {
  [ScriptCategory.EXAMPLES]: 'Ejemplos',
  [ScriptCategory.PROJECTS]: 'Proyectos',
  [ScriptCategory.SNIPPETS]: 'Fragmentos',
  [ScriptCategory.IMPORTED]: 'Importados',
  [ScriptCategory.TESTS]: 'Pruebas',
  [ScriptCategory.ARCHIVE]: 'Archivo',
};

export class ScriptsView {
  #app;
  #root = null;
  #nodes = {};
  #selectedId = null;
  #unsubscribers = [];
  #search = null;
  #visible = false;

  constructor(app) {
    this.#app = app;
    this.#search = createScheduler(() => void this.#applyFilters(), 250);
  }

  get id() {
    return 'scripts';
  }

  get title() {
    return 'Scripts';
  }

  mount() {
    this.#root = el('div.view');

    /* ------------------------------------------------------------- filters */
    const search = searchInput({
      placeholder: 'Buscar por nombre, etiqueta o contenido…',
      on: () => this.#search.schedule(),
    });
    const contentToggle = el('label.switch', null, [
      el('input', { attrs: { type: 'checkbox' }, on: { change: () => this.#applyFilters() } }),
      el('span.switch__track', null, [el('span.switch__thumb')]),
      el('span', { text: 'Buscar dentro del contenido' }),
    ]);
    const categorySelect = el('select.select', {
      attrs: { title: 'Categoría', 'aria-label': 'Filtrar por categoría' },
      on: { change: () => this.#applyFilters() },
    });
    const sortSelect = el('select.select', {
      attrs: { title: 'Orden', 'aria-label': 'Ordenar por' },
      on: { change: () => this.#applyFilters() },
    }, SORT_OPTIONS.map((option) => el('option', { value: option.value, text: option.label })));
    const favoritesToggle = el('button.btn.btn--ghost.btn--sm', {
      attrs: { type: 'button', 'aria-pressed': 'false', title: 'Mostrar solo favoritos' },
      on: {
        click: () => {
          const active = favoritesToggle.getAttribute('aria-pressed') === 'true';
          favoritesToggle.setAttribute('aria-pressed', String(!active));
          favoritesToggle.classList.toggle('is-active', !active);
          this.#applyFilters();
        },
      },
    }, [icon('star', { size: 'sm' }), el('span', { text: 'Favoritos' })]);

    const header = el('div.view__header', null, [
      el('span.view__title', { text: 'Biblioteca de scripts' }),
      el('span.view__subtitle', { text: '' }),
      el('div.toolbar__spacer'),
      el('div.toolbar__group', null, [
        labelledButton({ label: 'Nuevo', iconName: 'plus', variant: 'primary', size: 'sm', onClick: () => this.#app.newScript() }),
        labelledButton({ label: 'Importar', iconName: 'upload', size: 'sm', onClick: () => this.#app.importScript() }),
        iconButton({ iconName: 'refresh', title: 'Recargar desde el disco', size: 'sm', onClick: () => this.#app.syncScripts() }),
      ]),
    ]);
    this.#nodes.subtitle = header.querySelector('.view__subtitle');

    const filters = el('div.filters', null, [search, categorySelect, sortSelect, favoritesToggle, contentToggle]);
    this.#nodes.search = search.querySelector('input');
    this.#nodes.contentToggle = contentToggle.querySelector('input');
    this.#nodes.categorySelect = categorySelect;
    this.#nodes.sortSelect = sortSelect;
    this.#nodes.favoritesToggle = favoritesToggle;

    /* ---------------------------------------------------------------- list */
    const list = el('div.list', { attrs: { role: 'listbox', 'aria-label': 'Scripts' } });
    const listPane = el('div.view__pane.view__pane--grow', null, [filters, el('div.scripts__scroll', null, [list])]);
    this.#nodes.list = list;

    /* -------------------------------------------------------------- detail */
    const detailBody = el('div.scripts__detail-body');
    const detail = el('div.view__pane.view__pane--side.scripts__detail', null, [detailBody]);
    this.#nodes.detail = detailBody;

    this.#root.appendChild(header);
    this.#root.appendChild(el('div.view__body', null, [listPane, detail]));
    return this.#root;
  }

  async activate() {
    this.#visible = true;
    this.#unsubscribers.push(
      this.#app.scripts.subscribe(() => this.#renderList()),
      this.#app.tabs.onChange(() => this.#renderList()),
      this.#app.editor.onEvent(() => this.#renderList()),
    );
    await this.#app.scripts.refresh().catch(() => {});
    this.#renderCategories();
    this.#renderList();
  }

  deactivate() {
    this.#visible = false;
    for (const unsubscribe of this.#unsubscribers.splice(0)) unsubscribe?.();
  }

  async reload() {
    this.#renderCategories();
    this.#renderList();
  }

  #renderCategories() {
    const categories = this.#app.scripts.categories ?? [];
    const current = this.#app.scripts.filters.category ?? '';
    this.#nodes.categorySelect.replaceChildren(
      el('option', { value: '', text: 'Todas las categorías' }),
      ...categories.map((category) => el('option', {
        value: category.id ?? category.category ?? category,
        text: `${CATEGORY_LABELS[category.id ?? category] ?? category.label ?? category.id ?? category} (${category.count ?? ''})`.trim(),
        selected: current === (category.id ?? category),
      })),
    );
    this.#nodes.categorySelect.value = current;
    this.#nodes.sortSelect.value = this.#app.scripts.filters.sort ?? SortMode.MODIFIED_DESC;
  }

  async #applyFilters() {
    const filters = {
      query: this.#nodes.search.value.trim(),
      inContent: this.#nodes.contentToggle.checked,
      category: this.#nodes.categorySelect.value || null,
      sort: this.#nodes.sortSelect.value,
      favoriteOnly: this.#nodes.favoritesToggle.getAttribute('aria-pressed') === 'true',
    };
    this.#app.scripts.setFilters({
      query: filters.query,
      category: filters.category,
      sort: filters.sort,
      favoriteOnly: filters.favoriteOnly,
    });
    if (filters.query !== '' && filters.inContent) {
      const result = await this.#app.scripts.search(filters.query, { inContent: true });
      this.#renderList(result.results ?? [], { searchedContent: true });
      return;
    }
    await this.#app.scripts.refresh().catch(() => {});
    this.#renderList();
  }

  #renderList(overrideList = null, { searchedContent = false } = {}) {
    const scripts = overrideList ?? this.#app.scripts.scripts;
    const node = this.#nodes.list;
    const stats = this.#app.scripts.getStats();
    this.#nodes.subtitle.textContent = this.#app.scripts.serverAvailable
      ? `${formatNumber(stats.total ?? scripts.length)} scripts · ${stats.favorites ?? 0} favoritos${searchedContent ? ' · búsqueda en contenido' : ''}`
      : 'servidor no disponible — no se pueden listar los scripts guardados';

    if (scripts.length === 0) {
      node.replaceChildren(emptyState({
        title: this.#app.scripts.serverAvailable ? 'Todavía no hay scripts guardados' : 'No se pudo cargar la biblioteca',
        message: this.#app.scripts.serverAvailable
          ? 'Crea tu primer script Luau: se guardará en la carpeta de datos con su historial y respaldos.'
          : 'Revisa la conexión con el servidor local en la vista «Acerca de».',
        iconName: 'scripts',
        action: labelledButton({ label: 'Crear script', iconName: 'plus', variant: 'primary', onClick: () => this.#app.newScript() }),
      }));
      this.#renderDetail(null);
      return;
    }

    node.replaceChildren(...scripts.slice(0, 400).map((script) => {
      const selected = script.id === this.#selectedId;
      const row = el(`div.list__row.script-row${selected ? '.is-selected' : ''}${script.favorite ? '.is-favorite' : ''}`, {
        attrs: { role: 'option', 'aria-selected': selected ? 'true' : 'false', tabindex: '0', 'data-id': script.id },
        on: {
          click: () => {
            this.#selectedId = script.id;
            this.#renderList(overrideList, { searchedContent });
            void this.#renderDetail(script);
          },
          dblclick: () => void this.#openScript(script.id),
          keydown: (event) => {
            if (event.key === 'Enter') void this.#openScript(script.id);
          },
        },
      }, [
        el('span.script-row__icon', null, [icon(script.favorite ? 'star' : 'file-code', { size: 'sm' })]),
        el('div.list__main', null, [
          el('div.list__title', null, [
            el('span', { text: script.name }),
            script.dirty ? el('span.tab__dot', { attrs: { title: 'Cambios sin guardar' } }) : null,
            script.open ? badge('abierto', 'info') : null,
          ]),
          el('div.list__meta', {
            text: [
              script.dialect === 'lua54' ? 'Lua 5.4' : script.dialect === 'lua51' ? 'Lua 5.1' : 'Luau',
              CATEGORY_LABELS[script.category] ?? script.category ?? 'sin categoría',
              script.size ? formatBytes(script.size) : null,
              script.modifiedAt ? `modificado ${formatRelative(script.modifiedAt)}` : null,
              script.runCount ? `${script.runCount} ejecuciones` : null,
            ].filter(Boolean).join(' · '),
          }),
        ]),
        el('div.list__actions', null, [
          el('span.script-row__tags', null, (script.tags ?? []).slice(0, 3).map((tag) => badge(tag))),
          iconButton({
            iconName: 'star',
            title: script.favorite ? 'Quitar de favoritos' : 'Marcar como favorito',
            size: 'sm',
            active: script.favorite === true,
            onClick: (event) => {
              event.stopPropagation();
              void this.#toggleFavorite(script);
            },
          }),
        ]),
      ]);
      return row;
    }));
  }

  async #toggleFavorite(script) {
    const result = await this.#app.scripts.setFavorite(script.id, !script.favorite);
    if (result.ok) this.#app.notifications.success(`${script.name}: ${result.script.favorite ? 'añadido a' : 'quitado de'} favoritos`);
  }

  async #openScript(id) {
    const result = await this.#app.scripts.open(id, { focus: true });
    if (result.ok === false) {
      this.#app.notifications.error(result.error?.message ?? `No se pudo abrir el script`);
      return;
    }
    this.#app.switchView('editor');
  }

  async #runScript(script) {
    const result = await this.#app.scripts.runOnServer(script.id, {
      timeoutMs: this.#app.settings.get('execution.timeoutMs') ?? 5000,
      recordExecution: this.#app.settings.get('execution.recordHistory') !== false,
    });
    if (!result.ok) {
      this.#app.notifications.error(result.error?.message ?? `No se pudo ejecutar ${script.name}`);
      return;
    }
    this.#app.notifications.success(`Ejecución registrada de ${script.name}`);
  }

  async #renderDetail(script) {
    const body = this.#nodes.detail;
    if (!script) {
      body.replaceChildren(emptyState({
        title: 'Selecciona un script',
        message: 'Aquí verás sus metadatos, su historial de ejecuciones y sus respaldos.',
        iconName: 'file-code',
      }));
      return;
    }
    const stats = this.#app.scripts.getStats();
    body.replaceChildren(
      el('div.scripts__detail-title', null, [
        el('div', null, [
          el('h2', { text: script.name }),
          el('div.list__meta', { text: [script.dialect, CATEGORY_LABELS[script.category] ?? script.category].filter(Boolean).join(' · ') }),
        ]),
        iconButton({ iconName: script.favorite ? 'star' : 'star', title: 'Alternar favorito', active: script.favorite, onClick: () => void this.#toggleFavorite(script) }),
      ]),
      kvList([
        ['Ruta', script.path ?? '—'],
        ['Creado', script.createdAt ? formatDateTime(script.createdAt) : '—'],
        ['Modificado', script.modifiedAt ? `${formatDateTime(script.modifiedAt)} (${formatRelative(script.modifiedAt)})` : '—'],
        ['Tamaño', script.size ? formatBytes(script.size) : '—'],
        ['Ejecuciones', formatNumber(script.runCount ?? 0)],
        ['Última ejecución', script.lastRunAt ? formatRelative(script.lastRunAt) : 'nunca'],
        ['Etiquetas', (script.tags ?? []).join(', ') || '—'],
        ['Descripción', script.description || '—'],
        ['Integridad', script.checksum ? `${String(script.checksum).slice(0, 12)}…` : '—'],
      ]),
      el('div.btn-group', { style: { marginTop: '10px', flexWrap: 'wrap' } }, [
        labelledButton({ label: 'Abrir', iconName: 'editor', size: 'sm', variant: 'primary', onClick: () => void this.#openScript(script.id) }),
        labelledButton({ label: 'Ejecutar', iconName: 'play', size: 'sm', onClick: () => void this.#runScript(script) }),
        labelledButton({ label: 'Renombrar', iconName: 'edit', size: 'sm', onClick: () => void this.#rename(script) }),
        labelledButton({ label: 'Duplicar', iconName: 'copy', size: 'sm', onClick: () => void this.#duplicate(script) }),
        labelledButton({ label: 'Exportar', iconName: 'download', size: 'sm', onClick: () => void this.#export(script) }),
        labelledButton({ label: 'Etiquetas', iconName: 'tag', size: 'sm', onClick: () => void this.#editMetadata(script) }),
        labelledButton({ label: 'Eliminar', iconName: 'trash', size: 'sm', variant: 'danger', onClick: () => void this.#remove(script) }),
      ]),
      panel({
        title: 'Historial de ejecuciones',
        iconName: 'history',
        flush: true,
        body: el('div.list', null, [el('div.list__empty', { text: 'Cargando historial…' })]),
        className: 'scripts__history',
      }),
      panel({
        title: 'Respaldos',
        iconName: 'database',
        flush: true,
        body: el('div.list', null, [el('div.list__empty', { text: 'Cargando respaldos…' })]),
        className: 'scripts__backups',
      }),
      el('p.card__hint', { text: `Historial de la sesión del servidor: ${formatNumber(stats.historyRecords ?? 0)} registros guardados.` }),
    );

    const [historyResult, backupsResult] = await Promise.all([
      this.#app.scripts.history(script.id, 25),
      this.#app.scripts.backups(script.id),
    ]);
    const historyList = body.querySelector('.scripts__history .list');
    const records = historyResult.records ?? [];
    historyList.replaceChildren(records.length === 0
      ? el('div.list__empty', { text: 'Este script todavía no se ha ejecutado.' })
      : el('div', null, records.map((record) => el('div.list__row', null, [
        el('div.list__main', null, [
          el('div.list__title', { text: `${record.state ?? record.kind ?? 'registro'} · ${record.engineId ?? ''}`.trim() }),
          el('div.list__meta', {
            text: [
              record.startedAt ? formatDateTime(record.startedAt) : null,
              Number.isFinite(record.durationMs) ? `${record.durationMs} ms` : null,
              record.error?.message ?? null,
            ].filter(Boolean).join(' · '),
          }),
        ]),
        record.state ? badge(record.state, record.state === 'SUCCESS' ? 'success' : record.state === 'ERROR' ? 'error' : 'muted') : null,
      ]))));

    const backupsList = body.querySelector('.scripts__backups .list');
    const backups = backupsResult.backups ?? [];
    backupsList.replaceChildren(backups.length === 0
      ? el('div.list__empty', { text: 'Sin respaldos todavía.' })
      : el('div', null, backups.slice(0, 10).map((backup) => el('div.list__row', null, [
        el('div.list__main', null, [
          el('div.list__title', { text: backup.name ?? String(backup.path ?? '').split('/').pop() }),
          el('div.list__meta', { text: backup.modifiedAt ? `${formatDateTime(backup.modifiedAt)} · ${formatBytes(backup.size ?? 0)}` : formatBytes(backup.size ?? 0) }),
        ]),
        labelledButton({
          label: 'Restaurar',
          iconName: 'undo',
          size: 'sm',
          onClick: () => void this.#restore(script, backup),
        }),
      ]))));
  }

  async #rename(script) {
    const name = await this.#app.dialogs.prompt({
      title: 'Renombrar script',
      message: `Nombre actual: ${script.name}`,
      label: 'Nuevo nombre',
      value: script.name,
      confirmLabel: 'Renombrar',
      validate: (value) => (String(value).trim() === '' ? 'El nombre no puede estar vacío' : null),
    });
    if (name === null) return;
    const result = await this.#app.scripts.rename(script.id, String(name).trim());
    if (!result.ok) this.#app.notifications.error(result.error?.message ?? 'No se pudo renombrar el script');
    else this.#app.notifications.success(`Renombrado a ${result.script.name}`);
  }

  async #duplicate(script) {
    const result = await this.#app.scripts.duplicate(script.id);
    if (!result.ok) this.#app.notifications.error(result.error?.message ?? 'No se pudo duplicar el script');
    else this.#app.notifications.success(`Copia creada: ${result.script.name}`);
  }

  async #export(script) {
    const result = await this.#app.scripts.exportDownload(script.id);
    if (!result.ok) this.#app.notifications.error(result.error?.message ?? 'No se pudo exportar el script');
    else this.#app.notifications.success(`Descargado ${result.filename ?? script.name}`);
  }

  async #remove(script) {
    const confirmed = this.#app.settings.get('general.confirmDestructive') === false
      ? true
      : await this.#app.dialogs.confirm({
        title: 'Eliminar script',
        message: `¿Enviar «${script.name}» a la papelera? Podrás restaurarlo desde la carpeta de datos.`,
        confirmLabel: 'Eliminar',
        danger: true,
      });
    if (!confirmed) return;
    const result = await this.#app.scripts.remove(script.id, { hard: false });
    if (!result.ok) this.#app.notifications.error(result.error?.message ?? 'No se pudo eliminar el script');
    else {
      this.#app.notifications.success(`${script.name} enviado a la papelera`);
      if (this.#selectedId === script.id) this.#selectedId = null;
      this.#renderList();
      void this.#renderDetail(null);
    }
  }

  async #restore(script, backup) {
    const confirmed = await this.#app.dialogs.confirm({
      title: 'Restaurar respaldo',
      message: `Se restaurará «${script.name}» desde el respaldo seleccionado. El contenido actual se guardará como respaldo antes de sobrescribirlo.`,
      confirmLabel: 'Restaurar',
    });
    if (!confirmed) return;
    const result = await this.#app.scripts.restore(script.id, backup.name ?? backup.path);
    if (!result.ok) this.#app.notifications.error(result.error?.message ?? 'No se pudo restaurar el respaldo');
    else this.#app.notifications.success('Respaldo restaurado');
  }

  async #editMetadata(script) {
    const tags = await this.#app.dialogs.prompt({
      title: 'Etiquetas del script',
      message: 'Separa las etiquetas con comas. Se guardan en los metadatos del script.',
      label: 'Etiquetas',
      value: (script.tags ?? []).join(', '),
      confirmLabel: 'Guardar',
    });
    if (tags === null) return;
    const parsed = String(tags).split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 20);
    const result = await this.#app.scripts.updateMetadata(script.id, { tags: parsed });
    if (!result.ok) this.#app.notifications.error(result.error?.message ?? 'No se pudieron guardar las etiquetas');
    else {
      this.#app.notifications.success('Etiquetas actualizadas');
      this.#renderList();
      void this.#renderDetail(result.script);
    }
  }

  get element() {
    return this.#root;
  }
}
