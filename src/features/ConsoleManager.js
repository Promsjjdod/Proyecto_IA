/**
 * ConsoleManager — the real output of everything that happens in the app.
 *
 * Runtime output (browser workers and server engines), errors from every subsystem, plugin
 * logs and user actions land here with their level, source, line and timestamp. The model is
 * deliberately cheap: entries are plain objects, repeated consecutive messages collapse into a
 * counter, the buffer is bounded, and listeners are notified at most once per frame while
 * entries keep arriving (the view renders a window of them, never the whole history at once).
 */

import { Limits, LogLevel, LogLevelList } from '../shared/constants.js';
import { createScheduler } from '../renderer/utils/async.js';
import { describeValue, formatBytes } from '../renderer/utils/format.js';

const SEVERITY_ORDER = [LogLevel.ERROR, LogLevel.WARNING, LogLevel.SUCCESS, LogLevel.INFO, LogLevel.INPUT, LogLevel.OUTPUT, LogLevel.DEBUG, LogLevel.TRACE];

export class ConsoleManager {
  #entries = [];
  #pending = [];
  #filter = { levels: new Set([LogLevelList.find(Boolean)]), term: '', source: null, executionId: null };
  #paused = false;
  #autoScroll = true;
  #dropped = 0;
  #collapsed = 0;
  #sequence = 0;
  #subscribers = new Set();
  #scheduler = null;
  #counts = { total: 0, byLevel: {}, bySource: {} };
  #maxEntries;
  #showOutput;
  #pendingPayload = null;
  #unsubscribers = [];

  /**
   * @param {{ maxEntries?: number, logger?: object, settings?: object, eventBus?: object, errorBus?: object }} deps
   */
  constructor({ maxEntries = Limits.maxConsoleEntries, logger = null, settings = null, eventBus = null, errorBus = null } = {}) {
    this.#maxEntries = maxEntries;
    this.logger = logger;
    this.settings = settings;
    this.eventBus = eventBus;
    this.errorBus = errorBus;
    this.#scheduler = createScheduler(() => this.#flushNotifications());
    this.#filter.levels = new Set(LogLevelList);
    this.#showOutput = true;
  }

  /* ------------------------------------------------------------------ *
   * Lifecycle
   * ------------------------------------------------------------------ */

