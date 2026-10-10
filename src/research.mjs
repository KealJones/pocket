import {call,term,values,field,isTerm,format} from './ncon.mjs';
import {sourceIdentity as identity,decodeClaims} from './source-claims.mjs';

const key=text=>text.normalize('NFC').toLowerCase().trim().replace(/\s+/gu,' ');
const externalID=id=>typeof id==='string'&&/^[QP]\d+$/.test(id);
const names=entity=>[...Object.values(entity.labels??{}).map(x=>x.value),...Object.values(entity.aliases??{}).flatMap(xs=>xs.map(x=>x.value))].filter(x=>typeof x==='string');
const label=(entity,language)=>entity.labels?.[language]?.value??entity.labels?.mul?.value??names(entity)[0]??entity.id;
const hitNames=hit=>[hit.label,hit.match?.text,...(hit.aliases??[])].filter(x=>typeof x==='string');

/** Structured-source learning: discover property/reference bindings, retain source
 * snapshots and qualified claims, answer from them, and reuse those same facts.
 * English question constructions and source policies are taught in .ncon.
 */
export class Research {
  constructor(project){this.project=project;this.store=project.store;}
  policy(name){return this.project.policy('ResearchPolicy',name);}
  setting(name){return values(this.store.parts('ResearchPolicy',name)[0]?.expression)[0];}
  cached(query){
    return this.store.records('ResearchAnswer').filter(r=>field(r.expression,'query')===query)
      .sort((a,b)=>field(b.expression,'checkedAt',0)-field(a.expression,'checkedAt',0))
      .find(r=>!this.project.online||Date.now()-field(r.expression,'checkedAt',0)<this.policy('CacheMilliseconds'));
  }
  emit(record){
    this.project.responseEvidence?.push(record.id,...values(field(record.expression,'sources',term('List'))));
    return call('Replied',[],{text:field(record.expression,'text'),answer:field(record.expression,'answer',null),evidence:record.id,research:field(record.expression,'kind'),cached:true});
  }
  session(query){
    const job=this.store.enqueue(query,'research');
    return {query,job,requests:0,supports:[],steps:[],started:Date.now()};
  }
  async json(session,source,parameters){
    if(!this.project.online)throw new Error('Online research is switched off');
    const remaining=this.policy('MaximumResearchMilliseconds')-(Date.now()-session.started);
    if(remaining<=0)throw new Error('Research time budget reached');
    if(++session.requests>this.policy('MaximumRequests'))throw new Error('Research request budget reached');
    const requestURL=new URL(source.endpoint,this.project.sources.options.baseURL);
    for(const[k,v]of Object.entries(parameters))requestURL.searchParams.set(k,String(v));
    session.steps.push({request:requestURL.href,status:'requesting'});
    await this.project.onProgress?.({stage:'acquiring',url:requestURL.href,requests:session.requests});
    try{
      const result=await this.project.sources.json(source.endpoint,{...parameters,format:'json',origin:'*'},{timeout:Math.min(remaining,this.project.sources.options.timeout)});
      const config=this.store.parts(source.identity).map(p=>p.support);
      const id=this.store.put(call('SourceDocument',[JSON.stringify(result.data)],{url:result.url,provider:term(source.identity),license:source.license,interpreted:false}),{source:'source:'+source.identity,supports:[...new Set(config)]});
      session.supports.push(id);session.steps.at(-1).status='received';
      await this.project.onProgress?.({stage:'retained',url:result.url,requests:session.requests});
      return {...result,evidence:id};
    }catch(error){session.steps.at(-1).status=error.message;throw error;}
  }
  finish(session,text,{answer=null,kind='fact',supports=[],url,status='done'}={}){
    const attempt=this.store.put(call('ResearchAttempt',[],{query:session.query,steps:JSON.stringify(session.steps),status,checkedAt:Date.now()}),{source:'derived:research',supports:session.supports});
    this.store.updateJob(session.job,status,text);
    const evidence=[...new Set([...session.supports,...supports,attempt,...this.store.parts('ResearchPolicy').map(p=>p.support)])];
    if(status!=='done')return call('Replied',[],{text,research:kind,pending:true,evidence:attempt});
    const id=this.store.put(call('ResearchAnswer',[],{query:session.query,text,answer,kind,url:url??null,sources:term('List',...session.supports),checkedAt:Date.now()}),{source:'derived:research',supports:evidence});
    return this.emit(this.store.record(id));
  }
  rememberEntity(source,entity,evidence,{searchNames=[]}={}){
    const id=identity(source.identity,entity.id);
    // Search matches are source-provided aliases, never an invented fuzzy query alias.
    const forms=new Set([...names(entity),...searchNames]);
    const snapshot=this.store.put(call('SourceEntity',[JSON.stringify(entity)],{externalId:entity.id,provider:term(source.identity),license:source.license,revision:entity.lastrevid??null,checkedAt:Date.now()}),{source:'source:'+source.identity,supports:[evidence]});
    const old=this.store.records('SourceEntity').filter(r=>r.id!==snapshot&&field(r.expression,'externalId')===entity.id&&format(field(r.expression,'provider'))===format(term(source.identity))&&(field(r.expression,'revision')!==(entity.lastrevid??null)||values(r.expression)[0]!==JSON.stringify(entity)));
    for(const r of old)this.store.retract(r.id);
    const taxonomy=source.parts.filter(p=>p.head==='Mapping').flatMap(mapping=>{
      const [property,relationship]=values(mapping);if(!isTerm(relationship))return [];
      return this.claims(entity,property).flatMap(claim=>{
        const target=claim.mainsnak.datavalue.value?.id;if(!externalID(target))return [];
        const relation=term(relationship.head,identity(source.identity,target));
        return Object.keys(claim.qualifiers??{}).length?[call('ScopedClaim',[relation],{qualifiers:JSON.stringify(claim.qualifiers),statement:claim.id??null})]:[relation];
      });
    });
    const definition=this.store.put(term('Concept',id,term('IsA',term(entity.id.startsWith('P')?'ExternalProperty':'ExternalEntity')),term('Label',label(entity,source.language)),...Array.from(forms,text=>term('Surface',text)),...taxonomy,call('ExternalIdentity',[entity.id],{source:term(source.identity)}),call('Citation',['https://www.wikidata.org/wiki/'+entity.id],{provider:term(source.identity),license:source.license,revision:entity.lastrevid??null})),{source:'source:'+source.identity,supports:[snapshot]});
    // Retain every decoded claim, including relationships not needed by this
    // request. Unknown labels remain source identities, not invented semantics.
    for(const claim of decodeClaims(source.identity,entity))this.store.put(claim,{source:'source:'+source.identity,supports:[snapshot]});
    return {entity,identity:id,snapshot,definition};
  }
  snapshots(source,ids){
    return ids.map(id=>this.store.records('SourceEntity').filter(r=>field(r.expression,'externalId')===id&&format(field(r.expression,'provider'))===format(term(source.identity)))
      .sort((a,b)=>field(b.expression,'checkedAt',0)-field(a.expression,'checkedAt',0))[0]);
  }
  async entities(session,source,ids,hits=[]){
    const existing=this.snapshots(source,ids);
    if(existing.every(r=>r&&(!this.project.online||Date.now()-field(r.expression,'checkedAt',0)<this.policy('CacheMilliseconds')))){
      session.supports.push(...existing.map(r=>r.id));
      return existing.map(r=>({entity:JSON.parse(values(r.expression)[0]),identity:identity(source.identity,field(r.expression,'externalId')),snapshot:r.id}));
    }
    const response=await this.json(session,source,{action:'wbgetentities',ids:ids.join('|'),props:'info|labels|descriptions|aliases|claims',languages:source.language+'|mul'});
    return ids.map(id=>response.data.entities?.[id]).filter(e=>e&&externalID(e.id)&&e.missing===undefined).map(e=>this.rememberEntity(source,e,response.evidence,{searchNames:hits.filter(h=>h.id===e.id).flatMap(hitNames)}));
  }
  known(text,source,type){
    return [...new Set(this.store.surfaces(text).filter(s=>this.store.isA(s.target,type)).flatMap(s=>this.store.parts(s.target,'ExternalIdentity').filter(p=>format(field(p.expression,'source'))===format(term(source.identity))).map(p=>values(p.expression)[0])))].filter(externalID);
  }
  async search(session,source,text,type){
    const known=this.known(text,source,type==='property'?'ExternalProperty':'ExternalEntity');
    if(known.length)return known.map(id=>({id,label:text,match:{text}}));
    const hits=[];let continuation;
    for(let page=0;page<this.policy('MaximumSearchPages');page++){
      const result=await this.json(session,source,{action:'wbsearchentities',search:text,type,language:source.language,uselang:source.language,limit:this.policy('SearchLimit'),...(continuation===undefined?{}:{continue:continuation})});
      hits.push(...(result.data.search??[]).filter(hit=>externalID(hit.id)&&hitNames(hit).some(name=>key(name)===key(text))));
      continuation=result.data['search-continue'];if(continuation===undefined)break;
    }
    if(continuation!==undefined)throw new Error('The source still has unexamined meanings; search-page budget reached');
    return [...new Map(hits.map(h=>[h.id,h])).values()];
  }
  claims(entity,property){
    const current=(entity.claims?.[property]??[]).filter(c=>c.rank!=='deprecated'&&c.mainsnak?.snaktype==='value'&&c.mainsnak.datavalue);
    const end=this.setting('EndTimeProperty');
    const usable=current.filter(c=>!(c.qualifiers?.[end]??[]).some(q=>{const time=q.datavalue?.value?.time;return typeof time==='string'&&time.slice(1,11)<=new Date().toISOString().slice(0,10);}));
    return usable.some(c=>c.rank==='preferred')?usable.filter(c=>c.rank==='preferred'):usable;
  }
  async filterKind(session,source,subjects,kind){
    if(!kind)return {subjects,proofs:[]};
    const hits=await this.search(session,source,kind,'item');
    if(!hits.length)throw new Error('I could not ground the supplied kind “'+kind+'”');
    const kinds=await this.entities(session,source,hits.map(h=>h.id),hits),targets=new Set(kinds.map(k=>k.entity.id));
    const mappings=source.parts.filter(p=>p.head==='Mapping'&&['IsA','SubclassOf'].includes(values(p)[1]?.head));
    if(!mappings.length)throw new Error('This source has no configured type relationships');
    // An instance's type can be widened through subclass edges. An ancestor's
    // own instance-of classification is a meta-type, not a type of the subject.
    const next=(entity,initial=false)=>mappings.filter(m=>values(m)[1].head==='SubclassOf'||initial).flatMap(m=>this.claims(entity,values(m)[0]).filter(c=>!Object.keys(c.qualifiers??{}).length).map(c=>c.mainsnak.datavalue.value?.id).filter(externalID));
    // Use retained positive type proofs first. An already grounded reading does
    // not require exploring every unrelated homonym's ancestry on the internet.
    const retainedPath=(subject,target)=>{
      let frontier=next(subject.entity,true).map(id=>({id,path:[subject.snapshot]}));const seen=new Set();
      for(let depth=0;frontier.length&&depth<this.policy('MaximumTypeDepth');depth++){
        const found=frontier.find(n=>n.id===target.entity.id);if(found)return found.path;
        const fresh=[...new Map(frontier.filter(n=>!seen.has(n.id)).map(n=>[n.id,n])).values()];
        if(seen.size+fresh.length>this.policy('MaximumTypeNodes'))return null;
        fresh.forEach(n=>seen.add(n.id));
        const cached=this.snapshots(source,fresh.map(n=>n.id)).filter(r=>r&&(!this.project.online||Date.now()-field(r.expression,'checkedAt',0)<this.policy('CacheMilliseconds')));
        frontier=cached.flatMap(r=>next(JSON.parse(values(r.expression)[0])).map(id=>({id,path:[...fresh.find(n=>n.id===field(r.expression,'externalId')).path,r.id]})));
      }
      return null;
    };
    const grounded=subjects.flatMap(subject=>kinds.flatMap(target=>{
      const path=retainedPath(subject,target);return path===null?[]:[{subject,target,path}];
    }));
    if(grounded.length){
      const proofs=grounded.map(({subject,target,path})=>this.store.put(call('TypeEvidence',[subject.identity,target.identity],{path:term('List',...path),kind}),{source:'derived:type-evidence',supports:[subject.snapshot,target.snapshot,...path,...this.store.parts('ResearchPolicy').map(p=>p.support)]}));
      session.supports.push(...proofs);
      return {subjects:[...new Map(grounded.map(g=>[g.subject.entity.id,g.subject])).values()],proofs};
    }
    const accepted=[],proofs=[];
    for(const subject of subjects){
      let frontier=next(subject.entity,true).map(id=>({id,path:[subject.snapshot]}));const visited=new Set();let matched;
      for(let depth=0;frontier.length&&depth<this.policy('MaximumTypeDepth');depth++){
        matched=frontier.find(node=>targets.has(node.id));if(matched)break;
        const fresh=[...new Map(frontier.filter(node=>!visited.has(node.id)).map(node=>[node.id,node])).values()];
        if(visited.size+fresh.length>this.policy('MaximumTypeNodes'))throw new Error('Type evidence search budget reached');
        fresh.forEach(node=>visited.add(node.id));if(!fresh.length)break;
        const entities=await this.entities(session,source,[...new Set(fresh.map(node=>node.id))]);
        frontier=entities.flatMap(e=>next(e.entity).map(id=>({id,path:[...fresh.find(node=>node.id===e.entity.id).path,e.snapshot]})));
      }
      if(matched){
        const target=kinds.find(k=>k.entity.id===matched.id),id=this.store.put(call('TypeEvidence',[subject.identity,target.identity],{path:term('List',...matched.path),kind}),{source:'derived:type-evidence',supports:[...matched.path,target.snapshot,...this.store.parts('ResearchPolicy').map(p=>p.support)]});
        session.supports.push(id);accepted.push(subject);proofs.push(id);
      }
    }
    return {subjects:accepted,proofs};
  }
  async subject(session,source,text,kind){
    const hits=await this.search(session,source,text,'item');
    if(!hits.length)throw new Error('I could not identify an exact source name or alias for “'+text+'”');
    const candidates=await this.entities(session,source,hits.map(h=>h.id),hits);
    const typed=await this.filterKind(session,source,candidates,kind);
    if(!typed.subjects.length)throw new Error('I found “'+text+'”, but no supported '+kind+' meaning');
    if(typed.subjects.length>1){
      const mapping=source.parts.find(p=>p.head==='Mapping'&&values(p)[1]?.head==='IsA');
      const typeIds=mapping?[...new Set(typed.subjects.flatMap(s=>this.claims(s.entity,values(mapping)[0]).map(c=>c.mainsnak.datavalue.value?.id).filter(externalID)))]:[];
      const types=typeIds.length?await this.entities(session,source,typeIds):[];
      const choices=typed.subjects.map(s=>{
        const type=mapping?this.claims(s.entity,values(mapping)[0]).map(c=>types.find(t=>t.entity.id===c.mainsnak.datavalue.value?.id)).filter(Boolean)[0]:null;
        const description=type?label(type.entity,source.language):s.entity.descriptions?.[source.language]?.value;
        // The offered source kind becomes a supported hint, so a plain choice
        // such as "cruise ship" can continue the pending question. It is not a
        // global synonym for the subject, and remains constrained by type proof.
        if(type)this.store.put(term('Concept',type.identity,term('ContextHint',call('ArgumentHint',[],{name:'kind',value:label(type.entity,source.language)}))),{source:'derived:offered-kind',supports:[s.snapshot,type.snapshot]});
        return label(s.entity,source.language)+(description?' ('+description+')':'');
      });
      return {reply:this.finish(session,'Do you mean '+choices.join(' or ')+'?',{kind:'ambiguous',status:'needs-evidence',supports:typed.proofs})};
    }
    return {subject:typed.subjects[0],proofs:typed.proofs};
  }
  unitID(value){return typeof value.unit==='string'?/\/(Q\d+)$/.exec(value.unit)?.[1]:undefined;}
  quantity(value,units,language){
    const id=this.unitID(value),unit=units.find(u=>u.entity.id===id);
    const display=String(value.amount).replace(/^\+/,'')+(unit?' '+label(unit.entity,language):value.unit!=='1'?' [unit: '+value.unit+']':'');
    return {display,value:call('Quantity',[value.amount],{unit:value.unit,lower:value.lowerBound??null,upper:value.upperBound??null}),unit};
  }
  async measure(subject,facets,{kind}={}){
    if(typeof subject!=='string'||!Array.isArray(facets)||!facets.length||facets.some(f=>typeof f!=='string'))throw new Error('Measurements need captured text and authored facets');
    if(kind!==undefined&&(typeof kind!=='string'||!kind.trim()))throw new Error('A supplied kind must be captured text');
    const query=format(call('MeasurementQuestion',[],{subject:key(subject),facets:term('List',...facets.map(key)),...(kind?{kind:key(kind)}:{})}));
    const held=this.cached(query);if(held)return this.emit(held);
    const session=this.session(query),source=this.project.sources.available().find(s=>s.adapter==='wikidata');
    if(!source)return this.finish(session,'I need a structured source to investigate measurements.',{status:'waiting'});
    try{
      const selected=await this.subject(session,source,subject,kind);if(selected.reply)return selected.reply;
      const s=selected.subject,rows=Object.keys(s.entity.claims??{}).flatMap(property=>this.claims(s.entity,property).filter(c=>c.mainsnak.datavalue.type==='quantity').map(claim=>({property,claim})));
      const propertyIds=[...new Set(rows.map(r=>r.property))];
      if(propertyIds.length>this.policy('MaximumMeasurements')||rows.length>this.policy('MaximumMeasurements')*4)throw new Error('Measurement evidence budget reached');
      const properties=propertyIds.length?await this.entities(session,source,propertyIds):[];
      const relevant=rows.map(r=>({...r,propertyEntity:properties.find(p=>p.entity.id===r.property)})).filter(r=>r.propertyEntity&&names(r.propertyEntity.entity).some(n=>facets.some(f=>key(n)===key(f))));
      if(!relevant.length)throw new Error('The source has no supported measurements for these size facets');
      const unitIds=[...new Set(relevant.map(r=>this.unitID(r.claim.mainsnak.datavalue.value)).filter(externalID))];
      const units=unitIds.length?await this.entities(session,source,unitIds):[],facts=[],measurements=[],displays=[];
      for(const {claim,propertyEntity}of relevant){
        const rendered=this.quantity(claim.mainsnak.datavalue.value,units,source.language),dates=(claim.qualifiers?.[this.setting('PointInTimeProperty')]??[]).map(q=>q.datavalue?.value?.time).filter(Boolean);
        const display=rendered.display+(dates.length?' (source date: '+dates.map(d=>d.replace(/^\+/,'').slice(0,10)).join(', ')+')':Object.keys(claim.qualifiers??{}).length?' (qualified source statement, see evidence)':'');
        const url='https://www.wikidata.org/wiki/'+s.entity.id;
        const id=this.store.put(call('KnowledgeFact',[],{subject:s.identity,relation:propertyEntity.identity,value:rendered.value,display,statement:claim.id??null,rank:claim.rank,qualifiers:JSON.stringify(claim.qualifiers??{}),references:JSON.stringify(claim.references??[]),url,revision:s.entity.lastrevid??null}),{source:'derived:source-claim',supports:[s.snapshot,propertyEntity.snapshot,...selected.proofs,...(rendered.unit?[rendered.unit.snapshot]:[])]});
        facts.push(id);measurements.push(call('Measurement',[],{relation:propertyEntity.identity,value:rendered.value,display}));displays.push(label(propertyEntity.entity,source.language)+': '+display);
      }
      return this.finish(session,label(s.entity,source.language)+' · '+[...new Set(displays)].join('; ')+'.',{answer:term('List',...measurements),supports:facts,url:'https://www.wikidata.org/wiki/'+s.entity.id});
    }catch(error){return this.finish(session,'I tried to research this, but '+error.message+'. The investigation is saved and can be retried.',{status:'waiting'});}
  }
  async fact(relation,subject,{kind}={}){
    const selector=isTerm(relation)&&relation.head==='RelationSelector',forms=selector?values(field(relation,'forms',term('List'))):[relation];
    if(!forms.length||forms.some(f=>typeof f!=='string')||typeof subject!=='string')throw new Error('Research arguments need text or an explicit relationship selector');
    if(kind!==undefined&&(typeof kind!=='string'||!kind.trim()))throw new Error('A supplied kind must be captured text');
    const query=format(call('FactQuestion',[],{relation:selector?relation:key(relation),subject:key(subject),...(kind?{kind:key(kind)}:{})})),held=this.cached(query);if(held)return this.emit(held);
    const session=this.session(query),source=this.project.sources.available().find(s=>s.adapter==='wikidata');
    if(!source)return this.finish(session,'I need a structured knowledge source to investigate this.',{status:'waiting'});
    try{
      if(!this.project.online&&!this.known(subject,source,'ExternalEntity').length)throw new Error('Online research is switched off');
      let propertyHits=[];
      for(const form of forms)propertyHits.push(...await this.search(session,source,form,'property'));
      propertyHits=[...new Map(propertyHits.map(p=>[p.id,p])).values()];
      let relationProofs=[];
      const traversal=selector?field(relation,'follow'):null;
      if(traversal&&isTerm(traversal)&&propertyHits.length){
        const roots=await this.entities(session,source,propertyHits.map(p=>p.id),propertyHits);
        const links=roots.flatMap(root=>this.store.parts(root.identity.head,traversal.head).flatMap(p=>values(p.expression).filter(isTerm).map(target=>({target,support:p.support,root}))));
        const relatedIds=[...new Set(links.flatMap(link=>this.store.parts(link.target.head,'ExternalIdentity').map(p=>values(p.expression)[0])).filter(id=>externalID(id)&&id.startsWith('P')))];
        // Referenced properties need not have been loaded before traversing the
        // source graph. Resolve their identities through the same local ID map.
        const mapping=source.parts.find(p=>p.head==='Mapping'&&values(p)[1]?.head===traversal.head);
        const direct=mapping?roots.flatMap(root=>this.claims(root.entity,values(mapping)[0]).filter(c=>!Object.keys(c.qualifiers??{}).length).map(c=>({id:c.mainsnak.datavalue.value?.id,root})).filter(x=>externalID(x.id)&&x.id.startsWith('P'))):[];
        const ids=[...new Set([...relatedIds,...direct.map(x=>x.id)])];
        if(ids.length>this.policy('MaximumRelatedProperties'))throw new Error('Related-property evidence budget reached');
        const related=ids.length?await this.entities(session,source,ids):[];
        propertyHits.push(...related.map(p=>({id:p.entity.id,label:label(p.entity,source.language)})));
        relationProofs=direct.map(link=>this.store.put(call('RelationPath',[relation,link.root.identity,identity(source.identity,link.id)],{relationship:traversal}),{source:'derived:relation-path',supports:[link.root.snapshot,...this.store.parts(source.identity).map(p=>p.support),...this.store.parts('ResearchPolicy').map(p=>p.support)]}));
        session.supports.push(...relationProofs);
      }
      if(!propertyHits.length)return await this.topic(selector?subject:subject+' '+forms.join(' '),{session,kind,purpose:selector?'missing-relationship':undefined});
      const subjectHits=await this.search(session,source,subject,'item');
      if(!subjectHits.length)return await this.topic(selector?subject:subject+' '+forms.join(' '),{session,kind,purpose:selector?'missing-relationship':undefined});
      const subjects=await this.entities(session,source,subjectHits.map(h=>h.id),subjectHits);
      // Presence of the requested relation narrows referents before bounded type
      // traversal. This keeps unrelated homonyms from consuming the whole budget.
      const relevant=subjects.filter(s=>propertyHits.some(p=>this.claims(s.entity,p.id).length));
      const typed=await this.filterKind(session,source,relevant,kind);
      if(kind&&!typed.subjects.length)return this.finish(session,'I found “'+subject+'”, but no supported '+kind+' meaning with this relationship. Could you give me more context?',{kind:'ambiguous',status:'needs-evidence'});
      const matches=typed.subjects.flatMap(s=>propertyHits.flatMap(p=>this.claims(s.entity,p.id).map(claim=>({subject:s,property:p,claim}))));
      const choices=new Map(matches.map(m=>[m.subject.entity.id+(selector?'':'|'+m.property.id),m]));
      if(choices.size>1){const labels=[...choices.values()].map(m=>label(m.subject.entity,source.language)+' ('+m.property.label+')');return this.finish(session,'I found more than one match: '+labels.join('; ')+'. Which did you mean?',{kind:'ambiguous',status:'needs-evidence'});}
      if(!matches.length)return await this.topic(selector?subject:subject+' '+forms.join(' '),{session,kind,purpose:selector?'missing-relationship':undefined});
      const selected=matches[0],property=selected.property;
      const properties=await this.entities(session,source,[...new Set(matches.map(m=>m.property.id))],matches.map(m=>m.property));
      const binding=this.store.put(call('RelationBinding',[relation,term('List',...properties.map(p=>p.identity))]),{source:'derived:relation-binding',supports:[...properties.map(p=>p.snapshot),...relationProofs]});
      session.supports.push(binding);
      const propertyEntity=properties[0];if(!propertyEntity)throw new Error('The source did not return its property definition');
      const targets=[...new Set(matches.map(m=>m.claim.mainsnak.datavalue.value?.id).filter(externalID))];
      const resolved=targets.length?await this.entities(session,source,targets):[];
      const facts=[],displays=[];
      for(const {subject:s,property:matchedProperty,claim} of matches){
        const propertyRecord=properties.find(p=>p.entity.id===matchedProperty.id);
        if(!propertyRecord)continue;
        const data=claim.mainsnak.datavalue,value=data.value;
        const target=value?.id?resolved.find(t=>t.entity.id===value.id):null;
        let display,targetValue;
        if(target){display=label(target.entity,source.language);targetValue=target.identity;}
        else if(typeof value==='string'||typeof value==='number'||typeof value==='boolean'){display=String(value);targetValue=value;}
        else if(data.type==='monolingualtext'){display=value.text;targetValue=call('LanguageText',[value.text],{language:value.language});}
        else if(data.type==='quantity'){display=String(value.amount).replace(/^\+/,'');targetValue=call('Quantity',[value.amount],{unit:value.unit,lower:value.lowerBound??null,upper:value.upperBound??null});}
        else if(data.type==='time'){display=value.time;targetValue=call('Time',[value.time],{precision:value.precision,calendar:value.calendarmodel});}
        else continue;
        const dates=(claim.qualifiers?.[this.setting('PointInTimeProperty')]??[]).map(q=>q.datavalue?.value?.time).filter(Boolean);
        if(dates.length)display+=' (source date: '+dates.map(d=>d.replace(/^\+/,'').slice(0,10)).join(', ')+')';
        else if(Object.keys(claim.qualifiers??{}).length)display+=' (qualified source statement, see evidence)';
        const url='https://www.wikidata.org/wiki/'+s.entity.id;
        const id=this.store.put(call('KnowledgeFact',[],{subject:s.identity,relation:propertyRecord.identity,value:targetValue,display,statement:claim.id??null,rank:claim.rank,qualifiers:JSON.stringify(claim.qualifiers??{}),references:JSON.stringify(claim.references??[]),url,revision:s.entity.lastrevid??null}),{source:'derived:source-claim',supports:[s.snapshot,propertyRecord.snapshot,...typed.proofs,...relationProofs,...(target?[target.snapshot]:[])]});
        facts.push(id);displays.push(selector?label(propertyRecord.entity,source.language)+': '+display:display);
      }
      if(!facts.length)throw new Error('This source value type cannot yet be rendered');
      const unique=[...new Set(displays)],subjectLabel=label(selected.subject.entity,source.language),propertyLabel=label(propertyEntity.entity,source.language);
      const assumed=key(subject)!==key(subjectLabel)?'I interpreted “'+subject+'” as '+subjectLabel+'. ':'';
      const text=assumed+(selector?'Source relationships for '+subjectLabel+': '+unique.join('; '):subjectLabel+' · '+propertyLabel+': '+unique.join('; '))+'.';
      return this.finish(session,text,{answer:unique.length===1?unique[0]:term('List',...unique),supports:facts,url:'https://www.wikidata.org/wiki/'+selected.subject.entity.id});
    }catch(error){return this.finish(session,'I tried to research this, but '+error.message+'. The investigation is saved and can be retried.',{status:'waiting'});}
  }
  async topic(subject,{session,kind,purpose}={}){
    const query=format(call('TopicQuestion',[],{subject:key(subject),...(kind?{kind:key(kind)}:{})}));
    const held=this.cached(query);if(held)return this.emit(held);
    session??=this.session(query);
    const source=this.project.sources.available().find(s=>s.adapter==='wikipedia-summary');
    if(!source)return this.finish(session,'I need an encyclopedia source to investigate this.',{status:'waiting'});
    try{
      if(!this.project.online)throw new Error('Online research is switched off');
      let chosen,exact;
      if(kind){
        const structured=this.project.sources.available().find(s=>s.adapter==='wikidata');
        if(!structured)throw new Error('I need a structured source to ground the supplied kind');
        const selected=await this.subject(session,structured,subject,kind);if(selected.reply)return selected.reply;
        const links=await this.json(session,structured,{action:'wbgetentities',ids:selected.subject.entity.id,props:'sitelinks',sitefilter:source.language+'wiki'});
        const title=links.data.entities?.[selected.subject.entity.id]?.sitelinks?.[source.language+'wiki']?.title;
        if(!title)throw new Error('The selected referent has no encyclopedia page in this language');
        chosen={title};exact=true;
      }else{
        const search=await this.json(session,source,{action:'query',list:'search',srsearch:subject,srlimit:3,formatversion:2});
        const hits=search.data.query?.search??[];
        if(!hits.length)throw new Error('Wikipedia returned no matching pages');
        exact=hits.find(h=>key(h.title)===key(subject));chosen=exact??hits[0];
      }
      const details=await this.json(session,source,{action:'query',titles:chosen.title,prop:'extracts|info|pageprops|revisions',inprop:'url',rvprop:'ids|timestamp',exintro:1,explaintext:1,exchars:1000,formatversion:2});
      const page=details.data.query?.pages?.find(p=>p.title===chosen.title)??details.data.query?.pages?.[0];
      if(!page?.extract?.trim())throw new Error('The matching page did not return readable introductory text');
      if(Object.hasOwn(page.pageprops??{},'disambiguation'))return this.finish(session,'Wikipedia has several meanings for “'+subject+'”. Could you give me a little more context?',{kind:'ambiguous',status:'needs-evidence'});
      const url=page.fullurl??new URL('/wiki/'+encodeURIComponent(page.title),source.endpoint).href;
      const excerpt=this.store.put(call('SourceExcerpt',[page.extract],{title:page.title,url,provider:term(source.identity),license:source.license,revision:page.revisions?.[0]?.revid??null,interpreted:false}),{source:'source:'+source.identity,supports:[details.evidence]});
      for(const old of this.store.records('SourceExcerpt').filter(r=>r.id!==excerpt&&field(r.expression,'url')===url&&format(field(r.expression,'provider'))===format(term(source.identity))&&(field(r.expression,'revision')!==(page.revisions?.[0]?.revid??null)||values(r.expression)[0]!==page.extract)))this.store.retract(old.id);
      session.supports.push(excerpt);
      const readings=await this.project.learner.readEvidence(excerpt);
      session.supports.push(...readings.map(r=>r.reading));
      // An excerpt is an attributed passage, not a silently asserted answer/fact.
      return this.finish(session,(exact?'Wikipedia on '+page.title+':\n\n':'The closest Wikipedia page I found is '+page.title+':\n\n')+page.extract+(exact?'':'\n\nIs that the subject you meant?'),{kind:'excerpt',supports:[excerpt],url,status:exact&&!purpose?'done':'needs-evidence'});
    }catch(error){return this.finish(session,'I tried to research this, but '+error.message+'. The investigation is saved and can be retried.',{status:'waiting'});}
  }
}
