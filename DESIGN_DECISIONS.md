# Design decisions and next experiments

## What stays from Napkin

Concepts are the vocabulary for data and behavior. Nested call notation remains
the authored form. Relations bind meanings and roles. Unknown realizations remain
expressions. Knowledge sources are concepts; evidence points back to its source.
The host evaluator stays small enough to audit. Most importantly, learning changes
future interpretation rather than just producing another answer.

The reference inspected was `kealjones/napkin` at commit
`8bc14b402d2ea5efdfe588342734c833572ab33f`. This is a separate implementation, with
no reference source files copied into the new project.

In the inspected ears, `hear` applied
`correct(expandBare(straightQuotes(message))).text`, and `read` used `dropArticles`.
Those are concrete places where interpretation could replace evidence too early.
The new capture step makes no such replacements. Correction, phrase recognition,
and personal usage enter as reversible candidates over preserved spans.

The original runtime also carried hearing/evidence policy in host infrastructure.
Here reward math, ranking, source configuration, operating budgets, and mouth behavior
are explicit `.ncon` definitions. Generic matching and scheduling still live in the
host; pretending otherwise would hide the same problem in a new place.

## What the conversations needed beyond semantic gravity

| Missing distinction | Design response |
| --- | --- |
| A written word versus a referent | Occurrences, surfaces, identities, assertions, and episodes are separate |
| Unknown versus unsupported interpretation | Persistent lexical/composition jobs retain the reason work remains |
| Alternative meanings versus intended plurality | `Ambiguous` differs from `JointInterpretation` |
| Source says X versus X is true | Source documents/entities and attributed mapped claims remain evidence |
| Useful behavior versus true claim | Reward affects a selected procedure's expectation, not assertion truth |
| Parsed input versus authorized execution | Interpretation returns meaning; explicit evaluation executes a realization |
| New knowledge versus new observation | Resume and `Exist` reinterpret the same episode |
| Plausible score versus probability | Scores rank candidates and never assert 100% confidence |
| All languages versus English aliases | Identity is language-independent; grammar adapters remain language-specific work |

The number of opaque IDs is not what makes a core universal. Changing `Dog` to
`C_123` does not remove assumptions about categories, roles, culture, or perception.
Readable names are useful. Relationships need defined operational behavior and
grounded evidence. A tiny vocabulary, including inspiration from Toki Pona, can help
authoring discipline but does not establish a universal ontology or solve grounding.

No fixed rule says a phrase must become an atomic concept. A phrase can be a
surface for a distinct entity, a reusable construction, an idiom, or several of these
at once. The exact article is retained. 'The set' can reference a title while 'the
set that band played' participates in a performance construction. Context must
license a relation, rather than merely sharing a broad domain.

## Neuroscience: mechanisms worth borrowing

The research connections are inspiration for engineering experiments, not evidence
that this implementation reproduces a brain.

**Prediction error:** Schultz, Dayan, and Montague's reward work motivates updating
expectations from an outcome's deviation from its expectation. The +3 example is
implemented as an ordinary concept realization. Delayed outcomes, action sequences,
eligibility traces, and credit assignment across a proof are not implemented. Negative
prediction error means worse than expected, even when the obtained reward is positive.
It is not simply the presence of negative language in a user's reply.

**Complementary learning systems:** McClelland, McNaughton, and O'Reilly's account
motivates separating remembered episodes from reusable regularities. The project
stores exact episodes and derived constructions separately. Retained observations
support revision; `Exist` provides bounded revisiting. One-example generalization
is currently provisional user-scoped evidence, not a demonstrated model of cortical
consolidation. Promotion across speakers and domains should require varied examples
and retained counterexamples.

**Attention and uncertainty:** allocate bounded work to unresolved evidence rather
than making every active word dictate every other word. The agenda shares work
across pending items; revisiting shares work across episodes. Attention priority
must eventually consider information gain, cost, relevance, and freshness. None of
those should be confused with confidence in an assertion.

## LLMs: lessons without a semantic dependency

Transformer attention offers a useful lesson: relations across a whole context
matter, and early local substitution throws information away. It does not imply
that a symbolic graph's distance or spreading activation is equivalent to learned
attention, or that importing dictionary words recreates a trained language model.

