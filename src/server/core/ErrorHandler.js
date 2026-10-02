/**
 * Global error handling for the server process.
 *
 * Responsibilities:
 *  - normalise every error into an `AppError`;
 *  - log it with full context (kind, code, file, line, stack);
 *  - publish it on the event bus so the UI can render it in the console/notification area;
 *  - keep a bounded incident history that the dashboard reads (no invented stats);
 *  - trap uncaught exceptions / unhandled rejections so the process fails loudly but never silently.
 */

import { ErrorKind, LogLevel, RuntimeState } from '../../shared/constants.js';
import { AppError, toAppError } from '../../shared/errors.js';
import { EventBus } from './EventBus.js';

const MAX_INCIDENTS = 200;

export class ErrorHandler {
  #incidents = [];
  #handlers = new Set();
  #installed = false;
  #onFatal;

  /**
   * @param {{ logger: import('./Logger.js').Logger, bus: EventBus, onFatal?: (error: AppError) => void }} options
   */
  constructor({ logger, bus, onFatal = null }) {
    this.logger = logger;
    this.bus = bus ?? new EventBus({ label: 'ErrorHandler' });
    this.#onFatal = onFatal;
  }

  /**
   * Reports an error: logs it, stores the incident and notifies subscribers.
   * @param {unknown} error
   * @param {{ source?: string, kind?: string, message?: string, detail?: object, silent?: boolean }} [context]
   * @returns {AppError}
   */
  report(error, context = {}) {
    const appError = error instanceof AppError && !context.message
      ? error
      : toAppError(error, {
        kind: context.kind ?? (error instanceof AppError ? error.kind : ErrorKind.INTERNAL),
        message: context.message,
        detail: { source: context.source, ...(context.detail ?? {}) },
      });

    const source = context.source ?? appError.detail?.source ?? 'server';

    if (!context.silent) {
      this.logger.error(appError, {
        source,
        detail: { ...appError.detail, source },
      });
    }

    const incident = {
      id: `inc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      source,
      code: appError.code,
      kind: appError.kind,
      label: appError.label,
      message: appError.message,
      file: appError.detail?.file ?? null,
      line: appError.detail?.line ?? null,
      column: appError.detail?.column ?? null,
      stack: appError.stack ?? null,
      detail: appError.detail ?? {},
      runtimeState: appError.kind === ErrorKind.RUNTIME ? RuntimeState.ERROR : null,
    };

    this.#incidents.push(incident);
    if (this.#incidents.length > MAX_INCIDENTS) this.#incidents.shift();

    for (const handler of [...this.#handlers]) {
      try {
        handler(appError, incident);
      } catch (handlerError) {
        this.logger.log(LogLevel.WARNING, `Un handler de errores falló: ${handlerError.message}`, { source: 'ErrorHandler' });
      }
    }

    this.bus.emit('error', incident);
    return appError;
  }

  /** Registers a subscriber. Returns a disposer. */
  subscribe(handler) {
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }

  /** Real incident history, newest last. */
  incidents(limit = 50) {
    return this.#incidents.slice(-limit);
  }

  /** Aggregated counters derived from the incident log (never fabricated). */
  stats() {
    const byKind = {};
    const byCode = {};
    for (const incident of this.#incidents) {
      byKind[incident.kind] = (byKind[incident.kind] ?? 0) + 1;
      byCode[incident.code] = (byCode[incident.code] ?? 0) + 1;
    }
    return {
      total: this.#incidents.length,
      lastTimestamp: this.#incidents.length > 0 ? this.#incidents[this.#incidents.length - 1].timestamp : null,
      byKind,
      byCode,
    };
  }

  clear() {
    const cleared = this.#incidents.length;
    this.#incidents = [];
    return cleared;
  }

  /** Installs process level guards. Safe to call twice. */
  installProcessGuards() {
    if (this.#installed) return;
    this.#installed = true;

    process.on('uncaughtException', (error) => {
      this.report(error, { source: 'process.uncaughtException', kind: ErrorKind.INTERNAL });
      if (this.#onFatal) this.#onFatal(toAppError(error, { kind: ErrorKind.INTERNAL }));
    });

    process.on('unhandledRejection', (reason) => {
      this.report(reason, { source: 'process.unhandledRejection', kind: ErrorKind.INTERNAL });
    });

    process.on('warning', (warning) => {
      this.logger.log(LogLevel.WARNING, warning.message, {
        source: 'process.warning',
        data: { name: warning.name, code: warning.code },
      });
    });
  }
}
