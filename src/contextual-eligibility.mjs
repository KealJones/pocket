import {term,call,values,field,isTerm,match,substitute} from './ncon.mjs';

export function readingMeanings(reading){
 const result=values(reading?.expression)[0];
 return result?.head==='Resolved'?[values(result)[0]]:values(field(reading?.expression,'readings',term('List'))).map(c=>values(c)[0]);
}

// Previous-turn lookup uses observation order, not the newest response timestamp.
// Replaying yesterday's episode cannot borrow tomorrow's context.
export function previousTarget(store,{profile,episode}){
 const current=episode&&store.record(episode),before=current?field(current.expression,'sequence',0):Infinity;
 let previous=store.records('Episode').filter(r=>r.id!==episode&&field(r.expression,'profile','')===profile&&field(r.expression,'sequence',0)<before).sort((a,b)=>field(b.expression,'sequence',0)-field(a.expression,'sequence',0))[0];
 const latest=head=>previous&&store.records(head).filter(r=>field(r.expression,'episode')===previous.id).sort((a,b)=>field(b.expression,'sequence',0)-field(a.expression,'sequence',0))[0];
 const seen=new Set(),links=[];
 while(previous&&!seen.has(previous.id)){
  seen.add(previous.id);const reply=latest('Reply'),link=store.records('Clarification').filter(r=>field(r.expression,'episode')===previous.id).sort((a,b)=>field(b.expression,'sequence',0)-field(a.expression,'sequence',0))[0],targetId=link?field(link.expression,'target'):field(values(reply?.expression)[0],'clarifiedEpisode'),target=typeof targetId==='string'?store.record(targetId):null;
  if(!target?.active||target.expression.head!=='Episode'||field(target.expression,'profile','')!==profile||field(target.expression,'sequence',0)>=field(previous.expression,'sequence',0))break;
  if(link)links.push(link.id);previous=target;
 }
 return {episode:previous,reading:latest('Reading'),reply:latest('Reply'),links};
}

export function contextualEligibility(store,candidate,options){
 const meaning=candidate.meaning,requirements=isTerm(meaning)?store.parts(meaning.head,'ContextRequirement'):[],supports=[],needs=[];
 let target;
 for(const requirement of requirements){
  const [pattern,...conditions]=values(requirement.expression),bindings=match(pattern,meaning,new Map());if(!bindings)continue;
  supports.push(requirement.support);
  for(const raw of conditions){
   const condition=substitute(raw,bindings);
   if(condition?.head==='PreviousAllowsHint'){
    target??=previousTarget(store,options);const role=values(condition)[0],readings=readingMeanings(target.reading);
    const permissions=readings.flatMap(m=>isTerm(m)?store.parts(m.head,'ContextualArgument').filter(p=>values(p.expression)[0]===role):[]);
    if(target.episode&&target.reading&&permissions.length)supports.push(target.episode.id,target.reading.id,...target.links,...permissions.map(p=>p.support));
    else needs.push(call('MissingContext',[condition],{reason:'The preceding reading does not authorize this role repair.'}));
   }else needs.push(call('MissingContext',[condition],{reason:'This context requirement has no installed inspector.'}));
  }
 }
 return {eligible:needs.length===0,supports:[...new Set(supports)],needs,targetEpisode:target?.episode?.id??null};
}

export function gateContext(store,analysis,options){
 const candidates=[],contextRejected=[];
 for(const candidate of analysis.candidates){
  const proof=contextualEligibility(store,candidate,options),held={...candidate,supports:[...new Set([...candidate.supports,...proof.supports])],contextProof:proof};
  if(proof.eligible)candidates.push(held);else contextRejected.push(held);
 }
 return {...analysis,candidates,contextRejected};
}
