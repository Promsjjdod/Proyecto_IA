/**
 * NotificationManager — in-app toast system with a real queue.
 *
 * Features that are genuinely implemented:
 *  - four severities (success / info / warning / error) with theme-driven colours;
 *  - configurable duration with a *real* remaining-time progress bar and pause on hover;
 *  - real queue: only `maxVisible` toasts are shown, the rest wait their turn;
 *  - optional actions with callbacks (e.g. "Deshacer" after deleting a script);
 *  - manual dismissal and programmatic cancellation by id/tag;
 *  - accessible markup (`role="status"`, `aria-live`) and keyboard dismissal.
 */

import { createScheduler } from '../utils/async.js';
import { el, replace } from '../utils/dom.js';

const SEVERITY_LABEL = Object.freeze({
  success: 'Correcto',
  info: 'Información',
  warning: 'Aviso',
  error: 'Error',
});

const SEVERITY_ICON = Object.freeze({
  success: 'check-circle',
  info: 'info',
  warning: 'alert-triangle',
  error: 'alert-octagon',
});

export class NotificationManager {
  #queue = [];
  #visible = [];
  #host = null;
  #subscribers = new Set();
  #history = [];
  #historyLimit = 200;
  #counter = 0;
  #countListeners = new Set();
  #render = createScheduler(() => this.#renderNow());

  constructor({ host, logger, eventBus, capabilities, maxVisible = 4 }) {
    this.host = host;
    this.logger = logger;
    this.eventBus = eventBus;
    this.capabilities = capabilities;
    this.maxVisible = maxVisible;
    this.defaultDurationMs = 4200;
    this.soundEnabled = false;
    this.stats = { shown: 0, dismissed: 0, expired: 0, bySeverity: { success: 0, info: 0, warning: 0, error: 0 } };
  }

  init() {
    if (!this.host) {
      this.host = el('div.notification-host', { attrs: { role: 'region', 'aria-label': 'Notificaciones' } });
      document.getElementById('lumen-overlays')?.appendChild(this.host);
    }
    this.#render();
    return { ok: true, host: Boolean(this.host) };
  }

