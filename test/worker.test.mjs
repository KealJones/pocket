import test from 'node:test';import assert from 'node:assert/strict';
import {createWorker,retrieve,publicAddress} from '../worker/index.mjs';
test('server retrieval checks public URLs, redirects, HTTP errors, and byte limits',async()=>{
  for(const url of ['file:///etc/passwd','http://localhost/','http://127.0.0.1/','http://10.0.0.1/','https://user:pass@example.org','http://example.org:8080'])assert.throws(()=>publicAddress(url));
  await assert.rejects(retrieve('https://example.org',async()=>new Response('',{status:302,headers:{location:'http://127.0.0.1/'}})),/Local addresses/);
  await assert.rejects(retrieve('https://example.org',async()=>new Response('large'.repeat(250000))),/byte budget/);
  await assert.rejects(retrieve('https://example.org',async()=>new Response('no',{status:429})),/HTTP 429/);
});
test('private Site transport forwards source bytes but no visitor authentication',async()=>{
  let options;const worker=createWorker({},async(url,o)=>{options=o;return new Response('real source',{headers:{'content-type':'text/plain'}});});
  const response=await worker.fetch(new Request('https://napkin.test/api/fetch',{method:'POST',headers:{cookie:'private',authorization:'secret'},body:JSON.stringify({url:'https://example.org/'})}));
  assert.equal(await response.text(),'real source');assert.equal(response.headers.get('x-napkin-source-url'),'https://example.org/');assert.equal(options.headers.cookie,undefined);assert.equal(options.headers.authorization,undefined);
});
