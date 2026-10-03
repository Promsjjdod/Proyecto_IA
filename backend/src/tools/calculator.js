import { z } from 'zod';
import { defineTool, toolResult } from './base.js';
import { badRequest } from '../core/errors.js';

/**
 * Safe arithmetic evaluator (shunting-yard). No eval(), no Function().
 * Supports + - * / % ^, parentheses, unary minus, constants and functions.
 */
const FUNCS = {
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log10, ln: Math.log, exp: Math.exp,
  min: (...a) => Math.min(...a), max: (...a) => Math.max(...a), pow: Math.pow,
};
const CONSTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };
const OPS = {
  '+': { p: 1, f: (a, b) => a + b },
  '-': { p: 1, f: (a, b) => a - b },
  '*': { p: 2, f: (a, b) => a * b },
  '/': { p: 2, f: (a, b) => a / b },
  '%': { p: 2, f: (a, b) => a % b },
  '^': { p: 3, r: true, f: (a, b) => a ** b },
};

function tokenizeExpr(expr) {
  const tokens = [];
  let i = 0;
  const s = expr.replace(/\s+/g, '');
  while (i < s.length) {
    const ch = s[i];
    if (/[0-9.]/.test(ch)) {
      let num = '';
      while (i < s.length && /[0-9.eE]/.test(s[i])) {
        if ((s[i] === 'e' || s[i] === 'E') && !/[0-9]/.test(s[i + 1] || '') && s[i + 1] !== '+' && s[i + 1] !== '-') break;
        num += s[i]; i += 1;
      }
      if (!Number.isFinite(Number(num))) throw badRequest(`Invalid number: ${num}`);
      tokens.push({ t: 'num', v: Number(num) });
    } else if (/[a-zA-Z_]/.test(ch)) {
      let name = '';
      while (i < s.length && /[a-zA-Z_]/.test(s[i])) { name += s[i]; i += 1; }
      tokens.push({ t: 'name', v: name.toLowerCase() });
    } else if (OPS[ch]) { tokens.push({ t: 'op', v: ch }); i += 1; }
    else if (ch === '(') { tokens.push({ t: 'lp' }); i += 1; }
    else if (ch === ')') { tokens.push({ t: 'rp' }); i += 1; }
    else if (ch === ',') { tokens.push({ t: 'comma' }); i += 1; }
    else throw badRequest(`Unexpected character "${ch}" in expression.`);
  }
  return tokens;
}

export function evaluateExpression(input) {
  const tokens = tokenizeExpr(input);
  const out = [];
  const stack = [];
  let prev = null;
  const pushOp = (op) => {
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top.t === 'op' && (top.v.p > op.p || (top.v.p === op.p && !op.r))) { out.push(stack.pop()); } else break;
    }
    stack.push({ t: 'op', v: op });
  };
  for (const tok of tokens) {
    if (tok.t === 'num') { out.push(tok); prev = tok; }
    else if (tok.t === 'name') {
      if (FUNCS[tok.v]) stack.push({ t: 'func', v: tok.v });
      else if (CONSTS[tok.v] !== undefined) { out.push({ t: 'num', v: CONSTS[tok.v] }); prev = 'num'; }
      else throw badRequest(`Unknown identifier "${tok.v}".`);
    } else if (tok.t === 'op') {
      const unary = !prev || prev === 'num' ? false : true;
      const isUnaryContext = !prev || prev.t === 'op' || prev.t === 'lp' || prev.t === 'comma';
      if (isUnaryContext && (tok.v === '-' || tok.v === '+')) {
        out.push({ t: 'num', v: 0 });
        pushOp(OPS[tok.v === '-' ? '-' : '+']);
        // unary implemented as 0 - x / 0 + x
        prev = 'op';
        continue;
      }
      if (unary && false) { /* unreachable, kept for clarity */ }
      pushOp(OPS[tok.v]);
      prev = tok;
    } else if (tok.t === 'lp') { stack.push(tok); prev = tok; }
    else if (tok.t === 'rp') {
      while (stack.length && stack[stack.length - 1].t !== 'lp') out.push(stack.pop());
      if (!stack.length) throw badRequest('Unbalanced parentheses.');
      stack.pop();
      if (stack.length && stack[stack.length - 1].t === 'func') out.push(stack.pop());
      prev = tok;
    } else if (tok.t === 'comma') {
      while (stack.length && stack[stack.length - 1].t !== 'lp') out.push(stack.pop());
      prev = tok;
    }
  }
  while (stack.length) {
    const top = stack.pop();
    if (top.t === 'lp') throw badRequest('Unbalanced parentheses.');
    out.push(top);
  }
  const evalStack = [];
  for (const tok of out) {
    if (tok.t === 'num') evalStack.push(tok.v);
    else if (tok.t === 'op') {
      const b = evalStack.pop(); const a = evalStack.pop();
      if (a === undefined || b === undefined) throw badRequest('Malformed expression.');
      if ((tok.v === '/' || tok.v === '%') && b === 0) throw badRequest('Division by zero.');
      evalStack.push(tok.v.f(a, b));
    } else if (tok.t === 'func') {
      const fn = FUNCS[tok.v];
      const args = [];
      // functions take 1 or 2 args from the stack (min/max/pow take 2)
      const arity = ['min', 'max', 'pow'].includes(tok.v) ? 2 : 1;
      for (let k = 0; k < arity; k += 1) args.unshift(evalStack.pop());
      if (args.some((a) => a === undefined)) throw badRequest(`Missing argument for ${tok.v}().`);
      evalStack.push(fn(...args));
    }
  }
  if (evalStack.length !== 1 || !Number.isFinite(evalStack[0])) throw badRequest('Could not evaluate expression.');
  return evalStack[0];
}

export const calculateTool = defineTool({
  name: 'calculate',
  description: 'Evaluate a math expression safely (no code execution). Supports + - * / % ^, (), sqrt, abs, min, max, round, sin, cos, log, pi, e.',
  permissions: [],
  schema: z.object({ expression: z.string().min(1).max(300) }),
  async execute({ expression }, ctx = {}) {
    const raw = evaluateExpression(expression);
    const precision = Number(ctx.pluginConfig?.precision ?? 6);
    const value = Number.isInteger(raw) ? raw : Number(raw.toFixed(precision));
    return toolResult(`${expression} = ${value}`, { expression, value });
  },
});

export const calculatorTools = [calculateTool];
