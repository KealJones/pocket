# Architecture

## Representation and identity

`.ncon` parses directly into a concept expression `{head,args}` plus literals and
variables. There is no separate semantic AST that discards source details. That
small object representation is the in-memory IR, graph payload, and executable form.
Text input has its own `Input` concept containing the untouched source and a list
of `Occurrence` concepts with raw text, kind, spans, and protected-region status.

The graph separates identity from occurrences and assertions. `Greg()` can identify
a person; an occurrence of `Greg` is evidence that may refer to that person or to a
name. An unknown occurrence does not mint a global semantic identity. Source entities
get local `C_...` identities plus `External` links; Wikidata identifiers are not the
project's identity authority. Human-readable labels are welcome and have no special
language semantics. The supplied source pack requests English; multilingual grammar
and cross-source identity reconciliation are not yet implemented.

Each persisted record has a content-and-support identity, source, active state, and
dependency links. Independent assertions can coexist. Retraction propagates through
those links; it does not erase an original episode. Alternatives merged into one
reading currently have conservative combined dependencies: losing one support can
invalidate that reading, which a fresh pass can reconstruct from remaining evidence.
The store is not yet a full disjunctive truth-maintenance engine.

## Runtime boundary

The evaluator recognizes six structural operations:

| Operation | Runtime responsibility |
| --- | --- |
| `Quote` | Bind variables while retaining unevaluated expressions |
| `Native` | Invoke an installed capability by exact name |
| `Let` | Establish a local binding |
| `If` | Choose a branch when the test realizes to a boolean |
| `Sequence` | Evaluate expressions in order |
| `Each` | Evaluate a body for each list value |

All other executable behavior is matched against authored `Realization` relationships.
Context requirements narrow rule applicability. Equal-specificity conflicting rules
produce `Alternatives`; no rule produces a residual expression. Evaluation has
depth/step limits and detects repeated-expression cycles.

`ProjectCore` and `StoreBase` are shared between environments. The Node wrapper opens
built-in SQLite and reads pack files. The browser wrapper opens SQL.js SQLite WASM
and loads those same pack files over HTTP. Both share the same schema, dependencies,
identity algorithm, and learning/evaluation methods. Browser identity hashing uses
the audited Noble SHA-256 implementation; it matches Node byte for byte.

The workbench persists complete SQLite snapshots in IndexedDB after operations.
The interface and source live in the hosted project, while notebook data stays in
the current browser. Browser backups contain jobs and audit history as well as
active records, unlike the narrower `.ncon` assertion export. Supported browsers
use a Web Lock to prevent two tabs from editing the same notebook at once.

Host code still provides token capture, pattern matching, example alignment, graph
storage, scheduling, HTTP, source format adapters, and the CLI. This boundary is
explicit: v0.1 is not a claim that every algorithm is already written in `.ncon`.
The kernel pack authors reward arithmetic, ranking, learning/interpretation entry
points, operating budgets, and output behavior. An important next step is expressing
more agenda policy and generalization transformations as concepts.

Installed capabilities are exact mechanical interfaces, not arbitrary host evaluation.
There is no `eval` of JavaScript strings, no shell executor, and no automatically
installed executable behavior from web evidence. File editing and script execution
would require explicit installed capabilities and reviewed concept realizations.

## Hearing and proposing

1. Capture the exact input and record an `Episode` with profile and context.
2. Build an indexed lattice of all known spans within the configured span budget.
   Multiple phrases and senses can overlap; normalization affects comparison only.
3. Match authored/learned constructions against the whole input. Slots use graph
   type proofs or primitive constraints; literals preserve glue words. Quoted/code
   spans are protected from ordinary slot binding.
4. Keep candidates with their meaning, roles, score, selected procedure, evidence,
   and missing holes. Ranking uses the `.ncon` `CandidateScore` realization.
5. Retain unknown lexical/composition/interpretation jobs. Acquire within a budget
   when enabled, then propose again if evidence changed.
6. Persist a `Reading` supported by the episode, lexical/construction/type evidence,
   reward evidence, and interpretation policy.

The interpreter is a bounded construction matcher, not a general grammar parser.
Construction matching uses a global state budget across rules and a candidate cap.
Budget exhaustion always prevents reporting a resolved result. Slot holes remain
learning work. A sufficiently separated complete candidate reports `Resolved`;
close alternatives report `Ambiguous`. `JointInterpretation(A(),B())` means both
are intended; two unresolved candidates mean we have not decided.

Meaning is not inferred from thematic proximity alone: 'band', 'played', and 'set'
must participate in a licensed construction. Negative/hypothetical constructions
are learned separately; the system will not silently reuse a positive sentence
pattern that does not cover their words.

