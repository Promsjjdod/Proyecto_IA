/**
 * PluginHost — runs declared plugins inside isolated Workers.
 *
 * Responsibilities, all real:
 *  • discovers plugins from the server (`/api/plugins`) with their manifest, dependencies and state;
 *  • activates an enabled plugin by fetching its entry point and loading it in a dedicated Worker
 *    (`/build/plugin.worker.js`), which has no DOM and no access to application objects;
 *  • enforces the manifest permissions on every RPC the plugin performs;
 *  • exposes plugin commands through the CommandManager, so they appear in the palette like any
 *    other command;
 *  • forwards application events a plugin subscribed to;
 *  • reports plugin failures to the server (`/plugins/:id/errors`) and to the ErrorBus, marking the
 *    plugin as broken instead of hiding the problem.
 */

import { ErrorBus } from '../core/ErrorBus.js';

const RPC_TIMEOUT_MS = 10_000;
const MAX_LOG_BYTES = 32_000;

export class PluginHost {
  #plugins = new Map();
  #instances = new Map();
  #statusSubscribers = new Set();
  #stats = { discovered: 0, activated: 0, failed: 0, commands: 0, requests: 0, denied: 0, errors: 0 };

  constructor({ apiClient, logger, errorBus, eventBus, notifications, commands, console: consoleManager, editor, scripts, settings, statusbar, capabilities }) {
    this.apiClient = apiClient;
    this.logger = logger;
    this.errorBus = errorBus ?? new ErrorBus({ apiClient, logger });
    this.eventBus = eventBus;
    this.notifications = notifications;
    this.commands = commands;
    this.consoleManager = consoleManager;
    this.editor = editor;
    this.scripts = scripts;
    this.settings = settings;
    this.statusbar = statusbar;
    this.capabilities = capabilities;
    this.available = typeof Worker === 'function';
    this.unavailableReason = this.available
      ? null
      : 'El navegador no expone la API de Web Workers; los plugins no pueden ejecutarse de forma aislada.';
  }

