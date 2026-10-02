/**
 * Renderer-side asynchronous utilities.
 *
 * Timer-based primitives (debounce, throttle, delay, retry, concurrency) live in
 * `src/shared/async.js` and are re-exported here for convenience; this module only adds the
 * frame-aware helpers the UI needs.
 */

export { debounce, throttle, delay, retry, mapConcurrent, createDeferred, withTimeout } from '../../shared/async.js';

/**
 * Programa un callback en el siguiente cuadro de animación si el entorno lo ofrece y, si no,
 * en un temporizador real. La comprobación se hace en cada llamada y no una vez al cargar el
 * módulo: un contexto que pierde `requestAnimationFrame` (ventana que se cierra, worker,
 * entorno de pruebas) dejaría de lo contrario planificaciones que revientan al ejecutarse.
 */
function scheduleFrame(callback) {
  if (typeof requestAnimationFrame === 'function') return { frame: requestAnimationFrame(callback) };
  return { timer: setTimeout(callback, 0) };
}

function cancelScheduled(target) {
  if (!target) return;
  if (target.frame !== undefined) {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(target.frame);
    return;
  }
  if (target.timer !== undefined) clearTimeout(target.timer);
}

/**
 * Coalescing scheduler: multiple `schedule()` calls within a frame run the callback once.
 * This is what keeps list/console updates from causing repeated full renders.
 */
export function createScheduler(callback, options = {}) {
  // Admite `createScheduler(fn, 800)` y `createScheduler(fn, { delayMs: 800, mode })`.
  const config = typeof options === 'number' ? { delayMs: options } : options;
  const { mode = 'frame', delayMs = 0 } = config;
  let scheduled = false;
  let disposed = false;
  let timer = null;
  let frame = null;

  const run = () => {
    timer = null;
    frame = null;
    if (disposed) return;
    scheduled = false;
    callback();
  };

  const schedule = () => {
    if (scheduled || disposed) return;
    scheduled = true;
    if (delayMs > 0) timer = setTimeout(run, delayMs);
    else if (mode === 'microtask') queueMicrotask(run);
    else if (mode === 'timeout') timer = setTimeout(run, 0);
    else {
      const handle = scheduleFrame(run);
      frame = handle.frame ?? null;
      timer = handle.timer ?? null;
    }
  };

  /** Cancela la ejecución pendiente sin desactivar el planificador. */
  schedule.cancel = () => {
    cancelScheduled(frame !== null ? { frame } : null);
    if (timer) clearTimeout(timer);
    frame = null;
    timer = null;
    scheduled = false;
  };

  /** Alias: algunos servicios guardan el planificador y lo invocan como `scheduler.schedule()`. */
  schedule.schedule = schedule;

  schedule.dispose = () => {
    schedule.cancel();
    disposed = true;
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
