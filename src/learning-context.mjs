import {term,values,field,isTerm,format} from './ncon.mjs';

const STRUCTURE=new Set(['Concept','IsA','SubclassOf','Surface','Label','Denotes','Construction','Frame','Realization','Native','List','Slot','Literal','Optional','Choice','Let','If','Sequence','Quote','Each','Hole']);
const namesIn=value=>{
  const names=new Set();
  const visit=x=>{if(!isTerm(x))return;if(!STRUCTURE.has(x.head))names.add(x.head);for(const arg of x.args)visit(arg.value);};
  visit(value);return names;
};

export function memoryContext(store,profile,{maximumObjects=8,maximumRelations=6}={}){
  const attention=new Map();
  for(const r of store.records('MemoryAttention').filter(r=>field(r.expression,'profile','')===profile)){
    const id=values(values(r.expression)[0])[0],sequence=field(r.expression,'sequence',0);
    if(sequence>(attention.get(id)??0))attention.set(id,sequence);
  }
  return store.records('MemoryObject').filter(r=>field(r.expression,'profile','')===profile)
    .sort((a,b)=>(attention.get(b.id)??field(b.expression,'sequence',0))-(attention.get(a.id)??field(a.expression,'sequence',0)))
    .slice(0,maximumObjects).map(r=>{
      const reference=format(term('MemoryRef',r.id)),latest=new Map();
      for(const binding of store.records('MemoryBinding').filter(b=>field(b.expression,'profile','')===profile&&format(values(b.expression)[0])===reference)
        .sort((a,b)=>field(b.expression,'sequence',0)-field(a.expression,'sequence',0))){
        const relation=format(values(binding.expression)[1]);if(!latest.has(relation))latest.set(relation,{id:binding.id,relation,value:format(values(binding.expression)[2]).slice(0,300)});
      }
      return {reference,kind:format(values(r.expression)[0]),receivedAt:field(r.expression,'receivedAt'),attentionSequence:attention.get(r.id)??null,relations:[...latest.values()].slice(0,maximumRelations)};
    });
}

// Bounded graph retrieval for supervision. This supplies actual graph definitions,
// not an English task classifier or a guessed reply. Whole parts remain readable.
export function learningContext(store,{profile,episodes,analysis,memoryKinds=[],maximumCharacters=22000,maximumRecords=32,maximumDepth=6,maximumReverseDegree=4}){
  const recent=(head,id)=>store.records(head).filter(r=>field(r.expression,'episode')===id).sort((a,b)=>field(b.expression,'sequence',0)-field(a.expression,'sequence',0))[0];
  const seeds=new Set(),add=value=>{for(const name of namesIn(value))seeds.add(name);};
  for(const candidate of analysis.candidates.slice(0,6))add(candidate.meaning);
  for(const edge of analysis.edges.slice(0,32))add(edge.meaning);
  for(const kind of memoryKinds)add(kind);
  const conversation=episodes.map(r=>{
    const reading=recent('Reading',r.id),reply=recent('Reply',r.id),result=values(reading?.expression)[0];
    if(result?.head==='Resolved')add(values(result)[0]);
    return {id:r.id,text:values(values(r.expression)[0])[0].slice(0,1000),
      receivedAt:field(r.expression,'receivedAt',null),
      reading:reading?{id:reading.id,result:format(result).slice(0,2000)}:null,
      reply:reply?{id:reply.id,value:format(values(reply.expression)[0]).slice(0,2000)}:null};
  });
  const records=store.records('Concept').flatMap(r=>{
    const [identity,...parts]=values(r.expression),visible=parts.filter(p=>!field(p,'profile','')||field(p,'profile')===profile);
    if(!visible.length)return [];
    const expression=term('Concept',identity,...visible);
    return [{id:r.id,owner:identity.head,identity,parts:visible,references:namesIn(expression)}];
  });
  const degree=new Map();for(const record of records)for(const name of record.references)degree.set(name,(degree.get(name)??0)+1);
  let frontier=seeds,used=0,truncated=false;const selected=new Map(),visited=new Set();
  for(let depth=0;depth<maximumDepth&&frontier.size;depth++){
    const next=new Set();
    // Direct definitions precede incoming relationships at every graph hop.
    const adjacent=records.filter(r=>frontier.has(r.owner)||[...frontier].some(n=>degree.get(n)<=maximumReverseDegree&&r.references.has(n)))
      .sort((a,b)=>Number(frontier.has(b.owner))-Number(frontier.has(a.owner))||a.id.localeCompare(b.id));
    for(const record of adjacent){
      const held=selected.get(record.id),parts=frontier.has(record.owner)?record.parts:record.parts.filter(p=>[...namesIn(p)].some(n=>degree.get(n)<=maximumReverseDegree&&frontier.has(n)));
      const merged=[...new Map([...(held?.parts??[]),...parts].map(p=>[format(p),p])).values()],expression=term('Concept',record.identity,...merged),definition=format(expression),size=definition.length-(held?.definition.length??0);
      if(!held&&selected.size>=maximumRecords||used+size>maximumCharacters){truncated=true;continue;}
      used+=size;selected.set(record.id,{id:record.id,definition,parts:merged,partial:merged.length<record.parts.length});
      for(const part of parts)for(const name of namesIn(part))if(name!==record.owner&&!visited.has(name))next.add(name);
    }
    for(const name of frontier)visited.add(name);
    frontier=new Set([...next].filter(n=>!visited.has(n)));
  }
  return {conversation,relatedConcepts:[...selected.values()].map(({id,definition,partial})=>({id,definition,partial})),contextBudget:{maximumCharacters,maximumRecords,maximumDepth,maximumReverseDegree,truncated:truncated||frontier.size>0}};
}
