/**
 * ApiRouter — tiny explicit HTTP router for the JSON API.
 *
 * Handlers are plain functions that receive a real request context and return a value that is
 * serialised as JSON (or call `sendRaw` for file downloads). Errors are never swallowed: an
 * `AppError` is mapped to its HTTP status and returned with code, kind, label, message and
 * detail; anything else becomes a 500 whose message reaches the client while the full stack is
 * logged server-side.
 */

import { ErrorCode, ErrorKind, HttpStatus } from '../../shared/constants.js';
import { AppError, toAppError } from '../../shared/errors.js';

const CODE_STATUS = Object.freeze({
  [ErrorCode.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.DIR_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.ALREADY_EXISTS]: HttpStatus.CONFLICT,
  [ErrorCode.INVALID_ARGUMENT]: HttpStatus.BAD_REQUEST,
  [ErrorCode.VALIDATION_FAILED]: HttpStatus.UNPROCESSABLE,
  [ErrorCode.PERMISSION_DENIED]: HttpStatus.FORBIDDEN,
  [ErrorCode.UNSAFE_PATH]: HttpStatus.FORBIDDEN,
  [ErrorCode.CORRUPT_DATA]: HttpStatus.UNPROCESSABLE,
  [ErrorCode.DISK_FULL]: 507, // Insufficient Storage (not in the shared enum)
  [ErrorCode.TIMEOUT]: HttpStatus.GATEWAY_TIMEOUT,
  [ErrorCode.CANCELLED]: HttpStatus.CONFLICT,
  [ErrorCode.UNAVAILABLE]: HttpStatus.SERVICE_UNAVAILABLE,
  [ErrorCode.DEPENDENCY_MISSING]: HttpStatus.SERVICE_UNAVAILABLE,
  [ErrorCode.PLUGIN_INVALID]: HttpStatus.BAD_REQUEST,
  [ErrorCode.PLUGIN_DEPENDENCY]: HttpStatus.CONFLICT,
  [ErrorCode.PLUGIN_CYCLE]: HttpStatus.CONFLICT,
  [ErrorCode.PLUGIN_FAILED]: HttpStatus.BAD_GATEWAY,
  [ErrorCode.NETWORK_FAILED]: HttpStatus.BAD_GATEWAY,
  [ErrorCode.SYNTAX]: HttpStatus.BAD_REQUEST,
  [ErrorCode.RUNTIME]: HttpStatus.OK,
  [ErrorCode.NOT_IMPLEMENTED]: HttpStatus.NOT_IMPLEMENTED,
});

