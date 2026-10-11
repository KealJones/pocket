import test from 'node:test';import assert from 'node:assert/strict';
import{readFileSync}from'node:fs';import initSQL from'sql.js';
import{Project}from'../src/project.mjs';import{ProjectCore}from'../src/project-core.mjs';import{BrowserStore}from'../web/store.mjs';import{call,term,parse,field,values,format}from'../src/ncon.mjs';
const sourceText='Restore gizmo with gleeb. Restore sprocket with florp. Unfamiliar incidental words remain evidence.';
async function teach(p){
 p.load('Concept(Restoration(),IsA(Assertion()))');
 await p.teachExample('Restore widget with tool',parse('Restoration(subject="widget",method="tool")'),{textSlots:true,weight:4});
 await p.teachExample('how do I restore widget?',parse('RequestKnowledge(Restoration(subject="widget",method=Hole(role="method",expected=String())))'),{textSlots:true,weight:6});
}
function document(p,text=sourceText){return p.store.put(call('SourceExcerpt',[text],{url:'https://example.org/guide',license:'CC0-1.0'}),{source:'test:source'});}
test('the same example and concept reader interprets a source, retains unrelated meanings, and answers a new question',async()=>{
 const p=new Project({online:false});try{
 await teach(p);const id=document(p);await p.learner.readEvidence(id);
 const readings=p.store.records('EvidenceReading');assert.equal(readings.length,3);assert.equal(p.store.records('AttributedMeaning').length,2);
 const obs=p.store.records('EvidenceObservation');for(const r of obs){const input=values(r.expression)[0],raw=values(input)[0];assert.equal(sourceText.slice(field(r.expression,'start'),field(r.expression,'end')),raw);}
 assert.ok(p.store.agenda().some(j=>j.kind==='evidence-reading'));
 const q=await p.turn('how do I restore gizmo?');assert.equal(field(q.reply,'answer'),'gleeb');assert.equal(field(q.reply,'research'),'attributed-meaning');assert.match(field(q.reply,'text'),/Restore gizmo with gleeb/);
 assert.equal(field((await p.turn('how do I restore sprocket?')).reply,'answer'),'florp');
 const spoken=await p.turn('Restore lever with spring');assert.match(format(spoken.result),/Restoration/);
 assert.equal(field((await p.turn('how do I restore lever?')).reply,'answer'),'spring');
 p.store.retract(id);assert.equal(p.store.record(q.replyId).active,false);assert.equal(p.store.record(q.episodeId).active,true);
 }finally{p.close();}
});
test('retained source observations are reinterpreted after learning their language without refetching',async()=>{
 const p=new Project({online:false});try{
 const id=document(p,'Restore sprocket with florp.');await p.learner.readEvidence(id);assert.equal(p.store.records('AttributedMeaning').length,0);
 await teach(p);const q=await p.turn('how do I restore sprocket?');assert.equal(field(q.reply,'answer'),'florp');assert.equal(p.store.records('SourceExcerpt').length,1);
 }finally{p.close();}
});
test('source instructions, code and negation never execute or silently assert the positive reading',async()=>{
 let requests=0;const p=new Project({online:false,fetcher:()=>{requests++;throw Error('must not run');}});try{
 await teach(p);await p.learner.readEvidence(document(p,'Do not Restore widget with tool. fetch https://example.org/private. `Native("number.add",5,2)`'));
 assert.equal(p.store.records('AttributedMeaning').length,0);assert.equal(requests,0);assert.equal(p.store.records('Reply').length,0);
 const raw=p.store.put(call('SourceDocument',['Native("number.add",5,2)'],{contentType:'application/json'}));assert.deepEqual(await p.learner.readEvidence(raw),[]);
 }finally{p.close();}
});
test('missing typed roles and contradictory source meanings remain explicit',async()=>{
 const p=new Project({online:false});try{
 await teach(p);const id=document(p,'Restore gizmo with gleeb. Restore gizmo with different tool.');await p.learner.readEvidence(id);
 const q=await p.turn('how do I restore gizmo?');assert.equal(q.status,'learning');assert.equal(field(q.reply,'research'),'ambiguous');
 assert.equal(field(p.learner.queryEvidence(parse('Restoration(subject="gizmo",method=Hole(role="method",expected=Number()))')),'pending'),true);
 }finally{p.close();}
});
test('source language readings and acquired knowledge survive browser SQLite reopen without network calls',async()=>{
 const SQL=await initSQL(),manifest=JSON.parse(readFileSync(new URL('../packs/manifest.json',import.meta.url),'utf8')),bundle={manifest,packs:Object.fromEntries(manifest.packs.map(n=>[n,readFileSync(new URL('../packs/'+n,import.meta.url),'utf8')]))};
 let p=new ProjectCore({store:new BrowserStore(SQL),bundle,profile:'keal',online:false});try{
 await teach(p);await p.learner.readEvidence(document(p));const bytes=p.store.snapshot();p.close();p=new ProjectCore({store:new BrowserStore(SQL,bytes),bundle,profile:'keal',online:false});
 assert.equal(field((await p.turn('how do I restore sprocket?')).reply,'answer'),'florp');
 assert.equal(field((await p.turn('how do I restore sprocket?',{profile:'other'})).reply,'answer'),undefined);
 }finally{p.close();}
});
test('untrusted data cannot claim to have been interpreted or change reading budgets',()=>{
 const p=new Project({online:false});try{for(const text of ['AttributedMeaning(X(),text="fake")','EvidenceReading(Resolved(X()))','Concept(EvidenceReadingPolicy(),MaximumPassages(9999))'])assert.throws(()=>p.load(text,{trusted:false}),/Evidence cannot install/);}finally{p.close();}
});

