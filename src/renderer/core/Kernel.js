/**
 * Kernel — service container and application lifecycle.
 *
 * Services register with an explicit name and an optional `init()`/`dispose()` pair.
 * `boot()` runs them in registration order, reporting real progress (the boot screen shows
 * exactly which step is running and which one failed, with the error message).
 */

export class Kernel {
  #services = new Map();
  #order = [];
  #booted = false;
  #booting = null;
  #progressListeners = new Set();

  constructor({ label = 'Kernel' } = {}) {
    this.label = label;
    this.bootReport = [];
  }

  /**
   * Registers a service.
   * @param {string} name
   * @param {object} instance
   * @param {{ label?: string, critical?: boolean }} [options]
   */
  register(name, instance, options = {}) {
    if (this.#services.has(name)) {
      throw new Error(`El servicio "${name}" ya está registrado en el kernel`);
    }
    this.#services.set(name, {
      name,
      instance,
      label: options.label ?? name,
      critical: options.critical === true,
      initialized: false,
    });
    this.#order.push(name);
    return instance;
  }

  has(name) {
    return this.#services.has(name);
  }

  get(name) {
    const entry = this.#services.get(name);
    if (!entry) {
      throw new Error(`El servicio "${name}" no está registrado`);
    }
    return entry.instance;
  }

  /** Returns the service or `null` (used by optional integrations). */
  tryGet(name) {
    return this.#services.get(name)?.instance ?? null;
  }

  /** Runs every registered service's `init()` in order. */
  async boot({ onProgress = null } = {}) {
    if (this.#booted) return { ok: true, report: this.bootReport };
    if (this.#booting) return this.#booting;

    this.#booting = (async () => {
      const report = [];
      for (const name of this.#order) {
        const entry = this.#services.get(name);
        const startedAt = performance.now();
        this.#emitProgress({ phase: 'start', name, label: entry.label });
        if (typeof entry.instance?.init === 'function') {
          try {
            const result = await entry.instance.init();
            entry.initialized = true;
            const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
            const step = { name, label: entry.label, ok: true, durationMs, result: summarize(result) };
            report.push(step);
            onProgress?.(step);
            this.#emitProgress({ phase: 'done', ...step });
          } catch (err) {
            const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
            const step = {
              name,
              label: entry.label,
              ok: false,
              durationMs,
              critical: entry.critical,
              error: { message: err?.message ?? String(err), code: err?.code ?? null, kind: err?.kind ?? null, detail: err?.detail ?? null },
            };
            report.push(step);
            onProgress?.(step);
            this.#emitProgress({ phase: 'failed', ...step });
            if (entry.critical) {
              this.bootReport = report;
              throw Object.assign(new Error(`Servicio crítico "${entry.label}" no pudo inicializarse: ${step.error.message}`), {
                code: step.error.code ?? 'E_BOOT',
                detail: { step },
              });
            }
          }
        } else {
          entry.initialized = true;
          const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
          const step = { name, label: entry.label, ok: true, durationMs, skipped: 'sin init()' };
          report.push(step);
          onProgress?.(step);
          this.#emitProgress({ phase: 'done', ...step });
        }
      }
      this.bootReport = report;
      this.#booted = true;
      return { ok: report.every((step) => step.ok || !step.critical), report };
    })();

    try {
      return await this.#booting;
    } finally {
      this.#booting = null;
    }
  }

  /** Disposes services in reverse order (real cleanup, errors are collected). */
  async shutdown() {
    const results = [];
    for (const name of [...this.#order].reverse()) {
      const entry = this.#services.get(name);
      if (typeof entry.instance?.dispose !== 'function') continue;
      try {
        await entry.instance.dispose();
        results.push({ name, ok: true });
      } catch (err) {
        results.push({ name, ok: false, message: err?.message ?? String(err) });
      }
    }
    this.#booted = false;
    return results;
  }

  onProgress(listener) {
    this.#progressListeners.add(listener);
    return () => this.#progressListeners.delete(listener);
  }

  #emitProgress(payload) {
    for (const listener of this.#progressListeners) {
      try {
        listener(payload);
      } catch {
        /* a broken progress listener must not break boot */
      }
    }
  }

  /** Description of every registered service (About/Diagnostics view). */
  describe() {
    return this.#order.map((name) => {
      const entry = this.#services.get(name);
      return {
        name,
        label: entry.label,
        critical: entry.critical,
        initialized: entry.initialized,
        hasInit: typeof entry.instance?.init === 'function',
        hasDispose: typeof entry.instance?.dispose === 'function',
      };
    });
  }
}

function summarize(result) {
  if (result === null || result === undefined) return null;
  if (typeof result !== 'object') return result;
  const keys = ['ok', 'count', 'total', 'theme', 'plugins', 'connected', 'state'];
  const output = {};
  for (const key of keys) if (key in result) output[key] = result[key];
  return Object.keys(output).length > 0 ? output : null;
}
