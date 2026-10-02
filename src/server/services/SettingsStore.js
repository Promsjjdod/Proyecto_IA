/**
 * SettingsStore — validated, atomic, transactional configuration.
 *
 * Guarantees:
 *  - Every stored value is validated against the shared schema on load *and* on write: an
 *    invalid value never reaches the file, and a file edited by hand can't break the app
 *    (invalid entries are replaced by their default and reported, not hidden).
 *  - A write is all-or-nothing: if any value of a patch is rejected, none is persisted and the
 *    caller gets the exact per-key reason.
 *  - The file is written atomically (temp file + fsync + rename) and the previous version is
 *    kept as a backup by the storage layer.
 *  - External edits (another editor, a sync tool) are detected and re-applied without losing
 *    in-flight changes.
 */

import { EventEmitter } from 'node:events';
import {
  CATEGORY_INFO,
  RESTART_KEYS,
  SETTINGS_BY_KEY,
  SETTINGS_SCHEMA,
  SettingsCategory,
  buildDefaultSettings,
  isSettingEnabled,
  settingsByCategory,
  validateSettingValue,
} from '../../shared/settings-schema.js';
import { CapabilityState } from '../../shared/constants.js';
import { errors } from '../../shared/errors.js';
import { debounce } from '../../shared/async.js';

const FILE = 'meta/settings.json';

export class SettingsStore {
  #values = buildDefaultSettings();
  #defaults = buildDefaultSettings();
  #stored = {};
  #invalidEntries = [];
  #watcher = null;
  #bus;
  #flush;

  constructor({ storage, logger, bus, capabilities = null, errorHandler = null }) {
    this.storage = storage;
    this.logger = logger;
    this.bus = bus;
    this.capabilities = capabilities;
    this.errorHandler = errorHandler;
    this.events = new EventEmitter();
    this.#bus = bus;
    this.#flush = debounce(() => void this.#persist(), 200);
  }

  /* ------------------------------------------------------------------ *
   * Load / persist
   * ------------------------------------------------------------------ */

  /** Loads the persisted configuration (see the guarantees in the class comment). */
  async load() {
    return this.init();
  }

  async init() {
    try {
      const result = await this.storage.readJson(FILE);
      if (result.found && result.value && typeof result.value === 'object') {
        this.#stored = { ...result.value };
        if (result.recovered || result.corruptPath) {
          this.logger?.warn('El archivo de configuración estaba corrupto; se recuperó desde el respaldo', {
            source: 'SettingsStore',
            data: { corruptPath: result.corruptPath ?? null },
          });
        }
      } else if (result.found) {
        this.logger?.warn('El archivo de configuración no contenía un objeto; se usarán los valores por defecto', { source: 'SettingsStore' });
      }
    } catch (err) {
      this.errorHandler?.handle?.(err, { source: 'SettingsStore.init' });
      this.logger?.warn(`No se pudo leer la configuración (${err.message}); se usan los valores por defecto`, { source: 'SettingsStore' });
    }

    const resolved = this.#resolve(this.#stored);
    this.#values = resolved.values;
    this.#invalidEntries = resolved.invalid;

    this.#watcher = this.storage.watch?.(FILE, () => void this.reloadFromDisk()) ?? null;
    return this.snapshot();
  }

