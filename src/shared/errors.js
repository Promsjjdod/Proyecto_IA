/**
 * Unified error model.
 *
 * Every subsystem throws `AppError` instances so that the global error handler can
 * classify, log and display them consistently. `toAppError()` normalises anything
 * that is thrown by third party code (Error, string, DOMException, node errno, ...).
 */

import { ErrorCode, ErrorKind } from './constants.js';

/** Default human readable (Spanish) descriptions per error kind. */
const KIND_LABEL = Object.freeze({
  [ErrorKind.INTERNAL]: 'Error interno',
  [ErrorKind.UI]: 'Error de interfaz',
  [ErrorKind.EDITOR]: 'Error del editor',
  [ErrorKind.STORAGE]: 'Error de almacenamiento',
  [ErrorKind.RUNTIME]: 'Error de ejecución',
  [ErrorKind.PLUGIN]: 'Error de plugin',
  [ErrorKind.NETWORK]: 'Error de red',
  [ErrorKind.PARSE]: 'Error de análisis sintáctico',
  [ErrorKind.SETTINGS]: 'Error de configuración',
  [ErrorKind.THEME]: 'Error de tema',
  [ErrorKind.SECURITY]: 'Error de seguridad',
  [ErrorKind.SCRIPT]: 'Error de script',
  [ErrorKind.SHORTCUT]: 'Error de atajo',
  [ErrorKind.COMMAND]: 'Error de comando',
});

export class AppError extends Error {
  /**
   * @param {object} options
   * @param {string} options.message  Human readable message (already localised).
   * @param {string} [options.code]   Stable error code from `ErrorCode`.
   * @param {string} [options.kind]   One of `ErrorKind`.
   * @param {object} [options.detail] Extra structured data: { file, line, column, stack, hint, dependency, ... }
   * @param {Error}  [options.cause]  Original error, preserved for debugging.
   * @param {boolean}[options.expose] Whether the message is safe to show to the user.
   * @param {string} [options.label] Explicit label overriding the one derived from `kind`.
   */
  constructor({ message, code = ErrorCode.UNKNOWN, kind = ErrorKind.INTERNAL, detail = {}, cause = undefined, expose = true, label = null }) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.kind = kind;
    this.detail = { ...detail };
    this.expose = expose;
    this.labelOverride = label;
    this.timestamp = Date.now();
    if (cause !== undefined) this.cause = cause;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, AppError);
    }
  }

  get label() {
    return this.labelOverride ?? KIND_LABEL[this.kind] ?? KIND_LABEL[ErrorKind.INTERNAL];
  }

  /** Adds detail keys without losing the existing ones. */
  withDetail(detail) {
    this.detail = { ...this.detail, ...detail };
    return this;
  }

  /** Serializable representation safe for API responses and log files. */
  toJSON() {
    return {
      name: 'AppError',
      code: this.code,
      kind: this.kind,
      label: this.label,
      message: this.message,
      detail: this.detail,
      expose: this.expose,
      timestamp: this.timestamp,
      stack: this.stack ?? null,
      cause: this.cause ? describeCause(this.cause) : null,
    };
  }
}

function describeCause(cause) {
  if (cause instanceof Error) {
    return { name: cause.name, message: cause.message, code: cause.code ?? null, stack: cause.stack ?? null };
  }
  return { message: String(cause) };
}

/** Maps node fs errno codes onto our stable error codes. */
export function fromFsError(err) {
  const code = err?.code;
  switch (code) {
    case 'ENOENT':
      return ErrorCode.NOT_FOUND;
    case 'EEXIST':
      return ErrorCode.ALREADY_EXISTS;
    case 'EACCES':
    case 'EPERM':
    case 'EROFS':
      return ErrorCode.PERMISSION_DENIED;
    case 'ENOTDIR':
    case 'EISDIR':
      return ErrorCode.INVALID_ARGUMENT;
    case 'ENOSPC':
      return ErrorCode.DISK_FULL;
    case 'EMFILE':
    case 'ENFILE':
      return ErrorCode.WRITE_FAILED;
    case 'EINVAL':
      return ErrorCode.INVALID_ARGUMENT;
    default:
      return ErrorCode.WRITE_FAILED;
  }
}

const FS_CODE_MESSAGES = Object.freeze({
  [ErrorCode.NOT_FOUND]: 'El archivo o directorio no existe',
  [ErrorCode.ALREADY_EXISTS]: 'El recurso ya existe',
  [ErrorCode.PERMISSION_DENIED]: 'Permisos insuficientes para acceder al recurso',
  [ErrorCode.DISK_FULL]: 'No hay espacio suficiente en disco',
  [ErrorCode.INVALID_ARGUMENT]: 'Argumento inválido',
  [ErrorCode.WRITE_FAILED]: 'No se pudo escribir el recurso',
});

/**
 * Normalises any thrown value into an `AppError`.
 * @param {unknown} value
 * @param {{ kind?: string, code?: string, message?: string, detail?: object }} [fallback]
 * @returns {AppError}
 */
