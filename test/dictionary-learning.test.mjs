import test from 'node:test';import assert from 'node:assert/strict';
import initSQL from 'sql.js';import {readFileSync} from 'node:fs';
import {Project} from '../src/project.mjs';import {ProjectCore} from '../src/project-core.mjs';import {BrowserStore} from '../web/store.mjs';
import {call,term,field,values,format} from '../src/ncon.mjs';
import {dictionaryPassages,lexicalRoutes,readDictionary} from '../src/dictionary.mjs';

const lesson=`Concept(Greet(),IsA(ComputableExpression()),Surface("greet"),
 Frame(pattern=List(Lexeme(Greet()),Slot($person,kind=Person())),meaning=Greet($person)),
 ImplementationLesson(Greet($person),language="ncon",body=Native("text.concat","Hello, ",Native("term.format",Quote($person))),checks=List(Check(Greet(Greg()),"Hello, Greg()"),Check(Greet(Emmy()),"Hello, Emmy()"))))
Concept(Greg(),IsA(Person()),Surface("Greg")) Concept(Emmy(),IsA(Person()),Surface("Emmy"))`;
const documents={
 florp:'==French==\n===Verb===\n# {{synonym of|fr|danger}}\n==English==\n===Verb===\n# {{lb|en|colloquial}} {{synonym of|en|salute}}\n#: {{ux|en|florp Greg}}\n===Noun===\n# A musical instrument.\n',
 salute:'==English==\n===Verb===\n# To [[greet]].\n',
 other:'==English==\n===Verb===\n# {{synonym of|en|greet}}\n# {{synonym of|en|Dismiss}}\n',
 danger:'==English==\n===Verb===\n# {{synonym of|en|greet}} not\n',
 inflected:'==English==\n===Verb===\n# {{inflection of|en|greet||past}}\n',
 strange:'==English==\n===Verb===\n# {{unknown|en|greet}}\n# To not [[greet]].\n',
};
function fixture(){const calls=[];return {calls,fetcher:async url=>{
 const u=new URL(url);calls.push(u);
 if(u.searchParams.get('action')==='wbsearchentities')return Response.json({search:[]});
 if(u.hostname==='datasets-server.huggingface.co')return Response.json({rows:[]});
 const title=u.searchParams.get('titles'),raw=documents[title];
 return Response.json({query:{pages:raw?[{title,revisions:[{revid:1,user:'SourceEditor',slots:{main:{content:raw}}}]}]:[]}});
}};}
function doc(p,text,title='test'){return p.store.put(call('SourceDocument',[text],{title,reader:'wiktionary',provider:term('WiktionarySource'),revision:1,url:'https://example.org/wiki/'+title,license:'CC-BY-SA-4.0'}),{source:'test:dictionary'});}

test('one independent request follows unfamiliar definitions, composes roles and learns checked execution',async()=>{
 const f=fixture(),p=new Project({fetcher:f.fetcher,profile:'keal'});try{
 p.load(lesson);const turn=await p.turn('florp Greg');
 assert.equal(field(turn.reply,'text'),'Hello, Greg()');assert.equal(turn.input.source,'florp Greg');
 assert.equal(p.modelLearner,null);assert.equal(p.store.records('DictionarySense').length,3);
 assert.ok(f.calls.some(u=>u.searchParams.get('titles')==='salute'));
 assert.ok(p.store.records('DictionaryExample').length);assert.ok(turn.attempts.some(s=>s.kind==='realization'));
 const calls=f.calls.length;p.online=false;assert.equal(field((await p.turn('florp Emmy')).reply,'text'),'Hello, Emmy()');assert.equal(f.calls.length,calls);
 const observation=p.store.records('DictionarySense').find(r=>values(r.expression)[0].includes('synonym of'));
 assert.ok(p.store.record(observation.id).active);const document=p.store.record(field(observation.expression,'document'));
 assert.equal(values(document.expression)[0].slice(field(observation.expression,'start'),field(observation.expression,'end')),values(observation.expression)[0]);
 const removed=p.store.retract(document.id);assert.ok(removed.includes(turn.replyId));assert.equal(p.store.record(turn.episodeId).active,true);
 assert.notEqual((await p.turn('florp Emmy',{learn:false})).status,'resolved');
 }finally{p.close();}
});

