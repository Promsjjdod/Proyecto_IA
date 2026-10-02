/**
 * CommandManager — the single registry of user actions.
 *
 * Every button, menu entry, shortcut and palette item resolves through this registry, so a
 * command exists exactly once and behaves identically everywhere. Commands are real
 * functions; `execute()` awaits them, reports failures through the ErrorBus and records
 * usage statistics (which drive the palette's "recent" ordering).
 */

import { createScheduler } from '../utils/async.js';

export class CommandManager {
  #commands = new Map();
  #recents = [];
  #recencyLimit = 12;
  #subscribers = new Set();
  #executions = 0;
  #failures = 0;
  #running = new Map();
  #emit = createScheduler(() => this.#notify());

  constructor({ logger, errorBus, eventBus, notifications }) {
    this.logger = logger;
    this.errorBus = errorBus;
    this.eventBus = eventBus;
    this.notifications = notifications;
  }

  init() {
    return { ok: true, commands: this.#commands.size };
  }

  /**
   * Registers a command.
   * @param {{ id: string, title: string, category?: string, description?: string, icon?: string, keywords?: string[], run: Function, enabled?: Function, disabledReason?: Function, allowInInput?: boolean, hidden?: boolean, dangerous?: boolean, pluginId?: string, order?: number }} definition
   */
  register(definition) {
    const { id, title, run } = definition ?? {};
    if (typeof id !== 'string' || id.trim() === '') throw new Error('El comando necesita un id');
    if (typeof run !== 'function') throw new Error(`El comando "${id}" necesita una función run()`);
    if (this.#commands.has(id)) {
      throw new Error(`El comando "${id}" ya está registrado (origen: ${this.#commands.get(id).pluginId ?? 'núcleo'})`);
    }
    const command = {
      id,
      title: title ?? id,
      category: definition.category ?? 'General',
      description: definition.description ?? null,
      icon: definition.icon ?? null,
      keywords: Array.isArray(definition.keywords) ? definition.keywords : [],
      run,
      enabled: typeof definition.enabled === 'function' ? definition.enabled : null,
      disabledReason: typeof definition.disabledReason === 'function' ? definition.disabledReason : null,
      allowInInput: definition.allowInInput === true,
      hidden: definition.hidden === true,
      dangerous: definition.dangerous === true,
      pluginId: definition.pluginId ?? null,
      order: Number.isFinite(definition.order) ? definition.order : 100,
      usageCount: 0,
      lastUsedAt: null,
      registeredAt: Date.now(),
    };
    this.#commands.set(id, command);
    this.#emit.schedule();
    return command;
  }

  registerMany(definitions) {
    const registered = [];
    const errors = [];
    for (const definition of definitions ?? []) {
      try {
        registered.push(this.register(definition));
      } catch (err) {
        errors.push({ id: definition?.id ?? 'desconocido', message: err.message });
        this.logger?.warn(`No se pudo registrar el comando "${definition?.id}": ${err.message}`, { source: 'CommandManager' });
      }
    }
    return { registered: registered.length, errors };
  }

  unregister(id) {
    return { ok: this.#commands.delete(id) };
  }

  /** Removes every command contributed by a plugin (plugin unload). */
  unregisterByPlugin(pluginId) {
    const ids = [...this.#commands.values()].filter((command) => command.pluginId === pluginId).map((command) => command.id);
    for (const id of ids) this.#commands.delete(id);
    if (ids.length > 0) this.#emit.schedule();
    return { removed: ids };
  }

  has(id) {
    return this.#commands.has(id);
  }

  get(id) {
    return this.#commands.get(id) ?? null;
  }

  list({ includeHidden = false, category = null, pluginId = undefined } = {}) {
    return [...this.#commands.values()]
      .filter((command) => (includeHidden ? true : !command.hidden))
      .filter((command) => (category ? command.category === category : true))
      .filter((command) => (pluginId === undefined ? true : command.pluginId === pluginId))
      .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'es'));
  }

  get categories() {
    const counts = new Map();
    for (const command of this.#commands.values()) {
      if (command.hidden) continue;
      counts.set(command.category, (counts.get(command.category) ?? 0) + 1);
    }
    return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }

  /**
   * Fuzzy search used by the command palette. Returns commands ordered by real relevance:
   * match quality first, then usage frequency and recency.
   */
  search(query, { limit = 40, includeHidden = false } = {}) {
    const normalized = normalise(query);
    const candidates = this.list({ includeHidden });
    if (normalized === '') {
      return candidates
        .map((command) => ({ command, score: this.#recentScore(command) }))
        .sort((a, b) => b.score - a.score || a.command.order - b.command.order)
        .slice(0, limit)
        .map((entry) => ({ ...entry.command, score: entry.score, matched: [] }));
    }
    const results = [];
    for (const command of candidates) {
      const match = fuzzyMatch(normalized, command.title, command.keywords ?? [], command.category);
      if (!match) continue;
      results.push({ ...command, score: match.score + this.#recentScore(command) * 0.6, matched: match.matched, positions: match.positions });
    }
    results.sort((a, b) => b.score - a.score || a.title.length - b.title.length);
    return results.slice(0, limit);
  }

  #recentScore(command) {
    const index = this.#recents.indexOf(command.id);
    let score = 0;
    if (index >= 0) score += 10 - index;
    score += Math.min(6, command.usageCount * 0.4);
    return score;
  }

  /**
   * Runs a command. Never throws: failures are reported with their real stack trace.
   */
  async execute(id, context = {}) {
    const command = this.#commands.get(id);
    if (!command) {
      const error = Object.assign(new Error(`El comando "${id}" no existe`), { code: 'E_COMMAND_MISSING' });
      this.errorBus?.report(error, { source: 'CommandManager', kind: 'UI' });
      return { ok: false, error };
    }
    if (command.enabled && command.enabled() === false) {
      const reason = command.disabledReason?.() ?? `"${command.title}" no está disponible`;
      this.notifications?.info(reason, { durationMs: 2400 });
      return { ok: false, disabled: true, reason };
    }
    if (this.#running.has(id)) {
      // Re-entrancy guard: running the same command twice concurrently is usually a mistake.
      return { ok: false, busy: true, reason: `"${command.title}" ya se está ejecutando` };
    }

    this.#running.set(id, Date.now());
    const startedAt = performance.now();
    let outcome;
    try {
      outcome = command.run(context);
    } catch (err) {
      return this.#finishedWithError(id, err, context);
    }
    /*
     * Un comando síncrono libera el guardia de reentrada en este mismo turno. De lo contrario, una
     * segunda pulsación inmediata del mismo atajo (Ctrl+B dos veces seguidas, por ejemplo) se
     * descartaría con `busy` aunque no hubiera nada ejecutándose. El guardia sólo protege a los
     * comandos que devuelven una promesa real y siguen trabajando cuando el evento termina.
     */
    if (!outcome || typeof outcome.then !== 'function') {
      this.#running.delete(id);
      this.#completed(id, outcome, context, startedAt);
      return { ok: true, result: outcome };
    }
    try {
      const result = await outcome;
      this.#completed(id, result, context, startedAt);
      return { ok: true, result };
    } catch (err) {
      return this.#finishedWithError(id, err, context);
    } finally {
      this.#running.delete(id);
    }
  }

  /** Registra el éxito de un comando (contadores, recientes y evento). */
  #completed(id, result, context, startedAt) {
    const command = this.#commands.get(id);
    if (command) {
      command.usageCount += 1;
      command.lastUsedAt = Date.now();
    }
    this.#executions += 1;
    this.#pushRecent(id);
    this.#emit.schedule();
    this.eventBus?.emit('command:executed', {
      id,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      ok: true,
      source: context.source ?? 'unknown',
    });
    return result;
  }

  /** Registra el fallo de un comando reportándolo por el bus de errores. Nunca lo oculta. */
  #finishedWithError(id, err, context) {
    this.#failures += 1;
    this.eventBus?.emit('command:failed', { id, message: err?.message ?? String(err), source: context.source ?? 'unknown' });
    const incident = this.errorBus?.report(err, { source: `comando:${id}`, kind: 'UI', silent: false });
    if (!incident) this.logger?.error(err, { source: `CommandManager:${id}` });
    return { ok: false, error: err };
  }

  isRunning(id) {
    return this.#running.has(id);
  }

  #pushRecent(id) {
    this.#recents = [id, ...this.#recents.filter((entry) => entry !== id)].slice(0, this.#recencyLimit);
  }

  get recents() {
    return this.#recents.map((id) => this.#commands.get(id)).filter(Boolean);
  }

  clearRecents() {
    const count = this.#recents.length;
    this.#recents = [];
    return { cleared: count };
  }

  subscribe(listener) {
    this.#subscribers.add(listener);
    return () => this.#subscribers.delete(listener);
  }

  #notify() {
    const list = this.list({ includeHidden: true });
    for (const listener of [...this.#subscribers]) {
      try {
        listener(list);
      } catch (err) {
        this.logger?.error(err, { source: 'CommandManager.notify' });
      }
    }
  }

  stats() {
    return {
      total: this.#commands.size,
      hidden: [...this.#commands.values()].filter((command) => command.hidden).length,
      pluginCommands: [...this.#commands.values()].filter((command) => command.pluginId !== null).length,
      executions: this.#executions,
      failures: this.#failures,
      running: this.#running.size,
      recents: this.#recents.length,
      mostUsed: [...this.#commands.values()]
        .filter((command) => command.usageCount > 0)
        .sort((a, b) => b.usageCount - a.usageCount)
        .slice(0, 5)
        .map((command) => ({ id: command.id, title: command.title, usageCount: command.usageCount })),
    };
  }

  describe() {
    return this.list({ includeHidden: true }).map((command) => ({
      id: command.id,
      title: command.title,
      category: command.category,
      description: command.description,
      pluginId: command.pluginId,
      hidden: command.hidden,
      allowInInput: command.allowInInput,
      usageCount: command.usageCount,
      lastUsedAt: command.lastUsedAt,
      enabled: command.enabled ? command.enabled() : true,
    }));
  }

  dispose() {
    this.#commands.clear();
    this.#recents = [];
    this.#subscribers.clear();
  }
}

function normalise(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Scores a query against a title/keywords. Returns `null` when the query does not match.
 * Consecutive matches and word-prefix matches score higher — the palette therefore behaves
 * predictably instead of returning everything.
 */
export function fuzzyMatch(query, title, keywords = [], category = '') {
  const haystack = normalise(title);
  const queryParts = query.split(/\s+/).filter(Boolean);
  if (queryParts.length === 0) return { score: 0, matched: [], positions: [] };

  let total = 0;
  const positions = [];
  const matched = [];
  let searchFrom = 0;

  for (const part of queryParts) {
    let index = haystack.indexOf(part, searchFrom);
    if (index === -1) index = haystack.indexOf(part);
    if (index === -1) {
      const keywordHit = keywords.find((keyword) => normalise(keyword).includes(part));
      const categoryHit = normalise(category).includes(part);
      if (keywordHit) {
        total += 4;
        matched.push(keywordHit);
        continue;
      }
      if (categoryHit) {
        total += 2;
        matched.push(category);
        continue;
      }
      return null;
    }
    total += 20 - Math.min(12, index);
    if (index === 0 || /\s|·|\/|-/.test(haystack[index - 1])) total += 8;
    if (haystack.length === part.length) total += 10;
    positions.push([index, index + part.length]);
    matched.push(title.slice(index, index + part.length));
    searchFrom = index + part.length;
  }

  // Shorter titles are more likely to be what the user meant.
  total -= Math.min(6, Math.floor(haystack.length / 12));
  return { score: total, matched, positions };
}
