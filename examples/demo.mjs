import { readFileSync } from 'node:fs';
import { Project } from '../src/project.mjs';
import { parse, format } from '../src/ncon.mjs';

const p = new Project({ online: false, profile: 'keal' });
try {
  p.load(readFileSync(new URL('./world.ncon', import.meta.url), 'utf8'), { provenance: 'example:curriculum' });
  console.log('1. Raw input stays intact:');
  const messy = await p.turn('waht  🖕!'); console.log(JSON.stringify(messy.input.tokens));
  console.log('\n2. Teach one example, then use different known referents:');
  const learned = await p.teachExample('Greg returns the book', parse('Returning(actor=Greg(), object=Book())'));
  console.log(format(learned.declaration));
  const turn = await p.turn('Emmy returns the cookie'); console.log(turn.spoken);
  console.log('\n3. An expected reward of 5 followed by 8 reinforces the chosen procedure:');
  const feedback = await p.reward(turn.candidates[0].rule, 8, { expected: 5 });
  console.log(`prediction error=${feedback.error}; new expectation=${feedback.updated}`);
  console.log('\n4. A lower-than-expected outcome softens it:');
  console.log(await p.reward(turn.candidates[0].rule, 2));
  console.log('\n5. Missing roles remain visible and create work:');
  const hole = await p.turn('Greg returns the book to'); console.log(hole.spoken);
  console.log(hole.candidates.map(c => format(c.meaning)).join('\n'));
  console.log('\n6. More than one meaning can be the intended result:');
  console.log((await p.turn('I used to be a banker, but I lost interest')).spoken);
  console.log('\n7. Unsupported input becomes durable work:');
  const earlier = await p.turn('blorple'); console.log(earlier.spoken);
  p.load('Concept(Blorple(), Surface("blorple"), IsA(Object()))', { provenance: 'user:correction' });
  console.log('After teaching, resume the SAME observation:'); console.log((await p.resume(earlier.episodeId, { learn: false })).spoken);
} finally { p.close(); }
