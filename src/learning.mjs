import { capture } from './ears.mjs';
import { term,call,isTerm,values,field,format,parse,match,substitute } from './ncon.mjs';
import { learnRealization } from './code-learning.mjs';
import {digest} from './digest.mjs';
import {retainLexicalSense,lexicalRoutes} from './dictionary.mjs';

// Source passage boundaries are configured marks and retained byte spans. They
// do not require capitalization and do not cut numbers, quotations, code or URLs.
function evidencePassages(text,language,marks){
  const ends=new Set([text.length]),input=capture(text);
  const protectedSpans=input.tokens.filter(t=>t.protected||t.kind==='number');
  for(const part of new Intl.Segmenter(language,{granularity:'sentence'}).segment(text)){const end=part.index+part.segment.length;if(!protectedSpans.some(t=>end>t.start&&end<t.end))ends.add(end);}
  for(const token of input.tokens)if(!token.protected&&marks.has(token.raw)&&(token.end===text.length||/\s/u.test(text[token.end]))){
    let end=token.end;while(end<text.length&&/\s/u.test(text[end]))end++;ends.add(end);
  }
  const spans=[];let index=0;for(const end of [...ends].sort((a,b)=>a-b)){if(end>index)spans.push({segment:text.slice(index,end),index});index=end;}return spans;
}

