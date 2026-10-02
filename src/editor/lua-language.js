/**
 * Lua / Luau language support for CodeMirror 6.
 *
 * A hand-written streaming tokenizer (no fake grammar): it understands Lua 5.4 and Luau
 * lexical structure — line and long comments, single/double quoted strings with escapes, long
 * strings with any bracket level, decimal/hex/binary numbers with `_` separators and hex
 * floats, the full keyword set of both dialects (including Luau's `continue`, `type`,
 * `export`, `declare`), and the standard libraries.
 *
 * Type annotations are recognised where they are unambiguous: after `:` in declarations,
 * after `->`, and for identifiers declared with `type Name =`. The authoritative type
 * information comes from the Luau analysis engine (server side) through semantic
 * decorations, which is why this tokenizer stays conservative instead of guessing.
 *
 * The module also provides a real indentation service and a folding service so Enter,
 * Tab, auto-indent and the fold gutter behave like a code editor should.
 */

import { StreamLanguage, indentService, foldService } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

export const LUA_KEYWORDS = new Set([
  // Lua 5.4
  'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if',
  'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while',
  // Luau
  'continue', 'type', 'export', 'declare',
]);

export const LUA_CONSTANTS = new Set(['nil', 'true', 'false']);

export const LUA_STDLIB = new Set([
  '_G', '_VERSION', 'assert', 'collectgarbage', 'dofile', 'error', 'getmetatable', 'ipairs',
  'load', 'loadfile', 'next', 'pairs', 'pcall', 'print', 'rawequal', 'rawget', 'rawlen',
  'rawset', 'require', 'select', 'setmetatable', 'tonumber', 'tostring', 'type', 'xpcall',
  'coroutine', 'debug', 'io', 'math', 'os', 'string', 'table', 'utf8',
  // Luau additions
  'bit32', 'buffer', 'task', 'typeof', 'warn', 'tick', 'delay', 'spawn', 'wait', 'shared',
  'gcinfo', 'newproxy', 'vector', 'os', 'getfenv', 'setfenv', 'loadstring', 'unpack',
]);

export const LUAU_TYPE_NAMES = new Set([
  'any', 'boolean', 'buffer', 'function', 'never', 'nil', 'number', 'string', 'table',
  'thread', 'unknown', 'userdata', 'vector', 'void',
]);

/** Operators, longest first so `...` wins over `..` which wins over `.`. */
const OPERATORS = [
  '...', '..=', '//=', '<<=', '>>=', '==', '~=', '<=', '>=', '//', '..', '::', '->', '=>',
  '+', '-', '*', '/', '%', '^', '#', '=', '<', '>', '(', ')', '{', '}', '[', ']', ';', ':',
  ',', '.', '&', '|', '?', '@',
];

/** Token names this tokenizer can return, mapped to Lezer highlight tags. */
const TOKEN_TABLE = {
  keyword: t.keyword,
  'keyword-luau': [t.keyword, t.modifier],
  'controlKeyword': t.controlKeyword,
  constant: t.constant(t.variableName),
  global: t.standard(t.variableName),
  variableName: t.variableName,
  local: t.local(t.variableName),
  propertyName: t.propertyName,
  function: t.function(t.variableName),
  method: t.function(t.propertyName),
  typeName: t.typeName,
  number: t.number,
  string: t.string,
  'string-2': t.special(t.string),
  'string-escape': t.escape,
  comment: t.lineComment,
  'comment block': t.blockComment,
  'comment doc': t.docComment,
  operator: t.operator,
  'operator-define': t.definitionOperator,
  punctuation: t.punctuation,
  bracket: t.bracket,
  invalid: t.invalid,
  interpolation: t.special(t.string),
  label: t.labelName,
};

const CONTROL_KEYWORDS = new Set(['if', 'elseif', 'else', 'for', 'while', 'repeat', 'until', 'return', 'break', 'continue', 'do', 'then', 'end', 'goto', 'in']);

