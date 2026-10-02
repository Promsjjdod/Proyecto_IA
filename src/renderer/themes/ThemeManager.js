/**
 * ThemeManager — applies real themes to the document.
 *
 * A theme is a set of tokens; this manager turns them into CSS custom properties on
 * `document.documentElement` (plus `data-theme-type` for base rules) so *every* component
 * reads its colours from the active theme. The accent colour is applied on top by deriving
 * the accent-dependent tokens with real colour maths.
 *
 * Custom themes are validated token by token: missing tokens are completed from the neutral
 * fallback and the user is told exactly which ones were missing.
 */

import { ACCENT_DERIVED_TOKENS, BUILTIN_THEMES, DEFAULT_THEME_ID, THEME_FALLBACK, THEME_TOKENS, THEME_TOKEN_GROUPS, validateTheme } from '../../shared/themes.js';
import { deriveAccentTokens } from '../utils/color.js';
import { LocalKeys } from '../../shared/constants.js';

export class ThemeManager {
  #themes = new Map();
  #active = null;
  #accent = null;
  #subscribers = new Set();
  #appliedVariables = new Set();
  #problems = [];

  constructor({ apiClient, settings, eventBus, logger, capabilities }) {
    this.apiClient = apiClient;
    this.settings = settings;
    this.eventBus = eventBus;
    this.logger = logger;
    this.capabilities = capabilities;
    this.root = document.documentElement;
  }

