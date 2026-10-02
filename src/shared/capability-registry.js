/**
 * CapabilityRegistry — real capability detection, shared by the server and the browser.
 *
 * A capability is never inferred from a feature-detect alone: each probe must *validate
 * behaviour* (execute something and inspect the result). Probes are async, cached with a
 * TTL and re-runnable on demand. Every entry records the scope it was checked in, the
 * concrete dependency that is missing when unavailable and the measured probe duration.
 */

import { CapabilityState, CapabilityScope } from './constants.js';

/**
 * @typedef {object} CapabilityProbe
 * @property {string} id
 * @property {string} label
 * @property {string} scope
 * @property {string} description
 * @property {string} [dependency]  What has to exist for this to work.
 * @property {() => Promise<{ state: string, detail?: string, data?: object }>} check
 * @property {number} [ttlMs]
 */

/**
 * @typedef {object} CapabilityEntry
 * @property {string} id
 * @property {string} label
 * @property {string} scope
 * @property {string} description
 * @property {string|null} dependency
 * @property {string} state
 * @property {boolean} available
 * @property {string|null} detail
 * @property {object|null} data
 * @property {number|null} checkedAt
 * @property {number|null} probeMs
 * @property {string|null} error
 */

export class CapabilityRegistry {
  #probes = new Map();
  #entries = new Map();
  #listeners = new Set();

  /**
   * @param {{ scope?: string, onChange?: (entry: CapabilityEntry) => void }} [options]
   */
  constructor({ scope = CapabilityScope.SERVER, onChange = null } = {}) {
    this.scope = scope;
    if (onChange) this.#listeners.add(onChange);
  }

