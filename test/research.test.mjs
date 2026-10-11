import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
import initSQL from 'sql.js';import{Project}from'../src/project.mjs';import{ProjectCore}from'../src/project-core.mjs';import{BrowserStore}from'../web/store.mjs';
import{field,values,format,parse}from'../src/ncon.mjs';
const item=(id,name,aliases=[],claims={})=>({id,lastrevid:1,labels:{en:{value:name}},aliases:{en:aliases.map(value=>({value}))},claims});
const claim=(id,value,rank='normal',qualifiers={})=>({id,rank,qualifiers,mainsnak:{snaktype:'value',datavalue:{type:typeof value==='string'?'string':'wikibase-entityid',value}}});
function source({ambiguous=false,broken=false}={}){
 const calls=[],entities={P36:item('P36','capital'),Q782:item('Q782','Hawaii',['HI'],{P36:[claim('Hawaii$capital',{id:'Q18094'}),claim('old',{id:'Q999'},'deprecated')]}),Q18094:item('Q18094','Honolulu'),Q123:item('Q123','Hello Internet',['HI']),Q124:item('Q124','Hildesheim',[],{P36:[claim('wrong-prefix',{id:'Q999'})]}),P9876:item('P9876','florp'),Q900:item('Q900','Zorbia',['ZX'],{P9876:[claim('florp$test','gleeb')]}),Q901:item('Q901','Other HI',['HI'],{P36:[claim('other$capital',{id:'Q18094'})]})};
 const fetcher=async raw=>{const u=new URL(raw);calls.push(u);if(broken)throw new Error('source unavailable');const p=u.searchParams;
  if(p.get('action')==='wbsearchentities'){
   const text=p.get('search').toLowerCase(),type=p.get('type');let hits=[];
   if(type==='property')hits=Object.values(entities).filter(e=>e.id.startsWith('P')&&e.labels.en.value===text);
   else if(text==='hi')hits=[entities.Q124,entities.Q782,entities.Q123,...(ambiguous?[entities.Q901]:[])];
   else hits=Object.values(entities).filter(e=>e.id.startsWith('Q')&&[e.labels.en.value,...e.aliases.en.map(a=>a.value)].some(n=>n.toLowerCase()===text));
   return Response.json({search:hits.map(e=>({id:e.id,label:e.labels.en.value,match:{text:e.aliases.en.find(a=>a.value.toLowerCase()===text)?.value??e.labels.en.value}}))});
  }
  if(p.get('action')==='wbgetentities')return Response.json({entities:Object.fromEntries(p.get('ids').split('|').filter(id=>entities[id]).map(id=>[id,entities[id]]))});
  if(p.get('list')==='search')return Response.json({query:{search:[{title:'Photosynthesis'}]}});
  return Response.json({query:{pages:[{title:'Photosynthesis',fullurl:'https://en.wikipedia.org/wiki/Photosynthesis',extract:'Photosynthesis converts light energy into chemical energy.',revisions:[{revid:7}],pageprops:{}}]}});
 };return {calls,fetcher,entities};
}
test('the reported question learns HI from source aliases and capital from source properties',async()=>{
 const fixture=source(),p=new Project({fetcher:fixture.fetcher});try{
  const turn=await p.turn('What is the capital of hi?');assert.equal(turn.status,'resolved');assert.equal(field(turn.reply,'answer'),'Honolulu');assert.match(field(turn.reply,'text'),/interpreted “hi” as Hawaii/);
  assert.equal(values(p.store.record(turn.episodeId).expression)[0].args[0].value,'What is the capital of hi?');assert.equal(p.store.records('KnowledgeFact').length,1);
  assert.ok(fixture.calls.some(u=>u.searchParams.get('type')==='property'));assert.ok(!fixture.calls.some(u=>u.searchParams.get('search')==='what'));
  const count=fixture.calls.length;assert.equal(field((await p.turn('what is capital of Hawaii?')).reply,'answer'),'Honolulu');assert.equal(fixture.calls.length,count);
  const fact=p.store.records('KnowledgeFact')[0];p.store.retract(fact.id);assert.equal(p.store.record(turn.replyId).active,false);
 }finally{p.close();}
});
test('the same taught research procedure discovers an opaque property and entity',async()=>{
 const fixture=source(),p=new Project({fetcher:fixture.fetcher});try{
  const answer=await p.turn('what is the florp of ZX?');assert.equal(field(answer.reply,'answer'),'gleeb');assert.match(format(answer.result),/relation="florp"/);
  assert.ok(fixture.calls.some(u=>u.searchParams.get('search')==='florp'));assert.ok(p.store.records('KnowledgeFact').some(r=>field(r.expression,'display')==='gleeb'));
 }finally{p.close();}
});
test('competing exact entity aliases require clarification instead of choosing a search hit',async()=>{
 const fixture=source({ambiguous:true}),p=new Project({fetcher:fixture.fetcher});try{
  const reply=(await p.turn('what is the capital of hi?')).reply;assert.equal(field(reply,'pending'),true);assert.match(field(reply,'text'),/more than one match/);assert.equal(p.store.records('KnowledgeFact').length,0);
 }finally{p.close();}
});
test('source failures are honest, retained, and revisited after recovery',async()=>{
 let broken=true;const fixture=source(),p=new Project({fetcher:url=>broken?Promise.reject(new Error('offline source')):fixture.fetcher(url)});try{
  const first=await p.turn('what is the capital of hi?');assert.equal(first.status,'learning');assert.match(field(first.reply,'text'),/offline source/);assert.ok(p.store.agenda().some(j=>j.kind==='research'));
  broken=false;await p.exist();const replies=p.store.records('Reply').filter(r=>field(r.expression,'episode')===first.episodeId);assert.ok(replies.some(r=>field(values(r.expression)[0],'answer')==='Honolulu'));
 }finally{p.close();}
});
test('encyclopedia introductions are cited, retained, and reused as excerpts',async()=>{
 const fixture=source(),p=new Project({fetcher:fixture.fetcher});try{
  const answer=await p.turn('what is photosynthesis?');assert.equal(field(answer.reply,'research'),'excerpt');assert.match(field(answer.reply,'text'),/Photosynthesis converts/);assert.equal(p.store.records('SourceExcerpt').length,1);
  const count=fixture.calls.length;await p.turn('learn about photosynthesis');assert.equal(fixture.calls.length,count);assert.equal(field(p.store.records('SourceExcerpt')[0].expression,'license'),'CC-BY-SA-4.0');
 }finally{p.close();}
});
test('research retains qualification and excludes ended historical statements',async()=>{
 const fixture=source();fixture.entities.Q900.claims.P9876=[claim('ended','old','normal',{P582:[{datavalue:{value:{time:'+2000-01-01T00:00:00Z'}}}]}),claim('current','new','preferred',{P585:[{datavalue:{value:{time:'+2025-01-01T00:00:00Z'}}}]})];
 const p=new Project({fetcher:fixture.fetcher});try{const answer=await p.turn('what is the florp of ZX?');assert.match(field(answer.reply,'text'),/new \(source date: 2025-01-01\)/);assert.doesNotMatch(field(answer.reply,'text'),/old/);assert.match(field(p.store.records('KnowledgeFact')[0].expression,'qualifiers'),/P585/);}finally{p.close();}
});
test('learned research survives reopen and answers offline with its source evidence',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'napkin-research-')),path=join(dir,'knowledge.sqlite'),fixture=source();let p=new Project({path,fetcher:fixture.fetcher});try{
  await p.turn('what is the capital of hi?');p.close();p=new Project({path,online:false,fetcher:()=>{throw Error('must not fetch');}});assert.equal(field((await p.turn('what is the capital of HI?')).reply,'answer'),'Honolulu');
 }finally{p.close();rmSync(dir,{recursive:true,force:true});}
});
test('the browser SQLite engine retains research and a newly taught text question form',async()=>{
 const SQL=await initSQL(),manifest=JSON.parse(readFileSync(new URL('../packs/manifest.json',import.meta.url),'utf8')),bundle={manifest,packs:Object.fromEntries(manifest.packs.map(n=>[n,readFileSync(new URL('../packs/'+n,import.meta.url),'utf8')]))},fixture=source();let p=new ProjectCore({store:new BrowserStore(SQL),bundle,fetcher:fixture.fetcher});try{
  await p.teachExample('find florp for ZX',parse('FactQuestion(relation="florp",subject="ZX")'),{textSlots:true,weight:3});assert.equal(field((await p.turn('find capital for hi')).reply,'answer'),'Honolulu');
  const bytes=p.store.snapshot();p.close();p=new ProjectCore({store:new BrowserStore(SQL,bytes),bundle,online:false});assert.equal(field((await p.turn('find capital for HI')).reply,'answer'),'Honolulu');
 }finally{p.close();}
});
test('unfamiliar question forms search the whole question and label their evidence as an excerpt',async()=>{
 const fixture=source(),p=new Project({fetcher:fixture.fetcher});try{
  const reply=(await p.turn('how do moons form?')).reply;assert.equal(field(reply,'research'),'excerpt');assert.match(field(reply,'text'),/closest Wikipedia page/);assert.ok(fixture.calls.some(u=>u.searchParams.get('srsearch')==='how do moons form'));assert.ok(fixture.calls.some(u=>u.searchParams.get('search')==='moons'));assert.equal(p.store.records('KnowledgeFact').length,0);
 }finally{p.close();}
});
test('a source revision replaces learned facts and withdraws answers that depended on the old revision',async()=>{
 const fixture=source(),p=new Project({fetcher:fixture.fetcher});try{
  const first=await p.turn('what is the capital of hi?');fixture.entities.Q782.lastrevid=2;fixture.entities.Q782.claims.P36=[claim('new$capital',{id:'Q999'})];fixture.entities.Q999=item('Q999','New seat');
  p.load('Concept(ResearchPolicy(),Revision(1),CacheMilliseconds(0))');assert.equal(field((await p.turn('what is the capital of hi?')).reply,'answer'),'New seat');assert.equal(p.store.record(first.replyId).active,false);assert.ok(p.store.records('KnowledgeFact').every(r=>field(r.expression,'display')==='New seat'));
 }finally{p.close();}
});
test('research respects its taught request budget and never fabricates an answer on exhaustion',async()=>{
 const fixture=source(),p=new Project({fetcher:fixture.fetcher});try{
  p.load('Concept(ResearchPolicy(),Revision(1),MaximumRequests(2))');const result=await p.turn('what is the capital of hi?');assert.equal(result.status,'learning');assert.match(field(result.reply,'text'),/budget reached/);assert.equal(fixture.calls.length,2);assert.equal(p.store.records('KnowledgeFact').length,0);
 }finally{p.close();}
});