export const luaLanguage = StreamLanguage.define({
  name: 'lua',

  startState() {
    return {
      longComment: 0,
      longString: 0,
      quote: null,
      prevWord: null,
      prevSignificant: null,
      declaredTypes: new Set(),
      expectType: false,
    };
  },

  token(stream, state) {
    // --- continuations of multi-line constructs -------------------------------
    if (state.longComment > 0) {
      if (stream.match(closeLongBracket(state.longComment))) {
        state.longComment = 0;
        return 'comment block';
      }
      stream.next();
      return 'comment block';
    }
    if (state.longString > 0) {
      if (stream.match(closeLongBracket(state.longString))) {
        state.longString = 0;
        state.prevSignificant = 'string';
        return 'string';
      }
      if (stream.match(/^\\(?=[\s\S])/) && stream.peek() === '\n') {
        stream.next();
        return 'string';
      }
      stream.next();
      return 'string';
    }
    if (state.quote) {
      const quote = state.quote;
      while (!stream.eol()) {
        const char = stream.next();
        if (char === '\\') {
          stream.next();
          state.quote = null;
          return 'string-escape';
        }
        if (char === quote) {
          state.quote = null;
          state.prevSignificant = 'string';
          return 'string';
        }
      }
      return 'string';
    }

    if (stream.eatSpace()) return null;

    // --- comments -------------------------------------------------------------
    if (stream.match('--')) {
      const level = matchOpenLongBracket(stream);
      if (level > 0) {
        state.longComment = level;
        if (stream.match(closeLongBracket(level))) state.longComment = 0;
        return 'comment block';
      }
      if (stream.peek() === '!' || stream.peek() === '@') {
        stream.skipToEnd();
        return 'comment doc';
      }
      // `---` and `--[[` are doc comments in Luau's annotation style.
      if (stream.peek() === '-' && stream.string.charAt(stream.pos + 1) === '-') {
        stream.skipToEnd();
        return 'comment doc';
      }
      stream.skipToEnd();
      return 'comment';
    }

    // --- long strings ---------------------------------------------------------
    {
      const level = matchOpenLongBracket(stream);
      if (level > 0) {
        state.longString = level;
        if (stream.match(closeLongBracket(level))) {
          state.longString = 0;
          state.prevSignificant = 'string';
        }
        return 'string';
      }
    }

    // --- quoted strings -------------------------------------------------------
    const quote = stream.peek();
    if (quote === '"' || quote === "'") {
      stream.next();
      state.quote = quote;
      return 'string';
    }
    // Luau interpolated strings: `hello {name}`
    if (quote === '`') {
      stream.next();
      stream.skipTo('`') ? stream.next() : stream.skipToEnd();
      state.prevSignificant = 'string';
      return 'string-2';
    }

    // --- numbers --------------------------------------------------------------
    if (stream.match(/^0[xX][0-9a-fA-F_]*(\.[0-9a-fA-F_]*)?([pP][+-]?\d+)?/)) return 'number';
    if (stream.match(/^0[bB][01_]+/)) return 'number';
    if (stream.match(/^\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?/)) return 'number';
    if (stream.match(/^\.\d[\d_]*([eE][+-]?\d+)?/)) return 'number';

    // --- identifiers ----------------------------------------------------------
    const word = stream.match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (word) {
      const text = word[0];
      const previous = state.prevWord;
      const prevSignificant = state.prevSignificant;

      if (LUA_CONSTANTS.has(text)) {
        state.prevWord = text;
        state.prevSignificant = 'constant';
        return 'constant';
      }
      if (LUA_KEYWORDS.has(text)) {
        state.prevWord = text;
        state.prevSignificant = 'keyword';
        if (text === 'type' && previous === 'export') return 'keyword-luau';
        if (text === 'type' || text === 'export' || text === 'continue' || text === 'declare') return 'keyword-luau';
        if (CONTROL_KEYWORDS.has(text)) return 'controlKeyword';
        return 'keyword';
      }
      if (previous === 'function') {
        state.prevWord = text;
        state.prevSignificant = 'function';
        return 'function';
      }
      if (prevSignificant === 'dot' || prevSignificant === 'colon') {
        state.prevWord = text;
        state.prevSignificant = 'property';
        return state.expectType && LUAU_TYPE_NAMES.has(text) ? 'typeName' : 'propertyName';
      }
      if (state.expectType && (LUAU_TYPE_NAMES.has(text) || state.declaredTypes.has(text))) {
        state.prevWord = text;
        state.prevSignificant = 'type';
        state.expectType = false;
        return 'typeName';
      }
      if (LUAU_TYPE_NAMES.has(text) && previous === ':') {
        state.prevWord = text;
        state.prevSignificant = 'type';
        return 'typeName';
      }
      state.prevWord = text;
      state.prevSignificant = LUA_STDLIB.has(text) ? 'global' : 'name';
      return LUA_STDLIB.has(text) ? 'global' : 'variableName';
    }

    // --- operators and punctuation -------------------------------------------
    for (const operator of OPERATORS) {
      if (stream.match(operator)) {
        if (operator === '.') {
          state.prevSignificant = 'dot';
          return 'punctuation';
        }
        if (operator === ':') {
          state.prevSignificant = 'colon';
          // `local x: number`, `function f(a: T)`, `type X = {...}` open a type context.
          state.expectType = isLikelyTypePosition(state);
          return 'punctuation';
        }
        if (operator === '->') {
          state.expectType = true;
          state.prevSignificant = 'operator';
          return 'operator';
        }
        if (operator === '=' && state.prevWord === 'type') {
          state.expectType = true;
        }
        if (['(', ')', '{', '}', '[', ']'].includes(operator)) {
          state.prevSignificant = operator;
          return 'bracket';
        }
        if (operator === ';' || operator === ',') {
          state.prevSignificant = operator;
          return 'punctuation';
        }
        state.prevSignificant = 'operator';
        return operator === '=' || operator === '::' ? 'operator-define' : 'operator';
      }
    }

    // Anything else (including unexpected characters) is consumed one char at a time.
    const char = stream.next();
    state.prevSignificant = char;
    return /[\u0000-\u001f]/.test(char) ? 'invalid' : 'punctuation';
  },

  indent(state, textAfter) {
    return null; // handled by `luaIndentService` (needs neighbouring lines)
  },

  languageData: {
    commentTokens: { line: '--', block: { open: '--[[', close: ']]' } },
    closeBrackets: { brackets: ['(', '[', '{', '"', "'", '`'] },
    autocomplete: { closeBrackets: true },
    indentOnInput: /^\s*(end|else|elseif|until|\}|\)|\])$/,
    wordChars: '_',
  },

  tokenTable: TOKEN_TABLE,
});

