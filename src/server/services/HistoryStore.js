/**
 * HistoryStore — append-only, bounded activity history.
 *
 * Two real record types are stored in `data/meta/history.json`:
 *  - `activity`: file/UI level events (created, saved, renamed, deleted, imported, theme changed...);
 *  - `execution`: runtime executions with engine, dialect, duration, exit state and error summary.
 *
 * The file is capped (oldest entries are dropped) and written through the atomic
 * StorageManager so a crash can never leave it truncated.
 */

import { ErrorKind, Limits, RuntimeState } from '../../shared/constants.js';
import { toAppError } from '../../shared/errors.js';

const FILE = 'meta/history.json';

export class HistoryStore {
  #records = [];
  #dirty = false;
  #flushTimer = null;

  /**
   * @param {{ storage: import('./StorageManager.js').StorageManager, logger, errorHandler, bus, limit?: number }} options
   */
  constructor({ storage, logger, errorHandler, bus, limit = Limits.maxHistoryEntries }) {
    this.storage = storage;
    this.logger = logger;
    this.errorHandler = errorHandler;
    this.bus = bus;
    this.limit = limit;
    this.loadResult = null;
  }

  async load() {
    const result = await this.storage.readJson(FILE, { fallback: { version: 1, records: [] } });
    this.loadResult = result;
    const records = Array.isArray(result.value?.records) ? result.value.records : [];
    this.#records = records.filter(isValidRecord).slice(-this.limit);
    this.wasRecovered = result.recovered;
    if (result.recovered) {
      this.errorHandler.report(
        toAppError(result.error ?? new Error('Historial ilegible'), {
          kind: ErrorKind.STORAGE,
          message: 'El historial estaba dañado; se aisló y se empezó uno nuevo',
          detail: { corruptPath: result.corruptPath },
        }),
        { source: 'HistoryStore.load' },
      );
    }
    this.bus.emit('history:loaded', { count: this.#records.length, recovered: result.recovered });
    return { count: this.#records.length, recovered: result.recovered, corruptPath: result.corruptPath };
  }

  /** Adds an activity record and schedules a flush. */
  recordActivity({ type, title, detail = {}, scriptId = null, severity = 'INFO' }) {
    return this.#push({
      kind: 'activity',
      type,
      title,
      detail,
      scriptId,
      severity,
    });
  }

  /** Adds an execution record built from a real `ExecutionResult`. */
  recordExecution(execution, { scriptId = null, scriptName = null } = {}) {
    return this.#push({
      kind: 'execution',
      type: 'runtime.execute',
      title: scriptName ? `Ejecución de ${scriptName}` : 'Ejecución de código',
      scriptId,
      detail: {
        executionId: execution.executionId,
        engineId: execution.engineId,
        dialect: execution.dialect,
        state: execution.state,
        ok: execution.ok,
        durationMs: execution.stats?.durationMs ?? null,
        peakMemoryBytes: execution.stats?.peakMemoryBytes ?? null,
        outputs: execution.outputs.length,
        errorMessage: execution.error?.message ?? null,
        errorCode: execution.error?.code ?? null,
        errorLine: execution.error?.detail?.line ?? null,
        cancelled: execution.stats?.cancelled === true,
        timedOut: execution.stats?.timedOut === true,
      },
      severity: execution.state === RuntimeState.SUCCESS ? 'SUCCESS' : execution.state === RuntimeState.STOPPED ? 'WARNING' : 'ERROR',
    });
  }

  #push(record) {
    const entry = {
      id: `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      ...record,
    };
    this.#records.push(entry);
    if (this.#records.length > this.limit) this.#records.splice(0, this.#records.length - this.limit);
    this.#scheduleFlush();
    this.bus.emit('history:record', entry);
    return entry;
  }

  #scheduleFlush() {
    this.#dirty = true;
    if (this.#flushTimer) return;
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      void this.flush();
    }, 750);
    if (typeof this.#flushTimer.unref === 'function') this.#flushTimer.unref();
  }

  async flush() {
    if (!this.#dirty) return { ok: true, skipped: true };
    this.#dirty = false;
    try {
      await this.storage.writeJson(FILE, { version: 1, updatedAt: Date.now(), records: this.#records });
      return { ok: true, count: this.#records.length };
    } catch (err) {
      this.#dirty = true;
      const appError = toAppError(err, {
        kind: ErrorKind.STORAGE,
        message: 'No se pudo guardar el historial',
      });
      this.errorHandler.report(appError, { source: 'HistoryStore.flush' });
      return { ok: false, error: appError };
    }
  }

  /** Newest-first list with optional filters. */
  list({ limit = 100, kind = null, scriptId = null, severity = null } = {}) {
    let records = [...this.#records].reverse();
    if (kind) records = records.filter((record) => record.kind === kind);
    if (scriptId) records = records.filter((record) => record.scriptId === scriptId);
    if (severity) records = records.filter((record) => record.severity === severity);
    return records.slice(0, Math.max(0, Math.min(limit, this.limit)));
  }

  /** Real aggregate numbers for the dashboard. */
  stats() {
    const executions = this.#records.filter((record) => record.kind === 'execution');
    const durations = executions.map((record) => record.detail?.durationMs).filter((value) => typeof value === 'number');
    const errors = executions.filter((record) => record.detail?.ok === false && record.detail?.cancelled !== true);
    const last = executions.length > 0 ? executions[executions.length - 1] : null;
    return {
      totalRecords: this.#records.length,
      executions: executions.length,
      successfulExecutions: executions.filter((record) => record.detail?.ok === true).length,
      failedExecutions: errors.length,
      cancelledExecutions: executions.filter((record) => record.detail?.cancelled === true).length,
      timedOutExecutions: executions.filter((record) => record.detail?.timedOut === true).length,
      totalExecutionMs: durations.reduce((sum, value) => sum + value, 0),
      averageExecutionMs: durations.length > 0 ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null,
      fastestExecutionMs: durations.length > 0 ? Math.min(...durations) : null,
      slowestExecutionMs: durations.length > 0 ? Math.max(...durations) : null,
      lastExecution: last
        ? { timestamp: last.timestamp, state: last.detail?.state ?? null, durationMs: last.detail?.durationMs ?? null, scriptId: last.scriptId ?? null }
        : null,
      firstRecordAt: this.#records.length > 0 ? this.#records[0].timestamp : null,
    };
  }

  /** Removes all history (used by Settings → Storage). */
  async clear() {
    const removed = this.#records.length;
    this.#records = [];
    this.#dirty = true;
    await this.flush();
    this.bus.emit('history:cleared', { removed });
    return { ok: true, removed };
  }

  /** Exports history as JSONL for the console export feature. */
  toJsonLines({ kind = null, limit = 1000 } = {}) {
    const records = this.list({ kind, limit });
    return records.map((record) => JSON.stringify(record)).join('\n');
  }
}

function isValidRecord(record) {
  return Boolean(record) && typeof record === 'object' && typeof record.type === 'string' && typeof record.timestamp === 'number';
}
