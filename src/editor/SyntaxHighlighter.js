/**
 * SyntaxHighlighter — propietario único del coloreado de sintaxis de Lua y Luau.
 *
 * El léxico real (palabras clave, cadenas largas, números hex/binarios, anotaciones de tipo),
 * el indentado y el plegado viven en `lua-language.js`. Este módulo los compone con el estilo de
 * resaltado y decide si el resaltado está activo según los ajustes, sin recrear el editor: la
 * extensión se instala en un `Compartment` y se reemplaza en el sitio.
 *
 * Ningún color se escribe aquí ni en el resto del editor: cada regla apunta a una variable CSS
 * `--syn-*` que publica el ThemeManager. Cambiar de tema reescribe el color del código, y
 * `missingVariables()` permite comprobar que un tema no deja tokens sin definir.
 */

import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { luaFoldService, luaIndentService, luaLanguage } from './lua-language.js';

/** Reglas del resaltado: etiqueta semántica de Lezer → variable del tema. */
export const SYNTAX_RULES = Object.freeze([
  { tag: t.keyword, color: 'var(--syn-keyword)' },
  { tag: t.controlKeyword, color: 'var(--syn-keyword)' },
  { tag: t.modifier, color: 'var(--syn-keyword)' },
  { tag: t.string, color: 'var(--syn-string)' },
  { tag: t.special(t.string), color: 'var(--syn-interpolation)' },
  { tag: t.escape, color: 'var(--syn-string-escape)' },
  { tag: t.number, color: 'var(--syn-number)' },
  { tag: t.bool, color: 'var(--syn-constant)' },
  { tag: t.null, color: 'var(--syn-constant)' },
  { tag: t.constant(t.variableName), color: 'var(--syn-constant)' },
  { tag: t.standard(t.variableName), color: 'var(--syn-global)' },
  { tag: t.variableName, color: 'var(--syn-variable)' },
  { tag: t.local(t.variableName), color: 'var(--syn-variable)' },
  { tag: t.function(t.variableName), color: 'var(--syn-function)' },
  { tag: t.function(t.propertyName), color: 'var(--syn-method)' },
  { tag: t.propertyName, color: 'var(--syn-property)' },
  { tag: t.typeName, color: 'var(--syn-type)' },
  { tag: t.className, color: 'var(--syn-type)' },
  { tag: t.operator, color: 'var(--syn-operator)' },
  { tag: t.definitionOperator, color: 'var(--syn-operator)' },
  { tag: t.punctuation, color: 'var(--syn-punctuation)' },
  { tag: t.bracket, color: 'var(--syn-punctuation)' },
  { tag: t.lineComment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: t.blockComment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: t.docComment, color: 'var(--syn-doc-comment)', fontStyle: 'italic' },
  { tag: t.invalid, color: 'var(--syn-invalid)', textDecoration: 'underline wavy' },
  { tag: t.labelName, color: 'var(--syn-parameter)' },
]);

/** Estilo de resaltado construido con las reglas anteriores. */
export const luaHighlightStyle = HighlightStyle.define(SYNTAX_RULES);

const THEME_VARIABLE = /^var\((--[a-z0-9-]+)\)$/i;

export class SyntaxHighlighter {
  #settings = null;
  #logger = null;
  #rules = null;

  constructor({ settings = null, logger = null, style = null } = {}) {
    this.#settings = settings;
    this.#logger = logger;
    // El estilo es inyectable para poder probar otra paleta sin tocar el editor; por defecto es el
    // de Lua/Luau definido arriba.
    this.#rules = style ?? luaHighlightStyle;
    this.style = this.#rules;
  }

  /** Extensión del lenguaje: tokenizador, indentado y plegado reales. */
  languageExtensions() {
    return [luaLanguage, luaIndentService, luaFoldService];
  }

  /** `true` salvo que el ajuste `editor.syntaxHighlighting` esté desactivado. */
  get enabled() {
    return this.#settings ? this.#settings.get('editor.syntaxHighlighting') !== false : true;
  }

  /** Extensión de resaltado; vacía cuando está desactivado (el editor sigue siendo funcional). */
  highlightExtensions() {
    return this.enabled ? syntaxHighlighting(this.style) : [];
  }

  /** Todo lo que el editor necesita del resaltador, en una sola llamada. */
  extensions() {
    return [...this.languageExtensions(), ...this.highlightExtensions()];
  }

  /** Variables del tema que consume el resaltado, sin repetir y en orden alfabético. */
  variables() {
    const found = new Set();
    for (const spec of this.style?.specs ?? []) {
      const match = THEME_VARIABLE.exec(String(spec.color ?? ''));
      if (match) found.add(match[1]);
    }
    return [...found].sort();
  }

  /** Número de reglas activas (cada una puede cubrir varias etiquetas de Lezer). */
  get ruleCount() {
    return this.style?.specs?.length ?? 0;
  }

  /**
   * Variables que el tema indicado no define. Un tema completo devuelve `[]`; si falta alguna, el
   * código se vería con el color heredado y hay que saberlo (se informa, no se oculta).
   */
  missingVariables(theme) {
    const tokens = theme?.tokens ?? null;
    if (!tokens) return [];
    return this.variables().filter((variable) => tokens[variable.replace(/^--/, '')] === undefined);
  }

  describe(theme = null) {
    const missing = this.missingVariables(theme);
    if (missing.length > 0) {
      this.#logger?.warn(`El tema activo no define ${missing.length} variables de sintaxis`, {
        source: 'SyntaxHighlighter',
        data: { missing },
      });
    }
    return {
      enabled: this.enabled,
      language: 'lua/luau',
      rules: this.ruleCount,
      variables: this.variables(),
      missingVariables: missing,
    };
  }
}
