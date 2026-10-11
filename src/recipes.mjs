import {call,term,values,field} from './ncon.mjs';
const clean=text=>text.replace(/\[\[(?:File|Image):[\s\S]*?\]\]/gi,'').replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi,'').replace(/<ref\b[^>]*\/>/gi,'').replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g,'$2').replace(/\[\[([^\]]+)\]\]/g,'$1').replace(/\{\{[^{}]*\}\}/g,'').replace(/'{2,}/g,'').replace(/<[^>]+>/g,'').trim();
function sections(text){const result=new Map();let heading='';for(const line of text.split('\n')){const match=/^={2,6}\s*(.*?)\s*={2,6}\s*$/.exec(line);if(match){heading=clean(match[1]).toLowerCase();result.set(heading,[]);}else if(heading&&/^[*#]\s*\S/.test(line))result.get(heading).push(clean(line.replace(/^[*#]+\s*/,'')));}return result;}
const folded=s=>s.normalize('NFC').toLowerCase().replace(/\s+/g,' ').trim();
export class Recipes {
 constructor(project){this.p=project;this.store=project.store;}
 async acquire(query,profile){
  const previous=this.p.sources.deadline;this.p.sources.deadline=Math.min(previous??Infinity,Date.now()+this.p.policy('RequestLearningPolicy','MaximumMilliseconds'));
  try {
  const p=this.p,source=p.sources.available().find(s=>s.adapter==='mediawiki-sections');if(!source)throw new Error('No structured recipe source is configured');
  const part=name=>values(p.store.parts(source.identity,name)[0]?.expression)[0];
  const scope=part('Scope'),maximum=part('MaximumCandidates')??6;
  const search=await p.sources.json(source.endpoint,{action:'query',list:'search',srsearch:`${query} prefix:${scope}`,srlimit:maximum,format:'json',formatversion:2});
  const found=[];
  for(const hit of (search.data.query?.search??[]).slice(0,maximum)){
   if(!hit.title.startsWith(scope))continue;
   const words=folded(query).split(' '),title=folded(hit.title.slice(scope.length));if(!words.every(w=>title.includes(w)))continue;
   const page=await p.sources.json(source.endpoint,{action:'query',prop:'revisions',titles:hit.title,rvprop:'content',rvslots:'main',format:'json',formatversion:2});
   const data=page.data.query?.pages?.[0],raw=data?.revisions?.[0]?.slots?.main?.content;if(typeof raw!=='string')continue;
   const parts=sections(raw),ingredients=parts.get(folded(part('IngredientSection'))),steps=parts.get(folded(part('ProcedureSection')));
   if(!ingredients?.length||!steps?.length)continue;
   const url=new URL('/wiki/'+encodeURIComponent(data.title.replaceAll(' ','_')),source.endpoint).href;
   const document=this.store.put(call('SourceExcerpt',[raw],{url,license:source.license,title:data.title,format:'mediawiki',profile,revision:data.revisions[0].revid??null}),{source:'source:'+source.identity,supports:p.store.parts(source.identity).map(x=>x.support)});
   const recipe=call('RecipeFact',[query,data.title,term('List',...ingredients),term('List',...steps)],{profile,url,optionalMarker:part('OptionalMarker'),document});
   const id=this.store.put(recipe,{source:'derived:source-sections',supports:[document,...p.store.parts(source.identity).map(x=>x.support)]});
   await p.learner.readEvidence(document,{profile});found.push(this.store.record(id));
  }
  return found;
  } finally {this.p.sources.deadline=previous;}
 }
 async resolve(query,exclusions,context){
  if(typeof query!=='string'||query.length>200||exclusions?.head!=='List'||values(exclusions).some(v=>typeof v!=='string'))throw new Error('A recipe needs a topic and ingredient constraints');
  const excluded=values(exclusions).map(folded);let recipes=this.store.records('RecipeFact').filter(r=>field(r.expression,'profile','')===context.profile&&folded(values(r.expression)[0])===folded(query));
  const suitable=record=>{const ingredients=values(values(record.expression)[2]);return !ingredients.some(item=>excluded.some(x=>folded(item).includes(x))&&!folded(item).includes(folded(field(record.expression,'optionalMarker','optional'))));};
  if(!recipes.some(suitable)&&this.p.online){try{recipes=await this.acquire(query,context.profile);}catch(error){return call('Replied',[],{text:'I could not retrieve a supported recipe yet: '+error.message,pending:true});}}
  const valid=recipes.filter(suitable).sort((a,b)=>values(a.expression)[1].length-values(b.expression)[1].length);
  if(!valid.length)return call('Replied',[],{text:excluded.length?'I haven’t found a recipe that satisfies those exclusions. I kept the constraints rather than inventing a substitution.':'I haven’t found an ingredient list and method for that recipe yet.',pending:true});
  const selected=valid[0],[_query,title,ingredientList,stepList]=values(selected.expression),ingredients=values(ingredientList).filter(item=>!excluded.some(x=>folded(item).includes(x))),steps=values(stepList);
  const omitted=values(ingredientList).filter(item=>!ingredients.includes(item));
  // Omit an optional ingredient only when the method doesn't still require it.
  if(omitted.length&&steps.some(step=>excluded.some(x=>folded(step).includes(x))))return call('Replied',[],{text:'The ingredient is optional, but the method still mentions it. I need a supported method for the changed recipe.',pending:true});
  context.retain(selected.id);context.retain(field(selected.expression,'document'));
  context.write('Ingredients',term('List',...ingredients));
  const text=title.replace(/^.*?:/,'')+'\n\nIngredients\n'+ingredients.map(x=>'- '+x).join('\n')+'\n\nMethod\n'+steps.map((x,i)=>`${i+1}. ${x}`).join('\n')+(omitted.length?'\n\nOmitted ingredients marked optional by the source.':'');
  return call('Replied',[],{text,answer:term('Recipe',term('List',...ingredients),term('List',...steps)),url:field(selected.expression,'url'),evidence:selected.id,research:'structured-source-recipe'});
 }
}
