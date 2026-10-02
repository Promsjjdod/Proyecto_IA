/**
 * Environment-neutral asynchronous helpers, shared by the Node server and the browser bundle.
 *
 * Only timer-based, dependency-free primitives live here (no DOM, no `requestAnimationFrame`);
 * anything that depends on a rendering frame stays in `renderer/utils/async.js`.
 */

/** Trailing-edge debounce with `cancel()`, `flush()` and `pending()`. */
export function debounce(fn, waitMs = 200, { leading = false } = {}) {
  let timer = null;
  let lastArgs = null;
  let lastCallAt = 0;

  const invoke = () => {
    timer = null;
    if (lastArgs === null) return;
    const args = lastArgs;
    lastArgs = null;
    lastCallAt = Date.now();
    fn(...args);
  };

  const debounced = (...args) => {
    lastArgs = args;
    if (leading && timer === null && Date.now() - lastCallAt > waitMs) {
      lastCallAt = Date.now();
      lastArgs = null;
      fn(...args);
      return;
    }
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(invoke, waitMs);
  };

  debounced.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };

  debounced.flush = () => {
    if (timer === null) return false;
    clearTimeout(timer);
    timer = null;
    const args = lastArgs;
    lastArgs = null;
    if (args) {
      fn(...args);
      return true;
    }
    return false;
  };

  debounced.pending = () => timer !== null;
  return debounced;
}

/** Leading-edge throttle (subsequent calls inside the window are delayed, not dropped). */
export function throttle(fn, waitMs = 100) {
  let lastCallAt = 0;
  let timer = null;
  let lastArgs = null;

  const throttled = (...args) => {
    const now = Date.now();
    const remaining = waitMs - (now - lastCallAt);
    if (remaining <= 0) {
      lastCallAt = now;
      fn(...args);
      return;
    }
    lastArgs = args;
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      lastCallAt = Date.now();
      const pending = lastArgs;
      lastArgs = null;
      if (pending) fn(...pending);
    }, remaining);
  };

  throttled.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };

  return throttled;
}

/** Awaits a delay; the returned promise exposes `cancel()`. Supports an AbortSignal. */
export function delay(ms, { signal = null } = {}) {
  let timer = null;
  const promise = new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Operación cancelada'));
      return;
    }
    timer = setTimeout(resolve, ms);
    signal?.addEventListener?.('abort', () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('Operación cancelada'));
    }, { once: true });
  });
  promise.cancel = () => clearTimeout(timer);
  return promise;
}

/** Creates a promise that can be resolved/rejected from the outside. */
export function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Rejects with `error` when `promise` does not settle within `ms`.
 * The original promise keeps running (the caller decides whether to abort it).
 */
export function withTimeout(promise, ms, error = null) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(error ?? new Error(`La operación excedió ${ms} ms`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Runs `worker(item)` over `items` with a real concurrency limit, preserving result order. */
export async function mapConcurrent(items, worker, { concurrency = 4, signal = null } = {}) {
  const results = new Array(items.length);
  let index = 0;
  const runners = new Array(Math.min(Math.max(1, concurrency), items.length)).fill(null).map(async () => {
    while (index < items.length) {
      if (signal?.aborted) break;
      const current = index;
      index += 1;
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Retries an async operation with exponential backoff (real attempts, real delays). */
export async function retry(operation, { attempts = 3, baseDelayMs = 200, maxDelayMs = 4000, onRetry = null, signal = null } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (signal?.aborted) throw new Error('Operación cancelada');
    try {
      return await operation(attempt);
    } catch (err) {
      lastError = err;
      if (attempt >= attempts) break;
      const waitMs = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      onRetry?.({ attempt, error: err, waitMs });
      await delay(waitMs, { signal });
    }
  }
  throw lastError;
}
