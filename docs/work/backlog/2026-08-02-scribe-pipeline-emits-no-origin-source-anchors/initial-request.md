---
from: proposit-app
---

# scribe pipeline emits no origin source anchors

## Problem

An argument imported through the raw-text route with the default (`fast` /
`scribe`) pipeline gets an origin document but **zero** origin anchors. Every
claim and premise lands under the reading surface's "These parts of the
argument trace to no passage of the source text." heading, so the whole origin
feature reads as broken for the default import path.

Observed on a 96,963-code-point import: `originDocuments` row written,
`originAnchors` count `0`.

## Root cause

Two independent halves, both reproducible from this repo's own fixtures.

### 1. Claims never carry `sourceAnchors`

`scribe.ts` calls `finalizeResponseV2({ ctx, extension })` with no
`segmentation` and no `mentions` — scholar passes both. `buildAnchorByMentionId`
returns an empty map, so `claimAnchors()` finds nothing and finalize never sets
`sourceAnchors` on a claim.

The upstream reason is `extract`'s prompt, which asks for placeholder ids:

> `mentionIds` — leave as a single synthetic id per claim (e.g. `["c1-m"]`);
> scribe does not track sub-claim mentions.

A synthetic id carries no quoted text, so there is nothing to locate even if the
slot were passed.

### 2. Premise anchors are documented as working, and cannot work

`scribe.ts` states:

> Claims therefore carry no source anchors; relation-derived premises still do,
> since their evidence quote comes from `structure`.

The second clause is false. `buildStructurePrompt` builds its user message from
the canonical claim set only — the input text is never in that prompt. Verified
against `test/extensions/pipelines/fixtures/straightforward/scribe-recorded-llm.json`:

```
prompt contains source text? false
r1 {"segmentIds":[],"quote":""}
```

The model takes the `quote: ""` escape hatch the prompt offers, because it has
nothing to quote from. On a real document it does worse and paraphrases: in the
observed import all 8 relation quotes were paraphrases, and splitting them on
their own ellipses into 20 fragments scored 0/20 as substrings of the source
document. `locateSourceAnchor` misses every one, so no premise anchor is ever
produced — and each miss costs a `SOURCE_ANCHOR_UNRESOLVED` warning blaming the
model for a fault in the pipeline's own wiring.

### No test guards it

Every scribe golden has zero `sourceAnchors`; the v2/scholar goldens over the
same fixtures have 3–4 each.

| fixture | `scribe-expected.json` | `v2-expected.json` |
| --- | --- | --- |
| straightforward | 0 | 4 |
| enthymeme | 0 | 3 |
| with-axiom | 0 | 4 |
| with-url-citation | 0 | 4 |

## Proposed fix

Anchor resolution already takes quoted **text** as the fact and the model's
offsets only as a tie-break hint (`locateSourceAnchor`). Scribe can reuse that
whole mechanism without a segmentation stage, because `buildAnchorByMentionId`
degrades correctly when no segment is found: `offsetInSegment` is `undefined`,
the hint falls back to the mention's own `span.start`, and the quote is located
by text.

1. Widen `extract`'s output schema with a `mentions` array (the item shape of
   `ClaimMentionExtractionOutputSchema`), and change its prompt to ask for a
   verbatim span copied exactly from the input per claim, with `mentionIds`
   referencing them. `span` stays a rough hint; `segmentId` is unused.
2. Narrow the canonicalization adapter to republish only `canonicalClaims` +
   `mentionToClaim` — the canonicalization envelope is
   `additionalProperties: false`, so a pass-through of the widened output would
   fail validation.
3. Add a deterministic adapter republishing `{ mentions }` under
   `STAGE_IDS.claimMentionExtraction`, and pass it from `scribe.ts`'s finalize.
   No segmentation is passed.
4. Stop asking `structure` for an evidence quote it cannot supply: require
   `quote: ""` in the prompt, and correct the false comment in `scribe.ts`.

## Consumer impact

`proposit-server` persists claim anchors against the expressions where the claim
appears in that version (`collectRequestedAnchors`), so claim-level anchors are
exactly what the reading surface's per-card Source cue hangs off. No server change
is needed — the seeding path already handles a populated `sourceAnchors`. Needs a
core publish and a repin.

Premise-targeted anchors stay absent for scribe. That is a real reduction against
what the comment claimed, but not against what shipped: the count was already zero.

## Test cases

- A scribe run over a fixture whose claims quote the input emits `sourceAnchors`
  on claims, with every anchor's span containing text that occurs in the input.
- Golden update: the scribe goldens gain claim anchors.
- Regression: no `SOURCE_ANCHOR_UNRESOLVED` warning is emitted for a relation in
  a scribe run.
- A claim whose quote cannot be located still assembles, carries no
  `sourceAnchors` key, and emits one warning.
