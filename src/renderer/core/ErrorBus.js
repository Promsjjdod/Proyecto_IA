/**
 * ErrorBus — global error handling for the browser side.
 *
 * Responsibilities:
 *  - traps `window.onerror`, unhandled promise rejections and resource load errors;
 *  - normalises everything into a single shape (`{ code, kind, message, file, line, stack }`);
 *  - keeps a bounded incident list that the About/Diagnostics view reads (real incidents only);
 *  - forwards incidents to the server log so the unified log contains client-side failures too;
 *  - never throws from inside the handler (an error in error handling would be a real bug).
 */

import { ErrorKind } from '../../shared/constants.js';

const MAX_INCIDENTS = 200;

export class ErrorBus {
  #incidents = [];
  #subscribers = new Set();
  #counters = { total: 0, byKind: {}, byCode: {} };
  #installed = false;
  #dedupe = new Map();

  constructor({ apiClient = null, logger = null, dedupeWindowMs = 2000 } = {}) {
    this.apiClient = apiClient;
    this.logger = logger;
    this.dedupeWindowMs = dedupeWindowMs;
  }

  /**
   * Normalises any thrown value into an incident record.
   * @param {unknown} error
   * @param {{ source?: string, kind?: string, file?: string|null, line?: number|null, column?: number|null, silent?: boolean }} [context]
   */
  report(error, context = {}) {
    const incident = this.#normalize(error, context);

    // The same failure triggered in a loop must not flood the console.
    const fingerprint = `${incident.code}:${incident.kind}:${incident.message}:${incident.file ?? ''}:${incident.line ?? ''}`;
    const lastSeen = this.#dedupe.get(fingerprint);
    if (lastSeen && incident.timestamp - lastSeen < this.dedupeWindowMs) {
      const existing = this.#incidents[this.#incidents.length - 1];
      if (existing && existing.fingerprint === fingerprint) {
        existing.repeat += 1;
        existing.timestamp = incident.timestamp;
        this.#notify(existing, { repeat: true });
        return existing;
      }
    }
    this.#dedupe.set(fingerprint, incident.timestamp);
    incident.fingerprint = fingerprint;
    incident.repeat = 1;

    this.#incidents.push(incident);
    if (this.#incidents.length > MAX_INCIDENTS) this.#incidents.shift();

    this.#counters.total += 1;
    this.#counters.byKind[incident.kind] = (this.#counters.byKind[incident.kind] ?? 0) + 1;
    this.#counters.byCode[incident.code] = (this.#counters.byCode[incident.code] ?? 0) + 1;

    if (!context.silent) this.#notify(incident, { repeat: false });
    this.#forward(incident);
    return incident;
  }

  #normalize(error, context) {
    if (error && typeof error === 'object' && error.name === 'AppClientError') {
      return {
        id: newIncidentId(),
        timestamp: error.timestamp ?? Date.now(),
        code: error.code,
        kind: error.kind,
        message: error.message,
        source: context.source ?? 'api',
        file: context.file ?? null,
        line: context.line ?? null,
        column: context.column ?? null,
        stack: error.stack ?? null,
        detail: error.detail ?? {},
        severity: 'error',
        status: error.status ?? null,
      };
    }
    if (error instanceof Error) {
      return {
        id: newIncidentId(),
        timestamp: Date.now(),
        code: error.code ?? 'E_UNKNOWN',
        kind: context.kind ?? ErrorKind.UI,
        message: error.message,
        source: context.source ?? 'window',
        file: context.file ?? error.fileName ?? null,
        line: context.line ?? error.lineNumber ?? null,
        column: context.column ?? error.columnNumber ?? null,
        stack: error.stack ?? null,
        detail: error.detail ?? {},
        severity: 'error',
        status: null,
      };
    }
    return {
      id: newIncidentId(),
      timestamp: Date.now(),
      code: 'E_UNKNOWN',
      kind: context.kind ?? ErrorKind.UI,
      message: typeof error === 'string' ? error : JSON.stringify(error ?? 'Error desconocido'),
      source: context.source ?? 'window',
      file: context.file ?? null,
      line: context.line ?? null,
      column: context.column ?? null,
      stack: null,
      detail: {},
      severity: 'error',
      status: null,
    };
  }

  /** Subscribes to new incidents. Returns a disposer. */
  subscribe(listener) {
    this.#subscribers.add(listener);
    return () => this.#subscribers.delete(listener);
  }

  #notify(incident, { repeat }) {
    for (const listener of [...this.#subscribers]) {
      try {
        listener(incident, { repeat });
      } catch {
        /* never let a listener break the error path */
      }
    }
  }

  /** Sends the incident to the server log (best effort, real request). */
  #forward(incident) {
    if (!this.apiClient) return;
    this.apiClient.post('/api/system/log', {
      level: 'ERROR',
      source: `cliente:${incident.source}`,
      message: incident.message,
      file: incident.file,
      line: incident.line,
      data: {
        code: incident.code,
        kind: incident.kind,
        stack: incident.stack ? String(incident.stack).slice(0, 4000) : null,
        detail: incident.detail,
        url: location.pathname,
      },
    }, { timeoutMs: 5000 }).catch(() => {
      // The server is unreachable: the incident stays local and is shown in the console.
    });
  }

  incidents(limit = 50) {
    return this.#incidents.slice(-limit).reverse();
  }

  stats() {
    return {
      ...this.#counters,
      byKind: { ...this.#counters.byKind },
      byCode: { ...this.#counters.byCode },
      lastTimestamp: this.#incidents.length > 0 ? this.#incidents[this.#incidents.length - 1].timestamp : null,
    };
  }

  clear() {
    const cleared = this.#incidents.length;
    this.#incidents = [];
    this.#dedupe.clear();
    return { cleared };
  }

  /** Installs the global listeners. Idempotent. */
  install() {
    if (this.#installed) return;
    this.#installed = true;

    window.addEventListener('error', (event) => {
      // Resource loading errors have no `error` object but do have a target.
      if (!event.error && event.target && event.target !== window && event.target.tagName) {
        const target = event.target;
        this.report(new Error(`No se pudo cargar ${target.tagName.toLowerCase()} ${target.src ?? target.href ?? ''}`), {
          source: 'resource',
          kind: ErrorKind.NETWORK,
          file: target.src ?? target.href ?? null,
        });
        return;
      }
      this.report(event.error ?? new Error(event.message), {
        source: 'window.error',
        file: event.filename ?? null,
        line: event.lineno ?? null,
        column: event.colno ?? null,
      });
    }, true);

    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      this.report(reason && typeof reason === 'object' ? reason : new Error(String(reason)), {
        source: 'unhandledrejection',
        kind: ErrorKind.INTERNAL,
      });
    });
  }
}

function newIncidentId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
