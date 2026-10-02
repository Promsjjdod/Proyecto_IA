/**
 * Wire protocol helpers shared by the HTTP API, the SSE stream and the runtime
 * workers. Contains no I/O: pure validation and normalisation so both sides of the
 * connection agree on the exact shape of every message.
 */

import { AppError, errors, safeJsonParse } from './errors.js';
import { ErrorCode, ErrorKind, Limits, LogLevel, RuntimeState, Dialect, DialectList } from './constants.js';

/* ------------------------------------------------------------------ *
 * Primitive validators
 * ------------------------------------------------------------------ */

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function expectString(value, field, { min = 0, max = Infinity, allowEmpty = true } = {}) {
  if (typeof value !== 'string') {
    throw errors.invalid(`El campo "${field}" debe ser un texto`, { field, received: typeof value });
  }
  if (!allowEmpty && value.length === 0) {
    throw errors.invalid(`El campo "${field}" no puede estar vacío`, { field });
  }
  if (value.length < min || value.length > max) {
    throw errors.invalid(`El campo "${field}" debe tener entre ${min} y ${max} caracteres`, { field, length: value.length });
  }
  return value;
}

export function expectNumber(value, field, { min = -Infinity, max = Infinity, integer = false } = {}) {
  const num = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof num !== 'number' || !Number.isFinite(num)) {
    throw errors.invalid(`El campo "${field}" debe ser numérico`, { field, received: value });
  }
  if (integer && !Number.isInteger(num)) {
    throw errors.invalid(`El campo "${field}" debe ser un entero`, { field, received: value });
  }
  if (num < min || num > max) {
    throw errors.invalid(`El campo "${field}" debe estar entre ${min} y ${max}`, { field, received: num });
  }
  return num;
}

export function expectBoolean(value, field) {
  if (typeof value !== 'boolean') {
    throw errors.invalid(`El campo "${field}" debe ser booleano`, { field, received: typeof value });
  }
  return value;
}

export function expectEnum(value, field, allowed) {
  if (!allowed.includes(value)) {
    throw errors.invalid(`El campo "${field}" debe ser uno de: ${allowed.join(', ')}`, { field, received: value, allowed });
  }
  return value;
}

export function expectScriptId(value, field = 'id') {
  const id = expectString(value, field, { min: 1, max: 128, allowEmpty: false });
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    throw errors.invalid(`El identificador "${id}" contiene caracteres no permitidos`, { field, received: id });
  }
  return id;
}

/** Ensures a value is an array of strings (used by tags, globals, dependencies). */
export function expectStringArray(value, field, { max = 64, maxLength = 120 } = {}) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw errors.invalid(`El campo "${field}" debe ser una lista`, { field, received: typeof value });
  }
  if (value.length > max) {
    throw errors.invalid(`El campo "${field}" admite como máximo ${max} elementos`, { field, length: value.length });
  }
  return value.map((item, index) => expectString(item, `${field}[${index}]`, { max: maxLength, allowEmpty: false }));
}

export function expectDialect(value, field = 'dialect') {
  return expectEnum(value, field, DialectList);
}

/* ------------------------------------------------------------------ *
 * HTTP helpers
 * ------------------------------------------------------------------ */

export function jsonResponse(payload, { status = 200, headers = {} } = {}) {
  return { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers }, body: JSON.stringify(payload) };
}

export function errorResponse(error, { status } = {}) {
  const appError = error instanceof AppError ? error : new AppError({ message: String(error) });
  return jsonResponse(
    { ok: false, error: appError.toJSON() },
    { status: status ?? httpStatusForCode(appError.code) },
  );
}

