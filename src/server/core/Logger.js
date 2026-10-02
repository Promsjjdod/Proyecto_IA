/**
 * Server-side logger.
 *
 * Real behaviour:
 *  - writes structured entries to stdout (human readable) and to a rotating log file;
 *  - keeps an in-memory ring buffer of the most recent entries exposed through `recent()`;
 *  - never throws: a failing log write degrades to console output and emits a warning once;
 *  - redacts values whose keys look sensitive (tokens, passwords, api keys) before writing.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ErrorKind, LogLevel, LogLevelWeight } from '../../shared/constants.js';
import { AppError, toAppError } from '../../shared/errors.js';

const SENSITIVE_KEY = /(pass(word)?|secret|token|api[-_]?key|credential|authorization|cookie)/i;

/** Recursively replaces sensitive values with a redaction marker. */
export function redact(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(item, depth + 1);
  }
  return output;
}

export class Logger {
  #stream = null;
  #filePath = null;
  #buffer = [];
  #bufferLimit;
  #minLevel;
  #writeQueue = Promise.resolve();
  #fileFailures = 0;
  #fileDisabled = false;
  #reportedFileFailure = false;
  #maxFileBytes;
  #bytesWritten = 0;

  /**
   * @param {{ directory?: string|null, minLevel?: string, bufferLimit?: number, maxFileBytes?: number, label?: string, mirrorToConsole?: boolean }} [options]
   */
  constructor({
    directory = null,
    minLevel = LogLevel.TRACE,
    bufferLimit = 2000,
    maxFileBytes = 2 * 1024 * 1024,
    label = 'app',
    mirrorToConsole = true,
  } = {}) {
    this.label = label;
    this.#minLevel = minLevel;
    this.#bufferLimit = bufferLimit;
    this.#maxFileBytes = maxFileBytes;
    this.mirrorToConsole = mirrorToConsole;
    this.directory = directory;
  }

