/**
 * CodeMirror theme built from the active theme tokens.
 *
 * The editor chrome (gutter, selection, active line, brackets, search matches, tooltips,
 * panels, diagnostics) is expressed exclusively with `var(--…)` references, so the editor
 * follows the ThemeManager like the rest of the UI and no colour is hard-coded here.
 */

import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';

/** Structural + colour theme for the editor surface. */
export function buildEditorTheme({ dark = true } = {}) {
  return EditorView.theme({
    '&': {
      color: 'var(--text-primary)',
      backgroundColor: 'var(--editor-bg)',
      height: '100%',
      fontSize: 'var(--editor-font-size, 13px)',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'var(--editor-font-family, var(--font-mono))',
      lineHeight: 'var(--editor-line-height, 1.55)',
      overflow: 'auto',
    },
    '.cm-content': {
      caretColor: 'var(--editor-cursor)',
      padding: '6px 0',
    },
    '.cm-line': { padding: '0 10px' },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--editor-cursor)',
      borderLeftWidth: '2px',
    },
    '.cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'var(--editor-selection)',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: 'var(--editor-selection)',
    },
    '.cm-activeLine': { backgroundColor: 'var(--editor-line-highlight)' },
    '.cm-gutters': {
      backgroundColor: 'var(--editor-gutter-bg)',
      color: 'var(--editor-gutter-text)',
      border: 'none',
      borderRight: '1px solid var(--border-subtle)',
      userSelect: 'none',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--editor-line-highlight)',
      color: 'var(--editor-gutter-active)',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px', minWidth: '26px' },
    '.cm-foldGutter .cm-gutterElement': { color: 'var(--text-disabled)', padding: '0 4px' },
    '.cm-foldGutter .cm-gutterElement:hover': { color: 'var(--text-primary)' },
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--elevated-bg)',
      border: '1px solid var(--border-default)',
      borderRadius: '4px',
      color: 'var(--text-muted)',
      padding: '0 4px',
    },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: 'var(--editor-bracket-match)',
      outline: '1px solid var(--border-strong)',
    },
    '.cm-nonmatchingBracket, &.cm-focused .cm-nonmatchingBracket': { color: 'var(--error)' },
    '.cm-selectionMatch': { backgroundColor: 'var(--editor-selection-match)' },
    '.cm-searchMatch': { backgroundColor: 'var(--editor-search-match)', outline: '1px solid var(--border-subtle)' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--editor-search-active)' },
    '.cm-panels': {
      backgroundColor: 'var(--panel-header-bg)',
      color: 'var(--text-primary)',
      borderBottom: '1px solid var(--border-subtle)',
    },
    '.cm-panels.cm-panels-bottom': {
      borderTop: '1px solid var(--border-subtle)',
      borderBottom: 'none',
    },
    '.cm-panel.cm-search': { padding: '6px 8px', fontFamily: 'var(--font-ui)' },
    '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-textfield': {
      backgroundColor: 'var(--input-bg)',
      color: 'var(--text-primary)',
      border: '1px solid var(--border-default)',
      borderRadius: '5px',
      padding: '3px 6px',
      fontFamily: 'var(--font-ui)',
    },
    '.cm-panel.cm-search button:hover': { backgroundColor: 'var(--input-bg-hover)' },
    '.cm-panel.cm-search label': { color: 'var(--text-secondary)', fontSize: '11.5px' },
    '.cm-button': {
      backgroundImage: 'none',
      backgroundColor: 'var(--elevated-bg)',
      color: 'var(--text-primary)',
      border: '1px solid var(--border-default)',
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--elevated-bg)',
      border: '1px solid var(--border-default)',
      borderRadius: '7px',
      boxShadow: 'var(--shadow-md)',
      color: 'var(--text-primary)',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-mono)', fontSize: '12.5px', maxHeight: '260px' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '3px 8px' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'var(--selected-bg)',
      color: 'var(--text-primary)',
    },
    '.cm-completionLabel': { color: 'var(--text-primary)' },
    '.cm-completionDetail': { color: 'var(--text-muted)', fontStyle: 'normal', marginLeft: '8px' },
    '.cm-completionIcon': { color: 'var(--text-muted)' },
    '.cm-completionIcon-function::after': { content: '"ƒ"' },
    '.cm-completionIcon-variable::after': { content: '"𝑥"' },
    '.cm-completionIcon-property::after': { content: '"·"' },
    '.cm-completionIcon-keyword::after': { content: '"k"' },
    '.cm-completionIcon-snippet::after': { content: '"⌘"' },
    '.cm-completionIcon-type::after': { content: '"T"' },
    '.cm-completionMatchedText': { textDecoration: 'none', color: 'var(--accent)', fontWeight: '700' },
    '.cm-diagnostic': {
      padding: '4px 8px',
      fontFamily: 'var(--font-ui)',
      fontSize: '12px',
      borderLeft: '3px solid var(--border-strong)',
    },
    '.cm-diagnostic-error': { borderLeftColor: 'var(--error)', backgroundColor: 'var(--error-subtle)' },
    '.cm-diagnostic-warning': { borderLeftColor: 'var(--warning)', backgroundColor: 'var(--warning-subtle)' },
    '.cm-diagnostic-info': { borderLeftColor: 'var(--info)', backgroundColor: 'var(--info-subtle)' },
    '.cm-lintRange-error': {
      backgroundImage: 'none',
      textDecoration: 'underline wavy var(--error)',
      textUnderlineOffset: '3px',
    },
    '.cm-lintRange-warning': {
      backgroundImage: 'none',
      textDecoration: 'underline wavy var(--warning)',
      textUnderlineOffset: '3px',
    },
    '.cm-lintRange-info': { backgroundImage: 'none', textDecoration: 'underline dotted var(--info)' },
    '.cm-lint-marker-error': { content: 'none' },
    '.cm-tooltip-lint': { fontFamily: 'var(--font-ui)' },
    '.cm-searchMatch': { borderRadius: '2px' },
    '.cm-panel input[type="checkbox"]': { accentColor: 'var(--accent)' },
    '.cm-placeholder': { color: 'var(--text-disabled)' },
    '.cm-announced': { display: 'none' },
    '.cm-specialChar': { color: 'var(--error)' },
    '.cm-whitespace': { color: 'var(--editor-whitespace)' },
  }, { dark });
}

