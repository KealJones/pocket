import { digest } from './digest.mjs';
import { call, term, isTerm, values, field, format, parse, equal } from './ncon.mjs';

export class StoreBase {
  constructor(database) {
    this.db = database;
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, head TEXT NOT NULL, expression TEXT NOT NULL, source TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS records_head ON records(head, active);
      CREATE INDEX IF NOT EXISTS records_source ON records(source, active);
      CREATE TABLE IF NOT EXISTS dependencies(record TEXT NOT NULL, support TEXT NOT NULL, PRIMARY KEY(record,support));
      CREATE INDEX IF NOT EXISTS dependencies_support ON dependencies(support);
      CREATE TABLE IF NOT EXISTS surfaces(key TEXT NOT NULL, target TEXT NOT NULL, profile TEXT NOT NULL, record TEXT NOT NULL, weight REAL NOT NULL, PRIMARY KEY(key,target,profile,record));
      CREATE INDEX IF NOT EXISTS surfaces_key ON surfaces(key,profile);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, query TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, detail TEXT NOT NULL DEFAULT '', updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS trace_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,run TEXT NOT NULL,episode TEXT NOT NULL,kind TEXT NOT NULL,detail TEXT NOT NULL,created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS trace_events_episode ON trace_events(episode,sequence);
      CREATE INDEX IF NOT EXISTS trace_events_run ON trace_events(run,sequence);
      PRAGMA user_version=2;`);
    this.version = 0; this.cacheVersion = -1; this.units = new Map();
  }
  appendTrace({ run, episode, kind, detail = {} }) {
    if (![run,episode,kind].every(v=>typeof v==='string'&&v.length>0) || kind.length>80) throw new Error('Invalid trace identity');
    let encoded=JSON.stringify(detail);
    if(encoded.length>262144)encoded=JSON.stringify({truncated:true,originalCharacters:encoded.length,preview:encoded.slice(0,120000),reason:'Trace display budget; linked notebook records retain original evidence'});
    this.db.prepare('INSERT INTO trace_events(run,episode,kind,detail,created) VALUES(?,?,?,?,?)').run(run,episode,kind,encoded,Date.now());
    return Number(this.db.prepare('SELECT last_insert_rowid() AS sequence').get().sequence);
  }
  traces({ episode, run, limit=200, after=0 } = {}) {
    if(!Number.isInteger(limit)||limit<1||limit>10000||!Number.isInteger(after)||after<0)throw new Error('Invalid trace query budget');
    const where=['sequence>?'],args=[after];
    if(episode){where.push('episode=?');args.push(episode);}if(run){where.push('run=?');args.push(run);}
    return this.db.prepare('SELECT * FROM trace_events WHERE '+where.join(' AND ')+' ORDER BY sequence DESC LIMIT ?').all(...args,limit).reverse().map(r=>({...r,detail:JSON.parse(r.detail)}));
  }
  exportLearningHistory() {
    const records=this.db.prepare('SELECT * FROM records ORDER BY created,id').all().map(r=>({...r,active:Boolean(r.active),supports:this.db.prepare('SELECT support FROM dependencies WHERE record=? ORDER BY support').all(r.id).map(s=>s.support)}));
    const events=this.db.prepare('SELECT * FROM trace_events ORDER BY sequence').all().map(r=>({...r,detail:JSON.parse(r.detail)}));
    return {format:'pocket-learning-history',version:1,exportedAt:new Date().toISOString(),notes:'Runtime decisions and evidence. Scores are estimates; model diagnoses are suggestions. Inactive records and their history are retained.',records,events,jobs:this.db.prepare('SELECT * FROM jobs ORDER BY updated,id').all()};
  }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const out = fn(); this.db.exec('COMMIT'); return out; } catch (error) { this.db.exec('ROLLBACK'); this.version++; throw error; } }
  put(expression, { source = 'user', supports = [] } = {}) {
    if (!isTerm(expression)) throw new TypeError('Stored records must be concept expressions');
    for (const support of supports) if (!this.record(support)?.active) throw new Error('Inactive or missing support: ' + support);
    const supportSet = [...new Set(supports)].sort();
    const id = digest(source + '\n' + format(expression) + (supportSet.length ? '\n' + supportSet.join('\n') : ''));
    this.db.prepare('INSERT INTO records VALUES(?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET active=1').run(id, expression.head, format(expression), source, Date.now());
    for (const support of supportSet) this.db.prepare('INSERT OR IGNORE INTO dependencies VALUES(?,?)').run(id, support);
    if (expression.head === 'Concept') this.indexSurfaces(id, expression);
    this.version++; return id;
  }
  indexSurfaces(id, expression) {
    this.db.prepare('DELETE FROM surfaces WHERE record=?').run(id);
    const [identity, ...parts] = values(expression); if (!isTerm(identity) || identity.args.length) throw new Error('Concept identity must be a zero-argument concept');
    for (const p of parts) if (isTerm(p) && p.head === 'Surface') {
      const raw = values(p)[0]; if (typeof raw !== 'string') throw new Error('Surface needs text');
      const weight = field(p, 'weight', 1); if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) throw new Error('Invalid surface weight');
      this.db.prepare('INSERT OR IGNORE INTO surfaces VALUES(?,?,?,?,?)').run(raw.normalize('NFC').toLowerCase(), identity.head, String(field(p, 'profile', '')), id, weight);
    }
  }
  record(id) { const row = this.db.prepare('SELECT * FROM records WHERE id=?').get(id); return row ? { ...row, expression: parse(row.expression), active: Boolean(row.active) } : undefined; }
  records(head) { return this.db.prepare(head ? 'SELECT * FROM records WHERE active=1 AND head=? ORDER BY id' : 'SELECT * FROM records WHERE active=1 ORDER BY id').all(...(head ? [head] : [])).map(r => ({ ...r, expression: parse(r.expression) })); }
  definitions() {
    if (this.cacheVersion === this.version) return this.units;
    this.units = new Map();
    for (const r of this.records('Concept')) {
      const [identity, ...parts] = values(r.expression);
      if (!isTerm(identity)) continue;
      const held = this.units.get(identity.head) ?? []; held.push({ id: r.id, source: r.source, parts }); this.units.set(identity.head, held);
    }
    this.cacheVersion = this.version; return this.units;
  }
  parts(identity, head) { return (this.definitions().get(identity) ?? []).flatMap(d => d.parts.filter(p => !head || isTerm(p) && p.head === head).map(expression => ({ expression, support: d.id }))); }
  surfaces(text, profile = '') {
    return this.db.prepare(`SELECT s.* FROM surfaces s JOIN records r ON r.id=s.record WHERE r.active=1 AND s.key=? AND (s.profile='' OR s.profile=?) ORDER BY s.target,s.record`).all(text.normalize('NFC').toLowerCase(), profile);
  }
  isA(identity, kind, visited = new Set()) {
    return this.typeProof(identity, kind, visited) !== null;
  }
  typeProof(identity, kind, visited = new Set()) {
    if (identity === kind) return []; if (visited.has(identity)) return null; visited.add(identity);
    for (const p of [...this.parts(identity, 'IsA'), ...this.parts(identity, 'SubclassOf')]) for (const v of values(p.expression)) {
      if (!isTerm(v)) continue;
      const proof = this.typeProof(v.head, kind, visited); if (proof !== null) return [p.support, ...proof];
    }
    return null;
  }
  retract(id) {
    return this.transaction(() => {
      const removed = [], queue = [id];
      while (queue.length) {
        const current = queue.shift(); if (removed.includes(current) || !this.record(current)?.active) continue;
        this.db.prepare('UPDATE records SET active=0 WHERE id=?').run(current); removed.push(current);
        queue.push(...this.db.prepare('SELECT record FROM dependencies WHERE support=? ORDER BY record').all(current).map(r => r.record));
      }
      this.version++;
      if(removed.length){const recent=this.db.prepare('SELECT run,episode FROM trace_events ORDER BY sequence DESC LIMIT 1').get();
        const affected=new Set(removed.map(record=>field(this.record(record)?.expression,'episode')).filter(Boolean));
        if(!affected.size)affected.add(recent?.episode??'notebook');
        for(const episode of affected)this.appendTrace({run:'withdraw-'+id,episode,kind:'knowledge.withdrawn',detail:{target:id,removed,affectedEpisodes:[...affected],reason:'Explicit retraction; original observations and audit events remain'}});}
      return removed;
    });
  }
  enqueue(query, kind = 'lexical') {
    const id = digest(kind + '\n' + query.normalize('NFC').toLowerCase());
    this.db.prepare(`INSERT INTO jobs(id,query,kind,status,updated) VALUES(?,?,?,'pending',?) ON CONFLICT(id) DO UPDATE SET status='pending',attempts=0,updated=excluded.updated WHERE jobs.status='done'`).run(id, query, kind, Date.now());
    return id;
  }
  agenda() { return this.db.prepare("SELECT * FROM jobs WHERE status!='done' ORDER BY attempts,updated,id").all(); }
  job(id) { return this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id); }
  updateJob(id, status, detail) { this.db.prepare('UPDATE jobs SET status=?,detail=?,attempts=attempts+1,updated=? WHERE id=?').run(status, detail, Date.now(), id); }
  expectation(target, profile = '') {
    return this.expectationEvidence(target, profile).value;
  }
  expectationEvidence(target, profile = '') {
    const matching = this.records('Feedback').filter(r => field(r.expression, 'target') === target && field(r.expression, 'profile', '') === profile);
    matching.sort((a, b) => field(a.expression, 'sequence', 0) - field(b.expression, 'sequence', 0));
    return matching.length ? { value: field(matching.at(-1).expression, 'updated'), support: matching.at(-1).id } : { value: 0 };
  }
  export() { return this.records().map(r => format(call('Record', [r.expression], { id: r.id, source: r.source, supports: term('List', ...this.db.prepare('SELECT support FROM dependencies WHERE record=? ORDER BY support').all(r.id).map(x => x.support)) }))).join('\n') + '\n'; }
  close() { this.db.close(); }
}
