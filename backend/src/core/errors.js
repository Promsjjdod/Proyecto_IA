import { createLogger, redact } from './logger.js';
import { randomId } from './crypto.js';

const log = createLogger('http');

export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new AppError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = 'Authentication required.') => new AppError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'You are not allowed to do that.') => new AppError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'Resource not found.') => new AppError(404, 'NOT_FOUND', msg);
export const conflict = (msg) => new AppError(409, 'CONFLICT', msg);
export const tooMany = (msg = 'Too many requests.') => new AppError(429, 'RATE_LIMITED', msg);
export const providerOffline = (msg = 'Unable to connect to provider.') => new AppError(502, 'PROVIDER_OFFLINE', msg);

/** Express error middleware: never leaks stack traces to clients. */
export function errorHandler(err, req, res, _next) {
  const errorId = randomId('err');
  const status = err instanceof AppError ? err.status : err.status || 500;
  const code = err instanceof AppError ? err.code : 'INTERNAL_ERROR';
  const message = err instanceof AppError
    ? err.message
    : status >= 500
      ? 'Something went wrong on our side. Check System Status for details.'
      : err.message || 'Request failed.';

  log.error(`request failed ${req.method} ${req.originalUrl}`, {
    errorId,
    status,
    code,
    error: redact(err.message),
    stack: status >= 500 ? String(err.stack).split('\n').slice(0, 6) : undefined,
  });

  if (res.headersSent) {
    res.end();
    return;
  }
  res.status(status).json({
    error: { code, message, errorId, ...(err.details ? { details: err.details } : {}) },
  });
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
}

/** Wrap an async route handler (Express 5 does this natively, kept for clarity). */
export const ah = (fn) => fn;
