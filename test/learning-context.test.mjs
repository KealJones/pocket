import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Project} from '../src/project.mjs';
import {learningContext,memoryContext} from '../src/learning-context.mjs';
import {capture} from '../src/ears.mjs';
import {values,field,format,parse} from '../src/ncon.mjs';
const clock=()=>new Date('2026-10-10T23:39:59Z');
const options={profile:'keal',clock,timeZone:'America/Los_Angeles'};
const answer=r=>field(r.reply,'answer');
const envelope=packet=>Response.json({modelVersion:'fixture-teacher',candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(packet)}]}}]});
const failedNetwork=async()=>new Response('',{status:503});
const packet=concepts=>({reason:'Reuse the attended object workflow and retain language relationships, not its answer.',clarification:null,concepts,examples:[],checks:[],facts:[]});

test('teacher sees actual prior reply and reachable format definitions, learns an alias, then transfers after offline reopen',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'pocket-context-')),path=join(dir,'notebook.sqlite');let calls=0;
 let p=new Project({...options,path,fetcher:failedNetwork,teacher:{fetcher:async(url,init)=>{
  calls++;const data=JSON.parse(JSON.parse(init.body).contents[0].parts[0].text);
  assert.equal(data.request,'militry tiem');
  assert.ok(data.conversation.some(t=>t.reading?.result==='Resolved(SessionRequest(ReadClock()))'&&t.reply?.value.includes('04:39 PM')));
  const definitions=data.relatedConcepts.map(r=>r.definition).join('\n');
  assert.match(definitions,/TwentyFourHourTime\(\), IsA\(TimeFormat\(\)\)/);assert.match(definitions,/SetClockFormat\(/);
  return envelope(packet(['Concept(AcquiredMisspelling(),Surface("militry tiem"),Denotes(TwentyFourHourTime()))']));
 }}});
 try{
  assert.equal(answer(await p.turn('what time is it')),'04:39 PM');
  const r=await p.turn('militry tiem');assert.equal(answer(r),'16:39');assert.equal(calls,1);
  assert.equal(values(values(p.store.record(r.episodeId).expression)[0])[0],'militry tiem');
  assert.equal(field(p.store.records('LearningValidation')[0].expression,'independentProof'),false);
  p.close();p=new Project({...options,path,online:false});
  assert.equal(answer(await p.turn('militry tiem?')),'16:39');assert.equal(calls,1);
  const lesson=p.store.records('LearningHypothesis')[0];
  p.store.retract(lesson.id);assert.notEqual((await p.turn('militry tiem')).status,'resolved');
  assert.equal(p.store.record(r.episodeId).active,true);
 }finally{p.close();rmSync(dir,{recursive:true,force:true});}
});

test('teaching memory follows recent attention and latest relationships rather than record hashes',async()=>{
 const p=new Project({...options,online:false});try{
  await p.turn('can you make me a shopping list with eggs on it');const object=p.store.records('MemoryObject')[0];
  for(const item of ['sugar','flour','chicken','butter','bread','milk','cream'])await p.turn('oh and '+item);
  for(let i=0;i<10;i++)await p.turn('get me the time');
  await p.turn('show my shopping list');
  const context=memoryContext(p.store,'keal');assert.equal(context[0].reference,format(parse('MemoryRef("'+object.id+'")')));
  const items=context[0].relations.filter(r=>r.relation==='Items()');assert.equal(items.length,1);assert.match(items[0].value,/cream/);assert.match(items[0].value,/eggs/);
  assert.ok(context.length<=8);assert.deepEqual(memoryContext(p.store,'other'),[]);
 }finally{p.close();}
});

test('a complete but irrelevant correction is reviewed and reusable repair wording then works without the teacher',async()=>{
 let calls=0;const lesson=packet([
  'Concept(AcquiredArmyFormat(),Surface("army clock"),Denotes(TwentyFourHourTime()))',
  'Concept(AcquiredFormatRepair(),Construction(pattern=List(Literal("no like"),Slot($format,kind=TimeFormat())),meaning=SessionRequest(SetClockFormat($format))))'
 ]);lesson.examples=[{text:'no like army clock',meaning:'SessionRequest(SetClockFormat(TwentyFourHourTime()))'},{text:'no like 12-hour time',meaning:'SessionRequest(SetClockFormat(TwelveHourTime()))'}];
 const p=new Project({...options,fetcher:failedNetwork,teacher:{fetcher:async(url,init)=>{
  calls++;const data=JSON.parse(JSON.parse(init.body).contents[0].parts[0].text);assert.match(data.answerUnderReview,/Which earlier subject/);assert.match(data.assessment,/requested value has not been bound/);
  return envelope(lesson);
 }}});try{
  await p.turn('what time is it');assert.equal(answer(await p.turn('no like army clock')),'16:39');assert.equal(calls,1);
  p.modelLearner.enabled=false;p.online=false;assert.equal(answer(await p.turn('no like 12-hour time?')),'04:39 PM');assert.equal(calls,1);
 }finally{p.close();}
});

test('the same teaching context learns a collection follow-up, with typed retrieval and offline transfer',async()=>{
 let calls=0;const lesson=packet(['Concept(AcquiredAlsoItems(),Construction(pattern=List(Literal("also"),Slot($items,capture="segment",maximumSpan=12)),meaning=SessionRequest(AddCollectionItems(TaskList(),$items))))']);
 lesson.examples=[{text:'also sugar',meaning:'SessionRequest(AddCollectionItems(TaskList(),"sugar"))'},{text:'also flour',meaning:'SessionRequest(AddCollectionItems(TaskList(),"flour"))'}];
 const p=new Project({...options,fetcher:failedNetwork,teacher:{fetcher:async(url,init)=>{
  calls++;const data=JSON.parse(JSON.parse(init.body).contents[0].parts[0].text);assert.ok(data.conversation.some(t=>t.reply?.value.includes('eggs')));assert.ok(data.memory.some(m=>m.kind==='ShoppingList()'));
  assert.match(data.relatedConcepts.map(r=>r.definition).join('\n'),/AddCollectionItems\(/);return envelope(lesson);
 }}});try{
  await p.turn('can you make me a shopping list with eggs on it');assert.match(field((await p.turn('also sugar')).reply,'text'),/sugar/);assert.equal(calls,1);
  p.modelLearner.enabled=false;p.online=false;assert.match(field((await p.turn('also flour!')).reply,'text'),/eggs[\s\S]*sugar[\s\S]*flour/);assert.equal(calls,1);
 }finally{p.close();}
});

test('graph context is bounded, keeps complete parts, filters private language and does not mutate the notebook',async()=>{
 const p=new Project({...options,online:false});try{
  p.load('Concept(PrivateFormat(),Surface("SECRET_OTHER_PROFILE",profile="other"),Denotes(TwentyFourHourTime(),profile="other"))');
  await p.turn('what time is it');const version=p.store.version,analysis=await p.analyze(capture('militry tiem'));
  const result=learningContext(p.store,{profile:'keal',episodes:p.store.records('Episode'),analysis,memoryKinds:[parse('ClockReading()')],maximumCharacters:600,maximumRecords:4});
  assert.ok(result.relatedConcepts.length<=4);assert.ok(result.relatedConcepts.reduce((s,r)=>s+r.definition.length,0)<=600);assert.equal(result.contextBudget.truncated,true);
  for(const r of result.relatedConcepts)assert.equal(format(parse(r.definition)),r.definition);
  assert.doesNotMatch(JSON.stringify(result),/SECRET_OTHER_PROFILE/);assert.equal(p.store.version,version);
 }finally{p.close();}
});
