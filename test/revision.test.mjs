import test from 'node:test';
import assert from 'node:assert/strict';
import { Project } from '../src/project.mjs';
import { parse } from '../src/ncon.mjs';

test('retracting an independent type proof invalidates a reading that used it', async () => {
  const p = new Project({ online: false });
  try {
    p.load('Concept(Greg(),Surface("Greg"))\nConcept(Book(),Surface("book"))');
    const [type] = p.load('Concept(Greg(),IsA(Person()))');
    p.load('Concept(Book(),IsA(Object()))\nConcept(ReturningPattern(),Construction(pattern=List(Slot($actor,kind=Person()),Literal("returns"),Slot($object,kind=Object())),meaning=Returning(actor=$actor,object=$object)))');
    const turn = await p.turn('Greg returns book');
    assert.equal(turn.status, 'resolved');
    assert.ok(p.store.retract(type).includes(turn.readingId));
    assert.equal((await p.resume(turn.episodeId)).status, 'learning');
  } finally { p.close(); }
});
test('feedback is retractable evidence and ranking depends on its proof', async () => {
  const p = new Project({ online: false });
  try {
    const [target] = p.load('Concept(Test(),Surface("test"))');
    const feedback = await p.reward(target, 8, { expected: 5 });
    const turn = await p.turn('test');
    assert.equal(turn.candidates[0].expectation, 5.6);
    assert.ok(p.store.retract(feedback.id).includes(turn.readingId));
    assert.equal((await p.resume(turn.episodeId)).candidates[0].expectation, 0);
  } finally { p.close(); }
});
test('policy changes are explicit revisions and equal-revision conflicts fail', () => {
  const p = new Project({ online: false });
  try {
    p.load('Concept(InterpretationPolicy(),Margin(0.2),Revision(1))');
    p.load('Concept(InterpretationPolicy(),Margin(0.3),Revision(2))');
    assert.equal(p.policy('InterpretationPolicy', 'Margin'), 0.3);
    p.load('Concept(InterpretationPolicy(),Margin(0.4),Revision(2))');
    assert.throws(() => p.policy('InterpretationPolicy', 'Margin'), /Conflicting/);
  } finally { p.close(); }
});
test('bounded exist revisits an original observation after new evidence and shares attention', async () => {
  const p = new Project({ online: false });
  try {
    const first = await p.turn('unresolved-one');
    const second = await p.turn('blorple');
    p.load('Concept(Blorple(),Surface("blorple"))');
    assert.equal((await p.exist({ budget: 1 })).revisions[0].episodeId, first.episodeId);
    const work = await p.exist({ budget: 1 });
    assert.equal(work.revisions[0].episodeId, second.episodeId);
    assert.equal(work.revisions[0].status, 'resolved');
    assert.equal(p.store.records('Episode').length, 2);
    const evaluation = await p.evaluator.evaluate(parse('Exist(0)'));
    assert.equal(evaluation.value.head, 'BackgroundWork');
    assert.equal(p.store.records('Episode').length, 2);
  } finally { p.close(); }
});

test('withdrawn knowledge reopens completed learning work and lesson types are dependencies', async () => {
  const p = new Project({ online: false });
  try {
    const first = await p.turn('blorple');
    const [fact] = p.load('Concept(Blorple(),Surface("blorple"))');
    await p.resume(first.episodeId);
    await p.tick({ budget: 10 });
    assert.equal(p.store.agenda().some(j => j.query === 'blorple'), false);
    p.store.retract(fact);
    await p.resume(first.episodeId);
    assert.ok(p.store.agenda().some(j => j.query === 'blorple' && j.kind === 'lexical'));
    p.load('Concept(Greg(),Surface("Greg"))\nConcept(Book(),Surface("book"))\nConcept(Book(),IsA(Object()))');
    const [type] = p.load('Concept(Greg(),IsA(Person()))');
    const lesson = await p.teachExample('Greg returns book', parse('Returning(actor=Greg(),object=Book())'));
    assert.ok(p.store.retract(type).includes(lesson.id));
  } finally { p.close(); }
});
