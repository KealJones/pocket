# Pocket verification — 0.12.2

This checkpoint is a research runtime, not a claim of general English or
LLM-equivalent comprehension. No new question-to-answer table was added.

## Automated evidence

195 tests passed; the concept/boot check validated 197 declarations. The demo
and production build also completed successfully.

The full suite covers the Node runtime, the actual SQLite WASM browser engine,
notebook reopen, and the DOM workbench. Independent tests disable both Gemini and
network acquisition. Source fixtures are deterministic contract tests, not proof
that live services are always available.

- Contextual spelling proposals retain the exact observation, respect protected
  regions, preserve equally fitting alternatives, and keep unmatched words.
- Explicit confirmations become profile-scoped, retractable form relationships;
  they transfer through different existing constructions and preserve senses.
- Corrections require an applicable previous reading. Replay cannot borrow future
  turns or another profile's context.
- A complete article fallback leaves interpretation work open and allows better
  source/example-based learning before answering.
- Empty successful lexical lookups are briefly reused; errors and configuration
  changes remain retryable.
- Progressive evidence reading reaches later passages, rotates unresolved work,
  queues missing senses, and revisits earlier meanings after language changes.
- A newly ambiguous source reading withdraws its attribution and dependent answer.
- Optional teacher identity errors receive specific validation feedback. Unsafe
  redefinitions remain rejected; corrected proposals can transfer teacher-off.

## Live observations on October 10–11, 2026

A fresh teacher-off notebook answered `Who directed the movie Jaws?` with
`Steven Spielberg` from Wikidata. A later offline request reused that answer with
zero network calls. A Disney Wonder investigation initially hit HTTP 429; the
follow-up `no the boat` recovered the cruise ship and its source measurements.
The capital-of-HI request also hit HTTP 429 and remained pending rather than
inventing an answer. Values reported here are source observations, not defaults.

Gemini's configured proxy produced a successful short greeting, HTTP 504 on
larger teaching requests, and intermittent upstream HTTP 503 responses. Its
existing Gemini 3.8 Flash model and Secrets Store binding were retained. Server
thinking is now `low`, upstream timeout 60 seconds, client timeout 75 seconds;
requests remain bounded. One live proposal was rejected for attempting an invalid
identity definition; its retry encountered a provider failure. That run did not
prove learned transfer. A final live `army clock` run succeeded after the validator identified the
retained `TwentyFourHourTime` identity that the proposal attempted to redefine.
The corrected alias passed checks, answered `16:39`, and then transferred to
`army clock?` with Gemini and network acquisition off, without another model call.
The tests also verify validation repair and offline transfer with a controlled teacher. Live service failures are retained in the
learning trace, including safe numeric upstream status.

## Phone interface

The workbench test exercises real controls, shared runtime, SQLite and IndexedDB,
including the new confirmation button. The existing phone layout uses dynamic
viewport height, safe-area spacing, wrapping evidence/code, 16px inputs and 44px
controls. No visual browser automation was available in this session, so this is
not a new screenshot-based iOS validation.

## Remaining limits

Arbitrary prose still needs adequate learned constructions and semantic evidence.
Dictionary text is not automatically a reliable role frame or executable program.
HTML needs a structural reader. Dictionary markup now has a conservative structural
reader; the progressive sentence path handles plain-text sources and excerpts. The code learner handles a restricted
checked subset, not arbitrary program synthesis or conversion. Episodic ranking
and orthographic distance are mechanical models, not neural attention. Reading
fingerprints conservatively reconsider more evidence than necessary. Learning
runs during requests/investigation cycles while the browser notebook is open;
there is no server learning daemon, general consolidation or automatic forgetting.
Provider availability and rate limits remain external constraints.

## 0.13.0 independent dictionary experiment

New tests exercise one request learning an opaque surface through a second
unfamiliar dictionary term, composing a retained role frame, checking its
implementation, and executing it without a teacher. The resulting knowledge
transfers to a different argument after actual browser SQLite reopen, offline.
Other checks cover exact source spans, language scope, conflicting senses,
unknown templates, negation, inflection, cycles and source withdrawal.

A live experiment deliberately returned an empty Wikidata search for `times` to
force the new path. All Wiktionary and subsequent Wikidata retrievals were real.
Pocket read the real `times` definition `To multiply`, investigated `multiply`,
bound the source identity to a retained concept and answered `what is 5 times 3?`
with `15`. It then answered `what is 7 times 4?` with `28` offline, with zero new
network calls. This proves a constrained bridge plus frame/realization reuse;
it does not prove arbitrary prose-to-program synthesis. A Gemini architecture
brainstorm timed out with HTTP 504 and supplied no implementation ideas.

## 0.13.1 conversational learning

Tests teach a personal form whose definition references an unfamiliar dictionary
term, acquire that term within the same request, and use the resulting frame with
a new argument offline. Definitions stay within their speaker's profile, and
withdrawal invalidates derived answers. Replay does not reinstate a withdrawn
assertion; a new explicit statement can reteach it. Missing references remain
queued even offline, and later evidence can resolve the retained definition.

An actual browser SQLite test observes the clock, teaches `army clock means
military time`, verifies teaching did not change the clock, uses `in army clock`,
and reopens the notebook to reuse the phrase without network or Gemini. Tests
also retain conflicting definitions and keep protected code inert. A direct
runtime probe produced `04:39 PM` then `16:39` through that sequence.
