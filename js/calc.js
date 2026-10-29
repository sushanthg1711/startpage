// Tiny arithmetic evaluator for the palette (extension pages forbid eval).
// Returns a number, or null when the text isn't a calculation.

const FN = {
  sqrt: Math.sqrt, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  log: Math.log10, ln: Math.log, exp: Math.exp, round: Math.round, floor: Math.floor, ceil: Math.ceil,
};
const CONST = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };

export function calc(src) {
  const toks = src.toLowerCase().match(/\d*\.?\d+(?:e[+-]?\d+)?|[a-z]+|\*\*|[-+*/%^()]|\S/g);
  if (!toks || !toks.some((t) => /[-+*/%^(]/.test(t))) return null;   // needs an operator
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];

  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') v = next() === '+' ? v + term() : v - term();
    return v;
  }
  function term() {
    let v = power();
    while (['*', '/', '%'].includes(peek())) {
      const op = next(), r = power();
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  }
  function power() {
    const b = unary();
    if (peek() === '^' || peek() === '**') { next(); return b ** power(); }
    return b;
  }
  function unary() {
    if (peek() === '-') { next(); return -unary(); }
    if (peek() === '+') { next(); return unary(); }
    return primary();
  }
  function primary() {
    const t = next();
    if (t === undefined) throw 0;
    if (t === '(') { const v = expr(); if (next() !== ')') throw 0; return v; }
    if (/^[\d.]/.test(t)) return parseFloat(t);
    if (t in CONST) return CONST[t];
    if (t in FN && peek() === '(') { next(); const v = expr(); if (next() !== ')') throw 0; return FN[t](v); }
    throw 0;
  }

  try {
    const v = expr();
    if (i !== toks.length || !Number.isFinite(v)) return null;
    return +v.toPrecision(12);
  } catch { return null; }
}