test('source-local sense alternatives remain ambiguous and cannot erase negation or inflection',async()=>{
 const p=new Project({online:false});try{p.load(lesson+'\nConcept(Dismiss(),Surface("Dismiss"))');
 for(const title of ['other','strange','inflected','danger'])readDictionary(p,doc(p,documents[title],title));
 assert.equal((await p.turn('other',{learn:false})).status,'ambiguous');
 assert.ok((await p.analyze((await import('../src/ears.mjs')).capture('other'))).candidates.some(c=>c.meaning.head==='Greet'));
 assert.equal((await p.turn('strange Greg',{learn:false})).status,'learning');
 assert.equal((await p.turn('inflected Greg',{learn:false})).status,'learning');
 assert.equal((await p.turn('danger Greg',{learn:false})).status,'learning');
 assert.equal(p.store.parts('Greet','Realization').length,0);
 assert.equal(p.store.surfaces('other').length,2);
 }finally{p.close();}
});

test('markup boundaries retain unknown templates, language scope, sense spans, and exact examples',()=>{
 const raw='==English==\n===Verb===\n# {{lb|en|transitive}} To [[greet]].\n#: {{ux|en|hello {{m|en|Greg}}}}\n# {{unknown|en|greet}}\n==French==\n===Verb===\n# [[bad]]\n';
 const passages=dictionaryPassages(raw,{section:'English',language:'en',meaningSections:['Verb']});
 assert.equal(passages.length,2);assert.equal(passages[0].gloss,'To greet.');assert.equal(passages[0].complete,true);assert.deepEqual(passages[0].labels,['transitive']);
 assert.equal(passages[1].complete,false);assert.equal(raw.slice(passages[0].start,passages[0].end),passages[0].raw);assert.ok(passages[0].examples[0].raw.includes('hello'));
 assert.equal(dictionaryPassages(raw,{section:'English',language:'en',meaningSections:['Verb'],maximumSenses:1}).length,1);
});

test('source revisions retract routes and dependency cycles remain bounded',async()=>{
 const p=new Project({online:false});try{
 p.load(lesson);const a=doc(p,'==English==\n===Verb===\n# {{synonym of|en|loopb}}\n','loopa'),b=doc(p,'==English==\n===Verb===\n# {{synonym of|en|loopa}}\n','loopb');readDictionary(p,a);readDictionary(p,b);
 const route=lexicalRoutes(p.store,p.store.surfaces('loopa')[0].target,'');assert.equal(route.routes.length,0);
 assert.equal((await p.turn('loopa Greg',{learn:false})).status,'learning');
 const id=doc(p,documents.salute,'salute');readDictionary(p,id);
 const turn=await p.turn('salute Greg');assert.equal(field(turn.reply,'text'),'Hello, Greg()');
 p.store.retract(id);assert.equal(p.store.record(turn.replyId).active,false);
 }finally{p.close();}
});

test('dictionary knowledge and learned execution transfer through actual browser SQLite without sources or Gemini',async()=>{
 const f=fixture(),SQL=await initSQL(),manifest=JSON.parse(readFileSync(new URL('../packs/manifest.json',import.meta.url))),bundle={manifest,packs:Object.fromEntries(manifest.packs.map(name=>[name,readFileSync(new URL('../packs/'+name,import.meta.url),'utf8')]))};
 let p=new ProjectCore({store:new BrowserStore(SQL),bundle,fetcher:f.fetcher,profile:'keal'});try{
 p.load(lesson);assert.equal(field((await p.turn('florp Greg')).reply,'text'),'Hello, Greg()');const snapshot=p.store.snapshot();p.close();
 p=new ProjectCore({store:new BrowserStore(SQL,snapshot),bundle,online:false,profile:'keal',fetcher:()=>{throw Error('No network expected');}});
 assert.equal(field((await p.turn('florp Emmy')).reply,'text'),'Hello, Emmy()');
 assert.equal(p.modelLearner,null);assert.equal(p.store.records('DictionarySense').length,3);
 }finally{p.close();}
});

