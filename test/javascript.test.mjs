import test from 'node:test';import assert from 'node:assert/strict';
import {Project} from '../src/project.mjs';import {parse,field,format} from '../src/ncon.mjs';
test('a JavaScript fetch example becomes a reusable concept realization',async()=>{
  const calls=[],p=new Project({online:false,fetcher:async url=>{calls.push(url);return new Response('fetched content');}});
  try{
    const result=await p.teachCode({input:'retrieve https://example.org',meaning:parse('FetchText(target=WebAddress("https://example.org"))'),pattern:parse('FetchText(target=$address)'),language:'javascript',code:'async function fetchText(url) { const response = await fetch(url); return await response.text(); }'});
    assert.equal(calls.length,0);assert.match(format(result.declaration),/Let\(/);assert.match(format(result.declaration),/web.response-text/);
    const reply=(await p.turn('retrieve https://example.net/other')).reply;assert.equal(field(reply,'text'),'fetched content');assert.deepEqual(calls,['https://example.net/other']);
    assert.equal(field(p.store.record(result.evidence).expression,'language'),'javascript');assert.match(field(p.store.record(result.evidence).expression,'originalCode'),/async function/);
  }finally{p.close();}
});
test('numeric JavaScript is checked, retained, and applied to new numeric inputs',async()=>{
  const p=new Project({online:false});try{
    await p.teachCode({input:'combine 2 and 3',meaning:parse('Combine(2,3)'),pattern:parse('Combine($left,$right)'),language:'javascript',code:'(a, b) => a + b',checks:[{input:parse('Combine(7,4)'),output:11}]});
    assert.equal(field((await p.turn('combine 17 and 9')).reply,'answer'),26);
    await assert.rejects(p.teachCode({input:'combine 2 and 3',meaning:parse('Combine(2,3)'),pattern:parse('Combine($left,$right)'),language:'javascript',code:'(a,b) => a*b',checks:[{input:parse('Combine(7,4)'),output:11}]}),/failed.*check/);
  }finally{p.close();}
});
test('unsupported JavaScript cannot execute host APIs or install a realization',async()=>{
  const p=new Project({online:false});try{
    for(const code of ['x => eval(x)','x => window.location','x => { while(true) {} return x; }','x => fetch(x, {method:"POST"})'])await assert.rejects(p.teachCode({input:'inspect https://example.org',meaning:parse('Inspect(WebAddress("https://example.org"))'),pattern:parse('Inspect($url)'),language:'javascript',code}),/Unsupported/);
    assert.equal(p.store.parts('Inspect','Realization').length,0);
  }finally{p.close();}
});