// One request worklist: evidence acquisition, grounded frames, implementation
// lessons, then reinterpretation. Domain meanings are authored/imported concepts.
export class Learner {
  constructor(project){this.project=project;this.store=project.store;}
  async observeDefinition(form,definition){
    const p=this.project,profile=p.responseProfile??p.profile,episode=p.responseEpisode,reading=p.responseReading;
    if(!episode||!reading)throw new Error('A conversational definition needs its committed observation and reading');
    if(![form,definition].every(text=>typeof text==='string'&&text.trim()&&text.length<=p.policy('DictionaryLearningPolicy','MaximumReferenceCharacters')))throw new Error('Definition reference exceeds the retained learning budget');
    const source='user:definition:'+episode,previous=p.store.db.prepare('SELECT id,active FROM records WHERE head=? AND source=?').all('LexicalDefinition',source);
    let observation=previous.find(r=>r.active)?.id;
    if(!observation&&previous.length)return call('FormLearning',[form,definition],{known:false,withdrawn:true});
    const identity=term('C_'+digest(source+'|'+form+'|'+definition));
    if(!observation){
      observation=p.store.put(call('LexicalDefinition',[form,definition],{profile,episode,sequence:p.sequence()}),{source,supports:[episode,reading]});
      retainLexicalSense(p.store,{identity,observation,surface:form,gloss:definition,paraphrase:definition,profile,source:'derived:user-defined-sense',label:form+' · your definition'});
    }
    // The same request learner investigates the referenced term. A definition
    // records a language claim; this path never executes its interpreted meaning.
    await this.request(capture(form),{profile,context:term('Context'),acquire:p.online,episode});
    const routes=p.store.definitions().has(identity.head)?lexicalRoutes(p.store,identity.head,profile,p.lexicalOptions()):{routes:[]};
    p.responseEvidence?.push(observation,...routes.routes.flatMap(r=>r.supports));
    return call('FormLearning',[form,definition],{known:Boolean(routes.routes.length&&!routes.exhausted),withdrawn:false});
  }
  retainAttributedLearning(attribution){
    const store=this.store,p=this.project,claim=store.record(attribution);
    if(!claim?.active||claim.expression.head!=='AttributedMeaning')return [];
    const document=store.record(field(claim.expression,'document'));
    if(!document?.active||!['SourceExcerpt','SourceDocument'].includes(document.expression.head))return [];
    const meaning=values(claim.expression)[0];if(!isTerm(meaning))return [];
    const proof=store.typeProof(meaning.head,'Assertion');if(!proof)return [];
    const contracts=store.parts(meaning.head,'LearningAssertion'),created=[];
    for(const contract of contracts){
      if(values(contract.expression)[0]!=='lexical-reference')continue;
      const [form,definition]=values(meaning),profile=field(claim.expression,'profile','');
      if(![form,definition].every(text=>typeof text==='string'&&text.trim()&&text.length<=p.policy('DictionaryLearningPolicy','MaximumReferenceCharacters')))continue;
      const source='source:definition:'+attribution,prior=store.db.prepare('SELECT id,active FROM records WHERE head=? AND source=?').all('LexicalDefinition',source);
      // A retained or withdrawn assertion is not silently reinstalled on review.
      if(prior.length)continue;
      const observation=store.put(call('LexicalDefinition',[form,definition],{profile,attribution,document:document.id,sequence:p.sequence()}),{source,supports:[attribution,contract.support,...proof,...store.parts('DictionaryLearningPolicy').map(p=>p.support)]});
      const identity=term('C_'+digest(source+'|'+form+'|'+definition));
      created.push(retainLexicalSense(store,{identity,observation,surface:form,gloss:definition,paraphrase:definition,profile,source:'derived:source-defined-sense',label:form+' · attributed definition'}));
      const route=lexicalRoutes(store,identity.head,profile,p.lexicalOptions());
      if(route.needs.length)store.put(call('Need',route.needs.map(text=>term('LearnSense',text)),{phase:'assertion',definition:observation,profile,document:document.id}),{source:'derived:definition-need',supports:[observation]});
      for(const reference of route.needs)store.enqueue(reference,'lexical');
    }
    return created;
  }
  languageFingerprint(){return digest(this.store.records('Concept').map(r=>r.id).sort().join('\n'));}
  // Sources and users share capture, lexical proposals, frames and selection.
  // Reading evidence never runs its meaning or treats it as a user command.
  async readEvidence(recordId,{profile=this.project.responseProfile??this.project.profile,context=term('Context',term('SourceEvidence'))}={}){
    const record=this.store.record(recordId);
    if(!record?.active)throw new Error('Expected active source evidence');
    const text=values(record.expression)[0];
    if(typeof text!=='string')return [];
    const accepted=record.expression.head==='SourceExcerpt'||record.expression.head==='SourceDocument'&&/^text\/plain(?:;|$)/i.test(field(record.expression,'contentType',''));
    if(!accepted)return []; // JSON, HTML and program bytes need their own data readers.
    await this.project.prepare();this.bindSenses();
    const maximum=this.project.policy('EvidenceReadingPolicy','MaximumPassages'),results=[],selected=[];
    let lexicalJobs=0;const queued=new Set(this.store.agenda().filter(j=>j.kind==='lexical').map(j=>j.query.normalize('NFC').toLowerCase()));
    const prior=this.store.records('EvidenceObservation').filter(r=>field(r.expression,'document')===recordId&&field(r.expression,'profile','')===profile&&format(field(r.expression,'context'))===format(context));
    const seen=new Set(prior.map(r=>field(r.expression,'start')+':'+field(r.expression,'end')));
    const resolved=new Set(this.store.records('EvidenceReading').filter(r=>values(r.expression)[0]?.head==='Resolved').map(r=>field(r.expression,'observation'))),language=this.languageFingerprint(),reviews=new Map();
    for(const review of this.store.records('EvidenceReview')){const observation=field(review.expression,'observation'),held=reviews.get(observation);if(!held||field(review.expression,'sequence',0)>field(held.expression,'sequence',0))reviews.set(observation,review);}
    let unfinished=false;
    // Advance through unread passages first. A difficult first sentence cannot
    // monopolize every bounded revisit and hide the rest of a retained document.
    const boundaries=new Set(this.store.parts('EvidenceReadingPolicy','PassageBoundary').map(p=>values(p.expression)[0]));
    for(const {segment,index}of evidencePassages(text,field(record.expression,'language','en'),boundaries)){
      if(!segment.trim()||seen.has(index+':'+(index+segment.length)))continue;
      if(selected.length>=maximum){unfinished=true;break;}
      selected.push({segment,index});
    }
    const revisitable=prior.filter(o=>!resolved.has(o.id)||field(reviews.get(o.id)?.expression,'language')!==language).sort((a,b)=>field(reviews.get(a.id)?.expression,'sequence',0)-field(reviews.get(b.id)?.expression,'sequence',0)||field(a.expression,'start')-field(b.expression,'start'));
    if(revisitable.length>maximum-selected.length)unfinished=true;
    for(const observation of revisitable){
      if(selected.length>=maximum)break;
      selected.push({segment:values(values(observation.expression)[0])[0],index:field(observation.expression,'start')});
    }
    for(const {segment,index}of selected){
      // Keep the sentence, including its whitespace and exact document offsets.
      const input=capture(segment),observation=this.store.put(call('EvidenceObservation',[input.expression],{document:recordId,start:index,end:index+segment.length,profile,context}),{source:'derived:evidence-observation',supports:[recordId,...this.store.parts('EvidenceReadingPolicy').map(p=>p.support)]});
      let analysis=await this.project.analyze(input,{profile,context});
      this.activateFrames(analysis);analysis=await this.project.analyze(input,{profile,context});
      const selected=this.best(analysis),assertionProof=selected&&this.store.typeProof(selected.meaning?.head,'Assertion'),best=selected&&assertionProof!==null&&assertionProof!==undefined?selected:null,result=best?term('Resolved',best.meaning):term(analysis.candidates.length?'Ambiguous':'Learning',term('List',...analysis.candidates.map(c=>this.project.candidateExpression(c))));
      const supports=[observation,...(assertionProof??[]),...this.store.parts('InterpretationPolicy').map(p=>p.support),...analysis.candidates.flatMap(c=>c.supports)];
      const reading=this.store.put(call('EvidenceReading',[result],{observation,document:recordId,profile,readings:term('List',...analysis.candidates.map(c=>this.project.candidateExpression(c)))}),{source:'derived:evidence-reading',supports:[...new Set(supports)]});
      // Changed language evidence replaces the previous reading of this passage.
      for(const old of this.store.records('EvidenceReading').filter(r=>r.id!==reading&&field(r.expression,'observation')===observation))this.store.retract(old.id);
      if(best){const attribution=this.store.put(call('AttributedMeaning',[best.meaning],{observation,document:recordId,profile,text:segment,url:field(record.expression,'url',null),license:field(record.expression,'license','unspecified')}),{source:'derived:attributed-meaning',supports:[reading]});this.retainAttributedLearning(attribution);}
      this.store.put(call('EvidenceReview',[],{observation,reading,language,sequence:this.project.sequence()}),{source:'derived:evidence-review',supports:[reading]});
      if(!best){const words=[...new Set(this.unknowns(input,analysis))];
        if(words.length)this.store.put(call('Need',words.map(word=>term('LearnSense',word)),{phase:'evidence',profile,observation,document:recordId}),{source:'derived:evidence-need',supports:[observation]});
        for(const word of words){const key=word.normalize('NFC').toLowerCase();if(queued.has(key))continue;if(lexicalJobs>=this.project.policy('EvidenceReadingPolicy','MaximumLexicalJobs'))break;
          this.store.enqueue(word,'lexical');queued.add(key);lexicalJobs++;
        }
      }
      const job=this.store.enqueue(observation,'evidence-reading');
      this.store.updateJob(job,best?'done':'needs-evidence',best?'Read with the same retained language evidence as user input':'Passage retained; missing or competing language evidence remains explicit');
      results.push({observation,reading,result});
    }
    const scan=this.store.enqueue(format(term('EvidenceDocument',recordId,profile,context)),'evidence-document');
    this.store.updateJob(scan,unfinished?'waiting':'done',unfinished?'Unread passages remain; continue from retained observations':'Every passage has been observed; unresolved readings remain separate work');
    return results;
  }
  async revisitEvidence({budget=4,profile=this.project.profile}={}){
    const resolved=new Set(this.store.records('EvidenceReading').filter(r=>values(r.expression)[0]?.head==='Resolved').map(r=>field(r.expression,'observation'))),language=this.languageFingerprint(),reviews=new Map();
    for(const review of this.store.records('EvidenceReview')){const id=field(review.expression,'observation'),held=reviews.get(id);if(!held||field(review.expression,'sequence',0)>field(held.expression,'sequence',0))reviews.set(id,review);}
    const jobs=this.store.agenda(),documents=[];
    for(const job of jobs)if(job.kind==='evidence-document'){
      const scope=parse(job.query);if(values(scope)[1]===profile)documents.push(values(scope)[0]);
    }
    for(const observation of this.store.records('EvidenceObservation'))if(field(observation.expression,'profile','')===profile&&(!resolved.has(observation.id)||field(reviews.get(observation.id)?.expression,'language')!==language))documents.push(field(observation.expression,'document'));
    const recency=new Map();for(const review of reviews.values()){const document=field(this.store.record(field(review.expression,'observation'))?.expression,'document');recency.set(document,Math.max(recency.get(document)??0,field(review.expression,'sequence',0)));}
    const fair=[...new Set(documents)].sort((a,b)=>(recency.get(a)??0)-(recency.get(b)??0));
    for(const document of fair.slice(0,budget))if(this.store.record(document)?.active)await this.readEvidence(document,{profile});
  }
  queryEvidence(pattern){
    const matches=[];
    const fits=(query,value,bindings,proofs)=>{
      if(isTerm(query)&&query.head==='Hole'){
        const expected=field(query,'expected'),role=field(query,'role');
        const identity=isTerm(value)?value.head:({string:'String',number:'Number',boolean:'Boolean'}[typeof value]);
        if(expected){const proof=identity&&this.store.typeProof(identity,expected.head);if(!proof)return false;proofs.push(...proof);}
        if(role){if(bindings.has(role)&&format(bindings.get(role))!==format(value))return false;bindings.set(role,value);}return true;
      }
      if(!isTerm(query)||!isTerm(value))return format(query)===format(value);
      if(query.head!==value.head||values(query).length!==values(value).length)return false;
      for(let i=0;i<values(query).length;i++)if(!fits(values(query)[i],values(value)[i],bindings,proofs))return false;
      for(const arg of query.args.filter(a=>a.name!==undefined)){const actual=value.args.find(a=>a.name===arg.name);if(!actual||!fits(arg.value,actual.value,bindings,proofs))return false;}
      return true;
    };
    for(const record of this.store.records('AttributedMeaning').filter(r=>field(r.expression,'profile','')===(this.project.responseProfile??this.project.profile))){
      const bindings=new Map(),proofs=[];
      if(fits(pattern,values(record.expression)[0],bindings,proofs))matches.push({record,bindings,proofs});
    }
    if(!matches.length)return call('Replied',[],{text:'I need more evidence to fill this request. I have retained the missing relationships.',pending:true});
    const choices=[...new Set(matches.map(m=>m.bindings.size?format(term('Bindings',...Array.from(m.bindings,([name,value])=>call('Binding',[value],{name})))):format(values(m.record.expression)[0])))];
    this.project.responseEvidence?.push(...matches.flatMap(m=>[m.record.id,...m.proofs]));
    if(choices.length>1)return call('Replied',[],{text:'The retained sources give different supported possibilities:\n\n'+matches.map(m=>field(m.record.expression,'text')).join('\n\n'),research:'ambiguous',pending:true});
    const chosen=matches[0],bindings=[...chosen.bindings.values()],answer=bindings.length===1?bindings[0]:term('Bindings',...Array.from(chosen.bindings,([name,value])=>call('Binding',[value],{name})));
    return call('Replied',[],{text:bindings.length===1 ? (typeof answer==='string'?answer:format(answer))+'\n\n'+field(chosen.record.expression,'text').trim() : field(chosen.record.expression,'text').trim(),answer,research:'attributed-meaning',url:field(chosen.record.expression,'url'),evidence:chosen.record.id});
  }
  bindSenses(){
    const identities=[...this.store.definitions()].flatMap(([owner])=>this.store.parts(owner,'SenseIdentity').map(p=>({owner,...p})));
    for(const record of this.store.records('Concept')) {
      const [identity,...parts]=values(record.expression);
      for(const external of parts.filter(p=>isTerm(p)&&p.head==='ExternalIdentity')) {
        for(const sense of identities) {
          if(values(external)[0]!==values(sense.expression)[0]||format(field(external,'source'))!==format(field(sense.expression,'source'))) continue;
          // This is a supported alias/sense proposal. Context chooses its use.
          this.store.put(term('Concept',identity,term('Denotes',term(sense.owner))),{source:'derived:sense-binding',supports:[record.id,sense.support]});
        }
      }
    }
  }
  activateFrames(analysis){
    for(const edge of analysis.edges) {
      if(edge.protected||!isTerm(edge.meaning)||edge.meaning.args.length) continue;
      for(const frame of this.store.parts(edge.meaning.head,'Frame')) {
        const construction=call('Construction',[],{pattern:field(frame.expression,'pattern'),meaning:field(frame.expression,'meaning'),weight:field(frame.expression,'weight',0)});
        this.store.put(term('Concept',term(edge.meaning.head),construction),{source:'derived:frame-learning',supports:[frame.support,...edge.supports]});
      }
    }
  }
  best(analysis,{allowFallback=true}={}){
    const [best,next]=analysis.candidates;
    return best&&!best.holes.length&&!analysis.exhausted&&(allowFallback||!this.store.parts(best.meaning?.head,'LearningFallback').length)&&(!next||best.score-next.score>=this.project.policy('InterpretationPolicy','Margin'))?best:null;
  }
  async realize(expression,steps){
    if(!isTerm(expression)) return;
    for(const arg of expression.args) await this.realize(arg.value,steps);
    if(!this.store.isA(expression.head,'ComputableExpression')&&!this.store.parts(expression.head,'ImplementationLesson').length) return;
    const existing=this.store.parts(expression.head,'Realization').filter(p=>match(values(p.expression)[0],expression,new Map()));
    if(existing.length) return;
    const query=format(expression),jobId=this.store.enqueue(query,'realization');
    if(steps.some(s=>s.kind==='realization'&&s.query===query)) return;
    for(const lesson of this.store.parts(expression.head,'ImplementationLesson')) {
      const [pattern]=values(lesson.expression); if(!match(pattern,expression,new Map())) continue;
      const source='implementation:'+lesson.support;
      // A withdrawn lesson stays withdrawn; an explicit revision supplies new evidence.
      if(this.store.db.prepare('SELECT id FROM records WHERE head=? AND source=?').all('CodeExample',source).length) continue;
      const checks=values(field(lesson.expression,'checks',term('List'))).map(check=>({input:values(check)[0],output:values(check)[1]}));
      if(checks.length<2) {steps.push({kind:'realization',query:format(expression),status:'needs-evidence',detail:'Implementation lesson needs at least two execution checks'});continue;}
      try{
        const result=await learnRealization(this.project,{pattern,code:field(lesson.expression,'code'),body:field(lesson.expression,'body'),language:field(lesson.expression,'language','ncon'),checks},{source,supports:[lesson.support]});
        steps.push({kind:'realization',query:format(expression),status:'done',detail:'Compiled and checked a concept implementation lesson',evidence:result.evidence});
      }catch(error){steps.push({kind:'realization',query:format(expression),status:'needs-evidence',detail:error.message});}
    }
    const installed=this.store.parts(expression.head,'Realization').some(p=>match(values(p.expression)[0],expression,new Map()));
    this.store.updateJob(jobId,installed?'done':'waiting',installed?'Learned a checked implementation':'Missing or withdrawn implementation evidence; retained for revision');
  }
  unknowns(input,analysis){
    const literals=new Set();
    for(const [,definitions]of this.store.definitions())for(const definition of definitions) {
      const visit=x=>{if(!isTerm(x))return;if(x.head==='Literal'&&typeof values(x)[0]==='string')for(const t of capture(values(x)[0]).tokens)if(t.kind==='word')literals.add(t.raw.normalize('NFC').toLowerCase());x.args.forEach(a=>visit(a.value));};
      definition.parts.filter(p=>p.head==='Construction').forEach(visit);
    }
    const covered=new Set(analysis.edges.filter(e=>!e.repair&&!e.unresolved).flatMap(e=>Array.from({length:e.end-e.start},(_,i)=>i+e.start)));
    for(const fragment of analysis.fragments??[])for(const piece of fragment.consumed??[])if(piece.formReading)for(let i=piece.start;i<piece.end;i++)covered.add(i);
    return analysis.units.flatMap((u,i)=>u.kind==='word'&&!u.protected&&!covered.has(i)&&!literals.has(u.raw.normalize('NFC').toLowerCase())?[u.raw]:[]);
  }
  async decode(input,{profile,context,contextSupports=[],deadline},steps){
    const p=this.project, maximum=p.policy('RequestLearningPolicy','MaximumDecodings');let attempts=0;
    for(const [owner]of this.store.definitions())for(const form of this.store.parts(owner,'ReadForm')){
      const required=values(field(form.expression,'context',term('Context')));
      if(!required.every(n=>values(context).some(a=>format(n)===format(a))))continue;
      const notation=field(form.expression,'notation');
      if(notation&&values(context).some(a=>isTerm(a)&&a.head===notation.head&&format(a)!==format(notation)))continue;
      const [pattern]=values(form.expression);
      if(!isTerm(pattern)||!match(pattern,term(pattern.head,''),new Map()))continue;
      const names=values(pattern).filter(v=>v?.variable);if(names.length!==1)continue;
      for(const token of input.tokens.filter(t=>t.kind==='word'&&!t.protected&&t.raw.length<=128)){
        const recognizes=field(form.expression,'recognizes');
        if(recognizes&&!p.evaluator.capabilities['text.matches'](token.raw,recognizes))continue;
        if(attempts++>=maximum||Date.now()>=deadline)return;
        const expression=substitute(pattern,new Map([[names[0].variable,token.raw]]));
        await this.realize(expression,steps);
        if(!this.store.parts(expression.head,'Realization').some(r=>match(values(r.expression)[0],expression,new Map())))continue;
        try{
          const run=await p.evaluator.evaluate(expression,{context});
          if(!['number','string','boolean'].includes(typeof run.value)||typeof run.value==='number'&&!Number.isFinite(run.value))continue;
          const expected=field(form.expression,'primitive');if(expected&&typeof run.value!==expected)continue;
          const id=this.store.put(call('DecodedValue',[token.raw,run.value],{profile,context:term('Context',...required,...(notation&&values(context).some(a=>format(a)===format(notation))?[notation]:[])),fragmentOnly:field(form.expression,'fragmentOnly',true)}),
            {source:'derived:notation-reading',supports:[form.support,...this.store.parts('RequestLearningPolicy','MaximumDecodings').map(p=>p.support),...contextSupports,...run.trace.flatMap(t=>t.support?[t.support]:t.supports??[])]});
          if(!steps.some(s=>s.kind==='decoding'&&s.query===token.raw&&s.evidence===id))steps.push({kind:'decoding',query:token.raw,status:'done',detail:'Read a value using a checked concept realization',evidence:id});
        }catch(error){steps.push({kind:'decoding',query:token.raw,status:'needs-evidence',detail:error.message});}
      }
    }
  }
  async request(input,{profile,context,contextSupports=[],acquire=true,episode,traceRun}){
    const p=this.project,steps=[],attempted=new Set(),started=Date.now();
    const maximum=p.policy('RequestLearningPolicy','MaximumPasses'),jobs=p.policy('RequestLearningPolicy','MaximumJobs'),milliseconds=p.policy('RequestLearningPolicy','MaximumMilliseconds');
    if(traceRun)p.trace(traceRun,episode,'learning.independent.started',{acquire,maximumPasses:maximum,maximumJobs:jobs,maximumMilliseconds:milliseconds,reason:'Use retained language, evidence, source examples and implementation lessons before optional teaching'});
    await this.revisitEvidence({budget:p.policy('EvidenceReadingPolicy','RevisitBudget'),profile});
    let analysis=await p.analyze(input,{profile,context,episode});
    // Needs are part of Pocket's own worklist, even with no teacher configured.
    // Preserve the before/after hypotheses and their support rather than using
    // an unstructured "unknown" message as the learning state.
    const gaps=[];
    if(!this.best(analysis,{allowFallback:false}))gaps.push(term(analysis.candidates.length?'RefineInterpretation':'LearnConstruction'));
    for(const candidate of analysis.contextRejected??[])gaps.push(...candidate.contextProof.needs);
    for(const word of new Set([...this.unknowns(input,analysis),...(analysis.lexicalNeeds??[])]))gaps.push(term('LearnSense',word));
    for(const candidate of analysis.candidates)for(const hole of candidate.holes)gaps.push(term('FillRole',hole));
    const need=gaps.length?this.store.put(call('Need',gaps,{episode,profile,context,phase:'independent',sequence:p.sequence(),hypotheses:term('List',...analysis.candidates.map(c=>p.candidateExpression(c)))}),{source:'derived:learning-need',supports:[episode,...analysis.candidates.flatMap(c=>c.supports)]}):null;
    if(need)await p.onProgress?.({stage:'learning',message:'Pocket is checking source meanings, examples and retained concepts…'});
    if(!this.best(analysis,{allowFallback:false})){await this.decode(input,{profile,context,contextSupports,deadline:started+milliseconds},steps);analysis=await p.analyze(input,{profile,context,episode});}
    for(let pass=0;pass<maximum&&Date.now()-started<milliseconds;pass++) {
      this.bindSenses();this.activateFrames(analysis);
      if(analysis.graphVersion!==this.store.version) analysis=await p.analyze(input,{profile,context,episode});
      const chosen=this.best(analysis);
      if(chosen&&!this.store.parts(chosen.meaning?.head,'LearningFallback').length){await this.realize(chosen.meaning,steps);break;}
      const frontier=[...new Set([...this.unknowns(input,analysis),...(analysis.lexicalNeeds??[])])];
      const current=this.store.agenda().filter(j=>j.kind==='composition'&&j.query===input.source||j.kind==='lexical'&&frontier.includes(j.query));
      for(const query of frontier)if(!current.some(j=>j.kind==='lexical'&&j.query===query)) {const id=this.store.enqueue(query,'lexical');current.push(this.store.job(id));}
      if(!acquire||!p.online||attempted.size>=jobs) break;
      // First accept any supplied outcomes; then acquire meanings, rather than
      // starving the current request behind an old notebook's unfinished work.
      current.sort((a,b)=>(a.kind==='composition'?0:analysis.lexicalNeeds?.includes(a.query)?1:2)-(b.kind==='composition'?0:analysis.lexicalNeeds?.includes(b.query)?1:2));
      const job=current.find(j=>!attempted.has(j.id));if(!job)break;
      attempted.add(job.id);
      if(traceRun)p.trace(traceRun,episode,'learning.job.selected',{job:job.id,kind:job.kind,query:job.query,reason:job.kind==='composition'?'Seek independent example outcomes first':'Acquire a currently uncovered lexical sense',alternatives:current.filter(j=>!attempted.has(j.id)).slice(0,8).map(j=>({id:j.id,kind:j.kind,query:j.query}))});
      steps.push(...await p.tick({budget:1,jobs:[job],timeout:Math.max(1,milliseconds-(Date.now()-started))}));
      this.bindSenses();
      analysis=await p.analyze(input,{profile,context,episode});
    }
    // Last acquired evidence must be usable even at the final worklist boundary.
    this.bindSenses();analysis=await p.analyze(input,{profile,context,episode});this.activateFrames(analysis);
    analysis=await p.analyze(input,{profile,context,episode});
    const chosen=this.best(analysis);if(chosen)await this.realize(chosen.meaning,steps);
    const run=this.store.put(call('LearningRun',[input.expression],{episode,sequence:p.sequence(),steps:term('List',...steps.map(s=>call('LearningStep',[s.query],{kind:s.kind,status:s.status,detail:s.detail??'',evidence:s.evidence??null}))),elapsed:Date.now()-started}),{source:'derived:learning-run',supports:[episode,...steps.flatMap(s=>s.evidence?[s.evidence]:[]),...this.store.parts('RequestLearningPolicy').map(p=>p.support)]});
    if(traceRun)p.trace(traceRun,episode,'learning.independent.completed',{run,need,chosen:chosen?format(chosen.meaning):null,elapsed:Date.now()-started,steps:steps.map(s=>({kind:s.kind,query:s.query,status:s.status,detail:s.detail??'',evidence:s.evidence??null}))});
    if(need)this.store.put(call('NeedStatus',[],{need,status:this.best(analysis,{allowFallback:false})?'interpreted':'open',hypotheses:term('List',...analysis.candidates.map(c=>p.candidateExpression(c))),sequence:p.sequence()}),{source:'derived:need-status',supports:[need,run,...analysis.candidates.flatMap(c=>c.supports)]});
    return {analysis,attempts:steps};
  }
}
