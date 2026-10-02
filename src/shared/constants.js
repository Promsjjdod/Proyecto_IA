/**
 * Shared constants used by both the Node.js backend and the browser client.
 * This module must stay dependency-free so it can be imported from anywhere.
 */

export const APP = Object.freeze({
  id: 'lumen-studio',
  name: 'Lumen Studio',
  shortName: 'Lumen',
  version: '1.0.0',
  description: 'Entorno profesional de edición y ejecución de scripts Lua/Luau',
  dataDirEnvVar: 'LUMEN_DATA_DIR',
  portEnvVar: 'LUMEN_PORT',
  hostEnvVar: 'LUMEN_HOST',
  defaultPort: 4173,
  defaultHost: '0.0.0.0',
  repository: 'Promsjjdod/Proyecto_IA',
});

/** Execution lifecycle used by RuntimeManager on both sides of the wire. */
export const RuntimeState = Object.freeze({
  IDLE: 'IDLE',
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  ERROR: 'ERROR',
  STOPPED: 'STOPPED',
  UNAVAILABLE: 'UNAVAILABLE',
});

export const RuntimeStateList = Object.freeze(Object.values(RuntimeState));

/** Console / log severities. Ordered from most to least severe. */
export const LogLevel = Object.freeze({
  ERROR: 'ERROR',
  WARNING: 'WARNING',
  SUCCESS: 'SUCCESS',
  INFO: 'INFO',
  DEBUG: 'DEBUG',
  TRACE: 'TRACE',
  INPUT: 'INPUT',
  OUTPUT: 'OUTPUT',
});

export const LogLevelList = Object.freeze(Object.values(LogLevel));

export const LogLevelWeight = Object.freeze({
  ERROR: 0,
  WARNING: 1,
  SUCCESS: 2,
  INPUT: 3,
  OUTPUT: 3,
  INFO: 4,
  DEBUG: 5,
  TRACE: 6,
});

/** Error classification shared by every subsystem. */
export const ErrorKind = Object.freeze({
  INTERNAL: 'INTERNAL',
  UI: 'UI',
  EDITOR: 'EDITOR',
  STORAGE: 'STORAGE',
  RUNTIME: 'RUNTIME',
  PLUGIN: 'PLUGIN',
  NETWORK: 'NETWORK',
  PARSE: 'PARSE',
  SETTINGS: 'SETTINGS',
  THEME: 'THEME',
  SECURITY: 'SECURITY',
  SCRIPT: 'SCRIPT',
  SHORTCUT: 'SHORTCUT',
  COMMAND: 'COMMAND',
});

/** Error codes. Stable strings so tests and the UI can assert on them. */
export const ErrorCode = Object.freeze({
  UNKNOWN: 'E_UNKNOWN',
  NOT_FOUND: 'E_NOT_FOUND',
  ALREADY_EXISTS: 'E_ALREADY_EXISTS',
  INVALID_ARGUMENT: 'E_INVALID_ARGUMENT',
  VALIDATION_FAILED: 'E_VALIDATION_FAILED',
  PERMISSION_DENIED: 'E_PERMISSION_DENIED',
  READ_FAILED: 'E_READ_FAILED',
  WRITE_FAILED: 'E_WRITE_FAILED',
  DELETE_FAILED: 'E_DELETE_FAILED',
  RENAME_FAILED: 'E_RENAME_FAILED',
  CORRUPT_DATA: 'E_CORRUPT_DATA',
  UNSAFE_PATH: 'E_UNSAFE_PATH',
  DIR_NOT_FOUND: 'E_DIR_NOT_FOUND',
  DISK_FULL: 'E_DISK_FULL',
  TIMEOUT: 'E_TIMEOUT',
  CANCELLED: 'E_CANCELLED',
  UNAVAILABLE: 'E_UNAVAILABLE',
  DEPENDENCY_MISSING: 'E_DEPENDENCY_MISSING',
  PLUGIN_INVALID: 'E_PLUGIN_INVALID',
  PLUGIN_DEPENDENCY: 'E_PLUGIN_DEPENDENCY',
  PLUGIN_CYCLE: 'E_PLUGIN_CYCLE',
  PLUGIN_FAILED: 'E_PLUGIN_FAILED',
  NETWORK_FAILED: 'E_NETWORK_FAILED',
  SYNTAX: 'E_SYNTAX',
  RUNTIME: 'E_RUNTIME',
  NOT_IMPLEMENTED: 'E_NOT_IMPLEMENTED',
});