## Learning

`LearnExample` takes original text and a labelled concept meaning. It aligns known
zero-argument referents to unique spans, replaces them with typed variables, and
retains all other units as literals. It refuses ambiguous alignment or ambiguous
direct types. A lesson and supporting referent/type assertions support the new rule.

This generalizes 'Greg returns the book' to 'Emmy returns the cookie' once Emmy and
Cookie have compatible known kinds. It does not learn English syntax, tense,
arbitrary paraphrases, or a new relation's semantics from one example. New unknown
names/kinds need grounded evidence first. The lesson supplies the intended meaning;
the system learns a mapping and its reusable slots without an LLM teacher.

`Learn` runs pending acquisition work. `Exist` runs a bounded acquisition tick and
revisits up to the same number of unresolved observations, least recently revisited
first. It creates new readings of old episodes, not new observations or fabricated
rewards. Jobs survive restarts and reopen if completed knowledge is withdrawn.
This is an explicit background-work call, not an unattended perpetual process.

Current source discovery uses `IsA(LearningSource())`. Adapter implementations map
source schemas to evidence. Wikidata supplies labels, aliases, descriptions, raw
entities, and configured unqualified properties. Qualified properties remain scoped
claims. Fuzzy search hits do not assert the search query is a synonym. Wiktionary
stores revision text and attribution; definition-to-concept learning is unfinished.
Unknown compositions require labelled examples or a future structured grammar/frame
adapter; repeatedly fetching pages does not manufacture understanding.

## Reward, attention, and truth

The authored default update is:

```text
prediction_error = obtained - expected
new_expectation = expected + learning_rate * prediction_error
candidate_score = evidence + 0.01 * expectation - 0.25 * missing_holes
```

Feedback names the chosen procedure/support record and profile. It never rewards
every concept in the sentence. Subsequent feedback depends on prior expectation
evidence and the arithmetic realizations. Removing that evidence invalidates derived
feedback/rankings. Successful parsing is not implicitly a reward. Explicit user
feedback is the initial outcome signal.

This is a simple incremental value update, not temporal-difference learning or a
biological dopamine model. A high reward must not establish that an assertion is
true. Source evidence, task utility, hypothesis ranking, and missing-information
work remain separate.

## Editing, persistence, and versioning

The boot manifest requires nonempty packs and named executable concepts. Changed
pack definitions retire dependent records atomically. Policy overrides are authored
concepts; competing overrides at one revision are errors, not arbitrary last-write
winners. Example:

```ncon
Concept(InterpretationPolicy(), Margin(0.2), Revision(1))
Concept(InterpretationPolicy(), Margin(0.3), Revision(2))
```

SQLite contains graph assertions, dependencies, a surface index, feedback, episodes,
readings, and jobs. `.ncon` export/import currently exports active assertion records
and their dependencies; queued jobs and inactive history remain in SQLite and are
not part of that export. Copy the database with the process closed for a full backup.
Version 0.7 supports one serialized project process per store; it is not a distributed
or concurrently coordinated learning service.

## Learning realizations and using code

`WorkedExample(original_input, observed_result)` is evidence. Numeric alignment
turns numbers into slots while retaining literal language. Bounded program search
composes `InductionPrimitive` capabilities and retained checked numeric procedures,
keeping only a unique normal-form program fitting all retained examples. It stores a `Construction`, `Realization`, and
`ValidatedProgram`, with dependencies on the examples, primitives, and policy.
Later counterexamples withdraw the old program and dependent replies. Source
acquisition uses the same `teachOutcomes` API as a user observation.

Version 0.11 discovers reusable two-parameter numeric realizations from checked
code examples, checked model proposals, and previously induced programs. Code and
model realizations need at least two distinct numeric execution checks. A helper's
entire active dependency graph must belong to the current profile and remain
available. Helpers are expanded into bounded numeric normal forms; equal wrappers
are deduplicated, while different programs fitting the same evidence remain
ambiguous. Stored implementations keep the concept calls and `ComposedFrom`
relationships, with dependencies on the original checks, helper declarations,
examples and policies. Retracting any prerequisite withdraws the composed procedure
and dependent answers. A procedure being revised, including its dependents, cannot
serve as evidence for its replacement. New checked code or model vocabulary
automatically revisits retained outcomes, and restored notebooks do the same on
preparation. The cache tracks evidence/vocabulary changes rather than ordinary chat
messages. Explicit withdrawals are retained as constraints on automatic revival;
a deliberate new outcome lesson can request a fresh derivation.

