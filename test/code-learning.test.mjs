import test from 'node:test';import assert from 'node:assert/strict';
import {Project} from '../src/project.mjs';import {parse,field,format} from '../src/ncon.mjs';
test('starter fetch uses the normal code-example learner and executes another URL',async()=>{
  const requests=[],p=new Project({online:false,fetcher:async url=>{requests.push(url);return new Response('source bytes');}});
  try{
    assert.equal(p.store.parts('FetchPage','Realization').length,0);
    const turn=await p.turn('fetch https://example.net/document');
    assert.equal(turn.status,'resolved');assert.equal(field(turn.reply,'text'),'source bytes');assert.deepEqual(requests,['https://example.net/document']);
    assert.equal(p.store.records('CodeExample').length,1);assert.equal(p.store.parts('FetchPage','Realization').length,1);
    const code=p.store.records('CodeExample')[0];p.store.retract(code.id);assert.equal(p.store.record(turn.replyId).active,false);
    assert.equal(p.store.parts('FetchPage','Realization').length,0);
  }finally{p.close();}
});
test('a supplied code example learns its phrase and installs a checked realization',async()=>{
  const p=new Project({online:false});try{
    const lesson=await p.teachCode({input:'retrieve https://example.org',meaning:parse('FetchPage(target=WebAddress("https://example.org"))'),pattern:parse('FetchPage(target=$address)'),body:parse('Native("term.format",Quote($address))'),checks:[{input:parse('FetchPage(target=WebAddress("https://example.net"))'),output:'WebAddress("https://example.net")'}]});
    assert.match(format(lesson.declaration),/Realization/);assert.match(format(lesson.lesson.declaration),/Slot/);
    await assert.rejects(p.teachCode({input:'bad',meaning:parse('Bad()'),pattern:parse('Bad()'),body:parse('Native("shell.exec","oops")')}),/unsupported operation/);
    assert.equal(p.store.parts('Bad','Realization').length,0);
  }finally{p.close();}
});
test('retrieved text cannot install a realization or override starter teaching',()=>{
  const p=new Project({online:false});try{for(const code of ['Concept(Evil(),ValidatedRealization(Evil(),body=1))','StarterProcedure("x",X(),X(),1)'])assert.throws(()=>p.load(code,{trusted:false}),/Evidence cannot install/);}finally{p.close();}
});
test('conflicting learned implementations remain unresolved and are not executed',async()=>{
  let calls=0;const p=new Project({online:false,fetcher:async()=>{calls++;return new Response('source');}});
  try{
    await p.prepare();await p.teachCode({input:'retrieve https://example.org',meaning:parse('FetchPage(target=WebAddress("https://example.org"))'),pattern:parse('FetchPage(target=$address)'),body:parse('Native("term.format",Quote($address))')});
    const turn=await p.turn('fetch https://example.net');assert.match(field(turn.reply,'text'),/realizations disagree/);assert.equal(calls,0);
  }finally{p.close();}
});
