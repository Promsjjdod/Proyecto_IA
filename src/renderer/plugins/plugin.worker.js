/**
 * plugin.worker.js — isolated host process for a plugin entry point.
 *
 * Runs inside a dedicated Worker: plugin code has no access to the DOM, to the application
 * objects or to the network beyond the RPC methods its manifest permissions allow. The entry
 * source is delivered by the main thread, evaluated as a real ES module from a Blob URL, and it
 * talks to Lumen exclusively through the `lumen` bridge built here.
 *
 * Protocol (main thread ⇄ worker):
 *   main → worker : { type: 'load', source, plugin }
 *                   { type: 'invoke', invocationId, commandId, payload }
 *                   { type: 'event', event, payload }
 *                   { type: 'response', requestId, ok, value, error }
 *                   { type: 'shutdown' }
 *   worker → main : { type: 'ready', commands }
 *                   { type: 'request', requestId, method, params }
 *                   { type: 'invoked', invocationId, ok, value, error }
 *                   { type: 'log', level, message, data }
 *                   { type: 'error', message, stack, phase }
 */

const pending = new Map();
const commandHandlers = new Map();
const eventHandlers = new Map();
let requestSeq = 0;
let pluginInfo = null;

self.addEventListener('message', (event) => {
  const message = event.data ?? {};
  switch (message.type) {
    case 'load':
      void load(message);
      break;
    case 'invoke':
      void invokeCommand(message);
      break;
    case 'event':
      dispatchEvent(message.event, message.payload);
      break;
    case 'response':
      settleRequest(message);
      break;
    case 'shutdown':
      self.close();
      break;
    default:
      report('error', `Mensaje desconocido del host: ${String(message.type)}`, null, 'protocol');
      break;
  }
});

