/**
 * EditorManager — CodeMirror 6 documents, commands and analysis integration.
 *
 * Design decisions that matter:
 *   - **One tab, one `EditorState`**: undo history, selection, scroll position and folds
 *     survive tab switches because the state is swapped instead of the document being copied.
 *   - **One extension set, built once**: every document state shares the same extensions and
 *     the same compartments, so a settings change reconfigures all open tabs in place and
 *     never rebuilds the editor or loses the cursor.
 *   - **Real analysis**: diagnostics come from the Luau engine (through `AnalysisClient`) and
 *     are mapped onto document ranges; hover uses the engine's symbol documentation.
 *   - **No fake commands**: every method performs a real document transformation using
 *     CodeMirror's own commands or an explicit, reviewable edit.
 */

import { EditorState, Compartment, EditorSelection } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection,
  dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine, placeholder, tooltips, hoverTooltip,
  scrollPastEnd, highlightWhitespace,
} from '@codemirror/view';
import {
  defaultKeymap, history, historyKeymap, indentWithTab, undo, redo, toggleComment, deleteLine,
  copyLineDown, moveLineUp, moveLineDown, selectAll, indentMore, indentLess,
} from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap, foldAll, unfoldAll, indentUnit } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, completionStatus, startCompletion } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches, selectSelectionMatches, selectNextOccurrence as searchSelectNextOccurrence } from '@codemirror/search';
import { linter, lintGutter, lintKeymap, forceLinting } from '@codemirror/lint';
import { CapabilityId, Dialect, DEFAULT_SCRIPT_TEMPLATE } from '../shared/constants.js';
import { resolveFontStack } from '../shared/settings-schema.js';
import { SyntaxHighlighter } from './SyntaxHighlighter.js';
import { buildAppearanceExtensions, buildEditorTheme } from './editor-theme.js';
import { AnalysisClient, offsetToPosition } from './AnalysisClient.js';
import { SearchManager } from './SearchManager.js';
import { Formatter } from './Formatter.js';
import { CompletionManager } from './CompletionManager.js';
import { Minimap } from './Minimap.js';

// Últimos límites conocidos: el esquema de ajustes manda; esto sólo cubre un esquema ausente.
const ZOOM_MIN = 8;
const ZOOM_MAX = 40;
const DEFAULT_FONT_SIZE = 14;

const EMPTY_DIAGNOSTICS = Object.freeze([]);

export class EditorManager {
  #view = null;
  #baseExtensions = null;
  #documents = new Map();
  #activeId = null;
  #completion = null;
  #search = null;
  #formatter = null;
  #highlighter = null;
  #minimap = null;
  #listeners = new Set();
  #cursorListeners = new Set();
  #diagnosticsListeners = new Set();
  #appearance = new Compartment();
  #theme = new Compartment();
  #lint = new Compartment();
  #features = new Compartment();
  #highlight = new Compartment();
  #diagnostics = new Map();
  #lintTimer = null;
  #disposed = false;

  constructor({ host, settings, themeManager, analysis, capabilities, logger, eventBus, errorBus, notifications, completion, search, formatter, highlighter }) {
    this.host = host;
    this.settings = settings;
    this.themeManager = themeManager;
    this.analysis = analysis;
    this.capabilities = capabilities;
    this.logger = logger;
    this.eventBus = eventBus;
    this.errorBus = errorBus;
    this.notifications = notifications;
    // Los colaboradores se guardan en los campos privados que usa la clase y se exponen como
    // propiedades públicas para las vistas y el `describe()`.
    this.#completion = completion ?? new CompletionManager({ analysis, settings, logger });
    this.#search = search ?? new SearchManager({ logger, errorBus, apiClient: analysis?.apiClient });
    this.#formatter = formatter ?? new Formatter({ settings, logger });
    this.#highlighter = highlighter ?? new SyntaxHighlighter({ settings, logger });
    this.completion = this.#completion;
    this.search = this.#search;
    this.formatter = this.#formatter;
    this.highlighter = this.#highlighter;
    this.stats = { opened: 0, saved: 0, formats: 0, diagnosticRuns: 0, diagnosticErrors: 0, lastDiagnosticsAt: null, activeView: false };
  }

  /* ------------------------------------------------------------------ *
   * Lifecycle
   * ------------------------------------------------------------------ */

