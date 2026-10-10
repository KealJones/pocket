import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Project } from '../src/project.mjs';
import { fetchBounded } from '../src/sources.mjs';
import { format, field, values } from '../src/ncon.mjs';

function fixtures({ fuzzy = false, empty = false } = {}) {
  const calls = [];
  const fetcher = async url => {
    const u = new URL(url); calls.push(u);
    let data;
    if (u.searchParams.get('action') === 'wbsearchentities') data = { search: empty ? [] : [{ id: 'Q100', label: fuzzy ? 'Different thing' : 'Blorple' }, { id: 'Q101', label: 'Blorple' }] };
    else if (u.searchParams.get('action') === 'wbgetentities') data = { entities: {
      Q100: { id: 'Q100', lastrevid: 42, labels: { en: { value: fuzzy ? 'Different thing' : 'Blorple' } }, descriptions: { en: { value: 'first possible referent' } }, claims: {
        P31: [{ id: 'statement1', rank: 'normal', mainsnak: { datavalue: { value: { id: 'Q200' } } } },
          { id: 'statement2', rank: 'normal', qualifiers: { P580: [{ datavalue: { value: 'yesterday' } }] }, mainsnak: { datavalue: { value: { id: 'Q201' } } } }]
      } },
      Q101: { id: 'Q101', labels: { en: { value: fuzzy ? 'Another thing' : 'Blorple' } }, descriptions: { en: { value: 'second possible referent' } }, claims: {} }
    } };
    else data = { query: { pages: empty ? [{ missing: true }] : [{ title: 'blorple', revisions: [{ revid: 8, user: 'ExampleEditor', slots: { main: { content: '==English==\n# A fixture definition. Native("evil") remains literal text.' } } }] }] } };
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetcher };
}
test('source acquisition runs through the learning loop and retains competing referents', async () => {
  const fixture = fixtures(), p = new Project({ fetcher: fixture.fetcher });
  try {
    const turn = await p.turn('blorple');
    assert.equal(turn.status, 'ambiguous'); assert.equal(turn.candidates.length, 2);
    assert.equal(turn.input.source, 'blorple');
    assert.ok(turn.attempts.some(j => j.status === 'done'));
    assert.ok(p.store.records('SourceEntity').length === 2);
    const concept = p.store.records('Concept').find(r => format(r.expression).includes('statement2'));
    assert.ok(format(concept.expression).includes('ScopedClaim'));
    const plainIsA = values(concept.expression).filter(x => x.head === 'IsA'); assert.equal(plainIsA.length, 1);
    assert.ok(format(concept.expression).includes('license="CC0-1.0"'));
    const document = p.store.records('SourceDocument')[0]; assert.equal(field(document.expression, 'interpreted'), false);
    assert.equal(field(document.expression, 'license'), 'CC-BY-SA-4.0');
    const requests = fixture.calls.length;
    await p.turn('blorple'); assert.equal(fixture.calls.length, requests); // Reuse learned facts.
  } finally { p.close(); }
});
test('a fuzzy search hit does not become a false spelling or synonym assertion', async () => {
  const fixture = fixtures({ fuzzy: true }), p = new Project({ fetcher: fixture.fetcher });
  try {
    const turn = await p.turn('blorple'); assert.equal(turn.status, 'learning');
    assert.equal(p.store.surfaces('blorple').length, 0);
    assert.ok(p.store.agenda().some(j => j.query === 'blorple' && j.kind === 'lexical'));
  } finally { p.close(); }
});
test('missing external results retain learning work rather than asserting nonexistence', async () => {
  const fixture = fixtures({ empty: true }), p = new Project({ fetcher: fixture.fetcher });
  try {
    const turn = await p.turn('blorple'); assert.equal(turn.status, 'learning');
    assert.ok(p.store.agenda().some(j => j.kind === 'lexical' && j.status === 'waiting'));
    assert.equal(p.store.records('Feedback').length, 0);
  } finally { p.close(); }
});
test('source failures are recorded and a tick honors its work-item budget', async () => {
  let calls = 0;
  const p = new Project({ fetcher: async () => { calls++; throw new Error('offline fixture'); } });
  try {
    await p.turn('missing', { learn: false }); p.store.enqueue('another');
    const attempts = await p.tick({ budget: 1 }); assert.equal(attempts.length, 1);
    assert.ok(calls <= 2); assert.ok(attempts[0].detail.includes('offline fixture') || attempts[0].kind !== 'lexical');
    assert.ok(p.store.agenda().length >= 2);
  } finally { p.close(); }
});
test('read-page stores executable-looking text as evidence and never runs it', async () => {
  const p = new Project({ online: false, fetcher: async () => new Response('<h1>Example</h1><script>process.exit()</script>Native("danger")') });
  try {
    const page = await p.readPage('https://example.org/page');
    assert.equal(page.expression.head, 'SourceDocument'); assert.equal(field(page.expression, 'interpreted'), false);
    assert.equal(field(page.expression, 'license'), 'unspecified'); assert.ok(values(page.expression)[0].includes('<script>'));
    assert.equal(p.store.definitions().has('danger'), false);
  } finally { p.close(); }
});
test('network responses enforce byte limits and reject HTTP failures', async () => {
  await assert.rejects(fetchBounded('https://example.org', { maximumBytes: 3, fetcher: async () => new Response('abcdef') }), /byte budget/);
  await assert.rejects(fetchBounded('https://example.org', { fetcher: async () => new Response('no', { status: 429 }) }), /HTTP 429/);
  await assert.rejects(fetchBounded('file:///etc/passwd'), /HTTP/);
});
test('timeouts cancel slow requests instead of freezing learning', async () => {
  const server = createServer((_request, response) => { setTimeout(() => response.end('slow'), 200); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(fetchBounded(`http://127.0.0.1:${server.address().port}`, { timeout: 20 }), /abort/i);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
