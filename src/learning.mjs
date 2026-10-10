import { capture } from './ears.mjs';
import { term,call,isTerm,values,field,format,match,substitute } from './ncon.mjs';
import { learnRealization } from './code-learning.mjs';

// One request worklist: evidence acquisition, grounded frames, implementation
// lessons, then reinterpretation. Domain meanings are authored/imported concepts.
export class Learner {
  constructor(project){this.project=project;this.store=project.store;}
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
    const maximum=this.project.policy('EvidenceReadingPolicy','MaximumPassages'),results=[];
    const segments=new Intl.Segmenter('en',{granularity:'sentence'}).segment(text);
    for(const {segment,index}of segments){
      if(results.length>=maximum)break;
      if(!segment.trim())continue;
      // Keep the sentence, including its whitespace and exact document offsets.
      const input=capture(segment),observation=this.store.put(call('EvidenceObservation',[input.expression],{document:recordId,start:index,end:index+segment.length,profile,context}),{source:'derived:evidence-observation',supports:[recordId,...this.store.parts('EvidenceReadingPolicy').map(p=>p.support)]});
      let analysis=await this.project.analyze(input,{profile,context});
      this.activateFrames(analysis);analysis=await this.project.analyze(input,{profile,context});
      const selected=this.best(analysis),best=selected&&!this.store.isA(selected.meaning?.head,'Request')?selected:null,result=best?term('Resolved',best.meaning):term(analysis.candidates.length?'Ambiguous':'Learning',term('List',...analysis.candidates.map(c=>this.project.candidateExpression(c))));
      const supports=[observation,...this.store.parts('InterpretationPolicy').map(p=>p.support),...analysis.candidates.flatMap(c=>c.supports)];
      const reading=this.store.put(call('EvidenceReading',[result],{observation,document:recordId,profile,readings:term('List',...analysis.candidates.map(c=>this.project.candidateExpression(c)))}),{source:'derived:evidence-reading',supports:[...new Set(supports)]});
      // Changed language evidence replaces the previous reading of this passage.
      for(const old of this.store.records('EvidenceReading').filter(r=>r.id!==reading&&field(r.expression,'observation')===observation))this.store.retract(old.id);
      if(best)this.store.put(call('AttributedMeaning',[best.meaning],{observation,document:recordId,profile,text:segment,url:field(record.expression,'url',null),license:field(record.expression,'license','unspecified')}),{source:'derived:attributed-meaning',supports:[reading]});
      const job=this.store.enqueue(observation,'evidence-reading');
      this.store.updateJob(job,best?'done':'needs-evidence',best?'Read with the same retained language evidence as user input':'Passage retained; missing or competing language evidence remains explicit');
      results.push({observation,reading,result});
    }
    return results;
  }
  async revisitEvidence({budget=4,profile=this.project.profile}={}){
    const jobs=this.store.agenda().filter(j=>j.kind==='evidence-reading'&&field(this.store.record(j.query)?.expression,'profile','')===profile).slice(0,budget),documents=[...new Set(jobs.map(j=>field(this.store.record(j.query)?.expression,'document')).filter(Boolean))];
    for(const document of documents)if(this.store.record(document)?.active)await this.readEvidence(document,{profile});
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
  best(analysis){
    const [best,next]=analysis.candidates;
    return best&&!best.holes.length&&!analysis.exhausted&&(!next||best.score-next.score>=this.project.policy('InterpretationPolicy','Margin'))?best:null;
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
    const covered=new Set(analysis.edges.flatMap(e=>Array.from({length:e.end-e.start},(_,i)=>i+e.start)));
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
  async request(input,{profile,context,contextSupports=[],acquire=true,episode}){
    const p=this.project,steps=[],attempted=new Set(),started=Date.now();
    const maximum=p.policy('RequestLearningPolicy','MaximumPasses'),jobs=p.policy('RequestLearningPolicy','MaximumJobs'),milliseconds=p.policy('RequestLearningPolicy','MaximumMilliseconds');
    await this.revisitEvidence({budget:p.policy('EvidenceReadingPolicy','RevisitBudget'),profile});
    let analysis=await p.analyze(input,{profile,context});
    // Needs are part of Pocket's own worklist, even with no teacher configured.
    // Preserve the before/after hypotheses and their support rather than using
    // an unstructured "unknown" message as the learning state.
    const gaps=[];
    if(!this.best(analysis))gaps.push(term(analysis.candidates.length?'ResolveAlternatives':'LearnConstruction'));
    for(const word of this.unknowns(input,analysis))gaps.push(term('LearnSense',word));
    for(const candidate of analysis.candidates)for(const hole of candidate.holes)gaps.push(term('FillRole',hole));
    const need=gaps.length?this.store.put(call('Need',gaps,{episode,profile,context,phase:'independent',sequence:p.sequence(),hypotheses:term('List',...analysis.candidates.map(c=>p.candidateExpression(c)))}),{source:'derived:learning-need',supports:[episode,...analysis.candidates.flatMap(c=>c.supports)]}):null;
    if(need)await p.onProgress?.({stage:'learning',message:'Pocket is checking source meanings, examples and retained concepts…'});
    if(!this.best(analysis)){await this.decode(input,{profile,context,contextSupports,deadline:started+milliseconds},steps);analysis=await p.analyze(input,{profile,context});}
    for(let pass=0;pass<maximum&&Date.now()-started<milliseconds;pass++) {
      this.bindSenses();this.activateFrames(analysis);
      if(analysis.graphVersion!==this.store.version) analysis=await p.analyze(input,{profile,context});
      const chosen=this.best(analysis);
      if(chosen){await this.realize(chosen.meaning,steps);break;}
      if(!acquire||!p.online||attempted.size>=jobs) break;
      const frontier=this.unknowns(input,analysis);
      const current=this.store.agenda().filter(j=>j.kind==='composition'&&j.query===input.source||j.kind==='lexical'&&frontier.includes(j.query));
      for(const query of frontier)if(!current.some(j=>j.kind==='lexical'&&j.query===query)) {const id=this.store.enqueue(query,'lexical');current.push(this.store.job(id));}
      // First accept any supplied outcomes; then acquire meanings, rather than
      // starving the current request behind an old notebook's unfinished work.
      current.sort((a,b)=>(a.kind==='composition'?0:1)-(b.kind==='composition'?0:1));
      const job=current.find(j=>!attempted.has(j.id));if(!job)break;
      attempted.add(job.id);
      steps.push(...await p.tick({budget:1,jobs:[job],timeout:Math.max(1,milliseconds-(Date.now()-started))}));
      analysis=await p.analyze(input,{profile,context});
    }
    // Last acquired evidence must be usable even at the final worklist boundary.
    this.bindSenses();analysis=await p.analyze(input,{profile,context});this.activateFrames(analysis);
    analysis=await p.analyze(input,{profile,context});
    const chosen=this.best(analysis);if(chosen)await this.realize(chosen.meaning,steps);
    const run=this.store.put(call('LearningRun',[input.expression],{episode,sequence:p.sequence(),steps:term('List',...steps.map(s=>call('LearningStep',[s.query],{kind:s.kind,status:s.status,detail:s.detail??'',evidence:s.evidence??null}))),elapsed:Date.now()-started}),{source:'derived:learning-run',supports:[episode,...steps.flatMap(s=>s.evidence?[s.evidence]:[]),...this.store.parts('RequestLearningPolicy').map(p=>p.support)]});
    if(need)this.store.put(call('NeedStatus',[],{need,status:chosen?'interpreted':'open',hypotheses:term('List',...analysis.candidates.map(c=>p.candidateExpression(c))),sequence:p.sequence()}),{source:'derived:need-status',supports:[need,run,...analysis.candidates.flatMap(c=>c.supports)]});
    return {analysis,attempts:steps};
  }
}
