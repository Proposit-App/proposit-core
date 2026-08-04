# upcoming changelog

## Ingestion pipelines author premise titles

`buildPremiseTitle` (`finalize-response-v2.ts`) composed every premise title
deterministically: `If "<antecedent>" and "<antecedent>" then "<consequent>"`
for a relation-derived premise, the conclusion claim's title verbatim for the
conclusion premise. Consumers render the premise's expression tree directly
beneath the header, so the composed title is a lossless restatement of the rows
below it — and the conclusion premise's title duplicated the argument title.

Both v2 pipelines now have the model author a short noun phrase naming the
inferential move, on structured output they already produce. No new stage, no
new LLM call.

Changes:

- `RelationExtractionOutputSchema` — each relation entry gains a required
  `title`. `ConclusionSelectionLlmOutputSchema` and
  `ConclusionSelectionOutputSchema` gain a required `title`;
  `ScribeStructureOutputSchema` gains `conclusionTitle` (named distinctly
  because the relation titles and the conclusion title share one object there).
  All are plain `Type.String()` — see the clamp note below.
- `RELATION_EXTRACTION_SYSTEM_PROMPT`, `CONCLUSION_SELECTION_SYSTEM_PROMPT`, and
  `STRUCTURE_SYSTEM_PROMPT` carry the same authoring rule: a short noun phrase
  naming what the step does, not a restatement of the consequent, under 60
  characters. `structure` carries it twice, since it emits both relations and
  conclusion candidates. The v1 single-call path's
  `BasicsPremiseExtension.title` description carries it too, replacing `"A short
title for this premise"`.
- The conclusion-selection stage and scribe's conclusion adapter carry the
  authored title through **verbatim**; neither judges whether it applies.
- `finalizeResponseV2` prefers an authored title and falls back to today's
  composition. `resolveAuthoredTitle` trims, treats empty/whitespace-only as
  absent, and clamps to `AUTHORED_PREMISE_TITLE_CAP` (80) with an ellipsis.
- `resolveAuthoredConclusionTitle` gates the conclusion premise: the model
  authors one title, for `conclusionCandidates[0]`, but the resolved
  `conclusionMiniId` is the first candidate that is a known normal claim — or
  `selectFallbackConclusion`'s pick. The authored title is used only on a strict
  `conclusionMiniId === conclusionCandidates[0]` match; every other case (a
  later candidate, the graph fallback, empty candidates) composes. Without the
  gate a run could label the conclusion premise with a description of a
  different claim, which is worse than a redundant-but-true composed title.
- The clamp lives where the title is read, not in the schema: strict structured
  output ignores JSON-Schema `maxLength`, so making length a validation gate
  would let one long string discard a fully paid pipeline run.

`buildArgumentTitle` is unchanged and still reuses the conclusion claim's title.

Test-only: relation and conclusion-selection fixtures across the pipeline suites
gained `title: ""` — the value that selects composition, so the existing
composition assertions keep their meaning as fallback coverage.

**The golden-corpus recordings must be re-recorded.** The replay hash covers the
system prompt and the output schema, and this change moves both for
`relation-extraction`, `conclusion-selection`, and `scribe-structure`, so every
fixture in `test/extensions/pipelines/fixtures/` now misses with
`RECORDED_PROMPT_STALE`. Re-record with a live key:
`INGESTION_TEST_RECORD=1 OPENAI_API_KEY=… pnpm exec vitest run test/extensions/pipelines/v2-e2e.test.ts test/extensions/pipelines/scribe-e2e.test.ts`,
then review the rewritten `*-expected.json` by hand before committing.

## Fixed — a split mention left its citation claim unanchored

`CLAIM_CANONICALIZATION_SYSTEM_PROMPT` tells the model to split a mention of the
form "according to X, P" into a citation-typed claim plus a normal-typed claim,
but said nothing about how `mentionIds` should be populated across that pair —
while the neighbouring `mentionToClaim` rule insists each mention maps to
exactly one claim. Read literally, that pushed the model toward giving the whole
mention to the normal claim and leaving the citation claim with `mentionIds:
[]`. `mentionIds` is what finalize resolves into `sourceAnchors`, so the
citation claim lost its link back to the source text entirely.

The split rule now states that both claims carry the mention in `mentionIds`,
and notes that `mentionToClaim` is unaffected. Surfaced by re-recording the
golden corpus: `with-url-citation`'s citation claim came back with zero source
anchors on two independent recordings, tripping the every-claim-is-anchored
assertion in the scholar driver.

Also test-only: the scribe golden driver ran on vitest's 5s default timeout, so
record mode timed out mid-call and left a recording whose expected output was
never assembled — replay then compared against the stale golden and failed
instead of skipping. It now mirrors the scholar driver's 300s timeout and
both-files guard.

`EXPECTED_NOTES` in the corpus anchor-notes suite is now empty: in the present
recordings every relation's evidence quote is copied verbatim and therefore
locates. The assertion still fails if a note reappears.
