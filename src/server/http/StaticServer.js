/**
 * StaticServer — serves the built interface, the vendored WASM runtimes and the SPA shell.
 *
 * Correctness details that matter in production:
 *  - real MIME types (`.wasm` must be `application/wasm` for streaming compilation);
 *  - `ETag`/`Last-Modified` with `304 Not Modified` responses;
 *  - HTTP range requests (used by WebAssembly streaming compilation);
 *  - no `X-Frame-Options`/`frame-ancestors`: the app is designed to run inside the preview iframe;
 *  - path traversal protection: only files inside the served roots can ever be returned.
 */

import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HttpStatus } from '../../shared/constants.js';

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.luau': 'text/plain; charset=utf-8',
  '.lua': 'text/plain; charset=utf-8',
});

export class StaticServer {
  #etagCache = new Map();
  #stats = { requests: 0, bytes: 0, notModified: 0, notFound: 0, ranges: 0 };

  /**
   * @param {{ roots: { prefix: string, dir: string }[], indexFile: string, logger, errorHandler }} options
   */
  constructor({ roots, indexFile, logger, errorHandler }) {
    this.roots = roots;
    this.indexFile = indexFile;
    this.logger = logger;
    this.errorHandler = errorHandler;
  }

  get statsSnapshot() {
    return { ...this.#stats };
  }

  /**
   * Attempts to serve a request. Returns `true` when a response was produced.
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {string} pathname
   */
  async serve(req, res, pathname) {
    const method = (req.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return false;

    const relative = normalizePathname(pathname);
    const resolved = this.#resolve(relative);
    if (resolved) {
      const served = await this.#sendFile(req, res, resolved.file, { head: method === 'HEAD' });
      if (served) return true;
    }

    // SPA fallback: unknown paths without a file extension render the app shell.
    if (!path.extname(relative)) {
      const served = await this.#sendFile(req, res, this.indexFile, { head: method === 'HEAD', fallback: true });
      if (served) return true;
    }

    this.#stats.notFound += 1;
    return false;
  }

  /** Maps a URL path onto one of the configured roots, rejecting traversal attempts. */
  #resolve(pathname) {
    for (const root of this.roots) {
      if (root.prefix !== '' && !pathname.startsWith(root.prefix)) continue;
      const suffix = root.prefix === '' ? pathname : pathname.slice(root.prefix.length);
      if (suffix.includes('..')) continue;
      const candidate = path.resolve(root.dir, `.${suffix.startsWith('/') ? suffix : `/${suffix}`}`);
      const relativeToRoot = path.relative(root.dir, candidate);
      if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) continue;
      return { file: candidate, root };
    }
    return null;
  }

  async #sendFile(req, res, file, { head = false, fallback = false } = {}) {
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat?.isFile()) return false;

    const extension = path.extname(file).toLowerCase();
    const contentType = MIME[extension] ?? 'application/octet-stream';
    const etag = this.#etagFor(file, stat);
    const lastModified = new Date(stat.mtimeMs).toUTCString();

    const headers = {
      'content-type': contentType,
      etag,
      'last-modified': lastModified,
      'cache-control': fallback || extension === '.html' ? 'no-store' : 'public, max-age=60, must-revalidate',
      'x-content-type-options': 'nosniff',
      // The interface is meant to be embedded in the preview iframe, so no frame restrictions.
      'referrer-policy': 'same-origin',
    };

    if (req.headers['if-none-match'] === etag || req.headers['if-modified-since'] === lastModified) {
      this.#stats.notModified += 1;
      res.writeHead(HttpStatus.NOT_MODIFIED, headers);
      res.end();
      return true;
    }

    const range = parseRange(req.headers.range, stat.size);
    if (range) {
      this.#stats.ranges += 1;
      headers['accept-ranges'] = 'bytes';
      headers['content-length'] = String(range.end - range.start + 1);
      headers['content-range'] = `bytes ${range.start}-${range.end}/${stat.size}`;
      res.writeHead(HttpStatus.OK === 200 && range.partial ? 206 : 200, headers);
      if (head) {
        res.end();
        return true;
      }
      const stream = fs.createReadStream(file, { start: range.start, end: range.end });
      stream.on('error', () => res.end());
      stream.pipe(res);
      this.#stats.requests += 1;
      this.#stats.bytes += range.end - range.start + 1;
      return true;
    }

    headers['content-length'] = String(stat.size);
    headers['accept-ranges'] = 'bytes';
    res.writeHead(HttpStatus.OK, headers);
    if (head) {
      res.end();
      return true;
    }
    const stream = fs.createReadStream(file);
    stream.on('error', (err) => {
      this.logger.warn(`Error enviando ${path.basename(file)}: ${err.message}`, { source: 'StaticServer' });
      res.end();
    });
    stream.pipe(res);
    this.#stats.requests += 1;
    this.#stats.bytes += stat.size;
    return true;
  }

  #etagFor(file, stat) {
    const cached = this.#etagCache.get(file);
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.etag;
    const etag = `W/"${crypto.createHash('sha1').update(`${file}:${stat.size}:${stat.mtimeMs}`).digest('hex').slice(0, 20)}"`;
    this.#etagCache.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, etag });
    if (this.#etagCache.size > 500) {
      const oldest = this.#etagCache.keys().next().value;
      this.#etagCache.delete(oldest);
    }
    return etag;
  }
}

function normalizePathname(pathname) {
  const decoded = decodeURIComponent(pathname.split('?')[0]);
  if (decoded.includes('\0')) return '/';
  return decoded;
}

/** Parses a single-range `Range` header. Returns null when unsupported. */
function parseRange(header, size) {
  if (!header || typeof header !== 'string' || !header.startsWith('bytes=')) return null;
  const spec = header.slice(6).split(',')[0].trim();
  const [rawStart, rawEnd] = spec.split('-');
  if (rawStart === '' && rawEnd === '') return null;
  let start;
  let end;
  if (rawStart === '') {
    const suffix = Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number.parseInt(rawStart, 10);
    end = rawEnd === '' ? size - 1 : Number.parseInt(rawEnd, 10);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1), partial: true };
}