This version uses no teacher or local LLM. That respects the goal of learning in
concepts and keeping semantic decisions explainable. Learned embeddings could later
propose candidates, but they would need to supply proposals with independently
checkable evidence, never silently overwrite source or install behavior. No such
integration is included in v0.1.

The engineering lesson from modern language systems is also scale: broad grammar,
idioms, pragmatic inference, and world knowledge require substantial grounded
training evidence. A runtime should be open to learning rather than assert that
a small dictionary graph already supplies those capabilities.

## Sources and rights

The source pack uses Wikidata's official MediaWiki API and maps structured data
labelled CC0. Entity JSON, revisions, labels, aliases, and references remain attached
to acquisition evidence. Wiktionary revision text is retained with page URL, revision,
history/contributor links, and a CC-BY-SA-4.0 notice. Its text is not CC0; redistribution
of adapted dictionary material must preserve the applicable attribution and licence.
The project ships authored examples and mocked test fixtures, not dictionary dumps.

An arbitrary URL has an unspecified licence by default. Retrieval does not grant
permission to redistribute its text or treat it as verified knowledge. A future
export/answer pipeline needs source-specific attribution and excerpt policies.
Adding a `LearningSource` config works for an installed adapter; supporting a new
wire format still requires an adapter implementation.

FrameNet's frame elements and VerbNet's roles/restrictions are promising sources
for argument expectations. Wiktionary transitivity labels alone cannot reliably
supply complete semantic roles, required arguments, or execution behavior. No
fabricated `{{p|something}}`-to-hole pipeline is used here. A structured adapter should
retain dataset versions, specific lexical senses, frame evidence, and licensing,
then test mappings before importing rules.

## Next work, in order

1. **Frame/valency acquisition:** a narrow, tested structured FrameNet/VerbNet
   adapter. Import roles as hypotheses tied to a lexical sense; distinguish
   obligatory realization, implicit participants, and optional adjuncts.
2. **Evidence-driven construction revision:** retain positive and counterexamples,
   specialize overly broad rules, and consolidate only across supported cases.
   Automatic lexical acquisition alone does not solve composition.
3. **Discourse context:** scoped mentions, pronoun candidates, salience, time,
   negation, modality, reported speech, and contradiction. Hole completion must
   record whether a value was observed, inferred, defaulted, or asked about.
4. **Concept-authored learning transforms:** expose smaller mechanical matching/
   substitution primitives so example generalization and agenda selection move
   from host methods into readable concept programs without changing behavior.
5. **Truth maintenance and identity:** independent alternative proof sets,
   explicit equivalence versus synonymy, freshness, merge/split revisions, and
   efficient reanalysis on only the changed dependencies.
6. **Language output and capabilities:** grammar constructions for surface output,
   then explicitly installed page-section/file/tool capabilities with typed holes
   and retained outcome evidence. The meaning of a tool request alone does not
   supply its implementation.

The desired stance is 'investigate, retain, and try again'. A private referent,
ambiguous instruction, unavailable source, or genuinely new term can still require
user evidence. Continuing to learn and honestly exposing a hole is more useful
than replacing 'I don't know' with an invented answer.

## Primary references

- [Napkin reference repository](https://github.com/kealjones/napkin)
- [Reward signal research, Schultz et al. (1997)](https://doi.org/10.1126/science.275.5306.1593)
- [Complementary learning systems, McClelland et al. (1995)](https://pubmed.ncbi.nlm.nih.gov/7624455/)
- [Attention Is All You Need, Vaswani et al. (2017)](https://arxiv.org/abs/1706.03762)
- [FrameNet project](https://framenet.icsi.berkeley.edu/)
- [VerbNet project](https://verbs.colorado.edu/verbnet/)
- [Wikidata data access](https://www.wikidata.org/wiki/Wikidata:Data_access)
- [Wikibase API documentation](https://www.mediawiki.org/wiki/Wikibase/API)
- [Wiktionary copyrights](https://en.wiktionary.org/wiki/Wiktionary:Copyrights)