  async init() {
    if (!this.host) throw new Error('EditorManager necesita un contenedor (#editor-host)');

    // Extensions that are always present (core editing behaviour).
    const autoIndent = this.settings ? this.settings.get('editor.autoIndent') !== false : true;
    const core = [
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      tooltips({ position: 'absolute' }),
      hoverTooltip((view, position, side) => this.#hoverTooltip(view, position, side), { hoverTime: 320 }),
      placeholder('Escribe código Lua o Luau y pulsa Ctrl+Enter para ejecutarlo…'),
      keymap.of([
        ...this.#customKeymap(),
        ...closeBracketsKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...lintKeymap,
        indentWithTab,
        ...defaultKeymap,
      ]),
      EditorView.updateListener.of((update) => this.#onUpdate(update)),
      EditorView.domEventHandlers({
        focus: () => { this.stats.activeView = true; },
        blur: () => { this.stats.activeView = false; },
      }),
    ];

    // Optional features, syntax highlighting, linting and appearance live in compartments so a
    // settings change reconfigures every open document in place (cursor and history preserved).
    this.#baseExtensions = [
      ...core,
      ...this.#highlighter.languageExtensions(),
      ...(autoIndent ? [] : [indentUnit.of('')]),
      this.#features.of(this.#featureExtensions()),
      this.#highlight.of(this.#highlightExtension()),
      this.#theme.of(buildEditorTheme({ dark: this.themeManager?.active?.type !== 'light' })),
      this.#appearance.of(buildAppearanceExtensions(this.#appearanceOptions())),
      this.#lint.of(this.#lintExtension()),
      lintGutter(),
    ];

    this.#view = new EditorView({
      state: EditorState.create({ doc: '', extensions: this.#baseExtensions }),
      parent: this.host,
    });

    this.#search.attach({ view: this.#view });
    this.#wireSettings();
    this.#wireMinimap();
    void this.#refreshAnalysisAvailability();

    return { ok: true, documents: this.#documents.size, extensions: this.#baseExtensions.length };
  }

  get view() {
    return this.#view;
  }

  get mounted() {
    return this.#view !== null;
  }

  #appearanceOptions() {
    const wordWrap = this.settings?.get('editor.wordWrap') === true;
    const wrapColumn = this.settings?.get('editor.wrapColumn') ?? 100;
    return {
      fontSize: this.settings?.get('editor.fontSize') ?? DEFAULT_FONT_SIZE,
      fontFamily: resolveFontStack(this.settings?.get('editor.fontFamily')),
      lineHeight: this.settings?.get('editor.lineHeight') ?? 1.55,
      tabSize: this.settings?.get('editor.tabSize') ?? 4,
      insertSpaces: this.settings?.get('editor.insertSpaces') !== false,
      wordWrap,
      wrapColumn,
      cursorBlink: this.settings?.get('editor.cursorBlink') !== false,
      scrollPastEnd: this.settings?.get('editor.scrollPastEnd') !== false,
    };
  }

  /**
   * Extensions that depend on settings: line numbers, folding, bracket helpers, multi-cursor,
   * whitespace, autocompletion and scroll behaviour. Rebuilt through `#features`.
   */
  #featureExtensions() {
    const settings = this.settings;
    const on = (key, fallback = true) => (settings ? settings.get(key) ?? fallback : fallback);
    const extensions = [];

    if (on('editor.lineNumbers')) extensions.push(lineNumbers());
    if (on('editor.highlightActiveLine')) extensions.push(highlightActiveLineGutter(), highlightActiveLine());
    if (on('editor.foldGutter')) extensions.push(foldGutter());
    if (on('editor.matchBrackets')) extensions.push(bracketMatching());
    if (on('editor.autoCloseBrackets')) extensions.push(closeBrackets());
    if (on('editor.highlightSelectionMatches')) {
      extensions.push(highlightSelectionMatches({ highlightMatches: true, minSelectionLength: 2 }));
    }
    if (on('editor.showWhitespace')) extensions.push(highlightWhitespace());
    if (on('editor.scrollPastEnd')) extensions.push(scrollPastEnd());

    // Multi-cursor: several selections, rectangular selection and the crosshair cursor.
    if (on('editor.multiCursor')) {
      extensions.push(
        EditorState.allowMultipleSelections.of(true),
        rectangularSelection(),
        crosshairCursor(),
      );
    }

    if (on('editor.autocomplete')) {
      extensions.push(autocompletion({
        override: [this.#completionSource()],
        activateOnTyping: true,
        maxRenderedOptions: Math.max(10, settings?.get('editor.maxCompletionItems') ?? 120),
        closeOnBlur: true,
        icons: true,
        defaultKeymap: true,
      }));
    }

    return extensions;
  }

  /** Real syntax highlighting, toggleable from the settings (el `SyntaxHighlighter` manda). */
  #highlightExtension() {
    return this.#highlighter.highlightExtensions();
  }