export function httpStatusForCode(code) {
  switch (code) {
    case ErrorCode.NOT_FOUND:
      return 404;
    case ErrorCode.ALREADY_EXISTS:
      return 409;
    case ErrorCode.PERMISSION_DENIED:
      return 403;
    case ErrorCode.UNSAFE_PATH:
      return 403;
    case ErrorCode.INVALID_ARGUMENT:
    case ErrorCode.VALIDATION_FAILED:
    case ErrorCode.SYNTAX:
      return 400;
    case ErrorCode.UNAVAILABLE:
    case ErrorCode.DEPENDENCY_MISSING:
      return 503;
    case ErrorCode.TIMEOUT:
      return 504;
    case ErrorCode.CANCELLED:
      return 499;
    case ErrorCode.DISK_FULL:
      return 507;
    default:
      return 500;
  }
}

/**
 * Reads and parses a JSON request body with a hard size limit.
 * @param {import('node:http').IncomingMessage} req
 * @param {{ limit?: number }} [options]
 */
export function readJsonBody(req, { limit = Limits.maxSourceBytes + 64 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        fail(new AppError({
          message: `El cuerpo de la petición excede el límite de ${limit} bytes`,
          code: ErrorCode.INVALID_ARGUMENT,
          kind: ErrorKind.NETWORK,
          detail: { limit },
        }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.trim() === '') {
        resolve({});
        return;
      }
      const parsed = safeJsonParse(raw, 'El cuerpo JSON de la petición');
      if (!parsed.ok) {
        reject(parsed.error);
        return;
      }
      resolve(parsed.value);
    });
    req.on('error', (err) => fail(new AppError({
      message: 'Se interrumpió la lectura de la petición',
      code: ErrorCode.NETWORK_FAILED,
      kind: ErrorKind.NETWORK,
      cause: err,
    })));
  });
}

/* ------------------------------------------------------------------ *
 * Execution request/response shapes
 * ------------------------------------------------------------------ */

/**
 * Validates an execution request coming from the client.
 * @returns {{ source: string, dialect: string, engineId: string|null, options: object }}
 */
export function normalizeExecutionRequest(input = {}) {
  const source = expectString(input.source ?? '', 'source', { max: Limits.maxSourceBytes });
  const dialect = input.dialect === undefined ? Dialect.LUAU : expectDialect(input.dialect);
  const engineId = input.engineId === undefined || input.engineId === null || input.engineId === 'auto'
    ? null
    : expectString(input.engineId, 'engineId', { max: 64, allowEmpty: false });
  const rawOptions = isPlainObject(input.options) ? input.options : {};
  const options = {
    timeoutMs: rawOptions.timeoutMs === undefined
      ? Limits.defaultTimeoutMs
      : expectNumber(rawOptions.timeoutMs, 'options.timeoutMs', { min: Limits.minTimeoutMs, max: Limits.maxTimeoutMs, integer: true }),
    memoryLimitBytes: rawOptions.memoryLimitBytes === undefined
      ? Limits.defaultMemoryLimitBytes
      : expectNumber(rawOptions.memoryLimitBytes, 'options.memoryLimitBytes', { min: Limits.minMemoryLimitBytes, max: Limits.maxMemoryLimitBytes, integer: true }),
    outputLimitBytes: rawOptions.outputLimitBytes === undefined
      ? Limits.defaultOutputLimitBytes
      : expectNumber(rawOptions.outputLimitBytes, 'options.outputLimitBytes', { min: 1024, max: 16 * 1024 * 1024, integer: true }),
    debugLevel: rawOptions.debugLevel === undefined ? 1 : expectNumber(rawOptions.debugLevel, 'options.debugLevel', { min: 0, max: 2, integer: true }),
    scriptName: rawOptions.scriptName === undefined ? null : expectString(rawOptions.scriptName, 'options.scriptName', { max: 256 }),
  };
  if (source.length === 0) {
    throw errors.invalid('No hay código para ejecutar', { field: 'source' });
  }
  return { source, dialect, engineId, options };
}

