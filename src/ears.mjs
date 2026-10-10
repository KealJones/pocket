import { call, term } from './ncon.mjs';

/** UTF-16 spans index the original JS string. No spelling, grammar, or meaning changes. */
export function capture(source) {
  if (typeof source !== 'string') throw new TypeError('Input must be text');
  const tokens = []; let at = 0;
  const add = (kind, end, protectedRegion = false) => {
    tokens.push({ kind, raw: source.slice(at, end), start: at, end, protected: protectedRegion }); at = end;
  };
  while (at < source.length) {
    const remaining = source.slice(at);
    if (remaining.startsWith('```')) {
      const end = source.indexOf('```', at + 3); add('code', end < 0 ? source.length : end + 3, true); continue;
    }
    if (remaining[0] === '`') {
      const end = source.indexOf('`', at + 1); add('code', end < 0 ? source.length : end + 1, true); continue;
    }
    const quoteEnd = { '"': '"', '“': '”', '‘': '’' }[remaining[0]];
    if (quoteEnd) {
      let end = at + 1;
      while (end < source.length) { if (source[end] === '\\') { end += 2; continue; } if (source[end++] === quoteEnd) break; }
      add('quote', Math.min(end, source.length), true); continue;
    }
    const url = /^https?:\/\/[^\s<>"`]+/u.exec(remaining);
    if (url) { add('url', at + url[0].length, true); continue; }
    const space = /^\s+/u.exec(remaining);
    if (space) { add('space', at + space[0].length); continue; }
    const number = /^\d+(?:\.\d+)?/u.exec(remaining);
    if (number) { add('number', at + number[0].length); continue; }
    const word = /^[\p{L}\p{M}\p{N}_]+(?:['’][\p{L}\p{M}\p{N}_]+)*/u.exec(remaining);
    if (word) { add('word', at + word[0].length); continue; }
    const grapheme = new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(remaining)[Symbol.iterator]().next().value.segment;
    add(/\p{P}/u.test(grapheme) ? 'punctuation' : 'symbol', at + grapheme.length);
  }
  return { source, tokens, expression: call('Input', [source, term('List', ...tokens.map(t => call('Occurrence', [t.raw], { kind: t.kind, start: t.start, end: t.end, protected: t.protected })))]) };
}
export const reconstruct = input => input.tokens.map(t => t.raw).join('');
