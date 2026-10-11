import { call, term, values, field, isTerm } from './ncon.mjs';
import {sourceIdentity as identityFor,decodeClaims} from './source-claims.mjs';
import { capture } from './ears.mjs';
import { outline } from './outcomes.mjs';
import { format } from './ncon.mjs';

export async function fetchBounded(url, { timeout = 2500, maximumBytes = 1000000, fetcher = fetch, sourceURLHeader = false } = {}) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Expected an HTTP(S) URL without credentials');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetcher(url, { signal: controller.signal, headers: { 'User-Agent': 'NapkinNext/0.1 learning-research', Accept: 'application/json,text/plain,text/html' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!response.body) throw new Error('Empty response body');
    const reader = response.body.getReader(), chunks = []; let size = 0;
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) { await reader.cancel(); throw new Error('Response exceeds byte budget'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { text: new TextDecoder().decode(bytes), url: (sourceURLHeader && response.headers.get('x-napkin-source-url')) || response.url || url, contentType: response.headers.get('content-type') ?? '' };
  } finally { clearTimeout(timer); }
}
const partValue = (parts, head) => values(parts.find(p => isTerm(p) && p.head === head))[0];
export class Sources {
  constructor(store, { fetcher = fetch, timeout = 2500, maximumBytes = 1000000, baseURL, sourceURLHeader = false } = {}) {
    this.store = store; this.options = { fetcher, timeout, maximumBytes, baseURL, sourceURLHeader };
  }
  available() {
    return [...this.store.definitions()].filter(([id]) => this.store.isA(id, 'LearningSource')).map(([identity]) => {
      const parts = this.store.parts(identity).map(p => p.expression);
      return { identity, parts, adapter: partValue(parts, 'Adapter'), endpoint: partValue(parts, 'Endpoint'), license: partValue(parts, 'License'), language: partValue(parts, 'Language') ?? 'en', priority: partValue(parts, 'Priority') ?? 100 };
    }).sort((a, b) => a.priority - b.priority || a.identity.localeCompare(b.identity));
  }
  async json(endpoint, parameters, options = {}) {
    const url = new URL(endpoint, this.options.baseURL);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, String(value));
    if(this.deadline&&Date.now()>=this.deadline) throw new Error('Request learning time budget exhausted');
    const response = await fetchBounded(url.href, {...this.options,...options,timeout:Math.min(options.timeout??this.options.timeout,this.deadline?Math.max(1,this.deadline-Date.now()):Infinity)});
    const data = JSON.parse(response.text); if (data.error) throw new Error(data.error.info ?? data.error.code ?? 'Source error');
    return { data, url: response.url };
  }
  async acquire(query, source, { context = query } = {}) {
    if (source.adapter === 'dataset-examples') return this.datasetExamples(context, source);
    if (source.adapter === 'worked-examples') return this.workedExamples(context, source);
    if (source.adapter === 'wikidata') return this.wikidata(query, source);
    if (source.adapter === 'mediawiki-text') return this.mediawiki(query, source);
    throw new Error('Uninstalled source adapter: ' + source.adapter);
  }
  async datasetExamples(context, source) {
    const shape = outline(context);
    if (shape.numbers.length < 2 || shape.numbers.length > 4) return { records: [], examples: [] };
    const query = capture(context).tokens.filter(t => t.kind === 'word' && !t.protected).map(t => t.raw).join(' ');
    // Retrieve language evidence, never the requested answer. Symbols-only input
    // uses the same bounded corpus slice; its structural pattern selects evidence.
    const parameters = { dataset: partValue(source.parts, 'Dataset'), config: partValue(source.parts, 'Configuration'), split: partValue(source.parts, 'Split'), offset: 0, length: 100 };
    const endpoint = query ? source.endpoint : source.endpoint.replace(/\/search$/, '/rows');
    if (query && endpoint.endsWith('/search')) parameters.query = query;
    const response = await this.json(endpoint, parameters);
    const inputColumn = partValue(source.parts, 'InputColumn'), outputColumn = partValue(source.parts, 'OutputColumn');
    const examples = [], rows = [];
    for (const item of response.data.rows ?? []) {
      const input = item.row?.[inputColumn], output = item.row?.[outputColumn];
      if (typeof input !== 'string' || typeof output !== 'number' || !Number.isFinite(output)) continue;
      const example = outline(input);
      if (format(example.pattern) !== format(shape.pattern) || JSON.stringify(example.numbers) === JSON.stringify(shape.numbers)) continue;
      // Other columns, including the dataset's operation label, are never read.
      examples.push({ input, output }); rows.push({ row: item.row_idx, input, output });
    }
    return { queryUrl: response.url, examples, records: rows.length ? [call('SourceExamples', [JSON.stringify(rows)], { url: response.url, provider: term(source.identity), license: source.license })] : [] };
  }
  async workedExamples(context, source) {
    const response = await this.json(source.endpoint, {});
    if (!Array.isArray(response.data.sets)) throw new Error('Expected a worked-example catalogue');
    const words = text => new Set(capture(text).tokens.filter(t => !['space','number'].includes(t.kind)).map(t => t.raw.normalize('NFC').toLowerCase()));
    const query = words(context);
    const ranked = response.data.sets.filter(set => Array.isArray(set.examples)).map(set => {
      const terms = new Set(set.examples.filter(e => typeof e.input === 'string').flatMap(e => [...words(e.input)]));
      const intersection = [...query].filter(word => terms.has(word)).length;
      return { set, score: intersection / Math.max(1, new Set([...query, ...terms]).size) };
    });
    const best = Math.max(0, ...ranked.map(x => x.score));
    const matching = ranked.filter(x => best > 0 && x.score === best).map(x => x.set);
    const examples = matching.flatMap(set => set.examples).filter(e => typeof e.input === 'string' && typeof e.output === 'number' && Number.isFinite(e.output));
    return { queryUrl: response.url, examples, records: examples.length ? [call('SourceExamples', [JSON.stringify(matching)], { url: response.url, provider: term(source.identity), license: source.license })] : [] };
  }
  async wikidata(query, source) {
    const language = source.language;
    const search = await this.json(source.endpoint, { action: 'wbsearchentities', search: query, language, uselang: language, type: 'item', limit: 5, format: 'json', origin: '*' });
    const hits = (search.data.search ?? []).filter(x => typeof x.id === 'string'); if (!hits.length) return { records: [], queryUrl: search.url };
    const details = await this.json(source.endpoint, { action: 'wbgetentities', ids: hits.map(h => h.id).join('|'), props: 'info|labels|descriptions|aliases|claims', languages: language, format: 'json', origin: '*' });
    const records = [];
    for (const hit of hits) {
      const entity = details.data.entities?.[hit.id]; if (!entity || entity.missing !== undefined) continue;
      const identity = identityFor(source.identity, hit.id), parts = [], label = entity.labels?.[language]?.value ?? hit.label;
      if (label) parts.push(term('Label', label));
      if (entity.descriptions?.[language]?.value) parts.push(term('Description', entity.descriptions[language].value));
      const surfaces = new Set([label, ...(entity.aliases?.[language] ?? []).map(a => a.value)].filter(Boolean));
      // Only actual source labels/aliases become forms. A fuzzy search query is NOT an alias.
      for (const text of surfaces) parts.push(term('Surface', text));
      parts.push(call('ExternalIdentity', [hit.id], { source: term(source.identity) }));
      // Declarative, source-schema quantity mapping. No number-word table.
      for(const mapping of source.parts.filter(p=>isTerm(p)&&p.head==='ValueMapping')) {
        const [property,relationship]=values(mapping); if(!isTerm(relationship)||field(mapping,'datatype')!=='quantity') continue;
        const claims=(entity.claims?.[property]??[]).filter(c=>c.rank!=='deprecated'&&!Object.keys(c.qualifiers??{}).length);
        const preferred=claims.filter(c=>c.rank==='preferred');
        for(const claim of preferred.length?preferred:claims) {
          const snak=claim.mainsnak,value=snak?.datavalue?.value;
          if(snak?.snaktype && snak.snaktype!=='value') continue;
          if(value?.unit!==field(mapping,'unit')||typeof value.amount!=='string'||!Number.isFinite(Number(value.amount))) continue;
          if(value.lowerBound && Number(value.lowerBound)!==Number(value.amount)||value.upperBound && Number(value.upperBound)!==Number(value.amount)) continue;
          parts.push(term(relationship.head,Number(value.amount)));
        }
      }
      for (const mapping of source.parts.filter(p => isTerm(p) && p.head === 'Mapping')) {
        const [property, relationship] = values(mapping); if (!isTerm(relationship)) continue;
        for (const claim of entity.claims?.[property] ?? []) {
          const value = claim.mainsnak?.datavalue?.value;
          if (value?.id && claim.rank !== 'deprecated') {
            const relation = term(relationship.head, identityFor(source.identity, value.id));
            if (claim.qualifiers && Object.keys(claim.qualifiers).length) parts.push(call('ScopedClaim', [relation], { qualifiers: JSON.stringify(claim.qualifiers), statement: claim.id ?? null }));
            else parts.push(relation);
          }
        }
      }
      records.push(call('SourceEntity', [JSON.stringify(entity)], { externalId: hit.id, provider: term(source.identity), license: source.license, interpreted: false }));
      records.push(...decodeClaims(source.identity,entity));
      records.push(term('Concept', identity, ...parts, call('Citation', [`https://www.wikidata.org/wiki/${hit.id}`], { provider: term(source.identity), license: source.license, revision: entity.lastrevid ?? null })));
    }
    return { records, queryUrl: details.url };
  }
  async mediawiki(query, source) {
    const response = await this.json(source.endpoint, { action: 'query', titles: query, prop: 'revisions', rvprop: 'ids|timestamp|user|content', rvslots: 'main', formatversion: 2, format: 'json', origin: '*' });
    const records = [];
    for (const page of response.data.query?.pages ?? []) {
      if (page.missing || !page.revisions?.length) continue;
      const revision = page.revisions[0], raw = revision.slots?.main?.content;
      if (typeof raw !== 'string') continue;
      const pageUrl = new URL('/wiki/' + encodeURIComponent(page.title), source.endpoint).href;
      records.push(call('SourceDocument', [raw], { title: page.title, url: pageUrl, history: pageUrl + '?action=history', provider: term(source.identity), license: source.license, reader: partValue(source.parts,'DocumentReader')??null, contentType:'text/x-wiki', language:source.language, revision: revision.revid ?? null, contributor: revision.user ?? null, interpreted: false }));
    }
    return { records, queryUrl: response.url };
  }
  async readPage(url) {
    const response = await fetchBounded(url, this.options);
    return call('SourceDocument', [response.text], { url: response.url, contentType: response.contentType, license: 'unspecified', interpreted: false });
  }
}