test('new dictionary revisions replace old claims and a configured traversal limit leaves the reading open',async()=>{
 const p=new Project({online:false});try{
 p.load(lesson);const first=doc(p,documents.salute,'salute');readDictionary(p,first);
 const turn=await p.turn('salute Greg');assert.equal(field(turn.reply,'text'),'Hello, Greg()');
 const next=p.store.put(call('SourceDocument',['==English==\n===Noun===\n# A musical instrument.\n'],{title:'salute',reader:'wiktionary',provider:term('WiktionarySource'),revision:2,url:'https://example.org/wiki/salute',license:'CC-BY-SA-4.0'}),{source:'test:dictionary'});
 readDictionary(p,next);assert.equal(p.store.record(first).active,false);assert.equal(p.store.record(turn.replyId).active,false);assert.equal(p.store.record(turn.episodeId).active,true);
 const other=doc(p,'==English==\n===Verb===\n# {{synonym of|en|greet}}\n','florp');readDictionary(p,other);
 p.load('Concept(DictionaryLearningPolicy(),Revision(1),MaximumRouteInspections(0))');
 const result=await p.turn('florp Greg',{learn:false});assert.equal(result.status,'learning');assert.equal((await p.analyze((await import('../src/ears.mjs')).capture('florp Greg'))).exhausted,true);
 }finally{p.close();}
});

test('dictionary policy and generated equivalence observations cannot be installed by untrusted bytes',()=>{
 const p=new Project({online:false});try{
 for(const name of ['TemplateMapping','DefinitionParaphrase','LexicalEquivalent','DictionarySense','MaximumRouteInspections','DocumentReader'])assert.throws(()=>p.load(`Concept(Evil(),${name}("greet"))`,{trusted:false}),/Evidence cannot install/);
 }finally{p.close();}
});

test('conversational definitions use the same learner, fetch missing references in that request, and transfer',async()=>{
 const f=fixture(),p=new Project({fetcher:f.fetcher,profile:'keal'});try{
 p.load(lesson);const definition=await p.turn('florp means salute');assert.equal(definition.status,'resolved');assert.match(field(definition.reply,'text'),/retained your definition/);
 assert.ok(f.calls.some(u=>u.searchParams.get('titles')==='salute'));assert.equal(p.store.records('LexicalDefinition').length,1);
 const user=p.store.records('LexicalDefinition')[0];assert.equal(field(user.expression,'episode'),definition.episodeId);
 const calls=f.calls.length;p.online=false;const turn=await p.turn('florp Emmy');assert.equal(field(turn.reply,'text'),'Hello, Emmy()');assert.equal(f.calls.length,calls);
 assert.notEqual((await p.turn('florp Greg',{profile:'someoneelse',learn:false})).status,'resolved');
 p.store.retract(user.id);assert.equal(p.store.record(turn.replyId).active,false);assert.equal(p.store.record(definition.episodeId).active,true);
 assert.equal(field((await p.resume(definition.episodeId,{learn:false})).reply,'pending'),true);assert.equal(p.store.records('LexicalDefinition').length,0);
 // A new explicit statement may reteach withdrawn knowledge; replay may not.
 const again=await p.turn('florp means salute');assert.equal(again.status,'resolved');assert.equal(field((await p.turn('florp Greg')).reply,'text'),'Hello, Greg()');
 }finally{p.close();}
});

test('unknown conversational definitions retain claims and missing reference work even offline',async()=>{
 const p=new Project({online:false,profile:'keal'});try{
 const turn=await p.turn('florp means unknownbleep');assert.equal(field(turn.reply,'pending'),true);assert.equal(turn.status,'learning');
 assert.equal(p.store.records('LexicalDefinition').length,1);assert.ok(p.store.agenda().some(j=>j.kind==='lexical'&&j.query==='unknownbleep'));
 assert.equal((await p.turn('florp',{learn:false})).status,'learning');
 p.load('Concept(Reference(),Surface("unknownbleep"),Denotes(Greeting()))');assert.equal((await p.turn('florp',{learn:false})).status,'resolved');
 assert.equal(p.modelLearner,null);
 }finally{p.close();}
});

