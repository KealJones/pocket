# Verification and boundaries

Verified on 2026-10-10 with Node 24.19.0. Package minimum: Node 22.13.0; that exact
minimum version was not available for a separate compatibility run.

## Automated checks

`npm test`: 117 tests pass. Coverage includes:

- direct `.ncon` parsing/formatting, variable binding/shadowing, rule context,
  conflicts, cycles, residuals, and bounded evaluation;
- lossless ears, user spellings, titles, protected text, ambiguity, intentional
  joint meaning, explicit holes, and interpretation search exhaustion;
- example generalization to new known referents, refusing ambiguous lessons,
  separately taught negation, and keeping grammar glue out of unnecessary lookups;
- reward/profile isolation, persistence across reopen, provenance-preserving
  active-record export/import, and manifest failures;
- dependent-reading/lesson invalidation, separate proof identities, independently
  asserted type evidence, retractable feedback, explicit policy revision conflicts,
  reopening learning work after retraction, and fair bounded `Exist` revisiting;
- mocked official API shapes, competing entities, qualified property retention,
  exact-versus-fuzzy aliases, licensing evidence, missing hits, source failures,
  inert retrieved program text, HTTP errors, response byte limits, and cancellation.

- the actual browser SQLite WASM engine: learning, generalization, feedback, pending
  jobs, full-database snapshot/reopen, resume, and retraction;
- browser SHA-256 identity compatibility with Node, including Unicode and long input.
- a DOM-level workbench integration test exercising the actual demo, precise token
  display, numeric feedback, new-concept authoring, revisiting, IndexedDB persistence,
  and re-opening the retained notebook.
- program induction from varied outcomes, held-out numeric inputs, opaque words,
  ambiguous evidence, counterexamples, native SQLite and browser WASM retention;
- dataset acquisition ignoring misleading operation columns and excluding the
  requested operand tuple, source dependency invalidation, and search budgets;
- fetch bootstrapping through ordinary code learning, new-URL execution, supplied
  .ncon and JavaScript realizations, const/await/text() lowering, checks, conflicting
  implementations, unsupported code rejection, and inert remote executable text;
- public URL restrictions, redirect revalidation, source byte/HTTP limits, and
  retrieval without forwarding visitor authentication.
- research question forms learned through normal labelled lessons, lossless text
  slots, discovery of an opaque property and entity, context-based alias selection,
  conflicting entity clarification, whole-question search, attributed excerpts,
  source qualifications, ended-claim exclusion, source revision invalidation,
  request budgets, failure/recovery, and SQLite/browser WASM reopen;
- actual chat controls using the retrieval transport to learn and display the
  reported capital question, its citation, and its retained fact in Knowledge.

The phone layout puts chat first, collapses settings, scrolls conversation history,
keeps the composer visible, uses 44px controls, 16px form text, safe-area padding,
and wraps long code/URLs. A browser-control plugin is not available in this
environment, so visual browser QA is unverified. A private-site browser attempt
reached a sign-in wall; no user credentials or access policies were changed.
The shared runtime and actual SQLite WASM storage backend are tested directly.

`npm run check`: parses and round-trips 140 authored declarations and validates
required boot behavior. `npm run demo`: runs the teaching/generalization/reward/
holes/pun/reinterpretation workflow without network access.

## Live source check

A fresh online runtime queried the external ChrisMcCormick/basic-arithmetic corpus
through the documented Hugging Face rows endpoint. It retained nine relevant
input/output observations, inferred a unique addition program, and answered
`what is 2 plus 2?` with `4`. The requested operand tuple was excluded. No arithmetic
construction or answer was loaded beforehand. An earlier search-endpoint request
timed out; the retained job recorded the failure. The rows endpoint succeeded.
This verifies learning from structured internet observations, not arbitrary prose.

A fresh online runtime answered the reported `What is the capital of hi?` through
the live Wikidata API, resolving its source alias to Hawaii and its capital statement
to Honolulu. The same procedure answered `what is the population of hi?`, preserving
the source's 2020-04-01 qualification rather than presenting that count as current.
Live Wikipedia search and introductory extraction for photosynthesis also succeeded.
These checks used real external responses; automated source tests remain fixtures.

## Current limits

The chat interface is a bounded learning prototype, not a general conversational
agent. The default seed contains runtime concepts, source configuration, greetings,
and a fetch code example, not a complete English lexicon or grammar. A
new source word can become known while its sentence still lacks a construction.
Raw Wiktionary wikitext and HTML remain unparsed. Familiar plain-text/source
passages now use the shared reader; arbitrary prose understanding remains unfinished. Wikipedia
introductions can be retrieved, cited, and reused, while structured Wikidata
statements become qualified, retractable facts. Source aliases must match exactly;
misspellings and missing aliases can fall back to attributed search excerpts.
General
English parsing, implicit discourse role completion, typo candidate generation,
novel pun discovery, frame adapters, multilingual generation, full HTML section
selection, and shell/file tool execution are unfinished. Supplied JavaScript has a
defined subset; loops, classes, arbitrary imports, DOM access, and full JS semantics
are not supported. Code teaching needs an explicit meaning and parameter pattern.

