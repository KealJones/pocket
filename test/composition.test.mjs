import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import initSQL from 'sql.js';
import {Project} from '../src/project.mjs';
import {ProjectCore} from '../src/project-core.mjs';
import {BrowserStore} from '../web/store.mjs';
import {capture} from '../src/ears.mjs';
import {numericBlocks} from '../src/numeric-programs.mjs';
import {parse,field,format,call} from '../src/ncon.mjs';
const examples=[{input:'3 flerp 5 with 4',output:44},{input:'8 flerp 2 with 3',output:54},{input:'4 flerp 7 with 2',output:30}];
const mix=(head='Mix',body='Native("number.add",Native("number.multiply",2,$a),$b)')=>({pattern:parse(`${head}($a,$b)`),body:parse(body),checks:[{input:parse(`${head}(2,3)`),output:7},{input:parse(`${head}(5,4)`),output:14}]});

test('independent induction reuses checked code, transfers offline, and withdraws dependents',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'pocket-compose-')),path=join(dir,'notebook.sqlite');let p=new Project({path,online:false});
 try{
  assert.equal((await p.teachOutcomes(examples)).learned.length,0);
  const base=await p.teachCode(mix()), learned=await p.teachOutcomes([]);
  assert.equal(learned.learned.length,1);assert.deepEqual(learned.learned[0].reused,['Mix']);assert.match(format(learned.learned[0].program),/Mix\(/);
  const id=learned.learned[0].id;
  assert.ok(p.store.exportLearningHistory().events.some(e=>e.kind==='learning.program.induced'&&e.detail.learned.some(l=>l.reused.includes('Mix'))));
  p.close();p=new Project({path,online:false,fetcher:async()=>{throw new Error('Network must not be used');}});
  const answer=await p.turn('6 flerp 9 with 5');assert.equal(field(answer.reply,'answer'),105);
  p.store.retract(base.evidence);assert.equal(p.store.record(id).active,false);assert.equal(p.store.record(answer.replyId).active,false);assert.equal(p.store.record(answer.episodeId).active,true);
  assert.equal((await p.resume(answer.episodeId,{learn:false})).status,'learning');
 }finally{p.close();rmSync(dir,{recursive:true,force:true});}
});

test('Gemini-checked code becomes independent learning vocabulary without further model calls',async()=>{
 let calls=0;
 const packet={reason:'A reusable numeric implementation.',clarification:null,concepts:['Concept(AcquiredMix(),IsA(ComputableExpression()),Realization(AcquiredMix($a,$b),body=Native("number.add",Native("number.multiply",2,$a),$b)))','Concept(AcquiredMixForm(),Construction(pattern=List(Literal("mix"),Slot($a,primitive="number"),Literal("with"),Slot($b,primitive="number")),meaning=RequestValue(AcquiredMix($a,$b))))'],examples:[{text:'mix 2 with 3',meaning:'RequestValue(AcquiredMix(2,3))'},{text:'mix 5 with 4',meaning:'RequestValue(AcquiredMix(5,4))'}],checks:[{input:'AcquiredMix(2,3)',output:'7'},{input:'AcquiredMix(5,4)',output:'14'}],facts:[]};
 const p=new Project({teacher:{fetcher:async()=>{calls++;return Response.json({candidates:[{content:{parts:[{text:JSON.stringify(packet)}]}}]});}}});
 try{
  await p.prepare();const input=capture('mix 2 with 3'),episode=p.store.put(call('Episode',[input.expression],{profile:'',sequence:p.sequence()}));
  assert.equal((await p.modelLearner.assist({input,episode,analysis:await p.analyze(input)})).changed,true);assert.equal(calls,1);
  p.online=false;assert.equal((await p.teachOutcomes(examples)).learned.length,1);assert.equal(field((await p.turn('6 flerp 9 with 5')).reply,'answer'),105);assert.equal(calls,1);
 }finally{p.close();}
});

test('latent effects, insufficient checks and other profiles cannot enter numeric search',async()=>{
 let network=0;const p=new Project({online:false,fetcher:async()=>{network++;return new Response('bad');}});
 try{
  await p.teachCode(mix('EffectMix','If(true,Native("number.add",Native("number.multiply",2,$a),$b),Native("web.fetch-evidence","https://example.org"))'));
  await p.teachCode({...mix('UncheckedMix'),checks:[]});
  p.profile='other';await p.teachCode(mix('OtherMix'));p.profile='';
  const blocks=await numericBlocks(p.store,p.evaluator,{profile:''});assert.ok(!blocks.some(b=>['EffectMix','UncheckedMix','OtherMix'].includes(b.name)));assert.equal(network,0);
  assert.equal((await p.teachOutcomes(examples)).learned.length,0);assert.equal(network,0);
 }finally{p.close();}
});

