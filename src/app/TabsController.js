/**
 * TabsController — the tab strip for the open documents.
 *
 * The strip is a real view over the editor's open documents: it keeps the tab order (which the
 * editor does not own), renders one keyed node per tab, and updates only the nodes that changed
 * (the strip is never rebuilt wholesale). Closing a tab with unsaved changes always asks first
 * (Guardar / No guardar / Cancelar) and a failed save keeps the tab open with the text intact.
 */

import { Dialect } from '../shared/constants.js';
import { el, reconcile } from '../renderer/utils/dom.js';
import { icon } from '../ui/icons.js';

const DIALECT_LABEL = { [Dialect.LUAU]: 'Luau', [Dialect.LUA54]: 'Lua 5.4' };

export class TabsController {
  #container = null;
  #order = [];
  #activeId = null;
  #subscribers = new Set();
  #unsubscribe = [];
  #dragId = null;
  #dragIndex = null;
  #stats = { opened: 0, closed: 0, switched: 0, saved: 0, discarded: 0, reordered: 0 };

  /**
   * @param {{ editor: object, scripts: object, menu: object, dialogs: object, notifications?: object,
   *           eventBus?: object, logger?: object, container?: HTMLElement|null, onCreateRequest?: Function|null }} deps
   */
  constructor({ editor, scripts, menu, dialogs, notifications = null, eventBus = null, logger = null, container = null, onCreateRequest = null }) {
    this.editor = editor;
    this.scripts = scripts;
    this.menu = menu;
    this.dialogs = dialogs;
    this.notifications = notifications;
    this.eventBus = eventBus;
    this.logger = logger;
    this.onCreateRequest = onCreateRequest;
    this.#container = container;
  }

  /* ------------------------------------------------------------------ *
   * Lifecycle
   * ------------------------------------------------------------------ */

  /**
   * Provides the tab-strip container. Used by the App, which owns the chrome and therefore knows
   * where the strip lives; `init()` (called by the kernel) then builds the tab nodes.
   */
  setContainer(container) {
    if (!container) return { ok: false, reason: 'se necesita un contenedor' };
    this.#container = container;
    return { ok: true };
  }

