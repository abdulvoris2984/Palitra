'use strict';

// A small, safe expression evaluator (no eval): + - * / ^ % mod, parentheses,
// implicit multiplication (2pi, 3(4+5)), postfix ! and %, functions and
// constants. "200 + 15%" means 200 * 1.15, like on a pocket calculator.

const FUNCS = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  round: (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d,
  floor: Math.floor,
  ceil: Math.ceil,
  trunc: Math.trunc,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  ln: Math.log,
  log: (x, b) => (b === undefined ? Math.log10(x) : Math.log(x) / Math.log(b)),
  log2: Math.log2,
  log10: Math.log10,
  exp: Math.exp,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  hypot: Math.hypot,
  sign: Math.sign,
  fact: factorial,
  avg: (...xs) => xs.reduce((a, b) => a + b, 0) / xs.length,
  sum: (...xs) => xs.reduce((a, b) => a + b, 0),
};

const CONSTS = {
  pi: Math.PI,
  'π': Math.PI,
  e: Math.E,
  tau: 2 * Math.PI,
  phi: (1 + Math.sqrt(5)) / 2,
  deg: Math.PI / 180,
};

function factorial(n) {
  if (n < 0 || !Number.isInteger(n)) throw new Error('factorial of non-integer');
  if (n > 170) return Infinity;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (/[0-9.]/.test(ch)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(src.slice(i));
      if (!m) throw new Error('bad number');
      tokens.push({ t: 'num', v: parseFloat(m[0]) });
      i += m[0].length;
    } else if (/[\p{L}_π]/u.test(ch)) {
      const m = /^[\p{L}_π][\p{L}\d_]*/u.exec(src.slice(i));
      tokens.push({ t: 'id', v: m[0].toLowerCase() });
      i += m[0].length;
    } else if ('+-*/^%!(),'.includes(ch)) {
      tokens.push({ t: 'op', v: ch });
      i++;
    } else if (ch === '×' || ch === '·') {
      tokens.push({ t: 'op', v: '*' });
      i++;
    } else if (ch === '÷') {
      tokens.push({ t: 'op', v: '/' });
      i++;
    } else if (ch === '−') {
      tokens.push({ t: 'op', v: '-' });
      i++;
    } else {
      throw new Error(`unexpected "${ch}"`);
    }
  }
  return tokens;
}

