import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync}from'node:fs';import initSQL from'sql.js';
import {Project}from'../src/project.mjs';import{ProjectCore}from'../src/project-core.mjs';import{BrowserStore}from'../web/store.mjs';
import{field,values,format}from'../src/ncon.mjs';
const entity=(id,name,aliases=[],claims={})=>({id,lastrevid:1,labels:{en:{value:name}},aliases:{en:aliases.map(value=>({value}))},claims});
const link=(id,target)=>({id,rank:'normal',mainsnak:{snaktype:'value',datavalue:{type:'wikibase-entityid',value:{id:target}}}});
const quantity=(id,amount,unit='1')=>({id,rank:'normal',mainsnak:{snaktype:'value',datavalue:{type:'quantity',value:{amount,unit}}}});
function source({ambiguous=true}={}){
 const calls=[],entities={
  Q1:entity('Q1','Disney Wonder',[],{P31:[link('ship$type','Q3')],P7777:[quantity('ship$length','+294','http://www.wikidata.org/entity/Q8')],P7778:[quantity('ship$width','+32','http://www.wikidata.org/entity/Q8')],P7779:[quantity('ship$gross','+83000')]}),
  Q2:entity('Q2','Wonder Man',['Disney Wonder'],{P31:[link('series$type','Q4')]}),
  Q3:entity('Q3','cruise ship',[],{P279:[link('ship$craft','Q5')]}),Q4:entity('Q4','television series'),Q5:entity('Q5','watercraft'),
  Q8:entity('Q8','metre'),Q9:entity('Q9','kilogram'),P7777:entity('P7777','overall extent',['length']),P7778:entity('P7778','width'),P7779:entity('P7779','gross tonnage'),P7780:entity('P7780','mass'),P7781:entity('P7781','unrelated statistic'),
  Q30:entity('Q30','Opaque Machine',['ZX'],{P7780:[quantity('opaque$mass','+9','http://www.wikidata.org/entity/Q9')],P7781:[quantity('opaque$other','+123')]})};
 entities.Q1.sitelinks={enwiki:{title:'Disney Wonder'}};entities.Q2.sitelinks={enwiki:{title:'Wonder Man (TV series)'}};
 const fetcher=async raw=>{
  const u=new URL(raw),p=u.searchParams;calls.push(u);
  if(p.get('action')==='wbsearchentities'){
   const q=p.get('search').toLowerCase();let matches=Object.values(entities).filter(e=>[e.labels.en.value,...e.aliases.en.map(a=>a.value)].some(s=>s.toLowerCase()===q));
   if(!ambiguous)matches=matches.filter(e=>e.id!=='Q2');
   return Response.json({search:matches.map(e=>({id:e.id,label:e.labels.en.value,match:{text:e.aliases.en.find(a=>a.value.toLowerCase()===q)?.value??e.labels.en.value}}))});
  }
  if(p.get('action')==='wbgetentities')return Response.json({entities:Object.fromEntries(p.get('ids').split('|').filter(id=>entities[id]).map(id=>[id,entities[id]]))});
  if(p.get('list')==='search')return Response.json({query:{search:[{title:'Wonder Man (TV series)'}]}});
  if(p.get('prop')?.includes('extracts')){
   const title=p.get('titles');return Response.json({query:{pages:[{title,fullurl:'https://en.wikipedia.org/wiki/'+encodeURIComponent(title),extract:title==='Disney Wonder'?'Disney Wonder is a cruise ship.':'Wonder Man is a television series.',revisions:[{revid:7}],pageprops:{}}]}});
  }
  throw new Error('Unexpected source request: '+u.href);
 };return{calls,entities,fetcher};
}
test('competing referents are named, and no the boat answers the original size question',async()=>{
 const f=source(),p=new Project({fetcher:f.fetcher,profile:'keal'});try{
  const first=await p.turn('How big is the Disney wonder?');assert.equal(first.status,'learning');assert.match(field(first.reply,'text'),/Do you mean/);assert.match(field(first.reply,'text'),/television series/);assert.match(field(first.reply,'text'),/cruise ship/);assert.equal(p.store.records('KnowledgeFact').length,0);
  const corrected=await p.turn('no the boat');assert.equal(corrected.status,'resolved');assert.equal(field(corrected.reply,'clarifiedEpisode'),first.episodeId);assert.match(field(corrected.reply,'text'),/294 metre/);assert.match(field(corrected.reply,'text'),/gross tonnage: 83000/);assert.doesNotMatch(field(corrected.reply,'text'),/Wonder Man/);
  assert.equal(p.store.records('KnowledgeFact').length,3);assert.equal(p.store.record(first.replyId).active,false);assert.ok(p.store.records('RejectedReply').length);
  assert.equal(values(values(p.store.record(first.episodeId).expression)[0])[0],'How big is the Disney wonder?');assert.equal(corrected.input.source,'no the boat');
  const count=f.calls.length;p.online=false;assert.match(field((await p.resume(first.episodeId)).reply,'text'),/294 metre/);assert.equal(f.calls.length,count);
 }finally{p.close();}
});
test('a unique exact name answers directly, and source facets/units generalize to another entity',async()=>{
 const f=source({ambiguous:false}),p=new Project({fetcher:f.fetcher});try{
  const first=await p.turn('how big is the Disney wonder?');assert.equal(first.status,'resolved');assert.match(field(first.reply,'text'),/overall extent: 294 metre/);
  assert.ok(!f.calls.some(u=>u.hostname==='en.wikipedia.org'));assert.ok(!f.calls.some(u=>u.searchParams.get('search')==='big'));
  const other=await p.turn('how big is ZX?');assert.match(field(other.reply,'text'),/mass: 9 kilogram/);assert.doesNotMatch(field(other.reply,'text'),/123/);
  const unit=p.store.records('SourceEntity').find(r=>field(r.expression,'externalId')==='Q9');p.store.retract(unit.id);assert.equal(p.store.record(other.replyId).active,false);assert.equal(p.store.record(other.episodeId).active,true);
 }finally{p.close();}
});
test('correction can replace an already completed answer and retires its query cache, not source facts',async()=>{
 const f=source({ambiguous:false}),p=new Project({fetcher:f.fetcher});try{
  const first=await p.turn('how big is Disney Wonder?');assert.equal(first.status,'resolved');const oldAnswer=field(first.reply,'evidence');
  const corrected=await p.turn('no, the boat');assert.equal(field(corrected.reply,'clarifiedEpisode'),first.episodeId);assert.equal(corrected.status,'resolved');assert.equal(p.store.record(oldAnswer).active,false);assert.equal(p.store.record(first.replyId).active,false);
  assert.ok(p.store.records('KnowledgeFact').length>=3);const clarification=p.store.record(corrected.clarification);p.store.retract(clarification.id);assert.equal(p.store.record(corrected.replyId).active,false);assert.equal(p.store.record(first.episodeId).active,true);
 }finally{p.close();}
});
test('a weak Wikipedia match remains a preview; correction selects a source-linked page of the supplied kind',async()=>{
 const f=source(),p=new Project({fetcher:f.fetcher});try{
  const first=await p.turn('what is Disney Wonder?');assert.equal(first.status,'learning');assert.match(field(first.reply,'text'),/closest Wikipedia page/);assert.match(field(first.reply,'text'),/Is that the subject you meant/);assert.equal(p.store.records('ResearchAnswer').length,0);
  const corrected=await p.turn('I mean the boat');assert.equal(corrected.status,'resolved');assert.match(field(corrected.reply,'text'),/Disney Wonder is a cruise ship/);assert.doesNotMatch(field(corrected.reply,'text'),/Wonder Man/);assert.equal(field(corrected.reply,'clarifiedEpisode'),first.episodeId);
  assert.ok(f.calls.some(u=>u.searchParams.get('sitefilter')==='enwiki'));
 }finally{p.close();}
});
test('a correction with no applicable preceding question does not invent or change an unrelated subject',async()=>{
 const p=new Project({online:false});try{
  await p.turn('hello');const follow=await p.turn('no the boat');assert.equal(follow.clarification,undefined);assert.equal(field(follow.reply,'clarifiedEpisode'),undefined);assert.equal(follow.status,'learning');assert.equal(p.store.records('Reading').find(r=>r.id===follow.readingId).expression.args.find(a=>a.name==='contextRejected').value.head,'List');
 }finally{p.close();}
});
test('unsupported kinds and measurement acquisition bounds remain pending without wrong-subject fallback',async()=>{
 const f=source(),p=new Project({fetcher:f.fetcher});try{
  const first=await p.turn('how big is Disney Wonder?');const follow=await p.turn('no the spaceship');assert.equal(follow.status,'learning');assert.doesNotMatch(field(follow.reply,'text'),/83000/);assert.equal(p.store.records('KnowledgeFact').length,0);
  const recovery=await p.turn('no the boat');assert.equal(recovery.status,'resolved');assert.equal(field(recovery.reply,'clarifiedEpisode'),first.episodeId);
  p.load('Concept(ResearchPolicy(),Revision(1),MaximumMeasurements(0))');const bound=await p.turn('how big is ZX?');assert.equal(bound.status,'learning');assert.match(field(bound.reply,'text'),/budget reached/);
 }finally{p.close();}
});
test('a bare kind offered by the source selects that interpretation without an authored ship keyword',async()=>{
 const f=source(),p=new Project({fetcher:f.fetcher});try{
  const first=await p.turn('how big is the Disney Wonder?');assert.equal(first.status,'learning');
  const choice=await p.turn('cruise ship');assert.equal(choice.status,'resolved');assert.equal(field(choice.reply,'clarifiedEpisode'),first.episodeId);assert.match(field(choice.reply,'text'),/294 metre/);
  assert.ok(p.store.records('Concept').some(r=>r.source==='derived:offered-kind'));
  const next=await p.turn('how big is the Disney Wonder?');assert.equal(next.status,'learning');
  assert.equal(field((await p.turn('the cruise ship')).reply,'clarifiedEpisode'),next.episodeId);
 }finally{p.close();}
});
test('measurement facts and the chosen referent survive actual browser SQLite reopen',async()=>{
 const SQL=await initSQL(),manifest=JSON.parse(readFileSync(new URL('../packs/manifest.json',import.meta.url),'utf8')),bundle={manifest,packs:Object.fromEntries(manifest.packs.map(n=>[n,readFileSync(new URL('../packs/'+n,import.meta.url),'utf8')]))},f=source();
 let p=new ProjectCore({store:new BrowserStore(SQL),bundle,fetcher:f.fetcher,profile:'keal'});try{
  const first=await p.turn('how big is the Disney Wonder?');await p.turn('no the boat');const bytes=p.store.snapshot();p.close();p=new ProjectCore({store:new BrowserStore(SQL,bytes),bundle,online:false,profile:'keal'});
  const resumed=await p.resume(first.episodeId);assert.equal(resumed.status,'resolved');assert.match(field(resumed.reply,'text'),/294 metre/);assert.match(format(resumed.result),/kind="watercraft"/);
 }finally{p.close();}
});
test('source material cannot authorize context argument overrides or change measurement limits',()=>{
 const p=new Project({online:false});try{
  for(const text of ['Concept(X(),ContextualArgument("kind"))','ArgumentHint(name="kind",value="ship")','Concept(ResearchPolicy(),MaximumMeasurements(1000))','RejectedReply(reply="x")'])assert.throws(()=>p.load(text,{trusted:false}),/Evidence cannot install/);
 }finally{p.close();}
});

test('a resolved unrelated reading cannot borrow a search runner-up to authorize a correction',async()=>{
 const p=new Project({online:false,profile:'keal'});try{
  const first=await p.turn('what time is it');assert.equal(first.status,'resolved');
  const correction=await p.turn('no the boat');assert.equal(correction.clarification,undefined);
  assert.equal(p.store.records('Clarification').length,0);assert.ok(values(field(p.store.record(correction.readingId).expression,'contextRejected')).length);
  assert.equal(p.store.record(first.replyId).active,true);
 }finally{p.close();}
});
test('correction eligibility stays within the profile and original observation order when replaying',async()=>{
 const p=new Project({online:false,profile:'keal'});try{
  const early=await p.turn('no the boat');assert.equal(early.clarification,undefined);
  await p.turn('what is Disney Wonder');
  const replay=await p.resume(early.episodeId,{learn:false});assert.equal(replay.clarification,undefined);
  const other=await p.turn('no the boat',{profile:'another-person'});assert.equal(other.clarification,undefined);
  assert.equal(p.store.records('Clarification').length,0);
 }finally{p.close();}
});
