import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, parseMany, format, match, values, field } from '../src/ncon.mjs';
import { Project } from '../src/project.mjs';

test('ncon preserves named roles, literals, Unicode identities, and trailing commas', () => {
  const x = parse('意味(🖕(), actor=$who, raw="waht", value=null,)');
  assert.equal(format(parse(format(x))), format(x)); assert.equal(field(x, 'value', 'fallback'), null);
});
test('ncon raw strings and comments do not rewrite quoted program text', () => {
  const x = parseMany('# hi\nHold("""return 5 + 2 // raw""") // ignored\nEmpty()');
  assert.equal(values(x[0])[0], 'return 5 + 2 // raw'); assert.equal(x.length, 2);
});
test('invalid or duplicate argument syntax fails with a location', () => {
  assert.throws(() => parse('A(x=1,x=2)'), /Duplicate.*1:/);
  assert.throws(() => parse('A('), /Unterminated/);
  assert.throws(() => parse('A(1e999)'), /Non-finite/);
});
test('pattern matching respects named argument order independence and repeated variables', () => {
  assert.ok(match(parse('R(a=$x,b=$y)'), parse('R(b=2,a=1)')));
  assert.equal(match(parse('R($x,$x)'), parse('R(1,2)')), null);
  assert.deepEqual(values(match(parse('R($a,Rest($rest))'), parse('R(1,2,3)')).get('rest')), [2, 3]);
});
test('unknown expressions remain residuals', async () => {
  const p = new Project({ online: false });
  try { assert.equal(format((await p.evaluator.evaluate(parse('NeverLearned(5)'))).value), 'NeverLearned(5)'); } finally { p.close(); }
});
test('ordinary authored concepts change executable behavior', async () => {
  const p = new Project({ online: false });
  try {
    p.load('Concept(Double(), Realization(Double($x), body=Native("number.multiply",$x,2)))');
    assert.equal((await p.evaluator.evaluate(parse('Double(7)'))).value, 14);
    assert.equal((await p.evaluator.evaluate(parse('UpdateExpectation(5,8,0.2)'))).value, 5.6);
  } finally { p.close(); }
});
test('context selects realizations and equally specific conflicts remain alternatives', async () => {
  const p = new Project({ online: false });
  try {
    p.load('Concept(X(),Realization(X(),context=Context(A()),body=1),Realization(X(),context=Context(B()),body=2))');
    assert.equal((await p.evaluator.evaluate(parse('X()'), { context: parse('Context(A())') })).value, 1);
    assert.equal((await p.evaluator.evaluate(parse('X()'), { context: parse('Context(A(),B())') })).value.head, 'Alternatives');
  } finally { p.close(); }
});
test('quote and shadowing preserve the code/data boundary', async () => {
  const p = new Project({ online: false });
  try {
    assert.equal(format((await p.evaluator.evaluate(parse('Quote(Native("number.add",1,2))'))).value), 'Native("number.add", 1, 2)');
    assert.equal((await p.evaluator.evaluate(parse('Let($x,1,Let($x,2,$x))'))).value, 2);
    p.load('Concept(Inner(),Realization(Inner($x),body=Native("number.add",$x,1)))\nConcept(Outer(),Realization(Outer($x),body=Inner(Native("number.add",$x,2))))');
    // A realization evaluates a nested operation only where its own body asks for it.
    assert.equal((await p.evaluator.evaluate(parse('Let($x,2,Inner($x))'))).value, 3);
  } finally { p.close(); }
});
test('cycles are residuals and noncyclic runaway evaluations hit a budget', async () => {
  const p = new Project({ online: false });
  try {
    p.load('Concept(A(),Realization(A(),body=B()))\nConcept(B(),Realization(B(),body=A()))');
    const result = await p.evaluator.evaluate(parse('A()')); assert.equal(format(result.value), 'A()'); assert.ok(result.trace.some(t => t.outcome === 'cycle'));
    p.evaluator.maximumSteps = 2;
    await assert.rejects(p.evaluator.evaluate(parse('UpdateExpectation(5,8,0.2)')), /budget/);
  } finally { p.close(); }
});
