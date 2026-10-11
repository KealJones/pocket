import { call, term, variable, isTerm, isVariable, values, field, format, substitute } from './ncon.mjs';
import { digest } from './digest.mjs';
import { repairSearch } from './repair.mjs';
import {formReadings,formKey} from './form-readings.mjs';
import {lexicalRoutes} from './dictionary.mjs';

/** Indexed lexical lattice + bounded construction matching. It makes proposals, never edits input. */
export function lattice(store, input, profile = '', { maximumSpan = 12, context=term('Context'),repair=null,dictionaryPolicy=null } = {}) {
  const units = input.tokens.filter(t => t.kind !== 'space'), edges = [], forms=formReadings(store,profile),lexicalNeeds=new Set();let lexicalExhausted=false;
  dictionaryPolicy??=Object.fromEntries([['maximumDepth','MaximumReferenceDepth'],['maximumRoutes','MaximumRoutes'],['maximumInspections','MaximumRouteInspections']].map(([key,head])=>[key,values(store.parts('DictionaryLearningPolicy',head)[0]?.expression)[0]??0]));
  const meanings=surface=>{
    const reading=lexicalRoutes(store,surface.target,profile,dictionaryPolicy);
    lexicalExhausted ||= reading.exhausted;
    for(const need of reading.needs)lexicalNeeds.add(need);
    return reading.routes.length?reading.routes:[{meaning:term(surface.target),supports:[],unresolved:true}];
  };
  const decoded=store.records('DecodedValue').filter(r=>field(r.expression,'profile','')===profile&&values(field(r.expression,'context',term('Context'))).every(n=>values(context).some(a=>format(n)===format(a))));
  for (let start = 0; start < units.length; start++) {
    for (let end = start + 1; end <= Math.min(units.length, start + maximumSpan); end++) {
      const raw = input.source.slice(units[start].start, units[end - 1].end);
      for (const surface of store.surfaces(raw, profile)) {
        for (const route of meanings(surface)) edges.push({ start,end,raw,meaning:route.meaning,score:surface.weight,
          supports:[surface.record,...route.supports],protected:units.slice(start,end).some(u=>u.protected),fragmentOnly:Boolean(route.unresolved),unresolved:Boolean(route.unresolved) });
      }
      if(!units.slice(start,end).some(u=>u.protected||u.kind!=='word'))for(const form of forms.get(formKey(raw))??[])for(const surface of store.surfaces(form.expected,profile)){
        for(const route of meanings(surface))edges.push({start,end,raw,meaning:route.meaning,score:surface.weight,supports:[form.support,surface.record,...route.supports],protected:false,formReading:form,fragmentOnly:Boolean(route.unresolved),unresolved:Boolean(route.unresolved)});
      }
    }
    if (units[start].kind === 'number') edges.push({ start, end: start + 1, raw: units[start].raw, meaning: Number(units[start].raw), score: 1, supports: [], protected: false });
    if (units[start].kind === 'url') edges.push({ start, end: start + 1, raw: units[start].raw, meaning: term('WebAddress', units[start].raw), score: 1, supports: [], protected: true });
    if(!units[start].protected)for(const r of decoded)if(values(r.expression)[0]===units[start].raw)edges.push({start,end:start+1,raw:units[start].raw,meaning:values(r.expression)[1],score:1,supports:[r.id],protected:false,fragmentOnly:field(r.expression,'fragmentOnly',true)});
  }
  if(repair)for(let start=0;start<units.length;start++)for(let end=start+1;end<=Math.min(units.length,start+repair.policy.maximumSurfaceSpan);end++){
    const span=units.slice(start,end);if(span.some(u=>u.protected||u.kind!=='word'))break;
    const raw=input.source.slice(span[0].start,span.at(-1).end);
    for(const surface of repair.surfaces){
      const distance=repair.distance(raw,surface.key);if(distance===null)continue;
      const hypothesis=repair.hypothesis(raw,surface.key,distance);if(!hypothesis)break;
      for(const route of meanings(surface))edges.push({start,end,raw,meaning:route.meaning,score:surface.weight-hypothesis.penalty,supports:[surface.record,...repair.supports,...route.supports],protected:false,fragmentOnly:true,repair:hypothesis,unresolved:Boolean(route.unresolved)});
    }
  }
  const unique = new Map();
  for (const edge of edges) {
    const key = `${edge.start}:${edge.end}:${format(edge.meaning)}`, held = unique.get(key);
    // An exact edge is not made uncertain merely because an approximate route
    // reaches the same meaning. Keep the winning route's own dependencies.
    const prefer = !held || (Boolean(held.repair) && !edge.repair) ||
      (Boolean(held.repair) === Boolean(edge.repair) && edge.score > held.score);
    if(prefer)unique.set(key,edge);
  }
  return { units, edges: [...unique.values()], forms,lexicalNeeds:[...lexicalNeeds],lexicalExhausted };
}
export async function propose(store, input, { profile = '', context = term('Context'), maximumStates = 1024, maximumCandidates = 64, maximumSpan = 12, score,repairPolicy=null,dictionaryPolicy=null } = {}) {
  const repair=repairPolicy?repairSearch(store,profile,repairPolicy):null;
  const lex = lattice(store, input, profile, { maximumSpan,context,repair,dictionaryPolicy }), chart = new Map(), indexed = new Map();
  let exhausted = false, states = 0, changed = false;
  const normalize = text => text.normalize('NFC').toLowerCase().replace(/\s+/gu, ' ');
  function retain(edge) {
    if (edge.end <= edge.start) return;
    const key = `${edge.start}:${edge.end}:${format(edge.meaning)}`, held = chart.get(key);
    if (held) {
      held.supports = [...new Set([...held.supports, ...edge.supports])];
      if (edge.score > held.score) { Object.assign(held, edge, { supports: held.supports }); changed = true; }
      return;
    }
    chart.set(key, edge); const at = indexed.get(edge.start) ?? []; at.push(edge); indexed.set(edge.start, at); changed = true;
  }
  for (const edge of lex.edges) retain({ ...edge, rule: edge.supports[0] ?? 'literal', holes: [], bindings: {}, consumed: [edge] });
  const constructions = [...store.definitions()].flatMap(([owner, definitions]) => definitions.flatMap(definition => definition.parts.filter(p => isTerm(p) && p.head === 'Construction').map(expression => ({ owner, definition, expression }))));
  const maximumRounds = Math.min(32, lex.units.length + 2);
  for (let round = 0; round < maximumRounds; round++) {
    changed = false;
    for (const { definition, expression: construction } of constructions) {
      if (exhausted) break;
      const pattern = field(construction, 'pattern'), meaning = field(construction, 'meaning');
      if (!isTerm(pattern) || pattern.head !== 'List' || meaning === undefined) continue;
      const required = values(field(construction, 'context', term('Context')));
      if (!required.every(n => values(context).some(a => format(n) === format(a)))) continue;
      const profileRequirement = field(construction, 'profile', ''); if (profileRequirement && profileRequirement !== profile) continue;
      async function visit(parts, part, at, start, bindings, supports, evidence, holes, consumed) {
        if (++states > maximumStates) { exhausted = true; return; }
        if (part === parts.length) {
          if (at > start) retain({ start, end: at, raw: input.source.slice(lex.units[start].start, lex.units[at - 1].end), meaning: substitute(meaning, bindings),
            score: evidence / Math.max(1, parts.length), supports: [definition.id, ...supports], rule: definition.id,
            holes, bindings: Object.fromEntries(bindings), consumed: consumed.flatMap(e => e.consumed ?? [e]), protected: consumed.some(e => e.protected) });
          return;
        }
        const p = parts[part]; if (!isTerm(p)) return;
        const expand = additions => visit([...parts.slice(0, part), ...additions, ...parts.slice(part + 1)], part, at, start, bindings, supports, evidence, holes, consumed);
        if (p.head === 'Choice') { for (const choice of values(p)) { if (exhausted) break; await expand([choice]); } return; }
        if (p.head === 'Optional') { await expand([]); if (!exhausted) await expand(values(p)); return; }
        if (p.head === 'Pattern') { await expand(values(p)); return; }
        if (p.head === 'Literal') {
          const text = values(p)[0]; if (typeof text !== 'string' || at >= lex.units.length) return;
          for (let end = at + 1; end <= Math.min(lex.units.length, at + maximumSpan); end++) {
            const raw = input.source.slice(lex.units[at].start, lex.units[end - 1].end);
            const span=lex.units.slice(at,end),expectedWords=text.trim().split(/\s+/u),wordAligned=span.every(u=>!u.protected&&u.kind==='word')&&expectedWords.length===span.length;
            const confirmedPieces=wordAligned?span.map((u,i)=>normalize(u.raw)===normalize(expectedWords[i])?{start:at+i,end:at+i+1,raw:u.raw,literal:true}:(lex.forms.get(formKey(u.raw))??[]).find(f=>formKey(f.expected)===formKey(expectedWords[i]))):[];
            if (normalize(raw) === normalize(text)) await visit(parts, part + 1, end, start, bindings, supports, evidence + 1, holes, [...consumed, { start: at, end, raw, literal: true }]);
            else if(!lex.units.slice(at,end).some(u=>u.protected||u.kind!=='word')&&(lex.forms.get(formKey(raw))??[]).some(f=>formKey(f.expected)===formKey(text))){
              for(const form of lex.forms.get(formKey(raw)).filter(f=>formKey(f.expected)===formKey(text)))await visit(parts,part+1,end,start,bindings,[...supports,form.support],evidence+1,holes,[...consumed,{start:at,end,raw,literal:true,formReading:form}]);
            }else if(wordAligned&&confirmedPieces.every(Boolean)){
              const pieces=confirmedPieces.map((p,i)=>p.literal?p:{start:at+i,end:at+i+1,raw:span[i].raw,literal:true,formReading:p});
              await visit(parts,part+1,end,start,bindings,[...supports,...pieces.flatMap(p=>p.formReading?[p.formReading.support]:[])],evidence+1,holes,[...consumed,...pieces]);
            }else if(repair&&wordAligned){
              const distance=repair.distance(raw,text);
              if(distance===null)continue;
              const pieces=span.map((u,i)=>{
                if(normalize(u.raw)===normalize(expectedWords[i]))return {start:at+i,end:at+i+1,raw:u.raw,literal:true};
                const d=repair.distance(u.raw,expectedWords[i]),hypothesis=d===null?null:repair.hypothesis(u.raw,expectedWords[i],d);
                return hypothesis?{start:at+i,end:at+i+1,raw:u.raw,literal:true,repair:hypothesis}:null;
              });
              if(pieces.every(Boolean))await visit(parts,part+1,end,start,bindings,[...supports,...repair.supports],evidence+1-distance*repair.policy.penalty,holes,[...consumed,...pieces]);
            }
          }
          return;
        }
        if (p.head === 'Lexeme') {
          const expected = values(p)[0];
          for (const edge of [...(indexed.get(at) ?? [])]) if (format(edge.meaning) === format(expected)) await visit(parts, part + 1, edge.end, start, bindings, [...supports, ...edge.supports], evidence + edge.score, [...holes, ...edge.holes], [...consumed, edge]);
          return;
        }
        if (p.head !== 'Slot' || !isVariable(values(p)[0])) return;
        const name = values(p)[0].variable, kind = field(p, 'kind'), primitive = field(p, 'primitive');
        // Capture a bounded, lossless text argument without guessing its meaning.
        // Only an explicitly taught construction can request this kind of slot.
        if (['text','segment'].includes(field(p, 'capture')))  {
          const span=field(p,'maximumSpan',maximumSpan);
          if(!Number.isInteger(span)||span<1)return;
          for (let end = at + 1; end <= Math.min(lex.units.length, at + maximumSpan,at+span); end++) {
            const units = lex.units.slice(at, end);
            if (units.some(u => u.protected || !(field(p,'capture')==='segment'?['word','number','punctuation']:['word']).includes(u.kind))) break;
            const raw = input.source.slice(units[0].start, units.at(-1).end);
            if (bindings.has(name) && format(bindings.get(name)) !== format(raw)) continue;
            const bound = new Map(bindings); bound.set(name, raw);
            await visit(parts, part + 1, end, start, bound, supports, evidence + 1, holes, [...consumed, {start:at,end,raw,literal:true}]);
          }
          return;
        }
        for (const edge of [...(indexed.get(at) ?? [])]) {
          if (exhausted) break;
          if (primitive && typeof edge.meaning !== primitive) continue;
          const primitiveKinds = { number: 'Number', string: 'String', boolean: 'Boolean' };
          const identity = isTerm(edge.meaning) ? edge.meaning.head : edge.meaning === null ? 'Null' : primitiveKinds[typeof edge.meaning];
          const proof = kind && isTerm(kind) && identity ? store.typeProof(identity, kind.head) : kind ? null : [];
          if (proof === null) continue;
          if (edge.protected && field(p, 'protected', false) !== true) continue;
          if (bindings.has(name) && format(bindings.get(name)) !== format(edge.meaning)) continue;
          const bound = new Map(bindings); bound.set(name, edge.meaning);
          await visit(parts, part + 1, edge.end, start, bound, [...supports, ...edge.supports, ...proof], evidence + edge.score, [...holes, ...edge.holes], [...consumed, edge]);
        }
        if (!exhausted && field(p, 'optional', false) === true) {
          const hole = call('Hole', [], { role: name, expected: kind ?? null }), bound = new Map(bindings); bound.set(name, hole);
          await visit(parts, part + 1, at, start, bound, supports, evidence, [...holes, hole], consumed);
        }
      }
      for (let start = 0; start < lex.units.length && !exhausted; start++) await visit(values(pattern), 0, start, start, new Map(), [], field(construction, 'weight', 0), [], []);
    }
    if (!changed || exhausted) break;
    if (round === maximumRounds - 1) exhausted = true;
  }
  const full = [...chart.values()].filter(e => e.start === 0 && e.end === lex.units.length&&!e.fragmentOnly), candidates = [];
  if (full.length > maximumCandidates) exhausted = true;
  for (const edge of full.slice(0, maximumCandidates)) {
    const rewardEvidence = store.expectationEvidence(edge.rule, profile), expectation = rewardEvidence.value;
    const ranking = score ? await score(edge.score, expectation, edge.holes.length) : { value: edge.score, supports: [] };
    candidates.push({ id: digest(edge.rule + '|' + format(edge.meaning)), meaning: edge.meaning,
      supports: [...new Set([...edge.supports, ...ranking.supports, ...(rewardEvidence.support ? [rewardEvidence.support] : [])])].sort(),
      evidence: edge.score, expectation, score: ranking.value, bindings: edge.bindings, holes: edge.holes, rule: edge.rule, consumed: edge.consumed,repairs:edge.consumed.filter(e=>e.repair).map(e=>e.repair) });
  }
  return { ...lex, fragments: [...chart.values()], candidates: candidates.sort((a, b) => b.score - a.score || format(a.meaning).localeCompare(format(b.meaning))), exhausted:exhausted||lex.lexicalExhausted||Boolean(repair?.exhausted),repairExhausted:Boolean(repair?.exhausted), graphVersion: store.version };
}

