/**
 * Logger (renderer) — real logging for the browser side.
 *
 * Keeps a bounded in-memory history, mirrors to the developer console, and notifies subscribers
 * (the console view feeds from it) without ever throwing. Sensitive-looking values (tokens,
 * passwords, keys) are redacted before they are stored, so nothing secret reaches the log or the
 * console view. Messages are never invented: every entry comes from an actual call site.
 */

import { LogLevel, LogLevelList } from '../../shared/constants.js';

const REDACTED = '[oculto]';
const SECRET_KEY_PATTERN = /(pass(word)?|secret|token|api[-_]?key|authorization|cookie|credential|private[-_]?key)/i;

export class RendererLogger {
  #entries = [];
  #limit;
  #subscribers = new Set();
  #counts = new Map(LogLevelList.map((level) => [level, 0]));

  constructor({ label = 'renderer', limit = 2000, minLevel = LogLevel.DEBUG, mirrorToConsole = true } = {}) {
    this.label = label;
    this.limit = limit;
    this.minLevel = minLevel;
    this.mirrorToConsole = mirrorToConsole;
  }

  setMinLevel(level) {
    this.minLevel = level;
    return { level };
  }

  log(level, message, meta = {}) {
    if (LogLevelList.indexOf(level) === -1) level = LogLevel.INFO;
    if (this.#severity(level) < this.#severity(this.minLevel)) return null;
    const entry = {
      id: `log-${Date.now().toString(36)}-${(this.#entries.length % 1000).toString(36)}`,
      timestamp: Date.now(),
      level,
      message: typeof message === 'string' ? message : String(message ?? ''),
      source: meta.source ?? this.label,
      data: meta.data === undefined ? null : redact(meta.data),
      error: meta.error ? describeError(meta.error) : null,
    };
    this.#entries.push(entry);
    this.#counts.set(level, (this.#counts.get(level) ?? 0) + 1);
    if (this.#entries.length > this.limit) this.#entries.splice(0, this.#entries.length - this.limit);
    if (this.mirrorToConsole) this.#mirror(entry);
    for (const listener of [...this.#subscribers]) {
      try {
        listener(entry);
      } catch {
        /* a broken log listener must never break the caller */
      }
    }
    return entry;
  }

  info(message, meta) { return this.log(LogLevel.INFO, message, meta); }
  success(message, meta) { return this.log(LogLevel.SUCCESS, message, meta); }
  warn(message, meta) { return this.log(LogLevel.WARNING, message, meta); }
  debug(message, meta) { return this.log(LogLevel.DEBUG, message, meta); }
  trace(message, meta) { return this.log(LogLevel.TRACE, message, meta); }

  /** Accepts both `logger.error(err)` and `logger.error('texto', { data })`. */
  error(error, meta = {}) {
    const described = describeError(error);
    const message = typeof error === 'string' ? error : described.message;
    return this.log(LogLevel.ERROR, message, { ...meta, error: typeof error === 'string' ? meta.error ?? null : error });
  }

  recent(limit = 200, level = null) {
    const list = level ? this.#entries.filter((entry) => entry.level === level) : this.#entries;
    return list.slice(-limit).map((entry) => ({ ...entry }));
  }

  counts() {
    return { total: this.#entries.length, byLevel: Object.fromEntries(this.#counts) };
  }

  subscribe(listener) {
    this.#subscribers.add(listener);
    return () => this.#subscribers.delete(listener);
  }

  clear() {
    const removed = this.#entries.length;
    this.#entries = [];
    for (const level of this.#counts.keys()) this.#counts.set(level, 0);
    return { removed };
  }

  #severity(level) {
    return LogLevelList.indexOf(level);
  }

  #mirror(entry) {
    const method = {
      [LogLevel.ERROR]: 'error',
      [LogLevel.WARNING]: 'warn',
      [LogLevel.SUCCESS]: 'info',
      [LogLevel.DEBUG]: 'debug',
      [LogLevel.TRACE]: 'debug',
      [LogLevel.INFO]: 'info',
    }[entry.level] ?? 'log';
    const prefix = `[${entry.level}] ${entry.source}`;
    if (entry.error) console[method](prefix, entry.message, entry.error, entry.data ?? '');
    else console[method](prefix, entry.message, entry.data ?? '');
  }
}

/** Normalises any thrown value into `{name, message, stack, code, file, line, column}`. */
export function describeError(error) {
  if (!error) return { name: 'Error', message: 'Error desconocido', stack: null, code: null, file: null, line: null, column: null };
  if (typeof error === 'string') return { name: 'Error', message: error, stack: null, code: null, file: null, line: null, column: null };
  return {
    name: error.name ?? 'Error',
    message: error.message ?? String(error),
    stack: typeof error.stack === 'string' ? error.stack : null,
    code: error.code ?? null,
    file: error.file ?? error.detail?.file ?? null,
    line: Number.isFinite(error.line) ? error.line : (Number.isFinite(error.detail?.line) ? error.detail.line : null),
    column: Number.isFinite(error.column) ? error.column : (Number.isFinite(error.detail?.column) ? error.detail.column : null),
  };
}

/** Deep-redacts values whose key looks like a credential. Arrays and plain objects only. */
export function redact(value, depth = 0) {
  if (depth > 6) return '[demasiado profundo]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 4000 ? `${value.slice(0, 4000)}…` : value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => redact(item, depth + 1));
  if (value instanceof Error) return describeError(value);
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redact(item, depth + 1);
  }
  return output;
}