/**
 * Per-user appearance: font size/family, line height, tab size and word wrap.
 * Lives in a Compartment so a settings change reconfigures the view without recreating it.
 */
export function buildAppearanceExtensions({
  fontSize = 14,
  fontFamily = '',
  lineHeight = 1.55,
  tabSize = 4,
  insertSpaces = true,
  wordWrap = false,
  wrapColumn = 100,
  cursorBlink = true,
} = {}) {
  const theme = EditorView.theme({
    '&': {
      fontSize: `${fontSize}px`,
      '--editor-font-size': `${fontSize}px`,
      '--editor-line-height': String(lineHeight),
    },
    '.cm-scroller': {
      lineHeight: String(lineHeight),
      ...(fontFamily ? { fontFamily } : {}),
    },
    '.cm-content': {
      tabSize: String(tabSize),
      ...(fontFamily ? { fontFamily } : {}),
      // Real wrap width: with line wrapping on, the content column never exceeds `wrapColumn`
      // characters, which is what the setting promises.
      ...(wordWrap && Number.isFinite(wrapColumn) ? { maxWidth: `${Math.round(wrapColumn)}ch` } : {}),
    },
    // `editor.cursorBlink = false` stops the blink animation for real (the caret stays visible).
    ...(cursorBlink ? {} : { '.cm-cursor, .cm-dropCursor': { animation: 'none' } }),
  });
  return [
    theme,
    EditorState.tabSize.of(tabSize),
    EditorState.indentUnit.of(insertSpaces ? ' '.repeat(tabSize) : '\t'),
    wordWrap ? EditorView.lineWrapping : [],
  ];
}

/** Cursor-line and selection visuals that must exist even with `drawSelection` disabled. */
export const editorSelectionTheme = EditorView.baseTheme({
  '.cm-cursorLayer': { zIndex: '3' },
  '.cm-selectionLayer': { zIndex: '2' },
});
