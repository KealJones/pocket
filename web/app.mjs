import { ProjectCore } from '../src/project-core.mjs';
import { BrowserStore, openVault } from './store.mjs';
import { parse, format, values, field } from '../src/ncon.mjs';
import { researchFetch } from './network.mjs';

const $ = id => document.getElementById(id);
const node = (tag, text, className) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; };
let project, SQL, bundle, vault, busy = false;
function notice(text, error = false) { $('notice').textContent = text; $('notice').className = error ? 'error' : ''; $('notice').hidden = !text; }
function tab(name) {
  for (const button of document.querySelectorAll('[data-tab]')) button.setAttribute('aria-selected', String(button.dataset.tab === name));
  for (const panel of document.querySelectorAll('.panel')) panel.hidden = panel.id !== name;
}
function controls(disabled) {
  for (const button of document.querySelectorAll('form button,#demo,#backup,#restore,#exist,#curriculum,.reward button,.revisit,.record button')) button.disabled = disabled;
  $('online').disabled = disabled;
}
function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type })), a = node('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function act(action, { message = 'Working…' } = {}) {
  if (!project || busy) return;
  busy = true; controls(true); notice(message); $('saved').textContent = 'Learning…';
  project.onProgress=async ({stage}) => {
    if(stage!=='retained')return;
    const claims=project.store.records('SourceClaim').length,meanings=project.store.records('AttributedMeaning').length;
    notice('Researching · '+claims+' source statements retained · '+meanings+' passages interpreted');
    await vault.write(project.store.snapshot());
  };
  try {
    await action();
    await vault.write(project.store.snapshot());
    $('saved').textContent = 'Saved in this browser';
    refresh();
  } catch (error) {
    // Preserve partial investigations even when an operation fails.
    try { await vault.write(project.store.snapshot()); $('saved').textContent = 'Saved in this browser'; }
    catch { $('saved').textContent = 'Not saved · download backup'; }
    refresh(); notice(error.message, true);
  } finally { project.onProgress=undefined; busy = false; controls(false); }
}
function history() {
  const episodes = project.store.records('Episode').filter(r => field(r.expression, 'profile', '') === 'keal').sort((a, b) => field(a.expression, 'sequence') - field(b.expression, 'sequence')).slice(-30);
  if (!episodes.length) {
    if (!$('history').querySelector('.welcome')) {
      const welcome = node('div', undefined, 'welcome');
      welcome.append(node('h2', 'Start with a little curiosity.'), node('p', 'Type something messy, or try the learning demo. Your original words will stay intact.'));
      $('history').replaceChildren(welcome);
    }
    return;
  }
  $('history').replaceChildren();
  const readings = project.store.records('Reading'), replies = project.store.records('Reply');
  for (const episode of episodes) {
    const article = node('article', undefined, 'turn');
    article.append(node('div', 'YOU WROTE', 'label'), node('div', values(values(episode.expression)[0])[0], 'user-words'));
    const held = readings.filter(r => field(r.expression, 'episode') === episode.id).sort((a, b) => field(a.expression, 'sequence') - field(b.expression, 'sequence')).at(-1);
    const result = held && values(held.expression)[0];
    const response = held && replies.filter(r => field(r.expression,'reading') === held.id).sort((a,b)=>field(a.expression,'sequence',0)-field(b.expression,'sequence',0)).at(-1);
    const reply = response && values(response.expression)[0];
    const status = field(reply,'pending',false) ? field(reply,'research')==='ambiguous'?'ambiguous':'learning' : result?.head === 'Resolved' ? 'resolved' : result?.head === 'Ambiguous' ? 'ambiguous' : 'learning';
    const clarifiedId=field(reply,'clarifiedEpisode'), clarified=clarifiedId&&project.store.record(clarifiedId);
    if(clarified)article.append(node('p','For your earlier question: '+values(values(clarified.expression)[0])[0],'hint'));
    const text=field(reply,'text',status==='resolved' ? 'I understood: '+format(values(result)[0]) : 'I’m investigating this. I need more evidence for a reliable answer.');
    article.append(node('div','NAPKIN','label'),node('div',text.length>6000?text.slice(0,6000)+'\n[Showing the first 6,000 characters. Full content is retained.]':text,'assistant-words'));
    const urls=new Set([field(reply,'url'),...values(field(response?.expression,'sources')).map(id=>field(project.store.record(id)?.expression,'url'))].filter(Boolean));
    const readable=[...urls].filter(url=>!url.includes('/w/api.php'));
    for(const url of (readable.length?readable:[...urls]).slice(0,3)) { const address=new URL(url);const link=node('a','Source: '+address.hostname+decodeURIComponent(address.pathname).slice(0,90),'citation'); link.href=url; link.target='_blank'; link.rel='noopener noreferrer'; article.append(link); }
    const inspector=node('details',undefined,'inspector'); inspector.append(node('summary','Inspect understanding & evidence'),node('span',status,'status '+status));
    const learning=project.store.records('LearningRun').filter(r=>field(r.expression,'episode')===episode.id).sort((a,b)=>field(b.expression,'sequence',0)-field(a.expression,'sequence',0))[0];
    if(learning){const steps=values(field(learning.expression,'steps'));const detail=node('details');detail.append(node('summary',steps.length?'Learning during this request · '+steps.length+' steps':'Used retained knowledge'));for(const step of steps)detail.append(node('p',values(step)[0]+' · '+field(step,'status')+'\n'+field(step,'detail'),'learning-step'));inspector.append(detail);}
    const evidenceIDs=values(field(response?.expression,'sources'));
    if(evidenceIDs.length){const evidence=node('details');evidence.append(node('summary','Answer evidence and retained sources'));for(const id of evidenceIDs.slice(0,12)){const record=project.store.record(id);if(record)evidence.append(node('pre',id+' · '+record.source+'\n'+format(record.expression).slice(0,5000)));}inspector.append(evidence);}
    if(status==='resolved') inspector.append(node('pre',format(values(result)[0])));
    const candidates = held ? values(field(held.expression, 'readings')) : [];
    if (candidates.length) {
      const details = node('details'), summary = node('summary', candidates.length + (candidates.length === 1 ? ' reading · inspect evidence' : ' readings · inspect evidence'));
      details.append(summary);
      for (const candidate of candidates) {
        const card = node('div', undefined, 'candidate');
        card.append(node('pre', format(values(candidate)[0])));
        card.append(node('div', `Rank ${Number(field(candidate, 'score')).toFixed(3)} · expectation ${Number(field(candidate, 'expectation')).toFixed(2)}`, 'score'));
        const proof = node('details'); proof.append(node('summary', 'Supporting records'), node('pre', values(field(candidate, 'supports')).map(id => {
          const record = project.store.record(id); return `${id} · ${record?.source ?? 'missing'}\n${record ? format(record.expression) : ''}`;
        }).join('\n\n'))); card.append(proof);
        const reward = node('div', undefined, 'reward'), expected = node('input'), obtained = node('input');
        for (const input of [expected, obtained]) { input.type = 'number'; input.step = 'any'; input.inputMode = 'decimal'; }
        expected.value = field(candidate, 'expectation'); obtained.value = '8';
        const eLabel = node('label', 'Expected '), oLabel = node('label', 'Got '); eLabel.append(expected); oLabel.append(obtained);
        const button = node('button', 'Give feedback'); button.type = 'button';
        button.addEventListener('click', () => act(async () => {
          if (expected.value === '' || obtained.value === '') throw new Error('Enter the expected and obtained reward.');
          const feedback = await project.reward(field(candidate, 'rule'), Number(obtained.value), { expected: Number(expected.value), profile: 'keal' });
          notice(`Prediction error ${feedback.error.toFixed(2)}. New expectation ${feedback.updated.toFixed(2)}. Revisit to see its ranking update.`);
        }, { message: 'Updating this procedure’s expectation…' }));
        reward.append(eLabel, oLabel, button); card.append(reward); details.append(card);
      }
      inspector.append(details);
    }
    const tokens = values(values(values(episode.expression)[0])[1]);
    const raw = node('details'); raw.append(node('summary', 'Original pieces, including spaces'));
    const pieces = node('div', undefined, 'token-list');
    for (const token of tokens) {
      const piece = node('span', values(token)[0]); piece.dataset.kind = field(token, 'kind');
      piece.title = `${field(token, 'kind')} · ${field(token, 'start')}–${field(token, 'end')}`;
      pieces.append(piece);
    }
    raw.append(pieces); inspector.append(raw);
    const revisit = node('button', 'Revisit with what it knows now ↗', 'revisit');
    revisit.addEventListener('click', () => act(async () => { const turn = await project.resume(episode.id); notice(`Revisited the original observation: ${turn.status}.`); }, { message: 'Revisiting…' }));
    inspector.append(revisit); article.append(inspector); $('history').append(article);
  }
}
function concepts() {
  const search = $('search').value.toLowerCase(); $('concepts').replaceChildren();
  const label=identity=>values(project.store.parts(identity?.head,'Label')[0]?.expression)[0]??format(identity);
  for(const fact of project.store.records('KnowledgeFact')){
    const heading=label(field(fact.expression,'subject'))+' · '+label(field(fact.expression,'relation'))+': '+field(fact.expression,'display');
    if(!heading.toLowerCase().includes(search))continue;
    const details=node('details',undefined,'record');details.append(node('summary',heading),node('small','Learned from a structured source statement'),node('pre',format(fact.expression)));
    const button=node('button','Withdraw this fact');button.addEventListener('click',()=>act(()=>{const removed=project.store.retract(fact.id);notice('Withdrew the fact and '+(removed.length-1)+' dependent record(s).');}));details.append(button);$('concepts').append(details);
  }
  for(const excerpt of project.store.records('SourceExcerpt')){
    const title=field(excerpt.expression,'title','Source excerpt');if(!title.toLowerCase().includes(search))continue;
    const details=node('details',undefined,'record');details.append(node('summary',title+' · retained excerpt'),node('small',field(excerpt.expression,'license')),node('pre',values(excerpt.expression)[0]));$('concepts').append(details);
  }
  const matching = [...project.store.definitions()].filter(([name, definitions]) => (name + definitions.map(d => d.parts.map(format).join(' ')).join(' ')).toLowerCase().includes(search));
  for (const [name, definitions] of matching.slice(0, 120)) {
    const title=values(project.store.parts(name,'Label')[0]?.expression)[0];
    const details = node('details', undefined, 'record'), summary = node('summary', title ? title+' · '+name+'()' : name + '()');
    summary.append(node('small', definitions.length + (definitions.length === 1 ? ' assertion' : ' assertions'))); details.append(summary);
    for (const definition of definitions) {
      details.append(node('small', definition.source), node('pre', format(project.store.record(definition.id).expression)));
      if (!definition.source.startsWith('pack:')) {
        const button = node('button', 'Withdraw this evidence');
        button.addEventListener('click', () => act(() => { const removed = project.store.retract(definition.id); notice(`Withdrew ${removed.length} dependent record(s). Original observations remain.`); }));
        details.append(button);
      }
    }
    $('concepts').append(details);
  }
  if (!$('concepts').children.length) $('concepts').append(node('p', 'No retained knowledge matches this search.', 'empty'));
  if (matching.length > 120) $('concepts').append(node('p', 'Showing 120 results. Narrow your search to find more.', 'hint'));
}
function refresh() {
  $('conceptCount').textContent = project.store.definitions().size;
  $('lessonCount').textContent = project.store.records('Lesson').filter(r=>!r.source.startsWith('starter:')).length + project.store.records('WorkedExample').length;
  const jobs = project.store.agenda(); $('jobCount').textContent = jobs.length; $('workBadge').textContent = jobs.length;
  $('jobs').replaceChildren();
  for (const job of jobs.slice(0, 100)) {
    const card = node('div', undefined, 'job'); card.append(node('h3', job.query), node('small', job.kind + ' · ' + job.attempts + ' attempt(s)'), node('span', job.status, 'status learning'), node('small', job.detail || 'Waiting for its next investigation.')); $('jobs').append(card);
  }
  if (!jobs.length) $('jobs').append(node('p', 'No open work. New questions may create new learning tasks.', 'empty'));
  history(); concepts(); $('history').scrollTop=$('history').scrollHeight;
}
async function curriculum() {
  const response = await fetch('/examples/world.ncon'); if (!response.ok) throw new Error('Could not load the demo concepts.');
  project.load(await response.text(), { provenance: 'example:curriculum' });
}

