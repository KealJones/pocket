import { term,call,values,field,isTerm } from './ncon.mjs';

// Mechanical observations, not a model of semantic truth. Contracts and weighting
// are authored concepts; scores are heuristic evidence strength, not probability.
export async function assessAnswer(project,{episode,reading,reply,replyId,analysis,status}) {
  const {store}=project,best=analysis.candidates[0],next=analysis.candidates[1],meaning=best?.meaning;
  const contracts=isTerm(meaning)?store.parts(meaning.head,'AnswerRequirement'):[];
  const requirements=contracts.map(r=>values(r.expression)[0]);
  const sources=values(field(store.record(replyId)?.expression,'sources',term('List'))).map(id=>store.record(id)).filter(r=>r?.active);
  const reasons=[],pending=field(reply,'pending',false)||status!=='resolved';
  const bound=field(reply,'answer')!==undefined&&field(reply,'answer')!==null;
  let relevance=pending?0.15:0.65,execution=pending?0:0.8,grounding=0.55;
  const relevantEvidence=sources.some(r=>['KnowledgeFact','ResearchAnswer','AttributedMeaning'].includes(r.expression.head));
  if(bound){relevance=0.95;reasons.push('The response fills an explicit answer binding.');}
  if(relevantEvidence){grounding=0.85;reasons.push('The result has retained source relationships.');}
  else if(sources.some(r=>['SourceExcerpt','SourceDocument'].includes(r.expression.head))){grounding=0.55;reasons.push('A source was retained, but relevance is not established by citation alone.');}
  const checked=sources.some(r=>r.expression.head==='CodeExample'||r.expression.head==='Concept'&&values(r.expression).some(p=>['ValidatedProgram','ValidatedRealization'].includes(p?.head)));
  const dependencies=store.db.prepare('SELECT support FROM dependencies WHERE record=?').all(replyId).map(x=>store.record(x.support)).filter(Boolean);
  const executionProof=checked||dependencies.some(r=>r.expression.head==='Concept'&&values(r.expression).some(p=>['ValidatedProgram','ValidatedRealization'].includes(p?.head)));
  if(executionProof&&!pending){execution=0.95;grounding=Math.max(grounding,0.8);reasons.push('A retained checked procedure produced this result.');}
  for(const requirement of requirements){
    if(requirement?.head==='BoundValue'&&!bound){relevance=Math.min(relevance,0.3);reasons.push('The requested value has not been bound.');}
    if(requirement?.head==='CheckedExecution'&&!executionProof){execution=Math.min(execution,0.4);reasons.push('Execution lacks a retained validation record.');}
    if(requirement?.head==='ReplyKind'){
      const complete=values(requirement).includes(reply?.head);
      execution=complete?0.95:0;relevance=complete?0.9:0.1;grounding=complete&&sources.length?0.85:grounding;
      reasons.push(complete?'The requested action returned the expected result kind.':'The requested action did not return its expected result kind.');
    }
    if(requirement?.head==='SourceRelationship'&&!relevantEvidence){grounding=Math.min(grounding,0.35);reasons.push('The requested relationship lacks retained source support.');}
  }
  // A checked model program is still a revisable hypothesis about the request.
  const modelReading=best?.supports.some(id=>store.record(id)?.source==='derived:model-concept');
  if(modelReading){grounding=Math.min(grounding,0.65);reasons.push('Interpretation includes model-proposed learning; checks are not independent semantic proof.');}
  const margin=next&&best?best.score-next.score:null;
  const ambiguity=analysis.exhausted?0:!best?0:!next?0.9:Math.max(0,Math.min(0.9,margin/(project.policy('InterpretationPolicy','Margin')*4)));
  if(ambiguity<0.5)reasons.push('Competing or incomplete interpretations reduce confidence.');
  if(pending){relevance=Math.min(relevance,0.2);execution=0;}
  const run=await project.evaluator.evaluate(term('AnswerQuality',relevance,grounding,execution,ambiguity));
  if(typeof run.value!=='number'||!Number.isFinite(run.value))throw new Error('AnswerQuality must return a finite score');
  const score=Math.max(0,Math.min(1,run.value)),threshold=project.policy('AssessmentPolicy','ReviewBelow');
  const review=score<threshold&&!store.parts(meaning?.head,'NoTeacherReview').length;
  const expression=call('AnswerAssessment',[],{episode,reply:replyId,score,relevance,grounding,execution,ambiguity,review,calibrated:false,reasons:term('List',...reasons),sequence:project.sequence()});
  const id=store.put(expression,{source:'derived:answer-assessment',supports:[reading,replyId,...contracts.map(c=>c.support),...store.parts('AssessmentPolicy').map(c=>c.support),...run.trace.flatMap(t=>t.support?[t.support]:t.supports??[])]});
  return {id,score,review,reasons,expression};
}
