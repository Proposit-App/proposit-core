# upcoming changelog

## scribe emits claim source anchors

Fixed: `createScribePipeline` produced **zero** source anchors of any kind, so a
consumer persisting origin data from a fast import got an origin document with
nothing anchored into it.

Two independent causes:

- `scribe.ts` passed neither `segmentation` nor `mentions` to
  `finalizeResponseV2`, and `extract`'s prompt asked for placeholder mention ids
  (`"c1-m"`) carrying no quoted text. `buildAnchorByMentionId` therefore returned
  an empty map and no claim was ever given `sourceAnchors`.
- The comment asserting that relation-derived premises still anchored was wrong.
  `buildStructurePrompt` is built from the canonical claim set and never sees the
  input text, so any `evidence.quote` `structure` returns is a paraphrase.
  Against a real document the model paraphrased on every relation and
  `locateSourceAnchor` missed every one, costing a `SOURCE_ANCHOR_UNRESOLVED`
  warning per relation for a fault in the pipeline's own wiring.

Changes:

- `buildExtractOutputSchema` (`scribe/schemas.ts`) — the per-extension
  canonicalization schema widened with the mention slot's item shape. The
  canonicalization envelope is `additionalProperties: false`, so this is a
  distinct schema rather than an extra key on the shared one.
- `extract`'s prompt now asks for one mention per place a claim is stated, with
  `text` copied character for character from the input and `span` documented as
  an approximate hint. Offsets are not trusted: the quote is located.
- `createExtractCanonicalizationAdapterStage` picks `canonicalClaims` +
  `mentionToClaim` instead of passing `extract`'s output through, which would now
  fail the canonicalization envelope's validation.
- New `extractMentionAdapterStage` republishes `{ mentions }` under
  `STAGE_IDS.claimMentionExtraction`; `scribe.ts` passes it to finalize. No
  segmentation stage is added and none is needed —
  `buildAnchorByMentionId` falls back to the mention's own reported start when no
  segment is found, and the span is only a tie-break between repeated
  occurrences.
- `structure`'s prompt now requires `evidence: { segmentIds: [], quote: "" }`
  rather than offering it as an option, and the false comment in `scribe.ts` is
  replaced with why premises carry no anchors here.
- `INGESTION_SCRIBE_STAGE_IDS` gains `claim-mention-extraction` at index 3.
  **Consumer-visible**: a pipeline-progress UI keyed off this list sees 11 stages
  rather than 10.

Tests:

- `scribe.test.ts` gains three cases: every claim carries anchors whose offsets
  slice the input back to the quote; a claim whose quote is not in the input
  still assembles, carrying no `sourceAnchors` key (absent, not empty) and
  exactly one warning; and no relation is routed to anchor resolution.
- The five scribe golden fixtures were regenerated. **The recorded `extract`
  responses were hand-extended with mentions rather than re-recorded against the
  live API** — no API key was available — so they are the previously recorded
  model output plus verbatim spans taken from each fixture's `input.txt`. The
  replayed request hashes were recomputed through `createRecordingLlmProvider`,
  so the prompt-drift guard is intact. Re-record them for real on the next run
  with a key.
- `conversation.test.ts`'s distill→scribe mock gains the mention slot.