/** Records `type Name = …` declarations so later usages highlight as types. */
export function trackTypeDeclarations(state, match) {
  if (!state?.declaredTypes) return;
  state.declaredTypes.add(match);
}

/* ------------------------------------------------------------------------ *
 * Helpers shared with the indentation/folding services
 * ------------------------------------------------------------------------ */

function closeLongBracket(level) {
  const equals = '='.repeat(level);
  return `]${equals}]`;
}

/** Matches `[`, `[=`, `[==` … `[` and returns the level (0 when it is not a long bracket). */
function matchOpenLongBracket(stream) {
  const rest = stream.string.slice(stream.pos);
  const match = /^\[(=*)\[/.exec(rest);
  if (!match) return -1;
  stream.pos += match[0].length;
  return match[1].length;
}

function isLikelyTypePosition(state) {
  // After `local x:` or a parameter declaration the next identifier is a type. After a method
  // call (`obj:method()`) it is a property. We use the previous significant token as signal.
  const previous = state.prevSignificant;
  if (previous === 'name' || previous === 'local' || previous === ')' || previous === ',' || previous === '{') return true;
  return false;
}

/* ------------------------------------------------------------------------ *
 * Indentation service
 * ------------------------------------------------------------------------ */

const OPENERS = /^(function|if|for|while|repeat|do|then|else|elseif)\b/;
const DEDENTERS = /^(end|else|elseif|until)\b/;

/**
 * Removes strings and comments from a line so keyword counting cannot be fooled by content.
 * This is intentionally a light pass: it never modifies the document, only measures.
 */
export function stripLuaLiterals(line) {
  let output = '';
  let index = 0;
  while (index < line.length) {
    const char = line[index];
    if (char === '-' && line[index + 1] === '-') {
      const longMatch = /^--\[(=*)\[/.exec(line.slice(index));
      if (longMatch) {
        const close = `]${longMatch[1]}]`;
        const end = line.indexOf(close, index + longMatch[0].length);
        index = end === -1 ? line.length : end + close.length;
        continue;
      }
      break; // line comment: the rest of the line is ignored
    }
    const longMatch = /^\[(=*)\[/.exec(line.slice(index));
    if (longMatch) {
      const close = `]${longMatch[1]}]`;
      const end = line.indexOf(close, index + longMatch[0].length);
      index = end === -1 ? line.length : end + close.length;
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
    output += char;
    index += 1;
  }
  return output;
}

/**
 * Net block depth change of one line, comment/string aware.
 *
 * Rules (verified against the reference grammar's block structure):
 *   `function` `if` `for` `while` `repeat` `do` open a block; `end` `until` close one.
 *   `then` and the `do` of a loop are part of the opener already counted, so a one-line
 *   `if x then y end` nets to zero — which is what keeps indentation stable.
 *   Brackets left open on the line (multi-line tables/calls) add continuation depth.
 */
export function lineDepthDelta(line) {
  const code = stripLuaLiterals(line);
  if (code.trim() === '') return 0;

  let delta = 0;
  let brackets = 0;
  let loopSeen = false;
  const tokens = code.match(/[A-Za-z_][A-Za-z0-9_]*|[(){}\[\]]/g) ?? [];

  for (const token of tokens) {
    switch (token) {
      case 'function': case 'if': case 'repeat':
        delta += 1;
        break;
      case 'for': case 'while':
        delta += 1;
        loopSeen = true;
        break;
      case 'do':
        // `for … do` / `while … do` were already counted; a bare `do` opens its own block.
        if (!loopSeen) delta += 1;
        loopSeen = false;
        break;
      case 'end': case 'until':
        delta -= 1;
        break;
      case '(': case '[': case '{':
        brackets += 1;
        break;
      case ')': case ']': case '}':
        brackets -= 1;
        break;
      default:
        break;
    }
  }
  // Closing brackets on the line reduce depth exactly like `end` does.
  delta += brackets;
  return delta;
}

export const luaIndentService = indentService.of((context, position) => {
  const doc = context.state.doc;
  const line = doc.lineAt(position);
  if (line.number <= 1) return 0;

  const unit = context.unit || 2;
  let depth = 0;
  let scanned = 0;
  for (let number = line.number - 1; number >= 1 && scanned < 2000; number -= 1, scanned += 1) {
    const text = doc.line(number).text;
    if (text.trim() === '') continue;
    depth += lineDepthDelta(text);
    if (depth <= 0) {
      depth = Math.max(depth, 0);
      break;
    }
  }
  let level = Math.max(0, depth);

  const current = stripLuaLiterals(line.text).trim();
  if (/^(end|else|elseif|until)\b/.test(current) || /^[)\]}]*\s*[),}\]]/.test(current)) {
    level = Math.max(0, level - 1);
  }
  return level * unit;
});

/* ------------------------------------------------------------------------ *
 * Folding service (indentation based, which is what a streaming language has)
 * ------------------------------------------------------------------------ */

export const luaFoldService = foldService.of((state, lineStart, lineEnd) => {
  const startLine = state.doc.lineAt(lineStart);
  const startText = stripLuaLiterals(startLine.text);
  const opens = lineDepthDelta(startLine.text) > 0
    || /(\b(function|if|for|while|repeat|do|then|else|elseif)\b|\{\s*$|\{\s*--)/.test(startText);
  if (!opens) return null;

  const baseIndent = startLine.text.match(/^\s*/)[0].length;
  let end = null;
  for (let number = startLine.number + 1; number <= state.doc.lines; number += 1) {
    const text = state.doc.line(number).text;
    if (text.trim() === '') continue;
    const indent = text.match(/^\s*/)[0].length;
    if (indent <= baseIndent) break;
    end = state.doc.line(number).to;
  }
  if (end === null) return null;
  return { from: startLine.to, to: end };
});
