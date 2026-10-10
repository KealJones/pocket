import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import initSQL from 'sql.js';
import { ProjectCore } from '../src/project-core.mjs';
import { BrowserStore } from '../web/store.mjs';
import { createHash as browserHash } from '../web/crypto.mjs';
import { createHash } from 'node:crypto';
import { parse, format } from '../src/ncon.mjs';
const manifest = JSON.parse(readFileSync(new URL('../packs/manifest.json', import.meta.url), 'utf8'));
const bundle = { manifest, packs: Object.fromEntries(manifest.packs.map(name => [name, readFileSync(new URL('../packs/' + name, import.meta.url), 'utf8')])) };

test('browser identities are byte-for-byte compatible with Node identities', () => {
  for (const value of ['', 'abc', 'waht 🖕🏽', 'Concept(Test(), Surface("test"))', 'x'.repeat(10000)]) {
    assert.equal(browserHash('sha256').update(value).digest('hex'), createHash('sha256').update(value).digest('hex'));
  }
});
test('the browser SQLite engine learns, rewards, retains jobs, and restores its full database', async () => {
  const SQL = await initSQL(); let p = new ProjectCore({ store: new BrowserStore(SQL), bundle, online: false, profile: 'keal' });
  try {
    p.load(readFileSync(new URL('../examples/world.ncon', import.meta.url), 'utf8'));
    const lesson = await p.teachExample('Greg returns the book', parse('Returning(actor=Greg(),object=Book())'));
    const turn = await p.turn('Emmy returns the cookie');
    assert.equal(turn.status, 'resolved');
    assert.equal(turn.spoken, 'Returning(actor=Emmy(), object=Cookie())');
    await p.reward(turn.candidates[0].rule, 8, { expected: 5 });
    const unknown = await p.turn('blorple'); const bytes = p.store.snapshot(); p.close();
    assert.equal(new TextDecoder().decode(bytes.slice(0, 15)), 'SQLite format 3');
    p = new ProjectCore({ store: new BrowserStore(SQL, bytes), bundle, online: false, profile: 'keal' });
    assert.equal(p.store.expectation(lesson.id, 'keal'), 5.6);
    assert.ok(p.store.agenda().some(j => j.query === 'blorple'));
    p.load('Concept(Blorple(),Surface("blorple"))');
    assert.equal((await p.resume(unknown.episodeId)).spoken, 'Blorple()');
    assert.ok(p.store.retract(lesson.lessonId).includes(lesson.id));
    assert.equal((await p.resume(turn.episodeId)).status, 'learning');
  } finally { p.close(); }
});
