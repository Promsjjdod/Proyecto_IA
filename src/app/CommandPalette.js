/**
 * CommandPalette — the Ctrl+Shift+P launcher.
 *
 * Real dynamic search over the CommandManager catalog (commands registered by the core, by the
 * editor and by plugins). Keyboard driven: ↑/↓ to move, Enter to run, Escape to close, and the
 * list is rebuilt only when the query or the catalog changes.
 */

import { el, focusFirst } from '../renderer/utils/dom.js';
import { icon } from '../ui/icons.js';

export class CommandPalette {
  #host;
  #commands;
  #sorted;
  #filtered = [];
  #activeIndex = 0;
  #element = null;
  #open = false;
  #unsubscribe = null;
  #options = { prefix: null, placeholder: 'Escribe un comando o busca una acción…', onEmpty: null };

  constructor({ host, commands, logger }) {
    this.#host = host ?? document.getElementById('lumen-overlays') ?? document.body;
    this.#commands = commands;
    this.logger = logger;
    this.#sorted = [];
  }

  get isOpen() {
    return this.#open;
  }

  /**
   * Opens the palette.
   * @param {{ prefix?: string|null, query?: string, placeholder?: string }} [options]
   */
  show(options = {}) {
    this.#options = { ...this.#options, ...options };
    this.close('reopen');
    this.#open = true;

    const input = el('input.palette__input', {
      attrs: {
        type: 'text',
        role: 'combobox',
        'aria-expanded': 'true',
        'aria-controls': 'lumen-palette-list',
        placeholder: this.#options.placeholder,
        spellcheck: 'false',
        autocomplete: 'off',
      },
      value: this.#options.query ?? '',
    });
    const list = el('div.palette__list', { attrs: { id: 'lumen-palette-list', role: 'listbox' } });
    const footer = el('div.palette__footer', null, [
      el('span', null, [el('kbd', { text: '↑↓' }), ' navegar']),
      el('span', null, [el('kbd', { text: 'Enter' }), ' ejecutar']),
      el('span', null, [el('kbd', { text: 'Esc' }), ' cerrar']),
      el('span.palette__count', { text: '' }),
    ]);

    const panel = el('div.palette', {
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Paleta de comandos' },
    }, [
      el('div.palette__input-row', null, [icon('search', { size: 'sm' }), input]),
      list,
      footer,
    ]);

    const overlay = el('div.overlay.overlay--top', {
      on: {
        mousedown: (event) => {
          if (event.target === overlay) this.close('backdrop');
        },
      },
    }, panel);

    const onKeydown = (event) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          this.#move(1, list);
          break;
        case 'ArrowUp':
          event.preventDefault();
          this.#move(-1, list);
          break;
        case 'PageDown':
          event.preventDefault();
          this.#move(8, list);
          break;
        case 'PageUp':
          event.preventDefault();
          this.#move(-8, list);
          break;
        case 'Enter':
          event.preventDefault();
          this.#runActive();
          break;
        case 'Escape':
          event.preventDefault();
          this.close('escape');
          break;
        default:
          break;
      }
    };

    input.addEventListener('input', () => this.#render(list, footer, input.value));
    input.addEventListener('keydown', onKeydown);
    this.#element = { overlay, panel, input, list, footer, overlayKeydown: onKeydown };

    // Keep the list in sync if a plugin registers/unregisters commands while open.
    this.#unsubscribe = this.#commands.subscribe(() => this.#render(list, footer, input.value));

    this.#host.appendChild(overlay);
    this.#render(list, footer, input.value);
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
    return { ok: true };
  }

  close(reason = 'close') {
    if (!this.#element) {
      this.#open = false;
      return false;
    }
    const { overlay, input, overlayKeydown } = this.#element;
    input.removeEventListener('keydown', overlayKeydown);
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    overlay.classList.add('overlay--closing');
    setTimeout(() => overlay.remove(), 120);
    this.#element = null;
    this.#open = false;
    this.logger?.debug?.(`Paleta de comandos cerrada (${reason})`, { source: 'CommandPalette' });
    return true;
  }

  toggle(options = {}) {
    return this.#open ? this.close('toggle') : this.show(options);
  }

  #catalog() {
    const list = this.#commands.list();
    return list.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'es'));
  }

  #render(list, footer, query) {
    this.#sorted = this.#catalog();
    const term = String(query ?? '').trim();
    this.#filtered = term === '' ? this.#sorted.slice(0, 80) : this.#commands.search(term, { limit: 80 });
    if (this.#activeIndex >= this.#filtered.length) this.#activeIndex = 0;

    const fragment = document.createDocumentFragment();
    if (this.#filtered.length === 0) {
      fragment.appendChild(el('div.palette__empty', {
        text: term === '' ? 'No hay comandos registrados' : `Ningún comando coincide con «${term}»`,
      }));
    }
    this.#filtered.forEach((command, index) => {
      const enabled = this.#isEnabled(command);
      const row = el(`button.palette__item${index === this.#activeIndex ? '.is-active' : ''}`, {
        attrs: {
          type: 'button',
          role: 'option',
          'aria-selected': index === this.#activeIndex ? 'true' : 'false',
          'data-command': command.id,
        },
        on: {
          click: () => {
            this.#activeIndex = index;
            this.#runActive();
          },
          mousemove: () => {
            if (this.#activeIndex === index) return;
            this.#activeIndex = index;
            this.#highlight(list);
          },
        },
      }, [
        icon(command.icon ?? 'wand', { size: 'sm' }),
        el('span.palette__item-main', null, [
          el('span.palette__item-label', { text: command.title }),
          el('span.palette__item-detail', {
            text: [command.category, command.description, enabled ? null : this.#disabledReason(command)].filter(Boolean).join(' · '),
          }),
        ]),
        command.shortcut ? el('kbd', { text: command.shortcut }) : null,
      ]);
      if (!enabled) row.classList.add('is-disabled');
      fragment.appendChild(row);
    });
    list.replaceChildren(fragment);
    const count = footer.querySelector('.palette__count');
    if (count) count.textContent = `${this.#filtered.length} de ${this.#sorted.length} comandos`;
  }

  #highlight(list) {
    const rows = [...list.querySelectorAll('.palette__item')];
    rows.forEach((row, index) => {
      const active = index === this.#activeIndex;
      row.classList.toggle('is-active', active);
      row.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    rows[this.#activeIndex]?.scrollIntoView({ block: 'nearest' });
  }

  #move(delta, list) {
    if (this.#filtered.length === 0) return;
    const enabledIndexes = this.#filtered
      .map((command, index) => (this.#isEnabled(command) ? index : -1))
      .filter((index) => index !== -1);
    if (enabledIndexes.length === 0) return;
    const current = enabledIndexes.indexOf(this.#activeIndex);
    const next = current === -1
      ? enabledIndexes[0]
      : enabledIndexes[(current + delta + enabledIndexes.length) % enabledIndexes.length];
    this.#activeIndex = next;
    this.#highlight(list);
    focusFirst(list);
  }

  #isEnabled(command) {
    try {
      return command.enabled ? command.enabled() !== false : true;
    } catch (err) {
      this.logger?.warn?.(`El comando ${command.id} falló al comprobar su disponibilidad: ${err.message}`, { source: 'CommandPalette' });
      return false;
    }
  }

  #disabledReason(command) {
    try {
      return command.disabledReason?.() ?? 'No disponible ahora';
    } catch {
      return 'No disponible ahora';
    }
  }

  #runActive() {
    const command = this.#filtered[this.#activeIndex];
    if (!command) return;
    if (!this.#isEnabled(command)) return;
    this.close('run');
    void this.#commands.execute(command.id).catch((err) => {
      this.logger?.error?.(err, { source: 'CommandPalette.execute' });
    });
  }

  /** Quick pick over arbitrary items (used by "abrir script", "ir a línea", theme picker…). */
  pick({ title = 'Selecciona una opción', items = [], placeholder = 'Buscar…', onPick = null, emptyMessage = 'Sin resultados' }) {
    this.close('reopen');
    this.#open = true;
    const input = el('input.palette__input', { attrs: { type: 'text', placeholder, spellcheck: 'false', autocomplete: 'off' } });
    const list = el('div.palette__list');
    const panel = el('div.palette', { attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': title } }, [
      el('div.palette__input-row', null, [icon('search', { size: 'sm' }), input]),
      list,
      el('div.palette__footer', null, [el('span', { text: `${items.length} opciones` })]),
    ]);
    const overlay = el('div.overlay.overlay--top', {
      on: { mousedown: (event) => { if (event.target === overlay) this.close('backdrop'); } },
    }, panel);

    let filtered = items;
    let index = 0;
    const render = () => {
      const fragment = document.createDocumentFragment();
      if (filtered.length === 0) fragment.appendChild(el('div.palette__empty', { text: emptyMessage }));
      filtered.slice(0, 100).forEach((item, itemIndex) => {
        fragment.appendChild(el(`button.palette__item${itemIndex === index ? '.is-active' : ''}`, {
          attrs: { type: 'button', role: 'option' },
          on: {
            click: () => {
              this.close('pick');
              onPick?.(item);
            },
          },
        }, [
          item.icon ? icon(item.icon, { size: 'sm' }) : null,
          el('span.palette__item-main', null, [
            el('span.palette__item-label', { text: item.label }),
            item.detail ? el('span.palette__item-detail', { text: item.detail }) : null,
          ]),
          item.shortcut ? el('kbd', { text: item.shortcut }) : null,
        ]));
      });
      list.replaceChildren(fragment);
    };
    const move = (delta) => {
      if (filtered.length === 0) return;
      index = Math.max(0, Math.min(filtered.length - 1, index + delta));
      const rows = [...list.querySelectorAll('.palette__item')];
      rows.forEach((row, rowIndex) => row.classList.toggle('is-active', rowIndex === index));
      rows[index]?.scrollIntoView({ block: 'nearest' });
    };
    input.addEventListener('input', () => {
      const term = input.value.trim().toLowerCase();
      filtered = term === '' ? items : items.filter((item) => `${item.label} ${item.detail ?? ''} ${(item.keywords ?? []).join(' ')}`.toLowerCase().includes(term));
      index = 0;
      render();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
      else if (event.key === 'Enter') {
        event.preventDefault();
        const item = filtered[index];
        if (!item) return;
        this.close('pick');
        onPick?.(item);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.close('escape');
      }
    });
    this.#element = { overlay, panel, input, list, footer: panel.lastElementChild, overlayKeydown: () => {} };
    this.#host.appendChild(overlay);
    render();
    requestAnimationFrame(() => input.focus());
    return { ok: true };
  }
}
