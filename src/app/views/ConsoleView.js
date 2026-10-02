/**
 * ConsoleView — every real message the application produced, with filters, search, pause,
 * follow, copy, clear and export.
 *
 * Rendering is windowed: with line wrapping disabled the rows have a fixed height and only the
 * visible slice is materialised inside an absolutely-positioned sizer (so 5000 entries cost the
 * same as 50). With wrapping enabled the view renders the newest page of entries instead and says
 * how many are hidden — the honest alternative to lying about a virtualised wrapped layout.
 */

import { el } from '../../renderer/utils/dom.js';
import { createScheduler } from '../../renderer/utils/async.js';
import { icon } from '../../ui/icons.js';
import { formatNumber, formatTime, describeValue } from '../../renderer/utils/format.js';
import { LogLevel, LogLevelList } from '../../shared/constants.js';
import { iconButton, labelledButton } from './helpers.js';

const ROW_HEIGHT = 20;
const OVERSCAN = 8;
const WRAPPED_PAGE_SIZE = 400;

const LEVEL_LABELS = {
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.WARNING]: 'AVISO',
  [LogLevel.SUCCESS]: 'OK',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.TRACE]: 'TRACE',
  [LogLevel.INPUT]: 'ENTRADA',
  [LogLevel.OUTPUT]: 'SALIDA',
};

export class ConsoleView {
  #app;
  #root = null;
  #nodes = {};
  #unsubscribers = [];
  #visible = false;
  #rows = new Map();
  #scrollScheduled = false;
  #renderScheduled = null;
  #follow = true;
  #wrap = false;
  #entryClickData = null;

  constructor(app) {
    this.#app = app;
    this.#renderScheduled = createScheduler(() => this.#render(true), 60);
  }

  get id() {
    return 'console';
  }

  get title() {
    return 'Consola';
  }