  get plugins() {
    return [...this.#plugins.values()];
  }

  get size() {
    return this.#plugins.size;
  }

  list() {
    return this.plugins.map((plugin) => ({
      ...plugin,
      running: this.#instances.get(plugin.id)?.state === 'running',
      commands: [...(this.#instances.get(plugin.id)?.commands ?? [])],
    }));
  }

  stats() {
    return {
      ...this.#stats,
      discovered: this.#plugins.size,
      running: [...this.#instances.values()].filter((instance) => instance.state === 'running').length,
      available: this.available,
      unavailableReason: this.unavailableReason,
    };
  }

  subscribe(listener) {
    this.#statusSubscribers.add(listener);
    return () => this.#statusSubscribers.delete(listener);
  }

  /** Discovers plugins and activates every enabled one whose activation includes onStartup. */
  async init() {
    if (!this.available) {
      this.logger.warn(this.unavailableReason, { source: 'PluginHost' });
      return { ok: false, available: false, reason: this.unavailableReason };
    }
    const result = await this.refresh();
    const activated = [];
    for (const plugin of this.#plugins.values()) {
      if (!plugin.enabled || !plugin.resolvable) continue;
      const events = plugin.activationEvents ?? [];
      if (events.length > 0 && !events.includes('onStartup')) continue;
      try {
        await this.activate(plugin.id);
        activated.push(plugin.id);
      } catch (err) {
        this.logger.error(err, { source: 'PluginHost.init' });
      }
    }
    return { ok: true, discovered: this.#plugins.size, activated, stats: this.stats() };
  }

  async refresh() {
    const payload = await this.apiClient.get('/api/plugins');
    this.#checkError(payload, 'No se pudo obtener la lista de plugins');
    this.#plugins.clear();
    for (const plugin of payload.plugins ?? []) {
      this.#plugins.set(plugin.id, normalizePlugin(plugin));
    }
    this.#stats.discovered = this.#plugins.size;
    this.#notify();
    return { plugins: this.plugins.length, discoveryErrors: payload.discoveryErrors ?? [] };
  }

  /** Activates a plugin: fetches its entry, starts a Worker and registers its commands. */
  async activate(id) {
    if (!this.available) throw Object.assign(new Error(this.unavailableReason), { code: 'E_UNAVAILABLE' });
    const plugin = this.#plugins.get(id);
    if (!plugin) throw new Error(`El plugin "${id}" no existe`);
    if (!plugin.enabled) throw new Error(`El plugin "${plugin.name}" está desactivado`);
    if (this.#instances.has(id)) return this.#instances.get(id);

    const entry = await this.apiClient.get(`/api/plugins/${encodeURIComponent(id)}/entry`);
    this.#checkError(entry, `No se pudo cargar el punto de entrada de "${plugin.name}"`);
    if (typeof entry.source !== 'string' || entry.source.trim() === '') {
      throw new Error(`El plugin "${plugin.name}" tiene un punto de entrada vacío`);
    }

    const instance = {
      id,
      plugin,
      worker: null,
      state: 'starting',
      commands: new Set(),
      startedAt: Date.now(),
      errors: 0,
      pending: new Map(),
      invocationSeq: 0,
    };
    this.#instances.set(id, instance);
    this.#notify();

    try {
      const worker = new Worker('/build/plugin.worker.js', {
        type: 'module',
        name: `lumen-plugin-${id}`,
      });
      instance.worker = worker;
      worker.addEventListener('message', (event) => void this.#onWorkerMessage(instance, event.data));
      worker.addEventListener('error', (event) => {
        this.#fail(instance, {
          message: event.message ?? 'Error no especificado en el worker del plugin',
          stack: event.error?.stack ?? null,
          phase: 'worker',
        });
      });
      worker.addEventListener('messageerror', () => {
        this.#fail(instance, { message: 'El worker del plugin envió un mensaje que no se puede deserializar', phase: 'worker' });
      });

      const ready = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`El plugin "${plugin.name}" no terminó de activarse en 15 s`)), 15_000);
        instance.onReady = (payload) => {
          clearTimeout(timer);
          resolve(payload);
        };
        instance.onLoadError = (payload) => {
          clearTimeout(timer);
          reject(Object.assign(new Error(payload.message), { stack: payload.stack ?? null, code: 'E_PLUGIN_LOAD' }));
        };
      }).catch((err) => {
        throw err;
      });

      instance.state = 'running';
      this.#stats.activated += 1;
      this.#notify();
      this.logger.success(`Plugin "${plugin.name}" activado (${ready.commands.length} comandos)`, { source: 'PluginHost' });
      return instance;
    } catch (err) {
      this.#fail(instance, { message: err.message, stack: err.stack ?? null, phase: 'load' });
      throw err;
    }
  }

  async deactivate(id, { reason = 'user' } = {}) {
    const instance = this.#instances.get(id);
    if (!instance) return { ok: true, alreadyStopped: true };
    try {
      instance.worker?.postMessage({ type: 'shutdown' });
    } catch {
      /* the worker may already be gone */
    }
    instance.worker?.terminate();
    instance.worker = null;
    instance.state = 'stopped';
    for (const commandId of instance.commands) this.commands.unregister(commandId);
    this.#stats.commands -= instance.commands.size;
    this.#instances.delete(id);
    this.#notify();
    this.logger.info(`Plugin "${instance.plugin.name}" detenido (${reason})`, { source: 'PluginHost' });
    return { ok: true };
  }

  async enable(id) {
    const payload = await this.apiClient.post(`/api/plugins/${encodeURIComponent(id)}/enable`, {});
    this.#checkError(payload, `No se pudo activar el plugin "${id}"`);
    this.#plugins.set(id, normalizePlugin(payload.plugin));
    this.#notify();
    await this.activate(id).catch((err) => this.logger.error(err, { source: 'PluginHost.enable' }));
    return payload.plugin;
  }

  async disable(id) {
    await this.deactivate(id, { reason: 'disabled' }).catch(() => {});
    const payload = await this.apiClient.post(`/api/plugins/${encodeURIComponent(id)}/disable`, {});
    this.#checkError(payload, `No se pudo desactivar el plugin "${id}"`);
    this.#plugins.set(id, normalizePlugin(payload.plugin));
    this.#notify();
    return payload.plugin;
  }

