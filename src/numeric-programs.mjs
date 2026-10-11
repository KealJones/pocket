import { term, values, field, format, match, substitute, isTerm, isVariable, parse } from './ncon.mjs';
import { parameterNames } from './code-learning.mjs';

// Mechanical numeric operations, never words or sentence-specific meanings.
const OPERATIONS = new Set(['number.add', 'number.subtract', 'number.multiply', 'number.divide']);
function uses(value, name) {
  if (isVariable(value)) return value.variable === name;
  if (!isTerm(value)) return false;
  const args = values(value);
  if (value.head === 'Let' && args.length === 3) return uses(args[1], name) || (args[0]?.variable !== name && uses(args[2], name));
  return value.args.some(a => uses(a.value, name));
}
export function numericPrimitives(store) {
  return [...store.definitions()].filter(([name]) => store.isA(name, 'InductionPrimitive')).map(([name]) => {
    const capability = store.parts(name, 'Capability')[0], arity = store.parts(name, 'Arity')[0], commutative = store.parts(name, 'Commutative')[0];
    return { name, operation: values(capability?.expression)[0], arity: values(arity?.expression)[0], commutative: values(commutative?.expression)[0] === true,
      supports: [...new Set([capability?.support, arity?.support, commutative?.support, ...(store.typeProof(name, 'InductionPrimitive') ?? [])].filter(Boolean))] };
  }).filter(p => p.arity === 2 && OPERATIONS.has(p.operation));
}

function evidenceFor(store, id, { profile, excluded = new Set() }) {
  const records = [], queue = [id], seen = new Set();
  while (queue.length) {
    const next = queue.pop(); if (seen.has(next)) continue;
    if (seen.size >= 512 || excluded.has(next)) throw new Error('Unavailable or circular procedure evidence');
    seen.add(next); const record = store.record(next);
    if (!record?.active) throw new Error('Withdrawn procedure evidence');
    if (['CodeExample', 'WorkedExample', 'LearningValidation'].includes(record.expression.head) && field(record.expression, 'profile', '') !== profile) throw new Error('Procedure evidence belongs to another profile');
    records.push(record);
    queue.push(...store.db.prepare('SELECT support FROM dependencies WHERE record=?').all(next).map(r => r.support));
  }
  return records;
}

function checkedRule(store, rule, options) {
  const pattern = values(rule.expression)[0], records = evidenceFor(store, rule.support, options), checks = [];
  for (const record of records) {
    if (record.expression.head === 'CodeExample' && format(values(record.expression)[2]) === format(pattern) && format(values(record.expression)[3]) === format(field(rule.expression, 'body'))) {
      for (const check of values(field(record.expression, 'checks'))) { const [input, output] = values(check); checks.push({ input, output }); }
    }
    if (record.expression.head === 'LearningValidation') {
      // Model checks were executed before installation; still verify their numeric outputs below.
      const raw = JSON.parse(field(record.expression, 'checks', '[]'));
      checks.push(...raw.map(c => ({ input: parse(c.input), output: parse(c.output) })));
    }
  }
  const numeric = checks.filter(c => typeof c.output === 'number' && Number.isFinite(c.output) && match(pattern, c.input, new Map()) && [...match(pattern, c.input, new Map()).values()].every(v => typeof v === 'number' && Number.isFinite(v)));
  const validated = store.parts(pattern.head, 'ValidatedProgram').find(p => p.support === rule.support && format(values(p.expression)[0]) === format(pattern) && format(field(p.expression, 'body')) === format(field(rule.expression, 'body')) && field(p.expression, 'examples', 0) >= 2);
  const outcomes = records.filter(r => r.expression.head === 'WorkedExample');
  if ((!validated && new Set(numeric.map(c => format(c.input))).size < 2) || (validated && outcomes.length < 2)) throw new Error('Procedure needs varied checked numeric evidence');
  return { records, checks: numeric };
}

