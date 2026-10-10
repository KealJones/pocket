import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import initSQL from 'sql.js';
import {Project} from '../src/project.mjs';
import {ProjectCore} from '../src/project-core.mjs';
import {BrowserStore} from '../web/store.mjs';
import {field,format,values,parse} from '../src/ncon.mjs';
const examples=[{input:'what is 2 plus 3?',output:5},{input:'what is 7 plus 4?',output:11}];
test('an unknown question learns a program from varied outcomes and solves unseen inputs',async()=>{
  const p=new Project({online:false});try{
    assert.equal((await p.turn('what is 2 plus 2?')).status,'learning');
    assert.equal(p.store.records('WorkedExample').length,0);
    assert.equal(p.store.parts('Respond','Construction').length,0);
    const lesson=await p.teachOutcomes(examples);assert.equal(lesson.learned.length,1);
    assert.match(format(lesson.learned[0].program),/number.add/);
    for(const [input,result]of [['what is 2 plus 2?',4],['what is 49 plus 18?',67],['what is 1.5 plus 2.25?',3.75]])assert.equal(field((await p.turn(input)).reply,'answer'),result);
  }finally{p.close();}
});
test('opaque words learn from outcomes without English operator dispatch',async()=>{
  const p=new Project({online:false});try{
    await p.teachOutcomes([{input:'9 florp 4',output:5},{input:'8 florp 2',output:6}]);
    assert.equal(field((await p.turn('31 florp 9')).reply,'answer'),22);
  }finally{p.close();}
});
test('insufficient or ambiguous evidence never selects a procedure',async()=>{
  const p=new Project({online:false});try{
    const first=await p.teachOutcomes([{input:'2 florp 2',output:4}]);assert.equal(first.learned.length,0);
    assert.equal((await p.turn('3 florp 5')).status,'learning');
    await p.teachOutcomes([{input:'3 florp 3',output:6}]);assert.equal(field((await p.turn('3 florp 5')).reply,'answer'),8);
  }finally{p.close();}
});
test('counterexamples withdraw the procedure, its readings, and its replies',async()=>{
  const p=new Project({online:false});try{
    const training=await p.teachOutcomes(examples), turn=await p.turn('what is 2 plus 2?');
    const retrain=await p.teachOutcomes([{input:'what is 3 plus 5?',output:999}]);assert.equal(retrain.learned.length,0);
    assert.equal(p.store.record(training.learned[0].id).active,false);assert.equal(p.store.record(turn.replyId).active,false);
    assert.equal((await p.resume(turn.episodeId)).status,'learning');
  }finally{p.close();}
});
test('outcome evidence and its learned execution survive a SQLite reopen',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'napkin-induction-')),path=join(dir,'knowledge.sqlite');let p=new Project({path,online:false});
  try{await p.teachOutcomes(examples);p.close();p=new Project({path,online:false});assert.equal(field((await p.turn('what is 2 plus 2?')).reply,'answer'),4);}finally{p.close();rmSync(dir,{recursive:true,force:true});}
});
test('internet dataset acquisition ignores operation hints and excludes the requested operands',async()=>{
  let calls=0;const p=new Project({fetcher:async url=>{calls++;assert.match(url,/datasets-server.huggingface/);return Response.json({rows:[
    {row_idx:0,row:{question:'what is 2 plus 2?',answer:444,op:'bad hint'}},
    ...examples.map((e,i)=>({row_idx:i+1,row:{question:e.input,answer:e.output,op:'number.multiply'}}))
  ]});}});
  try{
    const first=await p.turn('what is 2 plus 2?');assert.equal(field(first.reply,'answer'),4);assert.equal(p.store.records('WorkedExample').length,2);
    assert.equal(calls,1);assert.equal(field(p.store.records('SourceExamples')[0].expression,'license'),'MIT');
    assert.equal(field((await p.turn('what is 89 plus 13?')).reply,'answer'),102);assert.equal(calls,1);
    const source=p.store.records('SourceExamples')[0];p.store.retract(source.id);assert.equal(p.store.record(first.replyId).active,false);
  }finally{p.close();}
});
test('numeric program induction is retained by the actual browser SQLite engine',async()=>{
  const SQL=await initSQL(),manifest=JSON.parse(readFileSync(new URL('../packs/manifest.json',import.meta.url),'utf8'));
  const bundle={manifest,packs:Object.fromEntries(manifest.packs.map(name=>[name,readFileSync(new URL('../packs/'+name,import.meta.url),'utf8')]))};
  let p=new ProjectCore({store:new BrowserStore(SQL),bundle,online:false});try{await p.teachOutcomes(examples);const bytes=p.store.snapshot();p.close();p=new ProjectCore({store:new BrowserStore(SQL,bytes),bundle,online:false});assert.equal(field((await p.turn('what is 2 plus 2?')).reply,'answer'),4);}finally{p.close();}
});
test('search budget exhaustion cannot install a guessed procedure',async()=>{
  const p=new Project({online:false});try{p.load('Concept(InductionPolicy(),Revision(1),MinimumExamples(2),MaximumExpressions(1))');const result=await p.teachOutcomes(examples);assert.equal(result.learned.length,0);assert.match(result.pending[0].reason,/budget/);}finally{p.close();}
});