test('a taught phrase composes with focused time formatting and persists across browser reopen',async()=>{
 const SQL=await initSQL(),manifest=JSON.parse(readFileSync(new URL('../packs/manifest.json',import.meta.url))),bundle={manifest,packs:Object.fromEntries(manifest.packs.map(name=>[name,readFileSync(new URL('../packs/'+name,import.meta.url),'utf8')]))};
 const options={bundle,profile:'keal',online:false,clock:()=>new Date('2026-10-10T16:39:00Z'),timeZone:'UTC'};
 let p=new ProjectCore({...options,store:new BrowserStore(SQL)});try{
 assert.equal(field((await p.turn('what time is it')).reply,'answer'),'04:39 PM');
 assert.equal((await p.turn('army clock means military time')).status,'resolved');
 // Recording the definition did not run its meaning or change the focused clock.
 assert.equal(field((await p.turn('what time is it')).reply,'answer'),'04:39 PM');
 assert.equal(field((await p.turn('in army clock')).reply,'answer'),'16:39');
 const bytes=p.store.snapshot();p.close();p=new ProjectCore({...options,store:new BrowserStore(SQL,bytes)});
 assert.equal(field((await p.turn('army clock')).reply,'answer'),'16:39');assert.equal(p.modelLearner,null);
 }finally{p.close();}
});

test('conflicting personal definitions keep competing senses and protected code remains inert',async()=>{
 const p=new Project({online:false,profile:'keal'});try{
 await p.turn('florp means hello');await p.turn('florp means thanks');assert.equal((await p.turn('florp',{learn:false})).status,'ambiguous');
 const before=p.store.records('LexicalDefinition').length;await p.turn('florp means `Native("number.add",5,2)`',{learn:false});assert.equal(p.store.records('LexicalDefinition').length,before);
 assert.equal((await p.turn('`florp`',{learn:false})).status,'learning');
 }finally{p.close();}
});

test('source prose definitions use the shared reader, retain unrelated learning, and never execute it',async()=>{
 let fetched=0;const p=new Project({online:false,profile:'keal',fetcher:()=>{fetched++;throw Error('Source meaning must not fetch');}});try{
 p.load(lesson);const text='florp means greet. glorp means hello. Opaque unrelated vocabulary.';
 const document=p.store.put(call('SourceExcerpt',[text],{url:'https://example.org/definitions',license:'CC0-1.0'}));
 await p.learner.readEvidence(document);assert.equal(p.store.records('LexicalDefinition').length,2);assert.equal(fetched,0);assert.equal(p.store.parts('Greet','Realization').length,0);
 assert.equal((await p.turn('glorp',{learn:false})).status,'resolved');assert.equal(field((await p.turn('florp Emmy',{learn:false})).reply,'text'),'Hello, Emmy()');
 const definitions=p.store.records('LexicalDefinition');assert.ok(definitions.every(r=>field(r.expression,'attribution')));
 const turn=await p.turn('florp Greg',{learn:false});p.store.retract(document);assert.equal(p.store.record(turn.replyId).active,false);
 assert.equal(p.store.record(turn.episodeId).active,true);
 }finally{p.close();}
});

test('source assertion withdrawal stays withdrawn on review and a missing reference queues the same lexical work',async()=>{
 const p=new Project({online:false,profile:'keal'});try{
 const document=p.store.put(call('SourceExcerpt',['florp means unknownbleep.'],{url:'https://example.org/definition'}));await p.learner.readEvidence(document);
 assert.ok(p.store.agenda().some(j=>j.query==='unknownbleep'&&j.kind==='lexical'));
 const definition=p.store.records('LexicalDefinition')[0];assert.ok(definition);p.store.retract(definition.id);
 await p.learner.readEvidence(document);assert.equal(p.store.records('LexicalDefinition').length,0);
 for(const text of ['Do not florp means hello.','`florp means hello`']){
 const id=p.store.put(call('SourceExcerpt',[text]));await p.learner.readEvidence(id);
 }
 assert.equal(p.store.records('LexicalDefinition').length,0);
 assert.throws(()=>p.load('Concept(Evil(),LearningAssertion("lexical-reference"))',{trusted:false}),/Evidence cannot install/);
 }finally{p.close();}
});

