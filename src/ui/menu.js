/**
 * Menu — floating context menus with real keyboard navigation.
 *
 * One instance manages one open menu at a time (the previous one closes first, like a real
 * context menu). Supports separators, headers, disabled items, check marks, danger styling,
 * icons and shortcut hints. Navigation: ↑/↓, Home/End, Enter/Space, Escape, and jump to the
 * first item that starts with the typed letter. Clicking outside or scrolling closes it.
 */

import { el } from '../renderer/utils/dom.js';
import { icon } from './icons.js';

export class Menu {
  #host;
  #logger;
  #current = null;
  #subscribers = new Set();

  constructor({ host, logger } = {}) {
    this.#host = host ?? document.getElementById('lumen-overlays') ?? document.body;
    this.#logger = logger;
  }

  get isOpen() {
    return this.#current !== null;
  }

  get openMenuId() {
    return this.#current?.id ?? null;
  }

  /**
   * Opens a menu.
   * @param {{
   *   id?: string,
   *   x: number, y: number,
   *   items: Array<{ id?: string, label?: string, type?: 'item'|'separator'|'header', icon?: string|null,
   *                  shortcut?: string|null, checked?: boolean, disabled?: boolean, danger?: boolean,
   *                  detail?: string|null, onSelect?: Function }>,
   *   onClose?: Function,
   *   anchor?: HTMLElement|null,
   *   align?: 'left'|'right',
   * }} options
   * @returns {{ close: Function, element: HTMLElement }}
   */
  open({ id = `menu-${Date.now().toString(36)}`, x = 0, y = 0, items = [], onClose = null, anchor = null, align = 'left' }) {
    this.close('replaced');
    const entries = [];
    const root = el('div.menu', { attrs: { role: 'menu', 'data-menu': id, tabindex: '-1' } });
    let index = 0;

    for (const item of items) {
      if (!item) continue;
      if (item.type === 'separator') {
        root.appendChild(el('div.menu__separator', { attrs: { role: 'separator' } }));
        continue;
      }
      if (item.type === 'header') {
        root.appendChild(el('div.menu__header', { text: item.label ?? '' }));
        continue;
      }
      const disabled = item.disabled === true;
      const node = el(`button.menu__item${disabled ? '.is-disabled' : ''}${item.danger ? '.is-danger' : ''}${item.checked ? '.is-checked' : ''}`, {
        attrs: {
          type: 'button',
          role: 'menuitem',
          'aria-disabled': disabled ? 'true' : null,
          'data-item': item.id ?? `item-${index}`,
          tabindex: '-1',
        },
      }, [
        el('span.menu__check', null, item.checked ? icon('check', { size: 'sm' }) : null),
        item.icon ? icon(item.icon, { size: 'sm' }) : el('span.icon.icon--sm.menu__spacer'),
        el('span.menu__label', { text: item.label ?? '' }),
        item.detail ? el('span.menu__detail', { text: item.detail }) : null,
        item.shortcut ? el('kbd.menu__shortcut', { text: item.shortcut }) : null,
      ]);
      entries.push({ item, node, disabled });
      index += 1;
      root.appendChild(node);
    }

    const state = { id, root, entries, onClose, closed: false, anchor };
    this.#current = state;

    const close = (reason) => this.close(reason);
    const onDocumentPointerDown = (event) => {
      if (!root.contains(event.target)) close('outside');
    };
    const onDocumentKeydown = (event) => {
      const enabled = entries.filter((entry) => !entry.disabled);
      const active = root.querySelector('.menu__item.is-active');
      const move = (delta) => {
        if (enabled.length === 0) return;
        const position = active ? enabled.findIndex((entry) => entry.node === active) : -1;
        const next = position === -1
          ? (delta > 0 ? 0 : enabled.length - 1)
          : (position + delta + enabled.length) % enabled.length;
        for (const entry of enabled) entry.node.classList.remove('is-active');
        enabled[next].node.classList.add('is-active');
        enabled[next].node.focus();
      };
      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          close('escape');
          break;
        case 'ArrowDown':
          event.preventDefault();
          move(1);
          break;
        case 'ArrowUp':
          event.preventDefault();
          move(-1);
          break;
        case 'Home':
          event.preventDefault();
          move(enabled.length);
          break;
        case 'End':
          event.preventDefault();
          move(-enabled.length);
          break;
        case 'Enter':
        case ' ':
          event.preventDefault();
          active?.click();
          break;
        default: {
          if (event.key.length !== 1 || event.ctrlKey || event.altKey || event.metaKey) break;
          const typed = event.key.toLowerCase();
          const target = enabled.find((entry) => String(entry.item.label ?? '').toLowerCase().startsWith(typed));
          if (target) {
            for (const entry of enabled) entry.node.classList.remove('is-active');
            target.node.classList.add('is-active');
            target.node.focus();
          }
        }
      }
    };