/** Language dialects. Luau and Lua 5.4 are both executed by real engines. */
export const Dialect = Object.freeze({
  LUAU: 'luau',
  LUA54: 'lua54',
});

export const DialectList = Object.freeze(Object.values(Dialect));

export const DialectInfo = Object.freeze({
  [Dialect.LUAU]: Object.freeze({
    id: Dialect.LUAU,
    label: 'Luau',
    description: 'Dialecto de Roblox con tipado gradual, sintaxis mejorada y librerías propias.',
    extensions: ['.luau', '.lua'],
    version: 'Luau 0.739',
  }),
  [Dialect.LUA54]: Object.freeze({
    id: Dialect.LUA54,
    label: 'Lua 5.4',
    description: 'Implementación de referencia de Lua 5.4 con enteros de 64 bits y goto.',
    extensions: ['.lua', '.lua54'],
    version: 'Lua 5.4.7',
  }),
});

/** Execution engines. Every id here maps to a real adapter. */
export const EngineId = Object.freeze({
  BROWSER_LUAU_WASM: 'browser.luau.wasm',
  BROWSER_LUA54_WASM: 'browser.lua54.wasm',
  SERVER_LUAU_WASM: 'server.luau.wasm',
  SERVER_LUA54_WASM: 'server.lua54.wasm',
  NATIVE_LUAU: 'native.luau',
  NATIVE_LUA54: 'native.lua54',
});

/** Which engine can execute which dialect. */
export const EngineDialect = Object.freeze({
  [EngineId.BROWSER_LUAU_WASM]: Dialect.LUAU,
  [EngineId.BROWSER_LUA54_WASM]: Dialect.LUA54,
  [EngineId.SERVER_LUAU_WASM]: Dialect.LUAU,
  [EngineId.SERVER_LUA54_WASM]: Dialect.LUA54,
  [EngineId.NATIVE_LUAU]: Dialect.LUAU,
  [EngineId.NATIVE_LUA54]: Dialect.LUA54,
});

export const EngineInfo = Object.freeze({
  [EngineId.BROWSER_LUAU_WASM]: Object.freeze({
    id: EngineId.BROWSER_LUAU_WASM,
    label: 'Luau (WASM, navegador)',
    scope: 'browser',
    dialect: Dialect.LUAU,
    requires: ['workers', 'webAssembly'],
    description: 'Runtime oficial de Luau compilado a WebAssembly, aislado en un Web Worker.',
    isolation: 'web-worker',
    cancel: 'abort-signal',
  }),
  [EngineId.BROWSER_LUA54_WASM]: Object.freeze({
    id: EngineId.BROWSER_LUA54_WASM,
    label: 'Lua 5.4 (WASM, navegador)',
    scope: 'browser',
    dialect: Dialect.LUA54,
    requires: ['workers', 'webAssembly'],
    description: 'Lua 5.4.7 compilado a WebAssembly dentro de un Worker terminable.',
    isolation: 'web-worker',
    cancel: 'terminate',
  }),
  [EngineId.SERVER_LUAU_WASM]: Object.freeze({
    id: EngineId.SERVER_LUAU_WASM,
    label: 'Luau (WASM, servidor)',
    scope: 'server',
    dialect: Dialect.LUAU,
    requires: ['node', 'webAssembly'],
    description: 'Luau en el servidor local mediante worker_threads con límites reales.',
    isolation: 'worker-thread',
    cancel: 'abort-signal',
  }),
  [EngineId.SERVER_LUA54_WASM]: Object.freeze({
    id: EngineId.SERVER_LUA54_WASM,
    label: 'Lua 5.4 (WASM, servidor)',
    scope: 'server',
    dialect: Dialect.LUA54,
    requires: ['node', 'webAssembly'],
    description: 'Lua 5.4 en un proceso hijo terminable, con límites de tiempo y salida.',
    isolation: 'child-process',
    cancel: 'kill',
  }),
  [EngineId.NATIVE_LUAU]: Object.freeze({
    id: EngineId.NATIVE_LUAU,
    label: 'Luau (binario nativo)',
    scope: 'server',
    dialect: Dialect.LUAU,
    requires: ['node', 'nativeBinary:luau'],
    description: 'Binario oficial de Luau detectado en el sistema o compilado con `npm run setup`.',
    isolation: 'child-process',
    cancel: 'kill',
  }),
  [EngineId.NATIVE_LUA54]: Object.freeze({
    id: EngineId.NATIVE_LUA54,
    label: 'Lua 5.4 (binario nativo)',
    scope: 'server',
    dialect: Dialect.LUA54,
    requires: ['node', 'nativeBinary:lua5.4'],
    description: 'Intérprete nativo de Lua 5.4 detectado en el PATH del sistema.',
    isolation: 'child-process',
    cancel: 'kill',
  }),
});