  /** Applies stored values over the defaults, validating each one. */
  #resolve(stored) {
    const values = buildDefaultSettings();
    const invalid = [];
    for (const [key, raw] of Object.entries(stored ?? {})) {
      const definition = SETTINGS_BY_KEY[key];
      if (!definition) {
        invalid.push({ key, reason: 'unknown-key', value: raw });
        continue;
      }
      const validation = validateSettingValue(definition, raw);
      if (validation.ok) values[key] = validation.value;
      else invalid.push({ key, reason: validation.message, value: raw });
    }
    return { values, invalid };
  }

  /** Re-reads the file (external change) keeping the rest of the app consistent. */
  async reloadFromDisk() {
    try {
      const result = await this.storage.readJson(FILE);
      if (!result.found) return { ok: false, reason: 'missing' };
      const resolved = this.#resolve(result.value ?? {});
      const changed = Object.keys(resolved.values).filter((key) => this.#values[key] !== resolved.values[key]);
      this.#values = resolved.values;
      this.#stored = { ...(result.value ?? {}) };
      this.#invalidEntries = resolved.invalid;
      if (changed.length > 0) {
        this.logger?.info(`Configuración recargada desde el disco (${changed.length} cambios)`, { source: 'SettingsStore' });
        this.#emit(changed, { reason: 'external-change' });
      }
      return { ok: true, changed };
    } catch (err) {
      this.logger?.warn(`No se pudo recargar la configuración: ${err.message}`, { source: 'SettingsStore' });
      return { ok: false, error: err.message };
    }
  }

  /** Public, awaitable persistence (used by the shutdown path). */
  async persist() {
    this.#flush.cancel();
    return this.#persist();
  }

  async #persist() {
    try {
      await this.storage.writeJson(FILE, this.#stored, { backup: true, mode: 0o600 });
    } catch (err) {
      this.errorHandler?.handle?.(err, { source: 'SettingsStore.persist' });
      this.logger?.error(`No se pudo guardar la configuración: ${err.message}`, { source: 'SettingsStore' });
      throw err;
    }
  }

  /* ------------------------------------------------------------------ *
   * Read
   * ------------------------------------------------------------------ */

  get(key) {
    if (!(key in this.#values)) {
      const definition = SETTINGS_BY_KEY[key];
      if (!definition) throw errors.notFound(`La configuración «${key}»`, { field: 'key' });
      return definition.default;
    }
    return this.#values[key];
  }

  getAll() {
    return { ...this.#values };
  }

  getDefaults() {
    return { ...this.#defaults };
  }

  /** Alias used by the API (`GET /api/settings/values`). */
  getValues() {
    return this.getAll();
  }

  /**
   * Everything the Settings UI needs in one call: values, defaults, the described categories
   * (with per-setting availability) and the problems found while loading the file.
   */
  async getPublic() {
    const categories = await this.describeCategories();
    return {
      values: this.getAll(),
      defaults: this.getDefaults(),
      categories,
      invalidEntries: [...this.#invalidEntries],
      pendingRestart: this.#pendingRestart(),
      modified: Object.keys(this.#values).filter((key) => this.isModified(key)),
      storedCount: Object.keys(this.#stored).length,
      path: this.storage.resolve(FILE),
    };
  }

  /** Resets every setting of one category. */
  async resetCategory(category) {
    return this.reset({ category });
  }

  /** Export payload for the download endpoint. */
  async exportValues() {
    return this.export();
  }

  /** Import from the upload endpoint (validated, reports what was rejected). */
  async importValues(config) {
    return this.import(config);
  }

  /** True when a value differs from the schema default. */
  isModified(key) {
    const definition = SETTINGS_BY_KEY[key];
    if (!definition) return false;
    return JSON.stringify(this.#values[key]) !== JSON.stringify(definition.default);
  }

  /** Stored values only (what a backup would contain). */
  getStored() {
    return { ...this.#stored };
  }

  snapshot() {
    return {
      values: this.getAll(),
      defaults: this.getDefaults(),
      modified: Object.keys(this.#values).filter((key) => this.isModified(key)),
      invalidEntries: [...this.#invalidEntries],
      pendingRestart: RESTART_KEYS.size > 0 ? this.#pendingRestart() : [],
      storedCount: Object.keys(this.#stored).length,
      path: this.storage.resolve(FILE),
    };
  }

  #pendingRestart() {
    return Object.keys(this.#stored).filter((key) => RESTART_KEYS.has(key) && this.#values[key] !== SETTINGS_BY_KEY[key].default);
  }

  /**
   * Categories for the Settings UI: every setting with its current value, whether it is
   * enabled by its dependencies, and whether its capability requirement is available.
   */
  async describeCategories({ checkCapabilities = true } = {}) {
    const availability = checkCapabilities && this.capabilities ? await this.#availability() : {};
    return Object.values(SettingsCategory).map((categoryId) => {
      const info = CATEGORY_INFO[categoryId];
      return {
        id: categoryId,
        label: info.label,
        description: info.description,
        icon: info.icon,
        settings: settingsByCategory(categoryId).map((definition) => {
          const entry = definition.requires ? availability[definition.requires] : null;
          const available = !definition.requires || entry === undefined ? true : entry.available !== false;
          return {
            key: definition.key,
            label: definition.label,
            description: definition.description,
            type: definition.type,
            default: definition.default,
            options: definition.options ?? null,
            min: definition.min ?? null,
            max: definition.max ?? null,
            step: definition.step ?? null,
            unit: definition.unit ?? null,
            maxLength: definition.maxLength ?? null,
            readOnly: definition.readOnly === true,
            advanced: definition.advanced === true,
            requires: definition.requires ?? null,
            requiresMessage: definition.requiresMessage ?? null,
            enabled: isSettingEnabled(definition, this.#values),
            enabledWhen: definition.enabledWhen ?? null,
            restartRequired: RESTART_KEYS.has(definition.key),
            modified: this.isModified(definition.key),
            value: this.#values[definition.key],
            available,
            unavailableReason: available ? null : (definition.requiresMessage ?? entry?.detail ?? 'Dependencia no disponible'),
            capabilityState: entry?.state ?? null,
          };
        }),
      };
    });
  }

  async #availability() {
    const ids = [...new Set(SETTINGS_SCHEMA.map((definition) => definition.requires).filter(Boolean))];
    if (ids.length === 0) return {};
    try {
      const entries = await this.capabilities.detect({ ids });
      return Object.fromEntries(entries.map((entry) => [entry.id, entry]));
    } catch (err) {
      this.logger?.warn(`No se pudo comprobar la disponibilidad de las dependencias: ${err.message}`, { source: 'SettingsStore' });
      return {};
    }
  }

  /* ------------------------------------------------------------------ *
   * Write
   * ------------------------------------------------------------------ */

  /**
   * Applies a patch atomically. Throws with `detail.errors` when any value is rejected, so the
   * caller can show exactly which setting was wrong and why.
   */
  async set(patch) {
    const base = errors.invalid('La configuración enviada no es válida', { errors: [] });
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw base;
    }
    const entries = Object.entries(patch);
    if (entries.length === 0) return { changed: [], values: this.getAll(), requiresRestart: [] };

    const errorsList = [];
    const candidate = { ...this.#stored };
    const validated = {};
    for (const [key, raw] of entries) {
      const definition = SETTINGS_BY_KEY[key];
      if (!definition) {
        errorsList.push({ key, message: `Configuración desconocida: ${key}` });
        continue;
      }
      if (definition.readOnly) {
        errorsList.push({ key, message: `«${definition.label}» es de solo lectura` });
        continue;
      }
      const validation = validateSettingValue(definition, raw);
      if (!validation.ok) {
        errorsList.push({ key, message: validation.message, received: validation.received });
        continue;
      }
      validated[key] = validation.value;
      if (JSON.stringify(definition.default) === JSON.stringify(validation.value)) delete candidate[key];
      else candidate[key] = validation.value;
    }

    if (errorsList.length > 0) {
      throw errors.invalid('Uno o más valores de configuración no son válidos', { errors: errorsList });
    }

    const changed = Object.keys(validated).filter((key) => JSON.stringify(this.#values[key]) !== JSON.stringify(validated[key]));
    if (changed.length === 0) {
      return { changed: [], values: this.getAll(), requiresRestart: [], unchanged: true };
    }

    const previous = { ...this.#stored };
    this.#stored = candidate;
    this.#values = { ...this.#values, ...validated };
    try {
      await this.#persist();
    } catch (err) {
      // Roll back so memory and disk never disagree.
      this.#stored = previous;
      for (const key of changed) this.#values[key] = previous[key] ?? SETTINGS_BY_KEY[key].default;
      throw errors.failed(`No se pudo guardar la configuración: ${err.message}`, { changed });
    }

    const requiresRestart = changed.filter((key) => RESTART_KEYS.has(key));
    this.#emit(changed, { reason: 'user', requiresRestart });
    return { changed, values: this.getAll(), requiresRestart };
  }

  /** Resets a category, a single key or everything. */
  async reset({ category = null, key = null, all = false } = {}) {
    if (!all && !category && !key) {
      return this.reset({ all: true });
    }
    const keys = key
      ? [key]
      : all
        ? Object.keys(this.#values)
        : settingsByCategory(category).map((definition) => definition.key);
    if (keys.length === 0) throw errors.notFound(`La categoría «${category}»`, { category });

    const candidate = { ...this.#stored };
    const changed = [];
    for (const entryKey of keys) {
      if (!SETTINGS_BY_KEY[entryKey]) continue;
      if (this.#stored[entryKey] !== undefined || this.#values[entryKey] !== SETTINGS_BY_KEY[entryKey].default) changed.push(entryKey);
      delete candidate[entryKey];
      this.#values[entryKey] = SETTINGS_BY_KEY[entryKey].default;
    }
    this.#stored = candidate;
    await this.#persist();
    if (changed.length > 0) this.#emit(changed, { reason: 'reset', category, key, all });
    return { changed, values: this.getAll() };
  }

  /** Imports a configuration object (validated); returns what actually changed. */
  async import(config) {
    if (!config || typeof config !== 'object') throw errors.invalid('El archivo de configuración no contiene un objeto JSON');
    const values = config.values && typeof config.values === 'object' ? config.values : config;
    const result = await this.set(values);
    return { changed: result.changed, rejected: this.#invalidEntries };
  }

  /** Serialisable export (only modified values, plus metadata). */
  export() {
    return {
      format: 'lumen-settings',
      version: 1,
      exportedAt: new Date().toISOString(),
      values: { ...this.#stored },
      modified: Object.keys(this.#values).filter((key) => this.isModified(key)),
    };
  }

  /* ------------------------------------------------------------------ *
   * Events
   * ------------------------------------------------------------------ */

  subscribe(listener) {
    this.events.on('changed', listener);
    return () => this.events.off('changed', listener);
  }

  #emit(changed, detail) {
    const payload = { changed, values: this.getAll(), ...detail };
    this.events.emit('changed', payload);
    this.#bus?.emit('settings:changed', payload);
  }

  /** Closes the file watcher and writes any pending change. */
  async dispose() {
    this.#watcher?.close?.();
    this.#watcher = null;
    try {
      await this.#persist();
    } catch {
      /* the error was already reported */
    }
  }

  /** Availability of the settings that depend on capabilities (used by /api/settings). */
  async capabilitySummary() {
    const availability = await this.#availability();
    const unavailable = Object.values(availability).filter((entry) => entry.available === false);
    return {
      checked: Object.keys(availability).length,
      unavailable: unavailable.map((entry) => ({ id: entry.id, state: entry.state ?? CapabilityState.UNAVAILABLE, detail: entry.detail ?? null })),
    };
  }
}
