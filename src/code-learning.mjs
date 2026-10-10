import { call, term, isTerm, values, field, match, format, isVariable } from './ncon.mjs';
import { compileJavaScript } from './javascript.mjs';
// Code examples are explicit .ncon IR. No eval, Function, or remote JS execution.
export const LEARNABLE_CAPABILITIES = new Set(['number.add','number.subtract','number.multiply','number.divide','number.less','value.equal','text.concat','text.length','text.at','text.matches','term.format','web.fetch-evidence','web.response-text']);
export function validateCode(body, parameters, store) {
  let steps=0; const supports=new Set(), visited=new Set();
  function visit(value, quoted=false, scope=parameters) {
    if(++steps>256) throw new Error('Code example exceeds the expression budget');
    if(isVariable(value)) { if(!scope.has(value.variable)) throw new Error('Unbound code parameter: '+value.variable); return; }
    if(!isTerm(value)) return;
    if(value.head==='Quote') { values(value).forEach(v=>visit(v,true,scope)); return; }
    if(quoted) { value.args.forEach(a=>visit(a.value,true,scope)); return; }
    if(value.head==='Let') {
      const [name,expression,body]=values(value); if(!isVariable(name)||values(value).length!==3) throw new Error('Invalid local binding');
      visit(expression,false,scope);const next=new Set(scope);next.add(name.variable);visit(body,false,next);return;
    }
    if(value.head==='If' && values(value).length===3) {values(value).forEach(v=>visit(v,false,scope));return;}
    if(value.head==='Native') {
      if(!LEARNABLE_CAPABILITIES.has(values(value)[0]))throw new Error('Code examples use registered capabilities in .ncon IR; unsupported operation: '+value.head);
      values(value).slice(1).forEach(v=>visit(v,false,scope));return;
    }
    const rules=store?.parts(value.head,'Realization')??[];
    if(!rules.length)throw new Error('Code examples use registered capabilities in .ncon IR; unsupported operation: '+value.head);
    value.args.forEach(a=>visit(a.value,false,scope));
    for(const rule of rules){
      supports.add(rule.support);const key=rule.support+'|'+format(rule.expression);
      if(visited.has(key))continue;visited.add(key);
      visit(field(rule.expression,'body'),false,parameterNames(values(rule.expression)[0]));
    }
  }
  visit(body);return [...supports];
}
export function parameterNames(pattern) {
  const names=new Set(); const visit=v=>{if(isVariable(v)) names.add(v.variable);else if(isTerm(v))v.args.forEach(a=>visit(a.value));};visit(pattern);return names;
}
export async function learnRealization(project, { input=null, meaning=null, pattern, body, code, language='ncon', checks=[] }, { source='user:code-example', supports=[] } = {}) {
  if(!isTerm(pattern)) throw new Error('A realization needs a concept pattern');
  if(input!==null && (pattern.head!==meaning?.head||!match(pattern,meaning,new Map()))) throw new Error('The realization pattern must match the example meaning');
  if(language==='javascript') body=compileJavaScript(code,parameterNames(pattern));
  else if(language!=='ncon') throw new Error('Unsupported code language');
  const dependencies=validateCode(body,parameterNames(pattern),project.store);
  for(const check of checks) {
    const bindings=match(pattern,check.input,new Map()); if(!bindings) throw new Error('A check does not match the realization pattern');
    const result=await project.evaluator.evaluate(body,{bindings});
    if(format(result.value)!==format(check.output)) throw new Error('Code example failed a supplied execution check');
  }
  const evidence=project.store.put(call('CodeExample',[input,meaning,pattern,body],{language,originalCode:code ?? format(body),checks:term('List',...checks.map(c=>term('Check',c.input,c.output))),profile:project.profile}),{source,supports:[...new Set([...supports,...dependencies])]});
  const lesson=input===null?null:await project.teachExample(input,meaning,{source,supports:[evidence]});
  const declaration=term('Concept',term(pattern.head),call('Realization',[pattern],{body}),call('ValidatedRealization',[pattern],{body}),term('LearnedFrom',lesson?.lessonId??evidence));
  const id=project.store.put(declaration,{source:'derived:code-example',supports:[...(lesson?[lesson.id]:[]),evidence]});
  return {id,evidence,lesson,declaration};
}
export const learnCode=learnRealization;
