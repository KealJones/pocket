import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import initSQL from 'sql.js';
import { Project } from '../src/project.mjs';
import { ProjectCore } from '../src/project-core.mjs';
import { BrowserStore } from '../web/store.mjs';
import { field,values,format,parse } from '../src/ncon.mjs';
const manifest=JSON.parse(readFileSync(new URL('../packs/manifest.json',import.meta.url),'utf8'));
const bundle={manifest,packs:Object.fromEntries(manifest.packs.map(n=>[n,readFileSync(new URL('../packs/'+n,import.meta.url),'utf8')]))};
function source(){const calls=[];return{calls,fetcher:async url=>{
  const u=new URL(url);calls.push(u);
  if(u.searchParams.get('action')==='wbsearchentities')return Response.json({search:u.searchParams.get('search')==='times'?[{id:'Q40276',label:'multiplication'}]:[]});
  if(u.searchParams.get('action')==='wbgetentities')return Response.json({entities:{Q40276:{id:'Q40276',lastrevid:1,labels:{en:{value:'multiplication'}},aliases:{en:[{value:'times'}]},claims:{}}}});
  return Response.json({query:{pages:[]},rows:[]});
}};}
const contextual=`Concept(LetterNotation(),Surface("letter notation"),ContextHint(Encoding(LetterNotation())))
Concept(LetterValue(),IsA(ComputableExpression()),
 ReadForm(LetterValue($text),primitive="number",recognizes="^[a-z]{2}$",context=Context(Encoding(LetterNotation()))),
 ImplementationLesson(LetterValue($text),body=If(Native("value.equal",$text,"ab"),7,If(Native("value.equal",$text,"cd"),9,Quote(NoReading()))),
 checks=List(Check(LetterValue("ab"),7),Check(LetterValue("cd"),9),Check(LetterValue("zz"),NoReading()))))`;
