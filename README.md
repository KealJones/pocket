# Napkin Next

A new, learning-first implementation of Napkin's concept idea. Knowledge, authored
behavior, lessons, interpretations, feedback, and responses use the same `.ncon`
notation. The original Napkin repository is unchanged.

This is a runnable research foundation, with a deliberately small starting vocabulary.
It preserves messy input, proposes competing readings, learns reusable constructions
from examples, stores evidence, and revisits observations after learning. It does not
yet understand arbitrary English prose or automatically turn dictionary definitions
into executable knowledge.

## Run

Requires Node **22.13 or newer** with built-in `node:sqlite`. Acorn parses supplied
JavaScript code examples. Install dependencies for the CLI, browser build, and tests.

```sh
npm ci
npm test
npm run check
npm run demo
npm start -- --profile keal --offline
```

## Chat on your phone

Hosted privately at [napkin-next.youngsong3.chatgpt.site](https://napkin-next.youngsong3.chatgpt.site).
The complete project is versioned in the Site's source repository; its matching
source archive is available from **Download project source** in the interface.

The hosted chat runs the same `ProjectCore` as the CLI using SQLite WASM. Try
`what is the capital of hi?`, `what is photosynthesis?`, `fetch https://example.org`,
`what is 5 times three?`, `what is 5*4?`, or `what is 3 times 3?`.
Roman numeral notation is taught through a checked concept reader: try
`what is VI times 3?` or `what is XIV*2?`. Original text is retained; decoded
numbers are typed-slot proposals, not spelling replacements. A known context hint,
such as `Roman numerals`, retries the immediately preceding unresolved question.
One request worklist acquires candidate senses, applies grounded argument frames,
learns a missing checked realization, and reinterprets the untouched request before
answering. Source-backed meanings and learned implementations persist for later use.
Fetch and implementation lessons use the same code learner. Varied observed outcomes
can also propose implementations, with requested operands excluded from training.
Open a reply's inspector to see its interpretation and evidence. **Teach** accepts
observed outcomes, labelled meanings, and code implementations. **Knowledge** lets
you withdraw assertions. **Learning** investigates and revisits unresolved work.

Conversation follow-ups use shared episodic memory and attention. Try
`what time is it` → `in military time`, with or without a question mark.
`military time` and `in 24-hour time` use the same format concept; the follow-up
formats the clock observation in focus rather than searching for an article.
When Gemini is enabled, unfamiliar wording can be taught using prior readings,
actual replies and related concept definitions. Accepted aliases and constructions
remain in your notebook and can run with Gemini and internet learning switched off.
This does not guarantee understanding every unseen typo or idiom.
You can also try
`my best friend Greg turned 30 yesterday!` → `who is my best friend` →
`when is his birthday?`. Being 30 yesterday alone doesn't establish a birthday.
`lunch is at 12:30` can fill a later `what time is lunch at?` request.

Create `can you make me a shopping list with eggs, and chicken on it`, then ask
`how do you make whipped cream?`, `oh no like one without vanilla`, and
`oh and sugar`. Recipes retain source ingredients and steps; unsupported
substitutions remain unresolved. Lists are dated conversation objects, not
permanent knowledge. `what about that shopping list from yesterday?` retrieves
history; `remember this list` explicitly marks stronger retention. New lists
remain separate, and ambiguous dated references ask for clarification. Knowledge
shows episode memories and explicit retention alongside learned source material.

Research is a reusable learned procedure, not a capital-question answer table.
Starter lessons teach relationship and topic question forms through the normal
example learner. Text arguments preserve unknown names instead of prematurely
resolving them as words. Wikidata property search discovers the requested relation;
exact source aliases plus actual claims disambiguate the subject. The learner retains
property/entity definitions, statements, qualifiers, citations, revisions, and source
responses. Repeated or rephrased questions use the same retained evidence. Conflicting
matches ask for context. New source revisions withdraw dependent answers.

Wikipedia provides attributed introductory passages for topic questions and a weak
whole-question search fallback. A non-exact first search hit stays pending instead
of being treated as an answered question. An excerpt is explicitly labeled, not presented as a
fact the system independently inferred. Use the **Capture text arguments** option in
Teach to teach additional research question forms, for example `find capital for
Hawaii` → `FactQuestion(relation="capital",subject="Hawaii")`. The learner generalizes
both text arguments so the same form can ask about another property and place.
Research is limited to 32 requests and 180 seconds per investigation by the editable
`ResearchPolicy` concept. Cached source snapshots are reused for 24 hours; when online
is disabled, retained answers remain available. Source errors and unfinished work are
kept for retry. Reload revisits the latest unresolved observation using current knowledge.

Learning is retained in IndexedDB in that browser, not a shared server database.
Use **Backup** to download the full SQLite notebook and **Restore** to move it to
another browser. Clearing website data removes local learning. The source repository
and deployed interface are hosted separately from that personal notebook.
The private Site's Worker provides bounded public HTTP retrieval. The browser uses
its same-origin endpoint, avoiding source CORS restrictions. Authentication stays at
the existing private Site boundary. Visitor credentials are never sent to sources.

`npm run build` embeds the browser engine, SQLite WASM, concept packs, optional
curriculum, and source archive in `dist/server/index.js`, a Worker ESM deployment.

Leave out `--offline` to enable bounded dataset/Wikidata/Wiktionary/Wikipedia acquisition. The normal
CLI persists knowledge in `data/knowledge.sqlite`; use `--db PATH` for another store.
The public API defaults to an in-memory store unless given a path.

Try this in the interactive CLI:

```ncon
:load("examples/world.ncon")
:example("Greg returns the book", Returning(actor=Greg(), object=Book()))
Emmy returns the cookie
:reward(0, 8, expected=5)
:reward(0, 2)
Greg returns the book to
:agenda()
:exist(2)
:eval(Add(5, 2))
:export("knowledge.ncon")
:quit()
```

The example world is optional curriculum. It is never silently loaded into ordinary
sessions. Its exact banker-pun rule demonstrates simultaneous meaning; it does not
claim to discover new jokes automatically.

## The language

```ncon
Concept(Greg(), Surface("Greg"), IsA(Person()))

Concept(ReturningPattern(),
  Construction(
    pattern=List(
      Slot($actor, kind=Person()),
      Literal("returns"),
      Literal("the"),
      Slot($object, kind=Object())),
    meaning=Returning(actor=$actor, object=$object)))

Concept(Double(),
  Realization(Double($value),
    body=Native("number.multiply", $value, 2)))
```

Nested calls are direct concept expressions. Names are readable identities, not
English definitions. Positional arguments preserve order; named arguments bind
roles. Strings, booleans, finite numbers, and `null` are literal values. Variables
begin with `$`; comments use `//` or `#`; trailing commas are allowed. Triple-quoted
raw strings are available for evidence containing program text. Unicode and emoji
identifiers are supported, so `🖕()` is syntactically possible, though a readable
identity such as `TheFinger()` is easier to author.

`Construction` proposes a meaning from observed language. `Realization` specifies
how a concept evaluates. Authored interpretation alone does not authorize arbitrary
execution. A validated learned implementation can answer a recognized request,
including the explicitly requested read-only fetch capability. `:eval(...)` is an
explicit authoring interface for direct evaluation.

## What works today

- **Lossless ears:** original source, whitespace, punctuation, misspellings, emoji,
  quotes, code, and URLs retain exact spans. No article dropping or autocorrection.
- **Deferred interpretation:** overlapping word/phrase spans coexist. Personal
  spellings are evidence scoped to a profile, not irreversible substitutions.
- **Learning and retention:** a labelled example generalizes uniquely aligned known
  referents into typed slots. SQLite stores lessons and derived constructions.
- **Missing roles:** `Hole(role="destination", expected=Place())` remains explicit.
- **Revisable knowledge:** retracting evidence invalidates dependent lessons,
  feedback, and readings. Original observations remain available for another pass.
- **Bounded investigation:** unknowns queue persistent jobs. `Exist(2)` acquires
  evidence and revisits unresolved episodes, sharing attention across episodes.
- **Prediction error:** expected 5, obtained 8 gives +3; with rate 0.2 the updated
  expectation is 5.6. Feedback affects procedure ranking, not factual truth.
- **Source evidence:** Wikidata entities use local identities with external links;
  Wiktionary wikitext and HTML remain raw evidence. Plain text and encyclopedia
  passages enter the same lexical/frame reader as user input; recognized meanings
  remain attributed, while unrecognized passages retain interpretation work.
- **Program induction:** varied numeric outcomes select among bounded compositions
  of registered primitives. A unique fitting program becomes an evidenced `.ncon`
  realization. Contradictions withdraw it. Operation words have no host dispatch; source-backed sense relationships select concepts.
- **Source learning:** a generic dataset adapter reads configured input/output
  columns, ignores operation hints, and excludes the user's operand tuple. Sources
  are extensible concepts. The initial numeric corpus is external, not bundled answers.
- **Code examples:** labelled language plus a supplied JavaScript function or `.ncon`
  body can become a realization. Original code, derived IR, checks, and language
  lesson remain linked. JavaScript supports numeric arithmetic, simple functions,
  const bindings, fetch, await, and response.text(); unsupported syntax fails explicitly.
- **Notation and clarification:** authored `ReadForm` lessons install checked
  readers through the same implementation learner. Scoped decoded values carry
  their code evidence. `ContextHint` links a follow-up to the preceding unresolved
  observation in that profile, and resumes it without replacing either message.
- **Concept output:** `.ncon` authors `Respond` and `Speak`; chat shows natural
  replies and numeric results, with concept expressions in its inspector.

## Teach spelling without destroying evidence

```ncon
Concept(What(), Surface("what"),
  Surface("waht", profile="keal", weight=1.5))
```

This records Keal's stated `waht → what` preference. Other readings can still
compete when supported by constructions and context. The input remains `waht`.
Weights rank evidence; they are not calibrated probabilities or certainty scores.

## Programmatic use

```js
import { Project } from './src/project.mjs';
import { parse } from './src/ncon.mjs';

const p = new Project({ path: 'data/knowledge.sqlite', profile: 'keal', online: false });
try {
  p.load('Concept(Greg(),Surface("Greg"),IsA(Person()))\n' +
         'Concept(Book(),Surface("book"),IsA(Object()))');
  await p.teachExample('Greg returns the book',
    parse('Returning(actor=Greg(),object=Book())'));
  const observation = await p.turn('Greg returns the book');
  console.log(observation.spoken);
  await p.reward(observation.candidates[0].rule, 8, { expected: 5 });
  await p.exist({ budget: 2 });
} finally { p.close(); }
```

`teachOutcomes([{input,output}])` induces procedures from observations. It can
compose previously checked numeric implementations into new procedures, including
implementations acquired from Gemini, without asking Gemini again. It retains
helper dependencies so revisions invalidate the affected answers. Independent
search remains bounded; it does not synthesize arbitrary programs.
`teachCode({input,meaning,pattern,language:'javascript',code,checks})` compiles and
stores a supplied implementation and learns its phrase. This requires a labelled
meaning and registered capability semantics; it does not infer arbitrary English
intent from a pasted source file. JavaScript is parsed and lowered, never passed to
`eval` or `Function`. Numeric `+` in this subset uses finite-number arithmetic. The web code form accepts
optional `List(Check(input, output), ...)` checks. Two distinct numeric checks make
an eligible pure two-argument realization available for future independent learning.

`load` and `importRecords` are authoring interfaces for trusted local material.
Fetched source text stays inert: interpreting a source sentence never executes it. Online responses have request timeouts and byte
limits. `:read(URL)` retains raw evidence; it does not claim to understand HTML or
find an arbitrary requested section yet.

See [ARCHITECTURE.md](ARCHITECTURE.md) for boundaries and mechanisms,
[DESIGN_DECISIONS.md](DESIGN_DECISIONS.md) for the reasoning and research connections,
and [VERIFICATION.md](VERIFICATION.md) for checks and known limitations.


Agent-role questions such as `Who directed the movie Jaws?` now learn a direct
relationship answer from structured source claims. Opaque starter examples teach
`who <action> [the <kind>] <subject>`; an editable `.ncon` role realization proposes
a passive source form such as `directed by`. That form is accepted only when the
source supplies its exact property label or alias. Titles and answers are not
preloaded. A supplied kind is checked using retained source classifications and
bounded subclass paths. Multiple supported matching entities request clarification.
Learned relationships, type evidence, facts, and citations are retained and retractable.

## Shared evidence and guidance learning (0.8)

Try `I got a cut what should I do?`, `I have a software bug what can I do?`, or
`how can I handle a software bug?`. Editable `.ncon` language lessons compose a
situation with a request for guidance. A relationship selector asks the source for
its handling/mitigation relationship and follows the source's related-property
links. Situation entities, property IDs, aliases, connected methods and answers
are acquired, not bundled. These replies report source relationships, rather than
claiming to choose the right treatment or procedure for every individual situation.

All fetched Wikidata statements are decoded into attributed `SourceClaim` records,
including unrelated, historical and qualified statements. Applicability is checked
separately when answering. Source revisions invalidate dependent readings and
answers. Candidate searches follow pagination; an unexamined page budget remains
explicit rather than silently excluding other meanings. The phone interface shows
retained statement and interpreted-passage counts while researching and saves
checkpoints during acquisition. Repeated questions reuse retained evidence offline.

Source excerpts and plain-text pages use the same lossless capture, sense binding,
frames and interpretation as user input. Each sentence keeps exact document spans,
readings, citations and dependencies. Familiar statements become attributed
meanings; unfamiliar ones are revisited after new language evidence. This is not
a teacher model that invents mappings from arbitrary prose. `RequestKnowledge`
queries retained meanings with typed `Hole` roles and can answer from newly read
source passages or an explicitly typed user assertion. Source instructions cannot
execute; conflicting answers remain alternatives.

`How big is the Disney Wonder?` discovers quantity properties and units from
source metadata. The size facets are authored teaching, with no ship values or
property-ID table. Competing exact referents are named for clarification. `No the
boat` or `I mean the boat` retries the original question with a supported kind hint,
including after an incorrect completed answer; the original words remain intact.
The boat/watercraft hint is an authored contextual broadening, not a global synonym.

### Independent first, optional Gemini help

Pocket tries its own concept/source learning before asking a teacher. The notebook
settings have separate switches for online source acquisition and optional Gemini
help. Turn Gemini off to test independent learning; turn online access off to test
retained knowledge. No API key is entered in the browser.

The optional teacher proposes reusable `.ncon` concepts and pure implementations,
which must pass local checks before installation. Open **Inspect understanding &
evidence** to see needs, source attempts, proposals and checks. You can withdraw
learned proposals and retain a correction. Checks are consistency evidence, not a
promise that a model's interpretation is correct. The notebook and its learned
behavior persist in the existing browser backup format.

### Inspect and export the learning process

Open a reply's inspector to see **Decision trace**: recorded candidates, choices,
evidence, executed capabilities and outcomes. **Review this learning process with
Gemini** asks the optional teacher for diagnoses and reusable concept improvements;
checked improvements are retained and the original request is retried.

Notebook settings offer **Learning history** (readable JSON, including withdrawn
knowledge and review history) and **SQLite backup** (the complete restorable
notebook). Existing browser notebooks migrate automatically. CLI users can export
with `:history("learning-history.json")`.

### Contextual repair (0.12)

With Gemini and internet learning off, try `waht time is it` followed by
`militry tiem?`. Pocket proposes spelling readings against its retained concepts
and constructions, then uses surrounding typed roles and context to select a fit.
Your words remain intact. Inspect **Proposed spelling readings** to see the repairs;
no personal spelling alias is installed automatically. Ambiguous repairs and
unmatched words remain unresolved. Dictionary/article fallbacks no longer stop
independent acquisition just because their syntax parses. Successful empty lexical
lookups are reused briefly, while failed requests remain retryable.

To retain a proposed spelling, open its reading inspector and choose **Teach this
spelling for me**. The confirmation becomes a profile-scoped `.ncon` relationship,
not a global meaning replacement. For example, confirming `waht → what` transfers
through existing question forms; surrounding concepts still determine the sense.
Confirmed forms survive notebook backup/reopen and remain retractable in Knowledge.

Long excerpts and plain-text sources are read in progressive chunks. Unread
passages, unresolved meanings and missing vocabulary remain in the shared learning
agenda. Investigate/revisit continues that work, and newly learned language can
change earlier source readings and withdraw answers that depended on them. Work
rotates across retained documents and survives backup/reopen; fetching a page is
not itself evidence that Pocket understood every sentence. Background work still
requires the notebook to be open and a request or investigation cycle to run.

See [VERIFICATION.md](VERIFICATION.md) for checkpoint checks, live-service results
and remaining limits.

Pocket 0.13 adds independent dictionary learning: unfamiliar words can lead to
separate Wiktionary senses, explicit equivalent forms or short definitions, then
to another term investigated during the same request. Those supported links reuse
the existing concept/frame/checked-realization pipeline and survive offline.
The Knowledge tab shows retained source senses and lets you withdraw them.
This improves the learner; it does not require preloading a large vocabulary.