export function toAppError(value, fallback = {}) {
  if (value instanceof AppError) {
    if (fallback.kind && value.kind === ErrorKind.INTERNAL) value.kind = fallback.kind;
    return value;
  }
  if (value instanceof Error) {
    const fsCode = value.code && typeof value.code === 'string' && /^E[A-Z]+$/.test(value.code) ? fromFsError(value) : null;
    const code = fallback.code ?? fsCode ?? ErrorCode.UNKNOWN;
    const message = fallback.message ?? (fsCode ? FS_CODE_MESSAGES[fsCode] ?? value.message : value.message);
    return new AppError({
      message,
      code,
      kind: fallback.kind ?? ErrorKind.INTERNAL,
      detail: { ...fallback.detail, originalName: value.name, originalCode: value.code ?? null },
      cause: value,
      expose: fallback.expose ?? true,
    });
  }
  return new AppError({
    message: fallback.message ?? String(value),
    code: fallback.code ?? ErrorCode.UNKNOWN,
    kind: fallback.kind ?? ErrorKind.INTERNAL,
    detail: { ...fallback.detail, raw: value === null ? 'null' : typeof value },
  });
}

/* ------------------------------------------------------------------ *
 * Factory helpers used across services (keeps call sites short).
 * ------------------------------------------------------------------ */

export const errors = Object.freeze({
  notFound(what, detail) {
    return new AppError({
      message: `${what} no existe`,
      code: ErrorCode.NOT_FOUND,
      kind: detail?.kind ?? ErrorKind.STORAGE,
      detail,
    });
  },
  exists(what, detail) {
    return new AppError({
      message: `${what} ya existe`,
      code: ErrorCode.ALREADY_EXISTS,
      kind: detail?.kind ?? ErrorKind.STORAGE,
      detail,
    });
  },
  permission(message, detail) {
    return new AppError({
      message: message ?? 'Permisos insuficientes',
      code: ErrorCode.PERMISSION_DENIED,
      kind: ErrorKind.STORAGE,
      detail,
    });
  },
  invalid(message, detail) {
    return new AppError({
      message,
      code: ErrorCode.INVALID_ARGUMENT,
      kind: ErrorKind.SETTINGS,
      detail,
    });
  },
  corrupt(message, detail) {
    return new AppError({
      message,
      code: ErrorCode.CORRUPT_DATA,
      kind: ErrorKind.STORAGE,
      detail,
    });
  },
  unsafePath(message, detail) {
    return new AppError({
      message: message ?? 'Ruta fuera del área permitida',
      code: ErrorCode.UNSAFE_PATH,
      kind: ErrorKind.SECURITY,
      detail,
    });
  },
  failed(message, detail) {
    return new AppError({
      message,
      code: ErrorCode.WRITE_FAILED,
      kind: ErrorKind.STORAGE,
      detail,
    });
  },
  unavailable(what, requirement, detail) {
    return new AppError({
      message: `${what} no está disponible en este entorno`,
      code: ErrorCode.UNAVAILABLE,
      kind: ErrorKind.RUNTIME,
      detail: { requirement, ...detail },
    });
  },
  timeout(ms, detail) {
    return new AppError({
      message: `La ejecución excedió el tiempo límite de ${ms} ms`,
      code: ErrorCode.TIMEOUT,
      kind: ErrorKind.RUNTIME,
      detail,
    });
  },
  cancelled(detail) {
    return new AppError({
      message: 'Ejecución cancelada por el usuario',
      code: ErrorCode.CANCELLED,
      kind: ErrorKind.RUNTIME,
      detail,
    });
  },
  syntax(message, detail) {
    return new AppError({
      message: message ?? 'Error de sintaxis',
      code: ErrorCode.SYNTAX,
      kind: ErrorKind.PARSE,
      detail,
    });
  },
  runtime(message, detail) {
    return new AppError({
      message: message ?? 'Error en tiempo de ejecución',
      code: ErrorCode.RUNTIME,
      kind: ErrorKind.RUNTIME,
      detail,
    });
  },
  pluginInvalid(id, message, detail) {
    return new AppError({
      message: `Plugin "${id}" inválido: ${message}`,
      code: ErrorCode.PLUGIN_INVALID,
      kind: ErrorKind.PLUGIN,
      detail: { pluginId: id, ...detail },
    });
  },
  pluginFailed(id, message, detail) {
    return new AppError({
      message: `Plugin "${id}": ${message}`,
      code: ErrorCode.PLUGIN_FAILED,
      kind: ErrorKind.PLUGIN,
      detail: { pluginId: id, ...detail },
    });
  },
});

/** Result of `JSON.parse` without throwing. */
export function safeJsonParse(text, label = 'JSON') {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return {
      ok: false,
      error: new AppError({
        message: `${label} inválido: ${err.message}`,
        code: ErrorCode.CORRUPT_DATA,
        kind: ErrorKind.STORAGE,
        detail: { snippet: String(text).slice(0, 120) },
        cause: err,
      }),
    };
  }
}
