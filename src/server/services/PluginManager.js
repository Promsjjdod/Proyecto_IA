/**
 * PluginManager (server side) — discovers, validates and tracks plugins.
 *
 * A plugin is a real directory with a manifest (`plugin.json`) and a JavaScript entry point:
 *
 *   data/plugins/my-plugin/
 *     ├─ plugin.json      → id, name, version, author, description, dependencies, permissions...
 *     └─ index.js         → entry point (executed isolated in a Worker by the client)
 *
 * Build-time plugins shipped with the application live in `<project>/plugins` and are read
 * directly. The manager validates the manifest, resolves the dependency graph (missing
 * dependencies and cycles are real errors), keeps the enabled/disabled state in
 * `data/meta/plugins.json` and hands the entry source to the renderer, which runs it inside a
 * sandboxed Worker with only the permissions the manifest declares.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { ErrorCode, ErrorKind } from '../../shared/constants.js';
import { AppError, errors, safeJsonParse, toAppError } from '../../shared/errors.js';
import { expectString, expectStringArray, isPlainObject } from '../../shared/protocol.js';

const STATE_FILE = 'meta/plugins.json';
const SUPPORTED_API_VERSIONS = [1];
const KNOWN_PERMISSIONS = [
  'editor:read',
  'editor:write',
  'console:write',
  'console:read',
  'script:read',
  'script:write',
  'commands:register',
  'notifications',
  'settings:read',
  'settings:write',
  'storage',
  'snippets',
  'themes',
  'statusbar',
];
const ACTIVATION_EVENTS = ['onStartup', 'onCommand', 'onScriptOpen', 'onScriptSave', 'onExecutionFinished', 'onViewChange'];

export class PluginManager {
  #plugins = new Map();
  #state = { enabled: {}, disabled: {} };
  #errors = [];

  constructor({ storage, logger, errorHandler, bus, builtinDir = null }) {
    this.storage = storage;
    this.logger = logger;
    this.errorHandler = errorHandler;
    this.bus = bus;
    this.builtinDir = builtinDir;
  }

  async load() {
    const persisted = await this.storage.readJson(STATE_FILE, { fallback: { version: 1, enabled: {}, disabled: {} } });
    this.#state = {
      enabled: isPlainObject(persisted.value?.enabled) ? persisted.value.enabled : {},
      disabled: isPlainObject(persisted.value?.disabled) ? persisted.value.disabled : {},
    };

    this.#plugins.clear();
    this.#errors = [];

    const roots = [];
    if (this.builtinDir) roots.push({ dir: this.builtinDir, source: 'builtin' });
    roots.push({ dir: this.storage.dirs.plugins, source: 'user' });

    for (const root of roots) {
      const found = await this.#discover(root);
      for (const plugin of found) {
        if (this.#plugins.has(plugin.id)) {
          this.#errors.push({
            pluginId: plugin.id,
            code: ErrorCode.ALREADY_EXISTS,
            message: `El plugin "${plugin.id}" (${plugin.source}) entra en conflicto con otro ya cargado desde ${this.#plugins.get(plugin.id).source}`,
            directory: plugin.directory,
          });
          continue;
        }
        this.#plugins.set(plugin.id, plugin);
      }
    }

    this.#resolveDependencies();
    this.bus.emit('plugins:loaded', { count: this.#plugins.size, errors: this.#errors.length });
    this.logger.info(`Plugins detectados: ${this.#plugins.size}${this.#errors.length > 0 ? ` (${this.#errors.length} con problemas)` : ''}`, {
      source: 'PluginManager',
    });
    return { count: this.#plugins.size, errors: this.#errors };
  }

  /** Reads every candidate directory and validates its manifest. */
  async #discover(root) {
    const results = [];
    let entries;
    try {
      entries = await fsp.readdir(root.dir, { withFileTypes: true });
    } catch (err) {
      if (err.code !== 'ENOENT') {
        this.errorHandler.report(toAppError(err, {
          kind: ErrorKind.PLUGIN,
          message: `No se pudo leer el directorio de plugins ${root.dir}`,
          detail: { directory: root.dir },
        }), { source: 'PluginManager.discover' });
      }
      return results;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(root.dir, entry.name);
      const manifestPath = path.join(directory, 'plugin.json');
      const raw = await fsp.readFile(manifestPath, 'utf8').catch(() => null);
      if (raw === null) {
        this.#errors.push({
          pluginId: entry.name,
          code: ErrorCode.PLUGIN_INVALID,
          message: `El directorio ${entry.name} no contiene plugin.json`,
          directory,
        });
        continue;
      }
      const parsed = safeJsonParse(raw, `plugin.json de ${entry.name}`);
      if (!parsed.ok) {
        this.#errors.push({ pluginId: entry.name, code: ErrorCode.CORRUPT_DATA, message: parsed.error.message, directory });
        continue;
      }
      try {
        const manifest = validateManifest(parsed.value, { directory });
        const entryPath = path.join(directory, manifest.entry);
        const entryStat = await fsp.stat(entryPath).catch(() => null);
        if (!entryStat?.isFile()) {
          throw new AppError({
            message: `El punto de entrada "${manifest.entry}" no existe en ${entry.name}`,
            code: ErrorCode.PLUGIN_INVALID,
            kind: ErrorKind.PLUGIN,
            detail: { directory, entry: manifest.entry },
          });
        }
        const source = await fsp.readFile(entryPath, 'utf8');
        const stat = await fsp.stat(directory);
        results.push({
          ...manifest,
          source: root.source,
          directory,
          entryPath,
          entrySource: source,
          entryBytes: Buffer.byteLength(source, 'utf8'),
          directoryName: entry.name,
          installedAt: stat.birthtimeMs || stat.ctimeMs,
          modifiedAt: stat.mtimeMs,
          error: null,
        });
      } catch (err) {
        const appError = err instanceof AppError ? err : toAppError(err, { kind: ErrorKind.PLUGIN });
        this.#errors.push({
          pluginId: entry.name,
          code: appError.code,
          message: appError.message,
          directory,
          detail: appError.detail,
        });
        this.errorHandler.report(appError, { source: 'PluginManager.discover', silent: true });
      }
    }
    return results;
  }

  /** Real dependency resolution: missing dependencies and cycles are reported, not ignored. */
  #resolveDependencies() {
    for (const plugin of this.#plugins.values()) {
      const missing = plugin.dependencies.filter((dependency) => !this.#plugins.has(dependency));
      const enabledDependencyProblems = [];
      for (const dependency of plugin.dependencies) {
        const target = this.#plugins.get(dependency);
        if (target && this.isDisabled(dependency)) {
          enabledDependencyProblems.push(`La dependencia "${dependency}" está desactivada`);
        }
      }
      plugin.resolution = {
        missing,
        disabledDependencies: enabledDependencyProblems,
        resolvable: missing.length === 0,
      };
      if (missing.length > 0) {
        plugin.error = {
          code: ErrorCode.PLUGIN_DEPENDENCY,
          message: `Faltan dependencias: ${missing.join(', ')}`,
        };
      } else if (enabledDependencyProblems.length > 0) {
        plugin.error = {
          code: ErrorCode.PLUGIN_DEPENDENCY,
          message: enabledDependencyProblems.join('; '),
        };
      } else {
        plugin.error = null;
      }
    }

    // Cycle detection over the (fully resolved) graph.
    const visiting = new Set();
    const visited = new Set();
    const cycles = [];
    const visit = (id, stack) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        cycles.push([...stack.slice(stack.indexOf(id)), id]);
        return;
      }
      visiting.add(id);
      const plugin = this.#plugins.get(id);
      for (const dependency of plugin?.dependencies ?? []) {
        if (this.#plugins.has(dependency)) visit(dependency, [...stack, id]);
      }
      visiting.delete(id);
      visited.add(id);
    };
    for (const id of this.#plugins.keys()) visit(id, [id]);
    for (const cycle of cycles) {
      for (const id of cycle) {
        const plugin = this.#plugins.get(id);
        if (!plugin) continue;
        plugin.error = { code: ErrorCode.PLUGIN_CYCLE, message: `Dependencia circular: ${cycle.join(' → ')}` };
        plugin.resolution.resolvable = false;
      }
    }
    return cycles;
  }

  /* ---------------------------------------------------------------- *
   * Queries
   * ---------------------------------------------------------------- */

  /** Full plugin list with resolution state and enablement. */
  list() {
    return [...this.#plugins.values()]
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
      .map((plugin) => this.#decorate(plugin));
  }

  get(id) {
    const plugin = this.#plugins.get(id);
    return plugin ? this.#decorate(plugin) : null;
  }

  /** Plugin entry point payload for the sandboxed client host. */
  async getEntry(id) {
    const plugin = this.#plugins.get(requirePluginId(id));
    if (!plugin) throw errors.notFound(`El plugin "${id}"`, { pluginId: id, kind: ErrorKind.PLUGIN });
    if (!plugin.resolution.resolvable) {
      throw new AppError({
        message: `El plugin "${id}" no puede activarse: ${plugin.error?.message ?? 'dependencias sin resolver'}`,
        code: plugin.error?.code ?? ErrorCode.PLUGIN_DEPENDENCY,
        kind: ErrorKind.PLUGIN,
        detail: { pluginId: id, dependencies: plugin.dependencies },
      });
    }
    return {
      id: plugin.id,
      manifest: this.#manifestOf(plugin),
      source: plugin.entrySource,
      directory: plugin.directory,
    };
  }

  isDisabled(id) {
    return this.#state.disabled[id] === true;
  }

  isEnabled(id) {
    if (this.#state.disabled[id] === true) return false;
    if (this.#state.enabled[id] !== undefined) return this.#state.enabled[id] === true;
    const plugin = this.#plugins.get(id);
    // Default: enabled when the manifest says so and the dependencies resolve.
    return Boolean(plugin) && plugin.enabledByDefault !== false && plugin.resolution?.resolvable === true;
  }

  async setEnabled(id, enabled) {
    const plugin = this.#plugins.get(requirePluginId(id));
    if (!plugin) throw errors.notFound(`El plugin "${id}"`, { pluginId: id, kind: ErrorKind.PLUGIN });
    if (enabled && !plugin.resolution.resolvable) {
      throw new AppError({
        message: `No se puede activar "${id}": ${plugin.error?.message ?? 'dependencias sin resolver'}`,
        code: ErrorCode.PLUGIN_DEPENDENCY,
        kind: ErrorKind.PLUGIN,
        detail: { pluginId: id, resolution: plugin.resolution },
      });
    }
    if (enabled) delete this.#state.disabled[id];
    else this.#state.disabled[id] = true;
    this.#state.enabled[id] = enabled;
    await this.#persist();
    // Enabling/disabling a plugin can change the resolution of others.
    this.#resolveDependencies();
    this.bus.emit('plugins:changed', { reason: enabled ? 'enable' : 'disable', id });
    return this.get(id);
  }

  /** Reloads a single plugin from disk (used after editing its files). */
  async reload(id) {
    const plugin = this.#plugins.get(requirePluginId(id));
    if (!plugin) throw errors.notFound(`El plugin "${id}"`, { pluginId: id, kind: ErrorKind.PLUGIN });
    const root = plugin.source === 'builtin' && this.builtinDir
      ? { dir: this.builtinDir, source: 'builtin' }
      : { dir: this.storage.dirs.plugins, source: 'user' };
    const found = await this.#discover(root);
    const refreshed = found.find((entry) => entry.id === id);
    if (!refreshed) {
      throw new AppError({
        message: `El plugin "${id}" ya no existe en el disco`,
        code: ErrorCode.NOT_FOUND,
        kind: ErrorKind.PLUGIN,
        detail: { pluginId: id, directory: plugin.directory },
      });
    }
    this.#plugins.set(id, refreshed);
    this.#resolveDependencies();
    this.bus.emit('plugins:changed', { reason: 'reload', id });
    return this.get(id);
  }

  /** Scans for new directories (installed manually or by an external process). */
  async rescan() {
    const before = new Set(this.#plugins.keys());
    await this.load();
    const after = new Set(this.#plugins.keys());
    const added = [...after].filter((id) => !before.has(id));
    const removed = [...before].filter((id) => !after.has(id));
    this.bus.emit('plugins:changed', { reason: 'rescan', added, removed });
    return { added, removed, total: this.#plugins.size, errors: this.#errors };
  }

  /**
   * Installs a plugin from a JSON payload produced by the UI
   * (`{ id, files: { 'plugin.json': '...', 'index.js': '...' } }`) or from a single-file manifest.
   */
  async install({ id, name = null, files, source = null }) {
    const targetId = requirePluginId(id ?? name ?? '');
    const directory = this.storage.resolveSafe(path.join(this.storage.dirs.plugins, targetId));
    const payload = files && isPlainObject(files) ? files : null;
    if (!payload || Object.keys(payload).length === 0) {
      throw new AppError({
        message: 'La instalación necesita al menos los archivos del plugin (plugin.json e índice)',
        code: ErrorCode.INVALID_ARGUMENT,
        kind: ErrorKind.PLUGIN,
        detail: { pluginId: targetId },
      });
    }
    await fsp.mkdir(directory, { recursive: true });
    const written = [];
    for (const [relative, content] of Object.entries(payload)) {
      if (typeof content !== 'string') continue;
      if (relative.includes('..') || path.isAbsolute(relative)) {
        throw errors.unsafePath(`El archivo "${relative}" del plugin apunta fuera de su directorio`, { pluginId: targetId, file: relative });
      }
      const target = path.join(directory, relative);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, content, 'utf8');
      written.push(relative);
    }
    const manifest = JSON.parse(payload['plugin.json'] ?? '{}');
    if (!manifest.id) {
      manifest.id = targetId;
      await fsp.writeFile(path.join(directory, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf8');
    }
    await this.rescan();
    void source;
    this.logger.success(`Plugin instalado: ${targetId}`, { source: 'PluginManager', data: { written } });
    return { plugin: this.get(targetId), written };
  }

  /** Uninstalls a user plugin (moves it to the trash, never destroys it silently). */
  async uninstall(id) {
    const plugin = this.#plugins.get(requirePluginId(id));
    if (!plugin) throw errors.notFound(`El plugin "${id}"`, { pluginId: id, kind: ErrorKind.PLUGIN });
    if (plugin.source === 'builtin') {
      throw new AppError({
        message: `El plugin "${id}" viene incluido con la aplicación y no se puede desinstalar (solo desactivar)`,
        code: ErrorCode.FORBIDDEN,
        kind: ErrorKind.PLUGIN,
        detail: { pluginId: id, source: plugin.source },
      });
    }
    const relative = path.relative(this.storage.root, plugin.directory);
    await this.storage.remove(relative, { soft: true });
    this.#plugins.delete(id);
    delete this.#state.enabled[id];
    delete this.#state.disabled[id];
    await this.#persist();
    this.#resolveDependencies();
    this.bus.emit('plugins:changed', { reason: 'uninstall', id });
    return { ok: true, id, trashed: true };
  }

  /** Records an error thrown by a plugin at runtime (client reports it here). */
  reportError(id, error, { phase = 'runtime' } = {}) {
    const plugin = this.#plugins.get(id);
    const message = typeof error === 'string' ? error : error?.message ?? 'Error desconocido';
    const record = {
      pluginId: id,
      code: ErrorCode.PLUGIN_FAILED,
      message,
      phase,
      timestamp: Date.now(),
      stack: error?.stack ?? null,
    };
    this.#errors.push(record);
    if (plugin) plugin.lastError = record;
    this.errorHandler.report(new AppError({
      message: `Plugin "${id}" falló en ${phase}: ${message}`,
      code: ErrorCode.PLUGIN_FAILED,
      kind: ErrorKind.PLUGIN,
      detail: { pluginId: id, phase, stack: error?.stack ?? null },
    }), { source: 'PluginManager' });
    this.bus.emit('plugins:changed', { reason: 'error', id, record });
    return record;
  }

  /** Errors found while discovering/validating plugins. */
  discoveryErrors() {
    return [...this.#errors];
  }

  stats() {
    const plugins = [...this.#plugins.values()];
    return {
      total: plugins.length,
      enabled: plugins.filter((plugin) => this.isEnabled(plugin.id) && plugin.resolution?.resolvable).length,
      disabled: plugins.filter((plugin) => !this.isEnabled(plugin.id)).length,
      broken: plugins.filter((plugin) => plugin.error !== null).length,
      builtin: plugins.filter((plugin) => plugin.source === 'builtin').length,
      user: plugins.filter((plugin) => plugin.source === 'user').length,
      discoveryErrors: this.#errors.length,
      permissions: [...new Set(plugins.flatMap((plugin) => plugin.permissions))].sort(),
    };
  }

  /* ---------------------------------------------------------------- *
   * Internals
   * ---------------------------------------------------------------- */

  #manifestOf(plugin) {
    return {
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      author: plugin.author,
      description: plugin.description,
      apiVersion: plugin.apiVersion,
      entry: plugin.entry,
      dependencies: [...plugin.dependencies],
      permissions: [...plugin.permissions],
      activationEvents: [...plugin.activationEvents],
      contributes: plugin.contributes,
      homepage: plugin.homepage,
    };
  }

  #decorate(plugin) {
    return {
      ...this.#manifestOf(plugin),
      source: plugin.source,
      directory: plugin.directory,
      entryBytes: plugin.entryBytes,
      installedAt: plugin.installedAt,
      modifiedAt: plugin.modifiedAt,
      enabled: this.isEnabled(plugin.id),
      resolution: plugin.resolution,
      error: plugin.error,
      lastError: plugin.lastError ?? null,
      canUninstall: plugin.source === 'user',
      canDisable: true,
      requires: [...plugin.permissions],
    };
  }

  async #persist() {
    try {
      await this.storage.writeJson(STATE_FILE, { version: 1, updatedAt: Date.now(), ...this.#state });
      return { ok: true };
    } catch (err) {
      const appError = toAppError(err, { kind: ErrorKind.PLUGIN, message: 'No se pudo guardar el estado de los plugins' });
      this.errorHandler.report(appError, { source: 'PluginManager.persist' });
      throw appError;
    }
  }
}

/* ------------------------------------------------------------------ *
 * Manifest validation
 * ------------------------------------------------------------------ */

export function validateManifest(input, { directory = null } = {}) {
  if (!isPlainObject(input)) {
    throw new AppError({
      message: 'plugin.json debe contener un objeto',
      code: ErrorCode.PLUGIN_INVALID,
      kind: ErrorKind.PLUGIN,
      detail: { directory },
    });
  }
  const problems = [];
  const id = typeof input.id === 'string' && /^[a-z0-9][a-z0-9-]{1,47}$/.test(input.id) ? input.id : null;
  if (!id) problems.push('id: minúsculas, números y guiones (2-48 caracteres)');
  const name = typeof input.name === 'string' && input.name.trim() !== '' ? input.name.trim().slice(0, 80) : null;
  if (!name) problems.push('name: obligatorio');
  const version = typeof input.version === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(input.version) ? input.version : null;
  if (!version) problems.push('version: formato semver obligatorio (p. ej. 1.0.0)');
  const entry = typeof input.entry === 'string' && input.entry.trim() !== '' ? input.entry.trim() : 'index.js';
  if (entry.includes('..') || path.isAbsolute(entry)) problems.push('entry: debe ser una ruta relativa dentro del plugin');
  const apiVersion = Number.isInteger(input.apiVersion) ? input.apiVersion : 1;
  if (!SUPPORTED_API_VERSIONS.includes(apiVersion)) problems.push(`apiVersion: esta versión de la aplicación soporta ${SUPPORTED_API_VERSIONS.join(', ')}`);

  let dependencies = [];
  if (input.dependencies !== undefined) {
    try {
      dependencies = expectStringArray(input.dependencies, 'dependencies');
    } catch (err) {
      problems.push(`dependencies: ${err.message}`);
    }
  }
  let permissions = [];
  if (input.permissions !== undefined) {
    try {
      permissions = expectStringArray(input.permissions, 'permissions');
    } catch (err) {
      problems.push(`permissions: ${err.message}`);
    }
    const unknown = permissions.filter((permission) => !KNOWN_PERMISSIONS.includes(permission));
    if (unknown.length > 0) problems.push(`permissions desconocidos: ${unknown.join(', ')}`);
  }
  let activationEvents = [];
  if (input.activationEvents !== undefined) {
    try {
      activationEvents = expectStringArray(input.activationEvents, 'activationEvents');
    } catch (err) {
      problems.push(`activationEvents: ${err.message}`);
    }
    const unknown = activationEvents.filter((event) => !ACTIVATION_EVENTS.includes(event) && !event.startsWith('onCommand:'));
    if (unknown.length > 0) problems.push(`activationEvents desconocidos: ${unknown.join(', ')}`);
  }

  if (problems.length > 0) {
    throw new AppError({
      message: `Manifiesto inválido: ${problems.join(' | ')}`,
      code: ErrorCode.PLUGIN_INVALID,
      kind: ErrorKind.PLUGIN,
      detail: { directory, problems },
    });
  }

  return {
    id,
    name,
    version,
    entry,
    apiVersion,
    author: typeof input.author === 'string' ? input.author.slice(0, 80) : 'Desconocido',
    description: typeof input.description === 'string' ? input.description.slice(0, 400) : '',
    homepage: typeof input.homepage === 'string' ? input.homepage.slice(0, 200) : null,
    dependencies,
    permissions,
    activationEvents: activationEvents.length > 0 ? activationEvents : ['onStartup'],
    enabledByDefault: input.enabledByDefault !== false,
    contributes: validateContributions(input.contributes ?? {}),
  };
}

/** Validates the `contributes` section (commands, snippets, themes, settings, keybindings). */
function validateContributions(input) {
  const output = { commands: [], snippets: [], themes: [], settings: [], keybindings: [], statusBar: [] };
  if (!isPlainObject(input)) return output;

  if (Array.isArray(input.commands)) {
    for (const command of input.commands) {
      if (!isPlainObject(command) || typeof command.id !== 'string') continue;
      output.commands.push({
        id: `plugin.${command.id}`,
        title: typeof command.title === 'string' ? command.title.slice(0, 80) : command.id,
        category: typeof command.category === 'string' ? command.category : 'Plugin',
        description: typeof command.description === 'string' ? command.description.slice(0, 240) : '',
        keybinding: typeof command.keybinding === 'string' ? command.keybinding.slice(0, 40) : null,
      });
    }
  }
  if (Array.isArray(input.snippets)) {
    for (const snippet of input.snippets) {
      if (!isPlainObject(snippet) || typeof snippet.prefix !== 'string' || typeof snippet.body !== 'string') continue;
      output.snippets.push({
        prefix: snippet.prefix.slice(0, 40),
        body: snippet.body.slice(0, 4000),
        description: typeof snippet.description === 'string' ? snippet.description.slice(0, 200) : '',
      });
    }
  }
  if (Array.isArray(input.themes)) {
    for (const theme of input.themes) {
      if (!isPlainObject(theme) || typeof theme.id !== 'string' || !isPlainObject(theme.tokens)) continue;
      output.themes.push({ id: theme.id, name: theme.name ?? theme.id, type: theme.type === 'light' ? 'light' : 'dark', tokens: theme.tokens });
    }
  }
  if (Array.isArray(input.settings)) {
    for (const setting of input.settings) {
      if (!isPlainObject(setting) || typeof setting.key !== 'string') continue;
      output.settings.push({
        key: `plugin.${setting.key}`,
        label: typeof setting.label === 'string' ? setting.label.slice(0, 80) : setting.key,
        description: typeof setting.description === 'string' ? setting.description.slice(0, 240) : '',
        type: ['boolean', 'number', 'string'].includes(setting.type) ? setting.type : 'string',
        default: setting.default ?? '',
      });
    }
  }
  if (Array.isArray(input.keybindings)) {
    for (const binding of input.keybindings) {
      if (!isPlainObject(binding) || typeof binding.command !== 'string' || typeof binding.key !== 'string') continue;
      output.keybindings.push({ command: `plugin.${binding.command}`, key: binding.key.slice(0, 40) });
    }
  }
  if (Array.isArray(input.statusBar)) {
    for (const item of input.statusBar) {
      if (!isPlainObject(item) || typeof item.id !== 'string') continue;
      output.statusBar.push({
        id: item.id,
        text: typeof item.text === 'string' ? item.text.slice(0, 40) : item.id,
        tooltip: typeof item.tooltip === 'string' ? item.tooltip.slice(0, 200) : '',
        command: typeof item.command === 'string' ? `plugin.${item.command}` : null,
      });
    }
  }
  return output;
}

function requirePluginId(value) {
  try {
    return expectString(value, 'pluginId', { min: 1, max: 64, allowEmpty: false });
  } catch (err) {
    throw new AppError({
      message: err.message,
      code: ErrorCode.INVALID_ARGUMENT,
      kind: ErrorKind.PLUGIN,
      detail: { received: value },
    });
  }
}

export const PLUGIN_API = Object.freeze({
  apiVersions: SUPPORTED_API_VERSIONS,
  permissions: KNOWN_PERMISSIONS,
  activationEvents: ACTIVATION_EVENTS,
});
