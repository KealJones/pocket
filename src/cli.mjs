#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Project } from './project.mjs';
import { parse, format, values, field, isTerm } from './ncon.mjs';

const args = process.argv.slice(2);
function option(name, fallback) { const index = args.indexOf(name); if (index < 0) return fallback; const value = args[index + 1]; if (!value || value.startsWith('--')) throw new Error(name + ' needs a value'); args.splice(index, 2); return value; }
const path = option('--db', resolve('data/knowledge.sqlite'));
const profile = option('--profile', '');
const offline = args.includes('--offline'); if (offline) args.splice(args.indexOf('--offline'), 1);
const json = args.includes('--json'); if (json) args.splice(args.indexOf('--json'), 1);
const project = new Project({ path, profile, online: !offline });
let last;
const print = value => stdout.write((typeof value === 'string' ? value : JSON.stringify(value, null, 2)) + '\n');
function show(turn) {
  last = turn;
  if (json) { print(turn); return; }
  print(field(turn.reply,'text',turn.spoken)); print(`status=${turn.status} episode=${turn.episodeId}`);
  for (const [i, candidate] of turn.candidates.entries()) print(`[${i}] ${format(candidate.meaning)} score=${candidate.score.toFixed(3)} procedure=${candidate.rule}`);
  if (turn.attempts.length) for (const attempt of turn.attempts) print(`learn ${attempt.query}: ${attempt.status}, ${attempt.detail}`);
}
const help = `Napkin Next 0.3.0
Type text to preserve it, propose readings, and acquire missing knowledge.
Commands use the same .ncon notation as knowledge and behavior:
  :load("examples/world.ncon")             load intentionally authored concepts
  :teach(Concept(Waht(), Surface("waht", profile="keal")))
  :example("Greg returns the book", Returning(actor=Greg(), object=Book()))
  :outcome("original input", 12)           observe a numeric result, induce a procedure
  :code("phrase", Meaning(), Pattern(), Body())  teach an .ncon implementation
  :reward(0, 8, expected=5)                reward a candidate from the last turn
  :resume("episode-id")                   re-interpret an earlier observation
  :learn(2)                               run bounded pending learning work
  :exist(2)                               learn, then revisit unresolved observations
  :agenda()                               inspect unresolved work
  :read("https://example.org/page")        save a page as unexecuted evidence
  :retract("support-id")                  invalidate it and dependent readings
  :history("learning-history.json")        export decisions, reviews and inactive knowledge
  :export("knowledge.ncon")               export active records with provenance
  :import("knowledge.ncon")               restore a trusted export and its supports
  :eval(Add(5, 2))                         intentionally evaluate an expression
  :help() / :quit()
Options: --offline --json --db PATH --profile NAME
Online acquisition is enabled by default. The example world is optional curriculum,
never loaded into a normal session.`;

async function execute(line) {
  if (!line.startsWith(':')) { show(await project.turn(line)); return; }
  const command = parse(line.slice(1)); if (!isTerm(command)) throw new Error('Expected a command concept');
  const a = values(command);
  switch (command.head.toLowerCase()) {
    case 'help': print(help); break;
    case 'quit': return false;
    case 'load': print({ learned: project.load(readFileSync(a[0], 'utf8'), { provenance: 'user:file:' + resolve(a[0]) }) }); break;
    case 'teach': print({ learned: project.load(a.map(format).join('\n')) }); break;
    case 'example': print(await project.teachExample(a[0], a[1])); break;
    case 'outcome': print(await project.teachOutcomes([{input:a[0],output:a[1]}])); break;
    case 'code': print(await project.teachCode({input:a[0],meaning:a[1],pattern:a[2],body:a[3]})); break;
    case 'reward': {
      const candidate = last?.candidates[a[0]];
      if (!candidate) throw new Error('Choose a candidate index from the last turn');
      print(await project.reward(candidate.rule, a[1], { expected: field(command, 'expected', project.store.expectation(candidate.rule, profile)), profile })); break;
    }
    case 'resume': show(await project.resume(a[0])); break;
    case 'learn': print(await project.tick({ budget: a[0] ?? 2 })); break;
    case 'exist': print(await project.exist({ budget: a[0] ?? 2 })); break;
    case 'agenda': print(project.store.agenda()); break;
    case 'read': print(await project.readPage(a[0])); break;
    case 'retract': print({ invalidated: project.store.retract(a[0]) }); break;
    case 'history': writeFileSync(a[0],JSON.stringify(project.store.exportLearningHistory(),null,2)); print('Saved '+a[0]);break;
    case 'export': writeFileSync(a[0], project.store.export()); print('Saved ' + a[0]); break;
    case 'import': print({ imported: project.importRecords(readFileSync(a[0], 'utf8')) }); break;
    case 'eval': print(await project.evaluator.evaluate(a[0])); break;
    default: throw new Error('Unknown command; use :help()');
  }
  return true;
}
try {
  if (args.length) await execute(args.join(' '));
  else {
    print(help);
    const rl = createInterface({ input: stdin, output: stdout, terminal: Boolean(stdin.isTTY) });
    try {
      for await (const line of rl) {
        if (!line.trim()) continue;
        try { if (await execute(line) === false) break; } catch (error) { print('Error: ' + error.message); }
        if (stdin.isTTY) stdout.write('> ');
      }
    } finally { rl.close(); }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { project.close(); }