  mount() {
    this.#root = el('div.view');

    /* ------------------------------------------------------------ toolbar */
    const search = el('input.input.input--search', {
      attrs: { type: 'search', placeholder: 'Filtrar mensajes…', spellcheck: 'false' },
      on: { input: () => { this.#app.console.setSearch(search.value); this.#scheduleRender(); } },
    });
    const levelToggles = el('div.console__filters');
    const pauseButton = iconButton({ iconName: 'pause', title: 'Pausar la consola', onClick: () => void this.#togglePause(pauseButton) });
    const followButton = el('button.btn.btn--ghost.btn--sm', {
      attrs: { type: 'button', 'aria-pressed': 'true', title: 'Seguir la salida automáticamente' },
      on: {
        click: () => {
          this.#follow = !this.#follow;
          followButton.setAttribute('aria-pressed', String(this.#follow));
          followButton.classList.toggle('is-active', this.#follow);
          this.#app.console.setAutoScroll(this.#follow);
          if (this.#follow) this.#scrollToBottom();
        },
      },
    }, [icon('download', { size: 'sm' }), el('span', { text: 'Seguir' })]);
    const wrapButton = el('button.btn.btn--ghost.btn--sm', {
      attrs: { type: 'button', 'aria-pressed': 'false', title: 'Ajustar las líneas largas' },
      on: {
        click: () => {
          this.#wrap = !this.#wrap;
          wrapButton.setAttribute('aria-pressed', String(this.#wrap));
          wrapButton.classList.toggle('is-active', this.#wrap);
          void this.#render(true);
        },
      },
    }, [icon('format', { size: 'sm' }), el('span', { text: 'Ajustar' })]);

    const sourceSelect = el('select.select', {
      attrs: { title: 'Filtrar por origen', 'aria-label': 'Filtrar por origen' },
      on: { change: () => { this.#app.console.setSource(sourceSelect.value || null); this.#scheduleRender(); } },
    });

    const toolbar = el('div.view__header', null, [
      el('span.view__title', { text: 'Consola' }),
      el('div.console__filters', null, [search, sourceSelect, levelToggles]),
      el('div.toolbar__spacer'),
      el('div.toolbar__group', null, [
        followButton,
        wrapButton,
        pauseButton,
        labelledButton({ label: 'Copiar', iconName: 'copy', size: 'sm', onClick: () => void this.#copy() }),
        labelledButton({ label: 'Exportar', iconName: 'download', size: 'sm', onClick: () => this.#export() }),
        labelledButton({ label: 'Limpiar', iconName: 'trash', size: 'sm', variant: 'danger', onClick: () => this.#clear() }),
      ]),
    ]);
    this.#nodes.levelToggles = levelToggles;
    this.#nodes.sourceSelect = sourceSelect;
    this.#nodes.search = search;
    this.#nodes.follow = followButton;
    this.#nodes.pause = pauseButton;
    this.#nodes.wrap = wrapButton;

    /* ----------------------------------------------------------- viewport */
    const sizer = el('div.console__sizer', { attrs: { role: 'log', 'aria-live': 'polite' } });
    const viewport = el('div.console__viewport', {
      attrs: { tabindex: '0' },
      on: {
        scroll: () => this.#onScroll(),
        keydown: (event) => this.#onKeydown(event),
      },
    }, [sizer]);
    const pendingNote = el('div.console__pending', { hidden: true });
    const console_ = el('div.console', null, [viewport, pendingNote]);
    this.#nodes.sizer = sizer;
    this.#nodes.viewport = viewport;
    this.#nodes.pendingNote = pendingNote;

    this.#root.appendChild(toolbar);
    this.#root.appendChild(console_);
    return this.#root;
  }

  async activate() {
    this.#visible = true;
    this.#follow = this.#app.console.autoScroll;
    this.#nodes.follow.setAttribute('aria-pressed', String(this.#follow));
    this.#unsubscribers.push(
      this.#app.console.subscribe((payload) => this.#onConsoleChange(payload)),
      this.#app.errorBus.subscribe(() => this.#renderSourceOptions()),
    );
    this.#renderLevelToggles();
    this.#renderSourceOptions();
    await this.#render(true);
    this.#scrollToBottom();
  }

  deactivate() {
    this.#visible = false;
    for (const unsubscribe of this.#unsubscribers.splice(0)) unsubscribe?.();
  }

  async reload() {
    this.#renderLevelToggles();
    this.#renderSourceOptions();
    await this.#render(true);
  }

  async #togglePause(button) {
    const result = this.#app.console.togglePause();
    const paused = this.#app.console.paused;
    button.classList.toggle('is-active', paused);
    button.title = paused ? 'Reanudar la consola' : 'Pausar la consola';
    button.replaceChildren(icon(paused ? 'play' : 'pause', { size: 'sm' }));
    this.#nodes.pendingNote.hidden = !paused || (result.pending ?? 0) === 0;
    this.#nodes.pendingNote.textContent = paused ? `Consola en pausa · ${formatNumber(this.#app.console.filtered().length)} visibles` : '';
    await this.#render(true);
  }

  #onConsoleChange(payload) {
    if (!this.#visible) return;
    if (payload?.reason === 'clear') {
      this.#rows.clear();
      this.#nodes.sizer.replaceChildren();
      void this.#render(true);
      return;
    }
    if (this.#app.console.paused && payload?.reason !== 'resumed') {
      this.#nodes.pendingNote.hidden = false;
      this.#nodes.pendingNote.textContent = `Consola en pausa · los mensajes nuevos se acumulan y se mostrarán al reanudar`;
      return;
    }
    this.#scheduleRender();
  }

  #scheduleRender() {
    this.#renderScheduled();
  }

  #renderLevelToggles() {
    const counts = this.#app.console.stats().byLevel ?? {};
    const active = new Set(this.#app.console.filter.levels);
    this.#nodes.levelToggles.replaceChildren(...LogLevelList.map((level) => {
      const on = active.has(level);
      const button = el(`button.level-toggle${on ? '.is-on' : ''}`, {
        attrs: { type: 'button', 'aria-pressed': String(on), title: `Mostrar u ocultar ${LEVEL_LABELS[level]}` },
        dataset: { level },
        on: {
          click: () => {
            const now = button.getAttribute('aria-pressed') === 'true';
            this.#app.console.setLevelVisible(level, !now);
            button.setAttribute('aria-pressed', String(!now));
            button.classList.toggle('is-on', !now);
            this.#scheduleRender();
          },
        },
      }, [
        el('span.level-toggle__dot', { dataset: { level } }),
        el('span', { text: `${LEVEL_LABELS[level]}${counts[level] ? ` ${counts[level] > 999 ? '999+' : counts[level]}` : ''}` }),
      ]);
      return button;
    }));
  }

  #renderSourceOptions() {
    const select = this.#nodes.sourceSelect;
    const sources = Object.entries(this.#app.console.stats().bySource ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 40);
    const current = this.#app.console.filter.source ?? '';
    select.replaceChildren(
      el('option', { value: '', text: 'Todos los orígenes' }),
      ...sources.map(([source, count]) => el('option', { value: source, text: `${source} (${count})`, selected: current === source })),
    );
    select.value = current;
  }

  #onScroll() {
    const viewport = this.#nodes.viewport;
    const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    const atBottom = distance < 8;
    if (atBottom !== this.#follow) {
      this.#follow = atBottom;
      this.#nodes.follow.setAttribute('aria-pressed', String(atBottom));
      this.#nodes.follow.classList.toggle('is-active', atBottom);
      this.#app.console.setAutoScroll(atBottom);
    }
    if (this.#scrollScheduled) return;
    this.#scrollScheduled = true;
    requestAnimationFrame(() => {
      this.#scrollScheduled = false;
      void this.#render(false);
    });
  }

  #onKeydown(event) {
    const viewport = this.#nodes.viewport;
    if (event.key === 'Home' && event.ctrlKey) {
      event.preventDefault();
      viewport.scrollTop = 0;
    } else if (event.key === 'End' && event.ctrlKey) {
      event.preventDefault();
      this.#scrollToBottom();
    } else if (event.key === 'c' && event.ctrlKey && event.shiftKey) {
      event.preventDefault();
      void this.#copy();
    }
  }

  async #render(scrollToEnd = false) {
    if (!this.#visible) return;
    const entries = this.#app.console.filtered();
    const sizer = this.#nodes.sizer;

    if (this.#wrap) {
      const page = entries.slice(-WRAPPED_PAGE_SIZE);
      sizer.style.height = 'auto';
      sizer.replaceChildren(el('div', {
        style: { font: 'inherit', color: 'var(--lumen-text-muted)', padding: '4px 12px' },
        text: entries.length > page.length ? `Mostrando las últimas ${page.length} de ${formatNumber(entries.length)} entradas (ajuste de línea activo)` : `${entries.length} entradas`,
      }), ...page.map((entry) => this.#buildRow(entry, null)));
      if (scrollToEnd && this.#follow) this.#scrollToBottom();
      return;
    }

    sizer.style.height = `${entries.length * ROW_HEIGHT}px`;
    const viewport = this.#nodes.viewport;
    const start = Math.max(0, Math.floor(viewport.scrollTop / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(entries.length, Math.ceil((viewport.scrollTop + viewport.clientHeight) / ROW_HEIGHT) + OVERSCAN);
    const fragment = document.createDocumentFragment();
    for (let index = start; index < end; index += 1) {
      const entry = entries[index];
      fragment.appendChild(this.#buildRow(entry, index * ROW_HEIGHT));
    }
    sizer.replaceChildren(fragment);
    if (scrollToEnd && this.#follow) this.#scrollToBottom();
  }

  #buildRow(entry, top) {
    const node = el('div.console__row', {
      dataset: { level: entry.level, id: String(entry.id) },
      attrs: { title: entry.data ? describeValue(entry.data) : entry.message },
      style: top === null ? null : { top: `${top}px`, height: `${ROW_HEIGHT}px` },
      on: {
        click: () => this.#showEntryDetail(entry),
      },
    }, [
      this.#app.settings.get('appearance.consoleTimestamps') !== false ? el('span.console__time', { text: formatTime(entry.timestamp) }) : null,
      el('span.console__level', { text: LEVEL_LABELS[entry.level] ?? entry.level }),
      entry.source ? el('span.console__source', { text: entry.line ? `${entry.source}:${entry.line}` : entry.source }) : null,
      el('span.console__message', null, [
        el('span', { text: entry.message }),
        entry.count > 1 ? el('span.console__count', { text: `×${entry.count}` }) : null,
      ]),
    ]);
    return node;
  }

  /** Clicking a row shows the full entry (including its structured data) in a dialog. */
  #showEntryDetail(entry) {
    const data = entry.data ? JSON.stringify(entry.data, null, 2) : null;
    this.#entryClickData = data;
    this.#app.dialogs.open({
      title: `Entrada de consola · ${LEVEL_LABELS[entry.level] ?? entry.level}`,
      body: el('div', null, [
        el('pre.code', { text: `${formatTime(entry.timestamp, { seconds: true })}  ${entry.level}${entry.source ? ` [${entry.source}${entry.line ? `:${entry.line}` : ''}]` : ''}\n${entry.message}` }),
        data ? el('div', null, [el('div.card__hint', { text: 'Datos asociados:' }), el('pre.code', { text: data })]) : null,
      ]),
      actions: [
        { label: 'Cerrar', variant: 'ghost' },
        {
          label: 'Copiar entrada',
          variant: 'primary',
          onClick: async () => {
            try {
              await navigator.clipboard.writeText(`${entry.level} ${entry.message}${data ? `\n${data}` : ''}`);
              this.#app.notifications.success('Entrada copiada al portapapeles');
            } catch (err) {
              this.#app.notifications.error(`No se pudo copiar: ${err.message}`);
            }
          },
        },
      ],
    });
  }

  #scrollToBottom() {
    const viewport = this.#nodes.viewport;
    requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight;
    });
  }

  async #copy() {
    const result = await this.#app.console.copyAll();
    if (result.ok) {
      this.#app.notifications.success(`Consola copiada (${formatNumber(result.bytes)} caracteres)`);
      return;
    }
    this.#app.notifications.error(`No se pudo copiar al portapapeles: ${result.error?.message ?? 'error desconocido'}`);
  }

  #export() {
    const result = this.#app.console.exportLogs({ format: 'txt' });
    if (result.ok) this.#app.notifications.success(`Registro exportado: ${result.filename}`);
    else this.#app.notifications.error(result.error?.message ?? 'No se pudo exportar el registro');
  }

  async #clear() {
    if (this.#app.settings.get('general.confirmDestructive') !== false) {
      const confirmed = await this.#app.dialogs.confirm({
        title: 'Limpiar la consola',
        message: 'Se eliminarán todas las entradas actuales de la consola. Esta acción no se puede deshacer.',
        confirmLabel: 'Limpiar',
        danger: true,
      });
      if (!confirmed) return;
    }
    const result = this.#app.console.clear();
    this.#app.notifications.info(`Consola vaciada (${formatNumber(result.cleared)} entradas)`);
  }

  get element() {
    return this.#root;
  }
}
