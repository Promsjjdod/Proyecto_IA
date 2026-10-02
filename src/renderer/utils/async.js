/**
 * Renderer-side asynchronous utilities.
 *
 * Timer-based primitives (debounce, throttle, delay, retry, concurrency) live in
 * `src/shared/async.js` and are re-exported here for convenience; this module only adds the
 * frame-aware helpers the UI needs.
 */

export { debounce, throttle, delay, retry, mapConcurrent, createDeferred, withTimeout } from '../../shared/async.js';

/**
 * Coalescing scheduler: multiple `schedule()` calls within a frame run the callback once.
 * This is what keeps list/console updates from causing repeated full renders.
 */
export function createScheduler(callback, { mode = 'frame' } = {}) {
  let scheduled = false;
  let disposed = false;

  const run = () => {
    if (disposed) return;
    scheduled = false;
    callback();
  };

  const schedule = () => {
    if (scheduled || disposed) return;
    scheduled = true;
    if (mode === 'microtask') queueMicrotask(run);
    else if (mode === 'timeout') setTimeout(run, 0);
    else requestAnimationFrame(run);
  };

  schedule.dispose = () => {
    disposed = true;
    scheduled = false;
  };

  return schedule;
}

/** Batching group: collects keys and flushes them on the next frame. */
export function createBatcher(callback) {
  const pending = new Set();
  const flush = createScheduler(() => {
    if (pending.size === 0) return;
    const keys = [...pending];
    pending.clear();
    callback(keys);
  });
  return {
    add(key) {
      pending.add(key);
      flush();
    },
    has(key) {
      return pending.has(key);
    },
    flushNow() {
      flush();
    },
  };
}