async function load({ source, plugin }) {
  pluginInfo = plugin ?? { id: 'desconocido', name: 'Plugin' };
  try {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    let module;
    try {
      module = await import(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const activate = typeof module.activate === 'function'
      ? module.activate
      : (typeof module.default === 'function' ? module.default : null);
    if (!activate) {
      report('error', 'El plugin no exporta una función `activate(api)` ni un `export default`', null, 'load');
      return;
    }
    await activate(buildApi());
    self.postMessage({ type: 'ready', commands: [...commandHandlers.keys()], plugin: pluginInfo.id });
  } catch (err) {
    report('error', err?.message ?? String(err), err?.stack ?? null, 'load');
  }
}

async function invokeCommand({ invocationId, commandId, payload }) {
  const handler = commandHandlers.get(commandId);
  if (!handler) {
    self.postMessage({ type: 'invoked', invocationId, ok: false, error: { message: `El plugin no tiene registrado el comando "${commandId}"` } });
    return;
  }
  try {
    const value = await handler(payload ?? {});
    self.postMessage({ type: 'invoked', invocationId, ok: true, value: toTransferable(value) });
  } catch (err) {
    report('error', err?.message ?? String(err), err?.stack ?? null, `comando:${commandId}`);
    self.postMessage({ type: 'invoked', invocationId, ok: false, error: { message: err?.message ?? String(err) } });
  }
}

function dispatchEvent(name, payload) {
  const handlers = eventHandlers.get(name) ?? [];
  for (const handler of handlers) {
    try {
      const result = handler(payload);
      if (result && typeof result.catch === 'function') {
        result.catch((err) => report('error', err?.message ?? String(err), err?.stack ?? null, `evento:${name}`));
      }
    } catch (err) {
      report('error', err?.message ?? String(err), err?.stack ?? null, `evento:${name}`);
    }
  }
}

/** Main-thread RPC: resolves when the host answers, rejects on permission/validation errors. */
function request(method, params = {}, { timeoutMs = 8000 } = {}) {
  const requestId = `r${++requestSeq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`El host no respondió a "${method}" en ${timeoutMs} ms`));
    }, timeoutMs);
    pending.set(requestId, { resolve, reject, timer, method });
    self.postMessage({ type: 'request', requestId, method, params });
  });
}

function settleRequest({ requestId, ok, value, error }) {
  const entry = pending.get(requestId);
  if (!entry) return;
  pending.delete(requestId);
  clearTimeout(entry.timer);
  if (ok) entry.resolve(value);
  else entry.reject(Object.assign(new Error(error?.message ?? `La operación "${entry.method}" falló`), { code: error?.code ?? null }));
}

function toTransferable(value) {
  if (value === undefined) return null;
  try {
    JSON.stringify(value);
    return value;
  } catch {
    return String(value);
  }
}

function report(level, message, stack = null, phase = 'runtime') {
  self.postMessage({ type: 'error', message, stack, phase });
  if (level === 'log') self.postMessage({ type: 'log', level: 'info', message });
}

/** The complete surface a plugin can use; every call is permission-checked by the host. */
function buildApi() {
  const api = {
    plugin: Object.freeze({ id: pluginInfo.id, name: pluginInfo.name ?? pluginInfo.id }),

    commands: {
      /** register({ id, title }, handler) — the command becomes available in the palette. */
      register(command, handler) {
        const id = typeof command === 'string' ? command : command?.id;
        if (typeof id !== 'string' || id.trim() === '') throw new Error('El comando necesita un id');
        if (typeof handler !== 'function') throw new Error(`El comando "${id}" necesita una función manejadora`);
        const qualified = `${pluginInfo.id}.${id}`;
        commandHandlers.set(qualified, handler);
        return request('commands.register', {
          id: qualified,
          title: (typeof command === 'object' && command.title) || id,
          description: (typeof command === 'object' && command.description) || null,
          category: (typeof command === 'object' && command.category) || `Plugin: ${pluginInfo.name ?? pluginInfo.id}`,
          icon: (typeof command === 'object' && command.icon) || 'puzzle',
          keywords: (typeof command === 'object' && command.keywords) || [],
        });
      },
    },

    editor: {
      getActive: () => request('editor.getActive'),
      getSelection: () => request('editor.getSelection'),
      insertText: (text) => request('editor.insertText', { text: String(text ?? '') }),
      replaceSelection: (text) => request('editor.replaceSelection', { text: String(text ?? '') }),
      replaceAll: (text) => request('editor.replaceAll', { text: String(text ?? '') }),
    },

    console: {
      log: (message, data = null, level = 'info') => {
        self.postMessage({ type: 'log', level, message: String(message ?? ''), data });
        return request('console.log', { message: String(message ?? ''), level, data });
      },
      clear: () => request('console.clear'),
    },

    notifications: {
      show: (options) => request('notifications.show', typeof options === 'string' ? { message: options } : options ?? {}),
    },

    scripts: {
      list: () => request('scripts.list'),
      read: (id) => request('scripts.read', { id }),
    },

    settings: {
      get: (key) => request('settings.get', { key }),
      set: (key, value) => request('settings.set', { key, value }),
      subscribe: (key, handler) => {
        if (typeof handler !== 'function') throw new Error('subscribe necesita una función');
        return addEvent('settings:changed', (payload) => {
          if (!key || payload?.key === key || payload?.keys?.includes?.(key)) handler(payload);
        });
      },
    },

    statusbar: {
      set: (item) => request('statusbar.set', typeof item === 'string' ? { id: 'main', text: item } : item ?? {}),
      remove: (id) => request('statusbar.set', { id, remove: true }),
    },

    storage: {
      get: async (key, fallback = null) => {
        const result = await request('storage.get', { key });
        return result?.value ?? fallback;
      },
      set: (key, value) => request('storage.set', { key, value }),
      remove: (key) => request('storage.remove', { key }),
    },

    events: {
      /** on(event, handler) where event ∈ activationEvents declared in plugin.json. */
      on: (event, handler) => addEvent(event, handler),
    },
  };
  return Object.freeze(api);
}

function addEvent(name, handler) {
  if (typeof name !== 'string' || typeof handler !== 'function') throw new Error('on(nombre, función)');
  const handlers = eventHandlers.get(name) ?? [];
  handlers.push(handler);
  eventHandlers.set(name, handlers);
  return () => {
    const current = eventHandlers.get(name) ?? [];
    eventHandlers.set(name, current.filter((item) => item !== handler));
  };
}

self.addEventListener('error', (event) => report('error', event.message, event.error?.stack ?? null, 'worker'));
self.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  report('error', reason?.message ?? String(reason), reason?.stack ?? null, 'promesa');
});
