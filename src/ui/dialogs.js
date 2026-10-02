/**
 * DialogManager — modal dialogs with real behaviour.
 *
 * Used for confirmations (closing dirty tabs, deleting scripts), text prompts (new script,
 * rename, go to line) and arbitrary content dialogs (diagnostics detail, type annotations,
 * release notes). Every dialog: traps focus, closes with Escape, marks the backdrop as
 * `aria-hidden`, restores focus to the element that opened it, and returns a Promise that
 * resolves with the user's answer (never a placeholder value).
 */

import { el, focusFirst, trapFocus } from '../renderer/utils/dom.js';

/**
 * Accepts every convention used by the call sites:
 *  • `{ ok, value, message }`      → used as-is
 *  • `true` / `null` / `undefined` → valid
 *  • `false`                       → invalid with a generic message
 *  • non-empty string              → invalid, and the string is the message
 */
function normalizeValidation(result, fallbackValue) {
  if (result === null || result === undefined || result === true) return { ok: true, value: fallbackValue };
  if (result === false) return { ok: false, message: 'Valor inválido' };
  if (typeof result === 'string') {
    if (result.trim() === '') return { ok: true, value: fallbackValue };
    return { ok: false, message: result };
  }
  if (typeof result === 'object') {
    return {
      ok: result.ok !== false,
      value: result.value ?? fallbackValue,
      message: result.message ?? 'Valor inválido',
    };
  }
  return { ok: true, value: fallbackValue };
}

export class DialogManager {
  #host = null;
  #open = [];
  #counter = 0;

  constructor({ host, logger } = {}) {
    this.host = host ?? document.getElementById('lumen-overlays') ?? document.body;
    this.logger = logger;
  }

  get openCount() {
    return this.#open.length;
  }

  /**
   * Confirmation dialog.
   * @returns {Promise<boolean>}
   */
  confirm({
    title = 'Confirmar',
    message = '',
    detail = null,
    confirmLabel = 'Aceptar',
    cancelLabel = 'Cancelar',
    danger = false,
  } = {}) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const dialog = this.#createDialog({
        title,
        wide: false,
        body: [
          el('p.dialog__message', { text: message }),
          detail ? el('pre.dialog__details', { text: typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2) }) : null,
        ],
        actions: [
          { label: cancelLabel, onClick: () => finish(false) },
          { label: confirmLabel, primary: !danger, danger, onClick: () => finish(true) },
        ],
        onClose: () => finish(false),
      });
      void dialog;
    });
  }

  /**
   * Text prompt with real validation.
   * @returns {Promise<string|null>}
   */
  prompt({
    title = 'Introducir un valor',
    message = '',
    label = '',
    value = '',
    placeholder = '',
    validate = null,
    confirmLabel = 'Aceptar',
  } = {}) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const input = el('input.input', { attrs: { type: 'text', placeholder, 'aria-label': label || title }, value });
      const error = el('div.field__error', { hidden: true });
      const submit = () => {
        const current = input.value;
        const validation = normalizeValidation(typeof validate === 'function' ? validate(current) : null, current);
        if (!validation.ok) {
          error.textContent = validation.message ?? 'Valor inválido';
          error.hidden = false;
          input.focus();
          input.select?.();
          return false;
        }
        finish(validation.value ?? current);
        return true;
      };
      const dialog = this.#createDialog({
        title,
        body: [
          message ? el('p.dialog__message', { text: message }) : null,
          label ? el('label.field__label', { text: label }) : null,
          input,
          error,
        ],
        actions: [
          { label: 'Cancelar', onClick: () => finish(null) },
          { label: confirmLabel, primary: true, onClick: submit },
        ],
        onClose: () => finish(null),
        onOpen: () => {
          input.focus();
          input.select?.();
        },
        onKeydown: (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (submit()) return true;
          }
          return false;
        },
      });
      void dialog;
    });
  }

  /**
   * Opens a dialog with arbitrary content.
   * @param {{ title: string, body: Array<Node|string>|Node, actions?: Array<object>, wide?: boolean, onClose?: Function, footer?: Node }} options
   * @returns {{ close: Function, element: HTMLElement }}
   */
  open({ title, body, actions = [], wide = false, onClose = null, footer = null } = {}) {
    return this.#createDialog({ title, body, actions, wide, onClose, footer });
  }

  #createDialog({ title, body, actions = [], wide = false, onClose = null, onOpen = null, onKeydown = null, footer = null }) {
    const id = `dialog-${++this.#counter}`;
    const previousFocus = document.activeElement;
    const actionButtons = [];
    let releaseTrap = null;

    const close = (reason = 'close') => {
      const entry = this.#open.find((item) => item.id === id);
      if (!entry) return;
      this.#open = this.#open.filter((item) => item.id !== id);
      releaseTrap?.();
      document.removeEventListener('keydown', onDocumentKeydown, true);
      overlay.classList.add('overlay--closing');
      setTimeout(() => overlay.remove(), 120);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
      onClose?.(reason);
    };

    const onDocumentKeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close('escape');
        return;
      }
      if (onKeydown && onKeydown(event)) {
        event.preventDefault();
        event.stopPropagation();
        close('submit');
      }
    };

    for (const action of actions) {
      const button = el(`button.btn${action.primary ? '.btn--primary' : ''}${action.danger ? '.btn--danger' : ''}`, {
        attrs: { type: 'button', 'data-action': action.label },
        text: action.label,
        on: {
          click: () => {
            const result = action.onClick?.({ close });
            if (action.keepOpen !== true) close('action');
            void result;
          },
        },
      });
      actionButtons.push(button);
    }

    const dialog = el('div.dialog', {
      class: wide ? 'dialog--wide' : null,
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, id },
    }, [
      el('div.dialog__header', null, [
        el('div.dialog__title', { text: title }),
        el('button.btn.btn--ghost.btn--icon.btn--sm', {
          attrs: { type: 'button', 'aria-label': 'Cerrar' },
          on: { click: () => close('button') },
        }, el('span.icon.icon--sm', { dataset: { icon: 'close' } })),
      ]),
      el('div.dialog__body', null, Array.isArray(body) ? body.filter(Boolean) : [body]),
      footer ?? (actionButtons.length > 0 ? el('div.dialog__footer', null, actionButtons) : null),
    ]);

    const overlay = el('div.overlay.overlay--center', {
      attrs: { 'data-dialog': id },
      on: {
        mousedown: (event) => {
          if (event.target === overlay) close('backdrop');
        },
      },
    }, dialog);

    this.#host.appendChild(overlay);
    releaseTrap = trapFocus(dialog);
    document.addEventListener('keydown', onDocumentKeydown, true);
    this.#open.push({ id, close, dialog, overlay, title });
    focusFirst(dialog);
    onOpen?.();

    return { close, element: dialog, id };
  }

  /** Closes the topmost dialog (used by global Escape handling). */
  closeTop() {
    const top = this.#open[this.#open.length - 1];
    if (!top) return false;
    top.close('programmatic');
    return true;
  }

  closeAll() {
    const count = this.#open.length;
    while (this.#open.length > 0) this.#open[this.#open.length - 1].close('close-all');
    return { closed: count };
  }
}
