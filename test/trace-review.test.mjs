import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSQL from 'sql.js';
import { Project } from '../src/project.mjs';
import { ProjectCore } from '../src/project-core.mjs';
import { BrowserStore } from '../web/store.mjs';
import { field } from '../src/ncon.mjs';

const reply=packet=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(packet)}]}}]});
test('decision and capability traces survive reopen and withdrawal, with full inactive export',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'pocket-audit-')),path=join(dir,'notebook.sqlite');let p=new Project({path,online:false});
 try{const turn=await p.turn('what is 5*4?');const events=p.store.traces({run:turn.traceRun});
 assert.ok(events.some(e=>e.kind==='decision.selected'&&e.detail.meaning.includes('ScalarProduct')));
 assert.ok(events.find(e=>e.kind==='execution.completed').detail.capabilities.some(e=>e.capability==='number.multiply'));
 const definition=p.store.parts('ScalarProduct','ValidatedRealization')[0].support;p.store.retract(definition);
 const exported=p.store.exportLearningHistory();assert.ok(exported.records.some(r=>r.id===definition&&!r.active));assert.ok(exported.events.some(e=>e.kind==='knowledge.withdrawn'));assert.ok(exported.events.some(e=>e.kind==='request.completed'));
 p.close();p=new Project({path,online:false});assert.deepEqual(p.store.traces({run:turn.traceRun}).filter(e=>e.kind!=='knowledge.withdrawn'),events);
 assert.equal(p.store.record(turn.episodeId).active,true);
 }finally{p.close();rmSync(dir,{recursive:true,force:true});}
});
test('explicit Gemini review sees choices and can teach a transferable construction',async()=>{
 let payload,calls=0;const p=new Project({teacher:{fetcher:async(url,options)=>{
 calls++;payload=JSON.parse(JSON.parse(options.body).contents[0].parts[0].text);const selected=payload.processTrace.find(e=>e.kind==='decision.selected');
 return reply({reason:'Retain a new wording for the already checked product operation.',clarification:null,concepts:['Concept(AcquiredCombine(),Construction(pattern=List(Literal("combine"),Slot($a,primitive="number"),Literal("with"),Slot($b,primitive="number")),meaning=RequestValue(ScalarProduct($a,$b))))'],examples:[{text:'combine 2 with 3',meaning:'RequestValue(ScalarProduct(2,3))'},{text:'combine 4 with 9',meaning:'RequestValue(ScalarProduct(4,9))'}],checks:[],facts:[],diagnostics:[{eventSequence:selected.sequence,problem:'The selected operation could be reused with another wording.',suggestion:'Teach a typed combine-with construction, retaining the checked product procedure.'}]});
 }}});
 try{const turn=await p.turn('what is 5*4?');assert.equal(calls,0);const result=await p.reviewLearning(turn.episodeId);assert.equal(result.changed,true);assert.equal(calls,1);assert.ok(payload.processTrace.some(e=>e.kind==='learning.independent.completed'));assert.equal(p.store.records('LearningDiagnosis').length,1);assert.equal(p.store.records('LearningReview').length,1);
 p.online=false;assert.equal(field((await p.turn('combine 7 with 8')).reply,'answer'),56);assert.equal(calls,1);
 }finally{p.close();}
});
test('diagnoses cannot claim nonexistent trace evidence or bypass concept validation',async()=>{
 const p=new Project({teacher:{fetcher:async()=>reply({reason:'An unsupported diagnosis.',clarification:null,concepts:[],examples:[],checks:[],facts:[],diagnostics:[{eventSequence:99999999,problem:'Bad step',suggestion:'Change it'}]})}});
 try{const turn=await p.turn('what is 5*4?'),result=await p.reviewLearning(turn.episodeId);assert.equal(result.changed,false);assert.match(result.error,/supplied trace event/);assert.equal(p.store.records('LearningDiagnosis').length,0);assert.ok(p.store.traces({episode:turn.episodeId}).some(e=>e.kind==='teacher.validation.failed'));assert.equal(field((await p.resume(turn.episodeId,{learn:false})).reply,'answer'),20);}finally{p.close();}
});
test('existing browser notebook migrates without losing knowledge, and backups carry trace events',async()=>{
 const SQL=await initSQL(),manifest=JSON.parse(readFileSync(new URL('../packs/manifest.json',import.meta.url),'utf8')),bundle={manifest,packs:Object.fromEntries(manifest.packs.map(n=>[n,readFileSync(new URL('../packs/'+n,import.meta.url),'utf8')]))};
 let p=new ProjectCore({store:new BrowserStore(SQL),bundle,online:false});
 try{await p.turn('what is 5*4?');p.store.db.exec('DROP TABLE trace_events; PRAGMA user_version=1;');const old=p.store.snapshot();p.close();p=new ProjectCore({store:new BrowserStore(SQL,old),bundle,online:false});
 const turn=await p.turn('what is 6*7?');assert.equal(field(turn.reply,'answer'),42);const bytes=p.store.snapshot();p.close();p=new ProjectCore({store:new BrowserStore(SQL,bytes),bundle,online:false});assert.ok(p.store.traces({episode:turn.episodeId}).some(e=>e.kind==='request.completed'));assert.equal(p.store.db.prepare('PRAGMA user_version').get().user_version,2);
 }finally{p.close();}
});

test('review respects clarification context used to resolve the original request',async()=>{
 let context;const p=new Project({online:false,teacher:{fetcher:async(url,options)=>{context=JSON.parse(JSON.parse(options.body).contents[0].parts[0].text).context;return reply({reason:'No repair needed.',clarification:null,concepts:[],examples:[],checks:[],facts:[]});}}});
 try{p.load('Concept(ContextualForm(),Construction(pattern=List(Literal("contextual number")),meaning=RequestValue(ScalarProduct(2,3)),context=Context(ChosenScope())))');const unresolved=await p.turn('contextual number');
 const {call,term}=await import('../src/ncon.mjs');p.store.put(call('Clarification',[],{target:unresolved.episodeId,context:term('Context',term('ChosenScope')),sequence:p.sequence()}));await p.resume(unresolved.episodeId,{learn:false});
 p.online=true;await p.reviewLearning(unresolved.episodeId);assert.ok(context.includes('ChosenScope'));
 }finally{p.close();}
});
test('unexpected execution failure retains a failure event and the original observation',async()=>{
 const p=new Project({online:false});try{p.load('Concept(TraceFailure(),Surface("trace failure")) Concept(RespondTo(),Realization(RespondTo(TraceFailure()),body=Native("text.concat",123)))');await assert.rejects(p.turn('trace failure'),/Expected text/);
 const exported=p.store.exportLearningHistory();assert.ok(exported.events.some(e=>e.kind==='request.failed'));assert.ok(exported.records.some(r=>r.head==='Episode'&&r.active));
 }finally{p.close();}
});
