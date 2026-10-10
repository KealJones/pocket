import test from 'node:test';import assert from 'node:assert/strict';
import {Project}from'../src/project.mjs';import{parse,field,values,format}from'../src/ncon.mjs';
const entity=(id,name,aliases=[],claims={})=>({id,lastrevid:1,labels:{en:{value:name}},aliases:{en:aliases.map(value=>({value}))},claims});
const claim=(id,target,qualifiers={})=>({id,rank:'normal',qualifiers,mainsnak:{snaktype:'value',datavalue:{type:'wikibase-entityid',value:{id:target}}}});
function source({twoFilms=false,subclass=false}={}){
 const calls=[],entities={
 P57:entity('P57','director',['directed by']),P9876:entity('P9876','operator',['florped by']),P5769:entity('P5769','editor-in-chief',['directed by']),
 Q11424:entity('Q11424','film',['movie']),Q571:entity('Q571','book'),Q600:entity('Q600','feature film',[],{P279:[claim('feature$film','Q11424')]}),
 Q189505:entity('Q189505','Jaws',[],{P31:[claim('jaws$film',subclass?'Q600':'Q11424')],P57:[claim('jaws$director','Q8877')]}),
 Q1322449:entity('Q1322449','Jaws',[],{P31:[claim('jaws$book','Q571')],P57:[claim('misleading$director','Q999')]}),
 Q8877:entity('Q8877','Steven Spielberg'),Q999:entity('Q999','Different Person'),
 Q200:entity('Q200','Jurassic Park',[],{P31:[claim('park$film','Q11424')],P57:[claim('park$director','Q8877')]}),
 Q201:entity('Q201','Different Film', ['Jaws'],{P31:[claim('different$film','Q11424')],P57:[claim('different$director','Q999')]}),
 Q900:entity('Q900','Zorbia',['ZX'],{P31:[claim('zorbia$kind','Q901')],P9876:[claim('zorbia$florp','Q902')]}),Q901:entity('Q901','gizmo'),Q902:entity('Q902','Gleeb')};
 const fetcher=async raw=>{const u=new URL(raw),p=u.searchParams;calls.push(u);
 if(p.get('action')==='wbsearchentities'){
 const q=p.get('search').toLowerCase(),property=p.get('type')==='property';let hits=Object.values(entities).filter(e=>e.id.startsWith(property?'P':'Q')&&[e.labels.en.value,...e.aliases.en.map(a=>a.value)].some(n=>n.toLowerCase()===q));
 if(!twoFilms)hits=hits.filter(e=>e.id!=='Q201');
 return Response.json({search:hits.map(e=>({id:e.id,label:e.labels.en.value,match:{text:e.aliases.en.find(a=>a.value.toLowerCase()===q)?.value??e.labels.en.value}}))});
 }
 if(p.get('action')==='wbgetentities')return Response.json({entities:Object.fromEntries(p.get('ids').split('|').filter(id=>entities[id]).map(id=>[id,entities[id]]))});
 throw new Error('Unexpected source request: '+u.href);
 };return {calls,entities,fetcher};
}
test('agent questions learn the source relationship and use the supplied kind to select a homonymous title',async()=>{
 const f=source(),p=new Project({fetcher:f.fetcher});try{
 const r=await p.turn('Who directed the movie jaws?');assert.equal(r.status,'resolved');assert.equal(field(r.reply,'answer'),'Steven Spielberg');assert.match(format(r.result),/action="directed", kind="movie", subject="jaws"/);assert.equal(r.input.source,'Who directed the movie jaws?');
 assert.ok(f.calls.some(u=>u.searchParams.get('search')==='directed by'));assert.ok(f.calls.some(u=>u.searchParams.get('search')==='movie'));assert.equal(p.store.records('KnowledgeFact').length,1);assert.equal(p.store.records('TypeEvidence').length,1);assert.ok(!f.calls.some(u=>u.hostname==='en.wikipedia.org'));
 const count=f.calls.length;assert.equal(field((await p.turn('who directed the movie Jaws')).reply,'answer'),'Steven Spielberg');assert.equal(f.calls.length,count);
 assert.equal(field((await p.turn('Who directed the movie Jurassic Park?')).reply,'answer'),'Steven Spielberg');
 const subject=field(p.store.records('KnowledgeFact').find(r=>field(r.expression,'statement')==='jaws$director').expression,'subject');const type=p.store.records('TypeEvidence').find(r=>format(values(r.expression)[0])===format(subject));p.store.retract(type.id);assert.equal(p.store.record(r.replyId).active,false);
 }finally{p.close();}
});
test('the same action question works for opaque source relations, kinds, and entities',async()=>{
 const f=source(),p=new Project({fetcher:f.fetcher});try{const r=await p.turn('who florped the gizmo ZX?');assert.equal(field(r.reply,'answer'),'Gleeb');assert.ok(f.calls.some(u=>u.searchParams.get('search')==='florped by'));assert.ok(f.calls.some(u=>u.searchParams.get('search')==='gizmo'));}finally{p.close();}
});
test('source subclass paths support kind filtering and are retractable evidence',async()=>{
 const f=source({subclass:true}),p=new Project({fetcher:f.fetcher});try{p.load('Concept(ResearchPolicy(),Revision(1),MaximumRequests(12))');const r=await p.turn('who directed the movie Jaws?');assert.equal(field(r.reply,'answer'),'Steven Spielberg');const ancestor=p.store.records('SourceEntity').find(r=>field(r.expression,'externalId')==='Q600');assert.ok(ancestor);p.store.retract(ancestor.id);assert.equal(p.store.record(r.replyId).active,false);}finally{p.close();}
});
test('two matching films require context rather than choosing the first director',async()=>{
 const f=source({twoFilms:true}),p=new Project({fetcher:f.fetcher});try{const r=await p.turn('who directed the movie Jaws?');assert.equal(r.status,'learning');assert.equal(field(r.reply,'research'),'ambiguous');assert.match(field(r.reply,'text'),/more than one match/);assert.equal(p.store.records('KnowledgeFact').length,0);}finally{p.close();}
});
test('a mismatched explicit kind cannot silently fall back to a different entity sense',async()=>{
 const f=source();f.entities.Q189505.claims.P31=[claim('wrong$kind','Q571')];const p=new Project({fetcher:f.fetcher});try{const r=await p.turn('who directed the movie Jaws?');assert.equal(r.status,'learning');assert.match(field(r.reply,'text'),/no supported movie meaning/);assert.equal(p.store.records('KnowledgeFact').length,0);}finally{p.close();}
});
test('type traversal is bounded and does not claim absence when proof search is exhausted',async()=>{
 const f=source({subclass:true}),p=new Project({fetcher:f.fetcher});try{p.load('Concept(ResearchPolicy(),Revision(1),MaximumTypeNodes(0))');const r=await p.turn('who directed the movie Jaws?');assert.equal(r.status,'learning');assert.match(field(r.reply,'text'),/budget reached/);assert.equal(p.store.records('KnowledgeFact').length,0);}finally{p.close();}
});
test('copular who-is forms retain their topic meaning instead of becoming agent questions',async()=>{
 const p=new Project({online:false});try{await p.prepare();const r=await p.analyze((await import('../src/ears.mjs')).capture('who is Ada Lovelace?'));assert.equal(r.candidates[0].meaning.head,'TopicQuestion');}finally{p.close();}
});
test('invalid captured-slot limits are refused by the ordinary lesson learner',async()=>{
 const p=new Project({online:false});try{await assert.rejects(p.teachExample('who florped ZX?',parse('ActionQuestion(action="florped",subject="ZX")'),{textSlots:true,captureLimits:{action:0}}),/Capture limits/);}finally{p.close();}
});
test('an already proven subject kind is sufficient without fetching unrelated homonym ancestry',async()=>{
 const f=source(),p=new Project({fetcher:url=>{const u=new URL(url);if(u.searchParams.get('ids')==='Q571')throw new Error('unrelated type source unavailable');return f.fetcher(url);}});try{const r=await p.turn('who directed the movie Jaws?');assert.equal(field(r.reply,'answer'),'Steven Spielberg');assert.ok(f.calls.length<=7);}finally{p.close();}
});
test('instance-of a type is not inherited through that type’s own instance-of meta-class, including on retry',async()=>{
 const f=source({subclass:true});f.entities.Q600.claims={P31:[claim('meta$type','Q11424')]};const p=new Project({fetcher:f.fetcher});try{for(let i=0;i<2;i++){const r=await p.turn('who directed the movie Jaws?');assert.equal(r.status,'learning');assert.equal(p.store.records('KnowledgeFact').length,0);}}finally{p.close();}
});
