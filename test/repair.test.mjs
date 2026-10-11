import test from 'node:test';import assert from 'node:assert/strict';
import {Project} from '../src/project.mjs';import {capture} from '../src/ears.mjs';import {term,values,field,format,parse} from '../src/ncon.mjs';
import {repairDistance} from '../src/repair.mjs';
const clock=()=>new Date('2026-10-10T23:39:59Z'),options={online:false,profile:'keal',clock,timeZone:'America/Los_Angeles'};

test('transpositions propose equal spelling alternatives and contextual typed composition selects the meaning',async()=>{
 assert.equal(repairDistance('waht','what'),1);assert.equal(repairDistance('waht','want'),1);
 const p=new Project(options);try{
  p.load('Concept(WhatWord(),IsA(QuestionWord()),Surface("what")) Concept(WantWord(),IsA(DesireWord()),Surface("want")) Concept(Cookie(),IsA(Food()),Surface("cookie")) Concept(AskForm(),Construction(pattern=List(Slot($word,kind=QuestionWord()),Literal("do you think")),meaning=Ask($word))) Concept(DesireForm(),Construction(pattern=List(Literal("i"),Slot($word,kind=DesireWord()),Literal("a"),Slot($thing,kind=Food())),meaning=Desire($thing)))');
  assert.equal((await p.analyze(capture('waht do you think'))).candidates[0].meaning.head,'Ask');
  const desire=await p.analyze(capture('i waht a cookie'));assert.equal(desire.candidates[0].meaning.head,'Desire');assert.equal(values(desire.candidates[0].meaning)[0].head,'Cookie');
  assert.equal(p.store.surfaces('waht','keal').length,0);
 }finally{p.close();}
});