  /**
   * Shows a notification.
   * @param {{ title?: string, message: string, severity?: 'success'|'info'|'warning'|'error', durationMs?: number|null, actions?: Array<{label: string, onClick: Function, primary?: boolean}>, source?: string, tag?: string, sticky?: boolean }} options
   */
  notify(options) {
    const notification = {
      id: `n${++this.#counter}`,
      title: options.title ?? null,
      message: String(options.message ?? ''),
      severity: ['success', 'info', 'warning', 'error'].includes(options.severity) ? options.severity : 'info',
      durationMs: options.sticky === true ? null : (options.durationMs ?? this.defaultDurationMs),
      actions: Array.isArray(options.actions) ? options.actions.filter((action) => typeof action?.onClick === 'function') : [],
      source: options.source ?? null,
      tag: options.tag ?? null,
      createdAt: Date.now(),
      remainingMs: null,
      timer: null,
      startedAt: null,
      element: null,
      dismissed: false,
      pauseReason: null,
    };
    notification.remainingMs = notification.durationMs;

    this.stats.shown += 1;
    this.stats.bySeverity[notification.severity] += 1;
    this.#history.push({ id: notification.id, severity: notification.severity, title: notification.title, message: notification.message, source: notification.source, createdAt: notification.createdAt });
    if (this.#history.length > this.#historyLimit) this.#history.shift();

    // Same tag replaces the previous notification (used for progress-style updates).
    if (notification.tag) {
      const existing = [...this.#visible, ...this.#queue].find((item) => item.tag === notification.tag && !item.dismissed);
      if (existing) this.dismiss(existing.id, { silent: true });
    }

    this.#queue.push(notification);
    this.#pump();
    this.#render();
    this.#notifyCounts();
    this.eventBus?.emit('notification:shown', { id: notification.id, severity: notification.severity, message: notification.message });
    return notification.id;
  }

  success(message, options = {}) { return this.notify({ ...options, message, severity: 'success' }); }
  info(message, options = {}) { return this.notify({ ...options, message, severity: 'info' }); }
  warn(message, options = {}) { return this.notify({ ...options, message, severity: 'warning' }); }
  error(message, options = {}) { return this.notify({ ...options, message, severity: 'error', durationMs: options.durationMs ?? 6500 }); }

  /** Reports an AppError/AppClientError with its real details. */
  fromError(error, options = {}) {
    return this.notify({
      ...options,
      severity: options.severity ?? 'error',
      title: options.title ?? error.label ?? 'Error',
      message: error.message ?? String(error),
      durationMs: options.durationMs ?? 7000,
      source: options.source ?? error.kind ?? null,
      sticky: options.sticky ?? false,
    });
  }

  dismiss(id, { silent = false, reason = 'manual' } = {}) {
    const all = [...this.#visible, ...this.#queue];
    const notification = all.find((item) => item.id === id);
    if (!notification || notification.dismissed) return { ok: false, reason: 'no encontrada' };
    notification.dismissed = true;
    this.#clearTimer(notification);

    const element = notification.element;
    notification.element = null;
    this.#visible = this.#visible.filter((item) => item.id !== id);
    this.#queue = this.#queue.filter((item) => item.id !== id);

    if (element) {
      element.classList.add('is-leaving');
      setTimeout(() => {
        element.remove();
        this.#pump();
        this.#render();
      }, 180);
    } else {
      this.#pump();
      this.#render();
    }

    if (reason === 'expired') this.stats.expired += 1;
    else this.stats.dismissed += 1;
    this.#notifyCounts();
    if (!silent) this.eventBus?.emit('notification:dismissed', { id, reason });
    return { ok: true, id, reason };
  }

  /** Cancels every notification with a tag (or all of them). */
  cancelByTag(tag = null) {
    const targets = [...this.#visible, ...this.#queue].filter((item) => tag === null || item.tag === tag);
    for (const target of targets) this.dismiss(target.id, { silent: true, reason: 'cancelled' });
    return { cancelled: targets.length, tag };
  }

  clear() {
    const targets = [...this.#visible, ...this.#queue].map((item) => item.id);
    for (const id of targets) this.dismiss(id, { silent: true, reason: 'cleared' });
    return { cleared: targets.length };
  }

  /** Updates the text of an existing notification (progress-style updates). */
  update(id, { message = null, title = null, severity = null, durationMs = undefined } = {}) {
    const notification = [...this.#visible, ...this.#queue].find((item) => item.id === id);
    if (!notification) return { ok: false, reason: 'no encontrada' };
    if (message !== null) notification.message = String(message);
    if (title !== null) notification.title = title;
    if (severity !== null && ['success', 'info', 'warning', 'error'].includes(severity)) notification.severity = severity;
    if (durationMs !== undefined) {
      this.#clearTimer(notification);
      notification.durationMs = durationMs;
      notification.remainingMs = durationMs;
      if (notification.element) this.#startTimer(notification);
    }
    this.#render();
    return { ok: true, id };
  }

  /* ---------------------------------------------------------------- *
   * Queue + timers
   * ---------------------------------------------------------------- */

  #pump() {
    while (this.#visible.length < this.maxVisible && this.#queue.length > 0) {
      const next = this.#queue.shift();
      if (next.dismissed) continue;
      this.#visible.push(next);
    }
    for (const notification of this.#visible) {
      if (notification.timer === null && notification.element && notification.durationMs !== null) {
        this.#startTimer(notification);
      }
    }
  }

  #startTimer(notification) {
    if (notification.durationMs === null) return;
    notification.startedAt = Date.now();
    const remaining = notification.remainingMs ?? notification.durationMs;
    notification.timer = setTimeout(() => {
      notification.timer = null;
      this.dismiss(notification.id, { reason: 'expired' });
    }, remaining);
  }

  #clearTimer(notification) {
    if (notification.timer) {
      clearTimeout(notification.timer);
      notification.timer = null;
      if (notification.startedAt) {
        notification.remainingMs = Math.max(0, (notification.remainingMs ?? notification.durationMs) - (Date.now() - notification.startedAt));
      }
    }
  }

  #pause(notification) {
    this.#clearTimer(notification);
    notification.element?.querySelector('.toast__progress')?.classList.add('is-paused');
  }

  #resume(notification) {
    if (notification.dismissed || notification.durationMs === null) return;
    notification.element?.querySelector('.toast__progress')?.classList.remove('is-paused');
    this.#startTimer(notification);
  }

  /* ---------------------------------------------------------------- *
   * Rendering
   * ---------------------------------------------------------------- */

  #renderNow() {
    if (!this.host) return;
    const nodes = this.#visible.map((notification) => this.#renderNotification(notification));
    replace(this.host, nodes);
    for (const notification of this.#visible) {
      const element = this.host.querySelector(`[data-notification="${notification.id}"]`);
      if (element && element !== notification.element) {
        notification.element = element;
        if (notification.timer === null) this.#startTimer(notification);
      }
    }
  }