  init({ container = null } = {}) {
    if (container) this.#container = container;
    if (!this.#container) throw new Error('TabsController necesita un contenedor');
    this.#container.classList.add('tabs');
    this.#container.setAttribute('role', 'tablist');
    this.#container.setAttribute('aria-label', 'Archivos abiertos');

    this.#unsubscribe.push(this.editor.onEvent?.((event) => this.#onEditorEvent(event)) ?? (() => {}));

    this.#order = this.editor.documents.map((document) => document.id);
    this.#activeId = this.editor.activeDocument?.id ?? null;
    this.render();
    return { ok: true, tabs: this.#order.length };
  }


  /* ------------------------------------------------------------------ *
   * Queries
   * ------------------------------------------------------------------ */

  get activeId() {
    return this.#activeId;
  }

  get count() {
    return this.#order.length;
  }

  get stats() {
    return { ...this.#stats, open: this.#order.length, dirty: this.dirtyTabs().length };
  }

  /** Active tab view-model (alias used by the status bar). */
  get activeTab() {
    return this.describe(this.#activeId);
  }

  get tabs() {
    const documents = new Map(this.editor.documents.map((document) => [document.id, document]));
    return this.#order
      .map((id) => {
        const document = documents.get(id);
        if (!document) return null;
        return {
          id,
          name: document.name,
          path: document.path,
          dialect: document.dialect,
          dialectLabel: DIALECT_LABEL[document.dialect] ?? document.dialect,
          dirty: document.dirty,
          active: id === this.#activeId,
          diagnostics: document.diagnostics,
          lines: document.lines,
          length: document.length,
          readOnly: document.readOnly,
          saved: this.scripts?.get?.(id) !== null && this.scripts?.get?.(id) !== undefined,
          tooltip: `${document.name} — ${DIALECT_LABEL[document.dialect] ?? document.dialect}${document.path ? `\n${document.path}` : ''}`,
        };
      })
      .filter(Boolean);
  }

  describe(id) {
    return this.tabs.find((tab) => tab.id === id) ?? null;
  }

  dirtyTabs() {
    return this.tabs.filter((tab) => tab.dirty);
  }

  hasDirtyTabs() {
    return this.dirtyTabs().length > 0;
  }

  /* ------------------------------------------------------------------ *
   * Actions
   * ------------------------------------------------------------------ */

  activate(id) {
    if (!this.editor.hasDocument(id)) return { ok: false, reason: 'unknown-tab' };
    this.editor.setActive(id);
    return { ok: true, id };
  }

  nextTab(step = 1) {
    if (this.#order.length === 0) return { ok: false };
    const current = this.#order.indexOf(this.#activeId);
    const next = this.#order[(current + step + this.#order.length) % this.#order.length];
    this.editor.setActive(next);
    return { ok: true, id: next };
  }

  /** Selects the tab at a 1-based position (used by Ctrl+1..9). */
  activateIndex(position) {
    const id = this.#order[position - 1];
    if (!id) return { ok: false };
    this.editor.setActive(id);
    return { ok: true, id };
  }

  reorder(id, targetIndex) {
    const from = this.#order.indexOf(id);
    if (from === -1) return { ok: false, reason: 'unknown-tab' };
    const to = Math.max(0, Math.min(this.#order.length - 1, targetIndex));
    if (from === to) return { ok: true, unchanged: true };
    this.#order.splice(from, 1);
    this.#order.splice(to, 0, id);
    this.#stats.reordered += 1;
    this.render();
    this.#notify({ reason: 'reordered', id, index: to });
    return { ok: true, index: to };
  }

  /**
   * Closes a tab. With unsaved changes the user is asked what to do; when they choose to save
   * and the save fails, the tab stays open.
   */
  async close(id, { force = false } = {}) {
    const tab = this.describe(id);
    if (!tab) return { ok: false, reason: 'unknown-tab' };
    if (tab.dirty && !force) {
      const decision = await this.#askAboutDirty(tab);
      if (decision === 'cancel') return { ok: false, cancelled: true };
      if (decision === 'save') {
        const saved = await this.save(id);
        if (!saved.ok) {
          this.notifications?.error(`No se pudo guardar «${tab.name}»: ${saved.error?.message ?? 'error desconocido'}`);
          return { ok: false, error: saved.error };
        }
      } else {
        this.#stats.discarded += 1;
      }
    }
    /*
     * `force` también llega al editor: sin él, un documento sucio se negaba a cerrarse y la pestaña
     * quedaba en la barra después de que el usuario ya hubiera decidido cerrarla o guardarla.
     */
    const closed = this.editor.closeDocument(id, { force: true });
    if (closed?.ok === false) return { ok: false, reason: closed.reason ?? 'no se pudo cerrar', editor: closed };
    this.#stats.closed += 1;
    return { ok: true, id };
  }

  async closeOthers(id) {
    const others = this.#order.filter((entry) => entry !== id);
    return this.#closeMany(others, () => {
      for (const entry of others) this.editor.closeDocument(entry);
    }, 'otras pestañas');
  }

  async closeToTheRight(id) {
    const index = this.#order.indexOf(id);
    if (index === -1) return { ok: false, reason: 'unknown-tab' };
    const right = this.#order.slice(index + 1);
    return this.#closeMany(right, () => {
      for (const entry of right) this.editor.closeDocument(entry);
    }, 'pestañas a la derecha');
  }

  async closeAll() {
    const all = [...this.#order];
    return this.#closeMany(all, () => {
      for (const entry of all) this.editor.closeDocument(entry);
    }, 'todas las pestañas');
  }

  async #closeMany(ids, apply, label) {
    if (ids.length === 0) return { ok: true, closed: 0 };
    const dirty = ids.filter((id) => this.editor.isDirty(id));
    if (dirty.length > 0) {
      const confirmed = await this.dialogs.confirm({
        title: `Cerrar ${label}`,
        message: `Se cerrarán ${ids.length} pestaña(s) y ${dirty.length} tiene(n) cambios sin guardar.`,
        detail: dirty.map((id) => this.describe(id)?.name ?? id).join('\n'),
        confirmLabel: 'Cerrar sin guardar',
        cancelLabel: 'Cancelar',
        danger: true,
      });
      if (!confirmed) return { ok: false, cancelled: true };
      this.#stats.discarded += dirty.length;
    }
    apply();
    this.#stats.closed += ids.length;
    return { ok: true, closed: ids.length };
  }

  async save(id = this.#activeId, { force = false } = {}) {
    const tab = this.describe(id);
    if (!tab) return { ok: false, error: new Error('Pestaña desconocida') };
    if (!this.scripts?.has?.(id)) {
      if (typeof this.onCreateRequest === 'function') {
        const created = await this.onCreateRequest(tab);
        return created ?? { ok: false, error: new Error('La pestaña no está asociada a ningún script guardado') };
      }
      return { ok: false, error: new Error('La pestaña no está asociada a ningún script: usa «Guardar como»') };
    }
    const result = await this.scripts.save(id, { force });
    if (result.ok) {
      this.#stats.saved += 1;
      this.#notify({ reason: 'saved', id });
      return result;
    }
    if (result.conflict) {
      const overwrite = await this.dialogs.confirm({
        title: 'El archivo cambió en el disco',
        message: `«${tab.name}» fue modificado fuera de la aplicación después de abrirlo.`,
        detail: 'Puedes sobrescribir el archivo del disco con el contenido del editor o cancelar y copiar tus cambios manualmente.',
        confirmLabel: 'Sobrescribir',
        cancelLabel: 'Cancelar',
        danger: true,
      });
      if (overwrite) return this.save(id, { force: true });
      return { ok: false, cancelled: true, error: result.error };
    }
    return result;
  }

  async duplicate(id = this.#activeId) {
    const result = await this.scripts.duplicate(id);
    if (!result.ok) {
      this.notifications?.error(`No se pudo duplicar: ${result.error?.message ?? 'error desconocido'}`);
      return result;
    }
    await this.scripts.open(result.script.id, { focus: true });
    return result;
  }

  async rename(id = this.#activeId) {
    const tab = this.describe(id);
    if (!tab) return { ok: false };
    const name = await this.dialogs.prompt({
      title: 'Renombrar script',
      label: 'Nombre',
      value: tab.name,
      validate: (value) => {
        const trimmed = String(value ?? '').trim();
        if (trimmed.length === 0) return { ok: false, message: 'El nombre no puede estar vacío' };
        if (trimmed.length > 120) return { ok: false, message: 'El nombre es demasiado largo (máx. 120)' };
        if (/[\\/:*?"<>|]/.test(trimmed)) return { ok: false, message: 'El nombre no puede contener \\ / : * ? " < > |' };
        return { ok: true, value: trimmed };
      },
    });
    if (name === null) return { ok: false, cancelled: true };
    const result = await this.scripts.rename(id, name);
    if (!result.ok) this.notifications?.error(`No se pudo renombrar: ${result.error?.message ?? 'error desconocido'}`);
    return result;
  }

  async setDialect(id = this.#activeId, dialect) {
    const tab = this.describe(id);
    if (!tab) return { ok: false };
    const next = dialect === Dialect.LUA54 ? Dialect.LUA54 : Dialect.LUAU;
    if (next === tab.dialect) return { ok: true, unchanged: true };
    this.editor.setDialect(id, next);
    this.scripts?.updateMetadata?.(id, { dialect: next });
    const saved = await this.save(id);
    this.notifications?.info(`«${tab.name}» ahora usa ${DIALECT_LABEL[next]}${saved.ok ? '' : ' (metadatos guardados, contenido pendiente)'}`);
    return { ok: true, dialect: next };
  }

  async revealInScripts(id = this.#activeId) {
    const tab = this.describe(id);
    if (!tab) return { ok: false };
    this.eventBus?.emit('scripts:reveal', { id });
    return { ok: true, id };
  }

  /* ------------------------------------------------------------------ *
   * Rendering (keyed — only changed tabs are touched)
   * ------------------------------------------------------------------ */

  render() {
    if (!this.#container) return;
    const tabs = this.tabs;
    const scroll = this.#ensureScroll();
    reconcile(
      scroll,
      tabs,
      (tab) => tab.id,
      (tab) => this.#createTab(tab),
      (node, tab) => this.#updateTab(node, tab),
    );
    if (tabs.length === 0) {
      if (!scroll.querySelector('.tabs__empty')) {
        scroll.appendChild(el('div.tabs__empty', { text: 'No hay archivos abiertos' }));
      }
    } else {
      scroll.querySelector('.tabs__empty')?.remove();
    }
  }

  #ensureScroll() {
    let scroll = this.#container.querySelector('.tabs__scroll');
    if (!scroll) {
      scroll = el('div.tabs__scroll');
      scroll.addEventListener('dragover', (event) => {
        if (this.#dragId === null) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const target = this.#dropTargetIndex(event.clientX);
        if (target !== this.#dragIndex) {
          this.#dragIndex = target;
          this.#showDropMarker(target);
        }
      });
      scroll.addEventListener('dragleave', (event) => {
        if (event.target === scroll) this.#clearDropMarker();
      });
      scroll.addEventListener('drop', (event) => {
        if (this.#dragId === null) return;
        event.preventDefault();
        const index = this.#dropTargetIndex(event.clientX);
        const id = this.#dragId;
        this.#clearDropMarker();
        this.#dragId = null;
        this.#dragIndex = null;
        const from = this.#order.indexOf(id);
        this.reorder(id, index > from ? index - 1 : index);
      });
      this.#container.appendChild(scroll);
    }
    return scroll;
  }

  #dropTargetIndex(clientX) {
    const nodes = [...this.#ensureScroll().querySelectorAll('.tab')];
    let index = 0;
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      if (clientX > rect.left + rect.width / 2) index += 1;
    }
    return index;
  }

  #showDropMarker(index) {
    const scroll = this.#ensureScroll();
    for (const node of scroll.querySelectorAll('.tab')) node.classList.remove('is-drop-before', 'is-drop-after');
    const nodes = [...scroll.querySelectorAll('.tab')];
    if (nodes.length === 0) return;
    if (index >= nodes.length) nodes[nodes.length - 1].classList.add('is-drop-after');
    else nodes[index].classList.add('is-drop-before');
  }

  #clearDropMarker() {
    for (const node of this.#ensureScroll().querySelectorAll('.tab')) {
      node.classList.remove('is-drop-before', 'is-drop-after');
    }
  }

  #createTab(tab) {
    const close = el('span.tab__close', {
      attrs: { role: 'button', tabindex: '-1', 'aria-label': `Cerrar ${tab.name}`, title: 'Cerrar' },
      dataset: { role: 'close' },
    }, icon('close', { size: 'sm' }));
    const node = el('button.tab', {
      attrs: { type: 'button', role: 'tab', 'data-tab': tab.id, draggable: 'true' },
      on: {
        click: () => this.editor.setActive(tab.id),
        auxclick: (event) => {
          if (event.button === 1) {
            event.preventDefault();
            void this.close(tab.id);
          }
        },
        contextmenu: (event) => this.#openContextMenu(event, tab.id),
        dragstart: (event) => {
          this.#dragId = tab.id;
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', tab.id);
          node.classList.add('is-dragging');
        },
        dragend: () => {
          node.classList.remove('is-dragging');
          this.#clearDropMarker();
          this.#dragId = null;
        },
      },
    }, [
      el('span.tab__icon', null, icon('file', { size: 'sm' })),
      el('span.tab__name', { text: tab.name }),
      el('span.tab__badges'),
      close,
    ]);
    node.addEventListener('mouseenter', () => { close.hidden = false; });
    node.addEventListener('mouseleave', () => {
      close.hidden = !(node.classList.contains('is-dirty') || node.classList.contains('is-active'));
    });
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      void this.close(tab.id);
    });
    return node;
  }

  #updateTab(node, tab) {
    node.classList.toggle('is-active', tab.active);
    node.classList.toggle('is-dirty', tab.dirty);
    node.setAttribute('aria-selected', tab.active ? 'true' : 'false');
    node.title = tab.tooltip;
    const name = node.querySelector('.tab__name');
    if (name.textContent !== tab.name) name.textContent = tab.name;
    const badges = node.querySelector('.tab__badges');
    const badgeKey = `${tab.dirty ? 'd' : ''}${tab.diagnostics > 0 ? `e${tab.diagnostics}` : ''}${tab.readOnly ? 'r' : ''}`;
    if (badges.dataset.key !== badgeKey) {
      badges.dataset.key = badgeKey;
      badges.textContent = '';
      if (tab.diagnostics > 0) {
        badges.appendChild(el('span.tab__diagnostics', { text: String(tab.diagnostics), title: `${tab.diagnostics} aviso(s) del analizador` }));
      }
      if (tab.readOnly) badges.appendChild(el('span.tab__readonly', { text: 'solo lectura' }));
      if (tab.dirty) badges.appendChild(el('span.tab__dot', { title: 'Cambios sin guardar' }));
    }
    const close = node.querySelector('.tab__close');
    close.hidden = !(tab.active || tab.dirty);
    const iconName = tab.dialect === Dialect.LUA54 ? 'terminal' : 'file';
    const iconHost = node.querySelector('.tab__icon');
    if (iconHost && iconHost.dataset.dialect !== iconName) {
      iconHost.dataset.dialect = iconName;
      iconHost.replaceChildren(icon(iconName, { size: 'sm' }));
    }
  }

  #openContextMenu(event, id) {
    const tab = this.describe(id);
    if (!tab) return;
    const index = this.#order.indexOf(id);
    this.menu.openFromEvent(event, {
      items: [
        { id: 'save', label: 'Guardar', icon: 'save', shortcut: 'Ctrl+S', disabled: !tab.dirty && tab.saved, onSelect: () => this.save(id) },
        { id: 'save-as', label: 'Guardar como…', icon: 'export', onSelect: () => this.onCreateRequest?.(tab, { saveAs: true }) },
        { type: 'separator' },
        { id: 'rename', label: 'Renombrar…', icon: 'edit', disabled: !tab.saved, onSelect: () => this.rename(id) },
        { id: 'duplicate', label: 'Duplicar', icon: 'copy', disabled: !tab.saved, onSelect: () => this.duplicate(id) },
        {
          id: 'dialect',
          label: `Dialecto: ${tab.dialectLabel}`,
          icon: 'layers',
          onSelect: () => this.setDialect(id, tab.dialect === Dialect.LUAU ? Dialect.LUA54 : Dialect.LUAU),
        },
        { type: 'separator' },
        { id: 'close', label: 'Cerrar', icon: 'close', shortcut: 'Ctrl+W', onSelect: () => this.close(id) },
        { id: 'close-others', label: 'Cerrar las demás', disabled: this.#order.length < 2, onSelect: () => this.closeOthers(id) },
        { id: 'close-right', label: 'Cerrar a la derecha', disabled: index >= this.#order.length - 1, onSelect: () => this.closeToTheRight(id) },
        { id: 'close-all', label: 'Cerrar todas', onSelect: () => this.closeAll() },
        { type: 'separator' },
        { id: 'reveal', label: 'Mostrar en Scripts', icon: 'folder', disabled: !tab.saved, onSelect: () => this.revealInScripts(id) },
      ],
    });
  }

  /* ------------------------------------------------------------------ *
   * Dirty-state dialog and editor events
   * ------------------------------------------------------------------ */

  #askAboutDirty(tab) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      this.dialogs.open({
        title: `«${tab.name}» tiene cambios sin guardar`,
        body: [
          el('p.dialog__message', { text: '¿Quieres guardar los cambios antes de cerrar la pestaña?' }),
          el('pre.dialog__details', { text: `${tab.lines} líneas · ${tab.length} caracteres · ${tab.dialectLabel}` }),
        ],
        actions: [
          { label: 'Cancelar', onClick: () => finish('cancel') },
          { label: 'No guardar', danger: true, onClick: () => finish('discard') },
          { label: 'Guardar', primary: true, onClick: () => finish('save') },
        ],
        onClose: () => finish('cancel'),
      });
    });
  }

  #onEditorEvent(event) {
    switch (event.type) {
      case 'opened':
        if (!this.#order.includes(event.id)) this.#order.push(event.id);
        this.#stats.opened += 1;
        break;
      case 'closed':
        this.#order = this.#order.filter((id) => id !== event.id);
        break;
      case 'activated':
        if (this.#activeId !== event.id) this.#stats.switched += 1;
        this.#activeId = event.id;
        break;
      default:
        break;
    }
    /*
     * Alta defensiva de pestañas para eventos con id (un documento abierto por otra ruta). El caso
     * `closed` queda excluido: si se volviera a añadir, la pestaña cerrada seguiría en la barra
     * aunque su documento ya no exista y al pulsarla no habría nada que activar.
     */
    if (event.type !== 'closed' && event.id && !this.#order.includes(event.id)) this.#order.push(event.id);
    this.render();
    this.#notify({ reason: event.type, id: event.id ?? null, event });
    this.eventBus?.emit('tabs:changed', { reason: event.type, id: event.id ?? null });
  }

  subscribe(listener) {
    this.#subscribers.add(listener);
    return () => this.#subscribers.delete(listener);
  }

  /** Alias with the name the status bar and panels use. */
  onChange(listener) {
    return this.subscribe(listener);
  }

  /** Switches the active file between Luau and Lua 5.4 (writes the change to disk). */
  cycleDialect() {
    const tab = this.activeTab;
    if (!tab) return Promise.resolve({ ok: false, reason: 'no-active-tab' });
    return this.setDialect(tab.id, tab.dialect === Dialect.LUAU ? Dialect.LUA54 : Dialect.LUAU);
  }

  #notify(payload) {
    for (const listener of [...this.#subscribers]) {
      try {
        listener(payload, this);
      } catch (err) {
        this.logger?.error?.(err, { source: 'TabsController.subscriber' });
      }
    }
  }

  dispose() {
    for (const off of this.#unsubscribe) off?.();
    this.#unsubscribe = [];
    this.#subscribers.clear();
    this.#container?.replaceChildren();
  }
}
