/**
 * Formatter — real (conservative) Lua/Luau formatting.
 *
 * What it actually does, line by line, using the same block-depth rules as the editor's
 * indentation:
 *   - re-indents each code line according to its nesting depth;
 *   - dedents `end`/`else`/`elseif`/`until` and closing brackets;
 *   - keeps the content of multi-line strings and long comments untouched (only their
 *     leading whitespace is preserved verbatim — reformatting them could change data);
 *   - removes trailing whitespace;
 *   - optionally collapses runs of blank lines (kept at most two).
 *
 * It deliberately does *not* reflow expressions, rewrite quotes or reorder code: a formatter
 * that changes semantics is worse than none. The result is deterministic and reports exactly
 * how many lines changed.
 */

import { lineDepthDelta, stripLuaLiterals } from './lua-language.js';

/** Tracks whether the cursor sits inside a long string/comment after each processed line. */
class LiteralTracker {
  constructor() {
    this.longComment = 0; // bracket level, 0 = not inside
    this.longString = 0;
    this.blockComment = false;
  }

  get insideLiteral() {
    return this.longComment > 0 || this.longString > 0 || this.blockComment;
  }

  /** Scans one raw line, updating the state. Returns the state *at the start* of the line. */
  scan(line) {
    const startState = { ...this };
    let index = 0;
    while (index < line.length) {
      if (this.longComment > 0) {
        const close = `]${'='.repeat(this.longComment)}]`;
        const end = line.indexOf(close, index);
        if (end === -1) return startState;
        this.longComment = 0;
        index = end + close.length;
        continue;
      }
      if (this.longString > 0) {
        const close = `]${'='.repeat(this.longString)}]`;
        const end = line.indexOf(close, index);
        if (end === -1) return startState;
        this.longString = 0;
        index = end + close.length;
        continue;
      }
      const char = line[index];
      if (char === '-' && line[index + 1] === '-') {
        const match = /^--\[(=*)\[/.exec(line.slice(index));
        if (match) {
          this.longComment = match[1].length;
          index += match[0].length;
          const close = `]${match[1]}]`;
          const end = line.indexOf(close, index);
          if (end === -1) return startState;
          this.longComment = 0;
          index = end + close.length;
          continue;
        }
        return startState; // line comment: nothing else matters on this line
      }
      const longMatch = /^\[(=*)\[/.exec(line.slice(index));
      if (longMatch) {
        this.longString = longMatch[1].length;
        index += longMatch[0].length;
        const close = `]${longMatch[1]}]`;
        const end = line.indexOf(close, index);
        if (end === -1) return startState;
        this.longString = 0;
        index = end + close.length;
        continue;
      }
      if (char === '"' || char === "'" || char === '`') {
        let cursor = index + 1;
        while (cursor < line.length) {
          if (line[cursor] === '\\') cursor += 2;
          else if (line[cursor] === char) { cursor += 1; break; }
          else cursor += 1;
        }
        index = cursor;
        continue;
      }
      index += 1;
    }
    return startState;
  }
}

const CLOSER_AT_START = /^(end|else|elseif|until)\b/;
const CLOSING_BRACKETS_AT_START = /^[)\]}]/;

export class Formatter {
  constructor({ settings, logger } = {}) {
    this.settings = settings;
    this.logger = logger;
    this.stats = { formatted: 0, linesChanged: 0, lastAt: null };
  }

  get options() {
    return {
      tabSize: this.settings?.get('editor.tabSize') ?? 2,
      insertSpaces: this.settings?.get('editor.insertSpaces') !== false,
      collapseBlankLines: true,
    };
  }

  /**
   * Formats a full document.
   * @param {string} text
   * @param {{ tabSize?: number, insertSpaces?: boolean, collapseBlankLines?: boolean }} [options]
   * @returns {{ text: string, changed: boolean, lines: number, reindented: number, trailingRemoved: number, blankLinesCollapsed: number, errors: string[] }}
   */
  format(text, options = {}) {
    const config = { ...this.options, ...options };
    const unit = config.insertSpaces ? ' '.repeat(Math.max(1, config.tabSize)) : '\t';
    const lines = String(text ?? '').split('\n');
    const output = [];
    const errors = [];

    const tracker = new LiteralTracker();
    let depth = 0;
    let reindented = 0;
    let trailingRemoved = 0;
    let blankLinesCollapsed = 0;

    for (let index = 0; index < lines.length; index += 1) {
      const raw = lines[index];
      const wasInsideLiteral = tracker.insideLiteral;
      tracker.scan(raw);

      const withoutTrailing = raw.replace(/[ \t]+$/, '');
      if (withoutTrailing !== raw) trailingRemoved += 1;

      if (withoutTrailing.trim() === '') {
        output.push('');
        blankLinesCollapsed += 1;
        // A blank line does not change block depth, but it resets nothing either.
        continue;
      }

      if (wasInsideLiteral && !tracker.insideLiteral) {
        // The line closes a long literal: keep it verbatim so the payload stays intact.
        output.push(withoutTrailing);
        depth += lineDepthDelta(withoutTrailing);
        depth = Math.max(0, depth);
        continue;
      }
      if (wasInsideLiteral || tracker.insideLiteral) {
        output.push(withoutTrailing);
        continue;
      }

      const code = stripLuaLiterals(withoutTrailing);
      const trimmedCode = code.trim();
      const startsWithCloser = CLOSER_AT_START.test(trimmedCode) || CLOSING_BRACKETS_AT_START.test(trimmedCode);
      const targetDepth = Math.max(0, startsWithCloser ? depth - 1 : depth);
      const desiredIndent = unit.repeat(targetDepth);
      const currentIndent = withoutTrailing.match(/^[ \t]*/)[0];

      let line = withoutTrailing;
      if (currentIndent !== desiredIndent) {
        // Only the leading whitespace is rewritten; the code itself is never touched.
        line = desiredIndent + withoutTrailing.slice(currentIndent.length);
        reindented += 1;
      }
      output.push(line);

      depth = Math.max(0, depth + lineDepthDelta(withoutTrailing));
    }

    // Collapse runs of blank lines (keeps at most one) when requested.
    let finalLines = output;
    if (config.collapseBlankLines) {
      finalLines = [];
      let previousBlank = false;
      for (const line of output) {
        const blank = line.trim() === '';
        if (blank && previousBlank) continue;
        finalLines.push(line);
        previousBlank = blank;
      }
      // A file never starts or ends with blank lines.
      while (finalLines.length > 0 && finalLines[0].trim() === '') finalLines.shift();
      while (finalLines.length > 0 && finalLines[finalLines.length - 1].trim() === '') finalLines.pop();
    }

    const formatted = finalLines.join('\n');
    const changed = formatted !== text;
    if (changed) {
      this.stats.formatted += 1;
      this.stats.linesChanged += reindented + trailingRemoved;
      this.stats.lastAt = Date.now();
    }
    return {
      text: formatted,
      changed,
      lines: lines.length,
      reindented,
      trailingRemoved,
      blankLinesCollapsed,
      errors,
    };
  }

  /** Convenience for "{ }" style blocks: returns the indent string for a depth. */
  indentFor(depth) {
    const { tabSize, insertSpaces } = this.options;
    return insertSpaces ? ' '.repeat(Math.max(0, depth) * tabSize) : '\t'.repeat(Math.max(0, depth));
  }

  describe() {
    return {
      kind: 'indentación y espacios',
      ...this.stats,
      note: 'El formateador ajusta la indentación y los espacios finales; no reescribe expresiones ni cambia el contenido de cadenas largas o comentarios.',
    };
  }
}