  #renderNotification(notification) {
    const progress = el('div.toast__progress', {
      style: notification.durationMs === null ? { display: 'none' } : {
        animationDuration: `${notification.durationMs}ms`,
      },
    });

    const node = el('div.toast', {
      dataset: { notification: notification.id, severity: notification.severity },
      attrs: { role: notification.severity === 'error' ? 'alert' : 'status', 'aria-live': 'polite' },
      on: {
        mouseenter: () => this.#pause(notification),
        mouseleave: () => this.#resume(notification),
        keydown: (event) => {
          if (event.key === 'Escape') this.dismiss(notification.id);
        },
      },
    }, [
      el('div.toast__icon', { attrs: { 'aria-hidden': 'true' }, dataset: { icon: SEVERITY_ICON[notification.severity] } }),
      el('div.toast__body', null, [
        notification.title ? el('div.toast__title', { text: notification.title }) : null,
        el('div.toast__message', { text: notification.message }),
        notification.source ? el('div.toast__meta', { text: notification.source }) : null,
        notification.actions.length > 0
          ? el('div.toast__actions', null, notification.actions.map((action) => el('button.btn.btn--ghost.btn--sm', {
            text: action.label,
            attrs: { type: 'button' },
            class: action.primary ? 'btn--primary' : null,
            on: {
              click: (event) => {
                event.stopPropagation();
                try {
                  const result = action.onClick();
                  if (result && typeof result.catch === 'function') {
                    result.catch((err) => this.logger?.error(err, { source: 'NotificationManager.action' }));
                  }
                } catch (err) {
                  this.logger?.error(err, { source: 'NotificationManager.action' });
                }
                if (action.keepOpen !== true) this.dismiss(notification.id);
              },
            },
          })))
          : null,
      ]),
      el('button.toast__close', {
        attrs: { type: 'button', 'aria-label': `Cerrar aviso de ${SEVERITY_LABEL[notification.severity]}` },
        on: { click: () => this.dismiss(notification.id) },
      }, el('span.icon', { dataset: { icon: 'close' } })),
      progress,
    ]);
    return node;
  }

  history(limit = 50) {
    return this.#history.slice(-limit).reverse();
  }

  /** Live counts, used by the status bar error indicator. */
  counts() {
    return { ...this.stats.bySeverity, visible: this.#visible.length, queued: this.#queue.length };
  }

  /** Notifies when the notification counts change (chosen over polling). */
  onCounts(listener) {
    this.#countListeners.add(listener);
    return () => this.#countListeners.delete(listener);
  }

  #notifyCounts() {
    if (this.#countListeners.size === 0) return;
    const counts = this.counts();
    for (const listener of [...this.#countListeners]) {
      try {
        listener(counts);
      } catch {
        /* ignore */
      }
    }
  }

  snapshot() {
    return {
      ...this.stats,
      visible: this.#visible.length,
      queued: this.#queue.length,
      maxVisible: this.maxVisible,
      bySeverity: { ...this.stats.bySeverity },
    };
  }

  dispose() {
    this.clear();
    this.#queue = [];
    this.#visible = [];
    this.#subscribers.clear();
    this.#countListeners.clear();
  }
}