This is a finite extension of induction, not a general program synthesizer. It
currently aligns two to four numeric input slots and uses each input slot once in
the composition tree; a checked helper may internally repeat parameters or use
constants. Eligible helpers use finite numeric literals, arithmetic, lexical local
bindings whose values are used, and other checked helpers. Branches, effects, context-dependent rules,
conflicting/overloaded helpers, and circular calls are excluded from this search.
`InductionPolicy` bounds unique expressions (1024), reusable blocks (16), and
procedure inspections (128); structural expansion is limited to 256 nodes and
evidence traversal to 512 records. Exhausted expression search does not install a
guess. The retained `learning.program.induced` audit event records reused concepts,
examined expression counts and pending outcomes. These limits are host mechanics;
they do not map English words or question forms to operations.

The dataset adapter reads configured input/output columns from a bounded external
slice. It matches structural patterns, ignores operation metadata, and excludes the
requested numeric tuple. This is a configured source, not general web search or
arbitrary prose understanding. Dataset URLs and MIT provenance remain in the graph.

`teachCode` takes an example phrase, concrete meaning, parameter pattern, and code.
It learns the phrase through `teachExample`, then retains the supplied implementation
as a realization dependent on both code evidence and the language lesson. Optional
input/output checks run before installation. Original source and generated IR remain
linked. Conflicting equally specific learned implementations are not executed.

JavaScript code examples use Acorn parsing and bounded lowering into existing
concept operations. Supported functions, numeric arithmetic, const bindings,
await, fetch, and response.text() use registered semantics. There is no JavaScript
`eval`, DOM access, unrestricted import, or automatic execution of fetched code.
This is an explicit language subset and requires a labelled meaning; the system
does not infer a whole source file's intent without supervision.

Checked `.ncon` code can also use `If` and calls to existing realizations whose
bodies validate recursively against the same allowed capability set. Referenced
helper definitions become dependencies of the code example. Recursive helper
validation tracks visited rules; execution still enforces evaluator depth and step
budgets. This does not extend the JavaScript language subset or execute web code.

`StarterProcedure` is evidence consumed by this same code learner on first use.
The initial fetch example is `async (url) => await fetch(url)`. Its phrase learns a
protected WebAddress slot. Withdrawing the starter's evidence disables its derived
implementation; it is not silently re-taught. A changed seed has a new identity
and can be learned as a revision. Numeric word aliases are acquired from source evidence. Editable starter frames and
implementation lessons provide small grounded capabilities; observed outcomes can
also propose new procedures.

## Conversation and retrieval

Concept-authored `Respond` emits a retained `Reply`. Its dependencies include the
interpretation, validated implementation, response rules, and fetched documents.
The interface displays reply text and keeps concept diagnostics in an inspector.
The same SQLite engine runs in Node and in the browser through SQLite WASM.

The private Site's Worker transports bounded public HTTP GETs through a same-origin
endpoint. It validates destinations and redirects, rejects local addresses, limits
bytes/time, and never forwards visitor credentials. It performs transport, not
language interpretation. Personal graph data remains in the browser's IndexedDB;
the server does not silently synchronize notebooks across devices.

## Learning from research

`research.ncon` supplies labelled starter lessons rather than a fact table. The
ordinary `teachExample` learner aligns unique text arguments into explicitly
requested `Slot(capture="text")` relationships. These slots retain original text
and reject protected regions and numeric tokens; they do not silently interpret
unknown names or interfere with numeric program induction. More specific relation
question forms rank above a weak whole-question search form. New forms can be
taught through the same API and phone controls. Ranking remains a heuristic.

Concept-authored `RespondTo`, `ResearchFact`, and `ResearchTopic` choose research
realizations. The installed `Research` source adapter has explicit host behavior:
Wikidata property search, exact label/alias matching, entity snapshot retrieval,
property-presence filtering, preferred-rank selection, dated end-claim exclusion,
primitive/entity value rendering, and Wikipedia search/intro extraction. These
protocol and matching algorithms are implemented in JavaScript; moving them behind
a Native name does not mean the runtime learned arbitrary web comprehension.
There is no English property-word dispatch, fixed capital relation ID, stored
capital answer, or neural dependency in this adapter. `.ncon` configures source
endpoints/languages/licenses and request/time/cache policy. It also identifies the
external end-time and point-in-time properties used by the generic date filter.

Actual source responses become inert `SourceDocument` and `SourceEntity` snapshots.
Source-provided labels and aliases become locally identified, attributed concepts.
Requested statements become `KnowledgeFact` records with relation/subject/value,
qualifiers, rank, references, revision, and dependencies. The source alias plus the
requested relation filters competing referents: an alias is not accepted simply
because it was the first search result. Multiple remaining matches request context.
Changed snapshots withdraw old dependent facts and answers while retaining input.