test('reported Roman numeral request learns a reader, source sense, and multiplication in one turn',async()=>{
 const fixture=source(),p=new Project({fetcher:fixture.fetcher});try{
  assert.equal(p.store.parts('RomanValue','Realization').length,0);assert.equal(p.store.surfaces('VI').length,0);
  const turn=await p.turn('what is VI times 3?');assert.equal(field(turn.reply,'answer'),18);assert.equal(turn.status,'resolved');
  assert.equal(turn.input.source,'what is VI times 3?');assert.match(format(turn.result),/ScalarProduct\(6, 3\)/);
  assert.ok(turn.attempts.some(a=>a.kind==='decoding'&&a.query==='VI'));assert.ok(turn.attempts.some(a=>a.kind==='realization'&&a.query==='RomanValue("VI")'));
  assert.ok(p.store.records('SourceEntity').length);assert.equal(p.store.surfaces('VI').length,0);
  const count=fixture.calls.length;
  for(const [input,answer]of [['what is IX times 4?',36],['what is XIV*2?',28],['what is XL*3?',120],['what is VI times VI?',36]])assert.equal(field((await p.turn(input)).reply,'answer'),answer);
  assert.equal(fixture.calls.length,count);
 }finally{p.close();}
});
test('bare Roman numerals clarify and retry the preceding unresolved observation after new teaching',async()=>{
 const p=new Project({online:false,profile:'keal'});try{
  const form=p.store.parts('RomanValue','ReadForm')[0];p.store.retract(form.support);
  const first=await p.turn('what is VI*3?');assert.equal(first.status,'learning');
  // An explicit new lesson, not silent resurrection of withdrawn evidence.
  p.load('Concept(RomanValue(),ReadForm(RomanValue($text),primitive="number",recognizes="^[IVXLCDM]{1,15}$",notation=NumeralSystem(RomanNumerals())),ImplementationLesson(RomanValue($text),body=RomanSum($text,0),checks=List(Check(RomanValue("VI"),6),Check(RomanValue("IX"),9))))');
  const follow=await p.turn('Roman Numerals');assert.equal(field(follow.reply,'answer'),18);assert.equal(field(follow.reply,'clarifiedEpisode'),first.episodeId);
  const linked=p.store.record(follow.clarification);assert.equal(field(linked.expression,'target'),first.episodeId);
  assert.equal(values(values(p.store.record(first.episodeId).expression)[0])[0],'what is VI*3?');
  assert.equal((await p.resume(first.episodeId)).status,'resolved');
  p.store.retract(linked.id);assert.equal(p.store.record(follow.replyId).active,false);assert.equal(p.store.record(first.episodeId).active,true);
 }finally{p.close();}
});
test('a different authored reader and context hint use the same learner and follow-up path',async()=>{
 const p=new Project({online:false});try{
  p.load(contextual);const first=await p.turn('what is ab*3?');assert.equal(first.status,'learning');
  const follow=await p.turn('letter notation');assert.equal(field(follow.reply,'answer'),21);assert.equal(field(follow.reply,'clarifiedEpisode'),first.episodeId);
  assert.ok(follow.attempts.some(a=>a.kind==='realization'&&a.query.startsWith('LetterValue(')));
  assert.equal((await p.turn('what is cd*2?')).status,'learning');
  assert.equal(field((await p.turn('letter notation')).reply,'answer'),18);
 }finally{p.close();}
});
test('hint routing stays within the current profile and immediate unresolved turn',async()=>{
 const p=new Project({online:false});try{
  p.load(contextual);await p.turn('what is ab*3?',{profile:'other'});
  assert.equal(field((await p.turn('letter notation')).reply,'clarifiedEpisode'),undefined);
  const pending=await p.turn('what is ab*3?');await p.turn('hello');
  const follow=await p.turn('letter notation');assert.equal(follow.clarification,undefined);assert.equal(field(follow.reply,'answer'),null);
  assert.equal((await p.resume(pending.episodeId)).status,'learning');
 }finally{p.close();}
});
test('invalid, lowercase, and quoted spellings remain unnormalized, and isolated VI stays unresolved',async()=>{
 const p=new Project({online:false});try{
  for(const text of ['what is IIII*3?','what is vi*3?','what is "VI"*3?','VI']){
   const turn=await p.turn(text);assert.equal(turn.status,'learning');assert.equal(field(turn.reply,'answer'),undefined);assert.equal(turn.input.source,text);
  }
  assert.equal(field((await p.turn('what is MMMCMXCIX*2?')).reply,'answer'),7998);
 }finally{p.close();}
});
test('helper withdrawal invalidates the learned decoder and dependent replies without re-teaching',async()=>{
 const p=new Project({online:false});try{
  const turn=await p.turn('what is VI*3?');assert.equal(field(turn.reply,'answer'),18);
  const helper=p.store.parts('RomanDigit','Realization')[0];p.store.retract(helper.support);
  assert.equal(p.store.record(turn.replyId).active,false);assert.equal(p.store.parts('RomanValue','Realization').length,0);
  assert.equal((await p.resume(turn.episodeId)).status,'learning');assert.equal(p.store.record(turn.episodeId).active,true);
 }finally{p.close();}
});
test('context-dependent readings and clarification links survive actual browser SQLite reopen',async()=>{
 const SQL=await initSQL();let p=new ProjectCore({store:new BrowserStore(SQL),bundle,online:false,profile:'keal'});try{
  p.load(contextual);const first=await p.turn('what is ab*3?');assert.equal(field((await p.turn('letter notation')).reply,'answer'),21);
  const bytes=p.store.snapshot();p.close();p=new ProjectCore({store:new BrowserStore(SQL,bytes),bundle,online:false,profile:'keal'});
  assert.equal(field((await p.resume(first.episodeId)).reply,'answer'),21);
  assert.equal((await p.turn('what is ab*3?')).status,'learning');
  assert.equal(field((await p.turn('letter notation')).reply,'answer'),21);
 }finally{p.close();}
});
test('retrieved material cannot install notation readers, hints, or derived readings; helpers stay checked',async()=>{
 const p=new Project({online:false});try{
  for(const text of ['Concept(X(),ReadForm(X($x)))','Concept(X(),ContextHint(Encoding(X())))','DecodedValue("VI",99)','Clarification(target="x")'])assert.throws(()=>p.load(text,{trusted:false}),/Evidence cannot install/);
  p.load('Concept(UnsafeHelper(),Realization(UnsafeHelper($x),body=Native("host.eval",$x)))');
  await assert.rejects(p.teachCode({pattern:parse('Unsafe($x)'),body:parse('UnsafeHelper($x)')}),/unsupported operation/);
 }finally{p.close();}
});
