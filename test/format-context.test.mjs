import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import initSQL from 'sql.js';
import {Project} from '../src/project.mjs';
import {ProjectCore} from '../src/project-core.mjs';
import {BrowserStore} from '../web/store.mjs';
import {parse,field,values,format} from '../src/ncon.mjs';
const options={profile:'keal',timeZone:'America/Los_Angeles',clock:()=>new Date('2026-10-10T23:39:59Z')};
const answer=r=>field(r.reply,'answer');

test('clock format follow-ups work with and without punctuation, without research or a teacher',async()=>{
 let calls=0;const p=new Project({...options,fetcher:async()=>{calls++;throw new Error('Known follow-up must not research');},teacher:{fetcher:async()=>{calls++;throw new Error('Known follow-up must not need a teacher');}}});try{
  assert.equal(answer(await p.turn('what time is it')),'04:39 PM');
  for(const prompt of ['in military time','in military time?','In military time!','military time','in 24-hour time','in 24 hour time?']){
   const r=await p.turn(prompt);assert.equal(r.status,'resolved',prompt);assert.equal(answer(r),'16:39',prompt);assert.equal(values(values(p.store.record(r.episodeId).expression)[0])[0],prompt);
  }
  assert.equal(answer(await p.turn('in 12-hour time?')),'04:39 PM');assert.equal(calls,0);
 }finally{p.close();}
});

test('request endings compose with a separately learned workflow, while quoted text stays protected',async()=>{
 const p=new Project({...options,online:false});try{
  const id=p.load('Concept(IndependentRequest(),IsA(Request()),Surface("confirm task")) Concept(RespondTo(),Realization(RespondTo(IndependentRequest()),body=Replied(text="confirmed",answer=true)))')[0];
  const r=await p.turn('confirm task?');assert.equal(answer(r),true);assert.equal(answer(await p.turn('confirm task!')),true);
  assert.equal((await p.turn('"confirm task?"')).status,'learning');
  p.store.retract(id);assert.equal(p.store.record(r.replyId).active,false);assert.equal(p.store.record(r.episodeId).active,true);
 }finally{p.close();}
});

test('a taught format phrasing transfers across formats and preserves the observed time',async()=>{
 let now='2026-10-10T23:39:59Z';const p=new Project({...options,online:false,clock:()=>new Date(now)});try{
  await p.turn('what time is it?');await p.teachExample('say it in military time',parse('SessionRequest(SetClockFormat(TwentyFourHourTime()))'));
  now='2026-10-11T00:05:00Z';assert.equal(answer(await p.turn('say it in military time')),'16:39');assert.equal(answer(await p.turn('say it in 12-hour time?')),'04:39 PM');
  assert.equal(answer(await p.turn('get me the time')),'05:05 PM');
 }finally{p.close();}
});

test('a missing focused clock stays a clarification, and a definition question keeps its topic meaning',async()=>{
 const p=new Project({...options,online:false});try{
  for(const prompt of ['in military time','in military time?']){const r=await p.turn(prompt);assert.equal(r.status,'learning');assert.match(field(r.reply,'text'),/Which time/);assert.ok(r.candidates[0].meaning.head==='SessionRequest');}
  const definition=await p.turn('what is military time?');assert.equal(definition.candidates[0].meaning.head,'TopicQuestion');
 }finally{p.close();}
});

test('upgrading an existing browser notebook retains clock memory and replaces a saved Wikipedia follow-up',async()=>{
 const SQL=await initSQL(),manifest=JSON.parse(readFileSync(new URL('../packs/manifest.json',import.meta.url),'utf8')),bundle={manifest,packs:Object.fromEntries(manifest.packs.map(n=>[n,readFileSync(new URL('../packs/'+n,import.meta.url),'utf8')]))};
 const old={manifest,packs:{...bundle.packs,'session.ncon':bundle.packs['session.ncon'].split('// A request can carry a terminal question/emphasis mark')[0]}};
 let requests=0;const fetcher=async raw=>{requests++;const u=new URL(raw);if(u.searchParams.get('list')==='search')return Response.json({query:{search:[{title:'Military time'}]}});return Response.json({query:{pages:[{title:'Military time',extract:'Military time uses a 24-hour clock.',fullurl:'https://en.wikipedia.org/wiki/Military_time',revisions:[{revid:12}],pageprops:{}}]}});};
 let p=new ProjectCore({...options,bundle:old,store:new BrowserStore(SQL),online:false,fetcher});try{
  const clock=await p.turn('what time is it');assert.equal(answer(clock),'04:39 PM');const clockMemory=p.store.records('MemoryObject').find(r=>values(r.expression)[0].head==='ClockReading').id;
  p.online=true;const failed=await p.turn('in military time?');assert.match(field(failed.reply,'text'),/24-hour clock/);assert.ok(requests>0);const count=requests,bytes=p.store.snapshot();p.close();
  p=new ProjectCore({...options,bundle,store:new BrowserStore(SQL,bytes),fetcher});assert.equal(p.store.record(clockMemory).active,true);
  assert.equal(answer(await p.resume(failed.episodeId,{learn:false})),'16:39');assert.equal(answer(await p.turn('in military time')),'16:39');assert.equal(answer(await p.turn('in military time?')),'16:39');assert.equal(requests,count);
 }finally{p.close();}
});