`ResearchAnswer` caches a supported answer separately from question interpretation.
Cached property/entity definitions and snapshots support rephrased questions and
new relations without repeating all discovery. The default cache is 24 hours and
retained answers remain available offline. A pending research reply retains its
actual request log and persistent work item, and `Exist` can retry it and revise
the original episode. A syntactically resolved question can still have a pending
answer; the phone UI shows that distinction rather than claiming completion.

Wikipedia introductions remain attributed `SourceExcerpt` records. A closest
search result is labeled as such, not asserted as a precisely extracted fact.
Search and source protocol capabilities are installed, while learned language
forms, source bindings, snapshots, and facts are retained and revisable. Autonomous
invention of new research algorithms, open-ended prose inference, and reliable
arbitrary question answering are still future work.


## One request learning worklist (0.5)

`Learner` coordinates acquisition, frame learning, implementation learning, and
reinterpretation for all domains. A request keeps its exact `Input` and `Episode`.
The worklist favors unfinished work for this request over old agenda entries, and
retries the original input after each acquisition. `RequestLearningPolicy` sets a
12-pass, eight-job, 45-second limit. Source calls share the remaining deadline.
Missing implementations become persistent `realization` jobs; exhausting a budget
retains the work and never supplies an invented answer. `LearningRun` records the
steps and is visible in the reply inspector. Background `Exist` can retry these jobs.

`SenseIdentity(external_id, source=Source())` is a trusted, revisable grounding
relationship, not the system's own identity. An acquired source entity with that
external relationship proposes `Denotes(local_concept)`, supported by the source
snapshot and grounding declaration. Its original aliases remain alongside other
referents. Sources do not supply arbitrary executable definitions. An ordinary
word can still be ambiguous in isolation even when a role-compatible contextual
reading is clear. The Wikidata adapter additionally implements configured
`ValueMapping(property, Denotes(), datatype="quantity", unit="1")`: finite, exact,
unqualified quantities only, respecting preferred/deprecated rank and bounds.
It learns number words from source aliases and quantity claims, without a host
number-word table. Conflicting denotations remain candidates.

A trusted concept's `Frame(pattern=..., meaning=...)` is teaching material. When an
unprotected surface/sense becomes available, the learner installs its construction
with dependencies on both frame and lexical evidence. Primitive or graph type
constraints choose compatible roles; thematic proximity alone does not choose a
meaning. The host coordinates these stages and performs structural matching; it
contains no English operation-word dispatch. The frame schema and acquisition
adapters are still installed algorithms, not autonomously discovered algorithms.

`ImplementationLesson(pattern, language=..., code=..., checks=...)` is likewise
trusted, editable teaching material. When the selected expression has no matching
realization, the shared `learnRealization` API compiles it and requires at least two
execution checks before installation. This is the same code-evidence/validation
path as explicit `teachCode`, which optionally also derives a language construction
from its labelled phrase. A failed check installs nothing. Withdrawing code evidence
invalidates replies; the same withdrawn lesson is not silently re-taught. Revised
teaching material has a new support identity and can be learned again.

The starter pack supplies four scalar concepts, source grounding identities,
number-argument frames, conventional symbol surfaces, and short JavaScript
implementation lessons. It does **not** acquire their implementations from arbitrary
web prose. Word aliases such as `times` and number-word values such as `three` are
fetched lazily; the implementation lesson then passes through normal code learning.
A generic `RequestValue` question form is learned from an example placeholder of
kind `ComputableExpression`; it has no arithmetic-specific sentence or answer rule.
`expression.evaluate` evaluates the selected conceptual expression, tracks execution
supports, and returns a pending reply on residuals/conflicts/failures. Interpretation
still precedes execution. The same learner works for a non-numeric greeting-rendering
concept supplied through an authored frame/lesson and an acquired source sense.

This is a concrete shared learning mechanism, not unrestricted web-to-program
comprehension. Arbitrary dictionary definitions, FrameNet/VerbNet frames, source-code
intent inference, complex arithmetic precedence, and all-word questions that match
a topic fallback before a compositional frame is known still need further adapters
or lessons. Retrieved Wiktionary/Wikipedia text remains attributed, inert evidence.


## Agent-role relationship questions (0.6)

The ordinary lesson learner now accepts authored per-role `captureLimits`. It
retains these as structural `Slot(maximumSpan=...)` constraints, leaving source
observations intact. Opaque starter lessons teach an action, optional kind, and a
remaining multiword subject. One-token action/kind limits are explicit grammar
teaching material, not a host English parser. Copular `who is` lessons retain higher
priority over agent forms. `AgentRelationForm` proposes the passive suffix ` by`
in `.ncon`. The structured-source adapter accepts only actual property labels or
aliases, filters homonymous subjects by property presence and the supplied kind,
and records the resulting relationship with references and qualified claims.