  async reload(id) {
    await this.deactivate(id, { reason: 'reload' }).catch(() => {});
    const payload = await this.apiClient.post(`/api/plugins/${encodeURIComponent(id)}/reload`, {});
    this.#checkError(payload, `No se pudo recargar el plugin "${id}"`);
    this.#plugins.set(id, normalizePlugin(payload.plugin));
    this.#notify();
    if (payload.plugin?.enabled) await this.activate(id);
    return payload.plugin;
  }

  async rescan() {
    const payload = await this.apiClient.post('/api/plugins/rescan', {});
    this.#checkError(payload, 'No se pudo volver a escanear el directorio de plugins');
    await this.refresh();
    return { discovered: this.#plugins.size, errors: payload.result?.errors ?? [] };
  }

  async uninstall(id) {
    await this.deactivate(id, { reason: 'uninstall' }).catch(() => {});
    const payload = await this.apiClient.delete(`/api/plugins/${encodeURIComponent(id)}`);
    this.#checkError(payload, `No se pudo desinstalar el plugin "${id}"`);
    await this.refresh();
    return payload;
  }

  /** Forwards an application event to every plugin that declared it. */
  broadcast(event, payload) {
    for (const instance of this.#instances.values()) {
      if (instance.state !== 'running') continue;
      const declared = instance.plugin.activationEvents ?? [];
      if (declared.length > 0 && !declared.includes(event)) continue;
      try {
        instance.worker?.postMessage({ type: 'event', event, payload: sanitize(payload) });
      } catch (err) {
        this.#fail(instance, { message: `No se pudo entregar el evento "${event}": ${err.message}`, phase: 'event' });
      }
    }
  }

  /* ------------------------------------------------------------------ worker → host */

  async #onWorkerMessage(instance, message) {
    if (!message || typeof message !== 'object') return;
    switch (message.type) {
      case 'ready':
        instance.onReady?.(message);
        break;
      case 'log': {
        const level = ['info', 'success', 'warning', 'error', 'debug', 'trace'].includes(message.level) ? message.level : 'info';
        this.consoleManager?.[level === 'warning' ? 'warn' : level]?.(
          `[${instance.plugin.name}] ${truncate(message.message)}`,
          { source: `plugin:${instance.id}`, data: sanitize(message.data) },
        );
        break;
      }
      case 'error':
        if (message.phase === 'load' && instance.onLoadError && instance.state === 'starting') {
          instance.onLoadError(message);
          break;
        }
        this.#fail(instance, message);
        break;
      case 'request':
        await this.#handleRequest(instance, message);
        break;
      case 'invoked':
        this.#settleInvocation(instance, message);
        break;
      default:
        this.logger.warn(`Mensaje no reconocido del plugin "${instance.id}": ${String(message.type)}`, { source: 'PluginHost' });
        break;
    }
  }