/** Capability states. `FALLBACK` means available through a different implementation. */
export const CapabilityState = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  FALLBACK: 'FALLBACK',
  UNAVAILABLE: 'UNAVAILABLE',
  UNKNOWN: 'UNKNOWN',
});

export const CapabilityId = Object.freeze({
  RUNTIME_LUAU: 'runtime.luau',
  RUNTIME_LUA54: 'runtime.lua54',
  RUNTIME_CANCEL: 'runtime.cancel',
  RUNTIME_TIMEOUT: 'runtime.timeout',
  RUNTIME_MEMORY_LIMIT: 'runtime.memoryLimit',
  RUNTIME_STREAMING: 'runtime.streaming',
  ANALYSIS_TYPES: 'analysis.types',
  ANALYSIS_LINT: 'analysis.lint',
  ANALYSIS_COMPLETION: 'analysis.completion',
  FILE_SYSTEM: 'filesystem',
  FILE_SYSTEM_WATCH: 'filesystem.watch',
  CLIPBOARD: 'clipboard',
  HTTP: 'http',
  UI_WEB: 'ui.web',
  UI_WORKERS: 'ui.workers',
  UI_WASM: 'ui.webAssembly',
  UI_CANVAS: 'ui.canvas2d',
  UI_FILE_PICKER: 'ui.filePicker',
  UI_NOTIFICATIONS: 'ui.notifications',
  UI_FULLSCREEN: 'ui.fullscreen',
  UI_REDUCED_MOTION_QUERY: 'ui.reducedMotionQuery',
  UI_RESIZE_OBSERVER: 'ui.resizeObserver',
  UI_INTERSECTION_OBSERVER: 'ui.intersectionObserver',
  UI_SHARE_API: 'ui.shareApi',
  UI_DOWNLOAD: 'ui.download',
  UI_DRAG_DROP: 'ui.dragAndDrop',
  WINDOW_NATIVE: 'window.native',
  WINDOW_MOVE: 'window.move',
  WINDOW_RESIZE: 'window.resize',
  WINDOW_MINIMIZE: 'window.minimize',
  WINDOW_MAXIMIZE: 'window.maximize',
  WINDOW_CLOSE: 'window.close',
  PERSISTENCE_LOCAL: 'persistence.localStorage',
  PERSISTENCE_INDEXEDDB: 'persistence.indexedDB',
  STORAGE_SERVER: 'storage.server',
  PLUGINS: 'plugins',
  DESKTOP_SHELL: 'desktop.electron',
  NETWORK_OUTBOUND: 'network.outbound',
});

/** Where a capability was reported from. */
export const CapabilityScope = Object.freeze({
  SERVER: 'server',
  BROWSER: 'browser',
  DESKTOP: 'desktop',
});

/** Execution limits actually enforced by the engines. */
export const Limits = Object.freeze({
  defaultTimeoutMs: 10000,
  minTimeoutMs: 100,
  maxTimeoutMs: 300000,
  defaultMemoryLimitBytes: 128 * 1024 * 1024,
  minMemoryLimitBytes: 4 * 1024 * 1024,
  maxMemoryLimitBytes: 1024 * 1024 * 1024,
  defaultOutputLimitBytes: 256 * 1024,
  maxSourceBytes: 2 * 1024 * 1024,
  defaultInterruptLimit: 1000000,
  maxConsoleEntries: 5000,
  maxHistoryEntries: 500,
  maxOpenTabs: 40,
  autoSaveDelayMs: 1500,
  analysisDebounceMs: 500,
  completionDebounceMs: 120,
});

