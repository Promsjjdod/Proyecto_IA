/**
 * ThemeStore — built-in themes plus user themes stored as real JSON files.
 *
 * Custom themes live in `data/themes/<id>.json`, can be imported/exported like any other
 * file and are validated token by token: missing tokens are completed from the neutral
 * fallback and reported, so a partial theme never produces an unstyled UI.
 */

import path from 'node:path';
import { ErrorKind } from '../../shared/constants.js';
import { AppError, errors, toAppError } from '../../shared/errors.js';
import { BUILTIN_THEMES, DEFAULT_THEME_ID, getBuiltinTheme, validateTheme } from '../../shared/themes.js';

export class ThemeStore {
  #custom = new Map();
  loadProblems = [];

  constructor({ storage, logger, errorHandler, bus }) {
    this.storage = storage;
    this.logger = logger;
    this.errorHandler = errorHandler;
    this.bus = bus;
  }

  async load() {
    const entries = await this.storage.list('themes', { depth: 1, includeFiles: true }).catch(() => []);
    const files = entries.filter((entry) => entry.type === 'file' && entry.name.endsWith('.json'));
    this.#custom.clear();
    this.loadProblems = [];

    for (const entry of files) {
      const result = await this.storage.readJson(path.join('themes', entry.name), { fallback: null });
      if (!result.value) {
        this.loadProblems.push({ file: entry.name, reason: 'El archivo no contiene un tema válido' });
        continue;
      }
      const validation = validateTheme(result.value);
      if (!validation.ok) {
        this.loadProblems.push({ file: entry.name, reason: validation.error ?? 'Tema inválido' });
        continue;
      }
      if (this.#custom.has(validation.theme.id)) {
        this.loadProblems.push({ file: entry.name, reason: `Id duplicado: ${validation.theme.id}` });
        continue;
      }
      if (validation.problems.length > 0) {
        this.loadProblems.push({ file: entry.name, reason: validation.problems.join('; ') });
      }
      this.#custom.set(validation.theme.id, { ...validation.theme, file: entry.name });
    }

    if (this.loadProblems.length > 0) {
      this.errorHandler.report(new AppError({
        message: `Se encontraron problemas en ${this.loadProblems.length} tema(s) personalizado(s)`,
        code: 'E_CORRUPT_DATA',
        kind: ErrorKind.THEME,
        detail: { problems: this.loadProblems },
      }), { source: 'ThemeStore.load' });
    }
    this.bus.emit('themes:loaded', { builtin: BUILTIN_THEMES.length, custom: this.#custom.size });
    return { builtin: BUILTIN_THEMES.length, custom: this.#custom.size, problems: this.loadProblems };
  }

  /** All themes with metadata (tokens included: they are needed to apply a theme offline). */
  list({ includeTokens = true } = {}) {
    const all = [
      ...BUILTIN_THEMES.map((theme) => ({ ...theme, builtin: true, file: null, removable: false })),
      ...[...this.#custom.values()].map((theme) => ({ ...theme, builtin: false, removable: true })),
    ];
    return all.map((theme) => (includeTokens ? theme : { ...theme, tokens: undefined }));
  }

  get(id) {
    const theme = getBuiltinTheme(id) ?? this.#custom.get(id) ?? null;
    if (!theme) return null;
    return { ...theme, builtin: Boolean(getBuiltinTheme(id)), removable: Boolean(this.#custom.get(id)) };
  }

  require(id) {
    const theme = this.get(id);
    if (!theme) throw errors.notFound(`El tema "${id}"`, { themeId: id, kind: ErrorKind.THEME });
    return theme;
  }

  /** Creates or updates a custom theme. */
  async save(input) {
    const validation = validateTheme(input);
    if (!validation.ok) {
      throw new AppError({
        message: `Tema inválido: ${validation.error}`,
        code: 'E_VALIDATION_FAILED',
        kind: ErrorKind.THEME,
        detail: { problems: validation.problems, themeId: input?.id ?? null },
      });
    }
    if (getBuiltinTheme(validation.theme.id)) {
      throw new AppError({
        message: `No se puede sobrescribir el tema integrado "${validation.theme.id}"; usa otro identificador`,
        code: 'E_ALREADY_EXISTS',
        kind: ErrorKind.THEME,
        detail: { themeId: validation.theme.id },
      });
    }
    const file = `${validation.theme.id}.json`;
    const payload = {
      id: validation.theme.id,
      name: validation.theme.name,
      type: validation.theme.type,
      author: validation.theme.author,
      description: validation.theme.description,
      createdAt: validation.theme.createdAt,
      tokens: validation.theme.tokens,
    };
    await this.storage.writeJson(path.join('themes', file), payload);
    this.#custom.set(validation.theme.id, { ...validation.theme, file });
    this.bus.emit('themes:changed', { reason: 'save', id: validation.theme.id });
    this.logger.info(`Tema personalizado guardado: ${validation.theme.id}`, { source: 'ThemeStore' });
    return {
      theme: this.get(validation.theme.id),
      missingTokens: validation.missing,
      unknownTokens: validation.unknown,
    };
  }

  async remove(id) {
    const theme = this.#custom.get(id);
    if (!theme) {
      throw new AppError({
        message: `El tema "${id}" no es un tema personalizado existente`,
        code: 'E_NOT_FOUND',
        kind: ErrorKind.THEME,
        detail: { themeId: id, builtin: Boolean(getBuiltinTheme(id)) },
      });
    }
    await this.storage.remove(path.join('themes', theme.file), { soft: true });
    this.#custom.delete(id);
    this.bus.emit('themes:changed', { reason: 'remove', id });
    return { ok: true, id };
  }

  /** Imports a theme from raw JSON text (paste or file upload). */
  async import(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new AppError({
        message: `El tema no es JSON válido: ${err.message}`,
        code: 'E_CORRUPT_DATA',
        kind: ErrorKind.THEME,
        detail: { snippet: String(text).slice(0, 160) },
        cause: err,
      });
    }
    const payload = parsed.theme && typeof parsed.theme === 'object' ? parsed.theme : parsed;
    if (getBuiltinTheme(payload.id)) {
      payload.id = `${payload.id}-custom-${Math.random().toString(36).slice(2, 6)}`;
      payload.name = `${payload.name ?? payload.id} (importado)`;
    }
    const saved = await this.save(payload);
    return { ...saved, imported: true };
  }

  async export(id) {
    const theme = this.require(id);
    return {
      filename: `${theme.id}.theme.json`,
      content: JSON.stringify({
        id: theme.id,
        name: theme.name,
        type: theme.type,
        author: theme.author,
        description: theme.description,
        tokens: theme.tokens,
      }, null, 2),
    };
  }

  /** Deletes every custom theme (Settings → Storage → reset). */
  async removeAllCustom() {
    const ids = [...this.#custom.keys()];
    for (const id of ids) {
      try {
        await this.remove(id);
      } catch (err) {
        this.errorHandler.report(toAppError(err, {
          kind: ErrorKind.THEME,
          message: `No se pudo eliminar el tema "${id}"`,
        }), { source: 'ThemeStore.removeAllCustom' });
      }
    }
    return { removed: ids.length, ids };
  }

  /** Theme used when the configured one cannot be resolved. */
  fallbackId() {
    return DEFAULT_THEME_ID;
  }

  stats() {
    return {
      builtin: BUILTIN_THEMES.length,
      custom: this.#custom.size,
      problems: this.loadProblems.length,
      customIds: [...this.#custom.keys()],
    };
  }
}
