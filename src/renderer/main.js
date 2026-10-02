/**
 * Lumen Studio — renderer entry point.
 *
 * Boots the whole browser application for real:
 *   1. builds the service graph (client, capabilities, settings, theme, notifications, commands,
 *      shortcuts, runtime, analysis, editor, scripts, tabs, console, plugins, window, session);
 *   2. registers them in the Kernel, which initialises them in order and reports real progress to
 *      the boot screen — including which step failed and with which error;
 *   3. mounts the App (chrome + views) and restores the previous session.
 *
 * If the server is not reachable the app still boots in degraded mode: it says so, keeps the
 * editor usable for local drafts and disables everything that needs the backend.
 */

import './styles/app.css';
import { EventBus } from '../server/core/EventBus.js';
import { Kernel } from './core/Kernel.js';
import { ErrorBus } from './core/ErrorBus.js';
import { RendererLogger } from './core/Logger.js';
import { BrowserCapabilities } from './core/BrowserCapabilities.js';
import { ApiClient } from './api/ApiClient.js';
import { EventStream } from './api/EventStream.js';
import { SettingsManager } from './settings/SettingsManager.js';
import { ThemeManager } from './themes/ThemeManager.js';
import { NotificationManager } from './notifications/NotificationManager.js';
import { CommandManager } from './commands/CommandManager.js';
import { ShortcutManager } from './shortcuts/ShortcutManager.js';
import { RuntimeManager } from './runtime/RuntimeManager.js';
import { PluginHost } from './plugins/PluginHost.js';
import { EditorManager } from '../editor/EditorManager.js';
import { AnalysisClient } from '../editor/AnalysisClient.js';
import { ScriptManager } from '../features/ScriptManager.js';
import { ConsoleManager } from '../features/ConsoleManager.js';
import { TabsController } from '../app/TabsController.js';
import { DialogManager } from '../ui/dialogs.js';
import { Menu } from '../ui/menu.js';
import { StatusBarController } from '../ui/StatusBarController.js';
import { WindowController } from '../desktop/WindowController.js';
import { App } from '../app/App.js';
import { SessionController } from '../app/SessionController.js';
import { LayoutStore } from '../app/LayoutStore.js';
import { StorageUI } from '../app/StorageUI.js';
import { Limits } from '../shared/constants.js';
import { formatDuration } from './utils/format.js';

const boot = {
  screen: document.getElementById('lumen-boot'),
  status: document.getElementById('lumen-boot-status'),
  bar: document.getElementById('lumen-boot-bar'),
  steps: document.getElementById('lumen-boot-steps'),
  total: 0,
  done: 0,
};

function setBootStatus(text) {
  if (boot.status) boot.status.textContent = text;
}

function pushBootStep(step) {
  boot.done += 1;
  if (boot.bar && boot.total > 0) {
    boot.bar.style.width = `${Math.round((boot.done / boot.total) * 100)}%`;
  }
  if (!boot.steps) return;
  const item = document.createElement('li');
  item.className = step.ok ? 'boot__step' : 'boot__step boot__step--error';
  const label = document.createElement('span');
  label.textContent = `${step.ok ? '✔' : '✖'} ${step.label}`;
  const timing = document.createElement('span');
  timing.className = 'boot__step-time';
  timing.textContent = step.ok
    ? (step.skipped ?? formatDuration(step.durationMs ?? 0))
    : (step.error?.message ?? 'error desconocido');
  item.append(label, timing);
  boot.steps.appendChild(item);
}

function fail(error) {
  const message = error?.message ?? String(error);
  setBootStatus(`No se pudo iniciar Lumen Studio: ${message}`);
  boot.bar?.classList.add('boot__bar--error');
  if (boot.steps && boot.steps.childElementCount === 0) {
    const item = document.createElement('li');
    item.className = 'boot__step boot__step--error';
    item.textContent = message;
    boot.steps.appendChild(item);
  }
  // The error is also visible in the developer console with its full stack.
  console.error('[Lumen] Fallo de arranque', error);
}

