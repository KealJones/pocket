/** The parsed term IS the concept IR. No second syntax/semantic tree. */
export const term = (head, ...values) => ({ head, args: values.map(value => ({ value })) });
export const variable = name => ({ variable: name });
export const isTerm = x => x !== null && typeof x === 'object' && typeof x.head === 'string' && Array.isArray(x.args);
export const isVariable = x => x !== null && typeof x === 'object' && typeof x.variable === 'string';
export const values = x => isTerm(x) ? x.args.filter(a => a.name === undefined).map(a => a.value) : [];
export const field = (x, name, fallback) => {
  const found = isTerm(x) ? x.args.find(a => a.name === name) : undefined;
  return found ? found.value : fallback;
};
export function call(head, positional = [], named = {}) {
  return { head, args: [...positional.map(value => ({ value })), ...Object.entries(named).map(([name, value]) => ({ name, value }))] };
}
export function format(x) {
  if (isVariable(x)) return '$' + x.variable;
  if (isTerm(x)) return `${x.head}(${x.args.map(a => `${a.name === undefined ? '' : a.name + '='}${format(a.value)}`).join(', ')})`;
  if (x === null || ['string', 'boolean', 'number'].includes(typeof x)) return JSON.stringify(x);
  throw new TypeError('Not a concept expression');
}
export const equal = (a, b) => format(a) === format(b);
export function substitute(x, bindings) {
  if (isVariable(x)) return bindings.get(x.variable) ?? x;
  if (!isTerm(x)) return x;
  return { head: x.head, args: x.args.map(a => ({ ...a, value: substitute(a.value, bindings) })) };
}
export function match(pattern, value, bindings = new Map()) {
  if (isVariable(pattern)) {
    if (pattern.variable === '_') return bindings;
    if (bindings.has(pattern.variable)) return equal(bindings.get(pattern.variable), value) ? bindings : null;
    bindings.set(pattern.variable, value); return bindings;
  }
  if (!isTerm(pattern)) return equal(pattern, value) ? bindings : null;
  if (!isTerm(value) || pattern.head !== value.head) return null;
  const p = values(pattern), v = values(value);
  const tail = p.at(-1);
  const rest = isTerm(tail) && tail.head === 'Rest' && isVariable(values(tail)[0]);
  if (rest ? v.length < p.length - 1 : v.length !== p.length) return null;
  for (let i = 0; i < p.length - Number(rest); i++) if (!match(p[i], v[i], bindings)) return null;
  if (rest && !match(values(tail)[0], term('List', ...v.slice(p.length - 1)), bindings)) return null;
  for (const a of pattern.args.filter(a => a.name !== undefined)) {
    const other = value.args.find(b => b.name === a.name);
    if (!other || !match(a.value, other.value, bindings)) return null;
  }
  if (value.args.filter(a => a.name !== undefined).length !== pattern.args.filter(a => a.name !== undefined).length) return null;
  return bindings;
}
export function specificity(x) {
  return isVariable(x) ? 0 : isTerm(x) ? 1 + x.args.reduce((n, a) => n + specificity(a.value), 0) : 2;
}

export class NconSyntaxError extends SyntaxError {
  constructor(message, source, offset) {
    const before = source.slice(0, offset), line = before.split('\n').length;
    const column = offset - before.lastIndexOf('\n');
    super(`${message} at ${line}:${column}`); this.offset = offset; this.line = line; this.column = column;
  }
}
const NAME = /^(?:[\p{L}_][\p{L}\p{N}_-]*|[\p{Extended_Pictographic}\uFE0F\u200D]+)/u;
export function parseMany(source) {
  let at = 0, depth = 0;
  const fail = message => { throw new NconSyntaxError(message, source, at); };
  function space() {
    for (;;) {
      while (/\s/u.test(source[at] ?? '') && at < source.length) at++;
      if (source.startsWith('//', at) || source[at] === '#') {
        const end = source.indexOf('\n', at); at = end < 0 ? source.length : end;
      } else break;
    }
  }
  function name() {
    const found = NAME.exec(source.slice(at)); if (!found) fail('Expected identifier');
    at += found[0].length; return found[0];
  }
  function expression() {
    space(); if (++depth > 256) fail('Expression nesting exceeds 256');
    try {
      if (source.startsWith('"""', at)) {
        const end = source.indexOf('"""', at + 3); if (end < 0) fail('Unterminated raw string');
        const result = source.slice(at + 3, end); at = end + 3; return result;
      }
      if (source[at] === '"') {
        const start = at++; let escaped = false;
        while (at < source.length) {
          const c = source[at++];
          if (escaped) escaped = false;
          else if (c === '\\') escaped = true;
          else if (c === '"') {
            try { return JSON.parse(source.slice(start, at)); } catch { fail('Invalid JSON string'); }
          }
        }
        fail('Unterminated string');
      }
      if (source[at] === '$') { at++; return variable(name()); }
      const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(at));
      if (number) { at += number[0].length; const result = Number(number[0]); if (!Number.isFinite(result)) fail('Non-finite number'); return result; }
      const head = name(); space();
      if (source[at] !== '(') {
        if (head === 'true') return true; if (head === 'false') return false; if (head === 'null') return null;
        fail('Identifiers require parentheses');
      }
      at++; const args = [], names = new Set(); space();
      while (source[at] !== ')') {
        if (at >= source.length) fail('Unterminated call');
        space(); const saved = at; let key;
        const possible = NAME.exec(source.slice(at));
        if (possible) {
          at += possible[0].length; space();
          if (source[at] === '=') { key = possible[0]; at++; } else at = saved;
        }
        if (key !== undefined && names.has(key)) fail('Duplicate named argument');
        if (key !== undefined) names.add(key);
        const value = expression(); args.push(key === undefined ? { value } : { name: key, value }); space();
        if (source[at] === ')') break;
        if (source[at] !== ',') fail("Expected ',' or ')'"); at++; space();
      }
      at++; return { head, args };
    } finally { depth--; }
  }
  const expressions = []; space();
  while (at < source.length) { expressions.push(expression()); space(); }
  return expressions;
}
export function parse(source) {
  const items = parseMany(source); if (items.length !== 1) throw new SyntaxError('Expected exactly one expression'); return items[0];
}