/** Normalises an engine result into the canonical `ExecutionResult`. */
export function normalizeExecutionResult(raw = {}, { executionId = null, engineId = null, dialect = null } = {}) {
  const ok = raw.ok === true;
  const state = raw.state
    ?? (ok ? RuntimeState.SUCCESS : (raw.error?.code === ErrorCode.CANCELLED ? RuntimeState.STOPPED : RuntimeState.ERROR));
  return {
    executionId: raw.executionId ?? executionId,
    engineId: raw.engineId ?? engineId,
    dialect: raw.dialect ?? dialect,
    ok,
    state,
    outputs: Array.isArray(raw.outputs) ? raw.outputs.map(normalizeOutputEntry).filter(Boolean) : [],
    returnValues: Array.isArray(raw.returnValues) ? raw.returnValues.map(describeValue) : [],
    error: raw.error ? normalizeExecutionError(raw.error) : null,
    stats: {
      durationMs: typeof raw.stats?.durationMs === 'number' ? raw.stats.durationMs : null,
      queuedMs: typeof raw.stats?.queuedMs === 'number' ? raw.stats.queuedMs : null,
      startupMs: typeof raw.stats?.startupMs === 'number' ? raw.stats.startupMs : null,
      peakMemoryBytes: typeof raw.stats?.peakMemoryBytes === 'number' ? raw.stats.peakMemoryBytes : null,
      interrupts: typeof raw.stats?.interrupts === 'number' ? raw.stats.interrupts : null,
      outputBytes: typeof raw.stats?.outputBytes === 'number' ? raw.stats.outputBytes : null,
      cancelled: raw.stats?.cancelled === true,
      timedOut: raw.stats?.timedOut === true,
      truncated: raw.stats?.truncated === true,
    },
    startedAt: raw.startedAt ?? null,
    finishedAt: raw.finishedAt ?? Date.now(),
  };
}

function normalizeOutputEntry(entry) {
  if (!entry) return null;
  const level = Object.values(LogLevel).includes(entry.level) ? entry.level : LogLevel.INFO;
  return {
    level,
    stream: entry.stream === 'stderr' ? 'stderr' : 'stdout',
    text: typeof entry.text === 'string' ? entry.text : String(entry.text ?? ''),
    timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : Date.now(),
  };
}

function normalizeExecutionError(error) {
  if (error instanceof AppError) return error.toJSON();
  if (error && typeof error === 'object') {
    return {
      name: 'RuntimeError',
      code: error.code ?? ErrorCode.RUNTIME,
      kind: error.kind ?? ErrorKind.RUNTIME,
      label: error.label ?? 'Error de ejecución',
      message: typeof error.message === 'string' ? error.message : String(error.message ?? error),
      detail: isPlainObject(error.detail) ? error.detail : {},
      expose: error.expose !== false,
      timestamp: error.timestamp ?? Date.now(),
      stack: typeof error.stack === 'string' ? error.stack : null,
      cause: error.cause ?? null,
    };
  }
  return {
    name: 'RuntimeError',
    code: ErrorCode.RUNTIME,
    kind: ErrorKind.RUNTIME,
    label: 'Error de ejecución',
    message: String(error),
    detail: {},
    expose: true,
    timestamp: Date.now(),
    stack: null,
    cause: null,
  };
}

/**
 * Converts a Luau value (already JSON-safe) into a `{ type, value }` descriptor.
 * Values that are already in descriptor form (`{ type, value }`) are returned untouched so
 * engines can describe rich values (buffers, vectors, maps) without being double-wrapped.
 */
export function describeValue(value) {
  if (isValueDescriptor(value)) return value;
  if (value === null || value === undefined) return { type: 'nil', value: null };
  const type = Array.isArray(value) ? 'table' : typeof value;
  if (type === 'number') {
    if (Number.isInteger(value)) return { type: 'integer', value };
    if (Number.isNaN(value)) return { type: 'number', value: 'nan' };
    if (!Number.isFinite(value)) return { type: 'number', value: value > 0 ? 'inf' : '-inf' };
    return { type: 'number', value };
  }
  if (type === 'string' || type === 'boolean') return { type, value };
  if (type === 'object') return { type: 'table', value };
  return { type: 'table', value: String(value) };
}