export function statusForError(error) {
  if (error instanceof AppError) return CODE_STATUS[error.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;
  return HttpStatus.INTERNAL_SERVER_ERROR;
}

const MAX_BODY_BYTES = 8 * 1024 * 1024;

export class ApiRouter {
  #routes = [];
  #prefix;
  #ctx;
  #bodyReader;
  #stats = { requests: 0, handled: 0, errors: 0, byStatus: {}, startedAt: Date.now() };
  #ordered = [];
  #orderDirty = true;

  constructor({ prefix = '/api', ctx = {}, logger = null, errorHandler = null, bodyReader = defaultBodyReader } = {}) {
    this.#prefix = prefix;
    this.#ctx = ctx;
    this.#bodyReader = bodyReader;
    this.logger = logger;
    this.errorHandler = errorHandler;
  }

  /** Every route with its description (used by `GET /api/routes` and the docs). */
  describe() {
    const groups = {};
    for (const route of this.#routes) {
      const section = route.path.split('/').filter(Boolean)[0] ?? 'root';
      groups[section] = groups[section] ?? [];
      groups[section].push({
        method: route.method,
        path: `${this.#prefix}${route.path}`,
        description: route.meta.description ?? null,
        body: route.meta.body === true,
        params: route.keys,
      });
    }
    return {
      prefix: this.#prefix,
      total: this.#routes.length,
      groups,
      routes: this.routes,
      stats: this.stats(),
    };
  }

  stats() {
    return {
      routes: this.#routes.length,
      methods: [...new Set(this.#routes.map((route) => route.method))],
      requests: this.#stats.requests,
      handled: this.#stats.handled,
      errors: this.#stats.errors,
      byStatus: { ...this.#stats.byStatus },
      uptimeMs: Date.now() - this.#stats.startedAt,
    };
  }

  get routes() {
    return this.#routes.map((route) => ({ method: route.method, path: `${this.#prefix}${route.path}`, description: route.meta.description ?? null }));
  }

  get(path, handler, meta = {}) {
    return this.#add('GET', path, handler, meta);
  }

  post(path, handler, meta = {}) {
    return this.#add('POST', path, handler, meta);
  }

  put(path, handler, meta = {}) {
    return this.#add('PUT', path, handler, meta);
  }

  patch(path, handler, meta = {}) {
    return this.#add('PATCH', path, handler, meta);
  }

  delete(path, handler, meta = {}) {
    return this.#add('DELETE', path, handler, meta);
  }

  /** Routes sorted by specificity (more literal segments first). */
  #orderedRoutes() {
    if (this.#orderDirty) {
      this.#ordered = [...this.#routes].sort((a, b) => specificity(b.path) - specificity(a.path));
      this.#orderDirty = false;
    }
    return this.#ordered;
  }

  #add(method, path, handler, meta) {
    const keys = [];
    const pattern = path
      .split('/')
      .filter((segment) => segment !== '')
      .map((segment) => {
        if (!segment.startsWith(':')) return escapeRegex(segment);
        keys.push(segment.slice(1));
        return '([^/]+)';
      })
      .join('/');
    this.#routes.push({
      method,
      path,
      meta,
      keys,
      handler,
      regex: new RegExp(`^/${pattern}/?$`),
    });
    this.#orderDirty = true;
    return this;
  }

  /** Finds the handler for a request without executing it (used by tests and the API index). */
  match(method, pathname) {
    // Literal routes first: `/scripts/categories` must win over `/scripts/:id`.
    for (const route of this.#orderedRoutes()) {
      if (route.method !== method) continue;
      const match = route.regex.exec(pathname);
      if (!match) continue;
      const params = {};
      route.keys.forEach((key, index) => {
        params[key] = safeDecode(match[index + 1]);
      });
      return { route, params };
    }
    return null;
  }

  /**
   * Handles a request. Returns `true` when the router owned it.
   */
  async handle(req, res, { url = null, clientId = null, context = null } = {}) {
    const resolvedUrl = url ?? new URL(req.url ?? '/', `http://${req.headers?.host ?? 'localhost'}`);
    const pathname = stripPrefix(resolvedUrl.pathname, this.#prefix);
    if (pathname === null) return false;
    this.#stats.requests += 1;

    const matched = this.match(req.method, pathname);
    if (!matched) {
      // Distinguish "no such route" from "wrong method on an existing route".
      const otherMethod = this.#routes.some((route) => route.regex.test(pathname));
      void otherMethod;
      this.#sendError(res, new AppError({
        message: otherMethod ? `Método ${req.method} no permitido en ${pathname}` : `Ruta no encontrada: ${req.method} ${pathname}`,
        code: otherMethod ? ErrorCode.NOT_IMPLEMENTED : ErrorCode.NOT_FOUND,
        kind: ErrorKind.NETWORK,
        detail: { method: req.method, path: pathname, available: otherMethod ? methodsFor(this.#routes, pathname) : null },
      }));
      return true;
    }

    const started = Date.now();
    const requestContext = {
      ...this.#ctx,
      app: context ?? this.#ctx.app ?? null,
      req,
      res,
      url: resolvedUrl,
      clientId,
      params: matched.params,
      query: Object.fromEntries(resolvedUrl.searchParams.entries()),
      method: req.method,
      path: pathname,
      route: matched.route,
      sendRaw: (content, options) => sendRaw(res, content, options),
      json: (value, status = HttpStatus.OK) => sendJson(res, value, status),
    };

    try {
      let body = null;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        body = await this.#bodyReader(req);
      }
      const result = await matched.route.handler({ ...requestContext, body });
      if (res.headersSent || res.writableEnded) return true;
      if (result === undefined) {
        this.#sendError(res, new AppError({
          message: 'El manejador no devolvió datos ni cerró la respuesta',
          code: ErrorCode.INTERNAL,
          kind: ErrorKind.INTERNAL,
          detail: { route: `${req.method} ${this.#prefix}${matched.route.path}` },
        }));
        return true;
      }
      this.#stats.handled += 1;
      this.#stats.byStatus[HttpStatus.OK] = (this.#stats.byStatus[HttpStatus.OK] ?? 0) + 1;
      sendJson(res, result, HttpStatus.OK, { 'X-Response-Time': `${Date.now() - started}ms` });
      return true;
    } catch (err) {
      const appError = toAppError(err, { kind: ErrorKind.INTERNAL });
      if (appError.code === ErrorCode.UNKNOWN) appError.detail.route = `${req.method} ${pathname}`;
      this.#stats.errors += 1;
      const reporter = this.errorHandler ?? this.#ctx.errorHandler ?? requestContext.errorHandler;
      reporter?.report?.(appError, { source: `api ${req.method} ${pathname}` });
      this.#sendError(res, appError);
      return true;
    }
  }

  #sendError(res, error) {
    const status = statusForError(error);
    this.#stats.byStatus[status] = (this.#stats.byStatus[status] ?? 0) + 1;
    const payload = error instanceof AppError ? error.toJSON() : toAppError(error).toJSON();
    // 500s keep the real message (the user asked to never hide errors) plus a stable code.
    sendJson(res, { error: payload }, status);
  }
}