test('equivalent wrappers do not create false ambiguity or consume duplicate search budget',async()=>{
 const p=new Project({online:false});try{
  for(let i=0;i<8;i++)await p.teachCode({pattern:parse(`Sum${i}($a,$b)`),body:parse('Native("number.add",$a,$b)'),checks:[{input:parse(`Sum${i}(2,3)`),output:5},{input:parse(`Sum${i}(5,4)`),output:9}]});
  const learned=await p.teachOutcomes([{input:'2 blim 3',output:5},{input:'7 blim 4',output:11}]);assert.equal(learned.learned.length,1);assert.equal(field((await p.turn('9 blim 8')).reply,'answer'),17);
 }finally{p.close();}
});

test('conflicting helper definitions and counterexamples cannot silently select a composition',async()=>{
 const p=new Project({online:false});try{
  await p.teachCode(mix());const learned=await p.teachOutcomes(examples);assert.equal(learned.learned.length,1);
  p.load('Concept(Mix(),Realization(Mix($a,$b),body=Native("number.subtract",$a,$b)))');
  assert.ok(!((await numericBlocks(p.store,p.evaluator,{profile:''})).some(b=>b.name==='Mix')));
  assert.notEqual(field((await p.turn('6 flerp 9 with 5')).reply,'answer'),105);
  const revision=await p.teachOutcomes([{input:'6 flerp 9 with 5',output:999}]);assert.equal(revision.learned.length,0);assert.equal(p.store.record(learned.learned[0].id).active,false);
 }finally{p.close();}
});

test('composed procedures survive an actual browser SQLite snapshot',async()=>{
 const SQL=await initSQL(),manifest=JSON.parse(readFileSync(new URL('../packs/manifest.json',import.meta.url),'utf8')),bundle={manifest,packs:Object.fromEntries(manifest.packs.map(n=>[n,readFileSync(new URL('../packs/'+n,import.meta.url),'utf8')]))};
 let p=new ProjectCore({store:new BrowserStore(SQL),bundle,online:false});try{
  await p.teachCode(mix('NamedMix','Let($local,Native("number.multiply",2,$a),Native("number.add",$local,$b))'));
  assert.equal((await p.teachOutcomes(examples)).learned.length,1);const bytes=p.store.snapshot();p.close();p=new ProjectCore({store:new BrowserStore(SQL,bytes),bundle,online:false});
  assert.equal(field((await p.turn('6 flerp 9 with 5')).reply,'answer'),105);
 }finally{p.close();}
});

test('new checked vocabulary revisits retained outcomes without another teaching request',async()=>{
 const p=new Project({online:false});try{
  await p.teachOutcomes(examples);const pending=await p.turn('6 flerp 9 with 5');assert.equal(pending.status,'learning');
  await p.teachCode(mix());assert.equal(field((await p.resume(pending.episodeId,{learn:false})).reply,'answer'),105);
  const searches=p.store.exportLearningHistory().events.filter(e=>e.kind==='learning.program.induced').length;
  await p.turn('7 flerp 6 with 2');assert.equal(p.store.exportLearningHistory().events.filter(e=>e.kind==='learning.program.induced').length,searches);
 }finally{p.close();}
});

test('automatic revisiting across reopen does not undo an explicit procedure withdrawal',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'pocket-withdraw-')),path=join(dir,'notebook.sqlite');let p=new Project({path,online:false});
 try{
  await p.teachCode(mix());const learned=await p.teachOutcomes(examples);p.store.retract(learned.learned[0].id);p.close();p=new Project({path,online:false});
  assert.equal((await p.turn('6 flerp 9 with 5')).status,'learning');assert.equal(p.store.record(learned.learned[0].id).active,false);
 }finally{p.close();rmSync(dir,{recursive:true,force:true});}
});

test('erasing an unused strict local could hide a failure, so such helpers stay out of induction',async()=>{
 const p=new Project({online:false});try{
  await p.teachCode(mix('StrictMix','Let($unused,Native("number.divide",1,Native("number.subtract",$a,1)),Native("number.add",Native("number.multiply",2,$a),$b))'));
  assert.ok(!(await numericBlocks(p.store,p.evaluator,{profile:''})).some(b=>b.name==='StrictMix'));
 }finally{p.close();}
});

test('different retained procedures fitting the same examples need distinguishing evidence',async()=>{
 const p=new Project({online:false});try{
  await p.teachCode(mix());await p.teachCode({...mix('OtherMix','Native("number.add",$a,Native("number.multiply",2,$b))'),checks:[{input:parse('OtherMix(2,3)'),output:8},{input:parse('OtherMix(5,4)'),output:13}]});
  const ambiguous=await p.teachOutcomes([{input:'2 flerp 2 with 3',output:18},{input:'5 flerp 5 with 7',output:105}]);assert.equal(ambiguous.learned.length,0);assert.match(ambiguous.pending[0].reason,/procedures fit/);
  const resolved=await p.teachOutcomes([{input:'3 flerp 5 with 4',output:44}]);assert.equal(resolved.learned.length,1);assert.equal(field((await p.turn('6 flerp 9 with 5')).reply,'answer'),105);
 }finally{p.close();}
});
