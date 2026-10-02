/**
 * ApiClient — real HTTP access to the local backend.
 *
 * Design points:
 *  - every failure becomes a structured `AppClientError` carrying the server's error code,
 *    kind, message and detail (no generic "something went wrong");
 *  - requests have a real timeout implemented with `AbortController`;
 *  - a network failure is distinguished from an HTTP error, so the UI can say
 *    "el servidor local no responde" instead of pretending the operation succeeded;
 *  - request statistics are measured (count, failures, latency) for the dashboard.
 */

export class AppClientError extends Error {
  constructor({ message, code = 'E_UNKNOWN', kind = 'NETWORK', detail = {}, status = null, retriable = false }) {
    super(message);
    this.name = 'AppClientError';
    this.code = code;
    this.kind = kind;
    this.detail = detail;
    this.status = status;
    this.retriable = retriable;
    this.timestamp = Date.now();
  }

  toJSON() {
    return { code: this.code, kind: this.kind, message: this.message, detail: this.detail, status: this.status };
  }
}

export class ApiClient {
  #stats = { requests: 0, failures: 0, totalMs: 0, slowest: null, byStatus: {} };

  /**
   * @param {{ baseUrl?: string, clientId: string, timeoutMs?: number, onChange?: Function }} options
   */
  constructor({ baseUrl = '', clientId, timeoutMs = 30_000, onChange = null }) {
    this.baseUrl = baseUrl;
    this.clientId = clientId;
    this.timeoutMs = timeoutMs;
    this.onChange = onChange;
    this.status = 'unknown';
    this.lastError = null;
    this.lastLatencyMs = null;
  }

  get stats() {
    return { ...this.#stats, byStatus: { ...this.#stats.byStatus } };
  }

  /** GET returning parsed JSON. */
  get(path, { timeoutMs, signal, query } = {}) {
    return this.#request('GET', path, { timeoutMs, signal, query });
  }

  post(path, body, options = {}) {
    return this.#request('POST', path, { ...options, body });
  }

  put(path, body, options = {}) {
    return this.#request('PUT', path, { ...options, body });
  }

  patch(path, body, options = {}) {
    return this.#request('PATCH', path, { ...options, body });
  }

  delete(path, options = {}) {
    return this.#request('DELETE', path, options);
  }

  /** Downloads a real file (script export, logs, settings). */
  async download(path, { filename = null, signal = null } = {}) {
    const response = await this.#fetch(path, { method: 'GET', signal, timeoutMs: 60_000 });
    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') ?? '';
    const match = /filename="?([^";]+)"?/.exec(disposition);
    const suggested = filename ?? (match ? match[1] : 'descarga.txt');
    return { blob, filename: suggested, bytes: blob.size, type: blob.type };
  }

  /** Uploads text content to an endpoint (used by import). */
  upload(path, content, { contentType = 'text/plain', filename = 'subida.txt', signal = null } = {}) {
    return this.#request('POST', path, {
      body: { content, filename },
      signal,
      headers: { 'content-type': 'application/json' },
      contentType,
    });
  }

  /** True when the backend answered a real health request within the timeout. */
  async probe({ timeoutMs = 4000 } = {}) {
    try {
      const result = await this.get('/api/health', { timeoutMs });
      this.status = 'online';
      return { online: true, health: result };
    } catch (err) {
      this.status = 'offline';
      this.lastError = err;
      return { online: false, error: err };
    }
  }

  async #request(method, path, { body = undefined, timeoutMs = this.timeoutMs, signal = null, query = null, headers = {} } = {}) {
    const url = query ? `${path}?${new URLSearchParams(query)}` : path;
    const startedAt = Date.now();
    this.#stats.requests += 1;

    let response;
    try {
      response = await this.#fetch(url, { method, body, timeoutMs, signal, headers });
    } catch (err) {
      this.#stats.failures += 1;
      this.status = 'offline';
      this.lastError = err;
      this.onChange?.(this.status, err);
      throw err;
    }

    const latency = Date.now() - startedAt;
    this.lastLatencyMs = latency;
    this.#stats.totalMs += latency;
    this.#stats.byStatus[response.status] = (this.#stats.byStatus[response.status] ?? 0) + 1;
    if (!this.#stats.slowest || latency > this.#stats.slowest.latencyMs) {
      this.#stats.slowest = { method, path, latencyMs: latency, at: Date.now() };
    }

    if (response.status === 204) {
      this.status = 'online';
      this.onChange?.(this.status, null);
      return { ok: true };
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      const text = await response.text();
      if (!response.ok) {
        this.#stats.failures += 1;
        throw new AppClientError({
          message: `El servidor respondió ${response.status} con contenido no JSON`,
          code: 'E_UNEXPECTED_RESPONSE',
          kind: 'NETWORK',
          status: response.status,
          detail: { snippet: text.slice(0, 200) },
          retriable: response.status >= 500,
        });
      }
      this.status = 'online';
      return { ok: true, text };
    }

    let payload;
    try {
      payload = await response.json();
    } catch (err) {
      this.#stats.failures += 1;
      throw new AppClientError({
        message: 'La respuesta del servidor no es JSON válido',
        code: 'E_INVALID_JSON',
        kind: 'NETWORK',
        status: response.status,
        detail: { cause: err.message },
      });
    }

    if (!response.ok || payload?.ok === false) {
      this.#stats.failures += 1;
      const serverError = payload?.error ?? {};
      const error = new AppClientError({
        message: serverError.message ?? `La petición ${method} ${path} falló con estado ${response.status}`,
        code: serverError.code ?? 'E_HTTP',
        kind: serverError.kind ?? 'NETWORK',
        detail: serverError.detail ?? {},
        status: response.status,
        retriable: response.status >= 500 || serverError.code === 'E_UNAVAILABLE',
      });
      this.lastError = error;
      this.status = 'online';
      this.onChange?.(this.status, error);
      throw error;
    }

    this.status = 'online';
    this.lastError = null;
    this.onChange?.(this.status, null);
    return payload;
  }

  async #fetch(path, { method, body, timeoutMs, signal, headers = {} }) {
    const controller = new AbortController();
    const timer = timeoutMs > 0
      ? setTimeout(() => controller.abort(new DOMException(`La petición excedió ${timeoutMs} ms`, 'TimeoutError')), timeoutMs)
      : null;
    const abortListener = () => controller.abort(signal?.reason);
    signal?.addEventListener?.('abort', abortListener, { once: true });

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          'x-lumen-client': this.clientId,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        credentials: 'same-origin',
      });
      return response;
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        const timedOut = String(err.message ?? '').includes('excedió');
        throw new AppClientError({
          message: timedOut
            ? `El servidor no respondió en ${timeoutMs} ms`
            : 'La petición fue cancelada',
          code: timedOut ? 'E_TIMEOUT' : 'E_CANCELLED',
          kind: 'NETWORK',
          detail: { path, method, timeoutMs },
          retriable: timedOut,
        });
      }
      throw new AppClientError({
        message: 'No se pudo contactar con el servidor local (¿está detenido?)',
        code: 'E_NETWORK_FAILED',
        kind: 'NETWORK',
        detail: { path, method, cause: err?.message ?? String(err) },
        retriable: true,
      });
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener?.('abort', abortListener);
    }
  }
}