/** Number of literal segments: higher means a more specific route. */
function specificity(path) {
  return path.split('/').filter((segment) => segment !== '' && !segment.startsWith(':')).length;
}

function methodsFor(routes, pathname) {
  return [...new Set(routes.filter((route) => route.regex.test(pathname)).map((route) => route.method))];
}

function stripPrefix(pathname, prefix) {
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  return rest === '' ? '/' : rest;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function defaultBodyReader(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new AppError({
        message: `El cuerpo de la petición supera el límite de ${Math.round(MAX_BODY_BYTES / 1024 / 1024)} MB`,
        code: ErrorCode.INVALID_ARGUMENT,
        kind: ErrorKind.NETWORK,
        detail: { limitBytes: MAX_BODY_BYTES },
      });
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return null;
  const raw = Buffer.concat(chunks).toString('utf8');
  const contentType = req.headers['content-type'] ?? '';
  if (contentType.includes('application/json') || raw.trimStart().startsWith('{') || raw.trimStart().startsWith('[')) {
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new AppError({
        message: `El cuerpo no es JSON válido: ${err.message}`,
        code: ErrorCode.INVALID_ARGUMENT,
        kind: ErrorKind.NETWORK,
        detail: { position: extractJsonPosition(err.message), received: raw.slice(0, 200) },
      });
    }
  }
  return raw;
}

function extractJsonPosition(message) {
  const match = /position (\d+)/.exec(message);
  return match ? Number(match[1]) : null;
}

export function sendJson(res, value, status = HttpStatus.OK, headers = {}) {
  const payload = JSON.stringify(value === undefined ? null : value, (key, item) => (typeof item === 'bigint' ? item.toString() : item));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

export function sendRaw(res, content, { contentType = 'application/octet-stream', filename = null, status = HttpStatus.OK, headers = {} } = {}) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    'Cache-Control': 'no-store',
    ...(filename ? { 'Content-Disposition': `attachment; filename="${filename.replace(/["\\]/g, '')}"` } : {}),
    ...headers,
  });
  res.end(buffer);
}
