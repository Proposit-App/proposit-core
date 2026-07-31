# Rework — Carry ingestion provenance through pipeline finalize

Dual review returned six findings. The user chose **full scope**, including the
LOWs, so all six go back. Two were verified against the running code before
accepting them; both reproduce.

## Accepted findings

### 1. HIGH — `prefix`/`suffix` can be cut through a surrogate pair

`src/extensions/pipelines/base/source-anchors.ts` — `buildAnchor` slices at
`start - 32` / `end + 32`, arbitrary UTF-16 indices. A non-BMP character
straddling that index leaves a lone surrogate at the edge of the context string.

Reproduced with the shipped function:

```
input = "😀" + "y"*31 + "QUOTE" + "y"*31 + "😀"
prefix → "\ude00yyyyyyy…"   isWellFormed() === false
suffix → "…yyyyyyy\ud83d"   isWellFormed() === false
```

Consequence is not a cosmetic one: Postgres rejects an unpaired surrogate escape
on insert into `json`/`jsonb`, so the whole ingestion-persist transaction fails
rather than just the anchor. Across an HTTP boundary instead, `TextEncoder`
substitutes U+FFFD and the stored context silently stops matching the source,
defeating the re-locate path `prefix`/`suffix` exist to serve.

**Fix:** shrink the window by one code unit rather than emit an ill-formed
string — drop a leading lone low surrogate and a trailing lone high surrogate
from each context string. Neither test file currently contains a multi-unit
character; add fixtures with an emoji straddling the boundary on both sides.

### 2. MEDIUM — `ctx.input` is cast, not checked

`finalize-response-v2.ts` — `(ctx.input as TIngestionInput).text`.
`TStageContext.input` is `unknown`, and `finalizeResponseV2` is documented public
API for consumers assembling their own pipelines. Before this change finalize
never read `ctx.input` at all, so any input shape worked.

A consumer pipeline with `inputSchema` `{ document: string }` gets
`inputText === undefined`, and the first non-empty evidence quote reaches
`haystack.indexOf` → `TypeError`. On the happy path, after all eight LLM calls
are paid for.

**Fix:** one `typeof … === "string"` guard falling back to `""`. Empty string
degrades exactly into the documented no-anchor behavior — every match misses.

### 3. MEDIUM-LOW — the hint is built from model arithmetic when a verifiable
offset is free

The hint is `segment.span.start + mention.span.start`, where `segment.span.start`
is a number the model emitted — while the segmentation prompt requires
`segment.text` be copied verbatim, so the true offset is recoverable with a
search. The module's own header argues the model's offsets are untrustworthy and
then consumes one.

Measured across the recorded corpus (segment `span.start` vs. located position):

| Fixture | Input length | Drifted segments |
| --- | --- | --- |
| `straightforward` | 78 | none |
| `ambiguous-conclusion` | 153 | none |
| `enthymeme` | 49 | `s2` off by −1 |
| `with-axiom` | 96 | `s2`, `s3` off by −1 each |
| `with-url-citation` | 275 | `s2`, `s3` off by −1 each |

Drift is a running total, so it grows with document length. It is harmless while
every quote is unique and becomes a confidently-wrong location the moment a
quote repeats — the exact failure the design exists to prevent, narrowed to
repeated text.

**Fix:** resolve segment starts by locating `segment.text` in the input,
scanning left to right from the previous segment's end (segments are ordered and
cover the input), falling back to the model's `span.start` when a segment cannot
be found. One map, used by both the mention path and the relation path.

### 4. MEDIUM-LOW — "no anchor **and a log line**" is only half implemented

Unlocatable quotes are dropped in silence, and a quote occurring N>1 times is
resolved to the nearest-hint winner with no signal that a choice was made.
`ctx.addFailure` is the non-fatal seam and is already in scope in finalize.

Without it, a model that starts paraphrasing after a prompt or model change
drops anchor coverage in production with no detector — the only current check is
an e2e assertion against frozen recordings.

**Fix:** emit one non-fatal `warning` per unresolved quote and one per ambiguous
resolution. This needs the occurrence count out of the locator, so
`locateSourceAnchor` returns `{ anchor, occurrences }` instead of a bare anchor.
The emitted `sourceAnchors` payload is unchanged.

### 5. LOW — the `mapClaim` doc note omits `mapPremise`

`docs/api-reference.md`. Premise anchors travel through
`ArgumentParser.mapPremise` (`argument-parser.ts:698`), a separate hook with the
identical allowlist hazard. One clause in the same sentence.

### 6. LOW — the call-count assertion counts calls, not distinct prompts

The substitute assertion was judged load-bearing and stays. One caveat needs a
comment: in `record` mode a transient API retry makes it `9 !== 8`, so the
golden test fails with a count mismatch instead of the underlying error. Replay
is unaffected.

## Explicitly not findings — left alone

Span composition at both read sites; the omitted-vs-empty contract; the
structural enforcement of `input.slice(start, end) === quote`; the
additive-only golden regeneration; the fast pipeline emitting no anchors and the
one elided relation quote (both accepted limitations, filed separately).

## Order of work

Each defect gets a failing test first. Suite green at every commit boundary.

1. Surrogate-safe context (#1) — pure locator change, no callers affected.
2. Input guard (#2) — pure finalize change.
3. Verified segment starts (#3) — may move a hint, so it lands after the two
   changes that cannot; regenerate goldens if any anchor moves.
4. Non-fatal notes (#4) — changes the locator's return shape, so it lands after
   everything that calls it is otherwise final.
5. Docs + comment (#5, #6), then a re-run of Documentation Sync over the whole
   reworked diff.
