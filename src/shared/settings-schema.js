/**
 * Settings schema — the description of every user-configurable value in the application.
 *
 * Both sides use this file: the server validates and persists against it, and the Settings UI
 * is generated from it (no hardcoded fields). Each definition declares its type, default,
 * bounds and — when it depends on something the environment may not provide — the capability
 * that must be available. A setting whose capability is missing is shown as unavailable with
 * the real reason instead of pretending to work.
 */

import { CapabilityId, Limits } from './constants.js';

/** Settings sections, in the order the UI shows them. */
export const SettingsCategory = Object.freeze({
  GENERAL: 'general',
  EDITOR: 'editor',
  EXECUTION: 'execution',
  APPEARANCE: 'appearance',
  PERFORMANCE: 'performance',
  SHORTCUTS: 'shortcuts',
  STORAGE: 'storage',
});

export const CATEGORY_INFO = Object.freeze({
  [SettingsCategory.GENERAL]: {
    id: SettingsCategory.GENERAL,
    label: 'General',
    description: 'Confirmaciones, guardado automático, sesión y arranque.',
    icon: 'settings',
  },
  [SettingsCategory.EDITOR]: {
    id: SettingsCategory.EDITOR,
    label: 'Editor',
    description: 'Tipografía, comportamiento del texto, ayudas y análisis.',
    icon: 'editor',
  },
  [SettingsCategory.EXECUTION]: {
    id: SettingsCategory.EXECUTION,
    label: 'Ejecución',
    description: 'Motor, límites, salida y registro de ejecuciones.',
    icon: 'play',
  },
  [SettingsCategory.APPEARANCE]: {
    id: SettingsCategory.APPEARANCE,
    label: 'Apariencia',
    description: 'Tema, color de acento, escala y animaciones.',
    icon: 'palette',
  },
  [SettingsCategory.PERFORMANCE]: {
    id: SettingsCategory.PERFORMANCE,
    label: 'Rendimiento',
    description: 'Animaciones reducidas, modo de bajo consumo, límites de memoria y virtualización.',
    icon: 'cpu',
  },
  [SettingsCategory.SHORTCUTS]: {
    id: SettingsCategory.SHORTCUTS,
    label: 'Atajos',
    description: 'Combinaciones de teclado personalizables por comando.',
    icon: 'keyboard',
  },
  [SettingsCategory.STORAGE]: {
    id: SettingsCategory.STORAGE,
    label: 'Almacenamiento',
    description: 'Dónde y cómo se guardan scripts, configuración e historial.',
    icon: 'database',
  },
});

const FONT_STACKS = {
  system: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
  jetbrains: "'JetBrains Mono', 'Fira Code', ui-monospace, Menlo, Consolas, monospace",
  firacode: "'Fira Code', 'JetBrains Mono', ui-monospace, Consolas, monospace",
  courier: "'Courier New', Courier, monospace",
};

/**
 * @typedef {object} SettingDefinition
 * @property {string} key
 * @property {string} category
 * @property {string} label
 * @property {string} description
 * @property {'boolean'|'number'|'string'|'color'|'enum'|'shortcut'|'shortcut-map'|'list'} type
 * @property {any} default
 * @property {Array<{value: any, label: string, description?: string}>} [options]
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [step]
 * @property {string} [unit]
 * @property {string} [requires]            CapabilityId that must be available
 * @property {string} [requiresMessage]     What is missing when the capability is unavailable
 * @property {{key: string, equals?: any, in?: any[], truthy?: boolean}} [enabledWhen]
 * @property {boolean} [restartRequired]
 * @property {boolean} [advanced]
 */