Labelled examples align unique known referents, literals, or URLs into slots. Known
entities require one direct kind. Numeric program induction requires at least two
distinct input tuples and exactly one fitting candidate under its search budget.
It uses two to four numeric inputs, each once, and registered binary primitives.
These are bounded hypotheses, not proof of correctness on every possible input.
Multi-type lessons, morphology, broad semantics, and general autonomous rule
discovery require further learning mechanisms.

Source assertions are attributed, not independently fact-checked. Cross-source
identity merging and fine-grained property conflict resolution remain future work.
Retracting one merged support can conservatively invalidate a reading until another
pass reconstructs it. Scores are hand-authored ranking functions, not calibrated
confidence. Reward supports one selected procedure, not delayed multi-action credit.

`Exist` must be called by the CLI/API or a surrounding application. It performs
bounded work; there is no autonomous always-running service. One instance should
own a database. Export contains active assertion records, not inactive audit history
or the persistent job table; full-store retention is in SQLite.

## Notation and clarification (0.7)

Eight added tests exercise the reported Roman numeral request with source-sense
acquisition and checked code learning; unseen additive/subtractive numeral forms;
the bare `Roman Numerals` follow-up retrying an existing observation; a separate
context-dependent letter notation using exactly the same mechanism; profile and
immediate-turn isolation; invalid/lowercase/protected text; helper retraction;
actual browser SQLite snapshot/reopen with retained clarification links; and
untrusted reader/hint/code rejection. The DOM integration test submits Roman
notation and a two-message context clarification through the actual chat controls,
checks their answers and the visible target question, and verifies offline reuse.

A fresh local shared runtime using real external responses through the private
Site retrieval Worker answered `what is VI times 3?` with `18`. It learned the
checked Roman reader and multiplication implementation from authored starter
material, and acquired the meaning of `times` from live source evidence, in that
one request. Three source requests were made. With online acquisition then disabled,
it answered `what is IX times 4?` with `36`, `what is XIV*2?` with `28`, and
`what is VI times VI?` with `36`, without additional requests. These checks are
separate from fixture tests and do not claim the notation algorithm was discovered
from web prose. Canonical uppercase numerals from 1 through 3999 are supported;
free-form clarification interpretation and notation variants remain unfinished.


## Shared request learning (0.5)

Nine new tests cover acquiring competing senses plus a spelled-out number, selecting
roles, learning a checked realization and executing within the same request; unseen
inputs without further network calls; isolated-word ambiguity; a non-math concept
through the identical worklist; failed checks with persistent implementation work;
source and code retraction; refusal to re-teach withdrawn code; acquisition bounds;
native SQLite reopen and actual browser SQLite WASM snapshot/reopen; and rejection
of untrusted frame/code-lesson installation. The workbench DOM test now submits a
symbol expression, sees its answer and learning steps, and checks offline retention.

A fresh runtime using live Wikidata/Wiktionary responses learned the aliases and
quantity behind `what is 5 times three?`, learned the starter multiplication
implementation through the ordinary checked JavaScript learner, and answered `15`.
It then answered `what is 5*4?` (`20`), `what is 3 times 3?` (`9`), and an unseen
`what is 37 times 19?` (`703`) without further source requests. These are live-service
checks in addition to fixtures. The small frame/implementation teaching materials
are authored bootstrap, not discoveries from Wiktionary prose or stored answers.


## Direct relationship answers (0.6)

Ten added tests cover the reported action question, another multiword title,
opaque relations/kinds/entities, source subclass proofs and their retraction,
competing films, kind mismatch, type-search budgets, copular question precedence,
invalid lesson capture limits, unavailable unrelated homonym ancestry, and avoiding
instance/meta-class confusion even on a repeated request. Real API checks through
the private Site retrieval Worker returned `Jaws · director: Steven Spielberg.`
with seven source requests, then `Jurassic Park · director: Steven Spielberg.`
with two more requests. The retained Jaws answer was available offline.

Early live checks exposed unnecessary ancestry traversal and external HTTP
429/502 failures. Retained positive type evidence now avoids that unrelated work;
source failures remain saved investigations. The final live source checks succeeded.
The implementation extracts structured Wikidata claims and does not claim to have
learned those facts by reading arbitrary Wikipedia prose.

## Source learning, guidance, and subject correction (0.8)

Nineteen added tests cover nine subject-correction/measurement cases, six shared
evidence-reader cases and four cross-domain guidance cases. They verify ambiguity
and supplied kinds, completed-answer correction and rejected cache retirement,
source-generated kind hints, chained corrections, source units and quantity facts,
untrusted metadata rejection, and browser SQLite retention. Source reading tests
teach one language construction, read multiple unrelated source statements, query
new meanings, reuse typed user assertions, revisit old text after learning, preserve
exact offsets, retain unresolved/contradictory readings, isolate profiles, retract
supports and refuse to execute source instructions/program text. Guidance fixtures
use an opaque relationship ID and unknown problem names; they cover related
properties, unused-claim retention, pagination, budgets and rephrased offline reuse.
No cut answer, ship dimensions or source-method table is bundled in the runtime.

