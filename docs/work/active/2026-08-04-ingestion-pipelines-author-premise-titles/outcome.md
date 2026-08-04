# Outcome: Ingestion pipelines author premise titles

Branch `work/premise-title-authoring`. Four commits: `384193a` (feature),
`72161d0` (golden-driver fix), `9de3ed2` (split-mention fix), `0b8d1ab`
(re-recorded corpus).

## What shipped

`title` added to `RelationExtractionOutputSchema`,
`ConclusionSelectionLlmOutputSchema`, and `ConclusionSelectionOutputSchema` —
fields on structured outputs the pipelines already produce, so **zero new LLM
calls**. The same authoring rule went into all three prompts plus the v1
parser's `BasicsPremiseExtension` description. `buildPremiseTitle` prefers the
authored title; today's composition remains the fallback for missing, empty, or
whitespace-only values, which also covers Scribe's deterministic
relation-graph conclusion path.

The conclusion guard resolves in finalize, where `conclusionMiniId` and
`conclusionCandidates` sit on the same slot, so Scholar and Scribe share one
implementation: the authored conclusion title is used **only** on a strict
`conclusionMiniId === conclusionCandidates[0]` match. Every other case composes.
Without it a run could label the conclusion premise with a description of a
different claim — worse than a redundant-but-true title. Clamping happens where
the title is read, not in the schema, because strict structured output ignores
`maxLength` and a validation failure would discard a paid pipeline run.

## Two defects found along the way, both pre-existing

**The scribe golden driver could never be re-recorded.** It ran on vitest's 5s
default, so record mode timed out mid-call and left a recording whose expected
output was never assembled; replay then compared against the stale golden and
failed instead of skipping. It now mirrors the scholar driver's 300s timeout and
both-files guard.

**A split mention left its citation claim unanchored.** The canonicalization
prompt says to split "according to X, P" into a citation claim plus a normal
claim but never said how `mentionIds` spans that pair, while the adjacent
`mentionToClaim` rule insists a mention maps to exactly one claim. The model
resolved that ambiguity by leaving the citation claim with `mentionIds: []`, and
`mentionIds` is what finalize turns into `sourceAnchors` — so the citation claim
lost its link to the source text. Reproduced on two independent recordings
before the fix; the claim is anchored again after it. The rule now states that
both claims carry the mention.

## The risk the spec named did not materialize

Premise formulas and roles are unchanged in every fixture — the new prompt bullet
did not perturb relation extraction. The only structural movement was variable
symbol renaming in one fixture (`Global_Temp_Rise` → `Global_Temps_Risen`); the
logical shape is identical.

`EXPECTED_NOTES` in the corpus anchor-notes suite is now empty: every relation's
evidence quote in the current recordings is copied verbatim and therefore
locates. The assertion still fails if a note reappears.

## Verification

`pnpm run check` passes: 78 test files, 2358 tests, prettier and eslint clean,
build clean. Twenty golden files re-recorded against the live API and reviewed
before committing.

A live run outside the goldens (Scribe, four-sentence input) returned
`Cost-free lending removes barriers` / `Barrier removal yields access` /
`Access from free lending` — noun phrases, with the conclusion premise taking an
authored title rather than echoing its claim, so the guard fired correctly on
real output.

## Scope amendment

The sibling sweep in the spec found three premise-title producers. A fourth
defect — the citation-claim anchor gap — surfaced only when the corpus was
re-recorded and was fixed here rather than deferred, because it blocked this
item's own acceptance criterion that `pnpm run check` passes.