The source adapter uses configured instance/subclass mappings. It first accepts
positive type paths backed by retained entity snapshots. When none is available,
it acquires ancestors within four levels, twenty nodes per subject, twelve source
requests and 45 seconds per investigation. After the initial subject classification,
only subclass edges widen a type: the ancestor's own instance-of meta-class is not
inherited by the original subject. Type evidence is a persisted dependency of facts
and answers. Already grounded positive candidates are used without fetching every
unrelated homonym's ancestry; source retrieval remains a bounded candidate search,
not a proof that no other referent can exist anywhere. Multiple currently supported
referents ask for context. Kind mismatch or search exhaustion retains investigation.

This adds a reusable question form and structured fact extraction. It does not
claim to infer arbitrary relationships from Wikipedia prose. The passive-form
proposal is limited English teaching material; irregular verbs, multiword actions,
quoted/punctuated/numeric titles, and multiword kind phrases still need further
lessons or lexical/frame adapters. Source identities and answers remain acquired
knowledge rather than fixed runtime cases.

## Notation and explicit clarification (0.7)

The single request learner accepts trusted `ReadForm(Reader($text), primitive=...,
recognizes=..., context=..., notation=..., fragmentOnly=true)` teaching material.
For bounded, unprotected word occurrences, it learns a missing reader through
`ImplementationLesson` and the ordinary code checker, then evaluates that concept.
A finite primitive result becomes a supported `DecodedValue`, containing the exact
spelling, profile, applicable context, and evidence. A residual or `NoReading()`
does not supply a value. Competing decoded values stay in the lexical lattice.
Fragment-only readings can fill a compatible construction slot but cannot resolve
a bare word on their own. No global surface synonym is asserted.

The host coordinates reader discovery and bounded invocation, checks primitive
values, stores proposals, and matches context structurally. The notation algorithm
is `.ncon`: the Roman starter validates canonical uppercase numerals from 1 to
3999 and composes a recursive digit/subtraction program. Its seven symbol values
and canonical format are authored teaching, not inferred from Wikipedia or a
VI-specific answer table. The reader is checked and installed on demand. General
text length, character access, and pattern matching are mechanical capabilities;
their availability does not imply unrestricted JavaScript comprehension.
`RequestLearningPolicy.MaximumDecodings` limits invocations to 64 within the same
45-second request budget. Withdrawing helper/code evidence invalidates decoded
values and dependent answers; unchanged withdrawn lessons are not re-taught.

A zero-argument meaning may have a trusted `ContextHint(feature)` relationship.
When that is the selected meaning of a fresh follow-up, the runtime can link it
to the immediately preceding unresolved observation in the same profile. The
persisted `Clarification` names both episodes and stores the feature with the
hint's evidence. `resume` merges active clarification features with the original
episode context, replacing earlier features of the same head, and reruns the same
learning/interpretation/execution flow. Original observations remain separate and
unchanged. The follow-up reply links to the retried question; the UI displays that
question. Retraction invalidates the replies that depended on the clarification.
Unrelated messages, other profiles, and already resolved preceding turns are not
automatic clarification targets. Arbitrary free-form clarifications and general
pronoun/discourse inference still need lessons or another mechanism.

## Shared source reading and relationship discovery (0.8)

`Learner.readEvidence` accepts plain-text `SourceDocument` and `SourceExcerpt`
records. It segments sentences (English locale currently), preserves the exact
`Input` and source offsets in `EvidenceObservation`, and uses the same lexical
lattice, frame activation, constructions, candidate score and margin as requests.
It invokes neither `Respond` nor an interpreted action. JSON, HTML and Wiktionary
wikitext are not claimed to have been interpreted by this reader. Up to 64 passages
per read are considered; comprehensive long-document processing remains unfinished.

`EvidenceReading` retains competing readings and their language evidence. Recognized
non-request meanings become `AttributedMeaning`, with source, license and original
sentence. Unknown passages enqueue `evidence-reading` work; a later request or
learning tick can revisit them after new language teaching. Document revisions
withdraw dependent meanings. Identical rereading does not retire an unchanged
reading or its cached answer. User meanings explicitly classified as `Assertion`
enter the same attributed-meaning store, scoped to their profile. Source request
meanings are excluded from assertions; a weak search construction cannot turn
a passage into a claimed fact. Neither attribution nor reward independently
verifies truth.

`RequestKnowledge(pattern)` asks the shared learner to match those meanings. A
`Hole(role=..., expected=...)` binds a structurally compatible value with a type
proof. Different supported values remain alternatives. Replies cite original
passages and depend on their readings; they do not execute a retrieved procedure.
Learning the language of a procedure still requires grounded language evidence,
not just storing its bytes.