/* ------------------------------------------------------------------ *
 * Worker protocol (browser runtime workers)
 * ------------------------------------------------------------------ */

export const WorkerMessage = Object.freeze({
  INIT: 'init',
  READY: 'ready',
  RUN: 'run',
  STOP: 'stop',
  DISPOSE: 'dispose',
  OUTPUT: 'output',
  RESULT: 'result',
  FAULT: 'fault',
});

export const workerMessageFactory = Object.freeze({
  ready(payload) {
    return { type: WorkerMessage.READY, ...payload };
  },
  output(executionId, text, { level = LogLevel.INFO, stream = 'stdout' } = {}) {
    return { type: WorkerMessage.OUTPUT, executionId, text, level, stream, timestamp: Date.now() };
  },
  result(payload) {
    return { type: WorkerMessage.RESULT, ...payload };
  },
  fault(executionId, error) {
    return { type: WorkerMessage.FAULT, executionId, error: normalizeExecutionError(error) };
  },
});

const VALUE_TYPES = new Set(['nil', 'boolean', 'number', 'integer', 'string', 'table', 'buffer', 'vector', 'function', 'thread', 'userdata']);

function isValueDescriptor(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && VALUE_TYPES.has(value.type)
    && Object.prototype.hasOwnProperty.call(value, 'value')
    && Object.keys(value).every((key) => key === 'type' || key === 'value');
}

/**
 * Parses the line/column information out of a Lua/Luau error message.
 *
 * Both runtimes report errors as `[prefix:] <chunk>:<line>: <message>`, optionally followed
 * by a `stack traceback:`. Examples that must all be understood:
 *   `script.luau:2: attempt to index nil with 'x'`
 *   `runtime error: script.luau:2: attempt to index nil with 'x'\nstack traceback:...`
 *   `[string "local t = nil..."]:2: attempt to index a nil value (local 't')`
 */
export function parseRuntimeLocation(message, { defaultFile = null } = {}) {
  if (typeof message !== 'string' || message.length === 0) {
    return { file: defaultFile, line: null, column: null, cleanMessage: message ?? '' };
  }
  const firstNewline = message.indexOf('\n');
  const headline = (firstNewline === -1 ? message : message.slice(0, firstNewline)).trim();
  const prefixMatch = /^(?:syntax error|runtime error|compile error)\s*:\s*/i.exec(headline);
  const body = prefixMatch ? headline.slice(prefixMatch[0].length) : headline;

  // Chunk names may contain paths and spaces; the line marker is the first `:(\d+):`.
  const match = /^(.*?):(\d+):\s*([\s\S]*)$/.exec(body);
  if (!match) {
    return { file: defaultFile, line: null, column: null, cleanMessage: headline };
  }
  const rawFile = match[1].trim().replace(/^\[string\s+"([^"]*)\.\.\."\]$/, '$1').replace(/^@/, '');
  const line = Number.parseInt(match[2], 10);
  const rest = match[3].trim();
  return {
    file: rawFile === '' ? defaultFile : rawFile,
    line: Number.isFinite(line) ? line : null,
    column: null,
    cleanMessage: rest === '' ? headline : rest,
  };
}

/** Extracts the traceback frames (`file:line`) from a Luau error message. */
export function parseRuntimeTraceback(message) {
  if (typeof message !== 'string') return [];
  const lines = message.split('\n');
  const frames = [];
  for (const rawLine of lines) {
    const line = rawLine.trim().replace(/^stack traceback:\s*/i, '');
    if (line === '' || /^(stack traceback|\[C\])/i.test(line)) continue;
    const match = /^([^:]+):(\d+)(?::\s*(.*))?$/.exec(line);
    if (match) {
      frames.push({
        file: match[1],
        line: Number.parseInt(match[2], 10),
        function: match[3] && match[3] !== '' ? match[3] : null,
      });
    }
  }
  return frames;
}