A fresh shared runtime using actual external responses through the private Site
Worker answered `How big is the Disney wonder?` with source draft 8.0 metre, length
294.0 metre, gross tonnage 84130 and beam 32.2 metre in four requests. `No the boat`
retried the original question with the kind constraint; offline resume reused it.
The live name was uniquely grounded; the competing-series choice is fixture-tested.

A separate live runtime researched `I got a cut what should I do?` in seven
requests and returned the source's handling relationships to bandage and suturing
technique. `I have a software bug what can I do?` used three additional requests
and returned debugging and a qualified software-update statement. Across these
requests it retained 901 source statements, including unused claims. Rephrasing
the cut request as `what should I do about cut?` with online acquisition disabled
returned retained relationships with zero additional requests. A live conflict
request encountered external HTTP 502 and remained a saved investigation; that
case was not claimed as a successful live answer.

These are source relationship answers, not personalized procedure selection.
Choosing which method applies, finding arbitrary instructional sections, learning
unfamiliar grammar entirely from web prose, and indefinite investigation remain
unimplemented. The shared reader processes at most 64 sentences in one read.
The interface changes only add research progress/checkpoint saving; existing mobile
styles remain in place. No visual phone/browser QA was available in this environment.

## 0.9 independent-first proposal learning (2026-10-10)

- Final regression suite: **136 tests passed**, including the lexical
  anti-memorization case and independent-first workbench settings.
- `npm run check`: 144 concept declarations and required behaviors validated.
- `npm run demo`: lossless input, generalized constructions, reward updates,
  unresolved roles, simultaneous meanings and revision still work.
- New deterministic tests cover a previously unseen operation, same-request
  execution, reopening SQLite and offline transfer, atomic rejection of failed
  checks, effect rejection in an untested branch, core-policy protection,
  source-span attribution including incidental facts, retraction/counterexamples,
  bounded validation repair, renamed withdrawn proposals, provider failures,
  source-before-teacher ordering, and successful independent learning with no
  Gemini call. Source/provider responses in these tests are fixtures.
- Live internet check, fresh notebook: `what is 9 times three?` acquired source
  senses, checked the implementation lesson, and answered **27** with **zero
  Gemini calls**. With network disabled, `what is 14 times three?` answered **42**.
- Live internet + Gemini check, fresh notebook: Pocket attempted composition and
  lexical acquisition first, then accepted one checked teacher proposal for
  `what is 7 percent of 80?` and answered **5.6**. Network disabled afterward:
  `what is 15 percent of 60?` answered **9** from retained concepts. No percentage
  question or answer was added to the application or its starter packs.
- The actual browser SQLite engine and DOM workbench tests remain in the suite.
  New controls expose teacher enable/disable, original proposals, needs and
  correction withdrawal. Mobile CSS keeps the new correction fields at 16px and
  buttons wrapping with at least 44px touch height. Visual mobile browser QA was
  unavailable: this managed environment has no supported control-browser skill.
- Consistency tests are not semantic truth proofs. Model interpretations can be
  wrong, available operations remain bounded, and requests outside learned
  coverage can remain unresolved. Public proxy rate limits may pause teaching;
  independent learning and retained execution continue to work.

### 0.9.1 assessment follow-up

Four additional tests verify high estimates for checked execution with no teacher
call, low estimates for missing answer roles, failed fetch assessment without
teacher use, and separately retained critiques without invented facts or reward.
Final updated suite: **140 tests passed**; `npm run check` validated **153**
concept declarations and the demo passed. Visual browser QA remains
unavailable; shared browser SQLite and DOM interaction coverage are retained.

## 0.10 persistent trace and process review (2026-10-10)

- The 146-test suite passed, including retained decision/capability traces,
  SQLite reopen, withdrawal with inactive-history export, old browser database
  migration, explicit reviewed learning that transfers offline, diagnosis evidence
  validation, clarified context in reviews, and unexpected execution failures.
- Existing browser DOM coverage now checks decision traces, review controls and
  the learning-history export control; restored browser backups contain trace rows.
- Live Gemini review of a fresh `what is 5*4?` request returned an adequate-answer
  review without unnecessary concept installation. Its review and 14 runtime events
  were retained. Transfer and error-repair review tests use provider fixtures.
- Declaration check: 153 concepts; demo passed. Final packaging repeats checks
  after the last withdrawal-history adjustment, then builds the hosted app.
- JSON exports include all trace events, active/inactive records and all jobs.
  SQLite backups remain the supported restore format. Automatic schema migration
  does not erase knowledge. UI previews are bounded; exports preserve full history.
- Visual mobile browser QA remains unavailable in this managed environment.
  Existing responsive layouts, wrapping buttons and 44px controls are retained.
