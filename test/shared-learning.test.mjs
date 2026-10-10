import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import initSQL from 'sql.js';
import {Project} from '../src/project.mjs';import {ProjectCore} from '../src/project-core.mjs';import {BrowserStore} from '../web/store.mjs';
import {field,format,values,parse} from '../src/ncon.mjs';
function sources(){
 const calls=[];const entities={
 Q40276:{id:'Q40276',lastrevid:1,labels:{en:{value:'multiplication'}},aliases:{en:[{value:'times'}]},claims:{}},
 Q201:{id:'Q201',lastrevid:1,labels:{en:{value:'3'}},aliases:{en:[{value:'three'}]},claims:{P1181:[{rank:'normal',mainsnak:{snaktype:'value',datavalue:{value:{amount:'+3',unit:'1'}}}}]}},
 Q900:{id:'Q900',lastrevid:1,labels:{en:{value:'The Times'}},aliases:{en:[{value:'times'}]},claims:{}},
 Q901:{id:'Q901',lastrevid:1,labels:{en:{value:'Three'}},claims:{}},
 Q999:{id:'Q999',lastrevid:1,labels:{en:{value:'salute'}},claims:{}}};
 const fetcher=async url=>{const u=new URL(url);calls.push(u);if(u.hostname==='datasets-server.huggingface.co')return Response.json({rows:[]});
 if(u.searchParams.get('action')==='wbsearchentities'){const q=u.searchParams.get('search');return Response.json({search:(q==='times'?['Q900','Q40276']:q==='three'?['Q201','Q901']:q==='salute'?['Q999']:[]).map(id=>({id,label:entities[id].labels.en.value}))});}
 if(u.searchParams.get('action')==='wbgetentities')return Response.json({entities:Object.fromEntries(u.searchParams.get('ids').split('|').map(id=>[id,entities[id]]))});
 return Response.json({query:{pages:[]}});};return {calls,fetcher};
}
const custom=`Concept(Greg(),Surface("Greg"),IsA(Person()))
Concept(Emmy(),Surface("Emmy"),IsA(Person()))
Concept(Salutation(),IsA(ComputableExpression()),SenseIdentity("Q999",source=WikidataSource()),
 Frame(pattern=List(Lexeme(Salutation()),Slot($person,kind=Person())),meaning=Salutation($person)),
 ImplementationLesson(Salutation($person),body=Native("text.concat","Hello, ",Native("term.format",Quote($person))),
 checks=List(Check(Salutation(Greg()),"Hello, Greg()"),Check(Salutation(Emmy()),"Hello, Emmy()"))))`;
