import test from 'node:test';
import assert from 'node:assert/strict';
import { Project } from '../src/project.mjs';
import { field, parse, term } from '../src/ncon.mjs';

test('checked execution receives a supported estimate without calling a teacher',async()=>{
 let calls=0;const p=new Project({online:true,teacher:{fetcher:async()=>{calls++;throw Error('unexpected teacher');}}});
 try{const turn=await p.turn('what is 5*4?');assert.equal(field(turn.reply,'answer'),20);assert.ok(turn.assessment.score>0.8);assert.equal(field(turn.assessment.expression,'calibrated'),false);assert.equal(calls,0);assert.ok(turn.assessment.reasons.some(r=>r.includes('checked procedure')));}finally{p.close();}
});
test('missing answer roles lower the estimate and remain independent learning work',async()=>{
 const p=new Project({online:false});try{
 await p.teachExample('color of Miro',parse('RequestKnowledge(Color(subject="Miro",object=Hole(role="answer")))'),{textSlots:true});
 const turn=await p.turn('color of Tali');assert.equal(turn.status,'learning');assert.ok(turn.assessment.score<0.5);assert.ok(turn.assessment.reasons.some(r=>r.includes('not been bound')));
 }finally{p.close();}
});
test('failed actions receive low estimates and do not ask Gemini to repair an HTTP failure',async()=>{
 let calls=0;const p=new Project({online:true,fetcher:async()=>new Response('',{status:503}),teacher:{fetcher:async()=>{calls++;throw Error('unexpected teacher');}}});
 try{const turn=await p.turn('fetch https://example.org');assert.equal(turn.reply.head,'FetchFailed');assert.ok(turn.assessment.score<0.5);assert.equal(turn.assessment.review,false);assert.equal(calls,0);}finally{p.close();}
});
test('optional critique is retained separately and does not reward or invent facts',async()=>{
 let calls=0;const p=new Project({online:true,fetcher:async()=>new Response('',{status:503}),teacher:{fetcher:async()=>{
 calls++;return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({reason:'The requested relationship is missing; more source evidence is needed.',clarification:null,concepts:[],examples:[],checks:[],facts:[]})}]}}]});
 }}});
 try{await p.teachExample('color of Miro',parse('RequestKnowledge(Color(subject="Miro",object=Hole(role="answer")))'),{textSlots:true});const turn=await p.turn('color of Tali');assert.equal(calls,1);assert.equal(p.store.records('AnswerCritique').length,1);assert.equal(p.store.records('Feedback').length,0);assert.equal(p.store.records('AttributedMeaning').length,0);assert.equal(turn.status,'learning');}finally{p.close();}
});