function parse(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (v) => peek() && peek().t === 'op' && peek().v === v;
  const expect = (v) => {
    if (!isOp(v)) throw new Error(`expected "${v}"`);
    pos++;
  };

  // Each parse function returns { v: number, pct: boolean }; pct marks a bare
  // "x%" operand so that addition can treat it relative to the left side.
  function expr() {
    let left = term();
    while (isOp('+') || isOp('-')) {
      const op = tokens[pos++].v;
      const right = term();
      const r = right.pct ? left.v * right.v : right.v;
      left = { v: op === '+' ? left.v + r : left.v - r, pct: false };
    }
    return left;
  }

  function startsFactor() {
    const tk = peek();
    if (!tk) return false;
    return tk.t === 'num' || (tk.t === 'id' && tk.v !== 'mod') || (tk.t === 'op' && tk.v === '(');
  }

  function term() {
    let left = unary();
    for (;;) {
      if (isOp('*') || isOp('/') || (peek() && peek().t === 'id' && peek().v === 'mod')) {
        const op = tokens[pos++].v;
        const right = unary();
        if (op === '*') left = { v: left.v * right.v, pct: false };
        else if (op === '/') left = { v: left.v / right.v, pct: false };
        else left = { v: ((left.v % right.v) + right.v) % right.v, pct: false };
      } else if (startsFactor()) {
        const right = unary(); // implicit multiplication: 2pi, 3(1+2)
        left = { v: left.v * right.v, pct: false };
      } else {
        return left;
      }
    }
  }

  function unary() {
    if (isOp('-')) {
      pos++;
      const x = unary();
      return { v: -x.v, pct: x.pct };
    }
    if (isOp('+')) {
      pos++;
      return unary();
    }
    return power();
  }

  function power() {
    const base = postfix();
    if (isOp('^')) {
      pos++;
      const exp = unary(); // right-associative
      return { v: Math.pow(base.v, exp.v), pct: false };
    }
    return base;
  }

  function postfix() {
    let x = primary();
    for (;;) {
      if (isOp('!')) {
        pos++;
        x = { v: factorial(x.v), pct: false };
      } else if (isOp('%')) {
        pos++;
        x = { v: x.v / 100, pct: true };
      } else {
        return x;
      }
    }
  }

  function primary() {
    const tk = peek();
    if (!tk) throw new Error('unexpected end');
    if (tk.t === 'num') {
      pos++;
      return { v: tk.v, pct: false };
    }
    if (tk.t === 'op' && tk.v === '(') {
      pos++;
      const x = expr();
      expect(')');
      return { v: x.v, pct: false };
    }
    if (tk.t === 'id') {
      pos++;
      if (FUNCS[tk.v] && isOp('(')) {
        pos++;
        const args = [];
        if (!isOp(')')) {
          args.push(expr().v);
          while (isOp(',')) {
            pos++;
            args.push(expr().v);
          }
        }
        expect(')');
        return { v: FUNCS[tk.v](...args), pct: false };
      }
      if (Object.prototype.hasOwnProperty.call(CONSTS, tk.v)) return { v: CONSTS[tk.v], pct: false };
      throw new Error(`unknown name "${tk.v}"`);
    }
    throw new Error(`unexpected "${tk.v}"`);
  }

  const result = expr();
  if (pos !== tokens.length) throw new Error(`unexpected "${tokens[pos].v}"`);
  return result.v;
}

function preprocess(src) {
  let s = String(src).trim().replace(/^=\s*/, '');
  // "1 000 000" -> "1000000"
  s = s.replace(/(\d) (?=\d{3}(?!\d))/g, '$1');
  // European decimal comma, but only when there are no function calls,
  // where a comma separates arguments.
  if (!/[a-zа-я]\s*\(/i.test(s)) s = s.replace(/(\d),(\d)/g, '$1.$2');
  return s;
}

/** Evaluates an expression; throws on syntax errors. */
function evaluate(src) {
  return parse(tokenize(preprocess(src)));
}

/**
 * Returns the numeric result if `src` looks like a calculation (it must
 * contain an operator or a function call, not just a number), else null.
 */
function tryCalculate(src) {
  const s = preprocess(src);
  if (!s || s.length > 200) return null;
  if (!/[\d)π]|\bpi\b|\be\b/i.test(s)) return null;
  const hasOperator = /[+\-*/^%!×÷·−]|\bmod\b/.test(s) || /[\p{L}]\s*\(/u.test(s) || /\d\s*(pi|π|e)\b/i.test(s);
  if (!hasOperator) return null;
  if (/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
  try {
    const v = parse(tokenize(s));
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** Formats a number for display with thin-space grouping: 1 234 567.5 */
function formatNumber(v, { group = true, digits = 14 } = {}) {
  if (!Number.isFinite(v)) return String(v);
  if (Object.is(v, -0)) v = 0;
  const abs = Math.abs(v);
  if (abs !== 0 && (abs >= 1e21 || abs < 1e-9)) return v.toExponential(8).replace(/\.?0+e/, 'e');
  let s = String(parseFloat(v.toPrecision(digits)));
  if (s.includes('e')) return s;
  if (!group) return s;
  const [int, frac] = s.split('.');
  const sign = int.startsWith('-') ? '-' : '';
  const intDigits = sign ? int.slice(1) : int;
  const grouped = intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return sign + grouped + (frac ? '.' + frac : '');
}

module.exports = { evaluate, tryCalculate, formatNumber };
