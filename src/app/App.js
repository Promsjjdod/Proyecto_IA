/**
 * App — the application shell.
 *
 * Builds the real chrome (top bar with menus, sidebar, view host, status bar), owns the seven
 * views, and implements every action the commands and menus call. It does not re-implement any
 * feature: it coordinates the controllers that already do the work (editor, tabs, scripts,
 * runtime, console, plugins, settings, themes, session) and reports failures with their real
 * message instead of hiding them.
 */

import { el, clear } from '../renderer/utils/dom.js';
import { icon, ICON_NAMES } from '../ui/icons.js';
import { RuntimeState, Dialect } from '../shared/constants.js';
import { formatDuration, formatRelative, formatUptime } from '../renderer/utils/format.js';
import { CommandPalette } from './CommandPalette.js';
import { registerAppCommands } from './commands.js';
import { DashboardView } from './views/DashboardView.js';
import { EditorView } from './views/EditorView.js';
import { ScriptsView } from './views/ScriptsView.js';
import { ConsoleView } from './views/ConsoleView.js';
import { PluginsView } from './views/PluginsView.js';
import { SettingsView } from './views/SettingsView.js';
import { AboutView } from './views/AboutView.js';

const SIDEBAR_SECTIONS = [
  { id: 'dashboard', label: 'Panel', icon: 'dashboard', hint: 'Estado real del entorno' },
  { id: 'editor', label: 'Editor', icon: 'editor', hint: 'Escribe y ejecuta scripts' },
  { id: 'scripts', label: 'Scripts', icon: 'scripts', hint: 'Biblioteca de archivos guardados' },
  { id: 'console', label: 'Consola', icon: 'console', hint: 'Salida, errores y registros' },
  { id: 'plugins', label: 'Plugins', icon: 'plugins', hint: 'Extensiones aisladas' },
  { id: 'settings', label: 'Ajustes', icon: 'settings', hint: 'Configuración de la aplicación' },
  { id: 'about', label: 'Acerca de', icon: 'info', hint: 'Versiones y capacidades' },
];

export class App {
  #root;
  #overlays;
  #nodes = {};
  #views = new Map();
  #viewElements = new Map();
  #activeView = 'dashboard';
  #sidebarMode = 'expanded';
  #unsubscribers = [];
  #clockTimer = null;
  #capabilitySummary = null;

  constructor(services) {
    Object.assign(this, services);
    this.startedAt = Date.now();
    this.kernel = services.kernel;
    this.palette = null;
    this.#root = services.root;
    this.#overlays = services.overlays;
  }

  get activeView() {
    return this.#activeView;
  }

  get sidebarMode() {
    return this.#sidebarMode;
  }

  get views() {
    return this.#views;
  }

  /* ------------------------------------------------------------------ *\
   * Mount
   * \* ------------------------------------------------------------------ */