test('fresh teacher-off clock and multiword-format repairs retain exact observations and reversible hypotheses',async()=>{
 const p=new Project(options);try{
  const first=await p.turn('waht time is it');assert.equal(field(first.reply,'answer'),'04:39 PM');
  const follow=await p.turn('militry tiem?');assert.equal(field(follow.reply,'answer'),'16:39');assert.equal(follow.input.source,'militry tiem?');
  assert.equal(p.store.surfaces('militry tiem').length,0);assert.match(format(p.store.record(follow.readingId).expression),/SurfaceRepair\("militry tiem", "military time"/);
  assert.ok(follow.assessment.reasons.some(r=>r.includes('unconfirmed orthographic')));
  p.store.retract(p.store.parts('SurfaceRepairPolicy','Enabled')[0].support);assert.equal(p.store.record(follow.replyId).active,false);assert.equal(p.store.record(follow.episodeId).active,true);
 }finally{p.close();}
});

test('equally fitting repairs stay ambiguous, and no unmatched word or negation is silently dropped',async()=>{
 const p=new Project(options);try{
  p.load('Concept(Cat(),IsA(Item()),Surface("cat")) Concept(Cart(),IsA(Item()),Surface("cart")) Concept(Take(),Construction(pattern=List(Literal("take"),Slot($item,kind=Item())),meaning=Carry($item)))');
  const r=await p.turn('take catt');assert.equal(r.status,'ambiguous');assert.equal(r.candidates.length,2);
  assert.equal((await p.turn('take not catt')).status,'learning');assert.equal((await p.turn('take completelyunknown catt')).status,'learning');
 }finally{p.close();}
});

test('protected regions and source evidence do not acquire orthographic assertion readings',async()=>{
 const p=new Project(options);try{
  assert.equal((await p.turn('"militry tiem"')).status,'learning');assert.equal((await p.turn('`waht time is it`')).status,'learning');
  const analysis=await p.analyze(capture('waht time is it'),{context:term('Context',term('SourceEvidence'))});assert.equal(analysis.candidates.length,0);
  for(const text of ['Concept(X(),SurfaceRepairPolicy())','Concept(X(),ContextRequirement(X(),PreviousAllowsHint("kind")))'])assert.throws(()=>p.load(text,{trusted:false}),/Evidence cannot install/);
 }finally{p.close();}
});

test('repair search budgets leave work open while known exact requests remain usable',async()=>{
 const p=new Project(options);try{
  p.load('Concept(SurfaceRepairPolicy(),Revision(1),MaximumScans(0))');
  const unknown=await p.turn('waht time is it');assert.equal(unknown.status,'learning');assert.equal(unknown.exhausted,true);
  assert.equal(field((await p.turn('what time is it')).reply,'answer'),'04:39 PM');
 }finally{p.close();}
});

test('a complete fallback no longer blocks independent learning of a better checked procedure',async()=>{
 let calls=0;const p=new Project({...options,online:true,fetcher:async()=>{calls++;return Response.json({rows:[{row_idx:1,row:{question:'2 florp 3',answer:5}},{row_idx:2,row:{question:'7 florp 4',answer:11}}]});}});try{
  p.load('Concept(BroadRequest(),IsA(Request()),LearningFallback(),Construction(pattern=List(Slot($a,primitive="number"),Literal("florp"),Slot($b,primitive="number")),meaning=BroadRequest(),weight=-1)) Concept(RespondTo(),Realization(RespondTo(BroadRequest()),body=Replied(text="provisional preview")))');
  const r=await p.turn('9 florp 8');assert.equal(field(r.reply,'answer'),17);assert.ok(calls>0);assert.ok(p.store.records('Need').some(r=>format(r.expression).includes('RefineInterpretation')));
  const count=calls;p.online=false;assert.equal(field((await p.turn('20 florp 30')).reply,'answer'),50);assert.equal(calls,count);
 }finally{p.close();}
});

test('useful fallback replies remain available after bounded learning, without closing the interpretation need',async()=>{
 const p=new Project({...options,online:true,fetcher:async()=>Response.json({rows:[]})});try{
  p.load('Concept(BroadRequest(),IsA(Request()),LearningFallback(),Construction(pattern=List(Literal("observe preview")),meaning=BroadRequest())) Concept(RespondTo(),Realization(RespondTo(BroadRequest()),body=Replied(text="provisional preview")))');
  const r=await p.turn('observe preview');assert.equal(field(r.reply,'text'),'provisional preview');
  assert.ok(p.store.records('NeedStatus').some(r=>field(r.expression,'status')==='open'));
 }finally{p.close();}
});

test('explicit spelling confirmation teaches a scoped, retractable form without choosing its sense globally',async()=>{
 const p=new Project(options);try{
  p.load('Concept(ApplyAction(),IsA(Operation()),Surface("apply")) Concept(ApplyName(),IsA(Name()),Surface("apply")) Concept(ActForm(),Construction(pattern=List(Slot($op,kind=Operation()),Literal("now")),meaning=Act($op))) Concept(NameForm(),Construction(pattern=List(Literal("named"),Slot($name,kind=Name())),meaning=Named($name)))');
  const first=await p.turn('aply now');assert.equal(values(first.result)[0].head,'Act');
  assert.throws(()=>p.confirmSpelling(first.readingId,'aply','apply',{profile:'other'}),/profile/);
  assert.throws(()=>p.confirmSpelling(first.readingId,'aply','apple'),/proposal/);
  const lesson=p.confirmSpelling(first.readingId,'aply','apply');
  p.load('Concept(SurfaceRepairPolicy(),Revision(1),Enabled(0))');
  const action=await p.turn('aply now'),name=await p.turn('named aply');
  assert.equal(values(action.result)[0].head,'Act');assert.equal(values(name.result)[0].head,'Named');assert.deepEqual(action.candidates[0].repairs,[]);
  assert.equal((await p.turn('aply now',{profile:'other'})).status,'learning');
  assert.equal((await p.turn('`aply` now')).status,'learning');
  p.store.retract(lesson.lessonId);assert.equal(p.store.record(action.replyId).active,false);assert.equal(p.store.record(name.replyId).active,false);assert.equal(p.store.record(first.episodeId).active,true);
  assert.equal((await p.turn('aply now')).status,'learning');
 }finally{p.close();}
});

test('confirmed literal and multiword forms survive actual browser reopen and transfer through existing constructions',async()=>{
 const {readFileSync}=await import('node:fs'),{default:initSQL}=await import('sql.js'),{ProjectCore}=await import('../src/project-core.mjs'),{BrowserStore}=await import('../web/store.mjs');
 const SQL=await initSQL(),manifest=JSON.parse(readFileSync(new URL('../packs/manifest.json',import.meta.url),'utf8')),bundle={manifest,packs:Object.fromEntries(manifest.packs.map(n=>[n,readFileSync(new URL('../packs/'+n,import.meta.url),'utf8')]))};
 let p=new ProjectCore({...options,store:new BrowserStore(SQL),bundle});try{
  const first=await p.turn('waht time is it');p.confirmSpelling(first.readingId,'waht','what');
  const follow=await p.turn('militry tiem');p.confirmSpelling(follow.readingId,'militry tiem','military time');
  p.load('Concept(SurfaceRepairPolicy(),Revision(1),Enabled(0))');const bytes=p.store.snapshot();p.close();p=new ProjectCore({...options,store:new BrowserStore(SQL,bytes),bundle});
  assert.equal(field((await p.turn('militry tiem?')).reply,'answer'),'16:39');
  assert.equal(field((await p.turn('waht time is it')).reply,'answer'),'16:39');
  await p.turn('lunch is at 12:30');assert.equal(field((await p.turn('waht time is lunch at?')).reply,'answer'),'12:30');
  for(const text of ['Concept(X(),ReadSpelling("waht","what"))','SpellingLesson("waht","what")'])assert.throws(()=>p.load(text,{trusted:false}),/Evidence cannot install/);
 }finally{p.close();}
});
