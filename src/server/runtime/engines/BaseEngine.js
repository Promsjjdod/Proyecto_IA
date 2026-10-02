/**
 * BaseEngine — contract every execution engine must fulfil.
 *
 * An engine is a *real* adapter around one concrete way of running Lua/Luau.
 * Nothing here fakes availability: `probe()` must execute code and validate the result,
 * and `limits` must describe only what the underlying implementation truly enforces.
 */

import { CapabilityState, EngineId, EngineInfo, RuntimeState } from '../../../shared/constants.js';
import { errors } from '../../../shared/errors.js';
import { normalizeExecutionResult } from '../../../shared/protocol.js';

export class BaseEngine {
  /**
   * @param {{ logger: import('../../core/Logger.js').Logger, errorHandler: import('../../core/ErrorHandler.js').ErrorHandler, toolsDir?: string|null, dataDir?: string|null }} options
   */
  constructor({ logger, errorHandler, toolsDir = null, dataDir = null }) {
    this.logger = logger;
    this.errorHandler = errorHandler;
    this.toolsDir = toolsDir;
    this.dataDir = dataDir;
    /** @type {Map<string, () => Promise<void>|void>} */
    this.activeExecutions = new Map();
    this.probeCache = null;
  }

  get id() {
    throw new Error('Engine.id no implementado');
  }

  get info() {
    return EngineInfo[this.id] ?? null;
  }

  get dialect() {
    return this.info?.dialect ?? null;
  }

  get label() {
    return this.info?.label ?? this.id;
  }

  get scope() {
    return this.info?.scope ?? 'server';
  }

  /**
   * What this engine can really enforce. Values are literal booleans, never optimistic.
   * @returns {{ cancel: boolean, cancelMode: 'abort'|'kill'|null, timeout: boolean, memoryLimit: boolean, streaming: boolean, isolation: string, returnValues: boolean, requires: string[] }}
   */
  get limits() {
    return {
      cancel: false,
      cancelMode: null,
      timeout: false,
      memoryLimit: false,
      streaming: false,
      isolation: 'in-process',
      returnValues: false,
      requires: [],
    };
  }

  /** Availability report with a real behaviour check. */
  // eslint-disable-next-line no-unused-vars
  async probe({ force = false } = {}) {
    return {
      state: CapabilityState.UNAVAILABLE,
      detail: `${this.id} no implementa probe()`,
      data: null,
    };
  }

  /** Cached probe result. */
  async probeCached({ ttlMs = 30_000, force = false } = {}) {
    if (!force && this.probeCache && Date.now() - this.probeCache.checkedAt < ttlMs) {
      return this.probeCache.value;
    }
    const value = await this.probe();
    this.probeCache = { value, checkedAt: Date.now() };
    return value;
  }

  /**
   * Executes code. Must return a normalised `ExecutionResult`.
   * @param {{ executionId: string, source: string, name?: string, options: object, hooks: { onOutput?: Function }, signal?: AbortSignal }} context
   */
  // eslint-disable-next-line no-unused-vars
  async execute(context) {
    throw errors.unavailable(`El motor ${this.id}`, 'implementación de execute()');
  }

  /** Attempts to stop a running execution. Returns whether a stop was actually issued. */
  async cancel(executionId) {
    const cancel = this.activeExecutions.get(executionId);
    if (!cancel) return { stopped: false, reason: 'La ejecución no está activa en este motor' };
    await cancel();
    return { stopped: true, reason: null };
  }

  async cancelAll() {
    const ids = [...this.activeExecutions.keys()];
    const results = [];
    for (const id of ids) results.push({ executionId: id, ...(await this.cancel(id)) });
    return results;
  }

  get activeCount() {
    return this.activeExecutions.size;
  }

  /** Real-time status for the dashboard. */
  status() {
    return {
      id: this.id,
      label: this.label,
      scope: this.scope,
      dialect: this.dialect,
      active: this.activeCount,
      limits: this.limits,
      requirements: this.info?.requires ?? [],
      isolation: this.info?.isolation ?? null,
    };
  }

  /** Helper: builds the canonical result object. */
  buildResult({ executionId, ok, state, outputs = [], returnValues = [], error = null, stats = {}, startedAt = null }) {
    return normalizeExecutionResult({
      executionId,
      engineId: this.id,
      dialect: this.dialect,
      ok,
      state: state ?? (ok ? RuntimeState.SUCCESS : RuntimeState.ERROR),
      outputs,
      returnValues,
      error,
      stats,
      startedAt,
    });
  }
}

/** Maps the `LuaErrorKind` reported by the Luau runtime onto our error codes. */
export function mapLuauErrorKind(kind) {
  switch (kind) {
    case 'syntax':
    case 'compile':
      return { code: 'E_SYNTAX', kind: 'PARSE', label: 'Error de sintaxis' };
    case 'interrupted':
      return { code: 'E_TIMEOUT', kind: 'RUNTIME', label: 'Ejecución interrumpida' };
    case 'memory':
      return { code: 'E_RUNTIME', kind: 'RUNTIME', label: 'Límite de memoria excedido' };
    case 'conversion':
      return { code: 'E_RUNTIME', kind: 'RUNTIME', label: 'Error de conversión de valores' };
    case 'input':
      return { code: 'E_INVALID_ARGUMENT', kind: 'RUNTIME', label: 'Entrada inválida' };
    case 'host':
      return { code: 'E_RUNTIME', kind: 'RUNTIME', label: 'Error del host' };
    default:
      return { code: 'E_RUNTIME', kind: 'RUNTIME', label: 'Error de ejecución' };
  }
}

export const ENGINE_IDS = EngineId;
