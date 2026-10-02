/**
 * StorageUI — real storage information and actions.
 *
 * A browser cannot open a folder in the file manager (and saying otherwise would be a lie), so this
 * dialog shows the *real* absolute path of every storage directory, lets the user copy it, browses
 * the actual file tree the server reports (`/api/workspace/tree`) and runs the real maintenance
 * actions the API exposes (vaciar la papelera, exportar la configuración).
 */

import { el } from '../renderer/utils/dom.js';
import { icon } from '../ui/icons.js';
import { formatBytes, formatDateTime, formatNumber } from '../renderer/utils/format.js';

export class StorageUI {
  #app;

  constructor(app) {
    this.#app = app;
  }

  /** Opens the storage dialog, optionally focused on a specific directory. */
  async open(sub = null) {
    const body = el('div', null, [el('div.loading', null, [el('span.spinner'), el('span', { text: 'Leyendo el almacenamiento…' })])]);
    const dialog = this.#app.dialogs.open({
      title: 'Almacenamiento de Lumen Studio',
      wide: true,
      body,
      actions: [
        {
          label: 'Vaciar la papelera',
          danger: true,
          keepOpen: true,
          onClick: () => void this.#emptyTrash(dialog),
        },
        {
          label: 'Exportar la configuración',
          keepOpen: true,
          onClick: () => void this.#app.exportSettings(),
        },
        { label: 'Cerrar', primary: true },
      ],
    });
    await this.#render(body, sub);
    return { ok: true, root: this.#app.storageRoot };
  }

  async #render(body, sub) {
    let info = null;
    let tree = null;
    const failures = [];
    try {
      info = await this.#app.apiClient.get('/api/storage/info');
    } catch (err) {
      failures.push(`información: ${err.message}`);
    }
    try {
      tree = await this.#app.apiClient.get(`/api/workspace/tree?depth=2&path=${encodeURIComponent(sub ?? '')}`);
    } catch (err) {
      failures.push(`árbol: ${err.message}`);
    }

    const storage = info?.storage ?? info ?? {};
    const dirs = storage.dirs ?? {};
    const rows = Object.entries(dirs);
    const pathList = el('div.list', null, rows.map(([name, value]) => el('div.list__row', null, [
      el('div.list__main', null, [
        el('div.list__title', { text: labelForDir(name) }),
        el('div.list__meta.code', { text: String(value) }),
      ]),
      el('button.btn.btn--ghost.btn--sm', {
        attrs: { type: 'button', title: 'Copiar la ruta' },
        on: {
          click: async () => {
            try {
              await navigator.clipboard.writeText(String(value));
              this.#app.notifications.success(`Ruta copiada: ${value}`);
            } catch (err) {
              this.#app.notifications.warn(`No se pudo copiar (${err.message}); la ruta está visible arriba`);
            }
          },
        },
      }, [icon('copy', { size: 'sm' }), el('span', { text: 'Copiar' })]),
    ])));

    const entries = tree?.entries ?? [];
    const treeList = el('div.list', null, entries.map((entry) => el('div.list__row', null, [
      el('span', null, [icon(entry.isDirectory ? 'folder' : 'file', { size: 'sm' })]),
      el('div.list__main', null, [
        el('div.list__title', { text: entry.name }),
        el('div.list__meta', {
          text: [
            entry.path,
            entry.isDirectory ? 'carpeta' : formatBytes(entry.size ?? 0),
            entry.modifiedAt ? formatDateTime(entry.modifiedAt) : null,
          ].filter(Boolean).join(' · '),
        }),
      ]),
    ])));

    body.replaceChildren(
      el('div.grid.grid--two', null, [
        el('div.card', null, [
          el('div.card__label', { text: 'Carpeta de datos' }),
          el('div.card__value.card__value--sm.code', { text: storage.root ?? this.#app.storageRoot ?? 'desconocida' }),
          el('div.card__hint', { text: 'Puedes cambiar la ubicación con la variable de entorno LUMEN_DATA_DIR o con el argumento --data-dir.' }),
        ]),
        el('div.card', null, [
          el('div.card__label', { text: 'Uso' }),
          el('div.card__value.card__value--sm', {
            text: `${formatNumber(storage.counts?.scripts ?? 0)} scripts · ${formatNumber(storage.counts?.history ?? 0)} registros de historial`,
          }),
          el('div.card__hint', {
            text: [
              storage.bytes?.scripts !== undefined ? `${formatBytes(storage.bytes.scripts)} en scripts` : null,
              storage.bytes?.backups !== undefined ? `${formatBytes(storage.bytes.backups)} en respaldos` : null,
              storage.writable === false ? 'la carpeta no permite escritura' : 'escritura verificada',
            ].filter(Boolean).join(' · '),
          }),
        ]),
      ]),
      el('h3.settings__group-title', { text: 'Directorios' }),
      pathList,
      el('h3.settings__group-title', { text: `Contenido${tree?.path ? ` de ${tree.path}` : ''}` }),
      entries.length === 0 ? el('div.list__empty', { text: 'La carpeta está vacía.' }) : treeList,
      tree ? el('p.card__hint', { text: 'El árbol muestra hasta 2 niveles; las rutas son absolutas en el servidor, que es quien tiene acceso al disco.' }) : null,
      failures.length > 0
        ? el('div.card.card--warning', null, [
          el('div.card__label', { text: 'Avisos' }),
          ...failures.map((failure) => el('div.card__hint', { text: failure })),
        ])
        : null,
    );
  }

  async #emptyTrash(dialog) {
    const confirmed = await this.#app.dialogs.confirm({
      title: 'Vaciar la papelera',
      message: 'Se eliminarán definitivamente los scripts y plugins que están en la papelera. Esta acción no se puede deshacer.',
      confirmLabel: 'Vaciar',
      danger: true,
    });
    if (!confirmed) return;
    try {
      const result = await this.#app.apiClient.post('/api/storage/clear-trash', {});
      if (result.failures?.length > 0) {
        this.#app.notifications.warn(`Se eliminaron ${result.removed} elementos; ${result.failures.length} fallaron`);
      } else {
        this.#app.notifications.success(`Papelera vaciada (${result.removed} elementos)`);
      }
      dialog?.close?.('refresh');
      void this.open();
    } catch (err) {
      this.#app.notifications.error(`No se pudo vaciar la papelera: ${err.message}`);
    }
  }
}

function labelForDir(name) {
  const labels = {
    root: 'Raíz',
    scripts: 'Scripts',
    meta: 'Metadatos',
    themes: 'Temas',
    plugins: 'Plugins',
    logs: 'Registros',
    backups: 'Respaldos',
    tmp: 'Temporales',
    trash: 'Papelera',
    workspace: 'Área de trabajo',
  };
  return labels[name] ?? name;
}
