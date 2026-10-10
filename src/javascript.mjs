import { parse } from 'acorn';
import { term, variable } from './ncon.mjs';
// A bounded JS-to-concept compiler, not string execution. Unknown constructs fail.
export function compileJavaScript(source, parameters) {
  if(typeof source!=='string' || source.length>12000) throw new Error('Expected a JavaScript function under 12 KB');
  const program=parse(source,{ecmaVersion:2022,sourceType:'script'});
  if(program.body.length!==1) throw new Error('Provide one function as a code example');
  const first=program.body[0], fn=first.type==='ExpressionStatement'?first.expression:first;
  if(!['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(fn.type) || fn.generator || fn.params.some(p=>p.type!=='Identifier')) throw new Error('Code examples need a function with simple parameters');
  const names=[...parameters]; if(fn.params.length!==names.length) throw new Error('Function parameters must correspond to realization parameters in order');
  let local=0,steps=0; const scope=new Map(fn.params.map((p,i)=>[p.name,variable(names[i])]));
  function lower(node,bound) {
    if(++steps>256) throw new Error('JavaScript example exceeds the compiler budget');
    if(node.type==='Literal' && (node.value===null || ['string','number','boolean'].includes(typeof node.value))) return node.value;
    if(node.type==='Identifier' && bound.has(node.name)) return bound.get(node.name);
    if(node.type==='AwaitExpression') return lower(node.argument,bound);
    if(node.type==='BinaryExpression' && ['+','-','*','/'].includes(node.operator)) {
      const operation={'+':'number.add','-':'number.subtract','*':'number.multiply','/':'number.divide'}[node.operator];
      return term('Native',operation,lower(node.left,bound),lower(node.right,bound));
    }
    if(node.type==='UnaryExpression' && node.operator==='-') return term('Native','number.multiply',-1,lower(node.argument,bound));
    if(node.type==='CallExpression' && !node.optional && node.callee.type==='Identifier' && node.callee.name==='fetch' && !bound.has('fetch') && node.arguments.length===1) return term('Native','web.fetch-evidence',term('Quote',lower(node.arguments[0],bound)));
    if(node.type==='CallExpression' && !node.optional && node.arguments.length===0 && node.callee.type==='MemberExpression' && !node.callee.computed && node.callee.property.name==='text') return term('Native','web.response-text',lower(node.callee.object,bound));
    throw new Error('Unsupported JavaScript construct: '+node.type+'. Nothing was executed.');
  }
  function block(statements,bound) {
    const [first,...remaining]=statements;
    if(!first) throw new Error('The function needs a returned result');
    if(first.type==='ReturnStatement' && first.argument && remaining.length===0) return lower(first.argument,bound);
    if(first.type==='VariableDeclaration' && first.kind==='const') {
      function bind(declarations,scope) {
        if(!declarations.length) return block(remaining,scope);
        const [d,...rest]=declarations;
        if(d.id.type!=='Identifier'||!d.init||scope.has(d.id.name)) throw new Error('Use initialized, distinct const names');
        let name='js_local_'+local++; while(names.includes(name)) name='js_local_'+local++;
        const value=lower(d.init,scope),next=new Map(scope);next.set(d.id.name,variable(name));
        return term('Let',variable(name),value,bind(rest,next));
      }
      return bind(first.declarations,bound);
    }
    throw new Error('Unsupported JavaScript statement: '+first.type+'. Nothing was executed.');
  }
  return fn.body.type==='BlockStatement'?block(fn.body.body,scope):lower(fn.body,scope);
}
