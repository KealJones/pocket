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
