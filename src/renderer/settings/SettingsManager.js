/**
 * SettingsManager (client) — real configuration state.
 *
 * Source of truth: the server's validated configuration. A local cache in `localStorage`
 * keeps the UI usable offline (and makes the first paint instant), but every change is
 * written through the API and confirmed; if the server rejects a value the local copy is
 * rolled back and the error is surfaced.
 *
 * The manager also computes, for each setting, whether its capability dependency is
 * available, so the Settings UI never renders a control that cannot work.
 */

import { LocalKeys } from '../../shared/constants.js';
import { SETTINGS_BY_KEY, SETTINGS_SCHEMA, SettingsCategory, CATEGORY_INFO, buildDefaultSettings, validateSettingValue } from '../../shared/settings-schema.js';
import { debounce } from '../utils/async.js';

export class SettingsManager {
  #values = buildDefaultSettings();
  #schema = SETTINGS_SCHEMA;
  #categories = [];
  #pendingRestart = [];
  #subscribers = new Set();
  #availability = {};
  #localWritable = false;

  constructor({ apiClient, eventBus, logger, capabilities }) {
    this.apiClient = apiClient;
    this.eventBus = eventBus;
    this.logger = logger;
    this.capabilities = capabilities;
    this.source = 'defaults';
  }

  get values() {
    return { ...this.#values };
  }

  get schema() {
    return this.#schema;
  }

  get categories() {
    return this.#categories.length > 0 ? this.#categories : this.#buildLocalCategories();
  }

  /**
   * Offline fallback: the same categories and settings, built from the shared schema.
   * Used when the server cannot be reached, so the Settings view keeps working.
   */
  #buildLocalCategories() {
    const order = Object.values(SettingsCategory);
    const byCategory = new Map(order.map((id) => [id, []]));
    for (const definition of SETTINGS_SCHEMA) {
      if (!byCategory.has(definition.category)) byCategory.set(definition.category, []);
      byCategory.get(definition.category).push(definition);
    }
    return [...byCategory.entries()]
      .filter(([, settings]) => settings.length > 0)
      .map(([id, settings]) => ({
        ...(CATEGORY_INFO[id] ?? { id, label: id, description: '', icon: 'settings' }),
        id,
        settings,
        local: true,
      }));
  }