export const ScriptCategory = Object.freeze({
  GENERAL: 'general',
  UTILITY: 'utility',
  GAME: 'game',
  AUTOMATION: 'automation',
  TEST: 'test',
  EXAMPLE: 'example',
});

export const ScriptCategoryList = Object.freeze(Object.values(ScriptCategory));

/** Sort modes supported by the script browser (each maps to real code). */
export const SortMode = Object.freeze({
  NAME_ASC: 'name-asc',
  NAME_DESC: 'name-desc',
  MODIFIED_DESC: 'modified-desc',
  MODIFIED_ASC: 'modified-asc',
  CREATED_DESC: 'created-desc',
  SIZE_DESC: 'size-desc',
  RUNS_DESC: 'runs-desc',
  FAVORITES_FIRST: 'favorites-first',
});

/** Server-Sent Events channels used for real-time streaming to the client. */
export const SseEvent = Object.freeze({
  HELLO: 'hello',
  LOG: 'log',
  RUNTIME_STATE: 'runtime.state',
  RUNTIME_OUTPUT: 'runtime.output',
  RUNTIME_FINISHED: 'runtime.finished',
  SCRIPT_CHANGED: 'script.changed',
  SETTINGS_CHANGED: 'settings.changed',
  THEME_CHANGED: 'theme.changed',
  PLUGIN_CHANGED: 'plugin.changed',
  ERROR: 'error',
  CAPABILITIES: 'capabilities',
  PING: 'ping',
});

export const HttpStatus = Object.freeze({
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL: 500,
  BAD_GATEWAY: 502,
  UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
});

/** localStorage keys used by the browser-side persistence adapter. */
export const LocalKeys = Object.freeze({
  settings: 'lumen.settings.v1',
  session: 'lumen.session.v1',
  history: 'lumen.history.v1',
  layout: 'lumen.layout.v1',
  console: 'lumen.console.v1',
  draftPrefix: 'lumen.draft.v1.',
  plugins: 'lumen.plugins.v1',
});

export const DEFAULT_SCRIPT_TEMPLATE = `--!strict
-- Nuevo script Luau

local function main(): ()
	print("Hola desde Lumen Studio")
end

main()
`;

export const LuaKeywords = Object.freeze([
  'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'if',
  'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while',
]);

export const LuauExtraKeywords = Object.freeze([
  'continue', 'export', 'type', 'declare', 'typeof',
]);

export const LuaBuiltins = Object.freeze([
  'assert', 'collectgarbage', 'dofile', 'error', 'getmetatable', 'ipairs', 'load',
  'loadfile', 'next', 'pairs', 'pcall', 'print', 'rawequal', 'rawget', 'rawlen',
  'rawset', 'require', 'select', 'setmetatable', 'tonumber', 'tostring', 'type',
  'xpcall', '_G', '_VERSION',
]);

export const LuauBuiltins = Object.freeze([
  'assert', 'error', 'getfenv', 'getmetatable', 'ipairs', 'next', 'newproxy', 'pairs',
  'pcall', 'print', 'rawequal', 'rawget', 'rawlen', 'rawset', 'select', 'setfenv',
  'setmetatable', 'tonumber', 'tostring', 'type', 'typeof', 'unpack', 'xpcall',
  'require', 'gcinfo', 'bit32', 'buffer', 'coroutine', 'debug', 'math', 'os', 'string',
  'table', 'utf8', 'task', 'vector', '_G', '_VERSION',
]);

export const LuaStdLibs = Object.freeze([
  'coroutine', 'debug', 'io', 'math', 'os', 'package', 'string', 'table', 'utf8',
]);

export const LuauStdLibs = Object.freeze([
  'bit32', 'buffer', 'coroutine', 'debug', 'math', 'os', 'string', 'table', 'task',
  'utf8', 'vector',
]);