  /**
   * Linter configuration driven by the settings:
   *  - `editor.analysisEnabled` turns analysis off entirely;
   *  - `editor.analysisMode = 'manual'` keeps diagnostics out of the typing path
   *    (they appear when the user runs «Analizar ahora»);
   *  - `editor.lintOnType = false` only analyses on save/explicit request;
   *  - `editor.analysisDelayMs` is the real debounce used by CodeMirror's linter.
   */
  #lintExtension() {
    const enabled = this.settings ? this.settings.get('editor.analysisEnabled') !== false : true;
    const mode = this.settings?.get('editor.analysisMode') ?? 'strict';
    const onType = this.settings ? this.settings.get('editor.lintOnType') !== false : true;
    if (!enabled || mode === 'manual') return linter(() => Promise.resolve([]), { delay: 1000 });
    const delay = Math.max(120, this.settings?.get('editor.analysisDelayMs') ?? 500);
    return linter(this.#linterSource(), {
      delay,
      // With `lintOnType` off, diagnostics are not recomputed while typing; they refresh when the
      // document is saved or when the user asks for them (Ctrl+Shift+A → `analyzeNow`).
      needsRefresh: (update) => (onType ? update.docChanged || update.viewportChanged : false),
    });
  }

  #wireSettings() {
    this.settings.subscribe((_values, detail) => {
      const changed = detail.changed ?? [];
      const structural = ['reset', 'import', 'server-load', 'local-fallback'];
      if (changed.some((key) => key.startsWith('editor.')) || structural.includes(detail.reason)) this.reconfigure();
      if (changed.includes('appearance.theme') || detail.reason === 'theme') this.reconfigureTheme();
      if (changed.includes('performance.lowPerformanceMode') || changed.includes('performance.reducedAnimations')) this.#applyPerformanceFlags();
      if (changed.includes('editor.minimap') || changed.includes('performance.lowPerformanceMode')) this.#wireMinimap();
      const lintKeys = ['editor.lintOnType', 'editor.analysisDelayMs', 'editor.analysisMode', 'editor.analysisEnabled', 'editor.syntaxHighlighting'];
      if (changed.some((key) => lintKeys.includes(key))) {
        this.#dispatchReconfigure([
          this.#lint.reconfigure(this.#lintExtension()),
          this.#highlight.reconfigure(this.#highlightExtension()),
        ]);
      }
      const featureKeys = ['editor.lineNumbers', 'editor.foldGutter', 'editor.matchBrackets', 'editor.autoCloseBrackets',
        'editor.highlightSelectionMatches', 'editor.showWhitespace', 'editor.multiCursor', 'editor.autocomplete',
        'editor.maxCompletionItems', 'editor.highlightActiveLine', 'editor.scrollPastEnd'];
      if (changed.some((key) => featureKeys.includes(key))) {
        this.#dispatchReconfigure([this.#features.reconfigure(this.#featureExtensions())]);
      }
    });
    this.themeManager?.subscribe(() => this.reconfigureTheme());
    this.#applyPerformanceFlags();
  }

  /** Pushes the current settings into the live editor (no rebuild, cursor preserved). */
  reconfigure() {
    if (!this.#view) return { ok: false };
    this.#dispatchReconfigure([
      this.#appearance.reconfigure(buildAppearanceExtensions(this.#appearanceOptions())),
      this.#features.reconfigure(this.#featureExtensions()),
      this.#highlight.reconfigure(this.#highlightExtension()),
      this.#lint.reconfigure(this.#lintExtension()),
    ]);
    return { ok: true, fontSize: this.settings?.get('editor.fontSize') };
  }

  reconfigureTheme() {
    if (!this.#view) return { ok: false };
    const dark = this.themeManager?.active?.type !== 'light';
    this.#view.dispatch({ effects: this.#theme.reconfigure(buildEditorTheme({ dark })) });
    this.#minimap?.update();
    return { ok: true, dark };
  }

  reconfigureLint() {
    if (!this.#view) return { ok: false };
    this.#dispatchReconfigure([this.#lint.reconfigure(this.#lintExtension())]);
    return { ok: true };
  }

  /** Applies one or more compartment reconfigurations to every open document. */
  #dispatchReconfigure(effects) {
    if (!this.#view) return;
    this.#view.dispatch({ effects });
    for (const document of this.#documents.values()) {
      if (document.id === this.#activeId) continue;
      document.state = document.state.update({ effects }).state;
    }
  }

  #applyPerformanceFlags() {
    document.documentElement.dataset.reducedMotion = this.settings?.get('performance.reducedAnimations') === true ? 'true' : 'false';
    document.documentElement.dataset.lowPerformance = this.settings?.get('performance.lowPerformanceMode') === true ? 'true' : 'false';
  }

  #wireMinimap() {
    const capabilityOk = this.capabilities?.isAvailable?.(CapabilityId.UI_CANVAS) !== false;
    const wants = (this.settings?.get('editor.minimap') ?? true)
      && capabilityOk
      && this.settings?.get('performance.lowPerformanceMode') !== true;

    if (!wants || !this.#view) {
      this.#minimap?.destroy();
      this.#minimap = null;
      return { ok: true, enabled: false, reason: wants ? null : this.#minimapReason(capabilityOk) };
    }
    this.#minimap = this.#minimap ?? new Minimap({ theme: this.themeManager, logger: this.logger });
    const container = this.host.closest('.editor-host') ?? this.host.parentElement ?? this.host;
    this.#minimap.attach({ host: container, view: this.#view, enabled: true });
    return { ok: true, enabled: true };
  }

  #minimapReason(capabilityOk) {
    if (!capabilityOk) return 'El minimapa necesita Canvas 2D, que no está disponible en este navegador.';
    if (this.settings?.get('performance.lowPerformanceMode') === true) return 'El modo de bajo rendimiento desactiva el minimapa.';
    return 'El minimapa está desactivado en los ajustes.';
  }

  /* ------------------------------------------------------------------ *
   * Documents (one EditorState per open tab)
   * ------------------------------------------------------------------ */

  /**
   * Opens (or focuses) a document.
   * @param {{ id: string, name?: string, content?: string, dialect?: string, readOnly?: boolean, path?: string|null }} document
   */
  openDocument({ id, name = 'script.luau', content = null, dialect = Dialect.LUAU, readOnly = false, path = null }) {
    if (!this.#view) throw new Error('El editor no está inicializado');
    const existing = this.#documents.get(id);
    if (existing) {
      this.setActive(id);
      if (content !== null && content !== this.getValue(id)) {
        this.updateDocument(id, content, { reason: 'external', markClean: true });
      }
      return { ok: true, reused: true, id };
    }

    const text = content ?? DEFAULT_SCRIPT_TEMPLATE;
    const state = EditorState.create({ doc: text, extensions: this.#baseExtensions });
    this.#documents.set(id, {
      id,
      name,
      path,
      dialect: dialect === Dialect.LUA54 ? Dialect.LUA54 : Dialect.LUAU,
      readOnly,
      state,
      savedText: text,
      openedAt: Date.now(),
      lastEditAt: null,
      dirty: false,
      diagnostics: [],
      analysisAt: null,
    });
    this.stats.opened += 1;
    this.setActive(id);
    this.#emit({ type: 'opened', id, name, dialect });
    return { ok: true, id, name, dialect };
  }

  /** Replaces the whole content from an external source (disk change, restore, import). */
  updateDocument(id, content, { reason = 'external', markClean = false } = {}) {
    const document = this.#documents.get(id);
    if (!document) return { ok: false, reason: 'documento no encontrado' };
    if (id === this.#activeId && this.#view) {
      this.#view.dispatch({ changes: { from: 0, to: this.#view.state.doc.length, insert: content } });
      document.state = this.#view.state;
    } else {
      document.state = document.state.update({ changes: { from: 0, to: document.state.doc.length, insert: content } }).state;
    }
    document.savedText = markClean ? content : document.savedText;
    document.dirty = !markClean;
    document.lastEditAt = Date.now();
    this.#emit({ type: 'external-change', id, reason, dirty: document.dirty });
    return { ok: true, id };
  }

  setActive(id) {
    const document = this.#documents.get(id);
    if (!document || !this.#view) return { ok: false, reason: 'documento no encontrado' };
    if (this.#activeId === id) return { ok: true, id };
    if (this.#activeId && this.#documents.has(this.#activeId)) {
      this.#documents.get(this.#activeId).state = this.#view.state;
    }
    this.#view.setState(document.state);
    this.#activeId = id;
    this.#minimap?.update();
    this.#emit({ type: 'activated', id });
    this.#emitCursor();
    this.#emit({ type: 'diagnostics', id, count: document.diagnostics.length });
    return { ok: true, id };
  }

  closeDocument(id, { force = false } = {}) {
    const document = this.#documents.get(id);
    if (!document) return { ok: false, reason: 'documento no encontrado' };
    if (document.dirty && !force) return { ok: false, needConfirm: true, reason: 'El documento tiene cambios sin guardar' };
    if (this.#activeId === id && this.#view) document.state = this.#view.state;
    this.#documents.delete(id);
    this.#diagnostics.delete(id);
    if (this.#activeId === id) {
      this.#activeId = null;
      const next = this.#documents.keys().next().value ?? null;
      if (next) this.setActive(next);
      else if (this.#view) this.#view.setState(EditorState.create({ doc: '', extensions: this.#baseExtensions }));
    }
    this.#emit({ type: 'closed', id });
    return { ok: true, id };
  }

  hasDocument(id) {
    return this.#documents.has(id);
  }

  get activeId() {
    return this.#activeId;
  }

  get activeDocument() {
    const document = this.#documents.get(this.#activeId);
    return document ? this.#describeDocument(document) : null;
  }

  get documents() {
    return [...this.#documents.values()].map((document) => this.#describeDocument(document));
  }

  #describeDocument(document) {
    const live = document.id === this.#activeId && this.#view ? this.#view.state : document.state;
    return {
      id: document.id,
      name: document.name,
      path: document.path,
      dialect: document.dialect,
      readOnly: document.readOnly,
      dirty: document.dirty,
      length: live.doc.length,
      lines: live.doc.lines,
      diagnostics: document.diagnostics.length,
      openedAt: document.openedAt,
      lastEditAt: document.lastEditAt,
      analysisAt: document.analysisAt,
    };
  }

  getValue(id = this.#activeId) {
    const document = this.#documents.get(id);
    if (!document) return null;
    if (id === this.#activeId && this.#view) return this.#view.state.doc.toString();
    return document.state.doc.toString();
  }

  getDialect(id = this.#activeId) {
    return this.#documents.get(id)?.dialect ?? Dialect.LUAU;
  }

  setValue(id, content, { markClean = false } = {}) {
    return this.updateDocument(id, content, { reason: 'set', markClean });
  }

  /** Marks a document as saved (called after writing to disk). */
  markSaved(id, { content = null } = {}) {
    const document = this.#documents.get(id);
    if (!document) return { ok: false };
    document.dirty = false;
    document.savedText = content ?? this.getValue(id) ?? '';
    this.stats.saved += 1;
    this.#emit({ type: 'saved', id });
    return { ok: true, id };
  }

  isDirty(id = this.#activeId) {
    return this.#documents.get(id)?.dirty === true;
  }

  renameDocument(id, name, path = null) {
    const document = this.#documents.get(id);
    if (!document) return { ok: false };
    document.name = name;
    if (path !== null) document.path = path;
    this.#emit({ type: 'renamed', id, name });
    return { ok: true };
  }

  setDialect(id, dialect) {
    const document = this.#documents.get(id);
    if (!document) return { ok: false };
    document.dialect = dialect === Dialect.LUA54 ? Dialect.LUA54 : Dialect.LUAU;
    this.#emit({ type: 'dialect', id, dialect: document.dialect });
    this.scheduleAnalysis({ immediate: true });
    return { ok: true, dialect: document.dialect };
  }

  /* ------------------------------------------------------------------ *
   * View updates, cursor and dirty tracking
   * ------------------------------------------------------------------ */

  #onUpdate(update) {
    const document = this.#documents.get(this.#activeId);
    if (!document) return;
    document.state = update.state;

    if (update.docChanged) {
      const text = update.state.doc.toString();
      const dirty = text !== document.savedText;
      const dirtyChanged = dirty !== document.dirty;
      document.dirty = dirty;
      document.lastEditAt = Date.now();
      this.#emit({ type: 'change', id: document.id, dirty, length: text.length, lines: update.state.doc.lines });
      if (dirtyChanged) this.#emit({ type: 'dirty', id: document.id, dirty });
      this.scheduleAnalysis();
    }
    if (update.selectionSet || update.docChanged) this.#emitCursor();
    if (update.docChanged || update.geometryChanged || update.viewportChanged) this.#minimap?.update();
  }

  cursorInfo() {
    if (!this.#view) return null;
    const selection = this.#view.state.selection.main;
    const doc = this.#view.state.doc;
    const position = offsetToPosition(doc, selection.head);
    const selectedText = selection.to > selection.from ? doc.sliceString(selection.from, selection.to) : '';
    const selectedLines = selectedText === ''
      ? 0
      : doc.lineAt(selection.to).number - doc.lineAt(selection.from).number + 1;
    return {
      documentId: this.#activeId,
      position,
      line: position.line + 1,
      column: position.character + 1,
      selectedCharacters: selectedText.length,
      selectedLines,
      multipleCursors: this.#view.state.selection.ranges.length > 1,
      anchor: selection.anchor,
      head: selection.head,
    };
  }

  #emitCursor() {
    const info = this.cursorInfo();
    for (const listener of [...this.#cursorListeners]) {
      try {
        listener(info);
      } catch (err) {
        this.logger?.error?.(err, { source: 'EditorManager.cursor' });
      }
    }
  }

  onCursor(listener) {
    this.#cursorListeners.add(listener);
    return () => this.#cursorListeners.delete(listener);
  }

  onEvent(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onDiagnostics(listener) {
    this.#diagnosticsListeners.add(listener);
    return () => this.#diagnosticsListeners.delete(listener);
  }

  #emit(event) {
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch (err) {
        this.logger?.error?.(err, { source: 'EditorManager.event' });
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Analysis: diagnostics, hover, type annotation
   * ------------------------------------------------------------------ */

  async #refreshAnalysisAvailability() {
    this.analysis.serverAvailable = this.capabilities?.isAvailable?.('storage.server') !== false;
    const probe = await this.analysis.probe();
    if (!probe.ok) this.logger?.warn?.(`Análisis de Luau no disponible: ${probe.reason}`, { source: 'EditorManager' });
    this.scheduleAnalysis({ immediate: true });
    return probe;
  }

  #linterSource() {
    return async (view) => {
      const document = this.#documents.get(this.#activeId);
      if (!document || document.dialect !== Dialect.LUAU) return [];
      if (this.settings?.get('editor.lintOnType') === false) return [];
      if (this.settings?.get('editor.analysisMode') === 'manual') return [];
      if (this.settings?.get('editor.analysisEnabled') === false) return [];
      if (!this.analysis.supported) {
        if (this.#diagnostics.get(document.id)?.unavailable !== true) {
          this.#diagnostics.set(document.id, { diagnostics: [], unavailable: true, reason: this.analysis.reason });
        }
        return [];
      }
      const source = view.state.doc.toString();
      if (source.trim() === '') return [];
      const started = performance.now();
      const result = await this.analysis.check({ module: document.name, source });
      if (result?.error && !Array.isArray(result.diagnostics)) {
        this.stats.diagnosticErrors += 1;
        return [];
      }
      this.stats.diagnosticRuns += 1;
      this.stats.lastDiagnosticsAt = Date.now();
      const diagnostics = AnalysisClient.toEditorDiagnostics(result.diagnostics, view.state.doc);
      document.diagnostics = diagnostics;
      document.analysisAt = Date.now();
      this.#diagnostics.set(document.id, {
        diagnostics,
        durationMs: Math.round((performance.now() - started) * 100) / 100,
        mode: result.mode ?? null,
        cached: result.cached === true,
        unavailable: false,
      });
      for (const listener of [...this.#diagnosticsListeners]) {
        try {
          listener({ id: document.id, diagnostics, durationMs: Date.now() - started });
        } catch {
          /* a broken listener must not break linting */
        }
      }
      this.#emit({ type: 'diagnostics', id: document.id, count: diagnostics.length });
      return diagnostics;
    };
  }

  /** Re-runs the analyser for the active document now. */
  async analyzeNow() {
    if (!this.#view) return { ok: false };
    forceLinting(this.#view);
    return { ok: true, documentId: this.#activeId, supported: this.analysis.supported, reason: this.analysis.reason };
  }

  scheduleAnalysis({ immediate = false } = {}) {
    if (this.settings?.get('editor.lintOnType') === false) return;
    if (this.settings?.get('editor.analysisMode') === 'manual') return;
    if (immediate) {
      void this.analyzeNow();
      return;
    }
    if (this.#lintTimer) clearTimeout(this.#lintTimer);
    const delay = Math.max(120, this.settings?.get('editor.analysisDelayMs') ?? 500);
    this.#lintTimer = setTimeout(() => {
      this.#lintTimer = null;
      if (this.#view) forceLinting(this.#view);
    }, delay);
  }

  /** Documentation of the symbol under the cursor (hover + palette). */
  async hoverAt(position = null) {
    const document = this.#documents.get(this.#activeId);
    if (!document || !this.#view) return { ok: false, reason: 'sin documento activo' };
    const pos = position ?? this.#view.state.selection.main.head;
    const lsp = offsetToPosition(this.#view.state.doc, pos);
    const result = await this.analysis.hover({
      module: document.name,
      source: this.#view.state.doc.toString(),
      line: lsp.line,
      character: lsp.character,
    });
    return { ok: true, ...result };
  }

  /**
   * CodeMirror hover tooltip backed by the real engine documentation.
   * The tooltip shows up immediately with the symbol name and fills in the type and the
   * documentation as soon as the analyser answers (it never blocks the hover).
   */
  #hoverTooltip(view, position, side) {
    const document = this.#documents.get(this.#activeId);
    if (!document || document.dialect !== Dialect.LUAU) return null;
    if (!this.analysis.supported) return null;
    const word = view.state.wordAt(position);
    if (!word) return null;
    const name = view.state.sliceDoc(word.from, word.to);
    const module = document.name;
    const line = offsetToPosition(view.state.doc, word.from);
    const source = view.state.doc.toString();
    return {
      pos: word.from,
      end: word.to,
      above: side === -1,
      create: () => {
        const dom = document.createElement('div');
        dom.className = 'cm-lumen-tooltip';
        dom.style.padding = '6px 9px';
        dom.style.maxWidth = '360px';
        dom.style.fontSize = '12px';
        dom.style.lineHeight = '1.5';
        const title = document.createElement('div');
        title.className = 'mono';
        title.textContent = name;
        const body = document.createElement('div');
        body.textContent = 'Consultando al analizador de Luau…';
        body.style.color = 'var(--text-muted)';
        dom.append(title, body);
        void this.analysis.hover({ module, source, line: line.line, character: line.character }).then((result) => {
          const type = result?.type ?? null;
          const documentation = result?.documentation ?? null;
          if (type) title.textContent = `${name}: ${type}`;
          if (!documentation) {
            body.textContent = result?.error
              ? `No se pudo obtener la documentación: ${result.error}`
              : (type ? 'Sin documentación adicional.' : 'El analizador no reconoce este símbolo.');
            body.style.color = 'var(--text-muted)';
            return;
          }
          body.textContent = String(documentation).split('\n').slice(0, 24).join('\n');
          body.style.color = 'var(--text-primary)';
          body.style.whiteSpace = 'pre-wrap';
        }).catch((err) => {
          body.textContent = `Error al consultar el analizador: ${err.message}`;
          body.style.color = 'var(--error)';
        });
        return { dom };
      },
    };
  }

  /** Returns the source with the engine's inferred type annotations (never applied silently). */
  async annotatedSource() {
    const document = this.#documents.get(this.#activeId);
    if (!document) return { ok: false, reason: 'sin documento activo' };
    const source = this.getValue();
    const result = await this.analysis.decorate({ module: document.name, source });
    if (!result || result.error) {
      return { ok: false, reason: result?.error ?? 'El analizador no devolvió anotaciones', available: this.analysis.supported };
    }
    return { ok: true, decorated: result.decorated, changed: result.changed === true };
  }

  /**
   * Estado completo del análisis del documento: diagnósticos y motivo real de indisponibilidad.
   * @returns {{ diagnostics: Array, unavailable: boolean, reason: string|null }}
   */
  diagnosticsState(id = this.#activeId) {
    /*
     * El estado por defecto se memoriza por documento: dos llamadas seguidas devuelven la misma
     * lista y las vistas pueden comparar por referencia sin que aparezca un array nuevo cada vez.
     */
    const existing = this.#diagnostics.get(id);
    if (existing) return existing;
    const fallback = { diagnostics: EMPTY_DIAGNOSTICS, unavailable: !this.analysis.supported, reason: this.analysis.reason };
    if (id) this.#diagnostics.set(id, fallback);
    return fallback;
  }

  /** Diagnósticos del documento como lista plana; es lo que consumen las vistas. */
  diagnosticsFor(id = this.#activeId) {
    return this.diagnosticsState(id).diagnostics ?? [];
  }

  /* ------------------------------------------------------------------ *
   * Completion
   * ------------------------------------------------------------------ */

  #completionSource() {
    return this.completion.createSource({
      getDialect: () => this.#documents.get(this.#activeId)?.dialect ?? Dialect.LUAU,
      getModuleName: () => this.#documents.get(this.#activeId)?.name ?? 'main.luau',
    });
  }

  async requestCompletion() {
    if (!this.#view) return { ok: false };
    if (completionStatus(this.#view.state) === 'active') return { ok: true, already: true };
    startCompletion(this.#view);
    return { ok: true };
  }

  /* ------------------------------------------------------------------ *
   * Commands (all real)
   * ------------------------------------------------------------------ */

  focus() {
    this.#view?.focus();
    return { ok: Boolean(this.#view) };
  }

  undo() { return { ok: this.#view ? undo(this.#view) : false }; }
  redo() { return { ok: this.#view ? redo(this.#view) : false }; }
  selectAll() { return { ok: this.#view ? selectAll(this.#view) : false }; }
  toggleComment() { return { ok: this.#view ? toggleComment(this.#view) : false }; }
  /** Duplicates the current line (CodeMirror's `copyLineDown`, also used by Shift+Alt+↓). */
  duplicateLine() { return { ok: this.#view ? copyLineDown(this.#view) : false }; }
  deleteLine() { return { ok: this.#view ? deleteLine(this.#view) : false }; }
  moveLineUp() { return { ok: this.#view ? moveLineUp(this.#view) : false }; }
  moveLineDown() { return { ok: this.#view ? moveLineDown(this.#view) : false }; }
  indentMore() { return { ok: this.#view ? indentMore(this.#view) : false }; }
  indentLess() { return { ok: this.#view ? indentLess(this.#view) : false }; }

  /** Adds the next occurrence of the selection to the multi-selection (Ctrl+D). */
  selectNextOccurrence() {
    if (!this.#view) return { ok: false };
    const ranges = this.#view.state.selection.ranges.length;
    const changed = searchSelectNextOccurrence({ state: this.#view.state, dispatch: (tr) => this.#view.dispatch(tr) });
    const now = this.#view.state.selection.ranges.length;
    return { ok: now > ranges, cursors: now };
  }

  selectAllMatches() {
    if (!this.#view) return { ok: false };
    const changed = selectSelectionMatches({ state: this.#view.state, dispatch: (tr) => this.#view.dispatch(tr) });
    return { ok: changed, cursors: this.#view.state.selection.ranges.length };
  }

  foldAll() {
    if (!this.#view) return { ok: false };
    foldAll(this.#view);
    return { ok: true };
  }

  unfoldAll() {
    if (!this.#view) return { ok: false };
    unfoldAll(this.#view);
    return { ok: true };
  }

  /** Adds a cursor on the neighbouring line at the same column (real multi-cursor). */
  addCursorAbove() { return this.#addCursor(-1); }
  addCursorBelow() { return this.#addCursor(1); }

  #addCursor(direction) {
    if (!this.#view) return { ok: false };
    const state = this.#view.state;
    let added = false;
    const ranges = state.selection.ranges.map((range) => {
      const line = state.doc.lineAt(range.head);
      const targetNumber = line.number + direction;
      if (targetNumber < 1 || targetNumber > state.doc.lines) return range;
      const target = state.doc.line(targetNumber);
      const column = Math.min(range.head - line.from, target.length);
      added = true;
      return EditorSelection.cursor(target.from + column);
    });
    if (!added) return { ok: false, reason: direction < 0 ? 'No hay líneas encima del cursor' : 'No hay líneas debajo del cursor' };
    this.#view.dispatch({ selection: EditorSelection.create(ranges, 0), scrollIntoView: true });
    return { ok: true, cursors: ranges.length };
  }

  /** Real rectangular (column) selection over a range of lines. */
  selectColumn(fromLine, toLine, fromColumn = 1, toColumn = null) {
    if (!this.#view) return { ok: false };
    const doc = this.#view.state.doc;
    if (!Number.isFinite(fromLine) || !Number.isFinite(toLine) || fromLine < 1 || toLine > doc.lines || fromLine > toLine) {
      return { ok: false, reason: 'rango de líneas inválido' };
    }
    const ranges = [];
    for (let number = fromLine; number <= toLine; number += 1) {
      const line = doc.line(number);
      const from = line.from + Math.max(0, Math.min(fromColumn - 1, line.length));
      const to = toColumn === null ? line.to : line.from + Math.max(0, Math.min(toColumn - 1, line.length));
      ranges.push(EditorSelection.range(from, Math.max(from, to)));
    }
    this.#view.dispatch({ selection: EditorSelection.create(ranges, 0), scrollIntoView: true });
    return { ok: true, cursors: ranges.length };
  }

  /** Formats the active document and applies the result as a single undoable edit. */
  format() {
    if (!this.#view) return { ok: false };
    const document = this.#documents.get(this.#activeId);
    if (!document) return { ok: false, reason: 'sin documento activo' };
    const original = this.#view.state.doc.toString();
    const result = this.formatter.format(original, {
      tabSize: this.settings?.get('editor.tabSize') ?? 2,
      insertSpaces: this.settings?.get('editor.insertSpaces') !== false,
    });
    if (!result.changed) return { ok: true, changed: false, message: 'El documento ya está formateado' };
    this.#view.dispatch({ changes: { from: 0, to: this.#view.state.doc.length, insert: result.text } });
    this.stats.formats += 1;
    return { ok: true, changed: true, reindented: result.reindented, trailingRemoved: result.trailingRemoved, lines: result.lines };
  }

  /* --------------------------- search / goto --------------------------- */

  openFind() { return this.search.open({ replace: false }); }
  openReplace() { return this.search.open({ replace: true }); }
  findNext() { return this.search.findNext(); }
  findPrevious() { return this.search.findPrevious(); }
  gotoLine(line, column = null) { return this.search.gotoLine(line, column); }
  setSearch(query, options) { return this.search.set(query, options); }
  searchProject(term, options) { return this.search.searchProject(term, options); }

  /* ------------------------------- zoom ------------------------------- */

  zoomIn() { return this.#zoom(1); }
  zoomOut() { return this.#zoom(-1); }
  zoomReset() { return this.#setZoom(this.#zoomBounds().defaultValue); }

  /**
   * Límites reales del tamaño de fuente. El esquema de ajustes es la única fuente de verdad: si el
   * editor recortara a un valor que el ajuste rechaza, el cambio de zoom fallaría en silencio.
   */
  #zoomBounds() {
    const entry = this.settings?.schema?.find?.((item) => item.key === 'editor.fontSize') ?? null;
    const min = Number.isFinite(entry?.min) ? entry.min : ZOOM_MIN;
    const max = Number.isFinite(entry?.max) ? Math.max(min, entry.max) : ZOOM_MAX;
    const defaultValue = Number.isFinite(entry?.default) ? Math.min(max, Math.max(min, entry.default)) : Math.min(max, Math.max(min, DEFAULT_FONT_SIZE));
    return { min, max, defaultValue };
  }

  /** Sets an exact font size (used by Ctrl+wheel, the layout restore and the settings slider). */
  setZoom(value) { return this.#setZoom(value); }

  #zoom(delta) {
    const current = this.settings?.get('editor.fontSize') ?? DEFAULT_FONT_SIZE;
    return this.#setZoom(current + delta);
  }

  async #setZoom(value) {
    const bounds = this.#zoomBounds();
    const clamped = Math.max(bounds.min, Math.min(bounds.max, Math.round(value)));
    const result = await this.settings.set({ 'editor.fontSize': clamped }, { silent: true });
    if (result.ok !== false) {
      this.reconfigure();
      this.#emit({ type: 'zoom', value: clamped });
      return { ok: true, fontSize: clamped };
    }
    this.notifications?.warn(`No se pudo cambiar el tamaño de fuente: ${result.errors?.[0]?.message ?? 'error desconocido'}`);
    return { ok: false, errors: result.errors };
  }

  get zoom() {
    return this.settings?.get('editor.fontSize') ?? DEFAULT_FONT_SIZE;
  }

  /* --------------------------- custom keymap --------------------------- */

  #customKeymap() {
    return [
      { key: 'Ctrl-Enter', mac: 'Cmd-Enter', run: () => this.#emitCommand('runtime.run') },
      { key: 'Ctrl-Shift-Enter', mac: 'Cmd-Shift-Enter', run: () => this.#emitCommand('runtime.runInServer') },
      { key: 'Ctrl-Shift-C', mac: 'Cmd-Shift-C', run: () => this.#emitCommand('runtime.stop') },
      { key: 'Shift-Alt-F', run: (view) => { this.format(); return true; }, preventDefault: true },
      { key: 'Ctrl-g', mac: 'Cmd-g', run: () => this.#emitCommand('editor.gotoLine') },
      { key: 'Ctrl-h', mac: 'Cmd-h', run: () => this.#emitCommand('editor.replace') },
      { key: 'Ctrl-Shift-K', mac: 'Cmd-Shift-K', run: (view) => deleteLine(view) },
      { key: 'Ctrl-/', mac: 'Cmd-/', run: (view) => toggleComment(view) },
      { key: 'Shift-Alt-ArrowDown', run: (view) => copyLineDown(view) },
      { key: 'Alt-ArrowUp', run: (view) => moveLineUp(view) },
      { key: 'Alt-ArrowDown', run: (view) => moveLineDown(view) },
      { key: 'Ctrl-Alt-ArrowUp', run: () => { this.addCursorAbove(); return true; } },
      { key: 'Ctrl-Alt-ArrowDown', run: () => { this.addCursorBelow(); return true; } },
      { key: 'Ctrl-d', mac: 'Cmd-d', run: (view) => searchSelectNextOccurrence({ state: view.state, dispatch: (tr) => view.dispatch(tr) }) },
      { key: 'Ctrl-=', mac: 'Cmd-=', run: () => { void this.zoomIn(); return true; } },
      { key: 'Ctrl--', mac: 'Cmd--', run: () => { void this.zoomOut(); return true; } },
      { key: 'Ctrl-0', mac: 'Cmd-0', run: () => { void this.zoomReset(); return true; } },
      {
        key: 'Escape',
        run: (view) => {
          if (view.state.selection.ranges.length > 1) {
            view.dispatch({ selection: EditorSelection.cursor(view.state.selection.main.head) });
            return true;
          }
          return false;
        },
      },
    ];
  }

  /** Sends a command to the application through the event bus (single execution path). */
  #emitCommand(commandId) {
    this.eventBus?.emit('command:request', { id: commandId, source: 'editor' });
    return true;
  }

  /* ------------------------------------------------------------------ *
   * Reporting
   * ------------------------------------------------------------------ */

  snapshot() {
    return {
      mounted: this.mounted,
      activeId: this.#activeId,
      documents: this.documents.map((document) => ({
        id: document.id,
        name: document.name,
        dirty: document.dirty,
        lines: document.lines,
        length: document.length,
        diagnostics: document.diagnostics,
      })),
      stats: { ...this.stats },
      diagnostics: {
        runs: this.stats.diagnosticRuns,
        errors: this.stats.diagnosticErrors,
        lastAt: this.stats.lastDiagnosticsAt,
        supported: this.analysis.supported,
        reason: this.analysis.reason,
        engine: this.analysis.stats,
      },
      formatter: this.formatter.describe(),
      completion: this.completion.describe(),
      syntax: this.#highlighter.describe(this.themeManager?.active ?? null),
      minimap: this.#minimap?.stats ?? { enabled: false, attached: false, reason: this.#minimapReason(this.capabilities?.isAvailable?.(CapabilityId.UI_CANVAS) !== false) },
      zoom: this.zoom,
    };
  }

  /** Inserts text at the cursor (used by the palette's insert actions). */
  insertText(text, { select = false } = {}) {
    if (!this.#view) return { ok: false };
    const range = this.#view.state.selection.main;
    this.#view.dispatch({
      changes: { from: range.from, to: range.to, insert: text },
      selection: select ? EditorSelection.range(range.from, range.from + text.length) : undefined,
      scrollIntoView: true,
    });
    this.#view.focus();
    return { ok: true, from: range.from, to: range.from + text.length };
  }

  /** Applies a replacement given absolute offsets (used by diagnostics/quick fixes). */
  replaceRange(from, to, insert) {
    if (!this.#view) return { ok: false };
    const length = this.#view.state.doc.length;
    if (from < 0 || to > length || from > to) {
      return { ok: false, reason: `Rango inválido (${from}..${to}) para un documento de ${length} caracteres` };
    }
    this.#view.dispatch({ changes: { from, to, insert }, scrollIntoView: true });
    return { ok: true };
  }

  dispose() {
    this.#disposed = true;
    if (this.#lintTimer) clearTimeout(this.#lintTimer);
    this.#minimap?.destroy();
    this.#search?.detach();
    this.#view?.destroy();
    this.#view = null;
    this.#documents.clear();
    this.#listeners.clear();
    this.#cursorListeners.clear();
    this.#diagnosticsListeners.clear();
  }

  get disposed() {
    return this.#disposed;
  }
}