  /** Registers a probe (replacing a previous probe with the same id). */
  register(probe) {
    if (!probe || typeof probe.id !== 'string' || typeof probe.check !== 'function') {
      throw new TypeError('Un probe de capacidad necesita id y check()');
    }
    this.#probes.set(probe.id, {
      scope: this.scope,
      ttlMs: 30_000,
      dependency: null,
      detail: null,
      ...probe,
    });
    return this;
  }

  registerMany(probes) {
    for (const probe of probes) this.register(probe);
    return this;
  }

  onChange(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Static entries for capabilities that are known to be unavailable (with a reason). */
  registerUnavailable({ id, label, description, dependency, detail, data = null }) {
    this.#entries.set(id, {
      id,
      label,
      scope: this.scope,
      description,
      dependency: dependency ?? null,
      state: CapabilityState.UNAVAILABLE,
      available: false,
      detail: detail ?? `Dependencia ausente: ${dependency ?? 'desconocida'}`,
      data,
      checkedAt: Date.now(),
      probeMs: 0,
      error: null,
    });
    return this;
  }

  /**
   * Runs the probes (all, or only the given ids) honouring the TTL cache.
   * @param {{ ids?: string[], force?: boolean, timeoutMs?: number }} [options]
   */
  async detect({ ids = null, force = false, timeoutMs = 15_000 } = {}) {
    const now = Date.now();
    const targets = [...this.#probes.values()].filter((probe) => (ids ? ids.includes(probe.id) : true));
    const results = [];

    for (const probe of targets) {
      const cached = this.#entries.get(probe.id);
      if (!force && cached && cached.checkedAt !== null && now - cached.checkedAt < (probe.ttlMs ?? 30_000)) {
        results.push(cached);
        continue;
      }
      const started = Date.now();
      let entry;
      try {
        const outcome = await withTimeout(probe.check(), timeoutMs, `La comprobación de "${probe.id}" excedió ${timeoutMs} ms`);
        const state = Object.values(CapabilityState).includes(outcome?.state) ? outcome.state : CapabilityState.UNKNOWN;
        entry = {
          id: probe.id,
          label: probe.label,
          scope: probe.scope ?? this.scope,
          description: probe.description,
          dependency: probe.dependency ?? null,
          state,
          available: state === CapabilityState.AVAILABLE || state === CapabilityState.FALLBACK,
          detail: outcome?.detail ?? null,
          data: outcome?.data ?? null,
          checkedAt: Date.now(),
          probeMs: Date.now() - started,
          error: null,
        };
      } catch (err) {
        entry = {
          id: probe.id,
          label: probe.label,
          scope: probe.scope ?? this.scope,
          description: probe.description,
          dependency: probe.dependency ?? null,
          state: CapabilityState.UNAVAILABLE,
          available: false,
          detail: probe.detail ?? `La comprobación falló: ${err?.message ?? err}`,
          data: null,
          checkedAt: Date.now(),
          probeMs: Date.now() - started,
          error: err?.message ?? String(err),
        };
      }
      const previous = this.#entries.get(probe.id);
      this.#entries.set(probe.id, entry);
      if (!previous || previous.state !== entry.state || previous.detail !== entry.detail) {
        for (const listener of [...this.#listeners]) {
          try {
            listener(entry, previous ?? null);
          } catch {
            /* a broken listener must never break detection */
          }
        }
      }
      results.push(entry);
    }
    return results;
  }

  get(id) {
    return this.#entries.get(id) ?? null;
  }

  /** Every known entry, sorted by scope then id. */
  snapshot() {
    return [...this.#entries.values()].sort((a, b) => a.scope.localeCompare(b.scope) || a.id.localeCompare(b.id));
  }

  /** `{ [capabilityId]: { available, state, detail } }` — used to gate settings and commands. */
  availabilityMap() {
    const map = {};
    for (const entry of this.#entries.values()) {
      map[entry.id] = { available: entry.available, state: entry.state, detail: entry.detail, scope: entry.scope };
    }
    return map;
  }

  isAvailable(id) {
    return this.#entries.get(id)?.available === true;
  }

  /** Aggregated counters for the dashboard (real numbers only). */
  summary() {
    const entries = this.snapshot();
    return {
      total: entries.length,
      available: entries.filter((entry) => entry.state === CapabilityState.AVAILABLE).length,
      fallback: entries.filter((entry) => entry.state === CapabilityState.FALLBACK).length,
      unavailable: entries.filter((entry) => entry.state === CapabilityState.UNAVAILABLE).length,
      unknown: entries.filter((entry) => entry.state === CapabilityState.UNKNOWN).length,
      byScope: entries.reduce((acc, entry) => {
        acc[entry.scope] = acc[entry.scope] ?? { total: 0, available: 0, unavailable: 0 };
        acc[entry.scope].total += 1;
        if (entry.available) acc[entry.scope].available += 1;
        else acc[entry.scope].unavailable += 1;
        return acc;
      }, {}),
      lastCheckAt: entries.reduce((latest, entry) => Math.max(latest, entry.checkedAt ?? 0), 0) || null,
    };
  }

  /** Imports entries reported by another scope (e.g. the browser sending its own report). */
  mergeExternal(entries, { scope = CapabilityScope.BROWSER } = {}) {
    const merged = [];
    for (const entry of entries) {
      if (!entry || typeof entry.id !== 'string') continue;
      const normalized = {
        id: entry.id,
        label: entry.label ?? entry.id,
        scope: entry.scope ?? scope,
        description: entry.description ?? '',
        dependency: entry.dependency ?? null,
        state: Object.values(CapabilityState).includes(entry.state) ? entry.state : CapabilityState.UNKNOWN,
        available: entry.available === true,
        detail: entry.detail ?? null,
        data: entry.data ?? null,
        checkedAt: entry.checkedAt ?? Date.now(),
        probeMs: entry.probeMs ?? null,
        error: entry.error ?? null,
        reportedBy: 'client',
      };
      this.#entries.set(entry.id, normalized);
      merged.push(normalized);
    }
    return merged;
  }
}

/** Runs a promise with a timeout, rejecting with a descriptive Error. */
export function withTimeout(promise, timeoutMs, message) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message ?? `Operación excedida tras ${timeoutMs} ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Helper used by probes to build a consistent result. */
export const capabilityResult = Object.freeze({
  available(detail, data = null) {
    return { state: CapabilityState.AVAILABLE, detail, data };
  },
  fallback(detail, data = null) {
    return { state: CapabilityState.FALLBACK, detail, data };
  },
  unavailable(detail, data = null) {
    return { state: CapabilityState.UNAVAILABLE, detail, data };
  },
  unknown(detail, data = null) {
    return { state: CapabilityState.UNKNOWN, detail, data };
  },
});
