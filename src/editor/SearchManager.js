/**
 * SearchManager — find, replace, go-to-line and project-wide search.
 *
 * In-document operations use the real CodeMirror search extension
 * (`@codemirror/search`), so matches are highlighted, `Enter` jumps between them and replace
 * works on the live document with undo support. Project-wide search calls the scripts API,
 * which searches the real files on disk.
 */

import { findNext, findPrevious, getSearchQuery, openSearchPanel, replaceAll, replaceNext, search, setSearchQuery, closeSearchPanel, SearchQuery } from '@codemirror/search';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

export class SearchManager {
  #view = null;
  #store = null;
  #state = { open: false, query: '', caseSensitive: false, regexp: false, wholeWord: false, replaced: 0, matches: 0 };
  #listeners = new Set();

  constructor({ logger, errorBus, apiClient } = {}) {
    this.logger = logger;
    this.errorBus = errorBus;
    this.apiClient = apiClient;
  }

  /** Search extension to include in the editor state (top panel, not the dialog). */
  static extension() {
    return search({ top: true });
  }

  attach({ view, store }) {
    this.#view = view;
    this.#store = store;
  }

  detach() {
    this.#view = null;
  }

  get state() {
    return { ...this.#state };
  }

  get canSearch() {
    return Boolean(this.#view);
  }

  /** Opens the search panel and focuses the query field. */
  open({ replace = false } = {}) {
    if (!this.#view) return { ok: false, reason: 'no hay editor activo' };
    openSearchPanel(this.#view);
    this.#state.open = true;
    const panel = this.#view.dom.querySelector('.cm-search');
    const input = panel?.querySelector('input[name="search"]');
    if (input) {
      input.focus();
      input.select?.();
    }
    const replaceInput = panel?.querySelector('input[name="replace"]');
    if (replace && replaceInput) replaceInput.focus();
    this.#notify();
    return { ok: true, replace };
  }

  close() {
    if (!this.#view) return { ok: false };
    closeSearchPanel(this.#view);
    this.#state.open = false;
    this.#notify();
    return { ok: true };
  }

  /** Sets the query programmatically (used by the command palette and search-in-selection). */
  set(query, { caseSensitive = false, regexp = false, wholeWord = false, literal = false } = {}) {
    if (!this.#view) return { ok: false, reason: 'no hay editor activo' };
    this.#state = { ...this.#state, query, caseSensitive, regexp, wholeWord };
    const searchQuery = new SearchQuery({ search: query, caseSensitive, regexp, wholeWord, literal });
    this.#view.dispatch({ effects: setSearchQuery.of(searchQuery) });
    const matches = this.countMatches(searchQuery);
    this.#state.matches = matches;
    this.#notify();
    return { ok: true, matches };
  }

  findNext({ select = true } = {}) {
    if (!this.#view) return { ok: false, reason: 'no hay editor activo' };
    const found = findNext(this.#view);
    if (found && select) this.#scrollToSelection();
    return { ok: found, found };
  }

  findPrevious() {
    if (!this.#view) return { ok: false, reason: 'no hay editor activo' };
    const found = findPrevious(this.#view);
    if (found) this.#scrollToSelection();
    return { ok: found, found };
  }

  replaceNextMatch(replacement = null) {
    if (!this.#view) return { ok: false, reason: 'no hay editor activo' };
    if (typeof replacement === 'string') {
      const current = getSearchQuery(this.#view.state);
      this.#view.dispatch({ effects: setSearchQuery.of(current.replace?.({ replace: replacement }) ?? new SearchQuery({ search: current.search, replace: replacement })) });
    }
    const replaced = replaceNext(this.#view);
    if (replaced) this.#state.replaced += 1;
    this.#notify();
    return { ok: replaced, replaced: this.#state.replaced };
  }

  replaceAllMatches(replacement = null) {
    if (!this.#view) return { ok: false, reason: 'no hay editor activo' };
    if (typeof replacement === 'string') {
      const current = getSearchQuery(this.#view.state);
      this.#view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: current.search, replace: replacement, caseSensitive: current.caseSensitive, regexp: current.regexp, wholeWord: current.wholeWord })) });
    }
    const before = this.countMatches(getSearchQuery(this.#view.state));
    const applied = replaceAll(this.#view);
    this.#state.replaced += applied ? before : 0;
    this.#notify();
    return { ok: applied, replaced: applied ? before : 0 };
  }

  /** Selects every occurrence of the current query (real multi-selection). */
  selectAllMatches() {
    if (!this.#view) return { ok: false, reason: 'no hay editor activo' };
    const query = getSearchQuery(this.#view.state);
    if (!query.search) return { ok: false, reason: 'no hay búsqueda activa' };
    const ranges = [];
    for (const range of query.getCursor(this.#view.state)) {
      if (range.from !== range.to) ranges.push(EditorSelection.range(range.from, range.to));
    }
    if (ranges.length === 0) return { ok: false, reason: 'sin coincidencias' };
    this.#view.dispatch({ selection: EditorSelection.create(ranges, 0), scrollIntoView: true });
    return { ok: true, matches: ranges.length };
  }

  /**
   * Jumps to a 1-based line (and optional column), selecting the line so the user sees it.
   */
  gotoLine(line, column = null) {
    if (!this.#view) return { ok: false, reason: 'no hay editor activo' };
    const doc = this.#view.state.doc;
    if (!Number.isFinite(line) || line < 1 || line > doc.lines) {
      return { ok: false, reason: `La línea ${line} está fuera del documento (1..${doc.lines})` };
    }
    const target = doc.line(Math.floor(line));
    const position = column === null
      ? target.from
      : Math.min(target.from + Math.max(0, column - 1), target.to);
    this.#view.dispatch({
      selection: EditorSelection.cursor(position),
      effects: EditorView.scrollIntoView(position, { y: 'center' }),
    });
    this.#view.focus();
    return { ok: true, line, column };
  }

  /** Counts matches without touching the document. */
  countMatches(query = null) {
    if (!this.#view) return 0;
    const effective = query ?? getSearchQuery(this.#view.state);
    if (!effective.search) return 0;
    let count = 0;
    try {
      for (const _ of effective.getCursor(this.#view.state)) count += 1;
    } catch (err) {
      this.logger?.warn(`Expresión de búsqueda inválida: ${err.message}`, { source: 'SearchManager' });
      return 0;
    }
    return count;
  }

  /** Real project-wide search through the scripts API (files on disk). */
  async searchProject(term, { limit = 100, caseSensitive = false } = {}) {
    if (!this.apiClient) return { ok: false, error: 'sin cliente de API' };
    const query = String(term ?? '').trim();
    if (query === '') return { ok: true, results: [], total: 0 };
    try {
      const payload = await this.apiClient.get('/api/scripts/search', {
        query: { q: query, limit: String(limit), caseSensitive: caseSensitive ? '1' : '0' },
        timeoutMs: 20_000,
      });
      return { ok: true, results: payload.results ?? [], total: payload.total ?? 0, query };
    } catch (err) {
      this.errorBus?.report(err, { source: 'SearchManager.searchProject' });
      return { ok: false, error: err.message, results: [], total: 0 };
    }
  }

  #scrollToSelection() {
    const selection = this.#view?.state.selection.main;
    if (!selection) return;
    this.#view.dispatch({ effects: EditorView.scrollIntoView(selection.from, { y: 'center' }) });
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #notify() {
    for (const listener of [...this.#listeners]) {
      try {
        listener(this.state);
      } catch {
        /* ignore broken listeners */
      }
    }
  }

  dispose() {
    this.#view = null;
    this.#listeners.clear();
  }
}

export { EditorSelection };
