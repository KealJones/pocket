import {call,term,values,field,format,isTerm} from './ncon.mjs';

// Episodic graph mechanics. Kinds, relations, attention scores and workflows are
// authored concepts. There are no person/list/recipe keys or domain tables here.
export class Memory {
 constructor(project){this.p=project;this.store=project.store;}
 profile(){return this.p.responseProfile??this.p.profile;}
 retain(id){if(id)this.p.responseEvidence?.push(id);}
 supports(){return [...new Set([this.p.responseEpisode,this.p.responseReading,...(this.p.responseEvidence??[])].filter(id=>this.store.record(id)?.active))];}
 metadata(){const p=this.p;if(!p.responseEpisode||!p.responseReading)throw new Error('Memory changes require a committed user turn');const e=this.store.record(p.responseEpisode).expression;return {profile:this.profile(),episode:p.responseEpisode,intent:p.responseMeaning,receivedAt:field(e,'receivedAt'),timeZone:field(e,'timeZone'),sequence:p.sequence()};}
 put(head,args){const metadata=this.metadata();const existing=this.store.records(head).find(r=>field(r.expression,'profile','')===metadata.profile&&field(r.expression,'episode')===metadata.episode&&field(r.expression,'intent')===metadata.intent&&format(term('List',...values(r.expression).slice(0,args.length-1)))===format(term('List',...args.slice(0,-1))));
  if(existing){this.retain(existing.id);return existing;}const id=this.store.put(call(head,args,metadata),{source:'derived:episodic-memory',supports:this.supports()});this.retain(id);return this.store.record(id);}
 object(ref){const r=ref?.head==='MemoryRef'&&this.store.record(values(ref)[0]);return r?.active&&r.expression.head==='MemoryObject'&&field(r.expression,'profile','')===this.profile()?r:null;}
 create(kind){if(!isTerm(kind))throw new Error('Memory kind must be a concept');const record=this.put('MemoryObject',[kind,null]);return term('MemoryRef',record.id);}
 read(subject,relation,fallback=null){if(subject?.head==='MemoryRef'&&!this.object(subject))return fallback;const r=this.store.records('MemoryBinding').filter(r=>field(r.expression,'profile','')===this.profile()&&format(values(r.expression)[0])===format(subject)&&format(values(r.expression)[1])===format(relation)).sort((a,b)=>field(b.expression,'sequence',0)-field(a.expression,'sequence',0))[0];if(!r)return fallback;this.retain(r.id);if(subject?.head==='MemoryRef')this.retain(values(subject)[0]);return values(r.expression)[2];}
 bind(subject,relation,value){if(subject?.head==='MemoryRef'){if(!this.object(subject))throw new Error('Inactive or foreign memory reference');this.retain(values(subject)[0]);}if(!isTerm(subject)||!isTerm(relation)||format(value).length>16000)throw new Error('Invalid memory relationship');return values(this.put('MemoryBinding',[subject,relation,value]).expression)[2];}
 attend(ref){if(!this.object(ref))throw new Error('Expected an active memory object');this.retain(values(ref)[0]);this.put('MemoryAttention',[ref,null]);return ref;}
 pin(ref){if(!this.object(ref))throw new Error('Expected an active memory object');this.retain(values(ref)[0]);this.put('MemoryRetention',[ref,'explicit']);return ref;}
 matches(record,kind){const actual=values(record.expression)[0];if(format(actual)===format(kind))return true;if(this.store.isA(actual.head,kind.head)){for(const id of this.store.typeProof(actual.head,kind.head))this.retain(id);return true;}return false;}
 localDate(record){const raw=field(record.expression,'receivedAt'),zone=field(record.expression,'timeZone','UTC');if(!raw)return null;const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(raw)).map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}-${parts.day}`;}
 objects(kind,date=null){const records=this.store.records('MemoryObject').filter(r=>field(r.expression,'profile','')===this.profile()&&this.matches(r,kind)&&(!date||this.localDate(r)===date));return records;}
 unique(records){if(records.length>this.p.policy('MemoryPolicy','MaximumMemoryObjects'))return term('MemorySearchExhausted');if(!records.length)return null;if(records.length>1)return term('MemoryAlternatives',...records.map(r=>term('MemoryRef',r.id)));this.retain(records[0].id);return term('MemoryRef',records[0].id);}
 find(kind,date=null){return this.unique(this.objects(kind,date));}
 findField(kind,relation,value){return this.unique(this.objects(kind).filter(r=>format(this.read(term('MemoryRef',r.id),relation))===format(value)));}
 async focus(kind){const p=this.p,episodes=this.store.records('Episode').filter(r=>field(r.expression,'profile','')===this.profile()).sort((a,b)=>field(b.expression,'sequence',0)-field(a.expression,'sequence',0));const episodeIndex=new Map(episodes.map((r,i)=>[r.id,i])),ranked=[];
  for(const object of this.objects(kind)){const ref=term('MemoryRef',object.id),attention=this.store.records('MemoryAttention').filter(r=>field(r.expression,'profile','')===this.profile()&&format(values(r.expression)[0])===format(ref)).sort((a,b)=>field(b.expression,'sequence',0)-field(a.expression,'sequence',0))[0];if(!attention)continue;
   const age=episodeIndex.get(field(attention.expression,'episode'))??Infinity,pinned=this.store.records('MemoryRetention').some(r=>field(r.expression,'profile','')===this.profile()&&format(values(r.expression)[0])===format(ref));if(!Number.isFinite(age)||age>p.policy('MemoryPolicy','FocusWindow')&&!pinned)continue;
   const score=await p.evaluator.evaluate(term('MemoryScore',age));if(typeof score.value!=='number'||!Number.isFinite(score.value))throw new Error('MemoryScore must yield a finite ranking score');ranked.push({object,attention,ref,score:score.value,supports:score.trace.flatMap(t=>t.support?[t.support]:[])});
  }
  if(ranked.length>p.policy('MemoryPolicy','MaximumMemoryObjects'))return term('MemorySearchExhausted');
  ranked.sort((a,b)=>b.score-a.score);const top=ranked[0],ambiguous=top&&ranked[1]&&top.score-ranked[1].score<p.policy('MemoryPolicy','Margin');p.trace('memory-'+p.responseEpisode,p.responseEpisode,'memory.retrieved',{kind:format(kind),candidates:ranked.map(r=>({reference:format(r.ref),score:r.score})),ambiguous:Boolean(ambiguous)});
  if(!top)return null;if(ambiguous)return term('MemoryAlternatives',...ranked.filter(r=>top.score-r.score<p.policy('MemoryPolicy','Margin')).map(r=>r.ref));this.retain(top.object.id);this.retain(top.attention.id);for(const id of top.supports)this.retain(id);for(const part of p.store.parts('MemoryPolicy'))this.retain(part.support);return top.ref;
 }
 capabilities(){return {'memory.create':k=>this.create(k),'memory.bind':(s,r,v)=>this.bind(s,r,v),'memory.recall':(s,r,f)=>this.read(s,r,f),'memory.attend':r=>this.attend(r),'memory.pin':r=>this.pin(r),'memory.find':(k,d)=>this.find(k,d),'memory.find-field':(k,r,v)=>this.findField(k,r,v),'memory.focus':k=>this.focus(k),'memory.is-reference':r=>Boolean(this.object(r)),
  'memory.read':(key,fallback)=>this.read(term('ProfileMemory'),term('Relation',key),fallback),'memory.write':(key,value)=>this.bind(term('ProfileMemory'),term('Relation',key),value)};}
}
