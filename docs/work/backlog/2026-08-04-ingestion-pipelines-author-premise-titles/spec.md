# Spec: Ingestion pipelines author premise titles

## Capability changes

None. Premise titles are read by consumers through surfaces that are already
shipped, and no consumer-facing capability description asserts what a premise
title contains. No ledger entry is added, removed, or re-worded. Checked at the
epic level; recorded here so the planning check is not repeated.

## Problem

`buildPremiseTitle` (`src/extensions/pipelines/base/finalize-response-v2.ts:479`)
composes a premise's title deterministically. For a relation-derived premise it
walks the source relation and emits `If <and-joined antecedent claim titles>
then <consequent claim title>` (`:513-517`); for the conclusion premise — which
has no source relation, being synthesized from a bare symbol — it resolves that
symbol to its claim's title verbatim (`:483-495`).

Consumers render a premise header and then walk the premise's expression tree
beneath it (`proposit-shared/src/engine/text-tree.ts:214-222`), so the composed
title is a lossless restatement of the rows directly below it. The conclusion
premise's title is additionally identical to the argument title, which
`buildArgumentTitle` (`:536-551`) also takes from the conclusion claim.

Both shipped ingestion pipelines produce this: Scholar via
`relation-extraction`, Scribe via `structure` plus its adapters
(`src/extensions/pipelines/ingestion/scribe/structure-stage.ts:114-125`), both
finalizing through `finalizeResponseV2`.

A third path has the same gap for a different reason. The v1 single-call parser
has the model author premise titles itself, described only as `"A short title
for this premise"` (`src/extensions/basics/schemata.ts:87-90`) — no guidance at
all about what the title should say.

## Goals

1. Both v2 pipelines author a premise title that names the **inferential move**
   as a noun phrase, rather than restating the premise's content.
2. The conclusion premise gets an authored title too, resolved so it can never
   describe a claim other than the one actually selected.
3. Today's composition survives as the fallback on every path where no usable
   authored title exists — a missing title never fails a run.
4. The v1 parser path carries the same authoring rule in its schema
   description.

## Non-goals

- **`buildArgumentTitle` is unchanged.** It still reuses the conclusion claim's
  title verbatim. Same family of defect, but the argument title is a different
  consumer contract with a different blast radius, and no consumer asked for it.
- **No retitling of existing arguments.** This changes what future runs produce.
  Curated fixtures are retitled by hand in the `proposit-shared` slice.
- **No new pipeline stage, and no new LLM call.** If the design needs either,
  it is the wrong design.
- **`maxLength` on the existing basics schemas is not repaired.** See Risks.

## Design

### 1. Schema fields on existing structured outputs

`src/extensions/pipelines/base/stages/schemas.ts`:

- `RelationExtractionOutputSchema` (`:219`) — add `title: Type.String()` to each
  relation entry, beside `evidence`.
- `ConclusionSelectionLlmOutputSchema` (`:246`) — add `title: Type.String()`
  beside `rationale`.
- `ConclusionSelectionOutputSchema` (`:259`) — add `title: Type.String()` so the
  resolved title reaches finalize.

Both are objects the model already returns once per run, so this adds fields to
existing calls. No new call, no new stage.

### 2. The authoring rule, stated identically wherever it is prompted

> A short noun phrase naming what this step *does* in the argument — the
> inferential move, not the proposition. Do not restate the consequent: that
> claim's own title is already shown directly beneath this one. Aim for under
> 60 characters. Examples: `Limits of the crowd's power`, `Residence as tacit
> consent`, `Principle over survival`.

Goes in three prompts:

- `base/stages/relation-extraction.ts` — `RELATION_EXTRACTION_SYSTEM_PROMPT`,
  as a bullet in the existing per-relation emit list.
- `base/stages/conclusion-selection.ts` — `CONCLUSION_SELECTION_SYSTEM_PROMPT`,
  as a bullet in the existing `Emit:` list, scoped to the **first** candidate.
