import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { indexedDB } from 'fake-indexeddb';
import initSQL from 'sql.js';
import { openVault, BrowserStore } from '../web/store.mjs';
import { ProjectCore } from '../src/project-core.mjs';

test('workbench controls teach real concepts and retain exact pieces, rewards, and learning', async () => {
  const dom = new JSDOM(readFileSync(new URL('../web/index.html', import.meta.url), 'utf8'), { url: 'https://workbench.test/' });
  const previous = Object.getOwnPropertyDescriptors(globalThis), window = dom.window;
  const changed = ['window','document','navigator','location','indexedDB','initSqlJs','fetch'];
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, location: window.location, indexedDB, initSqlJs: () => initSQL(),
    fetch: async (url,options) => { const path = new URL(url, window.location.href).pathname; if(path==='/api/fetch') {
      const remote=new URL(JSON.parse(options.body).url),p=remote.searchParams,headers={'x-napkin-source-url':remote.href};
      if(remote.hostname==='www.wikidata.org'){
        if(p.get('action')==='wbsearchentities')return Response.json({search:p.get('type')==='property'?[{id:'P36',label:'capital',match:{text:'capital'}}]:[{id:'Q782',label:'Hawaii',match:{text:'HI'}}]},{headers});
        const entities={P36:{id:'P36',lastrevid:1,labels:{en:{value:'capital'}},claims:{}},Q782:{id:'Q782',lastrevid:1,labels:{en:{value:'Hawaii'}},aliases:{en:[{value:'HI'}]},claims:{P36:[{id:'claim',rank:'normal',mainsnak:{snaktype:'value',datavalue:{type:'wikibase-entityid',value:{id:'Q18094'}}}}]}},Q18094:{id:'Q18094',lastrevid:1,labels:{en:{value:'Honolulu'}},claims:{}}};
        return Response.json({entities:Object.fromEntries(p.get('ids').split('|').map(id=>[id,entities[id]]))},{headers});
      }
      return new Response('page content',{headers});
    } const text = readFileSync(new URL('..' + path, import.meta.url), 'utf8'); return new Response(text); }
  })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const $ = id => window.document.getElementById(id);
  async function settled() {
    for (let i = 0; i < 300; i++) { if (!$('demo').disabled) return; await new Promise(resolve => setTimeout(resolve, 10)); }
    throw new Error('Workbench did not become ready: ' + $('notice').textContent);
  }
  function submit(id) { $(id).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); }
  try {
    await import('../web/app.mjs'); await settled();
    assert.equal($('teacher').checked,true);
    $('teacher').checked=false;$('teacher').dispatchEvent(new window.Event('change'));
    assert.equal(window.localStorage.getItem('pocket-teacher'),'false');
    $('demo').click(); await settled();
    assert.ok($('history').textContent.includes('Returning(actor=Emmy(), object=Cookie())'));
    assert.equal($('lessonCount').textContent, '1');
    assert.deepEqual([...$('history').querySelectorAll('.token-list span')].map(x => x.textContent), ['Emmy',' ','returns',' ','the',' ','cookie']);
    $('history').querySelector('.reward input').value = '5';
    $('history').querySelector('.reward button').click(); await settled();
    assert.match($('notice').textContent, /Prediction error 3.00. New expectation 5.60/);
    $('online').checked = false; $('online').dispatchEvent(new window.Event('change'));
    $('message').value = 'blorple'; submit('talkForm'); await settled();
    assert.ok($('history').textContent.includes('blorple'));
    $('conceptText').value = 'Concept(Blorple(),Surface("blorple"))'; submit('conceptForm'); await settled();
    [...$('history').querySelectorAll('.revisit')].at(-1).click(); await settled();
    assert.ok($('history').textContent.includes('Blorple()'));
    for(const [input,output]of [['what is 2 plus 3?',5],['what is 7 plus 4?',11]]) { $('outcomeText').value=input;$('outcomeValue').value=output;submit('outcomeForm');await settled(); }
    $('message').value='what is 2 plus 2?';submit('talkForm');await settled();
    assert.equal([...$('history').querySelectorAll('.assistant-words')].at(-1).textContent,'4');
    submit('codeForm');await settled();
    $('message').value='retrieve https://example.net';submit('talkForm');await settled();
    assert.equal([...$('history').querySelectorAll('.assistant-words')].at(-1).textContent,'page content');
    $('message').value='what is 5*4?';submit('talkForm');await settled();
    assert.equal([...$('history').querySelectorAll('.assistant-words')].at(-1).textContent,'20');
    assert.match([...$('history').querySelectorAll('.inspector')].at(-1).textContent,/Learning during this request/);
    $('online').checked=true;$('online').dispatchEvent(new window.Event('change'));
    $('message').value='What is the capital of hi?';submit('talkForm');await settled();
    assert.match([...$('history').querySelectorAll('.assistant-words')].at(-1).textContent,/Hawaii · capital: Honolulu/);
    assert.ok([...$('history').querySelectorAll('.citation')].some(a=>a.href==='https://www.wikidata.org/wiki/Q782'));
    assert.match($('concepts').textContent,/Hawaii · capital: Honolulu/);
    $('online').checked=false;$('online').dispatchEvent(new window.Event('change'));
    $('message').value='what is VI*3?';submit('talkForm');await settled();
    assert.equal([...$('history').querySelectorAll('.assistant-words')].at(-1).textContent,'18');
    $('conceptText').value='Concept(LetterNotation(),Surface("letter notation"),ContextHint(Encoding(LetterNotation()))) Concept(LetterValue(),IsA(ComputableExpression()),ReadForm(LetterValue($text),primitive="number",recognizes="^[a-z]{2}$",context=Context(Encoding(LetterNotation()))),ImplementationLesson(LetterValue($text),body=If(Native("value.equal",$text,"ab"),7,If(Native("value.equal",$text,"cd"),9,Quote(NoReading()))),checks=List(Check(LetterValue("ab"),7),Check(LetterValue("cd"),9),Check(LetterValue("zz"),NoReading()))))';submit('conceptForm');await settled();
    $('message').value='what is ab*3?';submit('talkForm');await settled();
    $('message').value='letter notation';submit('talkForm');await settled();
    assert.equal([...$('history').querySelectorAll('.assistant-words')].at(-1).textContent,'21');
    assert.match([...$('history').querySelectorAll('.turn')].at(-1).textContent,/For your earlier question: what is ab\*3\?/);
    const SQL = await initSQL(), vault = await openVault(indexedDB), bytes = await vault.read();
    const manifest = JSON.parse(readFileSync(new URL('../packs/manifest.json', import.meta.url), 'utf8'));
    const bundle = { manifest, packs: Object.fromEntries(manifest.packs.map(name => [name, readFileSync(new URL('../packs/' + name, import.meta.url), 'utf8')])) };
    const restored = new ProjectCore({ store: new BrowserStore(SQL, bytes), bundle, online: false, profile: 'keal' });
    try {
      assert.equal((await restored.turn('Emmy returns the cookie')).status, 'resolved');
      assert.equal(restored.store.records('Feedback').length, 1);
      assert.equal((await restored.turn('blorple')).spoken, 'Blorple()');
      assert.equal((await restored.turn('what is 2 plus 2?')).reply.args.find(a=>a.name==='answer').value,4);
      assert.equal((await restored.turn('what is 3*3?')).reply.args.find(a=>a.name==='answer').value,9);
      assert.equal((await restored.turn('what is XIV*2?')).reply.args.find(a=>a.name==='answer').value,28);
      assert.equal((await restored.turn('what is the capital of HI?')).reply.args.find(a=>a.name==='answer').value,'Honolulu');
    } finally { restored.close(); }
  } finally {
    dom.window.close();
    for (const key of changed) { if (previous[key]) Object.defineProperty(globalThis, key, previous[key]); else delete globalThis[key]; }
  }
});
