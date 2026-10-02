/**
 * Minimal, dependency-free event bus used by every subsystem.
 *
 * Features that matter for this application:
 *  - listeners are isolated: one throwing listener never breaks the emitter;
 *  - `on()` returns a disposable + an `off()` function (no leaked subscriptions);
 *  - optional wildcard topics (`script.*`);
 *  - a bounded recent-event buffer so the UI can show real activity without keeping history forever.
 */

import { AppError, toAppError } from '../../shared/errors.js';
import { ErrorKind } from '../../shared/constants.js';

export class EventBus {
  #listeners = new Map();
  #wildcards = new Map();
  #recent = [];
  #recentLimit;
  #onListenerError;

  /**
   * @param {{ recentLimit?: number, onListenerError?: (error: AppError, topic: string) => void, label?: string }} [options]
   */
  constructor({ recentLimit = 50, onListenerError = null, label = 'EventBus' } = {}) {
    this.label = label;
    this.#recentLimit = recentLimit;
    this.#onListenerError = onListenerError;
  }

  /**
   * Subscribes to a topic. Supports a trailing wildcard segment: `'script.*'`.
   * @param {string} topic
   * @param {(payload: any, topic: string) => void} handler
   * @returns {{ dispose(): void, off(): void }}
   */
  on(topic, handler) {
    if (typeof handler !== 'function') {
      throw new AppError({ message: 'El handler de un evento debe ser una función', kind: ErrorKind.INTERNAL });
    }
    const isWildcard = topic.endsWith('.*');
    const map = isWildcard ? this.#wildcards : this.#listeners;
    const key = isWildcard ? topic.slice(0, -1) : topic;
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(handler);
    const dispose = () => this.off(topic, handler);
    return { dispose, off: dispose };
  }

  /** Subscribes for a single emission. */
  once(topic, handler) {
    const sub = this.on(topic, (payload, name) => {
      sub.dispose();
      handler(payload, name);
    });
    return sub;
  }

  off(topic, handler) {
    const isWildcard = topic.endsWith('.*');
    const map = isWildcard ? this.#wildcards : this.#listeners;
    const key = isWildcard ? topic.slice(0, -1) : topic;
    const set = map.get(key);
    if (!set) return false;
    const removed = set.delete(handler);
    if (set.size === 0) map.delete(key);
    return removed;
  }

  /** Removes every listener (used on teardown). */
  clear() {
    this.#listeners.clear();
    this.#wildcards.clear();
  }

  /** Number of registered listeners for a topic (diagnostics / leak checks). */
  listenerCount(topic) {
    if (topic === undefined) {
      let total = 0;
      for (const set of this.#listeners.values()) total += set.size;
      for (const set of this.#wildcards.values()) total += set.size;
      return total;
    }
    const isWildcard = topic.endsWith('.*');
    const map = isWildcard ? this.#wildcards : this.#listeners;
    return map.get(isWildcard ? topic.slice(0, -1) : topic)?.size ?? 0;
  }

  /**
   * Emits a payload. Handlers run synchronously in registration order; errors are
   * reported through `onListenerError` (or the console) but never propagate.
   */
  emit(topic, payload = undefined) {
    this.#remember(topic, payload);
    this.#dispatch(this.#listeners.get(topic), payload, topic);
    for (const [prefix, handlers] of this.#wildcards) {
      if (topic.startsWith(prefix)) this.#dispatch(handlers, payload, topic);
    }
    return this;
  }

  /** Asynchronous emission on the microtask queue (keeps UI frames free). */
  emitAsync(topic, payload = undefined) {
    queueMicrotask(() => this.emit(topic, payload));
    return this;
  }

  #dispatch(handlers, payload, topic) {
    if (!handlers || handlers.size === 0) return;
    for (const handler of [...handlers]) {
      try {
        handler(payload, topic);
      } catch (err) {
        const appError = toAppError(err, {
          kind: ErrorKind.INTERNAL,
          message: `Un listener de "${topic}" lanzó una excepción`,
          detail: { topic, bus: this.label },
        });
        if (this.#onListenerError) {
          try {
            this.#onListenerError(appError, topic);
          } catch {
            /* the error reporter itself failed: never rethrow from emit */
          }
        } else {
          // eslint-disable-next-line no-console
          console.error(`[${this.label}] listener error on "${topic}":`, appError.message);
        }
      }
    }
  }

  #remember(topic, payload) {
    if (this.#recentLimit <= 0) return;
    this.#recent.push({ topic, payload, timestamp: Date.now() });
    if (this.#recent.length > this.#recentLimit) this.#recent.shift();
  }

  /** Real recent activity (used by the dashboard). Returns a copy. */
  recentEvents(limit = this.#recentLimit) {
    return this.#recent.slice(-limit);
  }
}

/** Single shared bus for application-wide notifications. */
export const appEvents = new EventBus({ label: 'AppEvents', recentLimit: 80 });
