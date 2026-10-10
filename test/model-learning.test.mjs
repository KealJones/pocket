import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Project } from '../src/project.mjs';
import { term,call,field,values,parse,format } from '../src/ncon.mjs';
import { capture } from '../src/ears.mjs';

const lesson=()=>({reason:'Learn a reusable operation and its phrase, with distinct example values.',clarification:null,concepts:[
 'Concept(AcquiredTwizzle(),IsA(ComputableExpression()),Realization(AcquiredTwizzle($a,$b),body=Native("number.add",Native("number.multiply",$a,2),$b)))',
 'Concept(AcquiredTwizzleForm(),Construction(pattern=List(Literal("twizzle"),Slot($a,primitive="number"),Literal("with"),Slot($b,primitive="number"),Optional(Literal("?"))),meaning=RequestValue(AcquiredTwizzle($a,$b))))'
],examples:[{text:'twizzle 3 with 4?',meaning:'RequestValue(AcquiredTwizzle(3,4))'},{text:'twizzle 8 with 2',meaning:'RequestValue(AcquiredTwizzle(8,2))'}],checks:[{input:'AcquiredTwizzle(3,4)',output:'10'},{input:'AcquiredTwizzle(8,2)',output:'18'}],facts:[]});
const transport=(packet,onCall=()=>{})=>async(url,init)=>{onCall(JSON.parse(init.body));return new Response(JSON.stringify({modelVersion:'mock-teacher',candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(typeof packet==='function'?packet():packet)}]}}]}));};
const offlineNetwork=async()=>new Response('',{status:503});
async function assist(p,text){await p.prepare();const input=capture(text),episode=p.store.put(call('Episode',[input.expression],{profile:p.profile,sequence:p.sequence()}));return p.modelLearner.assist({input,episode,analysis:await p.analyze(input)});}

test('one loop learns an unseen operation, executes same request, persists and transfers offline',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'pocket-model-')),path=join(dir,'notebook.sqlite');let calls=0;
 let p=new Project({path,online:true,teacher:{fetcher:transport(lesson(),()=>calls++)},fetcher:offlineNetwork});
 try{
  const result=await p.turn('twizzle 3 with 4?');assert.equal(field(result.reply,'answer'),10);assert.equal(calls,1);assert.equal(result.input.source,'twizzle 3 with 4?');
  assert.equal(p.store.records('LearningValidation').length,1);assert.equal(field(p.store.records('LearningValidation')[0].expression,'independentProof'),false);
  p.close();p=new Project({path,online:false});const transfer=await p.turn('twizzle 11 with 7');assert.equal(field(transfer.reply,'answer'),29);assert.equal(calls,1);
 }finally{p.close();rmSync(dir,{recursive:true,force:true});}
});
test('failed execution checks leave no live concepts and retain failed hypothesis',async()=>{
 const packet=lesson();packet.checks[1].output='99';const p=new Project({online:true,teacher:{fetcher:transport(packet)}});
 try{const result=await assist(p,'twizzle 3 with 4?');assert.equal(result.changed,false);assert.match(result.error,/Execution check failed/);assert.equal(p.store.definitions().has('AcquiredTwizzle'),false);assert.equal(p.store.records('LearningHypothesis').length,2);}finally{p.close();}
});
test('latent effects and attempts to redefine core policy are rejected',async()=>{
 for(const change of [p=>p.concepts[0]='Concept(CandidateScore(),Realization(CandidateScore($a),body=0))',p=>p.concepts[0]='Concept(AcquiredTwizzle(),IsA(ComputableExpression()),Realization(AcquiredTwizzle($a,$b),body=If(true,Native("number.add",Native("number.multiply",$a,2),$b),Native("web.fetch-evidence","https://example.org"))))']){
  const packet=lesson();change(packet);const p=new Project({online:true,teacher:{fetcher:transport(packet)}});try{const result=await assist(p,'twizzle 3 with 4?');assert.equal(result.changed,false);assert.equal(p.store.records('LearningValidation').length,0);}finally{p.close();}
 }
});
test('rejecting learning invalidates derived replies while retaining observations and counterexample',async()=>{
 const p=new Project({online:true,teacher:{fetcher:transport(lesson())},fetcher:offlineNetwork});try{
 const turn=await p.turn('twizzle 3 with 4?'),hypothesis=p.store.records('LearningHypothesis')[0];
 p.modelLearner.reject(hypothesis.id,'That is the wrong operation',{meaning:term('RequestValue',term('AcquiredTwizzle',3,4))});
 assert.equal(p.store.record(turn.episodeId).active,true);assert.equal(p.store.record(turn.replyId).active,false);assert.equal(p.store.records('Counterexample').length,1);assert.equal(p.store.definitions().has('AcquiredTwizzle'),false);
 }finally{p.close();}
});
test('source attribution checks exact evidence, supports independent facts, and answers from retained relationships',async()=>{
 let document;const packet=()=>({reason:'Read two supported relationships.',clarification:null,concepts:['Concept(AcquiredColor(),IsA(Assertion()))','Concept(AcquiredColorQuestion(),Construction(pattern=List(Literal("color of"),Slot($s,capture="text")),meaning=RequestKnowledge(AcquiredColor(subject=$s,object=Hole(role="answer")))))'],examples:[{text:'color of Miro',meaning:'RequestKnowledge(AcquiredColor(subject="Miro",object=Hole(role="answer")))'},{text:'color of Tali',meaning:'RequestKnowledge(AcquiredColor(subject="Tali",object=Hole(role="answer")))'}],checks:[],facts:[{document,quote:'Miro is blue.',meaning:'AcquiredColor(subject="Miro",object="blue")'},{document,quote:'Tali is green.',meaning:'AcquiredColor(subject="Tali",object="green")'}]});
 const p=new Project({online:true,teacher:{fetcher:transport(packet)}});try{
 document=p.store.put(call('SourceExcerpt',['Miro is blue. Tali is green.'],{url:'https://example.org',license:'test'}));
 assert.equal((await assist(p,'color of Miro')).changed,true);p.online=false;
 assert.equal(field((await p.turn('color of Tali')).reply,'answer'),'green');
 p.store.retract(document);assert.equal(p.store.records('AttributedMeaning').length,0);
 }finally{p.close();}
});
test('unavailable teacher leaves resumable work, not fabricated learning',async()=>{
 const p=new Project({online:true,teacher:{fetcher:async()=>new Response('',{status:429})}});try{const result=await assist(p,'unfamiliar input');assert.match(result.error,/429/);assert.equal(p.store.records('LearningValidation').length,0);assert.ok(p.store.agenda().some(j=>j.kind==='model-learning'&&j.status==='waiting'));}finally{p.close();}
});