/** @type {Array<SettingDefinition>} */
export const SETTINGS_SCHEMA = [
  /* ------------------------------- General ------------------------------- */
  {
    key: 'general.confirmDestructive',
    category: SettingsCategory.GENERAL,
    label: 'Confirmar acciones destructivas',
    description: 'Pide confirmación antes de eliminar scripts, vaciar la papelera o descartar cambios.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'general.confirmCloseUnsaved',
    category: SettingsCategory.GENERAL,
    label: 'Confirmar cierre con cambios sin guardar',
    description: 'Al cerrar una pestaña con cambios pregunta si guardar, descartar o cancelar.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'general.confirmOnExit',
    category: SettingsCategory.GENERAL,
    label: 'Confirmar al salir',
    description: 'Avisa si hay pestañas con cambios sin guardar cuando se cierra la aplicación.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'general.autoSave',
    category: SettingsCategory.GENERAL,
    label: 'Guardado automático',
    description: 'Guarda el script activo unos instantes después de la última edición.',
    type: 'boolean',
    default: false,
  },
  {
    key: 'general.autoSaveDelayMs',
    category: SettingsCategory.GENERAL,
    label: 'Retardo del guardado automático',
    description: 'Tiempo de inactividad antes de guardar automáticamente.',
    type: 'number',
    default: Limits.autoSaveDelayMs,
    min: 300,
    max: 15000,
    step: 100,
    unit: 'ms',
    enabledWhen: { key: 'general.autoSave' },
  },
  {
    key: 'general.restoreSession',
    category: SettingsCategory.GENERAL,
    label: 'Restaurar sesión',
    description: 'Reabre los archivos y la vista en los que estabas al volver a entrar.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'general.restoreOpenTabs',
    category: SettingsCategory.GENERAL,
    label: 'Restaurar pestañas abiertas',
    description: 'Reabre exactamente las pestañas (y el cursor) de la sesión anterior.',
    type: 'boolean',
    default: true,
    enabledWhen: { key: 'general.restoreSession' },
  },
  {
    key: 'general.startupView',
    category: SettingsCategory.GENERAL,
    label: 'Vista inicial',
    description: 'Qué se muestra al abrir la aplicación.',
    type: 'enum',
    default: 'dashboard',
    options: [
      { value: 'dashboard', label: 'Panel', description: 'Resumen con el estado real del entorno.' },
      { value: 'editor', label: 'Editor', description: 'Ir directamente al editor.' },
      { value: 'last', label: 'Última vista', description: 'La sección en la que estabas.' },
    ],
  },
  {
    key: 'general.startSidebarCollapsed',
    category: SettingsCategory.GENERAL,
    label: 'Barra lateral compacta al iniciar',
    description: 'Arranca con la barra lateral reducida a iconos.',
    type: 'boolean',
    default: false,
  },
  {
    key: 'general.rememberWindowGeometry',
    category: SettingsCategory.GENERAL,
    label: 'Recordar tamaño y posición',
    description: 'Guarda el tamaño y la posición de la ventana (requiere la ventana nativa).',
    type: 'boolean',
    default: true,
    requires: CapabilityId.WINDOW_NATIVE,
    requiresMessage: 'Sin la ventana nativa (Electron) el navegador controla el tamaño y la posición.',
  },
  {
    key: 'general.showTipsOnStartup',
    category: SettingsCategory.GENERAL,
    label: 'Mostrar consejos al iniciar',
    description: 'Un aviso corto con un atajo útil al abrir la aplicación.',
    type: 'boolean',
    default: true,
  },

  /* -------------------------------- Editor -------------------------------- */
  {
    key: 'editor.fontFamily',
    category: SettingsCategory.EDITOR,
    label: 'Tipografía',
    description: 'Familia tipográfica monoespaciada del editor.',
    type: 'enum',
    default: 'system',
    options: [
      { value: 'system', label: 'Monoespaciada del sistema' },
      { value: 'jetbrains', label: 'JetBrains Mono' },
      { value: 'firacode', label: 'Fira Code' },
      { value: 'courier', label: 'Courier New' },
    ],
    advanced: true,
  },
  {
    key: 'editor.fontSize',
    category: SettingsCategory.EDITOR,
    label: 'Tamaño de fuente',
    description: 'Tamaño del texto del editor en píxeles.',
    type: 'number',
    default: 14,
    min: 10,
    max: 32,
    step: 1,
    unit: 'px',
  },
  {
    key: 'editor.lineHeight',
    category: SettingsCategory.EDITOR,
    label: 'Altura de línea',
    description: 'Multiplicador del interlineado.',
    type: 'number',
    default: 1.55,
    min: 1,
    max: 2.4,
    step: 0.05,
    unit: '×',
    advanced: true,
  },
  {
    key: 'editor.tabSize',
    category: SettingsCategory.EDITOR,
    label: 'Tamaño de tabulación',
    description: 'Número de columnas que ocupa un tabulador.',
    type: 'number',
    default: 4,
    min: 1,
    max: 8,
    step: 1,
    unit: 'espacios',
  },
  {
    key: 'editor.insertSpaces',
    category: SettingsCategory.EDITOR,
    label: 'Insertar espacios',
    description: 'Usa espacios en lugar de tabuladores al indentar.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'editor.autoIndent',
    category: SettingsCategory.EDITOR,
    label: 'Indentación automática',
    description: 'Mantiene y ajusta la indentación con las reglas de Lua/Luau.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'editor.autoCloseBrackets',
    category: SettingsCategory.EDITOR,
    label: 'Cerrar paréntesis automáticamente',
    description: 'Cierra paréntesis, corchetes, llaves y comillas al escribirlos.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'editor.matchBrackets',
    category: SettingsCategory.EDITOR,
    label: 'Resaltar pares de paréntesis',
    description: 'Marca el par correspondiente y permite navegar entre ellos.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'editor.highlightActiveLine',
    category: SettingsCategory.EDITOR,
    label: 'Resaltar línea activa',
    description: 'Fondo sutil en la línea donde está el cursor.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'editor.lineNumbers',
    category: SettingsCategory.EDITOR,
    label: 'Números de línea',
    description: 'Muestra la columna de números de línea.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'editor.foldGutter',
    category: SettingsCategory.EDITOR,
    label: 'Plegado de bloques',
    description: 'Permite plegar funciones y bloques desde el margen.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'editor.wordWrap',
    category: SettingsCategory.EDITOR,
    label: 'Ajuste de línea',
    description: 'Rompe las líneas largas para que no haya desplazamiento horizontal.',
    type: 'boolean',
    default: false,
  },
  {
    key: 'editor.wrapColumn',
    category: SettingsCategory.EDITOR,
    label: 'Columna de ajuste',
    description: 'Ancho al que se ajusta el texto cuando el ajuste de línea está activo.',
    type: 'number',
    default: 100,
    min: 40,
    max: 240,
    step: 1,
    unit: 'columnas',
    enabledWhen: { key: 'editor.wordWrap' },
  },
  {
    key: 'editor.showWhitespace',
    category: SettingsCategory.EDITOR,
    label: 'Mostrar espacios y tabulaciones',
    description: 'Hace visibles los espacios, tabuladores y finales de línea.',
    type: 'boolean',
    default: false,
    advanced: true,
  },
  {
    key: 'editor.highlightSelectionMatches',
    category: SettingsCategory.EDITOR,
    label: 'Resaltar coincidencias de la selección',
    description: 'Marca todas las apariciones del texto seleccionado.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'editor.multiCursor',
    category: SettingsCategory.EDITOR,
    label: 'Cursores múltiples',
    description: 'Permite varios cursores y selecciones simultáneas.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'editor.autocomplete',
    category: SettingsCategory.EDITOR,
    label: 'Autocompletado',
    description: 'Sugerencias de la librería estándar, del archivo y del analizador.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'editor.autocompleteDelayMs',
    category: SettingsCategory.EDITOR,
    label: 'Retardo del autocompletado',
    description: 'Espera antes de pedir sugerencias mientras se escribe.',
    type: 'number',
    default: Limits.completionDebounceMs,
    min: 0,
    max: 1000,
    step: 10,
    unit: 'ms',
    advanced: true,
  },
  {
    key: 'editor.snippets',
    category: SettingsCategory.EDITOR,
    label: 'Fragmentos de código',
    description: 'Plantillas con tabuladores (if, for, function, class…) integradas en el autocompletado.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'editor.syntaxHighlighting',
    category: SettingsCategory.EDITOR,
    label: 'Resaltado de sintaxis',
    description: 'Colorea Lua y Luau según los tokens reales del lenguaje.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'editor.minimap',
    category: SettingsCategory.EDITOR,
    label: 'Minimapa',
    description: 'Vista reducida del archivo con indicador de la parte visible.',
    type: 'boolean',
    default: false,
    requires: CapabilityId.UI_CANVAS,
    requiresMessage: 'El minimapa dibuja el archivo en un canvas 2D.',
  },
  {
    key: 'editor.analysisEnabled',
    category: SettingsCategory.EDITOR,
    label: 'Análisis de tipos',
    description: 'Analiza el archivo con el comprobador real de Luau (diagnósticos y tipos).',
    type: 'boolean',
    default: true,
    requires: CapabilityId.ANALYSIS_TYPES,
    requiresMessage: 'El análisis usa el comprobador de Luau incluido en el servidor.',
  },
  {
    key: 'editor.lintOnType',
    category: SettingsCategory.EDITOR,
    label: 'Analizar mientras escribo',
    description: 'Reanaliza tras cada pausa; si se desactiva, solo al guardar o al pulsar Ctrl+Shift+A.',
    type: 'boolean',
    default: true,
    enabledWhen: { key: 'editor.analysisEnabled' },
  },
  {
    key: 'editor.analysisDelayMs',
    category: SettingsCategory.EDITOR,
    label: 'Retardo del análisis',
    description: 'Inactividad necesaria antes de reanalizar.',
    type: 'number',
    default: Limits.analysisDebounceMs,
    min: 120,
    max: 3000,
    step: 20,
    unit: 'ms',
    enabledWhen: { key: 'editor.analysisEnabled' },
  },
  {
    key: 'editor.formatOnSave',
    category: SettingsCategory.EDITOR,
    label: 'Formatear al guardar',
    description: 'Aplica el formateador de Lua/Luau antes de escribir el archivo.',
    type: 'boolean',
    default: false,
  },
  {
    key: 'editor.scrollPastEnd',
    category: SettingsCategory.EDITOR,
    label: 'Desplazar más allá del final',
    description: 'Permite dejar la última línea en el centro de la pantalla.',
    type: 'boolean',
    default: true,
    advanced: true,
  },
  {
    key: 'editor.cursorBlink',
    category: SettingsCategory.EDITOR,
    label: 'Parpadeo del cursor',
    description: 'El cursor parpadea cuando el editor tiene el foco.',
    type: 'boolean',
    default: true,
    advanced: true,
  },

  /* ------------------------------- Execution ------------------------------ */
  {
    key: 'execution.defaultDialect',
    category: SettingsCategory.EXECUTION,
    label: 'Dialecto por defecto',
    description: 'Dialecto con el que se crean los scripts nuevos y se ejecuta el editor cuando el archivo no lo define.',
    type: 'enum',
    default: 'luau',
    options: [
      { value: 'luau', label: 'Luau', description: 'Tipado gradual, sintaxis extendida; motor WASM incluido.' },
      { value: 'lua54', label: 'Lua 5.4', description: 'Implementación de referencia; motor WASM incluido.' },
    ],
  },
  {
    key: 'execution.enginePreference',
    category: SettingsCategory.EXECUTION,
    label: 'Preferencia de motor',
    description: 'Dónde se ejecuta el código cuando hay más de un motor disponible.',
    type: 'enum',
    default: 'auto',
    options: [
      { value: 'auto', label: 'Automático', description: 'El servidor decide el motor más capaz disponible.' },
      { value: 'browser', label: 'Navegador', description: 'Ejecuta en un Web Worker aislado en esta pestaña.' },
      { value: 'server', label: 'Servidor', description: 'Ejecuta en el proceso del servidor (WASM o binario nativo).' },
    ],
  },
  {
    key: 'execution.allowNativeEngines',
    category: SettingsCategory.EXECUTION,
    label: 'Permitir motores nativos',
    description: 'Usa binarios luau/lua5.4 instalados en el sistema cuando estén disponibles.',
    type: 'boolean',
    default: false,
    advanced: true,
  },
  {
    key: 'execution.timeoutMs',
    category: SettingsCategory.EXECUTION,
    label: 'Tiempo máximo de ejecución',
    description: 'Límite real de tiempo; al alcanzarlo el motor se detiene.',
    type: 'number',
    default: 5000,
    min: Limits.minTimeoutMs,
    max: Limits.maxTimeoutMs,
    step: 100,
    unit: 'ms',
    requires: CapabilityId.RUNTIME_TIMEOUT,
    requiresMessage: 'El motor debe poder interrumpir código en ejecución.',
  },
  {
    key: 'execution.enforceTimeout',
    category: SettingsCategory.EXECUTION,
    label: 'Aplicar el límite de tiempo',
    description: 'Detiene la ejecución al superar el tiempo máximo configurado.',
    type: 'boolean',
    default: true,
    enabledWhen: { key: 'execution.timeoutMs' },
  },
  {
    key: 'execution.memoryLimitMb',
    category: SettingsCategory.EXECUTION,
    label: 'Memoria máxima',
    description: 'Límite de memoria del script. El motor Lua 5.4 del navegador no puede imponerlo por script; se aplica cuando el motor lo soporta.',
    type: 'number',
    default: 128,
    min: 4,
    max: 1024,
    step: 4,
    unit: 'MB',
    requires: CapabilityId.RUNTIME_MEMORY_LIMIT,
    requiresMessage: 'El motor debe poder limitar la memoria de la máquina virtual.',
  },
  {
    key: 'execution.outputLimitKb',
    category: SettingsCategory.EXECUTION,
    label: 'Límite de salida',
    description: 'Corta la salida de `print` al superar este tamaño para no saturar la consola.',
    type: 'number',
    default: 256,
    min: 8,
    max: 4096,
    step: 8,
    unit: 'KB',
  },
  {
    key: 'execution.clearConsoleOnRun',
    category: SettingsCategory.EXECUTION,
    label: 'Limpiar la consola al ejecutar',
    description: 'Vacía la consola antes de cada ejecución.',
    type: 'boolean',
    default: false,
  },
  {
    key: 'execution.focusConsoleOnRun',
    category: SettingsCategory.EXECUTION,
    label: 'Enfocar la consola al ejecutar',
    description: 'Lleva el foco a la consola para seguir la salida.',
    type: 'boolean',
    default: false,
  },
  {
    key: 'execution.confirmBeforeRun',
    category: SettingsCategory.EXECUTION,
    label: 'Confirmar antes de ejecutar',
    description: 'Pide confirmación antes de ejecutar código con motores nativos o en el servidor.',
    type: 'boolean',
    default: false,
  },
  {
    key: 'execution.streamOutput',
    category: SettingsCategory.EXECUTION,
    label: 'Salida en tiempo real',
    description: 'Muestra `print` mientras el script se está ejecutando.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'execution.showOutput',
    category: SettingsCategory.EXECUTION,
    label: 'Mostrar la salida del script',
    description: 'Incluye las líneas de `print`/`io.write` en la consola.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'execution.showReturnValues',
    category: SettingsCategory.EXECUTION,
    label: 'Mostrar valores devueltos',
    description: 'Añade al resumen de ejecución los valores que devuelve el script.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'execution.recordHistory',
    category: SettingsCategory.EXECUTION,
    label: 'Registrar ejecuciones',
    description: 'Guarda cada ejecución en el historial del script y en el historial general.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'execution.args',
    category: SettingsCategory.EXECUTION,
    label: 'Argumentos de la línea de comandos',
    description: 'Argumentos disponibles en `arg` dentro del script.',
    type: 'string',
    default: '',
    maxLength: 500,
    advanced: true,
  },

  /* ------------------------------ Appearance ------------------------------ */
  {
    key: 'appearance.theme',
    category: SettingsCategory.APPEARANCE,
    label: 'Tema',
    description: 'Conjunto de colores de toda la interfaz.',
    type: 'string',
    default: 'lumen-dark',
  },
  {
    key: 'appearance.accentColor',
    category: SettingsCategory.APPEARANCE,
    label: 'Color de acento',
    description: 'Color principal de botones, foco y resaltados. Vacío usa el acento del tema.',
    type: 'color',
    default: '',
  },
  {
    key: 'appearance.uiScale',
    category: SettingsCategory.APPEARANCE,
    label: 'Escala de la interfaz',
    description: 'Tamaño general de la interfaz.',
    type: 'number',
    default: 100,
    min: 75,
    max: 150,
    step: 5,
    unit: '%',
  },
  {
    key: 'appearance.transparency',
    category: SettingsCategory.APPEARANCE,
    label: 'Transparencia de paneles',
    description: 'Permite fondos translúcidos con desenfoque en paneles y menús.',
    type: 'boolean',
    default: false,
  },
  {
    key: 'appearance.animations',
    category: SettingsCategory.APPEARANCE,
    label: 'Animaciones',
    description: 'Transiciones y animaciones de la interfaz.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'appearance.compactSidebar',
    category: SettingsCategory.APPEARANCE,
    label: 'Barra lateral compacta',
    description: 'Muestra solo iconos en la barra lateral.',
    type: 'boolean',
    default: false,
  },
  {
    key: 'appearance.showStatusBar',
    category: SettingsCategory.APPEARANCE,
    label: 'Mostrar barra de estado',
    description: 'Barra inferior con el estado real del entorno.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'appearance.showToolbarLabels',
    category: SettingsCategory.APPEARANCE,
    label: 'Etiquetas en la barra superior',
    description: 'Muestra texto junto a los iconos de la barra superior.',
    type: 'boolean',
    default: false,
    advanced: true,
  },
  {
    key: 'appearance.consoleTimestamps',
    category: SettingsCategory.APPEARANCE,
    label: 'Marcas de tiempo en la consola',
    description: 'Muestra la hora de cada entrada.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'appearance.consoleDensity',
    category: SettingsCategory.APPEARANCE,
    label: 'Densidad de la consola',
    description: 'Espaciado vertical de las entradas.',
    type: 'enum',
    default: 'comfortable',
    options: [
      { value: 'compact', label: 'Compacta' },
      { value: 'comfortable', label: 'Cómoda' },
    ],
  },

  /* ----------------------------- Performance ------------------------------ */
  {
    key: 'performance.reducedAnimations',
    category: SettingsCategory.PERFORMANCE,
    label: 'Reducir animaciones',
    description: 'Desactiva transiciones no esenciales (también se detecta la preferencia del sistema).',
    type: 'boolean',
    default: false,
    requires: CapabilityId.UI_REDUCED_MOTION_QUERY,
    requiresMessage: 'La detección de la preferencia del sistema requiere `matchMedia`.',
  },
  {
    key: 'performance.lowPerformanceMode',
    category: SettingsCategory.PERFORMANCE,
    label: 'Modo de bajo consumo',
    description: 'Menos trabajo por fotograma: sin desenfoques, sin sombras suaves y con menos elementos en pantalla.',
    type: 'boolean',
    default: false,
  },
  {
    key: 'performance.consoleMaxEntries',
    category: SettingsCategory.PERFORMANCE,
    label: 'Entradas máximas de la consola',
    description: 'Cuántas entradas se conservan en memoria. Las más antiguas se descartan primero.',
    type: 'number',
    default: Limits.maxConsoleEntries,
    min: 200,
    max: 50000,
    step: 100,
    unit: 'entradas',
  },
  {
    key: 'performance.virtualizeConsole',
    category: SettingsCategory.PERFORMANCE,
    label: 'Virtualizar la consola',
    description: 'Renderiza solo las entradas visibles (recomendado con muchos registros).',
    type: 'boolean',
    default: true,
  },
  {
    key: 'performance.lazyRenderLists',
    category: SettingsCategory.PERFORMANCE,
    label: 'Listas por lotes',
    description: 'Carga la lista de scripts en bloques al desplazarse.',
    type: 'boolean',
    default: true,
    advanced: true,
  },
  {
    key: 'performance.scriptListPageSize',
    category: SettingsCategory.PERFORMANCE,
    label: 'Tamaño de página de la lista de scripts',
    description: 'Cuántos scripts se añaden a la vez al desplazarse.',
    type: 'number',
    default: 60,
    min: 20,
    max: 500,
    step: 10,
    unit: 'elementos',
    enabledWhen: { key: 'performance.lazyRenderLists' },
    advanced: true,
  },
  {
    key: 'performance.backgroundAnalysis',
    category: SettingsCategory.PERFORMANCE,
    label: 'Analizar en segundo plano',
    description: 'Analiza los archivos abiertos aunque no estén activos (máximo 3 a la vez).',
    type: 'boolean',
    default: true,
  },
  {
    key: 'performance.maxOpenTabs',
    category: SettingsCategory.PERFORMANCE,
    label: 'Pestañas máximas',
    description: 'Avisa al superar este número de archivos abiertos.',
    type: 'number',
    default: Limits.maxOpenTabs,
    min: 5,
    max: 200,
    step: 5,
    unit: 'pestañas',
  },
  {
    key: 'performance.animationsFps',
    category: SettingsCategory.PERFORMANCE,
    label: 'Fotogramas por segundo objetivo',
    description: 'Refresco máximo de las animaciones de la interfaz.',
    type: 'number',
    default: 60,
    min: 15,
    max: 144,
    step: 15,
    unit: 'fps',
    advanced: true,
  },

  /* ------------------------------- Shortcuts ------------------------------ */
  {
    key: 'shortcuts.enabled',
    category: SettingsCategory.SHORTCUTS,
    label: 'Atajos activos',
    description: 'Habilita los atajos de teclado globales.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'shortcuts.bindings',
    category: SettingsCategory.SHORTCUTS,
    label: 'Combinaciones por comando',
    description: 'Mapa de comando → combinación. Se edita desde la lista de atajos.',
    type: 'shortcut-map',
    default: {},
    advanced: true,
  },
  {
    key: 'shortcuts.overrides',
    category: SettingsCategory.SHORTCUTS,
    label: 'Cambios respecto a los valores por defecto',
    description: 'Solo se guardan las combinaciones que difieren del valor por defecto.',
    type: 'shortcut-map',
    default: {},
    advanced: true,
  },

  /* -------------------------------- Storage ------------------------------- */
  {
    key: 'storage.backend',
    category: SettingsCategory.STORAGE,
    label: 'Almacenamiento',
    description: 'Dónde viven los scripts y la configuración.',
    type: 'enum',
    default: 'server',
    options: [
      { value: 'server', label: 'Servidor local', description: 'Archivos reales en el directorio de datos (respaldos y papelera incluidos).' },
      { value: 'local', label: 'Navegador', description: 'Guarda en el almacenamiento del navegador; sin respaldos en disco.' },
    ],
  },
  {
    key: 'storage.autoBackup',
    category: SettingsCategory.STORAGE,
    label: 'Respaldos automáticos',
    description: 'Guarda una copia de seguridad antes de sobrescribir un script.',
    type: 'boolean',
    default: true,
    enabledWhen: { key: 'storage.backend', equals: 'server' },
  },
  {
    key: 'storage.backupKeep',
    category: SettingsCategory.STORAGE,
    label: 'Respaldos por script',
    description: 'Cuántas copias se conservan por archivo (las más recientes).',
    type: 'number',
    default: 10,
    min: 1,
    max: 100,
    step: 1,
    unit: 'copias',
    enabledWhen: { key: 'storage.backend', equals: 'server' },
  },
  {
    key: 'storage.historyLimit',
    category: SettingsCategory.STORAGE,
    label: 'Entradas de historial',
    description: 'Cuántas ejecuciones y actividades se guardan en el historial.',
    type: 'number',
    default: Limits.maxHistoryEntries,
    min: 50,
    max: 5000,
    step: 50,
    unit: 'entradas',
  },
  {
    key: 'storage.compactHistory',
    category: SettingsCategory.STORAGE,
    label: 'Compactar historial',
    description: 'Agrupa entradas repetidas al mostrarlo.',
    type: 'boolean',
    default: false,
    advanced: true,
  },
  {
    key: 'storage.saveDrafts',
    category: SettingsCategory.STORAGE,
    label: 'Guardar borradores',
    description: 'Conserva el contenido de pestañas sin guardar para poder recuperarlo tras un cierre.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'storage.watchExternalChanges',
    category: SettingsCategory.STORAGE,
    label: 'Vigilar cambios externos',
    description: 'Avisa si un archivo cambia en el disco mientras está abierto.',
    type: 'boolean',
    default: true,
    enabledWhen: { key: 'storage.backend', equals: 'server' },
    requires: CapabilityId.FILE_SYSTEM_WATCH,
    requiresMessage: 'La vigilancia de archivos requiere el observador del sistema de archivos del servidor.',
  },
  {
    key: 'storage.exportFormat',
    category: SettingsCategory.STORAGE,
    label: 'Formato de exportación',
    description: 'Formato predeterminado al exportar scripts.',
    type: 'enum',
    default: 'source',
    options: [
      { value: 'source', label: 'Solo el código', description: 'Un archivo .luau/.lua listo para usar.' },
      { value: 'json', label: 'JSON con metadatos', description: 'Código + nombre, categoría, etiquetas y fechas.' },
    ],
  },
  {
    key: 'storage.checkNetwork',
    category: SettingsCategory.STORAGE,
    label: 'Comprobar conexión de red',
    description: 'Permite que el arranque realice una petición de prueba para informar si hay salida a Internet.',
    type: 'boolean',
    default: false,
    requires: CapabilityId.NETWORK_OUTBOUND,
    requiresMessage: 'La comprobación hace una petición HTTP real.',
    advanced: true,
  },
  {
    key: 'storage.dataDirectory',
    category: SettingsCategory.STORAGE,
    label: 'Directorio de datos',
    description: 'Ruta real donde el servidor guarda los datos (solo lectura desde la interfaz).',
    type: 'string',
    default: '',
    readOnly: true,
  },
];