The `.ncon` guidance seed composes encounter clauses and guidance/method request
phrases into `GuidanceQuestion(Situation(...))`. It is editable English grammar and
intent teaching, not universal grammar or autonomous induction. `GuidanceRelation`
returns a `RelationSelector` containing a source form and `follow=RelatedProperty`.
The host researches those forms, acquires property definitions and aliases, follows
configured source graph edges, and checks for usable statements on candidate
situations. `RelationBinding` and `RelationPath` retain those connections. The
handling-property ID, situation identities and resulting methods are not runtime
cases. The Wikidata `P1659` mapping is source-schema configuration for related
properties; source forms and question grammar remain `.ncon` semantics.

The shared source decoder retains **all** returned statements as `SourceClaim`,
with local relation/value identities, raw value types, rank, qualifiers, references
and revision. It is used by lexical acquisition and relationship research. This
is attributed graph data, not an assertion that every statement is presently
applicable. Current-answer extraction excludes deprecated/ended statements and
preserves remaining qualifications. Related source fields are evidence candidates,
not a proof that a method fits a person's circumstances. Missing relationships
can retrieve an encyclopedia passage, but that fallback remains pending.

The host still implements source transport/schema decoding, traversal, cache and
answer extraction. It is not only an evaluator. Searches examine up to four pages
of fifty hits; related properties are bounded at 24. An unfinished search reports
its boundary. Research now allows 32 requests/180 seconds. The browser saves
acquisition checkpoints and shows retained evidence counts while awaiting a reply.
There is no unbounded/background research service, general web-search provider or
required teacher LLM.

## Subject correction and measurements (0.8)

`ContextFor(meaning)` can produce `ArgumentHint(name,value)` context. Only concepts
that declare the corresponding `ContextualArgument` accept the binding. Explicit
`Correction` meanings can revise a completed adjacent answer; ordinary context
hints still require a pending turn. Chained corrections follow the prior reply's
clarified target within the same profile. A `RejectedReply` retires the rejected
reply/query cache while leaving observations and source facts intact. All derived
results depend on the clarification and kind/type evidence. A bare “the <kind>”
lesson is scoped to `AwaitingClarification` and has low weight, preserving title
readings such as The Set. Source-offered type labels become supported context hints.
The authored boat-to-watercraft broadening applies within this correction context.

Measurement questions use authored size facet forms to match acquired property
labels/aliases; quantity values and unit entities come from actual source claims.
Multiple exact referents require clarification before measurements are selected.
Typed topic research follows the grounded entity's encyclopedia sitelink. A weak
Wikipedia search preview stays pending and is not cached as an answered question.

## Independent learning and optional proposal teacher (0.9)

Pocket's own request learner runs **before** the optional Gemini teacher. It
captures input, records explicit `Need` relationships (sense, construction,
alternatives, missing roles), revisits evidence, learns from source examples,
acquires senses, binds frames, decodes notation, and checks implementation lessons.
Its `LearningRun` and `NeedStatus` retain hypotheses and dependencies even when
Gemini is absent. Research realizations also get their source attempt first.
Known constructions, source-learnable examples and retained realizations do not
need Gemini. `online=false` also disables the teacher; the separate UI teacher
switch leaves independent online source learning enabled.

When a gap remains, `LearnMissing` in `model-learning.ncon` authors the proposal →
validation/retention sequence. The host supplies HTTP transport, detached graph
validation, bounded parsing and pure execution checks. The default browser uses
the public, rate-limited Cloudflare proxy; the provider key never reaches the
client. The question, up to four recent observations with their actual committed
readings and replies, selected notebook definitions, source excerpts and
counterexamples are sent to Gemini. Node usage is opt-in with
`new Project({teacher:{}})`. No dependency on Gemini is introduced into evaluation
or persisted notebook loading.

Version 0.11.2 retrieves related definitions from graph links seeded by current
lexical/candidate meanings, prior committed meanings and memory kinds. Direct
definitions precede incoming links; incoming retrieval is limited to low-degree
symbols to avoid expanding through general wrappers. Syntax operators are excluded
from graph navigation. The host retrieval budgets are 32 records, 22,000 definition
characters, six hops and reverse degree four. Related declarations retain whole
parts rather than arbitrary string suffixes, and supplied profile restrictions
are respected. This is a bounded retrieval heuristic for supervision, not an
independent natural-language interpreter. The packet reports truncation and shrinks
related definitions by whole records if the proxy byte budget requires it.
The supervision memory packet orders objects by actual recent attention and carries
the newest binding for each relation, rather than choosing versions by hash order.
It contains at most eight objects and six current relations per object. Partial
graph declarations are marked, so the packet does not imply it lists every rule.