for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => tab(button.dataset.tab));
for (const button of document.querySelectorAll('[data-prompt]')) button.addEventListener('click', () => { $('message').value = button.dataset.prompt; $('message').focus(); });
$('search').addEventListener('input', () => project && concepts());
$('online').addEventListener('change', () => { if (project) project.online = $('online').checked; });
$('talkForm').addEventListener('submit', event => {
  event.preventDefault(); const text = $('message').value;
  if (!text.trim()) return;
  if(busy) return;
  const pending=node('article',undefined,'turn'); pending.append(node('div','YOU WROTE','label'),node('div',text,'user-words'),node('div','Investigating…','assistant-words')); $('history').querySelector('.welcome')?.remove(); $('history').append(pending);
  act(async () => { const turn = await project.turn(text); $('message').value = ''; notice(turn.status === 'resolved' ? 'Answer and supporting evidence retained.' : turn.status === 'ambiguous' ? 'Several readings remain.' : 'The investigation is retained, including what was tried.'); }, { message: $('online').checked ? 'Understanding and researching your question…' : 'Interpreting with retained knowledge…' });
});
$('outcomeForm').addEventListener('submit',event=>{
  event.preventDefault(); act(async()=>{
    if($('outcomeValue').value==='') throw new Error('Enter the observed result.');
    const result=await project.teachOutcomes([{input:$('outcomeText').value,output:Number($('outcomeValue').value)}]);
    $('lessonResult').hidden=false;
    $('lessonResult').replaceChildren(node('p',result.learned.length ? 'Learned a procedure that fits the retained evidence.' : result.pending.map(p=>p.reason).join('. ') || 'Evidence retained; more examples are needed.'),...result.learned.map(p=>node('pre',format(p.declaration))));
    // Revisit without fetching or inventing more observations.
    for(const episode of project.store.records('Episode').slice(-10)) await project.resume(episode.id,{learn:false});
    notice('Saved the example and revisited earlier questions.');
  },{message:'Testing candidate procedures against the evidence…'});
});
$('pageForm').addEventListener('submit',event=>{
  event.preventDefault(); act(async()=>{
    const page=await project.readPage($('pageUrl').value);
    notice('Fetched and retained source evidence. It is available for inspection; prose remains data.');
    $('pageResult').hidden=false; $('pageResult').replaceChildren(node('pre',values(page.expression)[0].slice(0,6000)));
  },{message:'Fetching the source…'});
});
$('codeForm').addEventListener('submit',event=>{
  event.preventDefault(); act(async()=>{
    const language=$('codeLanguage').value;
    const result=await project.teachCode({input:$('codeInput').value,meaning:parse($('codeMeaning').value),pattern:parse($('codePattern').value),language,...(language==='javascript'?{code:$('codeBody').value}:{body:parse($('codeBody').value)})});
    $('lessonResult').hidden=false; $('lessonResult').replaceChildren(node('p','Learned language and an executable realization from the supplied code example.'),node('pre',format(result.declaration)));
    notice('Realization retained with its code example and lesson as evidence.');
  },{message:'Validating code and learning the phrase’s parameter slots…'});
});
$('exampleForm').addEventListener('submit', event => {
  event.preventDefault(); act(async () => {
    const lesson = await project.teachExample($('exampleText').value, parse($('meaning').value),{textSlots:$('textSlots').checked,weight:$('textSlots').checked?3:0});
    $('lessonResult').hidden = false; $('lessonResult').replaceChildren(node('div', 'LEARNED CONSTRUCTION', 'label'), node('pre', format(lesson.declaration)));
    notice('Learned a reusable construction. Try the same phrase with different arguments.');
  }, { message: 'Aligning evidence and learning reusable slots…' });
});
$('conceptForm').addEventListener('submit', event => { event.preventDefault(); act(() => { const ids = project.load($('conceptText').value); notice(`Saved ${ids.length} concept assertion(s). Revisit earlier phrases to use them.`); }); });
$('curriculum').addEventListener('click', () => act(async () => { await curriculum(); notice('Demo concepts loaded. Greg, Emmy, Book, and Cookie are now known.'); }));
$('demo').addEventListener('click', () => act(async () => {
  await curriculum();
  await project.teachExample('Greg returns the book', parse('Returning(actor=Greg(), object=Book())'));
  await project.turn('Emmy returns the cookie', { learn: false });
  tab('talk'); notice('Learned “Greg returns the book”, then understood a different person and object. Inspect the reading below.');
  $('message').value = 'Greg returns the book to';
}, { message: 'Teaching an example, then testing what transfers…' }));
$('exist').addEventListener('click', () => act(async () => {
  const work = await project.exist({ budget: 2 }); $('workResult').hidden = false;
  $('workResult').replaceChildren(node('pre', `${work.attempts.length} investigations · ${work.revisions.length} revisited observations\n\n` + work.attempts.map(j => j.query + ': ' + j.status + '\n' + j.detail).join('\n\n')));
  notice('Completed a bounded learning cycle. New readings are in your notebook.');
}, { message: 'Investigating and revisiting unresolved observations…' }));
$('backup').addEventListener('click', () => { if (!project || busy) return; download(project.store.snapshot(), 'napkin-next-knowledge.sqlite', 'application/vnd.sqlite3'); notice('Backup downloaded. It contains knowledge, observations, feedback, and pending work.'); });
$('restore').addEventListener('click', () => $('restoreFile').click());
$('restoreFile').addEventListener('change', event => {
  const file = event.target.files[0]; if (!file) return;
  act(async () => {
    if (file.size > 64000000) throw new Error('Backup exceeds the 64 MB restore limit.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!new TextDecoder().decode(bytes.slice(0, 16)).startsWith('SQLite format 3')) throw new Error('Choose a Napkin SQLite backup.');
    const store = new BrowserStore(SQL, bytes); let replacement;
    try {
      if (store.db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') throw new Error('Backup integrity check failed.');
      replacement = new ProjectCore({ store, bundle, profile: 'keal', online: $('online').checked, fetcher:researchFetch, sourceBaseUrl:location.origin, sourceURLHeader:true });
    } catch (error) { try { store.close(); } catch {} throw error; }
    // Save the replacement before replacing the currently usable notebook.
    try { await vault.write(replacement.store.snapshot()); } catch (error) { replacement.close(); throw error; }
    project.close(); project = replacement; notice('Backup restored. This browser now uses the restored notebook.');
  }, { message: 'Checking and restoring your notebook…' });
  event.target.value = '';
});

async function initialize() {
  try {
    if (!globalThis.initSqlJs) throw new Error('The SQLite engine could not load. Reload to try again.');
    [SQL, vault] = await Promise.all([globalThis.initSqlJs({ locateFile: name => '/vendor/' + name }), openVault()]);
    const response = await fetch('/packs/manifest.json'); if (!response.ok) throw new Error('Missing runtime manifest.');
    const manifest = await response.json(), packs = {};
    await Promise.all(manifest.packs.map(async name => { const response = await fetch('/packs/' + name); if (!response.ok) throw new Error('Missing runtime pack: ' + name); packs[name] = await response.text(); }));
    bundle = { manifest, packs };
    project = new ProjectCore({ store: new BrowserStore(SQL, await vault.read()), bundle, online: $('online').checked, profile: 'keal', fetcher:researchFetch, sourceBaseUrl:location.origin, sourceURLHeader:true });
    await project.prepare();
    await vault.write(project.store.snapshot()); controls(false); refresh(); $('saved').textContent = 'Saved in this browser';
    const prior=project.store.records('Episode').filter(r=>field(r.expression,'profile')==='keal').sort((a,b)=>field(b.expression,'sequence',0)-field(a.expression,'sequence',0)).slice(0,1);
    for(const episode of prior){
      const reply=project.store.records('Reply').filter(r=>field(r.expression,'episode')===episode.id).sort((a,b)=>field(b.expression,'sequence',0)-field(a.expression,'sequence',0))[0];
      const reading=project.store.records('Reading').filter(r=>field(r.expression,'episode')===episode.id).sort((a,b)=>field(b.expression,'sequence',0)-field(a.expression,'sequence',0))[0];
      if(values(reading?.expression)[0]?.head!=='Resolved'||field(values(reply?.expression)[0],'pending',false)){
        await act(()=>project.resume(episode.id,{learn:false}),{message:'Revisiting your last question with what I can now learn…'});
      }
    }
  } catch (error) { notice(error.message, true); $('saved').textContent = 'Could not open notebook'; controls(true); }
}
if (navigator.locks) {
  navigator.locks.request('napkin-next-notebook', { ifAvailable: true }, async lock => {
    if (!lock) { notice('Your notebook is already open in another tab. Close that tab, then reload here.', true); controls(true); return; }
    await initialize(); await new Promise(resolve => window.addEventListener('pagehide', resolve, { once: true }));
  }).catch(error => notice(error.message, true));
} else initialize();
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
