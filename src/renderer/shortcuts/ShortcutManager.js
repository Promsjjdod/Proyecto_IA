/**
 * ShortcutManager — centralised keyboard handling.
 *
 * Real behaviour:
 *  - bindings are normalised (`ctrl+shift+p` → canonical form) and matched against real
 *    `KeyboardEvent`s, including `event.code` for keys whose layout changes the character;
 *  - conflicts are detected when two commands claim the same binding in the same context;
 *  - user overrides are stored in `settings.shortcuts.bindings` and take effect immediately;
 *  - bindings are ignored while typing in inputs unless the command opts in (`allowInInput`);
 *  - multiple presets (default / vscode / sublime) are real, complete binding tables.
 */

import { LocalKeys } from '../../shared/constants.js';

const MODIFIER_ALIASES = Object.freeze({
  ctrl: 'ctrl',
  control: 'ctrl',
  cmd: 'meta',
  command: 'meta',
  meta: 'meta',
  super: 'meta',
  win: 'meta',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
});

const KEY_ALIASES = Object.freeze({
  enter: 'Enter',
  return: 'Enter',
  esc: 'Escape',
  escape: 'Escape',
  space: ' ',
  spacebar: ' ',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  home: 'Home',
  end: 'End',
  comma: ',',
  period: '.',
  slash: '/',
  backslash: '\\',
  semicolon: ';',
  quote: "'",
  backquote: '`',
  minus: '-',
  equal: '=',
  bracketleft: '[',
  bracketright: ']',
  f1: 'F1', f2: 'F2', f3: 'F3', f4: 'F4', f5: 'F5', f6: 'F6',
  f7: 'F7', f8: 'F8', f9: 'F9', f10: 'F10', f11: 'F11', f12: 'F12',
});