// Expand checked helper calls to a bounded numeric normal form. Inspect all helper
// rules, not just a happy-path execution. Effects, branches, overloads and cycles
// are conservatively excluded from this induction vocabulary.
export function normalizeNumeric(store, body, parameters, options = { profile: '' }) {
  const primitives = numericPrimitives(store), byOperation = new Map(primitives.map(p => [p.operation, p])), supports = new Set(), stack = new Set();
  let nodes = 0;
  function visit(value, scope, bindings = new Map()) {
    if (++nodes > 256) throw new Error('Numeric expansion budget exhausted');
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (isVariable(value) && scope.has(value.variable)) return bindings.get(value.variable) ?? value;
    if (!isTerm(value)) throw new Error('Expected a finite numeric expression');
    const args = values(value);
    if (value.head === 'Let' && args.length === 3 && isVariable(args[0])) {
      if (!uses(args[2], args[0].variable)) throw new Error('Unused strict binding cannot be erased');
      const local = visit(args[1], scope, bindings), next = new Map(bindings), locals = new Set(scope);
      next.set(args[0].variable, local); locals.add(args[0].variable);
      return visit(args[2], locals, next);
    }
    if (value.head === 'Native') {
      const primitive = byOperation.get(args[0]);
      if (!primitive || args.length !== 3 || value.args.some(a => a.name !== undefined)) throw new Error('Not a pure numeric operation');
      primitive.supports.forEach(id => supports.add(id));
      let left = visit(args[1], scope, bindings), right = visit(args[2], scope, bindings);
      if (primitive.commutative && format(left) > format(right)) [left, right] = [right, left];
      return term('Native', primitive.operation, left, right);
    }
    if (stack.has(value.head)) throw new Error('Circular numeric helper');
    const rules = store.parts(value.head, 'Realization');
    if (!rules.length) throw new Error('Unknown numeric helper');
    const expanded = [];
    stack.add(value.head);
    try {
      for (const rule of rules) {
        if (values(field(rule.expression, 'context', term('Context'))).length) throw new Error('Context-specific numeric helper');
        const found = match(values(rule.expression)[0], value, new Map());
        if (!found || parameterNames(values(rule.expression)[0]).size !== value.args.length) throw new Error('Overloaded numeric helper');
        const proof = checkedRule(store, rule, options); proof.records.forEach(r => supports.add(r.id));
        const actuals = new Map([...found].map(([name, argument]) => [name, visit(argument, scope, bindings)]));
        expanded.push(visit(field(rule.expression, 'body'), parameterNames(values(rule.expression)[0]), actuals));
      }
    } finally { stack.delete(value.head); }
    if (new Set(expanded.map(format)).size !== 1) throw new Error('Conflicting numeric helpers');
    return expanded[0];
  }
  return { body: visit(body, parameters), supports: [...supports] };
}

export async function numericBlocks(store, evaluator, options) {
  const blocks = numericPrimitives(store).map(p => ({ ...p, pattern: null, body: null })), seen = new Set();
  const limit = name => values(store.parts('InductionPolicy', name)[0]?.expression)[0];
  const maximum = limit('MaximumReusableBlocks') ?? 16, inspections = limit('MaximumProcedureInspections') ?? 128;
  let inspected = 0, retained = 0;
  for (const [name] of store.definitions()) for (const rule of store.parts(name, 'Realization')) {
    try {
      const pattern = values(rule.expression)[0], parameters = parameterNames(pattern);
      if (pattern?.head !== name || pattern.args.length !== 2 || parameters.size !== 2 || !pattern.args.every(a => isVariable(a.value))) continue;
      if (++inspected > inspections || retained >= maximum) return blocks;
      if (values(field(rule.expression, 'context', term('Context'))).length) continue;
      const proof = checkedRule(store, rule, options);
      const normalized = normalizeNumeric(store, pattern, parameters, options);
      if (parameterNames(normalized.body).size !== 2) continue;
      for (const check of proof.checks) {
        const result = await evaluator.evaluate(normalized.body, { bindings: match(pattern, check.input, new Map()) });
        if (format(result.value) !== format(check.output)) throw new Error('Retained numeric check failed');
      }
      // Name-independent normal form avoids duplicate wrappers consuming the search budget.
      const canonical = substitute(normalized.body, new Map(pattern.args.map((a, i) => [a.value.variable, { variable: 'input' + i }]))), key = format(canonical);
      if (seen.has(key)) continue; seen.add(key);
      blocks.push({ name, pattern, body: normalized.body, arity: 2, commutative: false, supports: normalized.supports });
      retained++;
    } catch { /* Ineligible knowledge remains retained; it is not an induction block. */ }
  }
  return blocks;
}