  init() {
    this.#maxEntries = Math.max(200, Math.min(50_000, this.settings?.get('performance.consoleMaxEntries') ?? this.#maxEntries));
    if (this.eventBus) {
      this.#unsubscribers.push(this.eventBus.on('runtime:output', (payload) => this.#onRuntimeOutput(payload)));
      this.#unsubscribers.push(this.eventBus.on('runtime:started', (payload) => this.executionStart(payload)));
      this.#unsubscribers.push(this.eventBus.on('runtime:finished', (payload) => this.#onRuntimeFinished(payload)));
      this.#unsubscribers.push(this.eventBus.on('console:plugin', (payload) => this.append({ level: LogLevel.INFO, message: payload.message, source: `plugin:${payload.pluginId}` })));
    }
    if (this.errorBus?.subscribe) {
      this.#unsubscribers.push(this.errorBus.subscribe((incident) => this.fromIncident(incident)));
    }
    if (this.settings?.subscribe) {
      this.#unsubscribers.push(this.settings.subscribe((values, detail) => {
        const changed = detail?.changed ?? [];
        if (changed.includes('performance.consoleMaxEntries')) {
          this.#maxEntries = Math.max(200, Math.min(50_000, values['performance.consoleMaxEntries']));
          this.#enforceLimit();
        }
        if (changed.includes('execution.showOutput')) this.#showOutput = values['execution.showOutput'] !== false;
      }));
    }
    this.append({ level: LogLevel.INFO, message: 'Consola lista. Ejecuta un script con Ctrl+Enter.', source: 'consola' });
    return { ok: true, maxEntries: this.#maxEntries };
  }

  dispose() {
    for (const off of this.#unsubscribers) off?.();
    this.#unsubscribers = [];
    this.#subscribers.clear();
    this.#scheduler?.dispose?.();
  }

  /* ------------------------------------------------------------------ *
   * Appending
   * ------------------------------------------------------------------ */

  /**
   * Adds an entry.
   * @param {{ level?: string, message?: string, source?: string|null, line?: number|null,
   *           data?: any, stream?: 'stdout'|'stderr'|null, executionId?: string|null, timestamp?: number,
   *           collapsible?: boolean }} entry
   */
  append(entry = {}) {
    const level = LogLevelList.includes(entry.level) ? entry.level : LogLevel.INFO;
    const message = entry.message === undefined || entry.message === null ? '' : String(entry.message);
    if (level === LogLevel.OUTPUT && !this.#showOutput) return null;
    const timestamp = Number.isFinite(entry.timestamp) ? entry.timestamp : Date.now();
    const suspect = {
      id: ++this.#sequence,
      timestamp,
      level,
      message,
      source: entry.source ?? null,
      line: Number.isFinite(entry.line) ? entry.line : null,
      data: entry.data ?? null,
      stream: entry.stream ?? null,
      executionId: entry.executionId ?? null,
      count: 1,
    };
    const target = this.#paused ? this.#pending : this.#entries;
    const last = target[target.length - 1];
    if (
      last
      && last.level === suspect.level
      && last.message === suspect.message
      && last.source === suspect.source
      && entry.collapsible !== false
      && timestamp - last.timestamp < 1500
    ) {
      last.count += 1;
      last.timestamp = timestamp;
      this.#collapsed += 1;
      this.#bumpCounts(suspect, -1);
      this.#scheduleNotification();
      return last;
    }
    target.push(suspect);
    if (target === this.#entries) this.#enforceLimit();
    this.#bumpCounts(suspect, 1);
    this.#scheduleNotification();
    return suspect;
  }

  info(message, detail = {}) { return this.append({ level: LogLevel.INFO, message, ...detail }); }
  success(message, detail = {}) { return this.append({ level: LogLevel.SUCCESS, message, ...detail }); }
  warn(message, detail = {}) { return this.append({ level: LogLevel.WARNING, message, ...detail }); }
  error(message, detail = {}) { return this.append({ level: LogLevel.ERROR, message, ...detail }); }
  debug(message, detail = {}) { return this.append({ level: LogLevel.DEBUG, message, ...detail }); }
  trace(message, detail = {}) { return this.append({ level: LogLevel.TRACE, message, ...detail }); }
  output(text, detail = {}) { return this.append({ level: LogLevel.OUTPUT, message: text, ...detail }); }

  /** Echoes what the user asked to run (so the console reflects the real action). */
  executionStart({ name = null, engineId = null, executionId = null, mode = null, origin = 'user' } = {}) {
    return this.append({
      level: LogLevel.INPUT,
      message: origin === 'user' ? `▶ Ejecutar ${name ?? 'script'} (${engineId ?? 'motor automático'}${mode === 'browser' ? ', en el navegador' : mode === 'server' ? ', en el servidor' : ''})` : `▶ Ejecución automática de ${name ?? 'script'}`,
      source: 'runtime',
      executionId,
    });
  }

  /**
   * Renders the outcome of an execution: state, duration, return values and the error with its
   * file/line/traceback when the engine provided one.
   */
  executionFinished(record) {
    const stats = record.stats ?? {};
    const duration = Number.isFinite(stats.durationMs) ? `${stats.durationMs} ms` : '—';
    const engine = record.engineLabel ?? record.engineId ?? '—';
    const level = record.state === 'SUCCESS' ? LogLevel.SUCCESS : record.state === 'STOPPED' ? LogLevel.WARNING : LogLevel.ERROR;
    const lines = [
      `${labelForState(record.state)} · ${engine} · ${duration}`,
      stats.peakMemoryBytes ? `memoria pico: ${formatBytes(stats.peakMemoryBytes)}` : null,
      stats.interrupts ? `interrupciones: ${stats.interrupts}` : null,
    ].filter(Boolean);
    if (record.returnValues?.length > 0) {
      lines.push(`valores devueltos: ${record.returnValues.map((value) => (value && typeof value === 'object' && 'type' in value && 'value' in value ? `${value.type}: ${value.value}` : describeValue(value))).join(', ')}`);
    }
    this.append({
      level,
      message: lines.join('\n'),
      source: 'runtime',
      executionId: record.executionId,
      data: { state: record.state, engineId: record.engineId, stats, returnValues: record.returnValues ?? [] },
      line: record.error?.detail?.line ?? record.error?.line ?? null,
      collapsible: false,
    });
    if (record.error) {
      this.append({
        level: LogLevel.ERROR,
        message: formatRuntimeError(record.error),
        source: 'runtime',
        executionId: record.executionId,
        data: { error: record.error },
        line: record.error?.detail?.line ?? record.error?.line ?? null,
        collapsible: false,
      });
    }
    return record;
  }

  /** Adds an error incident (ErrorBus) with its real file/line/stack when available. */
  fromIncident(incident) {
    if (!incident) return null;
    if (incident.kind === 'RUNTIME') return null; // already reported by executionFinished
    return this.append({
      level: incident.severity === 'WARNING' ? LogLevel.WARNING : LogLevel.ERROR,
      message: incident.message ?? 'Error',
      source: incident.source ?? incident.kind ?? 'app',
      line: Number.isFinite(incident.line) ? incident.line : null,
      data: { incident },
      collapsible: false,
    });
  }

  #onRuntimeOutput(payload) {
    if (!payload) return;
    const text = payload.text ?? '';
    if (text === '') return;
    for (const line of String(text).split('\n')) {
      if (line === '') continue;
      this.append({
        level: payload.level ?? (payload.stream === 'stderr' ? LogLevel.WARNING : LogLevel.OUTPUT),
        message: line,
        source: 'runtime',
        stream: payload.stream ?? 'stdout',
        executionId: payload.executionId ?? null,
      });
    }
  }

  #onRuntimeFinished(payload) {
    if (!payload) return;
    if (payload.state === 'SUCCESS') return; // executionFinished already logged the summary
    if (payload.error) {
      this.append({
        level: LogLevel.ERROR,
        message: `Ejecución ${labelForState(payload.state)}${payload.error ? `: ${payload.error}` : ''}`,
        source: 'runtime',
        executionId: payload.executionId ?? null,
        collapsible: false,
      });
    }
  }

  #bumpCounts(entry, delta) {
    this.#counts.total += delta;
    this.#counts.byLevel[entry.level] = (this.#counts.byLevel[entry.level] ?? 0) + delta;
    const source = entry.source ?? 'app';
    this.#counts.bySource[source] = (this.#counts.bySource[source] ?? 0) + delta;
  }

  #enforceLimit() {
    const overflow = this.#entries.length - this.#maxEntries;
    if (overflow <= 0) return;
    this.#entries.splice(0, overflow);
    this.#dropped += overflow;
  }

  /* ------------------------------------------------------------------ *
   * Views: filter, search, pause, clear, export
   * ------------------------------------------------------------------ */

  get entries() {
    return this.#entries;
  }

  get paused() {
    return this.#paused;
  }

  get autoScroll() {
    return this.#autoScroll;
  }

  get filter() {
    return { ...this.#filter, levels: [...this.#filter.levels] };
  }

  /** Entries matching the active filter (search is case-insensitive over message + source). */
  filtered({ limit = null } = {}) {
    const term = this.#filter.term.trim().toLowerCase();
    const levels = this.#filter.levels;
    const source = this.#filter.source;
    const executionId = this.#filter.executionId;
    const result = [];
    for (const entry of this.#entries) {
      if (!levels.has(entry.level)) continue;
      if (source && entry.source !== source) continue;
      if (executionId && entry.executionId !== executionId) continue;
      if (term) {
        const haystack = `${entry.message}\n${entry.source ?? ''}\n${entry.line ?? ''}`.toLowerCase();
        if (!haystack.includes(term)) continue;
      }
      result.push(entry);
      if (limit && result.length >= limit) break;
    }
    return result;
  }

  count(level) {
    return this.#counts.byLevel[level] ?? 0;
  }

  stats() {
    return {
      total: this.#counts.total,
      byLevel: { ...this.#counts.byLevel },
      bySource: { ...this.#counts.bySource },
      stored: this.#entries.length,
      pending: this.#pending.length,
      dropped: this.#dropped,
      collapsed: this.#collapsed,
      paused: this.#paused,
      maxEntries: this.#maxEntries,
    };
  }

  setLevelVisible(level, visible) {
    if (!LogLevelList.includes(level)) return { ok: false, reason: 'unknown-level' };
    if (visible) this.#filter.levels.add(level);
    else this.#filter.levels.delete(level);
    if (this.#filter.levels.size === 0) this.#filter.levels.add(LogLevel.ERROR);
    this.#scheduleNotification({ reason: 'filter' });
    return { ok: true, levels: [...this.#filter.levels] };
  }

  setSearch(term) {
    this.#filter.term = String(term ?? '');
    this.#scheduleNotification({ reason: 'search' });
    return { ok: true, term: this.#filter.term };
  }

  setSource(source) {
    this.#filter.source = source || null;
    this.#scheduleNotification({ reason: 'source' });
    return { ok: true, source: this.#filter.source };
  }

  resetFilter() {
    this.#filter = { levels: new Set(LogLevelList), term: '', source: null, executionId: null };
    this.#scheduleNotification({ reason: 'filter-reset' });
    return { ok: true };
  }

  pause() {
    this.#paused = true;
    this.#scheduleNotification({ reason: 'paused' });
    return { ok: true, pending: this.#pending.length };
  }

  resume() {
    this.#paused = false;
    const buffered = this.#pending;
    this.#pending = [];
    for (const entry of buffered) {
      const last = this.#entries[this.#entries.length - 1];
      if (last && last.level === entry.level && last.message === entry.message && last.source === entry.source) {
        last.count += entry.count;
        last.timestamp = entry.timestamp;
      } else {
        this.#entries.push(entry);
      }
      this.#bumpCounts(entry, 1);
    }
    this.#enforceLimit();
    this.#scheduleNotification({ reason: 'resumed', flushed: buffered.length });
    return { ok: true, flushed: buffered.length };
  }

  togglePause() {
    return this.#paused ? this.resume() : this.pause();
  }

  setAutoScroll(value) {
    this.#autoScroll = value !== false;
    this.#scheduleNotification({ reason: 'autoscroll' });
    return { ok: true, autoScroll: this.#autoScroll };
  }

  clear() {
    const cleared = this.#entries.length + this.#pending.length;
    this.#entries = [];
    this.#pending = [];
    this.#counts = { total: 0, byLevel: {}, bySource: {} };
    this.#dropped = 0;
    this.#collapsed = 0;
    this.#scheduleNotification({ reason: 'clear', cleared });
    this.eventBus?.emit('console:cleared', { cleared });
    return { ok: true, cleared };
  }

  /** Plain-text rendering of the filtered entries (used by copy and export). */
  toText({ withHeader = true } = {}) {
    const lines = [];
    if (withHeader) {
      lines.push(`# Consola de Lumen Studio — ${new Date().toISOString()}`);
      lines.push(`# ${this.filtered().length} de ${this.#entries.length} entradas (límite ${this.#maxEntries})`);
      lines.push('');
    }
    for (const entry of this.filtered()) {
      const time = new Date(entry.timestamp).toISOString().slice(11, 23);
      const source = entry.source ? ` [${entry.source}${entry.line ? `:${entry.line}` : ''}]` : '';
      lines.push(`${time} ${entry.level}${source} ${entry.message}${entry.count > 1 ? ` (x${entry.count})` : ''}`);
    }
    if (this.#paused && this.#pending.length > 0) lines.push(`# ${this.#pending.length} entradas en espera (consola en pausa)`);
    return lines.join('\n');
  }

  /**
   * Exports the console as a file (real Blob download). Returns the filename and size.
   */
  exportLogs({ format = 'txt' } = {}) {
    if (format === 'json') {
      const payload = {
        exportedAt: new Date().toISOString(),
        stats: this.stats(),
        filter: this.filter,
        entries: this.filtered().map((entry) => ({
          timestamp: new Date(entry.timestamp).toISOString(),
          level: entry.level,
          message: entry.message,
          source: entry.source,
          line: entry.line,
          stream: entry.stream,
          executionId: entry.executionId,
          count: entry.count,
        })),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const filename = `lumen-consola-${timestampSlug()}.json`;
      downloadBlob(blob, filename);
      return { ok: true, filename, bytes: blob.size, format };
    }
    const blob = new Blob([this.toText()], { type: 'text/plain;charset=utf-8' });
    const filename = `lumen-consola-${timestampSlug()}.log`;
    downloadBlob(blob, filename);
    return { ok: true, filename, bytes: blob.size, format: 'txt' };
  }

  /** Copies the filtered log to the clipboard (real Clipboard API, with honest failure). */
  async copyAll() {
    const text = this.toText();
    if (!text) return { ok: false, error: new Error('No hay nada que copiar') };
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true, bytes: text.length };
    } catch (err) {
      return { ok: false, error: err, text };
    }
  }

  /* ------------------------------------------------------------------ *
   * Subscriptions
   * ------------------------------------------------------------------ */

  subscribe(listener) {
    this.#subscribers.add(listener);
    return () => this.#subscribers.delete(listener);
  }

  #scheduleNotification(payload) {
    this.#pendingPayload = payload ?? null;
    this.#scheduler();
  }

  #flushNotifications() {
    const payload = { reason: 'change', ...(this.#pendingPayload ?? {}) };
    this.#pendingPayload = null;
    const stats = this.stats();
    for (const listener of [...this.#subscribers]) {
      try {
        listener(payload, stats);
      } catch (err) {
        this.logger?.error?.(err, { source: 'ConsoleManager.subscriber' });
      }
    }
  }
}

function labelForState(state) {
  switch (state) {
    case 'SUCCESS': return '✔ Ejecución completada';
    case 'STOPPED': return '■ Ejecución detenida';
    case 'ERROR': return '✖ Ejecución con errores';
    case 'UNAVAILABLE': return '⚠ Runtime no disponible';
    case 'RUNNING': return '▶ Ejecución en curso';
    default: return '· Ejecución';
  }
}

function formatRuntimeError(error) {
  if (!error) return 'Error desconocido';
  const parts = [error.label ?? error.code ?? 'Error', error.message ?? ''];
  const detail = error.detail ?? {};
  const location = detail.file || detail.line
    ? `${detail.file ?? 'script'}${detail.line ? `:${detail.line}${detail.column ? `:${detail.column}` : ''}` : ''}`
    : null;
  if (location) parts.push(`en ${location}`);
  if (Array.isArray(detail.traceback) && detail.traceback.length > 0) {
    parts.push('');
    for (const frame of detail.traceback.slice(0, 12)) {
      parts.push(`  ${frame.function ?? '?'} (${frame.file ?? '?'}:${frame.line ?? '?'})`);
    }
  } else if (detail.stack) {
    parts.push('');
    for (const line of String(detail.stack).split('\n').slice(0, 12)) parts.push(`  ${line}`);
  }
  return parts.filter((part) => part !== null && part !== undefined).join('\n');
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next frame: Safari needs the URL alive during the click.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