async function main() {
  const overlays = document.getElementById('lumen-overlays');
  const root = document.getElementById('lumen-root');
  if (!root || !overlays) throw new Error('La página no contiene #lumen-root y #lumen-overlays');

  const clientId = `web-${Math.random().toString(36).slice(2, 10)}`;
  const logger = new RendererLogger({ label: 'lumen', limit: 3000, minLevel: 'DEBUG' });
  const eventBus = new EventBus({ label: 'renderer', recentLimit: 200 });
  const apiClient = new ApiClient({ baseUrl: '', clientId, timeoutMs: 30_000 });
  const errorBus = new ErrorBus({ apiClient, logger });
  const capabilities = new BrowserCapabilities({ logger });
  const settings = new SettingsManager({ apiClient, eventBus, logger, capabilities });
  const theme = new ThemeManager({ apiClient, settings, eventBus, logger, capabilities });
  const notifications = new NotificationManager({ host: null, logger, eventBus, capabilities });
  const dialogs = new DialogManager({ host: overlays, logger });
  const menu = new Menu({ host: overlays, logger });
  const commands = new CommandManager({ logger, errorBus, eventBus, notifications });
  const shortcuts = new ShortcutManager({ settings, logger, eventBus, notifications, capabilities, commands });
  const eventStream = new EventStream({
    url: '/api/events',
    clientId,
    logger,
    onStateChange: (state) => eventBus.emit('connection:state', { state }),
  });
  const layoutStore = new LayoutStore({ apiClient, logger });
  const runtime = new RuntimeManager({ apiClient, capabilities, settings, logger, eventBus, notifications, errorBus, eventStream });
  const analysis = new AnalysisClient({ apiClient, capabilities, logger, errorBus });
  const editorHost = document.createElement('div');
  editorHost.className = 'editor-surface';
  const editor = new EditorManager({
    host: editorHost,
    settings,
    themeManager: theme,
    analysis,
    capabilities,
    logger,
    eventBus,
    errorBus,
    notifications,
  });
  const scripts = new ScriptManager({ apiClient, logger, errorBus, notifications, eventBus, editor, storage: layoutStore });
  const tabs = new TabsController({
    editor,
    scripts,
    menu,
    dialogs,
    notifications,
    eventBus,
    logger,
    /*
     * `TabsController` pide aquí el guardado real cuando una pestaña todavía no tiene archivo:
     * antes se creaba un script nuevo y vacío, que perdía el contenido del editor. `saveActive`
     * conserva el texto del documento, lo envía con su nombre y marca la pestaña como guardada.
     * Desde el menú contextual llega `{ saveAs: true }` para guardar una copia.
     */
    onCreateRequest: (tab, options = {}) => app.saveActive({ as: options?.saveAs === true }),
  });
  const consoleManager = new ConsoleManager({
    maxEntries: settings.get('performance.consoleMaxEntries') ?? Limits.maxConsoleEntries,
    logger,
    settings,
    eventBus,
    errorBus,
  });
  const windowController = new WindowController({ settings, capabilities, logger, eventBus, notifications, errorBus, storage: layoutStore });
  const statusBar = new StatusBarController({
    host: null,
    runtimeController: runtime,
    tabsController: tabs,
    notifications,
    eventStream,
    logger,
    editorManager: editor,
    settings,
    capabilities,
    windowController,
  });

  const app = new App({
    root,
    overlays,
    kernel: null,
    logger,
    eventBus,
    eventStream,
    apiClient,
    errorBus,
    capabilities,
    settings,
    theme,
    notifications,
    dialogs,
    menu,
    commands,
    shortcuts,
    runtime,
    analysis,
    editor,
    editorHost,
    scripts,
    tabs,
    console: consoleManager,
    plugins: null,
    windowController,
    statusBar,
    session: null,
    layoutStore,
    storageUI: null,
    storageRoot: null,
  });

  const plugins = new PluginHost({
    apiClient,
    logger,
    errorBus,
    eventBus,
    notifications,
    commands,
    console: consoleManager,
    editor,
    scripts,
    settings,
    statusbar: statusBar,
    capabilities,
  });
  const session = new SessionController(app);
  const storageUI = new StorageUI(app);
  app.plugins = plugins;
  app.session = session;
  app.storageUI = storageUI;

  const kernel = new Kernel({ label: 'Lumen Studio' });
  app.kernel = kernel;
  const unsubscribeProgress = kernel.onProgress((progress) => {
    if (progress.phase === 'start') setBootStatus(`Iniciando ${progress.label}…`);
    else pushBootStep(progress);
  });

  /* ---------------------------------------------------------------- services */
  kernel.register('logger', logger, { label: 'Registro', critical: true });
  kernel.register('eventBus', eventBus, { label: 'Bus de eventos' });
  /**
   * Connectivity step: one real request proves the local server answers, then the SSE stream is
   * opened and the storage root is read. If it fails the app continues in degraded mode and says so.
   */
  const connection = {
    async init() {
      try {
        const health = await apiClient.get('/api/health', { timeoutMs: 8000 });
        apiClient.status = 'online';
        apiClient.lastError = null;
        app.serverInfo = health;
      } catch (err) {
        apiClient.status = 'offline';
        apiClient.lastError = err;
        logger.warn(`El servidor local no responde (${err.message}); la aplicación arranca en modo limitado`, { source: 'main' });
        return { ok: false, degraded: true, reason: err.message };
      }
      try {
        const storage = await apiClient.get('/api/storage/info', { timeoutMs: 8000 });
        app.storageRoot = storage?.storage?.root ?? storage?.root ?? null;
      } catch (err) {
        logger.warn(`No se pudo leer la información del almacenamiento: ${err.message}`, { source: 'main' });
      }
      eventStream.connect();
      return { ok: true, server: apiClient.status, storageRoot: app.storageRoot };
    },
  };
  kernel.register('apiClient', apiClient, { label: 'Cliente de la API' });
  kernel.register('connection', connection, { label: 'Conexión con el servidor' });
  kernel.register('layoutStore', layoutStore, { label: 'Disposición guardada' });
  kernel.register('capabilities', capabilities, { label: 'Capacidades del navegador' });
  kernel.register('settings', settings, { label: 'Configuración' });
  kernel.register('theme', theme, { label: 'Tema' });
  kernel.register('notifications', notifications, { label: 'Notificaciones' });
  kernel.register('dialogs', dialogs, { label: 'Diálogos' });
  kernel.register('menu', menu, { label: 'Menús' });
  kernel.register('commands', commands, { label: 'Comandos' });
  kernel.register('shortcuts', shortcuts, { label: 'Atajos de teclado' });
  kernel.register('eventStream', eventStream, { label: 'Flujo de eventos' });
  kernel.register('console', consoleManager, { label: 'Consola' });
  kernel.register('runtime', runtime, { label: 'Runtime de ejecución' });
  kernel.register('analysis', analysis, { label: 'Análisis de tipos' });
  kernel.register('scripts', scripts, { label: 'Biblioteca de scripts' });
  kernel.register('window', windowController, { label: 'Ventana' });
  kernel.register('ui', app, { label: 'Interfaz', critical: true });
  kernel.register('tabs', tabs, { label: 'Pestañas' });
  kernel.register('plugins', plugins, { label: 'Plugins' });
  kernel.register('session', session, { label: 'Sesión' });
  kernel.register('storageUI', storageUI, { label: 'Almacenamiento' });

  boot.total = kernel.describe().length;
  setBootStatus('Iniciando Lumen Studio…');

  const bootResult = await kernel.boot();
  unsubscribeProgress();

  // Post-boot: restore the session, then wire the panels that depend on it.
  session.applyLayout();
  const restored = await session.restore().catch((err) => {
    logger.warn(`No se pudo restaurar la sesión: ${err.message}`, { source: 'main' });
    return { ok: false, error: err };
  });

  const failedSteps = bootResult.report.filter((step) => !step.ok);
  const summary = failedSteps.length === 0
    ? `Listo · ${kernel.describe().length} servicios · ${formatDuration(performance.now())}`
    : `Listo con ${failedSteps.length} avisos`;
  setBootStatus(summary);
  if (notifications) {
    const offline = apiClient.status === 'offline';
    notifications.info(
      offline
        ? 'Lumen Studio arrancó en modo limitado: el servidor local no responde, así que la biblioteca, el historial, los plugins y la ejecución en servidor no están disponibles.'
        : `Lumen Studio ${app.serverInfo?.app?.version ?? ''} listo. Arranque en ${formatDuration(performance.now())}.`,
      { durationMs: offline ? 12_000 : 4000, source: 'main' },
    );
    if (restored?.ok && restored.restored) {
      notifications.info(`Sesión anterior restaurada (${restored.tabs} pestañas)`, { durationMs: 3000, source: 'main' });
    }
  }
  logger.success(`Aplicación lista (${apiClient.status})`, {
    source: 'main',
    data: { degraded: apiClient.status === 'offline', failedSteps: failedSteps.map((step) => step.label) },
  });

  // Global hooks that need the fully booted app.
  window.addEventListener('beforeunload', (event) => {
    if (!tabs.hasDirtyTabs()) return undefined;
    if (settings.get('general.confirmOnExit') === false) return undefined;
    event.preventDefault();
    event.returnValue = 'Hay cambios sin guardar.';
    return event.returnValue;
  });
  document.body.dataset.booted = 'true';
  return { app, kernel, degraded: apiClient.status === 'offline' };
}

let started;
try {
  started = await main();
  window.lumen = {
    app: started.app,
    kernel: started.kernel,
    version: started.app.serverInfo?.app?.version ?? null,
    degraded: started.degraded,
    /** Development/diagnostics helper: run a command by id. */
    run: (id) => started.app.commands.execute(id),
  };
} catch (err) {
  fail(err);
  // Make the failure reachable for automation and support, with the real stack.
  window.lumenBootError = { message: err?.message ?? String(err), stack: err?.stack ?? null, code: err?.code ?? null };
}
