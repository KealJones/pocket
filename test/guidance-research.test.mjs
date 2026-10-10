import test from'node:test';import assert from'node:assert/strict';import{Project}from'../src/project.mjs';import{field,values,format}from'../src/ncon.mjs';
const entity=(id,name,aliases=[],claims={})=>({id,lastrevid:1,labels:{en:{value:name}},aliases:{en:aliases.map(value=>({value}))},claims});
const link=(id,target,rank='normal')=>({id,rank,mainsnak:{snaktype:'value',datavalue:{type:'wikibase-entityid',value:{id:target}}}});
function source({paginate=false,ambiguous=false,fail=false}={}){
 const calls=[],entities={
 P9001:entity('P9001','handled, mitigated, or managed by',['managed by','handled by'],{P1659:[link('root$related','P8080')]}),P8080:entity('P8080','alternate response method'),
 Q1:entity('Q1','widget fault',['blorf'],{P9001:[link('fault$repair','Q2')],P8080:[link('fault$extra','Q3')],P9999:[link('fault$irrelevant','Q4')]}),
 Q2:entity('Q2','replace the spring'),Q3:entity('Q3','reset the assembly'),Q4:entity('Q4','irrelevant statistical category'),
 Q5:entity('Q5','Blorf',['blorf']),Q6:entity('Q6','other blorf',['blorf'],{P9001:[link('other$response','Q4')]}),
 Q7:entity('Q7','florp malfunction',[],{P8080:[link('florp$fix','Q3')]})};
 const fetcher=async raw=>{const u=new URL(raw);calls.push(u);if(fail)throw Error('temporarily unavailable');const p=u.searchParams;
 if(p.get('action')==='wbsearchentities'){
 const text=p.get('search').toLowerCase(),property=p.get('type')==='property';let hits=Object.values(entities).filter(e=>e.id.startsWith(property?'P':'Q')&&[e.labels.en.value,...e.aliases.en.map(a=>a.value)].some(n=>n.toLowerCase()===text));
 if(!ambiguous)hits=hits.filter(e=>e.id!=='Q6');
 if(paginate&&text==='blorf'){if(!p.has('continue'))return Response.json({search:[{id:'Q5',label:'Blorf',match:{text:'blorf'}}],'search-continue':1});hits=hits.filter(e=>e.id==='Q1');}
 return Response.json({search:hits.map(e=>({id:e.id,label:e.labels.en.value,match:{text:e.aliases.en.find(a=>a.value.toLowerCase()===text)?.value??e.labels.en.value}}))});
 }
 if(p.get('action')==='wbgetentities')return Response.json({entities:Object.fromEntries(p.get('ids').split('|').filter(id=>entities[id]).map(id=>[id,entities[id]]))});
 throw Error('Unexpected request '+u.href);
 };return{fetcher,calls,entities};
}
test('guidance clauses compose, discover a source relationship and related properties, and retain unrelated knowledge',async()=>{
 const f=source(),progress=[],p=new Project({fetcher:f.fetcher,onProgress:s=>progress.push(s)});try{
 const q=await p.turn('I got a blorf what should I do?');assert.equal(q.status,'resolved');assert.match(format(q.result),/subject="blorf"/);assert.match(field(q.reply,'text'),/replace the spring/);assert.match(field(q.reply,'text'),/reset the assembly/);assert.doesNotMatch(field(q.reply,'text'),/irrelevant statistical/);
 assert.equal(q.input.source,'I got a blorf what should I do?');assert.equal(p.store.records('KnowledgeFact').length,2);assert.ok(p.store.records('SourceClaim').some(r=>field(r.expression,'statement')==='fault$irrelevant'));
 assert.ok(p.store.records('RelationPath').length);assert.ok(p.store.records('RelationBinding').length);assert.ok(progress.some(s=>s.stage==='retained'));
 const count=f.calls.length;p.online=false;
 for(const text of ['I have a blorf, what can I do?','what should I do about blorf?','how can I handle blorf?','how to fix a blorf?']){const r=await p.turn(text);assert.equal(r.status,'resolved',text);assert.match(field(r.reply,'text'),/replace the spring/);}
 assert.equal(f.calls.length,count);p.online=true;const other=await p.turn('I encountered florp malfunction what do I do?');assert.equal(other.status,'resolved');assert.match(field(other.reply,'text'),/reset the assembly/);
 const root=p.store.records('SourceEntity').find(r=>field(r.expression,'externalId')==='P9001');p.store.retract(root.id);assert.equal(p.store.record(q.replyId).active,false);assert.equal(p.store.record(q.episodeId).active,true);
 }finally{p.close();}
});
test('candidate acquisition follows source pagination rather than choosing the first page of homonyms',async()=>{
 const f=source({paginate:true}),p=new Project({fetcher:f.fetcher});try{const q=await p.turn('I got a blorf what should I do?');assert.equal(q.status,'resolved');assert.ok(f.calls.some(u=>u.searchParams.get('continue')==='1'));assert.match(field(q.reply,'text'),/replace the spring/);}finally{p.close();}
});
test('unexamined pages and conflicting situations remain investigation, not a made-up method',async()=>{
 const f=source({paginate:true}),p=new Project({fetcher:f.fetcher});try{p.load('Concept(ResearchPolicy(),Revision(1),MaximumSearchPages(1))');const q=await p.turn('I got a blorf what should I do?');assert.equal(q.status,'learning');assert.match(field(q.reply,'text'),/unexamined meanings/);assert.equal(p.store.records('KnowledgeFact').length,0);}finally{p.close();}
 const g=source({ambiguous:true}),other=new Project({fetcher:g.fetcher});try{const q=await other.turn('I got a blorf what should I do?');assert.equal(q.status,'learning');assert.equal(field(q.reply,'research'),'ambiguous');assert.equal(other.store.records('KnowledgeFact').length,0);}finally{other.close();}
});
test('related-property acquisition failure does not silently pretend that no method exists',async()=>{
 const f=source(),p=new Project({fetcher:f.fetcher});try{p.load('Concept(ResearchPolicy(),Revision(1),MaximumRelatedProperties(0))');const q=await p.turn('I got a blorf what should I do?');assert.equal(q.status,'learning');assert.match(field(q.reply,'text'),/Related-property evidence budget/);assert.ok(p.store.agenda().some(j=>j.kind==='research'));}finally{p.close();}
});