  get pendingRestart() {
    return [...this.#pendingRestart];
  }

  async init() {
    // 1. Local cache: instant, offline-capable defaults.
    this.#loadLocalCache();

    // 2. Server values: authoritative.
    let serverOk = false;
    try {
      const payload = await this.apiClient.get('/api/settings');
      this.#schema = payload.categories.flatMap((category) => category.settings.map((setting) => ({
        ...SETTINGS_BY_KEY[setting.key],
        value: setting.value,
        available: setting.available,
        unavailableReason: setting.unavailableReason,
        requires: setting.requires,
        capabilityState: setting.capabilityState,
      })));
      this.#categories = payload.categories.map((category) => ({
        ...CATEGORY_INFO[category.id],
        id: category.id,
        settings: category.settings,
      }));
      this.#values = { ...payload.defaults, ...payload.values };
      this.#pendingRestart = payload.pendingRestart ?? [];
      this.source = 'server';
      serverOk = true;
      if ((payload.invalidEntries ?? []).length > 0) {
        this.logger.warn(`El servidor ignoró ${payload.invalidEntries.length} valores de configuración inválidos`, {
          source: 'SettingsManager',
          data: { entries: payload.invalidEntries.slice(0, 5) },
        });
      }
    } catch (err) {
      this.logger.warn(`No se pudo leer la configuración del servidor (${err.message}); se usan los valores locales`, {
        source: 'SettingsManager',
      });
    }
    this.#saveLocalCache();
    this.#notify({ changed: Object.keys(this.#values), reason: serverOk ? 'server-load' : 'local-fallback' });
    return { source: this.source, count: Object.keys(this.#values).length, serverOk };
  }

  /** Current value for one setting. */
  get(key) {
    if (!(key in this.#values)) {
      const definition = SETTINGS_BY_KEY[key];
      if (definition) return definition.default;
      throw new Error(`Configuración desconocida: ${key}`);
    }
    return this.#values[key];
  }

  getDefinition(key) {
    return SETTINGS_BY_KEY[key] ?? null;
  }

  /** True when the value differs from the schema default. */
  isModified(key) {
    const definition = SETTINGS_BY_KEY[key];
    if (!definition) return false;
    return JSON.stringify(this.#values[key]) !== JSON.stringify(definition.default);
  }

  /**
   * Applies a patch. Values are validated locally first (fail fast with the real reason),
   * then persisted on the server; the local state only changes when the server confirms.
   */
  async set(patch, { silent = false } = {}) {
    const errors = [];
    const next = { ...this.#values };
    for (const [key, value] of Object.entries(patch)) {
      const definition = SETTINGS_BY_KEY[key];
      if (!definition) {
        errors.push({ key, message: `Configuración desconocida: ${key}` });
        continue;
      }
      const validation = validateSettingValue(definition, value);
      if (!validation.ok) {
        errors.push({ key, message: validation.message, received: validation.received });
        continue;
      }
      next[key] = validation.value;
    }
    if (errors.length > 0) {
      return { ok: false, errors, applied: [] };
    }

    const changed = Object.keys(patch).filter((key) => JSON.stringify(next[key]) !== JSON.stringify(this.#values[key]));
    if (changed.length === 0) return { ok: true, applied: [], unchanged: true };

    try {
      const result = await this.apiClient.put('/api/settings', { values: patch });
      this.#values = { ...this.#values, ...(result.values ?? {}) };
      this.#pendingRestart = result.pendingRestart ?? this.#pendingRestart;
      this.#saveLocalCache();
      if (!silent) this.#notify({ changed: result.changed ?? changed, requiresRestart: result.requiresRestart ?? [], reason: 'user' });
      return { ok: true, applied: result.changed ?? changed, requiresRestart: result.requiresRestart ?? [] };
    } catch (err) {
      // Map server validation errors (422/400) onto the UI.
      const serverErrors = err?.detail?.errors;
      if (Array.isArray(serverErrors) && serverErrors.length > 0) {
        return { ok: false, errors: serverErrors, applied: [] };
      }
      if (err?.code === 'E_NETWORK_FAILED') {
        // Offline mode: apply locally so the UI keeps working, and say so explicitly.
        this.#values = next;
        this.#saveLocalCache();
        if (!silent) this.#notify({ changed, reason: 'local-only', offline: true });
        return {
          ok: true,
          applied: changed,
          requiresRestart: [],
          offline: true,
          warning: 'El servidor no está disponible: el cambio se aplicó solo en este navegador y no se guardó en disco.',
        };
      }
      return { ok: false, errors: [{ key: null, message: err.message, code: err.code }], applied: [] };
    }
  }

  async resetSection(section) {
    try {
      const result = await this.apiClient.post('/api/settings/reset', section === 'all' ? {} : { category: section });
      this.#values = { ...this.#values, ...(result.values ?? {}) };
      this.#saveLocalCache();
      this.#notify({ changed: result.changed ?? [], reason: 'reset', section });
      return { ok: true, changed: result.changed ?? [] };
    } catch (err) {
      return { ok: false, error: err.message, code: err.code };
    }
  }

  async resetKey(key) {
    return this.resetSection(null).then(async () => {
      try {
        const result = await this.apiClient.post('/api/settings/reset', { key });
        this.#values = { ...this.#values, ...(result.values ?? {}) };
        this.#saveLocalCache();
        this.#notify({ changed: result.changed ?? [], reason: 'reset-key', key });
        return { ok: true, changed: result.changed ?? [] };
      } catch (err) {
        return { ok: false, error: err.message, code: err.code };
      }
    });
  }

  async exportToFile() {
    return this.apiClient.download('/api/settings/export', { filename: 'lumen-settings.json' });
  }

  async importFromContent(content) {
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      return { ok: false, error: `El archivo no es JSON válido: ${err.message}` };
    }
    try {
      const result = await this.apiClient.post('/api/settings/import', { config: parsed });
      const payload = await this.apiClient.get('/api/settings');
      this.#values = { ...payload.defaults, ...payload.values };
      this.#saveLocalCache();
      this.#notify({ changed: result.changed ?? [], reason: 'import' });
      return { ok: true, changed: result.changed ?? [] };
    } catch (err) {
      return { ok: false, error: err.message, detail: err.detail };
    }
  }

  /** Refreshes capability availability so the UI can disable impossible settings. */
  async refreshAvailability() {
    this.#availability = this.capabilities?.availabilityMap?.() ?? {};
    for (const category of this.#categories) {
      for (const setting of category.settings) {
        if (!setting.requires) continue;
        const entry = this.#availability[setting.requires];
        if (!entry) continue;
        setting.available = entry.available;
        setting.unavailableReason = entry.available ? null : entry.detail ?? setting.unavailableReason;
        setting.capabilityState = entry.state;
      }
    }
    this.#notify({ changed: [], reason: 'availability' });
    return this.#availability;
  }

  subscribe(listener) {
    this.#subscribers.add(listener);
    return () => this.#subscribers.delete(listener);
  }

  #notify(detail) {
    for (const listener of [...this.#subscribers]) {
      try {
        listener(this.values, detail);
      } catch (err) {
        this.logger.error(err, { source: 'SettingsManager.notify' });
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * Local cache (offline + instant boot)
   * ---------------------------------------------------------------- */

  #loadLocalCache() {
    try {
      const raw = window.localStorage.getItem(LocalKeys.settings);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      const merged = { ...this.#values };
      let applied = 0;
      for (const [key, value] of Object.entries(parsed)) {
        const definition = SETTINGS_BY_KEY[key];
        if (!definition) continue;
        const validation = validateSettingValue(definition, value);
        if (validation.ok) {
          merged[key] = validation.value;
          applied += 1;
        }
      }
      this.#values = merged;
      this.#localWritable = true;
      this.source = 'cache';
      void applied;
    } catch {
      this.#localWritable = false;
    }
  }

  #saveLocalCache = debounce(() => {
    try {
      window.localStorage.setItem(LocalKeys.settings, JSON.stringify(this.#values));
      this.#localWritable = true;
    } catch (err) {
      if (this.#localWritable) {
        this.#localWritable = false;
        this.logger.warn(`No se pudo guardar la caché local de configuración: ${err.message}`, { source: 'SettingsManager' });
      }
    }
  }, 500);

  get localCacheWritable() {
    return this.#localWritable;
  }

  /** Serialisable snapshot for the About view. */
  snapshot() {
    return {
      source: this.source,
      count: Object.keys(this.#values).length,
      categoryCount: Object.keys(SettingsCategory).length,
      pendingRestart: this.pendingRestart,
      localCacheWritable: this.localCacheWritable,
      modifiedKeys: Object.keys(this.#values).filter((key) => this.isModified(key)),
    };
  }

  dispose() {
    this.#subscribers.clear();
  }
}

export { SettingsCategory, SETTINGS_SCHEMA };