    for (const entry of entries) {
      if (entry.disabled) {
        entry.node.addEventListener('click', (event) => event.preventDefault());
        continue;
      }
      entry.node.addEventListener('click', (event) => {
        event.preventDefault();
        const result = entry.item.onSelect?.();
        close('select');
        Promise.resolve(result).catch((err) => this.#logger?.error?.(err, { source: 'Menu.onSelect' }));
      });
      entry.node.addEventListener('mouseenter', () => {
        for (const other of entries) other.node.classList.remove('is-active');
        entry.node.classList.add('is-active');
      });
    }

    this.#host.appendChild(root);
    // Place the menu inside the viewport, flipping when there is no room.
    const rect = root.getBoundingClientRect();
    const hostRect = this.#host === document.body ? { left: 0, top: 0 } : this.#host.getBoundingClientRect();
    let left = x - hostRect.left;
    let top = y - hostRect.top;
    if (align === 'right') left -= rect.width;
    if (left + rect.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - rect.width - 8);
    if (top + rect.height > window.innerHeight - 8) top = Math.max(8, y - hostRect.top - rect.height);
    root.style.left = `${Math.round(left)}px`;
    root.style.top = `${Math.round(top)}px`;

    const view = root.ownerDocument.defaultView ?? window;
    view.addEventListener('pointerdown', onDocumentPointerDown, true);
    view.addEventListener('keydown', onDocumentKeydown, true);
    view.addEventListener('resize', () => close('resize'));
    view.addEventListener('scroll', () => close('scroll'), true);
    state.cleanup = () => {
      view.removeEventListener('pointerdown', onDocumentPointerDown, true);
      view.removeEventListener('keydown', onDocumentKeydown, true);
    };

    // Real focus for keyboard users, without stealing focus from an input on open.
    requestAnimationFrame(() => root.querySelector('.menu__item:not(.is-disabled)')?.focus());

    this.#notify({ open: true, id });
    return { close, element: root };
  }

  /** Opens a menu anchored to an element (aligns under it, right-aligned by default). */
  openFor(anchor, { items, align = 'right', offset = 4 } = {}) {
    const rect = anchor.getBoundingClientRect();
    return this.open({
      x: align === 'right' ? rect.right : rect.left,
      y: rect.bottom + offset,
      items,
      anchor,
      align,
    });
  }

  /** Opens a menu for a pointer event (keeps the click coordinates). */
  openFromEvent(event, { items, onClose = null } = {}) {
    const x = event?.clientX ?? 0;
    const y = event?.clientY ?? 0;
    if (event?.preventDefault) event.preventDefault();
    if (event?.stopPropagation) event.stopPropagation();
    return this.open({ x, y, items, onClose });
  }

  close(reason = 'close') {
    const state = this.#current;
    if (!state) return false;
    this.#current = null;
    state.cleanup?.();
    state.root.classList.add('menu--closing');
    setTimeout(() => state.root.remove(), 100);
    try {
      state.onClose?.(reason);
    } catch (err) {
      this.#logger?.error?.(err, { source: 'Menu.onClose' });
    }
    this.#notify({ open: false, id: state.id, reason });
    return true;
  }

  onOpenChange(listener) {
    this.#subscribers.add(listener);
    return () => this.#subscribers.delete(listener);
  }

  #notify(payload) {
    for (const listener of [...this.#subscribers]) {
      try {
        listener(payload);
      } catch (err) {
        this.#logger?.error?.(err, { source: 'Menu.subscriber' });
      }
    }
  }
}
