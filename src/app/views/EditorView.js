/**
 * EditorView — the editing workspace: toolbar, tab strip, CodeMirror surface, cursor status and
 * the diagnostics panel.
 *
 * The heavy lifting lives in `EditorManager` (CodeMirror, linting, completion, minimap) and
 * `TabsController` (open documents). This view only builds the chrome and keeps the status
 * indicators in sync with real data coming from those managers.
 */

import { el } from '../../renderer/utils/dom.js';
import { icon } from '../../ui/icons.js';
import { formatNumber } from '../../renderer/utils/format.js';
import { Dialect } from '../../shared/constants.js';
import { iconButton, labelledButton, panel } from './helpers.js';

export class EditorView {
  #app;
  #root = null;
  #nodes = {};
  #unsubscribers = [];
  #placeholder = null;

  constructor(app) {
    this.#app = app;
  }

  get id() {
    return 'editor';
  }

  get title() {
    return 'Editor';
  }

  mount() {
    this.#root = el('div.view', { attrs: { 'aria-label': 'Editor de scripts' } });

    /* ------------------------------------------------------------- toolbar */
    const runButton = labelledButton({ label: 'Ejecutar', iconName: 'play', variant: 'primary', onClick: () => this.#app.runActive() });
    const stopButton = labelledButton({ label: 'Detener', iconName: 'stop', variant: 'danger', onClick: () => this.#app.stopExecution(), disabled: true });
    const dialectSelect = el('select.select', {
      attrs: { title: 'Dialecto del archivo', 'aria-label': 'Dialecto del archivo' },
      on: { change: () => void this.#app.tabs.setDialect(undefined, dialectSelect.value) },
    }, [Dialect.LUAU, Dialect.LUA54, Dialect.LUA51].map((dialect) => el('option', { value: dialect, text: dialectLabel(dialect) })));
    const engineSelect = el('select.select', {
      attrs: { title: 'Motor de ejecución', 'aria-label': 'Motor de ejecución' },
      on: { change: () => void this.#changeEngine(engineSelect.value) },
    });
    const runMode = el('select.select', {
      attrs: { title: 'Dónde ejecutar', 'aria-label': 'Dónde ejecutar' },
      on: { change: (event) => { this.#app.settings.set({ 'execution.enginePreference': event.target.value }); } },
    }, [
      el('option', { value: 'auto', text: 'Automático' }),
    ]);

    const toolbar = el('div.editor-toolbar.toolbar', { attrs: { role: 'toolbar', 'aria-label': 'Acciones del editor' } }, [
      el('div.toolbar__group', null, [runButton, stopButton]),
      el('div.toolbar-separator'),
      el('div.toolbar__group', null, [
        iconButton({ iconName: 'plus', title: 'Nuevo script (Ctrl+N)', onClick: () => this.#app.newScript() }),
        iconButton({ iconName: 'folder', title: 'Abrir script (Ctrl+O)', onClick: () => this.#app.openPicker() }),
        iconButton({ iconName: 'save', title: 'Guardar (Ctrl+S)', onClick: () => this.#app.saveActive() }),
        iconButton({ iconName: 'export', title: 'Guardar como… (Ctrl+Shift+S)', onClick: () => this.#app.saveActive({ as: true }) }),
      ]),
      el('div.toolbar-separator'),
      el('div.toolbar__group', null, [
        iconButton({ iconName: 'search', title: 'Buscar (Ctrl+F)', onClick: () => this.#app.editor.openFind() }),
        iconButton({ iconName: 'replace', title: 'Reemplazar (Ctrl+H)', onClick: () => this.#app.editor.openReplace() }),
        iconButton({ iconName: 'format', title: 'Formatear (Shift+Alt+F)', onClick: () => this.#app.formatDocument() }),
        iconButton({ iconName: 'check', title: 'Analizar ahora (Ctrl+Shift+A)', onClick: () => this.#app.analyzeNow() }),
        iconButton({ iconName: 'wand', title: 'Anotar tipos en una copia', onClick: () => this.#app.annotateTypes() }),
      ]),
      el('div.toolbar-separator'),
      el('div.toolbar__group', null, [dialectSelect, engineSelect, runMode]),
      el('div.toolbar__spacer'),
      el('div.toolbar__group', null, [
        iconButton({ iconName: 'zoom-out', title: 'Reducir texto (Ctrl+-)', onClick: () => this.#app.editor.zoomOut() }),
        iconButton({ iconName: 'zoom-in', title: 'Aumentar texto (Ctrl+=)', onClick: () => this.#app.editor.zoomIn() }),
        iconButton({ iconName: 'eye', title: 'Alternar ajuste de línea', onClick: () => this.#app.toggleSetting('editor.wordWrap') }),
        iconButton({ iconName: 'panel-left', title: 'Alternar minimapa', onClick: () => this.#app.toggleSetting('editor.minimap') }),
      ]),
    ]);
    this.#nodes.runButton = runButton;
    this.#nodes.stopButton = stopButton;
    this.#nodes.dialectSelect = dialectSelect;
    this.#nodes.engineSelect = engineSelect;

    /* --------------------------------------------------------- tab strip */
    const tabsHost = el('div.tabs', { attrs: { role: 'tablist', 'aria-label': 'Archivos abiertos' } });
    this.#nodes.tabsHost = tabsHost;

    /* ------------------------------------------------------------- editor */
    const editorPane = el('div.view__pane.view__pane--grow');
    const host = this.#app.editorHost;
    host.classList.add('editor-host');
    editorPane.appendChild(host);

    this.#placeholder = el('div.editor-placeholder', null, [
      icon('file-code', { size: 'lg' }),
      el('div', null, [
        el('strong', { text: 'No hay ningún archivo abierto' }),
        el('p', { text: 'Crea un script nuevo (Ctrl+N) o abre uno guardado (Ctrl+O) para empezar a editar.' }),
      ]),
      el('div.btn-group', null, [
        labelledButton({ label: 'Nuevo script', iconName: 'plus', variant: 'primary', onClick: () => this.#app.newScript() }),
        labelledButton({ label: 'Abrir script', iconName: 'folder', onClick: () => this.#app.openPicker() }),
      ]),
    ]);
    host.appendChild(this.#placeholder);

    const editorStatus = el('div.editor-status');
    const lineDiagnostics = el('div.editor-diagnostics', { attrs: { 'aria-live': 'polite' } });
    editorPane.append(editorStatus, lineDiagnostics);

    const side = el('aside.view__pane.view__pane--side');
    const diagnosticsPanel = panel({
      title: 'Diagnósticos',
      iconName: 'alert-triangle',
      flush: true,
      actions: [iconButton({ iconName: 'check', title: 'Analizar ahora', size: 'sm', onClick: () => this.#app.analyzeNow() })],
      body: el('div.list', { attrs: { role: 'list' } }),
    });
    side.appendChild(diagnosticsPanel);

    const body = el('div.view__body', null, [editorPane, side]);
    this.#root.append(toolbar, tabsHost, body);

    this.#nodes.editorStatus = editorStatus;
    this.#nodes.lineDiagnostics = lineDiagnostics;
    this.#nodes.diagnosticsPanel = diagnosticsPanel;
    this.#nodes.diagnosticsList = diagnosticsPanel.querySelector('.list');
    return this.#root;
  }

  async activate() {
    const editor = this.#app.editor;
    this.#unsubscribers.push(
      editor.onCursor(() => this.#renderCursor()),
      editor.onDiagnostics(() => this.#renderDiagnostics()),
      editor.onEvent((event) => this.#onEditorEvent(event)),
      this.#app.tabs.onChange(() => this.#renderTabsState()),
      this.#app.runtime.onStateChange(() => this.#renderRuntimeState()),
      this.#app.runtime.onExecution(() => this.#renderRuntimeState()),
      this.#app.settings.subscribe(() => this.#renderSettingsDependent()),
    );
    this.#renderEngineOptions();
    this.#renderCursor();
    this.#renderDiagnostics();
    this.#renderTabsState();
    this.#renderRuntimeState();
    this.#renderSettingsDependent();
    this.#app.logger.debug('Vista de editor activada', { source: 'EditorView' });
  }

  deactivate() {
    for (const unsubscribe of this.#unsubscribers.splice(0)) unsubscribe?.();
  }

  #onEditorEvent(event) {
    if (event.type === 'open' || event.type === 'close') this.#renderTabsState();
    if (event.type === 'dirty') this.#renderTabsState();
  }

  #renderTabsState() {
    const tabs = this.#app.tabs;
    const count = tabs?.count ?? 0;
    const host = this.#nodes.tabsHost;
    host.hidden = count === 0;
    const hasDocument = (this.#app.editor?.documents?.length ?? 0) > 0;
    this.#placeholder.hidden = hasDocument;
    this.#nodes.dialectSelect.disabled = !hasDocument;
    this.#nodes.dialectSelect.value = this.#app.editor?.activeDocument?.dialect ?? Dialect.LUAU;
    const disabled = !hasDocument;
    for (const key of ['runButton', 'stopButton']) {
      const node = this.#nodes[key];
      if (node && key === 'runButton') node.disabled = disabled;
    }
    this.#renderRuntimeState();
  }

  #renderRuntimeState() {
    const running = this.#app.runtime.isRunning;
    this.#nodes.runButton.disabled = running || (this.#app.editor?.documents?.length ?? 0) === 0;
    this.#nodes.stopButton.disabled = !running;
    this.#nodes.runButton.classList.toggle('is-busy', running);
    const state = this.#app.runtime.stateInfo;
    const engine = this.#app.runtime.activeEngine;
    this.#nodes.engineSelect.title = engine
      ? `Motor activo: ${engine.label} (${engine.id}) · estado ${state?.label ?? state?.state ?? ''}`
      : `Sin motor activo · estado ${state?.label ?? state?.state ?? ''}`;
  }

  #renderSettingsDependent() {
    const wrap = this.#app.settings.get('editor.wordWrap') === true;
    const minimap = this.#app.settings.get('editor.minimap') === true;
    this.#nodes.editorStatus.dataset.wrap = String(wrap);
    this.#nodes.editorStatus.dataset.minimap = String(minimap);
  }

  #renderCursor() {
    const info = this.#app.editor?.cursorInfo?.();
    const document = this.#app.editor?.activeDocument;
    const parts = [];
    if (!info || !document) {
      parts.push(el('span', { text: 'Sin documento activo' }));
    } else {
      parts.push(el('span', { text: `Ln ${info.line}, Col ${info.column}` }));
      if (info.selectedText) parts.push(el('span', { text: `${formatNumber(info.selectedText.length)} seleccionados` }));
      if (info.selectedLines > 1) parts.push(el('span', { text: `${info.selectedLines} líneas` }));
      if (info.multipleCursors) parts.push(el('span', { text: `${info.cursors} cursores` }));
      parts.push(el('span', { text: document.dialect === Dialect.LUA54 ? 'Lua 5.4' : document.dialect === Dialect.LUA51 ? 'Lua 5.1' : 'Luau' }));
      parts.push(el('span', { text: `Indentación: ${this.#app.settings.get('editor.insertSpaces') === false ? 'tabuladores' : `${this.#app.settings.get('editor.tabSize') ?? 4} espacios`}` }));
      parts.push(el('span', { text: `Análisis: ${this.#app.settings.get('editor.analysisEnabled') === false ? 'desactivado' : (this.#app.settings.get('editor.analysisMode') ?? 'strict')}` }));
    }
    this.#nodes.editorStatus.replaceChildren(...parts.flatMap((node, index) => (index === 0 ? [node] : [el('span', { text: '·' }), node])));
  }

  #renderDiagnostics() {
    const diagnostics = this.#app.editor?.diagnosticsFor?.() ?? [];
    const errors = diagnostics.filter((entry) => entry.severity === 'error');
    const warnings = diagnostics.filter((entry) => entry.severity === 'warning');
    const infos = diagnostics.filter((entry) => entry.severity !== 'error' && entry.severity !== 'warning');

    const list = this.#nodes.diagnosticsList;
    if (diagnostics.length === 0) {
      list.replaceChildren(el('div.list__empty', { text: this.#app.settings.get('editor.analysisEnabled') === false ? 'El análisis está desactivado en Ajustes › Editor.' : 'Sin problemas detectados en el archivo activo.' }));
    } else {
      list.replaceChildren(...diagnostics.slice(0, 200).map((entry) => el(`div.diagnostic.diagnostic--${entry.severity}`, {
        attrs: { title: entry.message, role: 'button', tabindex: '0' },
        on: {
          click: () => this.#app.editor.gotoLine(entry.line ?? 1, entry.column ?? null),
          keydown: (event) => {
            if (event.key === 'Enter') this.#app.editor.gotoLine(entry.line ?? 1, entry.column ?? null);
          },
        },
      }, [
        icon(entry.severity === 'error' ? 'x-circle' : entry.severity === 'warning' ? 'alert-triangle' : 'info', { size: 'sm' }),
        el('span.diagnostic__message', { text: entry.message }),
        entry.line ? el('span.diagnostic__location', { text: `${entry.line}:${entry.column ?? 1}` }) : null,
      ])));
    }

    const summary = `${errors.length} errores · ${warnings.length} avisos${infos.length ? ` · ${infos.length} avisos informativos` : ''}`;
    this.#nodes.lineDiagnostics.dataset.summary = summary;
    const panelTitle = this.#nodes.diagnosticsPanel.querySelector('.panel__title');
    if (panelTitle) panelTitle.textContent = `Diagnósticos (${diagnostics.length})`;
  }

  #renderEngineOptions() {
    const select = this.#nodes.engineSelect;
    const engines = this.#app.runtime.engines ?? [];
    const preference = this.#app.settings.get('execution.enginePreference') ?? 'auto';
    const options = [el('option', { value: 'auto', text: 'Motor automático', selected: preference === 'auto' })];
    for (const engine of engines) {
      options.push(el('option', {
        value: engine.id,
        text: `${engine.label ?? engine.id}${engine.available ? '' : ' (no disponible)'}`,
        selected: preference === engine.id,
        disabled: false,
      }));
    }
    select.replaceChildren(...options);
    select.value = preference;
    if (engines.length === 0) {
      select.title = 'Todavía no se detectaron motores de ejecución';
    }
  }

  async #changeEngine(engineId) {
    await this.#app.settings.set({ 'execution.enginePreference': engineId });
    await this.#app.runtime.refresh({ force: false });
    this.#renderEngineOptions();
    const engine = this.#app.runtime.resolveEngine();
    this.#app.notifications.info(
      engine ? `Motor seleccionado: ${engine.label ?? engine.id}` : 'No hay ningún motor disponible para el dialecto actual',
      { source: 'EditorView' },
    );
  }

  async reload() {
    this.#renderEngineOptions();
    this.#renderDiagnostics();
    this.#renderCursor();
    this.#renderRuntimeState();
  }

  get element() {
    return this.#root;
  }
}

function dialectLabel(dialect) {
  return dialect === Dialect.LUA54 ? 'Lua 5.4' : dialect === Dialect.LUA51 ? 'Lua 5.1' : 'Luau';
}