/** A labelled lesson derives a reusable construction from uniquely aligned known referents.
 * No teacher model, parser rewrite, or hardcoded sentence meaning. Ambiguous alignments refuse.
 */
export function learnExample(store, input, meaning, { profile = '', source = 'user:lesson', supports: priorSupports = [], textSlots = false, weight = 0, captureLimits={},context=term('Context') } = {}) {
  const lex = lattice(store, input, profile), replacements = new Map(), slots = [];
  function inspect(x,role) {
    const primitive = x === null ? 'Null' : {number:'Number',string:'String',boolean:'Boolean'}[typeof x];
    if (!isTerm(x) && !primitive) return;
    if (primitive || !x.args.length || x.head === 'WebAddress') {
      const edges = lex.edges.filter(e => format(e.meaning) === format(x));
      if (textSlots && typeof x === 'string') {
        for (let start=0; start<lex.units.length; start++) for(let end=start+1; end<=lex.units.length; end++) {
          const units=lex.units.slice(start,end); if(units.some(u=>u.protected||u.kind!=='word')) break;
          const raw=input.source.slice(units[0].start,units.at(-1).end);
          if(raw.normalize('NFC').toLowerCase()===x.normalize('NFC').toLowerCase()) edges.push({start,end,raw,meaning:x,supports:[],protected:false,capturedText:true});
        }
      }
      const spans = new Map(edges.map(e => [`${e.start}:${e.end}`, e]));
      if (spans.size === 1 && !replacements.has(format(x))) {
        const edge = [...spans.values()][0];
        if (edge.protected && x?.head !== 'WebAddress') return;
        const name = `v${slots.length}`, types = primitive ? [term(primitive)] : x.head === 'WebAddress' ? [term('WebAddress')] : store.parts(x.head, 'IsA').flatMap(p => values(p.expression)).filter(isTerm);
        if (types.length !== 1) throw new Error('Lesson needs exactly one direct kind for ' + x.head);
        const limit=captureLimits[role];
        if(limit!==undefined&&(!Number.isInteger(limit)||limit<1||limit>12))throw new Error('Capture limits must be integers in [1,12]');
        const slot = call('Slot', [variable(name)], edge.capturedText ? {capture:'text',...(limit===undefined?{}:{maximumSpan:limit})} : { kind: types[0], ...(edge.protected ? { protected: true } : {}) });
        replacements.set(format(x), variable(name)); slots.push({ edge, slot });
      } else if (spans.size > 1) throw new Error('Ambiguous lesson alignment for ' + x.head);
    } else for (const a of x.args) inspect(a.value,a.name);
  }
  inspect(meaning);
  if (!slots.length) throw new Error('Lesson needs a known referent to generalize; teach its surface and kind first');
  slots.sort((a, b) => a.edge.start - b.edge.start);
  for (let i = 1; i < slots.length; i++) if (slots[i].edge.start < slots[i - 1].edge.end) throw new Error('Overlapping lesson alignments');
  const parts = []; let at = 0;
  for (const { edge, slot } of slots) {
    while (at < edge.start) parts.push(term('Literal', lex.units[at++].raw));
    parts.push(slot); at = edge.end;
  }
  while (at < lex.units.length) parts.push(term('Literal', lex.units[at++].raw));
  function generalize(x) {
    if (replacements.has(format(x))) return replacements.get(format(x));
    return isTerm(x) ? { head: x.head, args: x.args.map(a => ({ ...a, value: generalize(a.value) })) } : x;
  }
  const construction = call('Construction', [], { pattern: term('List', ...parts), meaning: generalize(meaning), profile, weight,...(values(context).length?{context}:{}) });
  const declaration = term('Concept', term('Learned_' + digest(construction)), construction);
  const lesson = call('Lesson', [input.expression, meaning], { profile });
  const lessonId = store.put(lesson, { source, supports: priorSupports });
  const supports = [...new Set([lessonId, ...slots.flatMap(s => [...s.edge.supports, ...store.parts(s.edge.meaning.head, 'IsA').map(p => p.support)])])];
  const id = store.put(declaration, { source, supports });
  return { id, lessonId, declaration };
}