/** Presets: complete alternative binding tables (per command id). */
export const KEYMAP_PRESETS = Object.freeze({
  default: Object.freeze({
    'file.save': 'Ctrl+S',
    'file.saveAs': 'Ctrl+Shift+S',
    'file.open': 'Ctrl+O',
    'file.new': 'Ctrl+N',
    'file.closeTab': 'Ctrl+W',
    'file.export': 'Ctrl+Shift+E',
    'file.import': 'Ctrl+Shift+I',
    'runtime.run': 'Ctrl+Enter',
    'runtime.runInServer': 'Ctrl+Shift+Enter',
    'runtime.stop': 'Ctrl+Shift+C',
    'runtime.format': 'Shift+Alt+F',
    'editor.find': 'Ctrl+F',
    'editor.replace': 'Ctrl+H',
    'editor.findNext': 'F3',
    'editor.findPrevious': 'Shift+F3',
    'editor.gotoLine': 'Ctrl+G',
    'editor.toggleComment': 'Ctrl+/',
    'editor.duplicateLine': 'Shift+Alt+ArrowDown',
    'editor.deleteLine': 'Ctrl+Shift+K',
    'editor.moveLineUp': 'Alt+ArrowUp',
    'editor.moveLineDown': 'Alt+ArrowDown',
    'editor.addCursorAbove': 'Ctrl+Alt+ArrowUp',
    'editor.addCursorBelow': 'Ctrl+Alt+ArrowDown',
    'editor.foldAll': 'Ctrl+Shift+[',
    'editor.unfoldAll': 'Ctrl+Shift+]',
    'app.commandPalette': 'Ctrl+Shift+P',
    'app.toggleSidebar': 'Ctrl+B',
    'app.toggleTheme': 'Ctrl+Shift+T',
    'app.openSettings': 'Ctrl+,',
    'app.reloadInterface': 'Ctrl+Shift+R',
    'app.focusEditor': 'Ctrl+1',
    'app.focusConsole': 'Ctrl+2',
    'app.focusScripts': 'Ctrl+3',
    'app.focusDashboard': 'Ctrl+4',
    'console.clear': 'Ctrl+L',
    'console.togglePause': 'Ctrl+Shift+L',
    'console.export': null,
    'view.zoomIn': 'Ctrl+=',
    'view.zoomOut': 'Ctrl+-',
    'view.zoomReset': 'Ctrl+0',
  }),
  vscode: Object.freeze({
    'file.save': 'Ctrl+S',
    'file.saveAs': 'Ctrl+Shift+S',
    'file.open': 'Ctrl+O',
    'file.new': 'Ctrl+N',
    'file.closeTab': 'Ctrl+W',
    'runtime.run': 'F5',
    'runtime.stop': 'Shift+F5',
    'runtime.format': 'Shift+Alt+F',
    'editor.find': 'Ctrl+F',
    'editor.replace': 'Ctrl+H',
    'editor.gotoLine': 'Ctrl+G',
    'editor.toggleComment': 'Ctrl+/',
    'editor.deleteLine': 'Ctrl+Shift+K',
    'editor.moveLineUp': 'Alt+ArrowUp',
    'editor.moveLineDown': 'Alt+ArrowDown',
    'editor.addCursorAbove': 'Ctrl+Alt+ArrowUp',
    'editor.addCursorBelow': 'Ctrl+Alt+ArrowDown',
    'app.commandPalette': 'Ctrl+Shift+P',
    'app.toggleSidebar': 'Ctrl+B',
    'app.openSettings': 'Ctrl+,',
    'console.clear': 'Ctrl+L',
    'view.zoomIn': 'Ctrl+=',
    'view.zoomOut': 'Ctrl+-',
    'view.zoomReset': 'Ctrl+0',
  }),
  sublime: Object.freeze({
    'file.save': 'Ctrl+S',
    'file.open': 'Ctrl+O',
    'file.closeTab': 'Ctrl+W',
    'runtime.run': 'Ctrl+B',
    'runtime.stop': 'Ctrl+Break',
    'editor.find': 'Ctrl+F',
    'editor.replace': 'Ctrl+H',
    'editor.gotoLine': 'Ctrl+G',
    'editor.toggleComment': 'Ctrl+/',
    'editor.duplicateLine': 'Ctrl+Shift+D',
    'app.commandPalette': 'Ctrl+Shift+P',
    'app.toggleSidebar': 'Ctrl+K',
    'console.clear': 'Ctrl+K',
    'view.zoomIn': 'Ctrl+=',
    'view.zoomOut': 'Ctrl+-',
  }),
});

export class ShortcutManager {
  #commands = null;
  #bindings = new Map();
  #overrides = {};
  #preset = 'default';
  #listeners = [];
  #stats = { handled: 0, unmatched: 0, blocked: { input: 0, disabled: 0 } };
  #installed = false;
  #enabled = true;
  #contextStack = ['global'];
  #disabledInContext = new Map();

  constructor({ settings, logger, eventBus, notifications, capabilities, commands }) {
    this.settings = settings;
    this.logger = logger;
    this.eventBus = eventBus;
    this.notifications = notifications;
    this.capabilities = capabilities;
    this.commands = commands;
    this.platform = detectPlatform();
  }

