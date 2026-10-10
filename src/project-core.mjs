import { digest } from './digest.mjs';
import { Evaluator } from './evaluator.mjs';
import { capture } from './ears.mjs';
import { propose, learnExample } from './interpret.mjs';
import { Sources } from './sources.mjs';
import { addOutcome, induce, answerLearned } from './outcomes.mjs';
import { learnCode } from './code-learning.mjs';
import { Research } from './research.mjs';
import { assessAnswer } from './assessment.mjs';
import { ModelLearner } from './model-learning.mjs';
import { Learner } from './learning.mjs';
import { term, call, values, field, isTerm, format, parse, parseMany, match } from './ncon.mjs';

const assertNumber = n => { if (typeof n !== 'number' || !Number.isFinite(n)) throw new TypeError('Expected finite number'); return n; };
export class ProjectCore {
  constructor({ store, bundle, online = true, fetcher, profile = '', sourceBaseUrl, sourceURLHeader = false, onProgress, teacher = null }) {
    this.store = store; this.online = online; this.profile = profile; this.bundle = bundle; this.onProgress=onProgress;
    try { this.boot(); } catch (error) { this.store.close(); throw error; }
    this.sources = new Sources(this.store, { fetcher, baseURL: sourceBaseUrl, sourceURLHeader, timeout: this.policy('LearningPolicy', 'RequestTimeout'), maximumBytes: this.policy('LearningPolicy', 'MaximumBytes') });
    this.research = new Research(this);
    this.learner = new Learner(this);
    this.modelLearner = teacher ? new ModelLearner(this, teacher) : null;
    const capabilities = {
      'learning.propose': need => this.modelLearner.propose(need),
      'learning.validate-and-retain': (need, proposal) => this.modelLearner.validateAndRetain(need, proposal),
      'number.add': (a, b) => assertNumber(assertNumber(a) + assertNumber(b)),
      'number.subtract': (a, b) => assertNumber(assertNumber(a) - assertNumber(b)),
      'number.multiply': (a, b) => assertNumber(assertNumber(a) * assertNumber(b)),
      'number.divide': (a, b) => assertNumber(assertNumber(a) / assertNumber(b)),
      'number.less': (a, b) => assertNumber(a) < assertNumber(b),
      'value.equal': (a, b) => format(a) === format(b),
      'value.is-number': value => typeof value === 'number' && Number.isFinite(value),
      'value.is-reply': value => isTerm(value) && typeof field(value,'text') === 'string',
      'value.is-text': value => typeof value === 'string',
      'number.text': value => String(assertNumber(value)),
      'reply.make': (text, answer) => call('Replied', [], { text, answer }),
      'web.fetch-evidence': async address => {
        if(typeof address==='string') address=term('WebAddress',address);
        if (!isTerm(address) || address.head !== 'WebAddress' || typeof values(address)[0] !== 'string') throw new Error('Fetch needs a web address');
        try {
          const page = await this.readPage(values(address)[0]);
          this.responseEvidence?.push(page.id);
          return call('Fetched', [], { text: values(page.expression)[0], url: field(page.expression,'url'), evidence: page.id });
        } catch (error) { return call('FetchFailed', [], { text: 'I could not fetch that page: ' + error.message, url: values(address)[0] }); }
      },
      'web.response-text': response => {
        if(!isTerm(response)||response.head!=='Fetched') throw new Error('text() requires a successful fetched response');
        return field(response,'text');
      },
      'learned.answer': expression => answerLearned(this.store, this.evaluator, expression),
      'expression.evaluate': async expression => {
        if(isTerm(expression))this.responseEvidence?.push(...[...this.store.parts(expression.head,'ValidatedProgram'),...this.store.parts(expression.head,'ValidatedRealization')].filter(p=>match(values(p.expression)[0],expression,new Map())).map(p=>p.support));
        try {
          const run=await this.evaluator.evaluate(expression);
          this.responseEvidence?.push(...run.trace.flatMap(t=>t.support?[t.support]:t.supports??[]));
          if(format(run.value)===format(expression)||isTerm(run.value)&&run.value.head==='Alternatives') return call('Replied',[],{text:'I retained the meaning, but its realization needs more evidence or a revision.',pending:true});
          return run.value;
        } catch(error) {return call('Replied',[],{text:'The selected realization could not complete: '+error.message,pending:true});}
      },
      'research.fact': (relation,subject,kind) => this.research.fact(relation,subject,{kind}),
      'research.topic': (subject,kind) => this.research.topic(subject,{kind}),
      'research.measure': (subject,facets,kind) => this.research.measure(subject,values(facets),{kind}),
      'knowledge.query': pattern => this.learner.queryEvidence(pattern),
      'term.format': format,
      'text.concat': (...texts) => { if (!texts.every(t => typeof t === 'string')) throw new TypeError('Expected text'); return texts.join(''); },
      'text.length': text => {if(typeof text!=='string')throw new TypeError('Expected text');return text.length;},
      'text.at': (text,index) => {if(typeof text!=='string'||!Number.isInteger(index)||index<0)throw new TypeError('Expected text and a nonnegative index');return text[index]??'';},
      'text.matches': (text,pattern) => {if(typeof text!=='string'||typeof pattern!=='string'||text.length>128||pattern.length>2048)throw new TypeError('Text pattern budget exceeded');return new RegExp(pattern,'u').test(text);},
      'input.capture': text => capture(text).expression,
      'construction.propose': async (input, profile, context) => {
        const analysis = await this.analyze(capture(values(input)[0]), { profile, context });
        return term('List', ...analysis.candidates.map(c => this.candidateExpression(c)));
      },
      'construction.learn-example': (input, meaning, profile) => learnExample(this.store, capture(values(input)[0]), meaning, { profile }).declaration,
      'agenda.run': async budget => term('List', ...(await this.tick({ budget })).map(j => call('LearningAttempt', [], { query: j.query, status: j.status, detail: j.detail }))),
      'agenda.exist': async budget => {
        const work = await this.exist({ budget });
        return call('BackgroundWork', [], { attempts: term('List', ...work.attempts.map(j => call('LearningAttempt', [j.query], { status: j.status }))), revisions: term('List', ...work.revisions.map(r => r.result)) });
      }
    };
    // Collect actual capability invocations across nested evaluations. Preserve
    // synchronous capability behavior used by notation readers.
    for(const [name,operation]of Object.entries(capabilities))capabilities[name]=(...args)=>{
      const record=(outcome,error=null)=>{if(this.executionTrace)this.executionTrace.push({expression:term('Native',name,...args),outcome,capability:name,error});};
      try{const value=operation(...args);if(value&&typeof value.then==='function')return value.then(result=>{record('capability');return result;},error=>{record('capability-failed',error.message);throw error;});record('capability');return value;}
      catch(error){record('capability-failed',error.message);throw error;}
    };
    this.evaluator = new Evaluator(this.store, capabilities);
  }
  boot() {
    const manifest = this.bundle.manifest;
    if (manifest.schemaVersion !== 1 || !manifest.packs?.length) throw new Error('Invalid or empty pack manifest');
    const parsed = manifest.packs.map(name => {
      if (name.includes('..') || name.includes('/') || name.includes('\\')) throw new Error('Invalid pack path');
      return { name, expressions: parseMany(this.bundle.packs[name]) };
    });
    this.store.transaction(() => {
      // Version packs atomically, retiring old definitions and their derived support.
      for (const pack of parsed) {
        const source = 'pack:' + pack.name, wanted = new Set(pack.expressions.map(e => digest(source + '\n' + format(e))));
        for (const existing of this.store.records().filter(r => r.source === source)) if (!wanted.has(existing.id)) {
          // Inline retraction because boot owns the transaction.
          const pending = [existing.id], seen = new Set();
          while (pending.length) {
            const id = pending.shift(); if (seen.has(id)) continue; seen.add(id);
            this.store.db.prepare('UPDATE records SET active=0 WHERE id=?').run(id);
            pending.push(...this.store.db.prepare('SELECT record FROM dependencies WHERE support=?').all(id).map(r => r.record));
          }
        }
        for (const expression of pack.expressions) this.store.put(expression, { source });
      }
      for (const identity of manifest.required) if (!this.store.definitions().has(identity)) throw new Error('Required concept missing: ' + identity);
      for (const identity of ['Hear', 'Interpret', 'Learn', 'LearnExample', 'Exist', 'Speak', 'PredictionError', 'UpdateExpectation', 'CandidateScore']) {
        if (!this.store.parts(identity, 'Realization').length) throw new Error('Required behavior missing: ' + identity);
      }
    });
    this.manifest = manifest;
  }
  policy(identity, property) {
    const declarations = this.store.parts(identity, property);
    const authored = declarations.filter(p => !this.store.record(p.support)?.source.startsWith('pack:'));
    const choices = authored.length ? authored : declarations;
    const revision = p => Math.max(0, ...values(this.store.record(p.support).expression).filter(x => isTerm(x) && x.head === 'Revision').map(x => values(x)[0]));
    const latest = Math.max(0, ...choices.map(revision));
    const current = choices.filter(p => revision(p) === latest);
    const candidates = new Set(current.map(p => values(p.expression)[0]));
    if (candidates.size > 1) throw new Error('Conflicting policy values: use an explicit higher Revision for ' + identity + '.' + property);
    const value = [...candidates][0];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Invalid policy: ' + identity + '.' + property);
    return value;
  }
  load(source, { provenance = 'user:authoring', trusted = true } = {}) {
    const expressions = parseMany(source);
    if (!trusted) this.validateEvidence(expressions);
    return this.store.transaction(() => expressions.map(expression => this.store.put(expression, { source: provenance })));
  }
  importRecords(source) {
    const pending = parseMany(source);
    if (!pending.every(e => isTerm(e) && e.head === 'Record')) throw new Error('Expected a provenance-preserving Record export');
    return this.store.transaction(() => {
      const imported = [];
      while (pending.length) {
        let progress = false;
        for (let index = pending.length - 1; index >= 0; index--) {
          const record = pending[index], supports = values(field(record, 'supports', term('List')));
          if (!supports.every(id => this.store.record(id)?.active)) continue;
          const id = this.store.put(values(record)[0], { source: field(record, 'source'), supports });
          if (id !== field(record, 'id')) throw new Error('Export identity does not match its content and supports');
          imported.push(id); pending.splice(index, 1); progress = true;
        }
        if (!progress) throw new Error('Export has missing or cyclic supports');
      }
      return imported;
    });
  }
  validateEvidence(expressions) {
    const forbidden = new Set(['AnswerAssessment','AnswerRequirement','ReviewBelow','NoTeacherReview','LearningFallback','ModelLearningPolicy','ConstructionWeight','MaximumAttempts','AttributedMeaning','EvidenceReading','EvidenceObservation','MaximumPassages','RevisitBudget','MaximumSearchPages','MaximumRelatedProperties','RelationPath','RelationBinding','ContextualArgument','ArgumentHint','ContextFor','RejectedReply','MaximumMeasurements','ReadForm','ContextHint','Clarification','DecodedValue','Frame','ImplementationLesson','SenseIdentity','ValueMapping','MaximumPasses','MaximumJobs','MaximumDecodings','MaximumMilliseconds','MaximumTypeDepth','MaximumTypeNodes','TypeEvidence','Realization', 'Construction', 'Native', 'ValidatedProgram', 'ValidatedRealization', 'StarterProcedure', 'StarterLesson', 'Capability', 'Arity', 'Commutative', 'MinimumExamples', 'MaximumExpressions', 'Adapter', 'Endpoint', 'Revision', 'Priority', 'LearningRate', 'Margin', 'MaximumStates', 'MaximumCandidates', 'MaximumSpan', 'RequestTimeout', 'MaximumBytes', 'TickBudget','MaximumRequests','MaximumResearchMilliseconds','SearchLimit','CacheMilliseconds','EndTimeProperty','PointInTimeProperty','ResearchAnswer','KnowledgeFact']);
    const visit = expression => { if (!isTerm(expression)) return; if (forbidden.has(expression.head)) throw new Error('Evidence cannot install behavior or policy: ' + expression.head); for (const a of expression.args) visit(a.value); };
    for (const expression of expressions) visit(expression);
  }
  async analyze(input, { profile = this.profile, context = term('Context') } = {}) {
    return propose(this.store, input, {
      profile, context, maximumStates: this.policy('InterpretationPolicy', 'MaximumStates'),
      maximumCandidates: this.policy('InterpretationPolicy', 'MaximumCandidates'), maximumSpan: this.policy('InterpretationPolicy', 'MaximumSpan'),
      score: async (evidence, expectation, holes) => {
        const evaluation = await this.evaluator.evaluate(term('CandidateScore', evidence, expectation, holes));
        if (typeof evaluation.value !== 'number') throw new Error('CandidateScore must realize to a number');
        return { value: evaluation.value, supports: evaluation.trace.map(t => t.support).filter(Boolean) };
      }
    });
  }
  candidateExpression(candidate) {
    return call('Candidate', [candidate.meaning], { id: candidate.id, rule: candidate.rule, score: candidate.score, expectation: candidate.expectation, supports: term('List', ...candidate.supports), holes: term('List', ...candidate.holes) });
  }
  contextualize(candidate,context){
    if(!isTerm(candidate.meaning))return candidate;
    let meaning=candidate.meaning;const supports=[];
    for(const hint of values(context).filter(h=>isTerm(h)&&h.head==='ArgumentHint')){
      const name=field(hint,'name'),value=field(hint,'value');
      const permissions=this.store.parts(meaning.head,'ContextualArgument').filter(p=>values(p.expression)[0]===name);
      if(!permissions.length)continue;
      meaning={...meaning,args:[...meaning.args.filter(a=>a.name!==name),{name,value}]};supports.push(...permissions.map(p=>p.support));
    }
    return {...candidate,meaning,id:digest(candidate.rule+'|'+format(meaning)),supports:[...new Set([...candidate.supports,...supports])]};
  }
  trace(run,episode,kind,detail){return this.store.appendTrace({run,episode,kind,detail});}
  traceAnalysis(run,episode,kind,analysis){
    this.trace(run,episode,kind,{graphVersion:analysis.graphVersion,exhausted:analysis.exhausted,candidateCount:analysis.candidates.length,
      candidates:analysis.candidates.slice(0,8).map(c=>({id:c.id,meaning:format(c.meaning).slice(0,2000),rule:c.rule,score:c.score,expectation:c.expectation,holes:c.holes.slice(0,16).map(h=>format(h).slice(0,200)),supports:c.supports.slice(0,32),bindings:Object.fromEntries(Object.entries(c.bindings??{}).slice(0,8).map(([key,value])=>[key,format(value).slice(0,600)]))})),truncated:analysis.candidates.length>8});
  }
  async reviewLearning(episodeId){
    if(!this.online||!this.modelLearner?.enabled)throw new Error('Enable online learning and optional Gemini help to review this process.');
    const episode=this.store.record(episodeId);if(!episode?.active||episode.expression.head!=='Episode')throw new Error('Expected an active conversation observation');
    const profile=field(episode.expression,'profile',''),input=capture(values(values(episode.expression)[0])[0]);
    let features=values(field(episode.expression,'context',term('Context')));
    for(const clarification of this.store.records('Clarification').filter(r=>field(r.expression,'target')===episodeId).sort((a,b)=>field(a.expression,'sequence',0)-field(b.expression,'sequence',0)))
      for(const hint of values(field(clarification.expression,'context',term('Context'))))features=[...features.filter(c=>!isTerm(c)||!isTerm(hint)||c.head!==hint.head||field(c,'name')!==field(hint,'name')),hint];
    const context=term('Context',...features);
    const replyRecord=this.store.records('Reply').filter(r=>field(r.expression,'episode')===episodeId).sort((a,b)=>field(b.expression,'sequence',0)-field(a.expression,'sequence',0))[0];
    const assessmentRecord=replyRecord&&this.store.records('AnswerAssessment').find(r=>field(r.expression,'reply')===replyRecord.id);
    const assessment=assessmentRecord?{id:assessmentRecord.id,expression:assessmentRecord.expression}:null;
    const analysis=await this.analyze(input,{profile,context}),run='review-'+digest(episodeId+'|'+this.store.traces({limit:1}).at(-1)?.sequence+'|'+Date.now());
    this.trace(run,episodeId,'review.requested',{reason:'User requested diagnosis of the retained learning process',reply:replyRecord?.id??null});
    const reviewed=await this.modelLearner.assist({input,analysis,episode:episodeId,profile,context,phase:'process-review',assessment,reply:values(replyRecord?.expression)[0]??null,traceRun:run});
    const retry=reviewed.changed?await this.resume(episodeId,{learn:false}):null;
    this.trace(run,episodeId,'review.completed',{changed:reviewed.changed,need:reviewed.need??null,error:reviewed.error??null,retry:retry?.readingId??null});
    return {...reviewed,retry};
  }
  async turn(text, { learn = this.online, profile = this.profile, context = term('Context'), contextSupports=[], episode, assisted = true } = {}) {
    await this.prepare();
    if(!episode){
      const previous=this.store.records('Episode').filter(r=>field(r.expression,'profile','')===profile).sort((a,b)=>field(b.expression,'sequence',0)-field(a.expression,'sequence',0))[0];
      const reply=previous&&this.store.records('Reply').filter(r=>field(r.expression,'episode')===previous.id).sort((a,b)=>field(b.expression,'sequence',0)-field(a.expression,'sequence',0))[0];
      if(previous&&field(values(reply?.expression)[0],'pending',false)){
        context=term('Context',...values(context),term('AwaitingClarification'));contextSupports=[...contextSupports,previous.id];
      }
    }
    const input = capture(text);
    const episodeId = episode ?? this.store.put(call('Episode', [input.expression], { profile, context, sequence: this.sequence() }), { source: 'user:episode' });
    const traceRun='run-'+digest(episodeId+'|'+this.store.traces({limit:1}).at(-1)?.sequence+'|'+Date.now());
    this.trace(traceRun,episodeId,'request.started',{text,profile,context:format(context),learn,teacherEnabled:Boolean(this.modelLearner?.enabled),resumed:Boolean(episode)});
    try {
    let analysis = await this.analyze(input, { profile, context });
    this.traceAnalysis(traceRun,episodeId,'interpretation.initial',analysis);
    const queueGaps = () => {
      const covered = new Set([...analysis.edges, ...analysis.candidates.flatMap(c => c.consumed)].flatMap(edge => Array.from({ length: edge.end - edge.start }, (_, i) => edge.start + i)));
      for (let i = 0; i < analysis.units.length; i++) {
        const unit = analysis.units[i];
        if (!covered.has(i) && unit.kind === 'word' && !unit.protected) this.store.enqueue(unit.raw, 'lexical');
      }
      if (!analysis.candidates.length || analysis.candidates.some(c => c.holes.length) || analysis.exhausted) this.store.enqueue(text, 'composition');
      else if (analysis.candidates.length > 1) this.store.enqueue(text, 'interpretation');
    };
    queueGaps();
    let assistance;
    const needsAcquisition=!analysis.candidates.length||analysis.candidates.some(c=>c.holes.length)||analysis.exhausted;
    const learned=await this.learner.request(input,{profile,context,contextSupports,acquire:learn&&needsAcquisition,episode:episodeId,traceRun});
    analysis=learned.analysis;
    const attempts=learned.attempts;
    // Independent acquisition, frame learning, decoding and implementation
    // checks always get first use of this request. A fallback research reading
    // must also run its own source plan before asking the optional teacher.
    if(learn && assisted && this.modelLearner && !this.learner.best(analysis)){
      assistance=await this.modelLearner.assist({input,analysis,episode:episodeId,profile,context,traceRun});
      if(assistance.changed)analysis=await this.analyze(input,{profile,context});
    }
    if (analysis.graphVersion !== this.store.version) { analysis = await this.analyze(input, { profile, context }); queueGaps(); }
    analysis.candidates=analysis.candidates.map(c=>this.contextualize(c,context));
    const margin = this.policy('InterpretationPolicy', 'Margin'), [best, next] = analysis.candidates;
    // Budget exhaustion prevents committing even if the explored prefix has one winner.
    const status = !best || best.holes.length || analysis.exhausted ? 'learning' : next && best.score - next.score < margin ? 'ambiguous' : 'resolved';
    const result = status === 'resolved' ? term('Resolved', best.meaning) : status === 'ambiguous' ? term('Ambiguous', term('List', ...analysis.candidates.map(c => this.candidateExpression(c)))) : term('Learning', term('List', ...this.store.agenda().filter(j => j.query === text || input.tokens.some(t => t.raw === j.query)).map(j => call('Task', [j.query], { kind: j.kind, status: j.status }))));
    this.traceAnalysis(traceRun,episodeId,'interpretation.final',analysis);
    this.trace(traceRun,episodeId,'decision.selected',{status,meaning:status==='resolved'?format(best.meaning):null,margin:next&&best?best.score-next.score:null,requiredMargin:margin,reason:analysis.exhausted?'Search budget exhausted':!best?'No complete reading':best.holes.length?'Required roles remain open':status==='ambiguous'?'Candidate separation is below the margin':'Complete reading exceeds the selection margin',policySupports:this.store.parts('InterpretationPolicy').map(p=>p.support)});
    const supports = [...new Set([episodeId,...contextSupports, ...this.store.parts('InterpretationPolicy').map(p => p.support), ...analysis.candidates.flatMap(c => c.supports)])];
    const readingId = this.store.put(call('Reading', [result], { episode: episodeId, sequence: this.sequence(), graphVersion: analysis.graphVersion, readings: term('List', ...analysis.candidates.map(c => this.candidateExpression(c))) }), { source: 'derived:interpretation', supports });
    if(status==='resolved'&&isTerm(best.meaning)&&this.store.isA(best.meaning.head,'Assertion')){
      this.store.put(call('AttributedMeaning',[best.meaning],{observation:episodeId,document:episodeId,profile,text:input.source,url:null,license:'user-statement'}),{source:'derived:user-assertion',supports:[readingId,...this.store.typeProof(best.meaning.head,'Assertion')]});
    }
    const spoken = (await this.evaluator.evaluate(term('Speak', result))).value;
    let reply, replyId, clarification, retry;
    // An authored context hint can answer the immediately preceding unresolved
    // turn. The observation stays separate; the explicit link supplies provenance.
    if(!episode&&status==='resolved'&&isTerm(best.meaning)){
      const hints=best.meaning.args.length?[]:this.store.parts(best.meaning.head,'ContextHint');
      const hintRun=await this.evaluator.evaluate(term('ContextFor',best.meaning));
      const features=[...hints.flatMap(h=>values(h.expression)),...(hintRun.value?.head==='Context'?values(hintRun.value):[])];
      const correction=this.store.isA(best.meaning.head,'Correction');
      let previous=this.store.records('Episode').filter(r=>r.id!==episodeId&&field(r.expression,'profile','')===profile).sort((a,b)=>field(b.expression,'sequence',0)-field(a.expression,'sequence',0))[0];
      const adjacentReply=previous&&this.store.records('Reply').filter(r=>field(r.expression,'episode')===previous.id).sort((a,b)=>field(b.expression,'sequence',0)-field(a.expression,'sequence',0))[0];
      const continuing=field(values(adjacentReply?.expression)[0],'clarifiedEpisode');
      const target=continuing&&this.store.record(continuing);
      if(target?.active&&target.expression.head==='Episode'&&field(target.expression,'profile','')===profile)previous=target;
      const priorReading=previous&&this.store.records('Reading').filter(r=>field(r.expression,'episode')===previous.id).sort((a,b)=>field(b.expression,'sequence',0)-field(a.expression,'sequence',0))[0];
      const priorReply=previous&&this.store.records('Reply').filter(r=>field(r.expression,'episode')===previous.id).sort((a,b)=>field(b.expression,'sequence',0)-field(a.expression,'sequence',0))[0];
      const priorMeanings=values(field(priorReading?.expression,'readings',term('List'))).map(c=>values(c)[0]);
      const applicable=features.every(h=>h.head!=='ArgumentHint'||priorMeanings.some(m=>isTerm(m)&&this.store.parts(m.head,'ContextualArgument').some(p=>values(p.expression)[0]===field(h,'name'))));
      if(features.length&&applicable&&previous&&priorReading&&(correction||values(priorReading.expression)[0].head!=='Resolved'||field(values(priorReply?.expression)[0],'pending',false))){
        clarification=this.store.put(call('Clarification',[],{episode:episodeId,target:previous.id,context:term('Context',...features),sequence:this.sequence()}),
          {source:'user:clarification',supports:[readingId,previous.id,...hints.map(h=>h.support),...hintRun.trace.flatMap(t=>t.support?[t.support]:t.supports??[]),...(correction?this.store.typeProof(best.meaning.head,'Correction'):[])]});
        if(correction&&priorReply){
          this.store.put(call('RejectedReply',[],{reply:priorReply.id,clarification,episode:previous.id}),{source:'user:correction',supports:[clarification]});
          // Reject this answer for this question, not its underlying source facts.
          const answer=field(values(priorReply.expression)[0],'evidence');
          if(answer&&this.store.record(answer)?.expression.head==='ResearchAnswer')this.store.retract(answer);
          this.store.retract(priorReply.id);
        }
        retry=await this.resume(previous.id,{learn});
      }
    }
    if (this.store.parts('Respond', 'Realization').length) {
      this.responseProfile=profile;
      this.responseEvidence=[];this.executionTrace=[];
      const run = retry?{value:retry.reply,trace:[]}:await this.evaluator.evaluate(term('Respond', result)); reply = run.value;
      if(retry){reply=call(reply.head,values(reply),Object.fromEntries([...reply.args.filter(a=>a.name!==undefined).map(a=>[a.name,a.value]),['clarifiedEpisode',field(this.store.record(clarification).expression,'target')],...(retry.status==='resolved'?[]:[['pending',true]])]));this.responseEvidence.push(clarification,retry.readingId,retry.replyId);}
      this.trace(traceRun,episodeId,'execution.completed',{reply:format(reply).slice(0,6000),steps:run.trace.length,capabilities:(this.executionTrace??[]).slice(-64).map(t=>({expression:format(t.expression).slice(0,1200),outcome:t.outcome,capability:t.capability,error:t.error})),truncated:run.trace.length>64||(this.executionTrace?.length??0)>64,trace:run.trace.slice(-64).map(t=>({expression:format(t.expression).slice(0,1200),outcome:t.outcome,support:t.support??null,supports:t.supports??[],capability:t.capability??null})),evidence:[...new Set(this.responseEvidence)]});
      const executionSupports=status==='resolved' && isTerm(best.meaning) ? [...this.store.parts(best.meaning.head,'ValidatedProgram'),...this.store.parts(best.meaning.head,'ValidatedRealization')].filter(p=>match(values(p.expression)[0],best.meaning,new Map())).map(p=>p.support) : [];
      replyId = this.store.put(call('Reply', [reply], { episode: episodeId, reading: readingId, sources:term('List',...new Set(this.responseEvidence)),sequence: this.sequence() }),
        { source: 'derived:response', supports: [...new Set([readingId, ...executionSupports, ...this.responseEvidence, ...(field(reply,'evidence') ? [field(reply,'evidence')] : []), ...run.trace.flatMap(t => t.support ? [t.support] : t.supports ?? [])])] });
      this.responseEvidence=undefined;this.executionTrace=undefined;
      this.responseProfile=undefined;
    }
    let assessment=await assessAnswer(this,{episode:episodeId,reading:readingId,reply,replyId,analysis,status});
    if(learn && assisted && this.modelLearner && !assistance && (field(reply,'pending',false)||assessment.review)) {
      const evidence=await this.modelLearner.assist({input,analysis,episode:episodeId,profile,context,phase:'evidence',assessment,reply,traceRun});
      if(evidence.changed){this.trace(traceRun,episodeId,'request.retry',{reason:'Checked new learning retained; retrying the same observation',need:evidence.need});return this.turn(text,{learn:false,profile,context,contextSupports,episode:episodeId,assisted:false});}
      assistance=evidence.clarification?evidence:assistance;
    }
    if(assistance?.clarification){
      reply=call('Replied',[],{text:assistance.clarification,pending:true});
      replyId=this.store.put(call('Reply',[reply],{episode:episodeId,reading:readingId,sources:term('List'),sequence:this.sequence()}),{source:'derived:clarification-request',supports:[readingId,assistance.need]});
      assessment=await assessAnswer(this,{episode:episodeId,reading:readingId,reply,replyId,analysis,status:'learning'});
    }
    if (status === 'resolved') {
      for (const job of this.store.agenda().filter(j => j.query === text && ['composition', 'interpretation'].includes(j.kind))) this.store.updateJob(job.id, 'done', 'Resolved by supported evidence');
    }
    this.trace(traceRun,episodeId,'request.completed',{reading:readingId,reply:replyId,assessment:assessment.id,score:assessment.score,status:retry?.status??(field(reply,'pending',false)?'learning':status),reasons:assessment.reasons});
    return { traceRun, episodeId, readingId, reply, replyId, assessment, input, status:retry?.status??(field(reply,'pending',false)?'learning':status), result, spoken, candidates: analysis.candidates, attempts:[...attempts,...(retry?.attempts??[])],clarification, exhausted: analysis.exhausted };
    }catch(error){this.executionTrace=undefined;this.responseEvidence=undefined;this.responseProfile=undefined;this.trace(traceRun,episodeId,'request.failed',{message:error.message,reason:'The request stopped before completion; partial learning and trace remain'});throw error;}
  }
  async resume(episodeId, options = {}) {
    const episode = this.store.record(episodeId);
    if (!episode?.active || episode.expression.head !== 'Episode') throw new Error('Expected an active episode');
    const input = values(episode.expression)[0];
    const clarifications=this.store.records('Clarification').filter(r=>field(r.expression,'target')===episodeId).sort((a,b)=>field(a.expression,'sequence',0)-field(b.expression,'sequence',0));
    let context=values(field(episode.expression,'context',term('Context')));
    for(const clarification of clarifications)for(const hint of values(field(clarification.expression,'context',term('Context'))))context=[...context.filter(c=>!isTerm(c)||!isTerm(hint)||c.head!==hint.head||field(c,'name')!==field(hint,'name')),hint];
    return this.turn(values(input)[0], { profile: field(episode.expression, 'profile', ''), context: term('Context',...context), contextSupports:clarifications.map(r=>r.id), ...options, episode: episodeId });
  }
  sequence() { return Number(this.store.db.prepare('SELECT count(*) AS n FROM records').get().n) + 1; }
  async reward(target, obtained, { expected, rate = this.policy('LearningPolicy', 'LearningRate'), profile = this.profile, evidence = 'user:feedback' } = {}) {
    const previous = this.store.expectationEvidence(target, profile);
    expected ??= previous.value;
    assertNumber(expected); assertNumber(obtained); assertNumber(rate);
    if (rate < 0 || rate > 1) throw new Error('Learning rate must be in [0,1]');
    if (!this.store.record(target)?.active) throw new Error('Reward must identify an active procedure or lexical support');
    const errorRun = await this.evaluator.evaluate(term('PredictionError', expected, obtained));
    const updateRun = await this.evaluator.evaluate(term('UpdateExpectation', expected, obtained, rate));
    const error = errorRun.value, updated = updateRun.value;
    if (typeof error !== 'number' || typeof updated !== 'number') throw new Error('Reward behavior did not produce numbers');
    const record = call('Feedback', [], { target, profile, expected, obtained, error, updated, evidence, sequence: this.sequence() });
    const supports = [...new Set([target, ...(previous.support ? [previous.support] : []), ...errorRun.trace.map(t => t.support).filter(Boolean), ...updateRun.trace.map(t => t.support).filter(Boolean)])];
    const id = this.store.put(record, { source: evidence, supports }); return { id, error, updated, record };
  }
  async teachExample(text, meaning, options = {}) { return learnExample(this.store, capture(text), meaning, { profile: this.profile, ...options }); }
  async prepare() {
    // Bootstrap uses the normal example learner and retains the original evidence.
    // A revised or withdrawn starter invalidates the lesson and its construction.
    for (const seed of this.store.records('StarterLesson')) {
      if (this.store.records('Lesson').some(r => r.source === 'starter:' + seed.id && field(r.expression,'profile','') === this.profile)) continue;
      const [input, meaning] = values(seed.expression);
      const captureLimits=Object.fromEntries((field(seed.expression,'captureLimits',term('Limits')).args??[]).map(a=>[a.name,a.value]));
      await this.teachExample(input, meaning, { source: 'starter:' + seed.id, supports: [seed.id], textSlots:field(seed.expression,'textSlots',false), weight:field(seed.expression,'weight',0),captureLimits,context:field(seed.expression,'context',term('Context')) });
    }
    for(const seed of this.store.records('StarterProcedure')) {
      // Retraction is a deliberate revision, not permission to silently re-teach.
      const applied=this.store.db.prepare('SELECT id FROM records WHERE head=? AND source=?').all('CodeExample','starter:'+seed.id);
      if(applied.some(r=>field(this.store.record(r.id).expression,'profile','')===this.profile)) continue;
      const [input,meaning,pattern,body]=values(seed.expression);
      await this.teachCode(typeof body==='string'?{input,meaning,pattern,language:'javascript',code:body}:{input,meaning,pattern,body},{source:'starter:'+seed.id,supports:[seed.id]});
    }
  }
  async teachCode(example,options={}) { return learnCode(this,example,options); }
  async teachOutcomes(examples, { source = 'user:worked-example', supports = [], profile = this.profile } = {}) {
    const ids = this.store.transaction(() => examples.map(example => addOutcome(this.store, example.input, example.output, { profile, source, supports })));
    const result = await induce(this.store, this.evaluator, { profile, minimumExamples: this.policy('InductionPolicy', 'MinimumExamples'), maximumExpressions: this.policy('InductionPolicy', 'MaximumExpressions') });
    return { ids, ...result };
  }
  async tick({ budget = this.policy('LearningPolicy', 'TickBudget'), jobs, timeout } = {}) {
    if (!Number.isInteger(budget) || budget < 0 || budget > 100) throw new Error('Tick budget must be an integer in [0,100]');
    if (this.ticking) throw new Error('A learning tick is already running');
    this.ticking = true; const attempts = [];
    try {
      this.sources.deadline=timeout?Date.now()+timeout:undefined;
      this.sources.options.timeout = Math.min(timeout??Infinity,this.policy('LearningPolicy', 'RequestTimeout'));
      this.sources.options.maximumBytes = this.policy('LearningPolicy', 'MaximumBytes');
      for (const job of (jobs??this.store.agenda()).slice(0, budget)) {
        if(job.kind==='evidence-reading'){
          const observation=this.store.record(job.query),document=field(observation?.expression,'document');
          if(document&&this.store.record(document)?.active)await this.learner.readEvidence(document);
          else this.store.updateJob(job.id,'waiting','Supporting source was withdrawn; observation cannot be asserted');
          attempts.push(this.store.job(job.id));continue;
        }
        if(job.kind==='realization'){
          const steps=[];await this.learner.realize(parse(job.query),steps);
          attempts.push(this.store.job(job.id));continue;
        }
        if(job.kind==='research'){
          const query=parse(job.query);
          if(['FactQuestion','TopicQuestion','ActionQuestion','MeasurementQuestion','GuidanceQuestion'].includes(query.head))await this.evaluator.evaluate(term('RespondTo',query));
          else this.store.updateJob(job.id,'needs-evidence','No supported research plan for this intent');
          attempts.push(this.store.job(job.id));continue;
        }
        if (job.kind === 'composition') {
          const reading = await this.analyze(capture(job.query));
          if (!reading.exhausted && reading.candidates.length === 1 && !reading.candidates[0].holes.length) {
            this.store.updateJob(job.id,'done','Resolved by retained learning'); attempts.push(this.store.job(job.id)); continue;
          }
        }
        if (job.kind !== 'lexical' && job.kind !== 'composition') {
          this.store.updateJob(job.id, 'needs-evidence', 'Requires a labelled example, contextual evidence, or a structured construction source');
          attempts.push(this.store.job(job.id)); continue;
        }
        if (this.store.surfaces(job.query, this.profile).length || this.store.records('Concept').some(r => r.source === 'derived:program-induction' && format(r.expression).toLowerCase().includes('literal(' + JSON.stringify(job.query.toLowerCase()) + ')'))) {
          this.store.updateJob(job.id, 'done', 'Already supported by retained knowledge'); attempts.push(this.store.job(job.id)); continue;
        }
        if (!this.online) { this.store.updateJob(job.id, 'waiting', 'Online acquisition is disabled; retained for a future tick'); attempts.push(this.store.job(job.id)); continue; }
        const details = []; let learned = false, raw = false;
        for (const source of this.sources.available()) {
          if(this.sources.deadline&&Date.now()>=this.sources.deadline) {details.push('Request learning time budget exhausted');break;}
          try {
            const episode = this.store.records('Episode').filter(r => field(r.expression, 'profile', '') === this.profile).sort((a,b) => field(a.expression,'sequence',0)-field(b.expression,'sequence',0)).at(-1);
            const context = episode ? values(values(episode.expression)[0])[0] : job.query;
            if (job.kind === 'composition' && !['dataset-examples','worked-examples'].includes(source.adapter)) continue;
            if (job.kind === 'lexical' && ['dataset-examples','worked-examples'].includes(source.adapter)) continue;
            const acquired = await this.sources.acquire(job.query, source, { context });
            this.validateEvidence(acquired.records);
            const rawSupports = [];
            this.store.transaction(() => {
              const acquisition = this.store.put(call('Acquisition', [job.query], { provider: term(source.identity), url: acquired.queryUrl??null, license: source.license, sequence: this.sequence() }), { source: 'source:' + source.identity });
              for (const expression of acquired.records.filter(e => e.head !== 'Concept')) {
                rawSupports.push(this.store.put(expression, { source: 'source:' + source.identity, supports: [acquisition] })); raw = true;
              }
              for (const expression of acquired.records.filter(e => e.head === 'Concept')) {
                this.store.put(expression, { source: 'source:' + source.identity, supports: [acquisition, ...rawSupports] }); learned = true;
              }
            });
            if (acquired.examples?.length) {
              const result = await this.teachOutcomes(acquired.examples, { source: 'source:' + source.identity, supports: rawSupports });
              if (result.learned.length) learned = true;
              details.push(`${source.identity}: ${result.learned.length} inferred procedure(s), ${result.pending.length} unresolved pattern(s)`);
              if (result.learned.length) break;
            }
            details.push(`${source.identity}: ${acquired.records.length} records`);
          } catch (error) { details.push(`${source.identity}: ${error.message}`); }
        }
        // A search hit alone is not evidence that this exact query is a known surface.
        const exact = this.store.surfaces(job.query, this.profile).length > 0 || this.store.records('Concept').some(r => r.source === 'derived:program-induction' && format(r.expression).toLowerCase().includes('literal(' + JSON.stringify(job.query.toLowerCase()) + ')'));
        this.store.updateJob(job.id, learned && exact ? 'done' : 'waiting', details.join('; ') + (raw && !learned ? '; source text awaits interpretation' : ''));
        attempts.push(this.store.job(job.id));
      }
      return attempts;
    } finally { this.ticking = false; this.sources.deadline=undefined; }
  }
  async readPage(url) {
    const expression = await this.sources.readPage(url);
    const id = this.store.put(expression, { source: 'user:url' });
    await this.learner.readEvidence(id);return { id, expression };
  }
  async exist({ budget = this.policy('LearningPolicy', 'TickBudget') } = {}) {
    const attempts = await this.tick({ budget }), revisions = [];
    const latest = new Map();
    for (const reading of this.store.records('Reading')) {
      const episode = field(reading.expression, 'episode'), sequence = field(reading.expression, 'sequence', 0);
      if (!latest.has(episode) || sequence > latest.get(episode).sequence) latest.set(episode, { sequence, result: values(reading.expression)[0] });
    }
    // Least recently revisited first: an insoluble old episode cannot monopolize attention.
    const episodes = this.store.records('Episode').sort((a, b) => (latest.get(a.id)?.sequence ?? 0) - (latest.get(b.id)?.sequence ?? 0) || field(a.expression, 'sequence', 0) - field(b.expression, 'sequence', 0));
    for (const episode of episodes) {
      if (revisions.length >= budget) break;
      const prior = latest.get(episode.id);
      const priorReply=this.store.records('Reply').filter(r=>field(r.expression,'episode')===episode.id).sort((a,b)=>field(b.expression,'sequence',0)-field(a.expression,'sequence',0))[0];
      if (prior?.result.head === 'Resolved'&&!field(values(priorReply?.expression)[0],'pending',false)) continue;
      revisions.push(await this.resume(episode.id, { learn: false }));
    }
    return { attempts, revisions };
  }
  close() { this.store.close(); }
}