  /** Opens (or reopens) the log file. Missing permissions degrade gracefully. */
  async openFile() {
    if (!this.directory || this.#fileDisabled) return { ok: false, path: null };
    try {
      await fsp.mkdir(this.directory, { recursive: true });
      const filePath = path.join(this.directory, `${this.label}.log`);
      const stat = await fsp.stat(filePath).catch(() => null);
      this.#bytesWritten = stat?.size ?? 0;
      await this.#rotateIfNeeded(filePath);
      this.#stream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' });
      this.#stream.on('error', (err) => this.#handleFileError(err, filePath));
      this.#filePath = filePath;
      return { ok: true, path: filePath };
    } catch (err) {
      this.#handleFileError(err, path.join(this.directory ?? '.', `${this.label}.log`));
      return { ok: false, path: null };
    }
  }

  #handleFileError(err, filePath) {
    this.#fileFailures += 1;
    this.#fileDisabled = true;
    const appError = toAppError(err, {
      kind: ErrorKind.STORAGE,
      message: `No se pudo escribir el log en ${filePath}`,
      detail: { filePath, failures: this.#fileFailures },
    });
    if (!this.#reportedFileFailure) {
      this.#reportedFileFailure = true;
      // eslint-disable-next-line no-console
      console.error(`[logger] sistema de logs en archivo desactivado: ${appError.message}`);
    }
  }

  async #rotateIfNeeded(filePath) {
    if (this.#bytesWritten < this.#maxFileBytes) return;
    const rotated = `${filePath}.1`;
    try {
      await fsp.rm(rotated, { force: true });
      await fsp.rename(filePath, rotated);
      this.#bytesWritten = 0;
    } catch {
      // If rotation fails we keep appending; the size cap is a best effort guard.
    }
  }

  /** File logging status, surfaced in the UI's capabilities panel. */
  get fileStatus() {
    return {
      enabled: Boolean(this.#stream) && !this.#fileDisabled,
      path: this.#filePath,
      failures: this.#fileFailures,
      rotated: this.#bytesWritten === 0 && this.#filePath !== null,
    };
  }

  setMinLevel(level) {
    if (LogLevelWeight[level] === undefined) {
      throw new AppError({ message: `Nivel de log inválido: ${level}`, kind: ErrorKind.INTERNAL });
    }
    this.#minLevel = level;
  }

  get minLevel() {
    return this.#minLevel;
  }

  /**
   * @param {string} level  One of `LogLevel`
   * @param {string} message
   * @param {object} [meta]
   */
  log(level, message, meta = {}) {
    if (LogLevelWeight[level] === undefined) level = LogLevel.INFO;
    if (LogLevelWeight[level] > LogLevelWeight[this.#minLevel]) return null;

    const entry = {
      timestamp: Date.now(),
      level,
      source: typeof meta.source === 'string' ? meta.source : this.label,
      message: String(message),
      file: typeof meta.file === 'string' ? meta.file : null,
      line: Number.isInteger(meta.line) ? meta.line : null,
      data: meta.data ? redact(meta.data) : null,
    };

    this.#buffer.push(entry);
    if (this.#buffer.length > this.#bufferLimit) this.#buffer.splice(0, this.#buffer.length - this.#bufferLimit);

    if (this.mirrorToConsole) this.#mirror(entry);
    this.#appendToFile(entry);
    return entry;
  }

  info(message, meta) { return this.log(LogLevel.INFO, message, meta); }
  success(message, meta) { return this.log(LogLevel.SUCCESS, message, meta); }
  warn(message, meta) { return this.log(LogLevel.WARNING, message, meta); }
  debug(message, meta) { return this.log(LogLevel.DEBUG, message, meta); }
  trace(message, meta) { return this.log(LogLevel.TRACE, message, meta); }

  /** Logs an `AppError` (or anything throwable) preserving kind/code/stack. */
  error(error, meta = {}) {
    const appError = error instanceof AppError ? error : toAppError(error, { detail: meta.detail });
    return this.log(LogLevel.ERROR, appError.message, {
      ...meta,
      source: meta.source ?? this.label,
      file: appError.detail?.file ?? meta.file ?? null,
      line: appError.detail?.line ?? meta.line ?? null,
      data: {
        code: appError.code,
        kind: appError.kind,
        detail: appError.detail,
        stack: appError.stack,
        ...(meta.data ?? {}),
      },
    });
  }

  /** Last N entries (used by `GET /api/system/logs`). */
  recent(limit = 200, level = null) {
    const filtered = level ? this.#buffer.filter((entry) => entry.level === level) : this.#buffer;
    return filtered.slice(-limit);
  }

  #mirror(entry) {
    const stamp = new Date(entry.timestamp).toISOString().slice(11, 23);
    const prefix = `[${stamp}] ${entry.level.padEnd(7)} ${entry.source.padEnd(14)}`;
    const text = `${prefix} ${entry.message}${entry.file ? ` (${entry.file}${entry.line ? `:${entry.line}` : ''})` : ''}`;
    switch (entry.level) {
      case LogLevel.ERROR:
        // eslint-disable-next-line no-console
        console.error(text);
        break;
      case LogLevel.WARNING:
        // eslint-disable-next-line no-console
        console.warn(text);
        break;
      case LogLevel.DEBUG:
      case LogLevel.TRACE:
        // eslint-disable-next-line no-console
        console.debug(text);
        break;
      default:
        // eslint-disable-next-line no-console
        console.log(text);
    }
  }

  #appendToFile(entry) {
    if (!this.#stream || this.#fileDisabled) return;
    const record = `${JSON.stringify({
      ts: new Date(entry.timestamp).toISOString(),
      level: entry.level,
      source: entry.source,
      message: entry.message,
      file: entry.file,
      line: entry.line,
      data: entry.data,
    })}\n`;
    this.#bytesWritten += Buffer.byteLength(record);
    const stream = this.#stream;
    this.#writeQueue = this.#writeQueue
      .then(() => new Promise((resolve) => {
        if (!stream.write(record)) {
          stream.once('drain', resolve);
        } else {
          resolve();
        }
      }))
      .catch((err) => this.#handleFileError(err, this.#filePath ?? 'unknown'));
  }

  /** Flushes pending writes (called during graceful shutdown). */
  async close() {
    await this.#writeQueue.catch(() => {});
    if (!this.#stream) return;
    await new Promise((resolve) => {
      this.#stream.end(() => resolve());
    });
    this.#stream = null;
  }
}

/** Root logger instance used by the server; replaced during bootstrap. */
export const rootLogger = new Logger({ label: 'lumen' });