- `ingestion/scribe/structure-stage.ts` — `STRUCTURE_SYSTEM_PROMPT`, which emits
  relations *and* conclusion candidates in one call and therefore needs both.

And in the v1 schema description at `src/extensions/basics/schemata.ts:87` —
a description string, not a prompt, but the same rule and the only guidance that
path has.

### 3. Conclusion-title resolution — the subtle one

The stage resolves `conclusionMiniId` as *"the first candidate that is a known
normal claim"* (`conclusion-selection.ts` wrapper doc), which is **not
necessarily `conclusionCandidates[0]`**, and may instead come from
`selectFallbackConclusion` (`:113-155`) when the model abstains.

The model authors one title, for its own best pick. So:

> Use the authored conclusion title **only when the resolved `conclusionMiniId`
> is strictly equal to `conclusionCandidates[0]`.** Otherwise fall back to
> composition.

Without that guard a run where candidate 0 is unusable would label the
conclusion premise with a title describing a claim that is not the conclusion —
strictly worse than today's redundant-but-true title. This is the one place the
change can produce a *wrong* title rather than merely a weak one, and the guard
is what makes the accepted risk bounded.

### 4. Preference and fallback in `buildPremiseTitle`

Single resolution helper, used by both branches: trim the authored title;
treat empty or whitespace-only as absent; clamp to the length cap; on absent,
return today's composition unchanged.

Every existing composition path stays reachable, so the current tests remain
valid as fallback coverage.

### 5. Clamp in code, never reject

OpenAI's strict structured-output mode does not enforce string `maxLength`, so
the schema cannot be the guard — the field is a plain `Type.String()` and the
clamp lives where the title is read. An over-long title is clamped; it is never
a validation failure, because rejecting one discards a fully paid pipeline run.

## Acceptance criteria

1. A relation carrying `title: "Limits of the crowd's power"` produces a premise
   whose title is exactly that string.
2. A relation whose `title` is absent, `""`, or `"   "` produces exactly the
   `If "A" and "B" then "C"` composition today's tests already assert.
3. When `conclusionMiniId === conclusionCandidates[0]`, the conclusion premise
   carries the authored conclusion title.
4. When `conclusionMiniId !== conclusionCandidates[0]` — including every case
   where `selectFallbackConclusion` supplied it, and the case where
   `conclusionCandidates` is empty — the conclusion premise carries the
   conclusion claim's title, exactly as today.
5. An authored title longer than the cap appears clamped, and the run completes
   without a validation error or a `ProcessingFailure`.
6. A Scribe fixture and a Scholar fixture driven through `finalizeResponseV2`
   resolve titles identically.
7. `pnpm run check` passes, including the existing
   `test/extensions/pipelines/finalize-response-v2.test.ts` suite, whose
   composition assertions must still hold on the fallback path.
8. The rule text in all three prompts and the basics schema description states
   "noun phrase" and "do not restate the consequent".

## Risks

- **An authored gloss can be wrong where a composed one could not.** Accepted at
  the epic level; the title is user-editable before publish. Criterion 4's guard
  bounds the one case where it could be confidently wrong rather than vague.
- **Prompt changes shift model behavior beyond the new field.** Adding an emit
  bullet to a strong-reasoning stage can perturb the relations themselves. Not
  mechanically preventable; the fixtures in `test/` are the tripwire, and the
  curated arguments are deliberately *not* regenerated in this initiative.
- **`maxLength: 50` on `BasicsPremiseExtension` / `BasicsArgumentExtension` is
  not enforced under strict structured output** — a pre-existing latent gap on
  the v1 path, unrelated to whether a title reads well. Out of scope here; it
  deserves its own item rather than a drive-by fix inside a wording change.

## Notes

The sibling sweep was repo-wide over title-producing code, not narrowed to the
reported path. It found exactly three producers of a premise title —
`buildPremiseTitle`'s two branches and `BasicsPremiseExtension` — and all three
are addressed. `buildArgumentTitle` is a fourth title producer and is
deliberately excluded above, for a stated reason rather than by omission.