function excerptSource(){const calls=[];return {calls,fetcher:async url=>{
 const u=new URL(url);calls.push(u);const q=u.searchParams;
 if(q.get('action')==='wbsearchentities')return Response.json({search:[]});
 if(q.get('action')==='wbgetentities')return Response.json({entities:{}});
 if(u.hostname==='datasets-server.huggingface.co')return Response.json({rows:[]});
 if(q.get('list')==='search')return Response.json({query:{search:[{title:'Example lexicon'}]}});
 if(q.get('prop')?.includes('extracts'))return Response.json({query:{pages:[{title:'Example lexicon',extract:'florp means greet.',fullurl:'https://en.wikipedia.org/wiki/Example_lexicon',revisions:[{revid:7}],pageprops:{}}]}});
 return Response.json({query:{pages:[]}});
}};}

test('new language in a retrieved excerpt reinterprets the original request, checks execution, and answers in that request',async()=>{
 const f=excerptSource(),p=new Project({profile:'keal',fetcher:f.fetcher});try{
 p.load(lesson);const turn=await p.turn('what is florp Greg?');assert.equal(field(turn.reply,'text'),'Hello, Greg()');assert.equal(turn.status,'resolved');
 assert.equal(turn.input.source,'what is florp Greg?');assert.equal(p.store.records('Episode').length,1);
 assert.equal(p.store.records('LexicalDefinition').length,1);assert.equal(p.store.records('SourceExcerpt').length,1);
 assert.ok(p.store.traces({episode:turn.episodeId,limit:1000}).some(t=>t.kind==='request.retry'&&t.detail.reason.includes('Source learning')));
 assert.equal(p.modelLearner,null);const calls=f.calls.length;p.online=false;
 assert.equal(field((await p.turn('what is florp Emmy?')).reply,'text'),'Hello, Emmy()');assert.equal(f.calls.length,calls);
 }finally{p.close();}
});

test('lowercase passage boundaries preserve protected quotes, fenced code, URLs and decimal tokens',async()=>{
 const p=new Project({online:false,profile:'keal'});try{
 const text='florp means hello. glorp means thanks. ```hidden means hello. otherhidden means thanks.``` “quoted means hello. anotherquoted means thanks.” number means 5.4.';
 const document=p.store.put(call('SourceExcerpt',[text]));await p.learner.readEvidence(document);
 assert.deepEqual(p.store.records('LexicalDefinition').map(r=>values(r.expression)[0]).sort(),['florp','glorp']);
 for(const observation of p.store.records('EvidenceObservation')){const raw=values(values(observation.expression)[0])[0];assert.equal(text.slice(field(observation.expression,'start'),field(observation.expression,'end')),raw);assert.notEqual(raw.trim(),'4.');}
 assert.equal(p.store.surfaces('hidden','keal').length,0);assert.equal(p.store.surfaces('quoted','keal').length,0);
 }finally{p.close();}
});

test('source reinterpretation obeys its authored bound and leaves reusable learning when disabled',async()=>{
 const f=excerptSource(),p=new Project({profile:'keal',fetcher:f.fetcher});try{
 p.load(lesson);p.load('Concept(RequestLearningPolicy(),Revision(1),MaximumReinterpretations(0))');
 const first=await p.turn('what is florp Greg?');assert.equal(field(first.reply,'research'),'excerpt');assert.equal(p.store.records('LexicalDefinition').length,1);
 p.online=false;assert.equal(field((await p.turn('what is florp Emmy?')).reply,'text'),'Hello, Emmy()');
 }finally{p.close();}
});

test('negation scopes over definitions and protected actions instead of becoming a positive named form',async()=>{
 let fetched=0;const p=new Project({online:false,profile:'keal',fetcher:()=>{fetched++;throw Error('Negation must not execute');}});try{
 p.load(lesson);for(const text of ['do not florp means greet','not florp means greet','never florp means greet']){
 const id=p.store.put(call('SourceExcerpt',[text]));await p.learner.readEvidence(id);
 }
 assert.equal(p.store.records('LexicalDefinition').length,0);
 const turn=await p.turn('do not fetch https://example.org');assert.match(format(turn.result),/Negated/);assert.equal(fetched,0);
 assert.equal(p.store.surfaces('florp','keal').length,0);
 }finally{p.close();}
});