test('one request acquires competing senses, fills roles, learns an implementation, and executes it',async()=>{
 const fixture=sources(),p=new Project({fetcher:fixture.fetcher});try{
 assert.equal(p.store.parts('ScalarProduct','Realization').length,0);assert.equal(p.store.surfaces('times').length,0);assert.equal(p.store.surfaces('three').length,0);
 const turn=await p.turn('what is 5 times three?');assert.equal(field(turn.reply,'answer'),15);assert.equal(turn.input.source,'what is 5 times three?');assert.match(format(turn.result),/ScalarProduct\(5, 3\)/);
 assert.ok(p.store.records('SourceEntity').length>=4);assert.ok(turn.attempts.some(s=>s.kind==='realization'));assert.ok(p.store.records('LearningRun').length);
 const calls=fixture.calls.length;
 for(const [input,answer]of [['what is 5*4?',20],['what is 3 times 3?',9],['what is 41 times three?',123]])assert.equal(field((await p.turn(input)).reply,'answer'),answer);
 assert.equal(fixture.calls.length,calls);assert.equal(p.store.records('CodeExample').length,2);
 // Same word by itself still has multiple meanings, not a global string rewrite.
 assert.equal((await p.turn('times')).status,'ambiguous');
 }finally{p.close();}
});
test('the same sense, frame, and realization loop handles a non-math concept without a host dispatch change',async()=>{
 const fixture=sources(),p=new Project({fetcher:fixture.fetcher});try{
 p.load(custom);const turn=await p.turn('salute Greg');assert.equal(field(turn.reply,'text'),'Hello, Greg()');assert.ok(turn.attempts.some(s=>s.kind==='realization'));
 const requests=fixture.calls.length;assert.equal(field((await p.turn('salute Emmy')).reply,'text'),'Hello, Emmy()');assert.equal(fixture.calls.length,requests);
 assert.equal(field((await p.turn('what is salute Emmy?')).reply,'text'),'Hello, Emmy()');
 }finally{p.close();}
});
test('failed implementation checks cannot install behavior or claim an answer',async()=>{
 const p=new Project({online:false});try{
 p.load(`Concept(Broken(),IsA(ComputableExpression()),Surface("broken"),Frame(pattern=List(Lexeme(Broken()),Slot($x,primitive="number")),meaning=Broken($x)),ImplementationLesson(Broken($x),language="javascript",code="(x)=>x+1",checks=List(Check(Broken(2),99),Check(Broken(3),99))))`);
 const turn=await p.turn('what is broken 8?');assert.equal(turn.status,'learning');assert.equal(field(turn.reply,'pending'),true);assert.equal(p.store.parts('Broken','Realization').length,0);assert.match(turn.attempts.find(s=>s.kind==='realization').detail,/failed/);
 assert.ok(p.store.agenda().some(j=>j.kind==='realization'&&j.status==='waiting'));
 }finally{p.close();}
});
test('source retraction invalidates learned interpretations and replies, with original words preserved',async()=>{
 const fixture=sources(),p=new Project({fetcher:fixture.fetcher});try{
 const turn=await p.turn('what is 5 times three?');const source=p.store.records('SourceEntity').find(r=>field(r.expression,'externalId')==='Q201');p.store.retract(source.id);
 assert.equal(p.store.record(turn.replyId).active,false);assert.equal(p.store.record(turn.episodeId).active,true);assert.equal((await p.resume(turn.episodeId,{learn:false})).status,'learning');
 }finally{p.close();}
});
test('withdrawn implementation evidence stays withdrawn until an authored revision teaches it again',async()=>{
 const p=new Project({online:false});try{
 const turn=await p.turn('what is 5*4?');assert.equal(field(turn.reply,'answer'),20);
 const code=p.store.records('CodeExample').find(r=>r.source.startsWith('implementation:'));p.store.retract(code.id);assert.equal(p.store.record(turn.replyId).active,false);
 const retry=await p.resume(turn.episodeId);assert.equal(retry.status,'learning');assert.equal(p.store.parts('ScalarProduct','Realization').length,0);
 }finally{p.close();}
});
test('time and work bounds leave failed acquisitions pending rather than inventing meanings',async()=>{
 let count=0;const p=new Project({fetcher:async()=>{count++;throw new Error('unavailable');}});try{
 p.load('Concept(RequestLearningPolicy(),Revision(1),MaximumPasses(2),MaximumJobs(1),MaximumMilliseconds(500))');const turn=await p.turn('unknown words');assert.equal(turn.status,'learning');assert.equal(turn.attempts.length,1);assert.ok(count<=2);assert.ok(p.store.agenda().some(j=>j.status==='waiting'));assert.equal(p.store.records('Feedback').length,0);
 }finally{p.close();}
});
test('retained senses, frames, and learned implementations survive reopen and answer offline',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'napkin-loop-')),path=join(dir,'knowledge.sqlite'),fixture=sources();let p=new Project({path,fetcher:fixture.fetcher});try{
 await p.turn('what is 5 times three?');p.close();p=new Project({path,online:false});assert.equal(field((await p.turn('what is 12 times three?')).reply,'answer'),36);
 }finally{p.close();rmSync(dir,{recursive:true,force:true});}
});
test('actual browser SQLite learns and retains the same loop',async()=>{
 const SQL=await initSQL(),manifest=JSON.parse(readFileSync(new URL('../packs/manifest.json',import.meta.url),'utf8'));const bundle={manifest,packs:Object.fromEntries(manifest.packs.map(n=>[n,readFileSync(new URL('../packs/'+n,import.meta.url),'utf8')]))},fixture=sources();
 let p=new ProjectCore({store:new BrowserStore(SQL),bundle,fetcher:fixture.fetcher});try{
 assert.equal(field((await p.turn('what is 5 times three?')).reply,'answer'),15);const bytes=p.store.snapshot();p.close();p=new ProjectCore({store:new BrowserStore(SQL,bytes),bundle,online:false});assert.equal(field((await p.turn('what is 3 times 3?')).reply,'answer'),9);
 }finally{p.close();}
});
test('untrusted source text cannot install semantic frames or implementation lessons',()=>{
 const p=new Project({online:false});try{for(const text of ['Concept(X(),ImplementationLesson(X(),body=1))','Concept(X(),Frame(pattern=List(),meaning=X()))','Concept(X(),SenseIdentity("Q1",source=WikidataSource()))'])assert.throws(()=>p.load(text,{trusted:false}),/Evidence cannot install/);}finally{p.close();}
});
