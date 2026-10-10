import { call, term, isTerm, isVariable, values, field, format, match, specificity, equal, substitute } from './ncon.mjs';

/** Auditable structural operations. No English words, senses, or tool-routing rules. */
export const STRUCTURAL = Object.freeze(['Quote', 'Native', 'Let', 'If', 'Sequence', 'Each']);
export class Evaluator {
  constructor(store, capabilities = {}, { maximumSteps = 4096, maximumDepth = 128 } = {}) {
    this.store = store; this.capabilities = capabilities; this.maximumSteps = maximumSteps; this.maximumDepth = maximumDepth;
  }
  async evaluate(expression, { context = term('Context'), bindings = new Map() } = {}) {
    const state = { steps: 0, trace: [], stack: new Set() };
    const value = await this.run(expression, context, bindings, state, 0);
    return { value, trace: state.trace, steps: state.steps };
  }
  async run(expression, context, bindings, state, depth) {
    if (++state.steps > this.maximumSteps || depth > this.maximumDepth) throw new Error('Evaluation budget exhausted');
    if (isVariable(expression)) return bindings.get(expression.variable) ?? expression;
    if (!isTerm(expression)) return expression;
    const args = values(expression), recur = (e, b = bindings) => this.run(e, context, b, state, depth + 1);
    if (expression.head === 'Quote') {
      // Bind variables without evaluating their values.
      const bind = e => isVariable(e) ? bindings.get(e.variable) ?? e : isTerm(e) ? { head: e.head, args: e.args.map(a => ({ ...a, value: bind(a.value) })) } : e;
      return bind(args[0]);
    }
    if (expression.head === 'Native') {
      const operation = args[0];
      if (typeof operation !== 'string' || !Object.hasOwn(this.capabilities, operation)) throw new Error('Unavailable capability: ' + operation);
      const resolved = []; for (const arg of args.slice(1)) resolved.push(await recur(arg));
      return this.capabilities[operation](...resolved);
    }
    if (expression.head === 'Let') {
      if (!isVariable(args[0]) || args.length !== 3) throw new Error('Let requires a variable, value, and body');
      const local = new Map(bindings); local.set(args[0].variable, await recur(args[1])); return recur(args[2], local);
    }
    if (expression.head === 'If') { const test = await recur(args[0]); if (typeof test !== 'boolean') return expression; return recur(test ? args[1] : args[2]); }
    if (expression.head === 'Sequence') { let result = null; for (const arg of args) result = await recur(arg); return result; }
    if (expression.head === 'Each') {
      const list = await recur(args[0]); if (!isTerm(list) || list.head !== 'List' || !isVariable(args[1])) return expression;
      const result = []; for (const item of values(list)) { const local = new Map(bindings); local.set(args[1].variable, item); result.push(await recur(args[2], local)); }
      return term('List', ...result);
    }
    // Arguments remain expressions until the chosen realization requests evaluation.
    expression = substitute(expression, bindings);
    const key = format(expression) + '|' + format(context);
    if (state.stack.has(key)) { state.trace.push({ expression, outcome: 'cycle' }); return expression; }
    const candidates = [];
    for (const rule of this.store.parts(expression.head, 'Realization')) {
      const pattern = values(rule.expression)[0], found = match(pattern, expression, new Map());
      if (!found) continue;
      const required = field(rule.expression, 'context', term('Context'));
      const needed = values(required), active = values(context);
      if (!needed.every(n => active.some(a => equal(n, a)))) continue;
      candidates.push({ ...rule, bindings: new Map([...bindings, ...found]), score: specificity(pattern) + needed.length * 100, body: field(rule.expression, 'body') });
    }
    candidates.sort((a, b) => b.score - a.score || a.support.localeCompare(b.support));
    if (!candidates.length) { state.trace.push({ expression, outcome: 'residual' }); return expression; }
    const top = candidates.filter(c => c.score === candidates[0].score);
    if (new Set(top.map(c => format(c.body))).size > 1) {
      state.trace.push({ expression, outcome: 'ambiguous', supports: top.map(c => c.support) });
      return call('Alternatives', [expression, term('List', ...top.map(c => call('Alternative', [c.body], { support: c.support })))]);
    }
    const chosen = top[0]; if (chosen.body === undefined) throw new Error('Realization has no body');
    state.stack.add(key);
    try { const value = await recur(chosen.body, chosen.bindings); state.trace.push({ expression, outcome: equal(expression, value) ? 'residual' : 'realized', support: chosen.support }); return value; }
    finally { state.stack.delete(key); }
  }
}
