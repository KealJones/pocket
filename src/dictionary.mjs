import {call,term,values,field,isTerm,format} from './ncon.mjs';
import {digest} from './digest.mjs';

// A bounded reader for source markup, not a wikitext evaluator. It never expands
// templates, loads includes, or treats dictionary bytes as a concept program.
function splitParameters(text){
  const parts=[];let from=0,templates=0,links=0;
  for(let i=0;i<text.length;i++){
    const pair=text.slice(i,i+2);
    if(pair==='{{'){templates++;i++;}else if(pair==='}}'){templates--;i++;}
    else if(pair==='[['){links++;i++;}else if(pair===']]'){links--;i++;}
    else if(text[i]==='|'&&!templates&&!links){parts.push(text.slice(from,i));from=i+1;}
  }
  parts.push(text.slice(from));return parts.map(p=>p.trim());
}
function templates(text){
  const result=[];let depth=0,start=0;
  for(let i=0;i<text.length-1;i++){
    const pair=text.slice(i,i+2);
    if(pair==='{{'){if(!depth)start=i;depth++;i++;}
    else if(pair==='}}'&&depth){depth--;i++;if(!depth)result.push({start,end:i+1,parts:splitParameters(text.slice(start+2,i-1))});}
  }
  return {result,complete:depth===0};
}
const simple=text=>typeof text==='string'&&text.length>0&&text.length<=256&&!/[{}<>\[\]\n|]/u.test(text);
function parameters(parts){
  const named=new Map(),positional=[];
  for(const part of parts.slice(1)){const match=/^([^=]+)=(.*)$/s.exec(part);if(match)named.set(match[1].trim(),match[2].trim());else positional.push(part);}
  return index=>named.get(String(index))??positional[index-1]??'';
}
export function dictionaryPassages(raw,{section,language,mappings=[],maximumSenses=64,maximumDefinition=8192,meaningSections=[]}={}){
  const passages=[];let offset=0,active=false,path=[],sense=null;
  for(const line of raw.split(/(?<=\n)/u)){
    const heading=/^(={2,6})\s*(.*?)\s*\1\s*$/u.exec(line.trim());
    if(heading){const level=heading[1].length;path=path.filter(p=>p.level<level);path.push({level,title:heading[2]});if(level===2)active=heading[2]===section;sense=null;}
    const definition=/^#(?![:*#])\s*(.*?)(?:\r?\n)?$/u.exec(line);
    if(active&&path.some(p=>meaningSections.includes(p.title))&&definition&&line.length<=maximumDefinition&&passages.length<maximumSenses){
      const parsed=templates(definition[1]),labels=[];let equivalents=[];let clean=definition[1],complete=parsed.complete;
      for(const template of [...parsed.result].reverse()){
        const name=template.parts[0].toLowerCase(),get=parameters(template.parts),mapping=mappings.find(m=>values(m)[0]===name);
        let replacement=null;
        if(mapping){
          const relation=values(mapping)[1],lang=get(field(mapping,'languageParameter',1)),target=get(field(mapping,'targetParameter',2));
          if(lang===language&&simple(target)&&isTerm(relation)){
            if(relation.head==='LexicalEquivalent')equivalents.push(target);else complete=false;
            // Inflected forms remain descriptive; no erasure of tense/number.
            replacement=target;
          }
        }else if(['lb','label'].includes(name)&&get(1)===language){
          for(let n=2;get(n);n++)labels.unshift(get(n));replacement='';
        }else if(['l','m','link','mention'].includes(name)&&get(1)===language&&simple(get(2))){replacement=get(3)||get(2);}
        else if(['q','qualifier'].includes(name)){labels.unshift(get(1));replacement='';}
        if(replacement===null){complete=false;continue;}
        clean=clean.slice(0,template.start)+replacement+clean.slice(template.end);
      }
      // Internal links preserve displayed words. Link targets do not imply synonymy.
      clean=clean.replace(/\[\[([^\[\]]+)\]\]/gu,(_all,body)=>{const parts=body.split('|');return parts.length>1?parts.at(-1):parts[0].split('#')[0];}).replace(/'{2,3}/gu,'').trim();
      if(/[{}<>\[\]]/u.test(clean))complete=false;
      equivalents=complete?equivalents.filter(target=>clean.replace(/[.]$/u,'').trim()===target):[];
      sense={start:offset,end:offset+line.length,raw:line,gloss:clean,complete,labels,path:path.map(p=>p.title),equivalents,examples:[]};passages.push(sense);
    }else if(active&&sense&&/^#[:*]/u.test(line)&&line.length<=maximumDefinition){sense.examples.push({raw:line,start:offset,end:offset+line.length});}
    offset+=line.length;
  }
  return passages;
}

export function readDictionary(project,document){
  const store=project.store,record=store.record(document),expression=record?.expression;
  if(!record?.active||expression.head!=='SourceDocument'||field(expression,'reader')!=='wiktionary')return [];
  const provider=field(expression,'provider');if(!isTerm(provider))return [];
  const config=store.parts(provider.head),value=head=>values(config.find(p=>p.expression.head===head)?.expression)[0];
  const raw=values(expression)[0];if(typeof raw!=='string')return [];
  // A new source revision replaces its old claims, preserving the old bytes in
  // inactive history. Derived routes and answers depend on the withdrawn snapshot.
  const url=field(expression,'url');
  if(url)for(const old of store.records('SourceDocument'))if(old.id!==document&&field(old.expression,'reader')==='wiktionary'&&field(old.expression,'url')===url&&format(field(old.expression,'provider'))===format(provider)&&(field(old.expression,'revision')!==field(expression,'revision')||values(old.expression)[0]!==raw))store.retract(old.id);
  const mappings=config.filter(p=>p.expression.head==='TemplateMapping').map(p=>p.expression);
  const passages=dictionaryPassages(raw,{section:value('LanguageSection'),language:value('Language'),mappings,maximumSenses:project.policy('DictionaryLearningPolicy','MaximumSenses'),maximumDefinition:project.policy('DictionaryLearningPolicy','MaximumDefinitionCharacters'),meaningSections:config.filter(p=>p.expression.head==='MeaningSection').map(p=>values(p.expression)[0])});
  const supports=[document,...config.map(p=>p.support),...store.parts('DictionaryLearningPolicy').map(p=>p.support)],created=[];
  for(const passage of passages){
    const identity=term('C_'+digest(document+':sense:'+passage.start));
    const observation=store.put(call('DictionarySense',[passage.raw],{document,start:passage.start,end:passage.end,gloss:passage.gloss,complete:passage.complete,section:term('List',...passage.path),labels:term('List',...passage.labels),language:value('Language'),identity}),{source:'derived:dictionary-observation',supports});
    const parts=[term('IsA',term('LexicalSense')),term('UnresolvedSense'),term('Label',field(expression,'title')+' · '+passage.path.at(-1)+' · '+passage.gloss),term('Surface',field(expression,'title')),term('Gloss',passage.gloss),term('DictionaryObservation',observation)];
    for(const equivalent of new Set(passage.equivalents))parts.push(term('LexicalEquivalent',equivalent));
    if(passage.complete&&!passage.equivalents.length){
      let gloss=passage.gloss;
      for(const prefix of config.filter(p=>p.expression.head==='DefinitionPrefix'))if(gloss.startsWith(values(prefix.expression)[0])){gloss=gloss.slice(values(prefix.expression)[0].length);break;}
      gloss=gloss.replace(/[.]$/u,'').trim();
      // Only a complete short definitional paraphrase is eligible. Negation,
      // modifiers and unknown templates stay in it; never mine isolated keywords.
      if(gloss&&gloss.length<=project.policy('DictionaryLearningPolicy','MaximumReferenceCharacters')&&gloss.split(/\s+/u).length<=project.policy('DictionaryLearningPolicy','MaximumReferenceWords')&&!/[;(),{}<>]/u.test(gloss))parts.push(term('DefinitionParaphrase',gloss));
    }
    created.push(store.put(term('Concept',identity,...parts),{source:'derived:dictionary-sense',supports:[observation]}));
    for(const example of passage.examples)store.put(call('DictionaryExample',[example.raw],{document,sense:observation,start:example.start,end:example.end}),{source:'derived:dictionary-example',supports:[observation]});
  }
  return created;
}

// Follow supported equivalence edges within the lexical lattice. No text rewrite,
// global SameAs, or choice of a sense. Missing targets become ordinary lexical work.
export function lexicalRoutes(store,identity,profile,{maximumDepth=4,maximumRoutes=64,maximumInspections=512}={}){
  const routes=[],needs=new Set();let exhausted=false,inspections=0;
  const visit=(id,supports,path,depth)=>{
    if(routes.length>=maximumRoutes||++inspections>maximumInspections){exhausted=true;return;}
    if(path.has(id))return;
    const denotations=store.parts(id,'Denotes');
    if(denotations.length){for(const d of denotations){if(routes.length>=maximumRoutes){exhausted=true;break;}routes.push({meaning:values(d.expression)[0],supports:[...supports,d.support]});}return;}
    const unresolved=store.parts(id,'UnresolvedSense');
    if(!unresolved.length){routes.push({meaning:term(id),supports});return;}
    const nextPath=new Set([...path,id]),references=[...store.parts(id,'LexicalEquivalent'),...store.parts(id,'DefinitionParaphrase')];
    for(const reference of references){
      const text=values(reference.expression)[0],surfaces=typeof text==='string'?store.surfaces(text,profile):[];
      if(!surfaces.length){needs.add(text);continue;}
      if(depth>=maximumDepth){exhausted=true;continue;}
      for(const surface of surfaces)visit(surface.target,[...supports,reference.support,surface.record],nextPath,depth+1);
    }
  };
  visit(identity,[],new Set(),0);return {routes,needs:[...needs].filter(t=>typeof t==='string'),exhausted};
}
