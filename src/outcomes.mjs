import { capture } from './ears.mjs';
import { call, term, variable, values, field, format, match, isTerm, substitute, specificity } from './ncon.mjs';
import { digest } from './digest.mjs';
import { validateCode, parameterNames } from './code-learning.mjs';

// Structural alignment and bounded program induction. No English operation dispatch.
export function outline(text) {
  const input = capture(text), units = input.tokens.filter(t => t.kind !== 'space'), numbers = [], pattern = [];
  for (const unit of units) {
    if (unit.kind === 'number') { const name = 'v' + numbers.length; numbers.push(Number(unit.raw)); pattern.push(call('Slot', [variable(name)], { primitive: 'number' })); }
    else pattern.push(term('Literal', unit.raw.normalize('NFC').toLowerCase()));
  }
  return { input, numbers, pattern: term('List', ...pattern) };
}
function primitives(store) {
  return [...store.definitions()].filter(([name]) => store.isA(name, 'InductionPrimitive')).map(([name]) => {
    const capability = store.parts(name, 'Capability')[0], arity = store.parts(name, 'Arity')[0], commutative = store.parts(name, 'Commutative')[0];
    return { name, operation: values(capability?.expression)[0], arity: values(arity?.expression)[0], commutative: values(commutative?.expression)[0] === true,
      supports: [...new Set([capability?.support, arity?.support, commutative?.support, ...(store.typeProof(name,'InductionPrimitive') ?? [])].filter(Boolean))] };
  }).filter(p => p.arity === 2 && typeof p.operation === 'string');
}
function candidatePrograms(count, blocks, maximum) {
  const initial = Array.from({ length: count }, (_, i) => ({ expression: variable('v' + i), used: new Set([i]), supports: [] }));
  const levels = new Map([[1, initial]]), complete = []; let examined = 0, exhausted = false;
  for (let size = 2; size <= count && !exhausted; size++) {
    const level = [], unique = new Set();
    for (let leftSize = 1; leftSize < size && !exhausted; leftSize++) for (const left of levels.get(leftSize) ?? []) for (const right of levels.get(size - leftSize) ?? []) {
      if ([...left.used].some(i => right.used.has(i))) continue;
      for (const block of blocks) {
        if (++examined > maximum) { exhausted = true; break; }
        if (block.commutative && format(left.expression) > format(right.expression)) continue;
        const expression = term('Native', block.operation, left.expression, right.expression), key = format(expression);
        if (unique.has(key)) continue; unique.add(key);
        const candidate = { expression, used: new Set([...left.used, ...right.used]), supports: [...new Set([...left.supports, ...right.supports, ...block.supports])] };
        level.push(candidate); if (size === count) complete.push(candidate);
      }
    }
    levels.set(size, level);
  }
  return { complete, exhausted, examined };
}
export async function induce(store, evaluator, { profile = '', minimumExamples = 2, maximumExpressions = 256 } = {}) {
  const groups = new Map(), learned = [], pending = [];
  for (const record of store.records('WorkedExample')) {
    if (field(record.expression, 'profile', '') !== profile) continue;
    const [text, output] = values(record.expression); if (typeof text !== 'string' || typeof output !== 'number' || !Number.isFinite(output)) continue;
    const shape = outline(text), signature = format(shape.pattern);
    if (shape.numbers.length < 2 || shape.numbers.length > 4) continue;
    const group = groups.get(signature) ?? []; group.push({ ...shape, output, support: record.id }); groups.set(signature, group);
  }
  for (const [signature, examples] of groups) {
    // A new counterexample must withdraw the older procedure before proposing another.
    const prior = [];
    for (const record of store.records('Concept').filter(r => r.source === 'derived:program-induction')) {
      const construction = values(record.expression).find(x => isTerm(x) && x.head === 'Construction');
      if (construction && format(field(construction, 'pattern')) === signature && field(construction, 'profile', '') === profile) prior.push(record);
    }
    const distinct = new Set(examples.map(e => JSON.stringify(e.numbers)));
    if (distinct.size < minimumExamples) { for (const record of prior) store.retract(record.id); pending.push({ signature, reason: 'Needs varied input/output evidence' }); continue; }
    const candidates = candidatePrograms(examples[0].numbers.length, primitives(store), maximumExpressions), surviving = [];
    for (const candidate of candidates.complete) {
      let fits = true;
      for (const example of examples) {
        try {
          const result = await evaluator.evaluate(candidate.expression, { bindings: new Map(example.numbers.map((number, index) => ['v' + index, number])) });
          if (typeof result.value !== 'number' || Math.abs(result.value - example.output) > 1e-10 * Math.max(1, Math.abs(example.output))) { fits = false; break; }
        } catch { fits = false; break; }
      }
      if (fits) surviving.push(candidate);
    }
    if (candidates.exhausted || surviving.length !== 1) { for (const record of prior) store.retract(record.id); pending.push({ signature, reason: candidates.exhausted ? 'Program search budget exhausted' : `${surviving.length} procedures fit; needs distinguishing examples` }); continue; }
    const candidate = surviving[0], identity = term('LearnedProcedure_' + digest(signature + '|' + format(candidate.expression) + '|' + profile));
    const arguments_ = examples[0].numbers.map((_, index) => variable('v' + index));
    const declaration = term('Concept', identity, term('IsA', term('LearnedPureProcedure')),
      call('Construction', [], { pattern: examples[0].pattern, meaning: term(identity.head, ...arguments_), profile }),
      call('Realization', [term(identity.head, ...arguments_)], { body: candidate.expression }),
      call('ValidatedProgram', [term(identity.head, ...arguments_)], { body: candidate.expression, examples: examples.length }));
    const policy = store.parts('InductionPolicy').map(p => p.support);
    const supports = [...new Set([...examples.map(e => e.support), ...candidate.supports, ...policy])];
    const id = store.put(declaration, { source: 'derived:program-induction', supports });
    for (const record of prior) if (record.id !== id) store.retract(record.id);
    learned.push({ id, declaration, examples: examples.length, program: candidate.expression });
  }
  return { learned, pending };
}
export function addOutcome(store, text, output, { profile = '', source = 'user:worked-example', supports = [] } = {}) {
  if (typeof text !== 'string' || typeof output !== 'number' || !Number.isFinite(output)) throw new Error('Worked examples need original text and a finite numeric outcome');
  return store.put(call('WorkedExample', [text, output], { profile }), { source, supports });
}
export async function answerLearned(store, evaluator, expression) {
  if (!isTerm(expression)) return expression;
  const available=[...store.parts(expression.head, 'ValidatedProgram'),...store.parts(expression.head,'ValidatedRealization')].filter(p=>match(values(p.expression)[0],expression,new Map()));
  const maximum=Math.max(0,...available.map(p=>specificity(values(p.expression)[0]))), selected=available.filter(p=>specificity(values(p.expression)[0])===maximum);
  if(new Set(selected.map(p=>format(substitute(field(p.expression,'body'),match(values(p.expression)[0],expression,new Map()))))).size>1) return call('Replied',[],{text:'Different learned realizations disagree. I need a distinguishing example or a revision before executing one.'});
  for (const program of selected) {
    const bindings = match(values(program.expression)[0], expression, new Map()); if (!bindings) continue;
    const body = field(program.expression, 'body'), allowed = new Set(primitives(store).map(p => p.operation));
    if(program.expression.head==='ValidatedRealization') {
      try { validateCode(body,parameterNames(values(program.expression)[0])); return (await evaluator.evaluate(body,{bindings})).value; }
      catch { return term('Residual',expression); }
    }
    function pure(value) {
      if (typeof value === 'number' || value?.variable) return true;
      return isTerm(value) && value.head === 'Native' && allowed.has(values(value)[0]) && values(value).slice(1).every(pure);
    }
    if (!pure(body)) return term('Residual', expression);
    try { return (await evaluator.evaluate(body, { bindings })).value; }
    catch { return term('Residual', expression); }
  }
  return expression;
}