  get themes() {
    return [...this.#themes.values()];
  }

  get active() {
    return this.#active;
  }

  get accent() {
    return this.#accent;
  }

  get problems() {
    return [...this.#problems];
  }

  async init() {
    // Built-ins are always available, even with no server.
    for (const theme of BUILTIN_THEMES) this.#themes.set(theme.id, { ...theme, builtin: true, removable: false });

    try {
      const payload = await this.apiClient.get('/api/themes');
      for (const theme of payload.themes ?? []) {
        this.#themes.set(theme.id, theme);
      }
      this.#problems = payload.problems ?? [];
    } catch (err) {
      this.logger.warn(`No se pudieron cargar los temas del servidor (${err.message}); se usan los integrados`, { source: 'ThemeManager' });
    }

    const requestedId = this.settings.get('appearance.theme') ?? DEFAULT_THEME_ID;
    const theme = this.#themes.get(requestedId) ?? this.#themes.get(DEFAULT_THEME_ID) ?? [...this.#themes.values()][0];
    if (theme.id !== requestedId) {
      this.logger.warn(`El tema "${requestedId}" no existe; se aplica "${theme.id}"`, { source: 'ThemeManager' });
    }
    this.applyAccent(this.settings.get('appearance.accentColor'));
    this.apply(theme, { persist: false });
    this.#applyUiScale();
    this.#applyTransparency();

    this.settings.subscribe((values, detail) => {
      if (detail.reason === 'availability') return;
      if ((detail.changed ?? []).includes('appearance.theme')) {
        const next = this.#themes.get(values['appearance.theme']);
        if (next && next.id !== this.#active?.id) this.apply(next, { persist: false });
      }
      if ((detail.changed ?? []).includes('appearance.accentColor')) {
        this.applyAccent(values['appearance.accentColor']);
      }
      if ((detail.changed ?? []).includes('appearance.uiScale')) this.#applyUiScale();
      if ((detail.changed ?? []).includes('appearance.transparency')) this.#applyTransparency();
    });

    return { theme: this.#active?.id, themes: this.#themes.size, problems: this.#problems.length, source: this.#active?.builtin ? 'builtin' : 'custom' };
  }

  /** Applies a theme by id or object. */
  apply(themeOrId, { persist = true, silent = false } = {}) {
    const theme = typeof themeOrId === 'string' ? this.#themes.get(themeOrId) : themeOrId;
    if (!theme || !theme.tokens) {
      const error = new Error(`No se puede aplicar el tema "${themeOrId}": no está cargado`);
      if (!silent) this.logger.error(error, { source: 'ThemeManager' });
      return { ok: false, error: error.message };
    }

    const { tokens, missing } = this.#completeTokens(theme.tokens);
    const applied = new Set();
    for (const [token, value] of Object.entries(tokens)) {
      if (this.#appliedVariables.has(token) === false) {
        // Nothing to clean up: setting the property creates it.
      }
      this.root.style.setProperty(`--${token}`, value);
      applied.add(token);
    }
    // Remove variables that belonged to a previous theme but not to this one.
    for (const previous of this.#appliedVariables) {
      if (!applied.has(previous)) this.root.style.removeProperty(`--${previous}`);
    }
    this.#appliedVariables = applied;

    this.root.dataset.theme = theme.id;
    this.root.dataset.themeType = theme.type;
    this.root.style.colorScheme = theme.type === 'light' ? 'light' : 'dark';
    this.#active = { ...theme, missingTokens: missing };
    this.#applyAccentTokens();

    if (persist) {
      void this.settings.set({ 'appearance.theme': theme.id }, { silent: true }).then((result) => {
        if (result.ok === false) {
          this.logger.warn(`No se pudo guardar el tema en el servidor: ${result.errors?.[0]?.message ?? 'error desconocido'}`, {
            source: 'ThemeManager',
          });
        }
      });
    }

    try {
      window.localStorage.setItem(LocalKeys.settings, JSON.stringify({ ...this.settings.values, 'appearance.theme': theme.id }));
    } catch {
      /* the settings manager already reports storage problems */
    }

    if (!silent) {
      this.#notify({ theme: this.#active, missingTokens: missing });
      this.eventBus?.emit('theme:changed', { id: theme.id, name: theme.name, type: theme.type, missing });
    }
    if (missing.length > 0) {
      this.logger.warn(`El tema "${theme.name}" no definía ${missing.length} tokens; se completaron con los valores por defecto`, {
        source: 'ThemeManager',
        data: { missing: missing.slice(0, 12) },
      });
    }
    return { ok: true, theme: this.#active, missing };
  }

  /** Sets the accent colour and derives every dependent token. */
  applyAccent(color) {
    this.#accent = color;
    this.root.style.setProperty('--user-accent', color);
    this.#applyAccentTokens();
    return { ok: true, accent: color };
  }

  #applyAccentTokens() {
    if (!this.#accent || !this.#active) return;
    const derived = deriveAccentTokens(this.#accent, { themeType: this.#active.type });
    if (!derived) {
      this.logger.warn(`El color de acento "${this.#accent}" no es válido`, { source: 'ThemeManager' });
      return;
    }
    for (const token of ACCENT_DERIVED_TOKENS) {
      const value = derived[token];
      if (typeof value === 'string') {
        this.root.style.setProperty(`--${token}`, value);
        this.#appliedVariables.add(token);
      }
    }
  }

  #applyUiScale() {
    const scale = this.settings.get('appearance.uiScale') ?? 1;
    this.root.style.setProperty('--ui-scale', String(scale));
    this.root.style.fontSize = `${Math.round(15 * scale)}px`;
  }

  #applyTransparency() {
    const transparency = this.settings.get('appearance.transparency') ?? 0;
    this.root.style.setProperty('--panel-alpha', String(1 - transparency));
    this.root.style.setProperty('--panel-blur', transparency > 0.02 ? 'var(--glass-blur)' : 'none');
  }

  #completeTokens(tokens) {
    const completed = {};
    const missing = [];
    for (const token of THEME_TOKENS) {
      const value = tokens?.[token];
      if (typeof value === 'string' && value.trim() !== '') completed[token] = value.trim();
      else {
        completed[token] = THEME_FALLBACK[token];
        missing.push(token);
      }
    }
    return { tokens: completed, missing };
  }

  /** Colour of a syntax token, resolved from the live CSS (used by the minimap). */
  resolveToken(name) {
    return getComputedStyle(this.root).getPropertyValue(`--${name}`).trim() || THEME_FALLBACK[name] || '#888';
  }

  /** CSS variable map (used by the editor theme and the minimap). */
  tokenMap() {
    const style = getComputedStyle(this.root);
    const map = {};
    for (const token of THEME_TOKENS) map[token] = style.getPropertyValue(`--${token}`).trim() || THEME_FALLBACK[token];
    return map;
  }

  /* --------------------------- Theme CRUD --------------------------- */

  async reload() {
    try {
      const payload = await this.apiClient.get('/api/themes');
      this.#themes.clear();
      for (const theme of BUILTIN_THEMES) this.#themes.set(theme.id, { ...theme, builtin: true, removable: false });
      for (const theme of payload.themes ?? []) this.#themes.set(theme.id, theme);
      this.#problems = payload.problems ?? [];
      if (!this.#themes.has(this.#active?.id)) this.apply(DEFAULT_THEME_ID, { persist: true });
      return { ok: true, themes: this.#themes.size, problems: this.#problems };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async saveCustom(theme) {
    const validation = validateTheme(theme);
    if (!validation.ok) return { ok: false, error: validation.error, problems: validation.problems };
    try {
      const result = await this.apiClient.post('/api/themes', { theme: validation.theme });
      this.#themes.set(result.theme.id, result.theme);
      this.apply(result.theme.id);
      return { ok: true, theme: result.theme, missingTokens: result.missingTokens ?? [], unknownTokens: result.unknownTokens ?? [] };
    } catch (err) {
      return { ok: false, error: err.message, detail: err.detail };
    }
  }

  async removeCustom(id) {
    const theme = this.#themes.get(id);
    if (!theme) return { ok: false, error: `El tema "${id}" no existe` };
    if (theme.builtin) return { ok: false, error: `El tema integrado "${id}" no se puede eliminar (duplícalo para personalizarlo)` };
    try {
      await this.apiClient.delete(`/api/themes/${encodeURIComponent(id)}`);
      this.#themes.delete(id);
      if (this.#active?.id === id) this.apply(DEFAULT_THEME_ID);
      return { ok: true, id };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async importTheme(content) {
    try {
      const result = await this.apiClient.post('/api/themes/import', { content });
      await this.reload();
      return { ok: true, theme: result.theme, missingTokens: result.missingTokens ?? [] };
    } catch (err) {
      return { ok: false, error: err.message, detail: err.detail };
    }
  }

  async exportTheme(id) {
    return this.apiClient.download(`/api/themes/${encodeURIComponent(id)}/export`, { filename: `${id}.theme.json` });
  }

  /** Duplicates the active theme as a starting point for the theme editor. */
  duplicateActive(name = null) {
    if (!this.#active) return null;
    const baseId = name ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : `${this.#active.id}-custom`;
    let id = baseId;
    let counter = 1;
    while (this.#themes.has(id)) {
      counter += 1;
      id = `${baseId}-${counter}`;
    }
    return {
      id,
      name: name ?? `${this.#active.name} (personalizado)`,
      type: this.#active.type,
      author: 'Usuario',
      description: `Basado en ${this.#active.name}`,
      tokens: { ...this.#active.tokens },
    };
  }

  subscribe(listener) {
    this.#subscribers.add(listener);
    return () => this.#subscribers.delete(listener);
  }

  #notify(payload) {
    for (const listener of [...this.#subscribers]) {
      try {
        listener(payload);
      } catch (err) {
        this.logger.error(err, { source: 'ThemeManager.notify' });
      }
    }
  }

  snapshot() {
    return {
      active: this.#active ? { id: this.#active.id, name: this.#active.name, type: this.#active.type, builtin: this.#active.builtin === true } : null,
      accent: this.#accent,
      themes: this.#themes.size,
      custom: [...this.#themes.values()].filter((theme) => theme.builtin !== true).length,
      missingTokens: this.#active?.missingTokens?.length ?? 0,
      problems: this.#problems,
    };
  }

  dispose() {
    this.#subscribers.clear();
  }
}

export { THEME_TOKEN_GROUPS, THEME_TOKENS };