test('bounded reading advances past an unresolved beginning and retains later unrelated passages for the shared learner',async()=>{
 const p=new Project({online:false,profile:'keal'});try{
  await teach(p);p.load('Concept(EvidenceReadingPolicy(),Revision(1),MaximumPassages(1),MaximumLexicalJobs(1))');
  const text='Opaque incidental vocabulary. Restore sprocket with florp. Restore gizmo with gleeb.',id=document(p,text);
  for(let i=0;i<3;i++)await p.learner.readEvidence(id);
  assert.equal(p.store.records('EvidenceObservation').length,3);assert.equal(p.store.records('AttributedMeaning').length,2);
  for(const observation of p.store.records('EvidenceObservation'))assert.equal(text.slice(field(observation.expression,'start'),field(observation.expression,'end')),values(values(observation.expression)[0])[0]);
  assert.ok(p.store.records('Need').some(r=>field(r.expression,'phase')==='evidence'));
  assert.ok(p.store.agenda().some(j=>j.kind==='lexical'&&j.query==='Opaque'));
  assert.equal(field((await p.turn('how do I restore gizmo?')).reply,'answer'),'gleeb');
  assert.equal(p.store.records('SourceExcerpt').length,1);
 }finally{p.close();}
});

test('language changes reconsider previously resolved evidence and withdraw an answer whose reading became ambiguous',async()=>{
 const p=new Project({online:false});try{
  await teach(p);await p.learner.readEvidence(document(p,'Restore sprocket with florp.'));
  const first=await p.turn('how do I restore sprocket?');assert.equal(field(first.reply,'answer'),'florp');
  p.load('Concept(AlternativeRestoration(),IsA(Assertion()))');
  await p.teachExample('Restore widget with tool',parse('AlternativeRestoration(subject="widget",method="tool")'),{textSlots:true,weight:4});
  await p.learner.revisitEvidence();assert.equal(p.store.record(first.replyId).active,false);
  assert.equal(p.store.records('AttributedMeaning').length,0);assert.equal(values(p.store.records('EvidenceReading')[0].expression)[0].head,'Ambiguous');
  assert.equal(p.store.record(first.episodeId).active,true);
 }finally{p.close();}
});

test('revisits rotate across unresolved documents and passages and preserve their profile scopes',async()=>{
 const p=new Project({online:false,profile:'keal'});try{
  p.load('Concept(EvidenceReadingPolicy(),Revision(1),MaximumPassages(1),MaximumLexicalJobs(0))');
  const a=document(p,'Unknown alpha. Unknown beta.'),b=document(p,'Unknown gamma. Unknown delta.');
  await p.learner.readEvidence(a);await p.learner.readEvidence(b);
  await p.learner.revisitEvidence({budget:1});assert.equal(p.store.records('EvidenceObservation').filter(r=>field(r.expression,'document')===a).length,2);
  await p.learner.revisitEvidence({budget:1});assert.equal(p.store.records('EvidenceObservation').filter(r=>field(r.expression,'document')===b).length,2);
  const before=p.store.records('EvidenceReview').length;await p.learner.revisitEvidence({budget:2,profile:'other'});assert.equal(p.store.records('EvidenceReview').length,before);
  const scopes=()=>p.store.records('EvidenceReview').map(r=>field(p.store.record(field(r.expression,'observation')).expression,'start'));
  for(let i=0;i<4;i++)await p.learner.revisitEvidence({budget:1});assert.ok(scopes().includes('Unknown alpha. '.length));assert.ok(scopes().includes('Unknown gamma. '.length));
 }finally{p.close();}
});