Alternate spellings can be learned as profile-scoped surfaces denoting existing
concepts. Typed constructions then bind those meanings without replacing input.
New follow-up constructions can reuse the same object workflows; after validation
the original episode is retried, and persisted learning runs with the teacher off.
An authored bound-value requirement reduces assessment of a generic correction
that asks about an irrelevant earlier subject without answering the request.
Known complete generic readings can still suppress independent sense acquisition;
typed contextual eligibility and a broader repair lattice remain unfinished.

A response is a `LearningHypothesis`, not executable authority. It can propose
new namespaced concepts, surfaces, typed constructions, pure `.ncon` realizations,
and attributed source readings. Before any installation, a detached overlay checks
variable bindings, allowed relationships, example interpretation, multiple execution
checks per implementation, and exact source-quote containment. Reachable helpers
are inspected too: an untested branch cannot hide an effect. The validator cannot
replace core concepts, policies, or capabilities. Rejected proposals can receive a
concrete validation error for one bounded repair attempt. Transport failures retain
the need without immediate retries. Installations happen atomically after checks.

These are **consistency checks, not independent semantic proof**. Model-generated
checks can share the model's mistakes. An exact quote proves provenance, not that a
proposed interpretation is entailed; model-attributed meanings are explicitly tagged.
The implementation does not claim that model confidence is truth. The learning
inspector exposes the original proposal and supports withdrawal with a correction.
`Counterexample` survives withdrawal; dependent concepts/readings/replies do not.
A renamed copy of the same withdrawn proposal is rejected. This fingerprint is
syntactic, not a complete proof of semantic equivalence.

After acceptance the original request is interpreted again. New constructions
can bind different arguments and run without either Gemini or source access.
Source statements can use the same learned assertion constructions as user input.
Additional supported source facts may be retained even when unrelated to the
current question; ambiguous facts remain competing attributed meanings. Responses
put the bound answer first and retain the supporting statement/citation.

Limits remain explicit: finite concept primitives and compiler support, bounded
construction search, finite request budgets, source coverage and public proxy rate
limits. Gemini does not add arbitrary host capabilities, guarantee general language
comprehension, or remove the need to improve independent induction and source
adapters. A failed learning request remains reviewable and resumable; it does not
pretend to have learned a behavior. The UI's revisit action can retry optional
teaching; the general background agenda remains independently bounded.

## Answer assessment (0.9.1)

Every response retains `AnswerAssessment`: relevance to its selected intent,
source grounding, execution completion and ambiguity. These are observable
heuristics, **not calibrated probabilities of correctness**. A bound value, a
checked realization and retained source relationships improve the estimate;
missing answer roles, failed actions and competing readings reduce it. A citation
alone does not establish relevance. Model-proposed interpretations remain labeled
as such even when their code passes execution checks.

`AnswerRequirement` relationships declare intent-specific obligations without
English question dispatch. `AnswerQuality` and the review threshold are authored
in `assessment.ncon`. The UI exposes the components and reasons. Assessment
records depend on the reading, reply, contract and scoring policy, so withdrawal
invalidates assessments that relied on withdrawn evidence.

With the optional teacher enabled, an unresolved or low-scoring response can
request a critique after Pocket's independent attempt. The response and assessment
join the evidence supplied to the ordinary proposal teacher. `AnswerCritique`
remains model opinion, separately retained; it does not create factual truth or
self-reward. Improvements must still pass the normal construction/code/source
checks and trigger a retry of the original observation. Failed HTTP actions are
assessed but do not ask Gemini to fix a transport failure.

The runtime handles existing conversational concepts and read-only actions such
as fetching pages. Checked code examples can become reusable realizations; pure
learned string procedures can generate templates. General program authoring,
conversion of arbitrary languages, unrestricted execution and general dialogue
understanding are not implemented by adding this assessment layer.

## Retained process trace and review (0.10)

SQLite schema version 2 adds append-only `trace_events`, indexed by episode and
request/review run. Opening an older notebook creates the table without erasing
knowledge. Events retain runtime observations: initial and final candidate
rankings, holes and supports; independent learning budgets and source-job choices;
selection margins and declared reasons; realization rules and actual capability
invocations, including nested evaluations; output assessments; teacher validation
failures, repairs and installed concepts; request retries and withdrawals.
These are observable decisions and configured rules, not hidden model reasoning.

Audit events have no truth-maintenance dependency on the concepts they describe.
Withdrawing a concept invalidates its dependent knowledge/replies while its
original trace and inactive record remain available for diagnosis. Display traces
are bounded and explicitly mark truncation; linked database records preserve
original observations. Each completed or failed run has an outcome event.

