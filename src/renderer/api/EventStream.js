/**
 * EventStream — SSE client with real reconnection handling.
 *
 * The connection state is exposed (`connected` / `reconnecting` / `closed` / `unsupported`)
 * and every transition is reported, so the status bar always shows the truth about whether
 * live updates (runtime output, logs, errors) are actually flowing.
 */

import { SseEvent } from '../../shared/constants.js';

export class EventStream {
  #source = null;
  #listeners = new Map();
  #stateListeners = new Set();
  #reconnectAttempts = 0;
  #reconnectTimer = null;
  #manualClose = false;
  #stats = { messages: 0, byEvent: {}, connectedAt: null, disconnections: 0, lastEventAt: null };

  /**
   * @param {{ url?: string, clientId: string, onStateChange?: (state: string, detail: object) => void, maxReconnectDelayMs?: number }} options
   */
  constructor({ url = '/api/events', clientId, onStateChange = null, maxReconnectDelayMs = 15_000, logger = null }) {
    this.url = url;
    this.clientId = clientId;
    this.onStateChange = onStateChange;
    this.maxReconnectDelayMs = maxReconnectDelayMs;
    this.logger = logger;
    this.state = typeof EventSource === 'undefined' ? 'unsupported' : 'closed';
    this.lastError = null;
  }

  get supported() {
    return typeof EventSource !== 'undefined';
  }

  get stats() {
    return { ...this.#stats, byEvent: { ...this.#stats.byEvent }, state: this.state };
  }

  /** Subscribes to connection-state transitions. Returns a disposer. */
  subscribeState(listener) {
    this.#stateListeners.add(listener);
    return () => this.#stateListeners.delete(listener);
  }

  /** Subscribes to one SSE event. Returns a disposer. */
  on(eventName, handler) {
    let set = this.#listeners.get(eventName);
    if (!set) {
      set = new Set();
      this.#listeners.set(eventName, set);
    }
    set.add(handler);
    return () => set.delete(handler);
  }

  connect() {
    if (!this.supported) {
      this.#setState('unsupported', {
        reason: 'Este navegador no implementa EventSource; las actualizaciones en vivo están desactivadas.',
      });
      return false;
    }
    if (this.#source) return true;

    this.#manualClose = false;
    const query = `?client=${encodeURIComponent(this.clientId)}`;
    try {
      this.#source = new EventSource(`${this.url}${query}`);
    } catch (err) {
      this.#setState('closed', { reason: err.message });
      this.#scheduleReconnect();
      return false;
    }

    this.#source.onopen = () => {
      this.#reconnectAttempts = 0;
      this.#stats.connectedAt = Date.now();
      this.#setState('connected', {});
    };

    this.#source.onerror = (event) => {
      this.lastError = {
        message: this.#source?.readyState === 2
          ? 'El servidor cerró el canal de eventos'
          : 'Se interrumpió la conexión de eventos',
        readyState: this.#source?.readyState ?? null,
        timestamp: Date.now(),
      };
      this.#stats.disconnections += 1;
      if (this.#source) {
        this.#source.close();
        this.#source = null;
      }
      this.#setState('reconnecting', { attempt: this.#reconnectAttempts + 1, error: this.lastError });
      this.#scheduleReconnect();
      void event;
    };

    // One listener per known event type (plus a wildcard-ish default).
    const names = Object.values(SseEvent);
    for (const name of names) {
      this.#source.addEventListener(name, (event) => this.#dispatch(name, event));
    }
    this.#source.onmessage = (event) => this.#dispatch('message', event);
    this.#setState('connecting', {});
    return true;
  }

  #dispatch(name, event) {
    let payload = null;
    if (event.data !== undefined && event.data !== '') {
      try {
        payload = JSON.parse(event.data);
      } catch {
        payload = { raw: event.data };
      }
    }
    this.#stats.messages += 1;
    this.#stats.byEvent[name] = (this.#stats.byEvent[name] ?? 0) + 1;
    this.#stats.lastEventAt = Date.now();

    const handlers = this.#listeners.get(name);
    if (handlers) {
      for (const handler of [...handlers]) {
        try {
          handler(payload, name);
        } catch (err) {
          // A broken handler must not break the stream; the error is surfaced by the caller.
          // eslint-disable-next-line no-console
          console.error(`[EventStream] handler de "${name}" falló:`, err);
        }
      }
    }
  }

  #scheduleReconnect() {
    if (this.#manualClose) return;
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#reconnectAttempts += 1;
    const delay = Math.min(this.maxReconnectDelayMs, 500 * 2 ** Math.min(this.#reconnectAttempts - 1, 5));
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      if (!this.#manualClose) this.connect();
    }, delay);
    const message = `[EventStream] reconectando en ${delay} ms (intento ${this.#reconnectAttempts})`;
    if (this.logger?.info) this.logger.info(message, { source: 'EventStream' });
    else console.info(message);
  }

  #setState(state, detail) {
    if (this.state === state && detail?.attempt === undefined) return;
    this.state = state;
    this.onStateChange?.(state, detail ?? {});
    for (const listener of [...this.#stateListeners]) {
      try {
        listener(state, detail ?? {});
      } catch {
        /* a broken listener must not break the stream */
      }
    }
  }

  close() {
    this.#manualClose = true;
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    if (this.#source) {
      this.#source.close();
      this.#source = null;
    }
    this.#setState('closed', { reason: 'cerrado por la aplicación' });
  }

  removeAllListeners() {
    this.#listeners.clear();
  }
}