export const SETTINGS_BY_KEY = Object.freeze(Object.fromEntries(SETTINGS_SCHEMA.map((definition) => [definition.key, definition])));

/** Every setting of a category (in schema order). */
export function settingsByCategory(category) {
  return SETTINGS_SCHEMA.filter((definition) => definition.category === category);
}

/** Default values for every setting. */
export function buildDefaultSettings() {
  return Object.fromEntries(SETTINGS_SCHEMA.map((definition) => [definition.key, cloneDefault(definition.default)]));
}

function cloneDefault(value) {
  if (Array.isArray(value)) return [...value];
  if (value && typeof value === 'object') return { ...value };
  return value;
}

/**
 * Validates and coerces one value against its definition.
 * @returns {{ok: true, value: any}|{ok: false, message: string, received: any}}
 */
export function validateSettingValue(definition, value) {
  const invalid = (message) => ({ ok: false, message, received: value });

  switch (definition.type) {
    case 'boolean':
      if (typeof value === 'boolean') return { ok: true, value };
      if (value === 'true') return { ok: true, value: true };
      if (value === 'false') return { ok: true, value: false };
      return invalid(`«${definition.label}» espera verdadero o falso`);

    case 'number': {
      const numeric = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(numeric)) return invalid(`«${definition.label}» espera un número`);
      const min = definition.min ?? -Infinity;
      const max = definition.max ?? Infinity;
      if (numeric < min || numeric > max) {
        return invalid(`«${definition.label}» debe estar entre ${min} y ${max}${definition.unit ? ` ${definition.unit}` : ''}`);
      }
      const step = definition.step ?? null;
      if (step && step > 0) {
        const steps = Math.round((numeric - (definition.min ?? 0)) / step);
        const snapped = Number(((definition.min ?? 0) + steps * step).toFixed(6));
        return { ok: true, value: Math.min(max, Math.max(min, snapped)) };
      }
      return { ok: true, value: numeric };
    }

    case 'string':
    case 'color': {
      if (typeof value !== 'string') return invalid(`«${definition.label}» espera un texto`);
      const maxLength = definition.maxLength ?? 400;
      if (value.length > maxLength) return invalid(`«${definition.label}» no puede superar ${maxLength} caracteres`);
      if (definition.type === 'color' && value !== '' && !isCssColor(value)) {
        return invalid(`«${definition.label}» espera un color CSS (por ejemplo #3d7dd8)`);
      }
      return { ok: true, value };
    }

    case 'enum': {
      const allowed = (definition.options ?? []).map((option) => option.value);
      if (allowed.includes(value)) return { ok: true, value };
      return invalid(`«${definition.label}» solo admite: ${allowed.join(', ')}`);
    }

    case 'shortcut':
      if (typeof value !== 'string' || value.trim() === '') return invalid(`«${definition.label}» espera una combinación de teclas`);
      return { ok: true, value: value.trim() };

    case 'shortcut-map': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(`«${definition.label}» espera un mapa de comando → combinación`);
      const entries = Object.entries(value);
      if (entries.length > 400) return invalid(`«${definition.label}» tiene demasiadas entradas`);
      const result = {};
      for (const [commandId, binding] of entries) {
        if (typeof commandId !== 'string' || commandId.length === 0 || commandId.length > 80) {
          return invalid(`«${definition.label}» contiene un identificador de comando inválido`);
        }
        if (typeof binding !== 'string' || binding.length > 40) {
          return invalid(`«${definition.label}»: la combinación de «${commandId}» no es válida`);
        }
        result[commandId] = binding;
      }
      return { ok: true, value: result };
    }

    case 'list': {
      if (!Array.isArray(value)) return invalid(`«${definition.label}» espera una lista`);
      const maxItems = definition.maxItems ?? 100;
      if (value.length > maxItems) return invalid(`«${definition.label}» admite como máximo ${maxItems} elementos`);
      if (value.some((item) => typeof item !== 'string')) return invalid(`«${definition.label}» solo admite textos`);
      return { ok: true, value: [...value] };
    }

    default:
      return invalid(`El tipo «${definition.type}» de «${definition.key}» no está soportado`);
  }
}