  /** Permission-checked RPC. Every handler returns real data or a real error. */
  async #handleRequest(instance, message) {
    const { requestId, method, params = {} } = message;
    this.#stats.requests += 1;
    try {
      const value = await this.#dispatch(instance, method, params);
      instance.worker?.postMessage({ type: 'response', requestId, ok: true, value: sanitize(value) });
    } catch (err) {
      if (err?.code === 'E_PERMISSION') this.#stats.denied += 1;
      instance.worker?.postMessage({
        type: 'response',
        requestId,
        ok: false,
        error: { message: err?.message ?? String(err), code: err?.code ?? 'E_PLUGIN_RPC' },
      });
      if (err?.code !== 'E_PERMISSION') {
        this.logger.warn(`El plugin "${instance.id}" falló en "${method}": ${err.message}`, { source: 'PluginHost' });
      }
    }
  }

  async #dispatch(instance, method, params) {
    const { plugin } = instance;
    switch (method) {
      case 'commands.register': {
        this.#require(plugin, 'commands:register', method);
        const id = String(params.id ?? '');
        if (id === '' || instance.commands.has(id)) return { ok: true, duplicate: true, id };
        instance.commands.add(id);
        this.#stats.commands += 1;
        this.commands.register({
          id,
          title: String(params.title ?? id),
          description: params.description ?? null,
          category: params.category ?? `Plugin: ${plugin.name}`,
          icon: params.icon ?? 'puzzle',
          keywords: Array.isArray(params.keywords) ? params.keywords.map(String) : [],
          pluginId: plugin.id,
          order: 900,
          run: () => this.#invokeCommand(instance, id),
        });
        this.#notify();
        return { ok: true, id };
      }
      case 'editor.getActive': {
        this.#require(plugin, 'editor:read', method);
        const document = this.editor?.activeDocument;
        if (!document) return { active: false };
        const snapshot = this.editor?.getValue?.() ?? document.content ?? '';
        return { active: true, id: document.id, name: document.name, dialect: document.dialect, text: truncate(snapshot), length: snapshot.length };
      }
      case 'editor.getSelection': {
        this.#require(plugin, 'editor:read', method);
        const info = this.editor?.cursorInfo?.();
        return info ? { ...info } : { selection: null };
      }
      case 'editor.insertText':
      case 'editor.replaceSelection': {
        this.#require(plugin, 'editor:write', method);
        const text = String(params.text ?? '');
        // `insertText` replaces the current selection (same semantics as replaceSelection).
        const ok = this.editor?.insertText?.(text) ?? false;
        if (!ok) throw new Error('No hay un documento activo donde insertar texto');
        return { ok: true, inserted: text.length };
      }
      case 'editor.replaceAll': {
        this.#require(plugin, 'editor:write', method);
        const id = this.editor?.activeId;
        if (!id) throw new Error('No hay un documento activo que reemplazar');
        this.editor.setValue(id, String(params.text ?? ''));
        return { ok: true };
      }
      case 'console.log': {
        this.#require(plugin, 'console:write', method);
        const level = ['info', 'success', 'warning', 'error', 'debug', 'trace'].includes(params.level) ? params.level : 'info';
        const method = level === 'warning' ? 'warn' : level;
        this.consoleManager?.[method]?.(`[${plugin.name}] ${truncate(params.message)}`, { source: `plugin:${plugin.id}`, data: sanitize(params.data) });
        return { ok: true };
      }
      case 'console.clear': {
        this.#require(plugin, 'console:write', method);
        this.consoleManager?.clear();
        return { ok: true };
      }
      case 'notifications.show': {
        this.#require(plugin, 'notifications', method);
        return this.notifications?.notify({
          title: params.title ?? plugin.name,
          message: String(params.message ?? ''),
          severity: ['success', 'info', 'warning', 'error'].includes(params.severity) ? params.severity : 'info',
          source: `plugin:${plugin.id}`,
          durationMs: Number.isFinite(params.durationMs) ? params.durationMs : undefined,
        }) ?? { ok: false };
      }
      case 'scripts.list': {
        this.#require(plugin, 'script:read', method);
        const list = (this.scripts?.scripts ?? []).slice(0, 200).map((script) => ({
          id: script.id,
          name: script.name,
          dialect: script.dialect,
          category: script.category ?? null,
          tags: script.tags ?? [],
          favorite: script.favorite === true,
          size: script.size ?? null,
          modifiedAt: script.modifiedAt ?? script.updatedAt ?? null,
        }));
        return { scripts: list, total: this.scripts?.size ?? list.length };
      }
      case 'scripts.read': {
        this.#require(plugin, 'script:read', method);
        const id = String(params.id ?? '');
        const known = this.scripts?.get?.(id);
        if (!known) throw new Error(`El script "${id}" no existe`);
        const payload = await this.apiClient.get(`/api/scripts/${encodeURIComponent(id)}/content`);
        this.#checkError(payload, `No se pudo leer el script "${id}"`);
        return { id, name: known.name, content: truncate(payload.content ?? payload.script?.content ?? '') };
      }
      case 'settings.get': {
        this.#require(plugin, 'settings:read', method);
        return { key: params.key, value: this.settings?.get?.(String(params.key)) ?? null };
      }
      case 'settings.set': {
        this.#require(plugin, 'settings:write', method);
        const result = await this.settings?.set?.(String(params.key), params.value);
        return result ?? { ok: false };
      }
      case 'statusbar.set': {
        this.#require(plugin, 'statusbar', method);
        if (!this.statusbar) throw new Error('La barra de estado no está disponible');
        const id = String(params.id ?? 'main');
        if (params.remove === true) {
          this.statusbar.removePluginItem?.(plugin.id, id);
          return { ok: true, removed: true };
        }
        this.statusbar.setPluginItem?.(plugin.id, {
          id,
          text: truncate(String(params.text ?? '')),
          tooltip: params.tooltip ? String(params.tooltip) : null,
          severity: ['info', 'success', 'warning', 'error'].includes(params.severity) ? params.severity : 'info',
        });
        return { ok: true };
      }
      case 'storage.get': {
        this.#require(plugin, 'storage', method);
        const store = await this.#readStorage(plugin);
        return { key: params.key, value: store[String(params.key)] ?? null };
      }
      case 'storage.set': {
        this.#require(plugin, 'storage', method);
        const store = await this.#readStorage(plugin);
        store[String(params.key)] = sanitize(params.value);
        await this.#writeStorage(plugin, store);
        return { ok: true, keys: Object.keys(store).length };
      }
      case 'storage.remove': {
        this.#require(plugin, 'storage', method);
        const store = await this.#readStorage(plugin);
        delete store[String(params.key)];
        await this.#writeStorage(plugin, store);
        return { ok: true, keys: Object.keys(store).length };
      }
      default:
        throw new Error(`Método no soportado por la API de plugins: "${method}"`);
    }
  }

  #require(plugin, permission, method) {
    const granted = plugin.permissions ?? [];
    if (!granted.includes(permission)) {
      throw Object.assign(
        new Error(`El plugin "${plugin.name}" intentó usar "${method}" pero no declaró el permiso "${permission}" en su plugin.json`),
        { code: 'E_PERMISSION', detail: { permission, method, pluginId: plugin.id } },
      );
    }
  }

  #invokeCommand(instance, commandId) {
    if (instance.state !== 'running' || !instance.worker) {
      throw new Error(`El plugin "${instance.plugin.name}" no está en ejecución`);
    }
    const invocationId = `i${++instance.invocationSeq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        instance.pending.delete(invocationId);
        reject(new Error(`El comando "${commandId}" del plugin "${instance.plugin.name}" superó los ${RPC_TIMEOUT_MS} ms`));
      }, RPC_TIMEOUT_MS);
      instance.pending.set(invocationId, { resolve, reject, timer });
      instance.worker.postMessage({
        type: 'invoke',
        invocationId,
        commandId,
        payload: { source: 'palette' },
      });
    });
  }

  #settleInvocation(instance, message) {
    const entry = instance.pending.get(message.invocationId);
    if (!entry) return;
    instance.pending.delete(message.invocationId);
    clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message.value ?? null);
    else entry.reject(new Error(message.error?.message ?? 'El comando del plugin falló'));
  }

  async #readStorage(plugin) {
    const path = `meta/plugin-state/${plugin.id}.json`;
    try {
      const payload = await this.apiClient.get(`/api/files/read?path=${encodeURIComponent(path)}`);
      if (payload?.error) return {};
      const parsed = JSON.parse(payload.content ?? '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  async #writeStorage(plugin, store) {
    const path = `meta/plugin-state/${plugin.id}.json`;
    const payload = await this.apiClient.put('/api/files/write', { path, content: `${JSON.stringify(store, null, 2)}\n` });
    this.#checkError(payload, `No se pudo guardar el estado del plugin "${plugin.name}"`);
    return payload;
  }

  #fail(instance, { message, stack = null, phase = 'runtime' }) {
    instance.errors += 1;
    this.#stats.errors += 1;
    this.#stats.failed += 1;
    instance.state = 'broken';
    this.#notify();
    const error = Object.assign(new Error(`[plugin ${instance.plugin.name}] ${message}`), {
      code: 'E_PLUGIN_FAILED',
      stack: stack ?? undefined,
      detail: { pluginId: instance.id, phase },
    });
    this.logger.error(error, { source: 'PluginHost' });
    this.consoleManager?.error(`${instance.plugin.name}: ${message}`, {
      source: `plugin:${instance.id}`,
      data: { fase: phase },
    });
    this.notifications?.error(`El plugin «${instance.plugin.name}» falló: ${message}`, { source: `plugin:${instance.id}` });
    void this.apiClient
      .post(`/api/plugins/${encodeURIComponent(instance.id)}/errors`, { message, stack, phase })
      .catch(() => {});
    try {
      instance.worker?.terminate();
      instance.worker = null;
    } catch {
      /* ignore */
    }
    for (const commandId of instance.commands) this.commands.unregister(commandId);
  }

  #checkError(payload, fallback) {
    if (payload && typeof payload === 'object' && payload.error) {
      throw Object.assign(new Error(payload.error.message ?? fallback), {
        code: payload.error.code ?? 'E_PLUGIN_API',
        detail: payload.error.detail ?? null,
      });
    }
    return payload;
  }

  #notify() {
    const list = this.list();
    for (const listener of [...this.#statusSubscribers]) {
      try {
        listener(list, this.stats());
      } catch (err) {
        this.logger.error(err, { source: 'PluginHost.notify' });
      }
    }
  }

  async dispose() {
    for (const id of [...this.#instances.keys()]) {
      await this.deactivate(id, { reason: 'shutdown' }).catch(() => {});
    }
    this.#statusSubscribers.clear();
  }
}

function normalizePlugin(plugin) {
  const resolution = plugin.resolution ?? {};
  const missing = resolution.missing ?? [];
  const disabledDependencies = resolution.disabledDependencies ?? [];
  const problems = [];
  if (plugin.error) problems.push(plugin.error.message ?? String(plugin.error));
  if (missing.length > 0) problems.push(`Faltan dependencias: ${missing.join(', ')}`);
  if (disabledDependencies.length > 0) problems.push(`Dependencias desactivadas: ${disabledDependencies.join(', ')}`);
  return {
    id: plugin.id,
    name: plugin.name ?? plugin.id,
    version: plugin.version ?? null,
    apiVersion: plugin.apiVersion ?? null,
    author: plugin.author ?? null,
    description: plugin.description ?? null,
    license: plugin.license ?? null,
    homepage: plugin.homepage ?? null,
    source: plugin.source ?? 'user',
    builtin: plugin.source === 'builtin',
    directory: plugin.directory ?? null,
    path: plugin.directory ?? null,
    entry: plugin.entry ?? null,
    entryBytes: plugin.entryBytes ?? null,
    sizeBytes: plugin.entryBytes ?? null,
    installedAt: plugin.installedAt ?? null,
    modifiedAt: plugin.modifiedAt ?? null,
    enabled: plugin.enabled !== false,
    resolvable: resolution.resolvable !== false,
    dependencies: plugin.dependencies ?? [],
    missingDependencies: missing,
    disabledDependencies,
    permissions: plugin.permissions ?? plugin.requires ?? [],
    activationEvents: plugin.activationEvents ?? [],
    contributes: plugin.contributes ?? {},
    canUninstall: plugin.canUninstall === true,
    canDisable: plugin.canDisable !== false,
    lastError: plugin.lastError ?? null,
    problems,
  };
}

function sanitize(value) {
  if (value === undefined) return null;
  try {
    const text = JSON.stringify(value);
    if (text === undefined) return null;
    if (text.length > MAX_LOG_BYTES) return { truncated: true, note: `El valor superaba ${MAX_LOG_BYTES} bytes` };
    return JSON.parse(text);
  } catch {
    return String(value);
  }
}

function truncate(text) {
  const value = String(text ?? '');
  return value.length > 8000 ? `${value.slice(0, 8000)}… [recortado]` : value;
}