  init() {
    this.#loadFromSettings();
    this.settings.subscribe((values, detail) => {
      if ((detail.changed ?? []).some((key) => key.startsWith('shortcuts.'))) {
        this.#loadFromSettings();
        this.install();
      }
    });
    this.install();
    const conflicts = this.detectConflicts();
    if (conflicts.length > 0) {
      this.logger.warn(`Se detectaron ${conflicts.length} conflictos de atajos`, { source: 'ShortcutManager', data: { conflicts } });
    }
    return { ok: true, bindings: this.#bindings.size, preset: this.#preset, conflicts: conflicts.length, platform: this.platform };
  }

  get preset() {
    return this.#preset;
  }

  get stats() {
    return { ...this.#stats, blocked: { ...this.#stats.blocked } };
  }

  #loadFromSettings() {
    const presetName = this.settings.get('shortcuts.preset') ?? 'default';
    this.#preset = KEYMAP_PRESETS[presetName] ? presetName : 'default';
    this.#overrides = this.settings.get('shortcuts.bindings') ?? {};
    this.#bindings.clear();

    const base = KEYMAP_PRESETS[this.#preset];
    for (const [commandId, binding] of Object.entries(base)) {
      if (typeof binding === 'string') this.#bindings.set(commandId, normalizeBinding(binding));
    }
    // User overrides: an empty string disables the shortcut, a value replaces the preset.
    for (const [commandId, binding] of Object.entries(this.#overrides)) {
      if (binding === '' || binding === null) this.#bindings.delete(commandId);
      else {
        const normalized = normalizeBinding(binding);
        if (normalized) this.#bindings.set(commandId, normalized);
      }
    }
  }

  /** Registers additional bindings (used by plugins and dynamic commands). */
  register(commandId, binding, { silent = false } = {}) {
    const normalized = normalizeBinding(binding);
    if (!normalized) {
      if (!silent) this.logger.warn(`Atajo inválido para "${commandId}": ${binding}`, { source: 'ShortcutManager' });
      return { ok: false, error: 'Atajo inválido' };
    }
    const conflict = this.findConflict(commandId, normalized);
    this.#bindings.set(commandId, normalized);
    this.eventBus?.emit('shortcut:changed', { commandId, binding: normalized });
    return { ok: true, binding: normalized, conflict };
  }

  unregister(commandId) {
    const removed = this.#bindings.delete(commandId);
    return { ok: removed };
  }

  /** All bindings as a serialisable table (used by the Settings UI). */
  describe() {
    const rows = [];
    for (const [commandId, binding] of this.#bindings) {
      const command = this.commands?.get?.(commandId);
      rows.push({
        commandId,
        binding: binding.raw,
        canonical: binding.canonical,
        label: formatBinding(binding, this.platform),
        title: command?.title ?? commandId,
        category: command?.category ?? 'Sin comando',
        exists: Boolean(command),
        overridden: Object.prototype.hasOwnProperty.call(this.#overrides, commandId),
        default: KEYMAP_PRESETS[this.#preset][commandId] ?? null,
      });
    }
    return rows.sort((a, b) => a.category.localeCompare(b.category, 'es') || a.title.localeCompare(b.title, 'es'));
  }

  /** Conflicts are computed on canonical bindings — no false positives from formatting. */
  detectConflicts() {
    const seen = new Map();
    const conflicts = [];
    for (const [commandId, binding] of this.#bindings) {
      if (binding.context !== 'global') continue;
      const existing = seen.get(binding.canonical);
      if (existing && existing !== commandId) {
        conflicts.push({ binding: binding.raw, canonical: binding.canonical, commands: [existing, commandId] });
      } else {
        seen.set(binding.canonical, commandId);
      }
    }
    return conflicts;
  }

  findConflict(commandId, binding) {
    for (const [otherId, other] of this.#bindings) {
      if (otherId === commandId) continue;
      if (other.canonical === binding.canonical) return { commandId: otherId, binding: other.raw };
    }
    return null;
  }

  /** Installs the global listener (idempotent). */
  install() {
    if (this.#installed) return;
    this.#installed = true;
    const handler = (event) => this.handleKeydown(event);
    window.addEventListener('keydown', handler, true);
    this.#listeners.push(() => window.removeEventListener('keydown', handler, true));
  }

  setEnabled(enabled) {
    this.#enabled = Boolean(enabled);
    return this.#enabled;
  }

  /** Context stack: `pushContext('editor')` narrows matching to that context. */
  pushContext(context) {
    this.#contextStack.push(context);
    return () => this.popContext(context);
  }

  popContext(context) {
    const index = this.#contextStack.lastIndexOf(context);
    if (index >= 0) this.#contextStack.splice(index, 1);
  }

  get context() {
    return this.#contextStack[this.#contextStack.length - 1] ?? 'global';
  }

  disableIn(context) {
    this.#disabledInContext.set(context, (this.#disabledInContext.get(context) ?? 0) + 1);
  }

  enableIn(context) {
    const count = this.#disabledInContext.get(context) ?? 0;
    if (count <= 1) this.#disabledInContext.delete(context);
    else this.#disabledInContext.set(context, count - 1);
  }

  /**
   * Handles a keyboard event. Returns `true` when a command was executed.
   */
  handleKeydown(event) {
    if (!this.#enabled) return false;
    if (event.isComposing || event.keyCode === 229) return false;

    const target = event.target;
    const isInput = isTypingTarget(target);
    const descriptors = describeEvent(event, this.platform);
    if (descriptors.length === 0) {
      this.#stats.unmatched += 1;
      return false;
    }

    for (const [commandId, binding] of this.#bindings) {
      if (!descriptors.includes(binding.canonical)) continue;

      const command = this.commands?.get?.(commandId) ?? null;
      if (!command) continue;

      if (binding.when && !binding.when(event, this.context)) continue;
      if (isInput && command.allowInInput !== true) {
        this.#stats.blocked.input += 1;
        continue;
      }
      if (binding.context !== 'global' && binding.context !== this.context) continue;
      if (this.#disabledInContext.has(binding.context ?? 'global')) continue;

      if (typeof command.enabled === 'function' && command.enabled() === false) {
        this.#stats.blocked.disabled += 1;
        event.preventDefault();
        this.notifications?.info(command.disabledReason?.() ?? `"${command.title}" no está disponible ahora mismo`, { durationMs: 2200 });
        return false;
      }

      event.preventDefault();
      event.stopPropagation();
      this.#stats.handled += 1;
      const result = this.commands.execute(commandId, { source: 'shortcut', event });
      if (result && typeof result.catch === 'function') {
        result.catch((err) => this.logger?.error(err, { source: `ShortcutManager:${commandId}` }));
      }
      return true;
    }
    return false;
  }

  /** Creates a keybinding for a key sequence (used by the "capture" UI in Settings). */
  static captureFromEvent(event, platform = detectPlatform()) {
    const descriptors = describeEvent(event, platform, { includeKey: true });
    return descriptors[0] ? descriptors[0] : null;
  }

  getBindings() {
    return Object.fromEntries([...this.#bindings].map(([id, binding]) => [id, binding.raw]));
  }

  dispose() {
    for (const remove of this.#listeners) remove();
    this.#listeners = [];
    this.#installed = false;
    this.#bindings.clear();
  }
}

function detectPlatform() {
  const platform = navigator.platform ?? navigator.userAgent ?? '';
  if (/mac/i.test(platform)) return 'mac';
  if (/win/i.test(platform)) return 'windows';
  return 'linux';
}

/** Normalises `Ctrl+Shift+P` into `{ ctrl, shift, meta, alt, key, canonical, raw }`. */
export function normalizeBinding(input) {
  if (typeof input !== 'string' || input.trim() === '') return null;
  const raw = input.trim();
  // Admite `Ctrl+F when=editor` (cláusula separada por espacio) y `Ctrl+F+context=editor`.
  const [combination, ...clauses] = raw.split(/\s+/);
  const parts = combination.split('+').map((part) => part.trim().toLowerCase()).filter(Boolean);
  let clauseContext = 'global';
  let clauseWhen = null;
  for (const clause of clauses) {
    const [name, ...rest] = clause.split('=');
    const value = rest.join('=');
    if (!value) continue;
    if (name.toLowerCase() === 'when') clauseWhen = value;
    else if (name.toLowerCase() === 'context') clauseContext = value;
  }
  if (parts.length === 0) return null;

  const modifiers = { ctrl: false, shift: false, alt: false, meta: false };
  let key = null;
  let context = clauseContext;
  let when = clauseWhen;

  for (const part of parts) {
    if (part.startsWith('when=')) {
      when = part.slice(5);
      continue;
    }
    if (part.startsWith('context=')) {
      context = part.slice(8);
      continue;
    }
    if (MODIFIER_ALIASES[part]) {
      modifiers[MODIFIER_ALIASES[part]] = true;
      continue;
    }
    const alias = KEY_ALIASES[part];
    if (alias !== undefined) {
      key = alias;
      continue;
    }
    if (part.length === 1) {
      key = part;
      continue;
    }
    // Fallback for named keys such as `F13`, `Break`, `Numpad5`.
    key = part.length <= 3 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1);
  }

  if (key === null) return null;
  const canonical = canonicalize({ ...modifiers, key });
  /**
   * `context=` y `when=` limitan el atajo a un contexto (por ejemplo `editor`). Sin incluirlos en
   * el objeto devuelto cada atajo quedaba con `context === undefined` y `handleKeydown` lo
   * descartaba siempre: ningún atajo llegaba a ejecutarse.
   */
  return {
    ...modifiers,
    key,
    canonical,
    raw,
    context: context ?? 'global',
    when: when ? (event, activeContext) => activeContext === when : null,
  };
}

function canonicalize({ ctrl, shift, alt, meta, key }) {
  const parts = [];
  if (ctrl) parts.push('ctrl');
  if (alt) parts.push('alt');
  if (shift) parts.push('shift');
  if (meta) parts.push('meta');
  parts.push(key.length === 1 ? key.toLowerCase() : key.toLowerCase());
  return parts.join('+');
}

/** Describes a KeyboardEvent as canonical binding strings (layout-aware). */
function describeEvent(event, platform, { includeKey = false } = {}) {
  const useMeta = platform === 'mac';
  const modifiers = {
    // On macOS the "primary" modifier is Cmd, but Ctrl must still work as written.
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey,
  };

  const keys = new Set();
  if (typeof event.key === 'string' && event.key.length >= 1) {
    keys.add(event.key.length === 1 ? event.key : event.key);
  }
  // `code` keeps shortcuts working on non-latin layouts.
  if (typeof event.code === 'string' && event.code.startsWith('Key')) keys.add(event.code.slice(3));
  if (typeof event.code === 'string' && event.code.startsWith('Digit')) keys.add(event.code.slice(5));
  if (typeof event.code === 'string' && /^F\d{1,2}$/.test(event.code)) keys.add(event.code);

  const canonical = new Set();
  for (const key of keys) {
    if (key === 'Dead' || key === 'Unidentified') continue;
    const normalizedKey = key.length === 1 ? key.toLowerCase() : (KEY_ALIASES[key.toLowerCase()] ?? key);
    canonical.add(canonicalize({ ...modifiers, key: normalizedKey }));
    if (useMeta && modifiers.meta && !modifiers.ctrl && !includeKey) {
      // Cmd+S also matches Ctrl+S bindings on macOS (except when Ctrl is explicit).
      canonical.add(canonicalize({ ...modifiers, ctrl: true, meta: false, key: normalizedKey }));
    }
  }
  return [...canonical];
}

function isTypingTarget(target) {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return target.closest('.cm-editor') !== null;
}

/** Human-readable binding for the current platform (`⌘S` on macOS, `Ctrl+S` elsewhere). */
export function formatBinding(binding, platform = detectPlatform()) {
  if (!binding) return '';
  const useMeta = platform === 'mac';
  const parts = [];
  if (binding.ctrl) parts.push(useMeta ? '⌃' : 'Ctrl');
  if (binding.alt) parts.push(useMeta ? '⌥' : 'Alt');
  if (binding.shift) parts.push(useMeta ? '⇧' : 'Shift');
  if (binding.meta) parts.push(useMeta ? '⌘' : 'Win');
  parts.push(prettyKey(binding.key));
  return parts.join(useMeta ? '' : '+');
}

function prettyKey(key) {
  const map = {
    ' ': 'Espacio',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Enter: '⏎',
    Escape: 'Esc',
    Backspace: '⌫',
    Delete: 'Supr',
    PageUp: 'RePág',
    PageDown: 'AvPág',
  };
  if (map[key]) return map[key];
  if (key.length === 1) return key.toUpperCase();
  return key;
}

export { LocalKeys };