function isCssColor(value) {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return true;
  if (/^(rgb|rgba|hsl|hsla)\([0-9.,%\s/+-]*\)$/.test(trimmed)) return true;
  if (/^[a-zA-Z]{3,20}$/.test(trimmed)) return true;
  return false;
}

/** Validates a whole patch. Returns the coerced values plus a per-key error list. */
export function validateSettingsPatch(patch) {
  const values = {};
  const errors = [];
  for (const [key, raw] of Object.entries(patch ?? {})) {
    const definition = SETTINGS_BY_KEY[key];
    if (!definition) {
      errors.push({ key, message: `Configuración desconocida: ${key}` });
      continue;
    }
    if (definition.readOnly) {
      errors.push({ key, message: `«${definition.label}» es de solo lectura` });
      continue;
    }
    const result = validateSettingValue(definition, raw);
    if (result.ok) values[key] = result.value;
    else errors.push({ key, message: result.message, received: result.received });
  }
  return { values, errors };
}

/** True when the setting depends on another one that currently disables it. */
export function isSettingEnabled(definition, values) {
  const condition = definition.enabledWhen;
  if (!condition) return true;
  const current = values?.[condition.key];
  if (condition.truthy) return Boolean(current) === condition.truthy;
  if (Array.isArray(condition.in)) return condition.in.includes(current);
  if ('equals' in condition) return current === condition.equals;
  return Boolean(current);
}

/** Simple text search over key, label and description (used by the Settings UI). */
export function searchSettings(term, { category = null } = {}) {
  const needle = String(term ?? '').trim().toLowerCase();
  const pool = category ? settingsByCategory(category) : SETTINGS_SCHEMA;
  if (needle === '') return [...pool];
  return pool.filter((definition) => (
    definition.key.toLowerCase().includes(needle)
    || definition.label.toLowerCase().includes(needle)
    || definition.description.toLowerCase().includes(needle)
  ));
}

/** Keys whose change requires a full reload (UI cannot hot-apply them). */
export const RESTART_KEYS = Object.freeze(new Set(['storage.backend', 'performance.lowPerformanceMode']));

export function resolveFontStack(id) {
  return FONT_STACKS[id] ?? FONT_STACKS.system;
}

export { FONT_STACKS };
