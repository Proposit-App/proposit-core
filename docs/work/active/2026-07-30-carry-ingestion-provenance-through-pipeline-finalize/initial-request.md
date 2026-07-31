---
from: proposit-app
initiative: 2026-07-29-argument-origin-data-and-enthymeme-annotations
---

# Carry ingestion provenance through pipeline finalize

Epic: [Argument origin data and enthymeme annotations](tcw://W/proposit-app/2026-07-29-argument-origin-data-and-enthymeme-annotations)

Slice **B** of the epic. Independent of the sibling slice _Origin data library and
enthymeme annotation_ (A) — they share a package but not a code path, so **do not
chain them**. Both ship in **one** `@proposit/proposit-core` release.

**Blocked by:** nothing.

---

## Problem

The ingestion pipeline already computes exactly the provenance this epic needs,
then throws it away. The automatic anchoring path is plumbing, not new LLM work
— no prompt changes, no extra model calls, no added token cost.

## Root cause

`segmentation` emits `{segmentId, text, span}`; `claim-mention-extraction` keys
mentions to segments with their own spans; `claim-canonicalization` maps mentions
to claim miniIds via `mentionIds`; `relation-extraction` carries
`evidence.{segmentIds, quote}`
(`src/extensions/pipelines/base/stages/schemas.ts:52-238`). Then
`stripCanonicalizerOnlyFields` drops `mentionIds` as "an internal trace"
(`src/extensions/pipelines/base/finalize-response-v2.ts:175-186`, the `continue`
at `:182`).

## What changes

Carry per-claim and per-relation source provenance through
`finalize-response-v2` onto the finalized output instead of stripping it, so a
consumer can resolve each claim and each premise back to the original input.

**Carry the quote text, not just the numbers.** The consumer resolves a
pipeline-produced anchor by _locating the quoted text_ in the stored document —
the quote is authoritative and the span is derived from it. Mentions already
carry `text` and relations already carry `evidence.quote`
(`stages/schemas.ts:66-93`, `:219-233`); make sure both survive finalize rather
than being dropped as redundant to the spans.

This is deliberate on two counts. Offset units are ambiguous — JS string indices
are UTF-16 code units, so emoji and much CJK count as two, while a model told
"character offsets" will generally count code points — and a quote that cannot be
located should become a dropped anchor with a log line rather than a confidently
wrong highlight.

**The model's own offsets are not stored and not trusted, not even as a
tiebreaker.** Where a quote occurs more than once, the consumer disambiguates
using `prefix`/`suffix` context. If carrying a small amount of surrounding
context out of the pipeline is cheap here, do it — it saves the consumer
re-deriving context it cannot always reconstruct.

Two consumers of the shape to keep in step: `TParsedArgumentResponse`
(`src/lib/parsing/`) and the server's `mapClaim` → `persistParserOutput` path,
which is a **field allowlist** — new fields are silently dropped there unless the
server slice adds them. Flag that explicitly for the consuming server slice
rather than assuming it.

## A trap worth stating

Segments cannot substitute for the source text. The segmentation prompt says
whitespace between segments is owned by neither segment, and requires only that
every _non-whitespace_ character fall inside some span
(`src/extensions/pipelines/base/stages/segmentation.ts:45-53`). Concatenating
segments does **not** reconstruct the original. The full text must be stored
verbatim; the segmentation overlay is a non-load-bearing convenience.

## Verification

- `pnpm run check`.
- A recorded-fixture pipeline run asserts each finalized claim carries at least
  one span, and each relation-derived premise carries its evidence quote.
- Assert offsets are valid against the original input: every emitted span
  satisfies `0 <= start < end <= input.length` and slicing the input at the span
  returns text matching the recorded mention.
- No new LLM calls: assert the stage-call count is unchanged against the existing
  recorded run.

## Documentation Sync (expected to fire)

- `docs/changelogs/upcoming.md` [Any-Code-Change].
- `docs/api-reference.md` [Public-API] — only if the finalize output shape is
  part of the documented public surface.

## Consumer impact

- `proposit-server` captures the carried provenance into origin data (slice E) —
  blocked on this slice.

This slice ships in **one core release** together with slice A. Consumer-side
tarball validation runs before `pnpm publish` and is coordinated at the workspace
root — do not publish from this node. Remove every `*.tgz` from the package root
first.

## Note on this node's board

`tcw validate` in this repo currently reports 4 problems, all pre-existing
`resolution`/`status` mismatches on completed items from June and July. None
relate to this epic; clearing them is a separate chore.