Optional Gemini proposals now receive a bounded trace from the current episode.
An explicit **Review this learning process with Gemini** action can also review a
completed response. It returns separately attributed `LearningReview` and optional
`LearningDiagnosis` suggestions, each diagnosis anchored to a supplied trace event.
New concepts/constructions/implementations still pass the existing detached checks,
are retained with dependencies, and retry the original observation. They can be
used without Gemini afterward. Reviews cannot silently replace core policies or
host code; host implementation defects can be reported as suggestions. A critique
is not proof, a factual assertion, or a reward.

**Learning history** exports JSON containing all trace events, active and inactive
`.ncon` records with sources/dependencies, and completed/pending jobs. **SQLite
backup** exports the full restorable notebook, including audit history. The JSON
is intended for inspection and analysis; it is not an executable import format.
CLI `:history("learning-history.json")` exports the same data. Export includes
personal input and retained evidence; the user explicitly controls downloading it.

## Episodic memory and attention (0.11)

Conversation objects use one graph: `MemoryObject(kind)`, versioned
`MemoryBinding(reference, relation, value)`, `MemoryAttention(reference)` and
`MemoryRetention(reference, "explicit")`. Every record is profile-scoped and tied
to a committed reading, its original episode, date, timezone, and applicable
realizations. Retraction invalidates derived memories and replies without erasing
the user's words. Native facilities create references, store/query relationships,
filter kinds and dates, and return unresolved alternatives. There is no shopping
list table, recipe session table, or host English question dispatcher.

`.ncon` defines kinds, item parsing, role bindings, workflows and `MemoryScore`.
The starter score ranks compatible attended objects by distance in conversation
turns. `MemoryPolicy` bounds the active focus window, retrieval candidates and
selection margin. Exact temporal lookup searches episodes regardless of focus.
Two lists from the same date stay unresolved rather than choosing the first one.
A recipe can become the immediate focus while a compatible list remains available
for a later addition. Creating a new list creates a distinct object; modifying it
creates a relationship version. Replaying a request doesn't reset a newer list or
move a relative birthday to today's date. Clock-format changes format the attended
clock observation; a new clock request observes the runtime clock anew.

Default objects are conversation memories, not installed general concepts or
permanent personal facts. An explicit remember instruction marks an object for
stronger retention and retrieval beyond the focus window. Conversation history is
still persisted in the local notebook, so an unpinned object can be retrieved by a
dated cue after reopening. There is no automatic deletion or memory consolidation
policy yet. Losing attention, remaining in episode history, explicit retention,
and generalizing reusable knowledge are distinct operations.

LLM attention suggests context-sensitive selection; complementary learning systems
research motivates separating rapid episode retention from reusable learned
structure. These are architectural inspirations, not a claim that the current
symbolic ranking reproduces neural attention or brain memory. Broad associative
retrieval, learned attention weights, replay-driven consolidation, semantic
similarity over arbitrary concepts and automatic memory compression remain work.
References: https://arxiv.org/abs/1706.03762 and
https://stanford.edu/~jlmcc/papers/McCMcNaughtonOReilly95.pdf .

The session pack provides editable starter frames for time, schedules, person
relations, collections and recipes. Generic collection workflows accept new kinds
and learned wordings. Optional teacher proposals can teach data constructions
using existing workflows; `LearnableType` marks permitted extension kinds. The
teacher cannot install memory mutations as executable code or source facts.
Source reading never executes the instructions it interprets.

Version 0.11.1 adds request-ending composition in `.ncon`: a question mark or
exclamation mark can wrap an already interpreted `Request` without replacing its
meaning. Format wordings bind a typed `TimeFormat` role, resolve its supported code,
and reuse the existing attended-clock workflow. A taught phrasing can transfer
across formats; a definition question about military time remains a topic question.
The original input, including punctuation, stays intact. New definitions are appended
separately so upgrading a notebook does not withdraw the earlier session definitions
that support its saved clock, list and person memories. No host dispatch was added.

A MediaWiki adapter reads configured ingredient and procedure sections, retains
raw text, revision, citation and license, and creates source-supported `RecipeFact`
records. It also submits the excerpt to the ordinary inert evidence reader.
Optional ingredients may be omitted when the source marks them optional and the
method does not still mention the exclusion. Mandatory substitutions require an
alternative source-supported recipe; they are not invented. Ingredient matching
currently uses literal text, not learned allergen/synonym reasoning. Acquisition
is bounded to six configured search candidates and the shared request deadline.
This adapter supplies structure from a source schema; it does not claim to discover
arbitrary instruction extraction or culinary semantics from prose.