  /**
   * Kernel entry point: builds the chrome, mounts every view, initialises the editor into the real
   * container and hands the tab strip to the TabsController. Runs as a critical boot step.
   */
  async init() {
    const mounted = await this.mount();
    const editorResult = await this.editor.init();
    this.tabs.setContainer(this.#nodes.tabsContainer);
    this.setSidebar(this.settings.get('general.startSidebarCollapsed') === true ? 'compact' : this.#sidebarMode);
    return { ...mounted, editorDocuments: editorResult.documents, editorExtensions: editorResult.extensions };
  }

  async mount() {
    this.#root.dataset.statusBar = this.settings.get('appearance.showStatusBar') === false ? 'off' : 'on';
    this.#root.dataset.sidebar = this.#sidebarMode;
    this.#root.dataset.animations = this.settings.get('appearance.animations') === false ? 'off' : 'on';
    this.#root.dataset.density = this.settings.get('appearance.consoleDensity') ?? 'comfortable';

    const topbar = this.#buildTopbar();
    const sidebar = this.#buildSidebar();
    const viewHost = el('div.view-host', { attrs: { id: 'lumen-view-host' } });
    const statusBar = el('footer.status-bar', { attrs: { id: 'status-bar', role: 'contentinfo' } });
    this.#nodes.topbar = topbar;
    this.#nodes.sidebar = sidebar;
    this.#nodes.viewHost = viewHost;
    this.#nodes.statusBar = statusBar;
    this.#root.append(topbar, el('div.app__body', null, [sidebar, viewHost]), statusBar);

    this.#buildViews(viewHost);
    this.#nodes.tabsContainer = this.#viewElements.get('editor').querySelector('.tabs');
    this.palette = new CommandPalette({ host: this.#overlays, commands: this.commands, logger: this.logger });
    registerAppCommands({ commands: this.commands, app: this });

    this.statusBar.init();
    this.#wireEvents();
    this.#applySettingEffects();

    this.switchView(this.session?.view && this.#views.has(this.session.view) ? this.session.view : 'dashboard', { initial: true });
    this.#startClock();
    this.#root.hidden = false;
    document.getElementById('lumen-boot')?.remove();

    this.logger.success(`Interfaz montada con ${this.#views.size} vistas y ${this.commands.list().length} comandos`, { source: 'App' });
    return { ok: true, views: this.#views.size, commands: this.commands.list().length };
  }

  #buildTopbar() {
    const brand = el('div.topbar__brand', null, [
      el('div.topbar__brand-mark', { text: 'L' }),
      el('div', null, [
        el('strong', { text: 'Lumen Studio' }),
        el('span.topbar__subtitle', { text: 'Lua · Luau' }),
      ]),
    ]);

    const menus = [
      {
        id: 'archivo',
        label: 'Archivo',
        items: [
          { label: 'Nuevo script', shortcut: this.commands.get('file.new')?.shortcut ?? 'Ctrl+N', onClick: () => this.newScript() },
          { label: 'Abrir…', shortcut: 'Ctrl+O', onClick: () => this.openPicker() },
          { label: 'Guardar', shortcut: 'Ctrl+S', onClick: () => this.saveActive() },
          { label: 'Guardar como…', shortcut: 'Ctrl+Shift+S', onClick: () => this.saveActive({ as: true }) },
          { separator: true },
          { label: 'Importar archivo…', onClick: () => this.importScript() },
          { label: 'Exportar el activo', onClick: () => this.exportActive() },
          { separator: true },
          { label: 'Renombrar…', onClick: () => this.tabs.rename() },
          { label: 'Duplicar', onClick: () => this.tabs.duplicate() },
          { separator: true },
          { label: 'Cerrar pestaña', shortcut: 'Ctrl+W', onClick: () => this.closeActiveTab() },
          { label: 'Cerrar todas', onClick: () => this.tabs.closeAll() },
        ],
      },
      {
        id: 'edicion',
        label: 'Edición',
        items: [
          { label: 'Deshacer', shortcut: 'Ctrl+Z', onClick: () => this.editor.undo() },
          { label: 'Rehacer', shortcut: 'Ctrl+Y', onClick: () => this.editor.redo() },
          { separator: true },
          { label: 'Buscar', shortcut: 'Ctrl+F', onClick: () => this.editor.openFind() },
          { label: 'Reemplazar', shortcut: 'Ctrl+H', onClick: () => this.editor.openReplace() },
          { label: 'Ir a línea…', shortcut: 'Ctrl+G', onClick: () => this.gotoLine() },
          { label: 'Buscar en todos los scripts…', onClick: () => this.searchProject() },
          { separator: true },
          { label: 'Comentar / descomentar', shortcut: 'Ctrl+/', onClick: () => this.editor.toggleComment() },
          { label: 'Formatear documento', shortcut: 'Shift+Alt+F', onClick: () => this.formatDocument() },
          { label: 'Analizar ahora', onClick: () => this.analyzeNow() },
          { separator: true },
          { label: 'Añadir cursor arriba', shortcut: 'Ctrl+Alt+↑', onClick: () => this.editor.addCursorAbove() },
          { label: 'Añadir cursor abajo', shortcut: 'Ctrl+Alt+↓', onClick: () => this.editor.addCursorBelow() },
          { label: 'Seleccionar la siguiente coincidencia', shortcut: 'Ctrl+D', onClick: () => this.editor.selectNextOccurrence() },
        ],
      },
      {
        id: 'ver',
        label: 'Ver',
        items: [
          ...SIDEBAR_SECTIONS.map((section) => ({
            label: section.label,
            checked: this.#activeView === section.id,
            onClick: () => this.switchView(section.id),
          })),
          { separator: true },
          { label: 'Barra lateral compacta', checked: this.#sidebarMode === 'compact', onClick: () => this.toggleSidebar() },
          { label: 'Mostrar la barra de estado', checked: this.settings.get('appearance.showStatusBar') !== false, onClick: () => this.toggleSetting('appearance.showStatusBar') },
          { label: 'Ajuste de línea', checked: this.settings.get('editor.wordWrap') === true, onClick: () => this.toggleSetting('editor.wordWrap') },
          { label: 'Minimapa', checked: this.settings.get('editor.minimap') === true, onClick: () => this.toggleSetting('editor.minimap') },
          { separator: true },
          { label: 'Tema claro / oscuro', onClick: () => this.toggleTheme() },
          { label: 'Elegir tema…', onClick: () => this.chooseTheme() },
          { label: 'Pantalla completa', shortcut: 'F11', onClick: () => this.toggleFullscreen() },
          { label: 'Paleta de comandos', shortcut: 'Ctrl+Shift+P', onClick: () => this.palette.show() },
        ],
      },
      {
        id: 'ejecutar',
        label: 'Ejecutar',
        items: [
          { label: 'Ejecutar el script activo', shortcut: 'Ctrl+Enter', onClick: () => this.runActive() },
          { label: 'Ejecutar en el servidor', onClick: () => this.runActive({ server: true }) },
          { label: 'Detener la ejecución', onClick: () => this.stopExecution() },
          { separator: true },
          { label: 'Limpiar la consola', onClick: () => this.focusConsole(null, { clear: true }) },
          { label: 'Ver la consola', onClick: () => this.switchView('console') },
          { separator: true },
          { label: 'Volver a comprobar capacidades', onClick: () => this.recheckCapabilities() },
        ],
      },
      {
        id: 'ayuda',
        label: 'Ayuda',
        items: [
          { label: 'Acerca de Lumen Studio', onClick: () => this.switchView('about') },
          { label: 'Documentación del proyecto', onClick: () => window.open('https://github.com/Promsjjdod/Proyecto_IA#readme', '_blank', 'noopener') },
          { separator: true },
          { label: 'Descargar el informe de diagnóstico', onClick: () => this.downloadDiagnostics() },
          { label: 'Mostrar la carpeta de datos', onClick: () => this.showDataFolder() },
          { separator: true },
          { label: 'Recargar la interfaz', onClick: () => this.reload() },
        ],
      },
    ];
    const menuButtons = menus.map((menu) => el('button.topbar__menu', {
      attrs: { type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false' },
      text: menu.label,
      on: {
        click: (event) => this.menu.openFromEvent(event, { items: menu.items, align: 'left' }),
      },
    }));

    const paletteButton = el('button.topbar__button', {
      attrs: { type: 'button', title: 'Paleta de comandos (Ctrl+Shift+P)' },
      on: { click: () => this.palette.show() },
    }, [icon('wand', { size: 'sm' }), el('span', { text: 'Comandos' })]);

    this.#nodes.runButton = el('button.btn.btn--primary.btn--sm', {
      attrs: { type: 'button', title: 'Ejecutar el script activo (Ctrl+Enter)' },
      on: { click: () => this.runActive() },
    }, [icon('play', { size: 'sm' }), el('span', { text: 'Ejecutar' })]);
    this.#nodes.stopButton = el('button.btn.btn--danger.btn--sm', {
      attrs: { type: 'button', title: 'Detener la ejecución en curso' },
      on: { click: () => this.stopExecution() },
      disabled: true,
    }, [icon('stop', { size: 'sm' }), el('span', { text: 'Detener' })]);

    this.#nodes.engineBadge = el('span.badge.badge--muted', { text: 'Motor: —' });
    this.#nodes.connectionBadge = el('span.badge.badge--muted', { text: 'Servidor: —' });

    const windowButtons = this.windowController?.isNative
      ? el('div.topbar__window-buttons', null, [
        el('button.window-button', { attrs: { type: 'button', title: 'Minimizar' }, on: { click: () => this.windowController.minimize() } }, [el('span', { text: '—' })]),
        el('button.window-button', { attrs: { type: 'button', title: 'Maximizar o restaurar' }, on: { click: () => this.windowController.maximize() } }, [el('span', { text: '□' })]),
        el('button.window-button.window-button--close', { attrs: { type: 'button', title: 'Cerrar' }, on: { click: () => this.windowController.close() } }, [el('span', { text: '✕' })]),
      ])
      : null;

    return el('header.topbar', null, [
      brand,
      el('nav.topbar__menus', { attrs: { 'aria-label': 'Menú principal' } }, menuButtons),
      paletteButton,
      el('div.topbar__spacer'),
      this.#nodes.connectionBadge,
      this.#nodes.engineBadge,
      this.#nodes.runButton,
      this.#nodes.stopButton,
      windowButtons,
    ]);
  }

  #buildSidebar() {
    const nav = el('nav.sidebar__section', { attrs: { 'aria-label': 'Secciones' } });
    for (const section of SIDEBAR_SECTIONS) {
      const item = el('button.sidebar__item', {
        attrs: { type: 'button', title: section.hint, 'data-view': section.id },
        on: { click: () => this.switchView(section.id) },
      }, [
        icon(ICON_NAMES.includes(section.icon) ? section.icon : 'info', { size: 'sm' }),
        el('span.sidebar__label', { text: section.label }),
        el('span.sidebar__badge', { hidden: true }),
      ]);
      this.#nodes[`nav_${section.id}`] = item;
      nav.appendChild(item);
    }

    const footer = el('div.sidebar__footer', null, [
      el('button.sidebar__item', {
        attrs: { type: 'button', title: 'Cambiar entre tema claro y oscuro' },
        on: { click: () => this.toggleTheme() },
      }, [icon('moon', { size: 'sm' }), el('span.sidebar__label', { text: 'Tema' })]),
      el('button.sidebar__item', {
        attrs: { type: 'button', title: 'Contraer o expandir la barra lateral' },
        on: { click: () => this.toggleSidebar() },
      }, [icon('panel-left', { size: 'sm' }), el('span.sidebar__label', { text: 'Contraer' })]),
      el('button.sidebar__item', {
        attrs: { type: 'button', title: 'Estado de las capacidades del entorno' },
        on: { click: () => this.switchView('about') },
      }, [icon('shield', { size: 'sm' }), el('span.sidebar__label', { text: 'Capacidades' }), el('span.sidebar__badge', { text: '—' })]),
    ]);
    this.#nodes.capabilityBadge = footer.querySelectorAll('.sidebar__badge')[1];

    return el('aside.sidebar', { attrs: { 'aria-label': 'Barra lateral' } }, [
      el('div.sidebar__heading', { text: 'Navegación' }),
      nav,
      el('div.sidebar__spacer'),
      footer,
    ]);
  }

  #buildViews(host) {
    const definitions = [
      new DashboardView(this),
      new EditorView(this),
      new ScriptsView(this),
      new ConsoleView(this),
      new PluginsView(this),
      new SettingsView(this),
      new AboutView(this),
    ];
    for (const view of definitions) {
      const element = view.mount();
      element.classList.add('view');
      element.hidden = true;
      element.dataset.view = view.id;
      element.setAttribute('aria-label', view.title);
      this.#views.set(view.id, view);
      this.#viewElements.set(view.id, element);
      host.appendChild(element);
    }
  }

  /* ------------------------------------------------------------------ *\
   * Wiring
   * \* ------------------------------------------------------------------ */

  #wireEvents() {
    const runtime = this.runtime;
    this.#unsubscribers.push(
      runtime.onStateChange((info) => this.#onRuntimeState(info)),
      runtime.onExecution((record) => this.#onExecution(record)),
      this.tabs.onChange(() => this.#refreshTabState()),
      this.editor.onDiagnostics(() => this.#refreshTabState()),
      this.console.subscribe(() => this.#refreshConsoleBadge()),
      this.plugins.subscribe(() => this.#refreshPluginBadge()),
      this.settings.subscribe(() => this.#applySettingEffects()),
      this.capabilities.onChange(() => this.#refreshCapabilities()),
      this.errorBus.subscribe(() => this.#refreshErrorBadge()),
      this.eventStream.subscribeState((state) => this.#onConnectionState(state)),
      this.notifications.onCounts(() => this.#refreshErrorBadge()),
    );

    window.addEventListener('error', (event) => {
      this.errorBus.report(event.error ?? new Error(event.message), {
        source: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : 'window',
        kind: 'UI',
      });
    });
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
      this.errorBus.report(reason, { source: 'promesa no controlada', kind: 'UI' });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void this.session?.saveNow({ silent: true });
    });
    // Ctrl+rueda adjusts the editor font size, like every professional editor.
    this.editorHost.addEventListener('wheel', (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      if (event.deltaY < 0) this.editor.zoomIn();
      else this.editor.zoomOut();
    }, { passive: false });
  }

  #applySettingEffects() {
    const root = this.#root;
    root.dataset.statusBar = this.settings.get('appearance.showStatusBar') === false ? 'off' : 'on';
    root.dataset.animations = this.settings.get('appearance.animations') === false ? 'off' : 'on';
    root.dataset.density = this.settings.get('appearance.consoleDensity') ?? 'comfortable';
    const compact = this.settings.get('appearance.compactSidebar') === true;
    if (compact !== (this.#sidebarMode === 'compact')) this.setSidebar(compact ? 'compact' : 'expanded');
    // Oculta las etiquetas de texto de los botones de la barra superior (CSS lo resuelve).
    root.dataset.toolbarLabels = this.settings.get('appearance.showToolbarLabels') === false ? 'off' : 'on';
  }

  #startClock() {
    this.#clockTimer = setInterval(() => {
      const view = this.#views.get(this.#activeView);
      view?.tick?.();
    }, 1000);
  }

  /* ------------------------------------------------------------------ *\
   * Views and chrome state
   * \* ------------------------------------------------------------------ */

  switchView(id, { initial = false } = {}) {
    if (!this.#views.has(id)) {
      this.notifications.warn(`La vista «${id}» no existe`);
      return { ok: false };
    }
    if (!initial && id === this.#activeView) return { ok: true, unchanged: true };
    const previous = this.#views.get(this.#activeView);
    if (!initial) previous?.deactivate?.();

    this.#activeView = id;
    for (const [viewId, element] of this.#viewElements) element.hidden = viewId !== id;
    for (const section of SIDEBAR_SECTIONS) {
      const item = this.#nodes[`nav_${section.id}`];
      if (item) {
        const active = section.id === id;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-current', active ? 'page' : null);
      }
    }
    const view = this.#views.get(id);
    Promise.resolve(view.activate?.({ initial })).catch((err) => {
      this.errorBus.report(err, { source: `vista:${id}`, kind: 'UI' });
    });
    this.plugins.broadcast('onViewChange', { view: id, previous: this.#activeView });
    this.eventBus?.emit('view:changed', { view: id, previous });
    this.session?.schedule?.();
    if (!initial) this.logger.debug(`Vista activa: ${id}`, { source: 'App' });

    const element = this.#viewElements.get(id);
    const firstFocusable = element?.querySelector('.cm-content, [tabindex="0"], button, input');
    if (id === 'editor') {
      requestAnimationFrame(() => {
        this.editor.view?.requestMeasure?.();
        this.editor.focus();
      });
    }
    else if (firstFocusable instanceof HTMLElement && document.activeElement === document.body) firstFocusable.focus();
    return { ok: true, view: id };
  }

  setSidebar(mode) {
    this.#sidebarMode = mode === 'compact' ? 'compact' : 'expanded';
    this.#root.dataset.sidebar = this.#sidebarMode;
    return { ok: true, sidebar: this.#sidebarMode };
  }

  toggleSidebar() {
    const next = this.#sidebarMode === 'compact' ? 'expanded' : 'compact';
    this.setSidebar(next);
    if (this.settings.get('appearance.compactSidebar') !== (next === 'compact')) {
      void this.settings.set({ 'appearance.compactSidebar': next === 'compact' });
    }
    return { ok: true, sidebar: next };
  }

  async toggleFullscreen() {
    const result = await this.windowController?.toggleFullscreen?.();
    if (result?.ok === false) this.notifications.warn(result.reason ?? 'La pantalla completa no está disponible en este entorno');
    return result;
  }

  /* ------------------------------------------------------------------ *\
   * Runtime actions
   * \* ------------------------------------------------------------------ */

  async runActive({ server = false, engineId = null } = {}) {
    const document = this.editor.activeDocument;
    if (!document) {
      this.notifications.info('Abre o crea un script antes de ejecutar');
      this.switchView('editor');
      return { ok: false, reason: 'sin documento' };
    }
    if (this.runtime.isRunning) {
      this.notifications.info('Ya hay una ejecución en curso; deténla o espera a que termine');
      return { ok: false, reason: 'en ejecución' };
    }
    if (this.settings.get('execution.confirmBeforeRun') === true) {
      const confirmed = await this.dialogs.confirm({
        title: 'Ejecutar script',
        message: `Se ejecutará «${document.name}» con el motor disponible.`,
        confirmLabel: 'Ejecutar',
      });
      if (!confirmed) return { ok: false, reason: 'cancelado' };
    }
    if (this.settings.get('execution.clearConsoleOnRun') !== false) this.console.clear();
    if (this.settings.get('execution.focusConsoleOnRun') === true) this.switchView('console');

    const engine = server
      ? this.runtime.engines.find((candidate) => candidate.mode === 'server' && candidate.available) ?? null
      : null;
    const result = await this.runtime.execute({
      source: this.editor.getValue(),
      name: document.name,
      dialect: document.dialect,
      engineId: engineId ?? engine?.id ?? null,
      tabId: document.id,
      origin: server ? 'user-server' : 'user',
      options: {},
    });
    if (result?.state === RuntimeState.UNAVAILABLE) {
      const report = result.error?.detail ?? this.runtime.unavailableReport(document.dialect);
      const reason = report?.requirement ?? result.error?.message ?? 'no hay ningún motor disponible';
      this.notifications.error(`No se puede ejecutar «${document.name}»: ${reason}`, { durationMs: 9000 });
    }
    if (this.settings.get('execution.showOutput') === false) this.switchView('editor');
    else if (this.settings.get('execution.focusConsoleOnRun') !== true) this.#showRunResultBadge(result);
    return result;
  }

  #showRunResultBadge(result) {
    if (!result) return;
    if (result.state === RuntimeState.SUCCESS) {
      const value = result.returnValues?.length ? ` · ${result.returnValues.map((entry) => entry.value).join(', ')}` : '';
      this.notifications.success(`${result.name ?? 'script'} terminó en ${formatDuration(result.stats?.durationMs ?? result.durationMs ?? 0)}${value}`, { durationMs: 3200 });
    } else if (result.state === RuntimeState.ERROR) {
      this.notifications.error(`${result.name ?? 'script'}: ${result.error?.message ?? 'error'}`, { durationMs: 8000 });
    }
  }

  async stopExecution() {
    const result = await this.runtime.cancel('user');
    if (result?.ok === false) this.notifications.warn(result.reason ?? 'No había ninguna ejecución que detener');
    else this.notifications.info('Ejecución detenida');
    return result;
  }

  /* ------------------------------------------------------------------ *\
   * File actions
   * ------------------------------------------------------------------ */

  async newScript() {
    const count = (this.scripts.getStats().total ?? 0) + 1;
    const name = await this.dialogs.prompt({
      title: 'Nuevo script',
      message: 'Se creará un script Luau guardado en tu carpeta de datos.',
      label: 'Nombre del archivo',
      value: `script-${count}.luau`,
      confirmLabel: 'Crear',
      validate: (value) => (String(value).trim().length < 2 ? 'El nombre necesita al menos 2 caracteres' : null),
    });
    if (name === null) return { ok: false, reason: 'cancelado' };
    const result = await this.scripts.create({
      name: String(name).trim(),
      content: `-- ${String(name).trim()}\n-- Creado con Lumen Studio\n\nlocal function main()\n\tprint("Hola desde Lumen Studio")\nend\n\nmain()\n`,
      dialect: this.settings.get('execution.defaultDialect') ?? Dialect.LUAU,
      open: true,
    });
    if (!result.ok) {
      this.notifications.error(result.error?.message ?? 'No se pudo crear el script');
      return result;
    }
    this.switchView('editor');
    this.notifications.success(`Script creado: ${result.script.name}`);
    return result;
  }

  async openPicker() {
    if (!this.scripts.serverAvailable) {
      this.notifications.error('El servidor local no está disponible: no se pueden abrir scripts guardados');
      return { ok: false };
    }
    await this.scripts.refresh().catch(() => {});
    const list = this.scripts.scripts;
    if (list.length === 0) {
      this.notifications.info('Todavía no hay scripts guardados; crea el primero con Ctrl+N');
      return { ok: true, empty: true };
    }
    this.palette.pick({
      title: 'Abrir script',
      placeholder: 'Busca por nombre, categoría o etiqueta…',
      items: list.map((script) => ({
        label: script.name,
        detail: [script.dialect, script.tags?.join(', '), formatRelative(script.modifiedAt)].filter(Boolean).join(' · '),
        keywords: [script.category ?? '', ...(script.tags ?? [])],
        icon: script.favorite ? 'star' : 'file-code',
        id: script.id,
      })),
      onPick: (item) => void this.#openScriptById(item.id),
    });
    return { ok: true, count: list.length };
  }

  async #openScriptById(id) {
    const result = await this.scripts.open(id, { focus: true });
    if (result.ok === false) this.notifications.error(result.error?.message ?? 'No se pudo abrir el script');
    else this.switchView('editor');
  }

  /**
   * Saves the active document. A tab that is not yet a script on disk is created as one, so the
   * action always does something real.
   */
  async saveActive({ as = false } = {}) {
    const tab = this.tabs.activeTab;
    if (!tab) {
      this.notifications.info('No hay ningún archivo abierto que guardar');
      return { ok: false, reason: 'sin pestaña' };
    }
    if (as || !tab.saved) {
      const name = await this.dialogs.prompt({
        title: as ? 'Guardar como' : 'Guardar script',
        message: tab.saved ? `Se guardará una copia de «${tab.name}».` : 'Este archivo todavía no existe en el disco: elige su nombre.',
        label: 'Nombre del archivo',
        value: tab.name,
        confirmLabel: 'Guardar',
        validate: (value) => (String(value).trim().length < 2 ? 'El nombre necesita al menos 2 caracteres' : null),
      });
      if (name === null) return { ok: false, reason: 'cancelado' };
      if (!tab.saved) {
        const created = await this.scripts.create({
          name: String(name).trim(),
          content: this.editor.getValue(tab.id) ?? '',
          dialect: tab.dialect,
          open: true,
        });
        if (!created.ok) {
          this.notifications.error(created.error?.message ?? 'No se pudo guardar el script');
          return created;
        }
        this.tabs.activate(created.script.id);
        this.editor.markSaved?.(created.script.id, { content: this.editor.getValue(created.script.id) ?? '' });
        this.notifications.success(`Guardado como ${created.script.name}`);
        return created;
      }
      const saved = await this.scripts.saveAs(tab.id, { name: String(name).trim() });
      if (!saved.ok) {
        this.notifications.error(saved.error?.message ?? 'No se pudo guardar la copia');
        return saved;
      }
      this.notifications.success(`Copia guardada como ${saved.script.name}`);
      return saved;
    }
    const result = await this.scripts.save(tab.id, { content: this.editor.getValue(tab.id) });
    if (!result.ok) {
      if (result.conflict) {
        this.notifications.warn(`«${tab.name}» cambió en el disco: ${result.error?.message ?? 'contenido desincronizado'}`, { durationMs: 9000 });
      } else {
        this.notifications.error(result.error?.message ?? 'No se pudo guardar');
      }
      return result;
    }
    this.notifications.success(`Guardado ${tab.name}`, { durationMs: 2000 });
    return result;
  }

  async closeActiveTab() {
    const tab = this.tabs.activeTab;
    if (!tab) return { ok: false, reason: 'sin pestaña' };
    return this.tabs.close(tab.id);
  }

  async importScript() {
    const input = el('input', {
      attrs: { type: 'file', accept: '.lua,.luau,.lua54,.txt,text/plain' },
    });
    const file = await new Promise((resolve) => {
      input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
      input.addEventListener('cancel', () => resolve(null), { once: true });
      input.click();
    });
    if (!file) return { ok: false, reason: 'cancelado' };
    const result = await this.scripts.importFile(file);
    if (!result.ok) {
      this.notifications.error(result.error?.message ?? 'No se pudo importar el archivo');
      return result;
    }
    this.notifications.success(`Importado ${result.script.name}`);
    this.switchView('editor');
    return result;
  }

  async exportActive() {
    const tab = this.tabs.activeTab;
    if (!tab?.saved) {
      this.notifications.info('Guarda el archivo primero para poder exportarlo');
      return { ok: false, reason: 'sin guardar' };
    }
    const result = await this.scripts.exportDownload(tab.id);
    if (!result.ok) this.notifications.error(result.error?.message ?? 'No se pudo exportar');
    else this.notifications.success(`Descargado ${result.filename}`);
    return result;
  }

  async formatDocument() {
    const document = this.editor.activeDocument;
    if (!document) {
      this.notifications.info('No hay ningún documento activo que formatear');
      return { ok: false };
    }
    const result = await this.editor.format();
    if (result?.ok === false) {
      this.notifications.error(`No se pudo formatear: ${result.error?.message ?? result.reason ?? 'error desconocido'}`);
      return result;
    }
    if (result?.changed === false) this.notifications.info('El documento ya estaba formateado');
    else this.notifications.success(`Documento formateado (${result.changes ?? result.edits ?? '—'} cambios)`);
    return result;
  }

  async analyzeNow() {
    const document = this.editor.activeDocument;
    if (!document) {
      this.notifications.info('No hay ningún documento activo que analizar');
      return { ok: false };
    }
    const diagnostics = await this.editor.analyzeNow();
    const errors = diagnostics.filter((entry) => entry.severity === 'error').length;
    if (diagnostics.length === 0) this.notifications.success('Análisis completado sin problemas');
    else this.notifications.info(`Análisis completado: ${diagnostics.length} diagnósticos (${errors} errores)`, { durationMs: 5000 });
    return { ok: true, diagnostics };
  }

  async annotateTypes() {
    const document = this.editor.activeDocument;
    if (!document) {
      this.notifications.info('No hay ningún documento activo');
      return { ok: false };
    }
    try {
      const source = await this.editor.annotatedSource();
      const name = `${document.name.replace(/\.[^.]+$/, '')}-anotado.luau`;
      const created = await this.scripts.create({ name, content: source, dialect: document.dialect, open: true });
      if (!created.ok) throw new Error(created.error?.message ?? 'no se pudo crear la copia anotada');
      this.notifications.success(`Copia con anotaciones creada: ${created.script.name}`);
      this.switchView('editor');
      return created;
    } catch (err) {
      this.notifications.error(`No se pudieron anotar los tipos: ${err.message}`);
      return { ok: false, error: err };
    }
  }

  async gotoLine() {
    const active = this.editor.activeDocument;
    const value = await this.dialogs.prompt({
      title: 'Ir a línea',
      message: active ? `Documento activo: ${active.name} (${(this.editor.getValue() ?? '').split('\n').length} líneas)` : 'No hay ningún documento activo',
      label: 'Número de línea (o línea:columna)',
      value: '1',
      confirmLabel: 'Ir',
      validate: (input) => (/^\d+(:\d+)?$/.test(String(input).trim()) ? null : 'Escribe un número, por ejemplo 42 o 42:8'),
    });
    if (value === null) return { ok: false };
    const [line, column] = String(value).trim().split(':');
    return this.editor.gotoLine(Number(line), column ? Number(column) : null);
  }

  async searchProject() {
    const term = await this.dialogs.prompt({
      title: 'Buscar en todos los scripts',
      message: 'Busca el texto en el contenido de todos los scripts guardados.',
      label: 'Texto a buscar',
      value: '',
      confirmLabel: 'Buscar',
      validate: (input) => (String(input).trim().length < 2 ? 'Escribe al menos 2 caracteres' : null),
    });
    if (term === null) return { ok: false };
    const result = await this.scripts.search(String(term).trim(), { inContent: true, limit: 100 });
    if (!result.ok) {
      this.notifications.error(result.error?.message ?? 'La búsqueda falló');
      return result;
    }
    const results = result.results ?? [];
    if (results.length === 0) {
      this.notifications.info(`Sin resultados para «${term}»`);
      return result;
    }
    this.palette.pick({
      title: `Resultados para «${term}»`,
      placeholder: 'Filtrar resultados…',
      items: results.map((entry) => ({
        label: entry.name ?? entry.id,
        detail: [entry.matches ? `${entry.matches} coincidencias` : null, entry.snippet ?? null].filter(Boolean).join(' · '),
        icon: 'file-code',
        id: entry.id,
        line: entry.line ?? null,
      })),
      onPick: async (item) => {
        await this.#openScriptById(item.id);
        if (item.line) this.editor.gotoLine(item.line, null);
      },
    });
    return { ok: true, results: results.length };
  }

  /* ------------------------------------------------------------------ *\
   * Console helpers
   * ------------------------------------------------------------------ */

  focusConsole(level = null, { clear = false } = {}) {
    this.switchView('console');
    if (clear) return this.console.clear();
    if (level) {
      for (const name of ['ERROR', 'WARNING', 'SUCCESS', 'INFO', 'DEBUG', 'TRACE', 'INPUT', 'OUTPUT']) {
        this.console.setLevelVisible(name, name === level);
      }
      this.notifications.info(`Consola filtrada por ${level}`);
    }
    return { ok: true };
  }

  exportConsole() {
    const result = this.console.exportLogs({ format: 'txt' });
    if (result.ok) this.notifications.success(`Registro exportado: ${result.filename}`);
    else this.notifications.error(result.error?.message ?? 'No se pudo exportar la consola');
    return result;
  }

  async copyConsole() {
    const result = await this.console.copyAll();
    if (result.ok) this.notifications.success(`Consola copiada (${result.bytes} caracteres)`);
    else this.notifications.error(`No se pudo copiar: ${result.error?.message ?? 'error'} (puedes exportarla como archivo)`);
    return result;
  }

  showRuntimePanel() {
    this.switchView('dashboard');
    const runtime = this.runtime.stats();
    this.notifications.info(
      `Runtime ${this.runtime.state}: ${runtime.total} ejecuciones · ${runtime.averageDurationMs ? formatDuration(runtime.averageDurationMs) : 'sin media'} de media`,
      { durationMs: 6000 },
    );
    return runtime;
  }

  openSettings(section = null) {
    this.switchView('settings');
    if (section) this.#views.get('settings')?.focusCategory?.(section);
    return { ok: true };
  }

  showWindowInfo() {
    const info = this.windowController?.geometry;
    const mode = this.windowController?.mode ?? 'browser';
    if (mode === 'browser') {
      this.notifications.info('La ventana la controla el navegador: arrastrar, redimensionar y minimizar dependen del sistema operativo. Arranca `npm run desktop` para una ventana propia.', { durationMs: 8000 });
    } else {
      this.notifications.info(`Ventana nativa: ${info?.width ?? '?'}×${info?.height ?? '?'} en (${info?.x ?? '?'}, ${info?.y ?? '?'})`, { durationMs: 5000 });
    }
    return { ok: true, mode, info };
  }

  /* ------------------------------------------------------------------ *\
   * Appearance and system
   * ------------------------------------------------------------------ */

  async toggleTheme() {
    const current = this.theme.active;
    const targets = this.theme.themes;
    const nextType = (current?.type ?? 'dark') === 'dark' ? 'light' : 'dark';
    const next = targets.find((entry) => entry.type === nextType) ?? targets[0];
    const result = await this.theme.apply(next.id);
    if (result?.ok === false) this.notifications.error(result.error?.message ?? 'No se pudo cambiar el tema');
    else this.notifications.success(`Tema: ${next.name}`);
    return result;
  }

  chooseTheme() {
    const themes = this.theme.themes;
    this.palette.pick({
      title: 'Elegir tema',
      placeholder: 'Filtrar temas…',
      items: themes.map((entry) => ({
        label: entry.name,
        detail: `${entry.type === 'light' ? 'claro' : 'oscuro'} · ${entry.builtin === false ? 'personalizado' : 'incluido'}${entry.author ? ` · ${entry.author}` : ''}`,
        icon: 'palette',
        id: entry.id,
      })),
      onPick: async (item) => {
        const result = await this.theme.apply(item.id);
        if (result?.ok === false) this.notifications.error(result.error?.message ?? 'No se pudo aplicar el tema');
        else this.notifications.success(`Tema aplicado: ${item.label}`);
      },
    });
    return { ok: true, themes: themes.length };
  }

  async toggleSetting(key) {
    const current = this.settings.get(key);
    const next = current === true ? false : true;
    const result = await this.settings.set({ [key]: next });
    if (result?.ok === false) {
      this.notifications.error(result.error?.message ?? `No se pudo cambiar ${key}`);
      return result;
    }
    this.notifications.info(`${key}: ${next ? 'activado' : 'desactivado'}`, { durationMs: 2200 });
    return result;
  }

  reload() {
    this.notifications.info('Recargando la interfaz…', { durationMs: 1200 });
    void this.session?.saveNow({ silent: true }).finally(() => window.location.reload());
    return { ok: true };
  }

  async recheckCapabilities() {
    const results = await this.runtime.refreshServerEngines({ force: true }).catch(() => []);
    const browserResults = await this.runtime.probeBrowserRuntimes().catch(() => []);
    await this.capabilities.detect({ force: true }).catch(() => []);
    const summary = this.capabilities.summary();
    this.#refreshCapabilities();
    return {
      ok: true,
      message: `Capacidades actualizadas: ${summary.available} de ${summary.total} disponibles · ${results.length + browserResults.length} motores comprobados`,
    };
  }

  async downloadDiagnostics() {
    try {
      const [stats, routes] = await Promise.all([
        this.apiClient.get('/api/stats').catch((err) => ({ error: err.message })),
        this.apiClient.get('/api/routes').catch((err) => ({ error: err.message })),
      ]);
      const payload = {
        generatedAt: new Date().toISOString(),
        app: { version: window.__LUMEN_BUILD__ ?? null, startedAt: this.startedAt, sessionMs: Date.now() - this.startedAt },
        environment: {
          userAgent: navigator.userAgent,
          language: navigator.language,
          platform: navigator.platform,
          hardwareConcurrency: navigator.hardwareConcurrency ?? null,
          deviceMemory: navigator.deviceMemory ?? null,
          online: navigator.onLine,
        },
        capabilities: this.capabilities.snapshot(),
        kernel: this.kernel.describe(),
        bootReport: this.kernel.bootReport,
        runtime: this.runtime.snapshot(),
        console: this.console.stats(),
        editor: this.editor.describe(),
        tabs: this.tabs.stats,
        scripts: this.scripts.getStats(),
        plugins: { host: this.plugins.stats(), list: this.plugins.list().map(({ contributes, ...rest }) => rest) },
        settings: this.settings.snapshot(),
        errors: this.errorBus.incidents(50),
        server: stats,
        routes: routes.routes ?? routes,
        logs: this.logger.recent(200),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const filename = `lumen-diagnostico-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      const url = URL.createObjectURL(blob);
      const anchor = el('a', { attrs: { href: url, download: filename } });
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return { ok: true, filename, bytes: blob.size };
    } catch (err) {
      return { ok: false, error: err };
    }
  }

  async exportSettings() {
    const result = await this.settings.exportToFile();
    if (result.ok) this.notifications.success(`Configuración exportada: ${result.filename ?? 'lumen-settings.json'}`);
    else this.notifications.error(result.error?.message ?? 'No se pudo exportar la configuración');
    return result;
  }

  async importSettings() {
    const input = el('input', { attrs: { type: 'file', accept: '.json,application/json' } });
    const file = await new Promise((resolve) => {
      input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
      input.addEventListener('cancel', () => resolve(null), { once: true });
      input.click();
    });
    if (!file) return { ok: false, reason: 'cancelado' };
    const content = await file.text();
    const result = await this.settings.importFromContent(content);
    if (result.ok === false) this.notifications.error(result.error?.message ?? 'No se pudo importar la configuración');
    else this.notifications.success(`Configuración importada (${result.changed?.length ?? 0} valores cambiados)`);
    return result;
  }

  async resetSettings() {
    const confirmed = await this.dialogs.confirm({
      title: 'Restaurar la configuración',
      message: 'Todos los ajustes volverán a sus valores por defecto. Los scripts guardados no se modifican.',
      confirmLabel: 'Restaurar',
      danger: true,
    });
    if (!confirmed) return { ok: false, reason: 'cancelado' };
    for (const category of this.settings.categories) {
      await this.settings.resetSection(category.id).catch(() => {});
    }
    this.notifications.success('Configuración restaurada por defecto');
    return { ok: true };
  }

  async syncScripts() {
    const result = await this.scripts.syncFromDisk();
    if (result.ok === false) {
      this.notifications.error(result.error?.message ?? 'No se pudo reconciliar la biblioteca');
      return result;
    }
    const added = result.added?.length ?? 0;
    const removed = result.removed?.length ?? 0;
    this.notifications.success(`Biblioteca reconciliada: ${added} añadidos, ${removed} eliminados, ${result.updated?.length ?? 0} actualizados`);
    this.switchView('scripts');
    void this.#views.get('scripts')?.reload?.();
    return result;
  }

  async showDataFolder(sub = null) {
    return this.storageUI.open(sub);
  }

  /* ------------------------------------------------------------------ *\
   * State refresh helpers
   * ------------------------------------------------------------------ */

  #onRuntimeState(info) {
    const running = this.runtime.isRunning;
    this.#nodes.runButton.disabled = running || !this.editor.activeDocument;
    this.#nodes.stopButton.disabled = !running;
    this.#nodes.runButton.classList.toggle('is-busy', running);
    const state = this.runtime.stateInfo;
    const label = info?.label ?? state?.label ?? this.runtime.state;
    this.#nodes.engineBadge.textContent = `Runtime: ${label}`;
    this.#nodes.engineBadge.className = `badge badge--${stateTone(this.runtime.state)}`;
    const engine = this.runtime.activeEngine;
    this.#nodes.engineBadge.title = engine ? `Motor: ${engine.label} (${engine.id})` : 'Sin motor activo';
  }

  #onExecution(record) {
    if (!record) return;
    this.plugins.broadcast('onExecutionFinished', {
      name: record.name,
      state: record.state,
      durationMs: record.stats?.durationMs ?? record.durationMs ?? null,
      engineId: record.engineId ?? null,
    });
  }

  #onConnectionState(state) {
    const tone = state === 'connected' || state === 'open' ? 'success' : state === 'connecting' ? 'warning' : 'error';
    this.#nodes.connectionBadge.textContent = `Servidor: ${state}`;
    this.#nodes.connectionBadge.className = `badge badge--${tone}`;
  }

  #refreshTabState() {
    const documents = this.editor.documents?.length ?? 0;
    const dirty = this.tabs.dirtyTabs().length;
    const nav = this.#nodes.nav_editor;
    const badge = nav?.querySelector('.sidebar__badge');
    if (badge) {
      badge.hidden = documents === 0;
      badge.textContent = dirty > 0 ? `${documents}·${dirty}●` : String(documents);
    }
    const diagnostics = this.editor.diagnosticsFor?.() ?? [];
    const errors = diagnostics.filter((entry) => entry.severity === 'error').length;
    const consoleBadge = this.#nodes.nav_console?.querySelector('.sidebar__badge');
    if (consoleBadge) {
      const entries = this.console.stats().total;
      consoleBadge.hidden = entries === 0 && errors === 0;
      consoleBadge.textContent = errors > 0 ? String(errors) : String(entries);
      consoleBadge.classList.toggle('sidebar__badge--error', errors > 0);
    }
    if (!this.runtime.isRunning) this.#nodes.runButton.disabled = documents === 0;
  }

  #refreshConsoleBadge() {
    const errors = this.console.count('ERROR');
    const badge = this.#nodes.nav_console?.querySelector('.sidebar__badge');
    if (badge) {
      badge.textContent = String(this.console.stats().total);
      badge.hidden = this.console.stats().total === 0;
      badge.classList.toggle('sidebar__badge--error', errors > 0);
    }
  }

  #refreshPluginBadge() {
    const stats = this.plugins.stats();
    const badge = this.#nodes.nav_plugins?.querySelector('.sidebar__badge');
    if (badge) {
      badge.hidden = stats.discovered === 0;
      badge.textContent = String(stats.running ?? 0);
      badge.classList.toggle('sidebar__badge--error', (stats.failed ?? 0) > 0);
    }
  }

  #refreshErrorBadge() {
    const stats = this.errorBus.stats();
    const badge = this.#nodes.nav_about?.querySelector('.sidebar__badge');
    if (badge) {
      badge.hidden = (stats.total ?? 0) === 0;
      badge.textContent = String(stats.total ?? 0);
      badge.classList.toggle('sidebar__badge--error', (stats.total ?? 0) > 0);
      badge.title = (stats.total ?? 0) > 0 ? `Errores registrados en esta sesión: ${stats.total}` : '';
    }
  }

  #refreshCapabilities() {
    const summary = this.capabilities.summary();
    this.#capabilitySummary = summary;
    const badge = this.#nodes.capabilityBadge;
    if (badge) {
      badge.textContent = `${summary.available}/${summary.total}`;
      badge.classList.toggle('sidebar__badge--error', summary.available < summary.total);
      badge.title = `${summary.unavailable} capacidades no disponibles`;
    }
  }

  /* ------------------------------------------------------------------ *\
   * Teardown
   * \* ------------------------------------------------------------------ */

  async dispose() {
    clearTimeout(this.#clockTimer);
    this.#clockTimer = null;
    for (const unsubscribe of this.#unsubscribers.splice(0)) unsubscribe?.();
    for (const view of this.#views.values()) {
      try {
        view.deactivate?.();
      } catch (err) {
        this.logger.warn(`No se pudo desactivar la vista ${view.id}: ${err.message}`, { source: 'App' });
      }
    }
    this.palette?.close('shutdown');
    // El kernel apaga el servicio `ui` como parte de su propio apagado; volver a pedirlo desde
    // aquí produciría una espera circular, así que sólo se solicita si el apagado no está en curso.
    if (this.kernel && this.kernel.isShuttingDown !== true) {
      await this.kernel.shutdown().catch(() => {});
    }
    clear(this.#root);
    return { ok: true };
  }

  /** Snapshot used by the diagnostics report. */
  describe() {
    return {
      view: this.#activeView,
      sidebar: this.#sidebarMode,
      views: [...this.#views.keys()],
      uptimeMs: Date.now() - this.startedAt,
      capabilities: this.#capabilitySummary,
    };
  }
}

function stateTone(state) {
  return {
    [RuntimeState.IDLE]: 'muted',
    [RuntimeState.RUNNING]: 'accent',
    [RuntimeState.SUCCESS]: 'success',
    [RuntimeState.ERROR]: 'error',
    [RuntimeState.STOPPED]: 'warning',
    [RuntimeState.UNAVAILABLE]: 'error',
  }[state] ?? 'muted';
}