test('Pocket learns from source outcomes and executes before considering Gemini',async()=>{
 const order=[];const p=new Project({online:true,teacher:{fetcher:async()=>{order.push('teacher');throw new Error('Teacher must not be needed');}},fetcher:async url=>{
 order.push('source');assert.match(String(url),/datasets-server.huggingface/);
 return Response.json({rows:[{row_idx:1,row:{question:'2 florp 3',answer:5}},{row_idx:2,row:{question:'7 florp 4',answer:11}}]});
 }});
 try{assert.equal(field((await p.turn('9 florp 8')).reply,'answer'),17);assert.deepEqual(order,['source']);p.modelLearner.enabled=false;assert.equal(field((await p.turn('20 florp 30')).reply,'answer'),50);assert.deepEqual(order,['source']);}finally{p.close();}
});
test('known concept realizations never call Gemini even when it is available',async()=>{
 let calls=0;const p=new Project({online:true,teacher:{fetcher:async()=>{calls++;throw new Error('Unexpected teacher');}},fetcher:offlineNetwork});
 try{assert.equal(field((await p.turn('what is 5*4?')).reply,'answer'),20);assert.equal(calls,0);}finally{p.close();}
});
test('the teacher receives source evidence only after independent acquisition has run',async()=>{
 const order=[];const p=new Project({online:true,fetcher:async()=>{order.push('source');return new Response('',{status:503});},teacher:{fetcher:transport(lesson(),()=>order.push('teacher'))}});
 try{assert.equal(field((await p.turn('twizzle 3 with 4?')).reply,'answer'),10);assert.equal(order.at(-1),'teacher');assert.equal(order[0],'source');assert.equal(order.filter(x=>x==='teacher').length,1);}finally{p.close();}
});

test('validation feedback repairs a rejected proposal before installing anything',async()=>{
 let calls=0;const p=new Project({online:true,teacher:{fetcher:transport(()=>{calls++;const packet=lesson();if(calls===1)packet.checks[1].output='99';return packet;})}});
 try{assert.equal((await assist(p,'twizzle 3 with 4?')).changed,true);assert.equal(calls,2);assert.equal(p.store.records('LearningValidation').length,1);assert.equal(p.store.records('LearningFailure').length,1);}finally{p.close();}
});
test('a withdrawn operation cannot be reinstalled just by renaming its concepts',async()=>{
 let packet=lesson();const p=new Project({online:true,teacher:{fetcher:transport(()=>packet)}});
 try{assert.equal((await assist(p,'twizzle 3 with 4?')).changed,true);const hypothesis=p.store.records('LearningHypothesis')[0];p.modelLearner.reject(hypothesis.id,'Wrong rule');
 packet=JSON.parse(JSON.stringify(packet).replaceAll('AcquiredTwizzle','AcquiredReplacement'));
 const result=await assist(p,'twizzle 3 with 4?');assert.equal(result.changed,false);assert.match(result.error,/withdrawn learning/);assert.equal(p.store.definitions().has('AcquiredReplacement'),false);
 }finally{p.close();}
});

test('whole-question answers cannot masquerade as learned lexical meanings',async()=>{
 const packet={reason:'A shortcut',clarification:null,concepts:['Concept(AcquiredShortcut(),Surface("twizzle 3 with 4?"),Denotes(10))'],examples:[],checks:[],facts:[]};
 const p=new Project({online:true,teacher:{fetcher:transport(packet)}});try{const result=await assist(p,'twizzle 3 with 4?');assert.equal(result.changed,false);assert.match(result.error,/not memorize/);assert.equal(p.store.definitions().has('AcquiredShortcut'),false);}finally{p.close();}
});
