import {call,term,values,field,format,isTerm} from './ncon.mjs';

// Profile-scoped, versioned values and calendar mechanics. Meaning-specific keys
// and workflow decisions belong to concept programs, not this module.
export function sessionCapabilities(project,{clock=()=>new Date(),timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone}={}) {
 const p=project,profile=()=>p.responseProfile??p.profile;
 const retain=id=>{p.responseEvidence?.push(id);return id;};
 function dateParts(instant,zone=timeZone){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(instant).map(x=>[x.type,x.value]));return `${parts.year}-${parts.month}-${parts.day}`;}
 function stamp(){const instant=clock();if(!(instant instanceof Date)||!Number.isFinite(instant.getTime()))throw new Error('Invalid runtime clock');const timestamp=instant.toISOString();
  if(p.responseEpisode){const id=p.store.put(call('RuntimeObservation',[timestamp],{kind:'clock',timeZone,episode:p.responseEpisode}),{source:'runtime:clock',supports:[p.responseEpisode]});retain(id);}return timestamp;
 }
 const date=raw=>{if(typeof raw!=='string'||!/^\d{4}-\d\d-\d\d$/.test(raw))throw new Error('Expected an ISO calendar date');const value=new Date(raw+'T12:00:00Z');if(!Number.isFinite(value.getTime())||value.toISOString().slice(0,10)!==raw)throw new Error('Invalid calendar date');return value;};
 const items=(text,delimiter)=>{if(typeof text!=='string'||text.length>4000||typeof delimiter!=='string'||delimiter.length>256)throw new Error('Invalid item text');return term('List',...text.split(new RegExp(delimiter,'iu')).map(s=>s.trim()).filter(Boolean));};
 const merge=(left,right)=>{if(left?.head!=='List'||right?.head!=='List')throw new Error('Expected collections');const held=new Map();for(const value of [...values(left),...values(right)])held.set(format(value).normalize('NFC').toLowerCase(),value);if(held.size>200)throw new Error('Collection budget exceeded');return term('List',...held.values());};
 return {
  'reply.pending':text=>call('Replied',[],{text,pending:true}),
  'ncon.evaluate':async expression=>(await p.evaluator.evaluate(expression)).value,
  'data.term':(name,...args)=>{if(typeof name!=='string')throw new Error('Expected a concept identity');return term(name,...args);},
  'text.fold':text=>{if(typeof text!=='string')throw new Error('Expected text');return text.normalize('NFC').toLowerCase();},
  'calendar.reference-date':()=>{const episode=p.store.record(p.responseEpisode)?.expression;return dateParts(new Date((field(episode,'receivedAt')??stamp())),field(episode,'timeZone',timeZone));},
  'clock.now':stamp,'clock.today':()=>dateParts(new Date(stamp())),
  'clock.format':(timestamp,mode)=>new Intl.DateTimeFormat('en-US',{timeZone,hour:'2-digit',minute:'2-digit',hourCycle:mode==='24'?'h23':'h12'}).format(new Date(timestamp)),
  'calendar.shift-days':(raw,offset)=>{if(!Number.isInteger(offset)||Math.abs(offset)>365000)throw new Error('Invalid calendar offset');const d=date(raw);d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);},
  'calendar.shift-years':(raw,offset)=>{if(!Number.isInteger(offset)||Math.abs(offset)>500)throw new Error('Invalid year offset');const d=date(raw),month=d.getUTCMonth();d.setUTCFullYear(d.getUTCFullYear()+offset);if(d.getUTCMonth()!==month)d.setUTCDate(0);return d.toISOString().slice(0,10);},
  'text.items':items,'collection.merge':merge,
  'collection.text':list=>{if(!isTerm(list)||list.head!=='List')throw new Error('Expected a collection');return values(list).map(v=>'- '+(typeof v==='string'?v:format(v))).join('\n');},
  'text.trim-marks':(text,marks)=>{if(typeof text!=='string'||typeof marks!=='string')throw new Error('Expected text');let result=text.trim();while(result&&marks.includes(result.at(-1)))result=result.slice(0,-1).trimEnd();return result;},
  'session.recipe':(ref,query,exclusions)=>p.recipes.resolve(query,exclusions,{write:(key,value)=>p.memory.bind(ref,term(key),value),retain,profile:profile()}),
 };
}
