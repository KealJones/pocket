import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Project } from '../src/project.mjs';
import { capture, reconstruct } from '../src/ears.mjs';
import { parse, format, values, term, call } from '../src/ncon.mjs';
const curriculum = readFileSync(new URL('../examples/world.ncon', import.meta.url), 'utf8');
const project = () => { const p = new Project({ online: false, profile: 'keal' }); p.load(curriculum, { provenance: 'test:curriculum' }); return p; };

test('ears are lossless across whitespace, spelling, punctuation, emoji, URLs and code', () => {
  const raw = 'waht  “the set” 🖕🏽?!\n```js\nreturn 5 + 2\n``` https://example.org/a#b';
  const input = capture(raw); assert.equal(reconstruct(input), raw);
  for (const token of input.tokens) assert.equal(raw.slice(token.start, token.end), token.raw);
  assert.ok(input.tokens.some(t => t.kind === 'code' && t.protected));
  assert.ok(input.tokens.some(t => t.kind === 'quote' && t.protected));
});
test('unknown words are observations, not globally minted semantic identities', async () => {
  const p = project(); try {
    const turn = await p.turn('waht frobnicate');
    assert.equal(turn.input.source, 'waht frobnicate'); assert.equal(turn.status, 'learning');
    assert.equal(p.store.definitions().has('Frobnicate'), false);
    assert.ok(p.store.agenda().some(j => j.query === 'frobnicate'));
  } finally { p.close(); }
});
test('a personal spelling pattern provides evidence without replacing input or other readings', async () => {
  const p = project(); try {
    const turn = await p.turn('waht'); assert.equal(turn.input.source, 'waht');
    assert.equal(format(turn.candidates[0].meaning), 'What()'); assert.equal(turn.candidates.length, 2);
    const stranger = await p.turn('waht', { profile: 'someone-else' }); assert.equal(stranger.candidates.length, 0);
  } finally { p.close(); }
});
test('learning from one labelled example generalizes to new known names and objects', async () => {
  const p = project(); try {
    const learned = await p.teachExample('Greg returns the book', parse('Returning(actor=Greg(),object=Book())'));
    assert.ok(format(learned.declaration).includes('Slot($v0, kind=Person())'));
    const turn = await p.turn('Emmy returns the cookie');
    assert.equal(turn.status, 'resolved'); assert.equal(turn.spoken, 'Returning(actor=Emmy(), object=Cookie())');
    assert.equal(p.store.agenda().some(j => j.kind === 'lexical' && ['returns','the'].includes(j.query)), false);
  } finally { p.close(); }
});
test('learning declines ambiguous alignments rather than guessing', async () => {
  const p = project(); try {
    await assert.rejects(p.teachExample('Greg gives Greg the book', parse('Giving(actor=Greg(),recipient=Greg(),object=Book())')), /Ambiguous/);
  } finally { p.close(); }
});
test('the original episode can be resumed after learning without fabricating another observation', async () => {
  const p = project(); try {
    const earlier = await p.turn('blorple'); const count = p.store.records('Episode').length;
    p.load('Concept(Blorple(),Surface("blorple"),IsA(Object()))');
    const revised = await p.resume(earlier.episodeId);
    assert.equal(revised.episodeId, earlier.episodeId); assert.equal(revised.status, 'resolved');
    assert.equal(p.store.records('Episode').length, count); assert.equal(p.store.records('Feedback').length, 0);
  } finally { p.close(); }
});
test('negative and hypothetical statements require their own structure, not word proximity', async () => {
  const p = project(); try {
    await p.teachExample('Greg returns the book', parse('Returning(actor=Greg(),object=Book())'));
    assert.equal((await p.turn('Greg does not return the book')).status, 'learning');
    await p.teachExample('Greg does not return the book', parse('Negated(Returning(actor=Greg(),object=Book()))'));
    assert.equal((await p.turn('Emmy does not return the cookie')).spoken, 'Negated(Returning(actor=Emmy(), object=Cookie()))');
    assert.equal((await p.turn('Imagine Greg returns the book')).status, 'learning');
  } finally { p.close(); }
});
test('quoted or executable-looking text is retained without becoming an instruction', async () => {
  const p = project(); try {
    const turn = await p.turn('`Native("number.add",5,2)`');
    assert.equal(turn.status, 'learning'); assert.equal(turn.input.tokens.length, 1);
    assert.equal(turn.input.tokens[0].protected, true); assert.equal(p.store.agenda().some(j => j.kind === 'lexical'), false);
  } finally { p.close(); }
});
test('missing arguments survive as explicit holes and generate pending work', async () => {
  const p = project(); try {
    const turn = await p.turn('Greg returns the book to');
    assert.equal(turn.status, 'learning'); assert.ok(format(turn.candidates[0].meaning).includes('Hole(role="destination"'));
  } finally { p.close(); }
});
test('ambiguity differs from an intentional joint interpretation', async () => {
  const p = project(); try {
    const ambiguous = await p.turn('interest'); assert.equal(ambiguous.status, 'ambiguous');
    assert.equal(ambiguous.candidates.length, 2);
    const pun = await p.turn('I used to be a banker, but I lost interest');
    assert.equal(pun.status, 'resolved'); assert.equal(pun.candidates[0].meaning.head, 'JointInterpretation');
  } finally { p.close(); }
});
test('multiword titles retain articles and compete with compositional readings', async () => {
  const p = project(); try {
    assert.equal((await p.turn('the set')).spoken, 'TheSet()');
    p.load('Concept(Band(),IsA(Performer()),Surface("band"))\nConcept(PerformedConstruction(),Construction(pattern=List(Literal("the"),Slot($set,kind=Performance()),Literal("that"),Slot($band,kind=Performer()),Literal("played")),meaning=Performed(actor=$band,program=$set)))');
    assert.equal((await p.turn('the set that band played')).spoken, 'Performed(actor=Band(), program=PerformanceSet())');
  } finally { p.close(); }
});
test('obtained minus expected reward credits only the selected procedure', async () => {
  const p = project(); try {
    const learned = await p.teachExample('Greg returns the book', parse('Returning(actor=Greg(),object=Book())'));
    const turn = await p.turn('Emmy returns the cookie'), target = turn.candidates[0].rule;
    const positive = await p.reward(target, 8, { expected: 5 });
    assert.equal(positive.error, 3); assert.equal(positive.updated, 5.6);
    const lower = await p.reward(target, 2); assert.ok(lower.error < 0); assert.equal(lower.updated, 4.88);
    assert.equal(p.store.expectation(target), 0); // Profile isolation.
    assert.equal(p.store.expectation(learned.id, 'keal'), 4.88);
  } finally { p.close(); }
});
test('retracting supporting evidence invalidates derived readings and learned constructions', async () => {
  const p = project(); try {
    const learned = await p.teachExample('Greg returns the book', parse('Returning(actor=Greg(),object=Book())'));
    const turn = await p.turn('Emmy returns the cookie');
    const removed = p.store.retract(learned.lessonId);
    assert.ok(removed.includes(learned.id)); assert.ok(removed.includes(turn.readingId));
    assert.equal((await p.resume(turn.episodeId)).status, 'learning');
  } finally { p.close(); }
});
test('independent evidence paths are retained separately', () => {
  const p = project(); try {
    const a = p.store.put(term('Observation', 'a')), b = p.store.put(term('Observation', 'b'));
    const fact = parse('Concept(Test(),Surface("test"))');
    const first = p.store.put(fact, { supports: [a] }), second = p.store.put(fact, { supports: [b] });
    assert.notEqual(first, second); p.store.retract(a);
    assert.equal(p.store.record(first).active, false); assert.equal(p.store.record(second).active, true);
    assert.equal(p.store.surfaces('test').length, 1);
  } finally { p.close(); }
});
test('persistence retains learning, reward, observations and pending work across restarts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'napkin-next-')), path = join(directory, 'graph.sqlite');
  let p = new Project({ path, online: false, profile: 'keal' });
  try {
    p.load(curriculum); const learned = await p.teachExample('Greg returns the book', parse('Returning(actor=Greg(),object=Book())'));
    await p.reward(learned.id, 8, { expected: 5 }); await p.turn('unseen'); p.close();
    p = new Project({ path, online: false, profile: 'keal' });
    assert.equal((await p.turn('Emmy returns the cookie')).status, 'resolved');
    assert.equal(p.store.expectation(learned.id, 'keal'), 5.6);
    assert.ok(p.store.agenda().some(j => j.query === 'unseen'));
  } finally { p.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('export and import preserve identity, provenance and dependency links', async () => {
  const a = project(), b = new Project({ online: false });
  try {
    await a.teachExample('Greg returns the book', parse('Returning(actor=Greg(),object=Book())'));
    const turn = await a.turn('Emmy returns the cookie'); b.importRecords(a.store.export());
    assert.ok(b.store.record(turn.readingId)?.active);
    assert.equal((await b.resume(turn.episodeId)).spoken, turn.spoken);
  } finally { a.close(); b.close(); }
});
test('an empty or broken pack manifest fails loudly instead of booting with zero knowledge', () => {
  const directory = mkdtempSync(join(tmpdir(), 'napkin-packs-'));
  try {
    writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ schemaVersion: 1, packs: [] }));
    assert.throws(() => new Project({ packs: directory }), /empty/);
    writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ schemaVersion: 1, packs: ['empty.ncon'], required: ['Hear'] }));
    writeFileSync(join(directory, 'empty.ncon'), 'Concept(Unrelated())');
    assert.throws(() => new Project({ packs: directory }), /Required concept missing/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('external evidence cannot inject executable behavior', () => {
  const p = project(); try {
    assert.throws(() => p.load('Concept(Evil(),Realization(Evil(),body=Native("number.add",1,2)))', { trusted: false }), /cannot install/);
    assert.equal(p.store.definitions().has('Evil'), false);
  } finally { p.close(); }
});
test('search budget exhaustion cannot be reported as a confidently resolved interpretation', async () => {
  const p = project(); try {
    await p.teachExample('Greg returns the book', parse('Returning(actor=Greg(),object=Book())'));
    p.load('Concept(InterpretationPolicy(),MaximumStates(1))', { provenance: 'user:policy' });
    const turn = await p.turn('Greg returns the book'); assert.equal(turn.exhausted, true); assert.equal(turn.status, 'learning');
  } finally { p.close(); }
});
