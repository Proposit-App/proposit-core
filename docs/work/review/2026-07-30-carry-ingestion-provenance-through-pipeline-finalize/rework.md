# Rework — Carry ingestion provenance through pipeline finalize

## Round 1

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

---

## Round 2

Second review, over the round-1 delta `b1f4cbc..HEAD`. `bd2b2bb` (surrogate-safe
context) and `b6deca7` (resolution notes) came back clean and hard-verified —
both mechanisms are left alone. `cb1a772` (located segment offsets) carries a
regression and does not finish the job it claimed. Five findings, all accepted;
each reproduced here before accepting.

### R2-1. HIGH — a stalled cursor mislocates the *next* segment

`resolveSegmentStarts` does not advance `cursor` on the not-found branch, so
when a segment is paraphrased — the exact case the fallback exists for — the
next segment's search starts behind the skipped segment's territory and can land
on a duplicate inside it.

Reviewer's repro, on
`"Intro here. We must act now. Some filler in between. We must act now. The end."`
with `s2` paraphrased: `s3` resolves to 12 instead of its true 53. The
pre-`cb1a772` code trusts `span.start ≈ 53` and gets this right, so it is a net
regression — and it is the very "repeated segment collapses onto an earlier
copy" failure the commit was written to prevent. The `SOURCE_ANCHOR_AMBIGUOUS`
note fires but carries the wrong `startUtf16`, so it reads as a routine
tie-break.

The existing not-found test uses a **trailing** segment, so the stalled cursor
never had a follower to corrupt.

**Fix.** Two changes rather than the suggested one-liner. Advance the cursor on
the fallback branch (`Math.max(cursor, segment.span.end)`), *and* choose among
the occurrences at or after the cursor by **nearest to the segment's own
reported `span.start`** rather than taking the first. The cursor advance alone
reintroduces an overshoot hazard: `span.end` is itself a model number, so a
cursor one unit past the next segment's true start makes its search miss and
find a *later* duplicate instead. Nearest-hint selection removes that class,
costs a few lines, and reuses the hint-among-verified-candidates rule the
locator already applies. It also fixes the repro on its own.

### R2-2. HIGH — the drift the fix targeted lives in `mention.span.start`

Measured here across all five recorded fixtures — worst absolute composed-hint
error per fixture:

| fixture | before `cb1a772` | after `cb1a772` | with mention offset located |
| --- | --- | --- | --- |
| straightforward | 0 | 0 | 0 |
| ambiguous-conclusion | 0 | 0 | 0 |
| enthymeme | 1 | 0 | 0 |
| with-axiom | 1 | 0 | 0 |
| with-url-citation | **14** | **14** | **0** |

`cb1a772` genuinely cleared two fixtures, but the largest error in the corpus
survives it untouched. It is `with-url-citation` mention `m1`: its segment `s1`
is located at 0 and reported as 0 — zero segment drift — and all 14 come from
the segment-relative `mention.span.start` (60 against a true 74; the markdown
URL is where the model's counting diverges). `segment.text.indexOf(mention.text)`
yields exactly 74 / 142 / 224 on that fixture, all three exact.

**Fix.** Locate the mention inside its segment's text by the same
nearest-to-reported-offset rule, falling back to `mention.span.start` only when
the mention text is not found in its segment.

**Two doc claims are unsupported and must be corrected.** The module comment,
`docs/changelogs/upcoming.md`, and `docs/api-reference.md` all say the model's
segment numbers run short by one "accumulating with document length". Measured
drift is a flat 1 — on the 275-char / 3-segment fixture `s3` is off by 1, not 2.
The wording also implies the large observed error had been removed, which it had
not.

### R2-3. MEDIUM — "the only resolution note the whole corpus emits" is false

Replaying all ten recordings emits **two** notes, not one. Reproduced:

```
with-url-citation/scholar  anchors=4 notes=1  UNRESOLVED relationId=r2  (accepted elided quote)
with-axiom/scribe          anchors=0 notes=1  UNRESOLVED relationId=r1
    "A bachelor is an unmarried man; John is a bachelor; therefore John is unmarried."
```

The claim was measured on the scholar pipeline only. The second note carries a
**non-empty synthesized** quote, so the accepted "an empty relation quote is not
reported" exemption does not cover it.

**Fix.** Correct the sentence, and add a test pinning the corpus's total note
count across both pipelines — that is what would have caught it.

**Decision on suppressing notes under the fast pipeline: no, keep emitting.**
The note is factually true — the model returned a quote that is not in the input,
which is precisely what the channel exists to say — and it is currently the only
evidence that the fast pipeline fabricates evidence quotes rather than copying
them. Suppressing it would mean teaching a deliberately pipeline-agnostic
assembler which pipeline it is running under, in order to hide a true signal.
That the fast pipeline emits no anchors is already filed as separate follow-up
work; when that is fixed these notes become directly actionable rather than
noise.

### R2-4. MEDIUM-LOW — `anchor.quote` can still carry a lone surrogate

`dropEdgeLoneSurrogates` guards the two context fields; the located range itself
is unchecked, so an ill-formed model quote (a bare `\uD83D` escape is valid JSON
and survives `JSON.parse`) can match at a position that splits a pair. Reviewer's
execution: input `"a😀b"`, quote `"\uDE00b"` → an ill-formed `anchor.quote`.
Narrow, but the persist transaction dies exactly as in the case already closed.

**Fix.** Discard a candidate range whose start or end splits a surrogate pair, in
the locator. Trimming the quote instead would break
`input.slice(start, end) === quote`.

### R2-5. MEDIUM-LOW — a foreign input shape makes every note blame the model

The `""` degradation from `5ec5e70` was judged correct and stays. The signal is
the problem: on a `{ document }` input every mention and every relation emits its
own `SOURCE_ANCHOR_UNRESOLVED`, sending a reader to inspect prompts when the
cause is `ctx.input` carrying no `text`. It also echoes every extracted quote
into `failures`.

**Fix.** Emit one note with a distinct code where `readInputText` falls back, and
skip per-quote resolution entirely in that case — nothing can resolve against an
empty string anyway.

### Recorded, deliberately not fixed

- **`occurrences` counts on two bases.** `exactOccurrences` steps `from = at + 1`
  and so counts overlapping hits (`locateSourceAnchor("aaaa","aa",0).occurrences
  === 3`), while the whitespace-insensitive path uses `matchAll`, which does not.
  Affects the ambiguity message text only; never the anchor, never the output.
- **`docs/changelogs/upcoming.md` carries `ending-hash="HEAD"`.** Pinned at
  version cut, like every other entry.

### Order of work

Failing test first for each; suite green at every commit boundary.

1. Cursor advance + nearest-hint segment selection (R2-1).
2. Mention offset located inside its segment (R2-2), and the drift wording
   corrected wherever it appears.
3. Surrogate-splitting ranges rejected (R2-4).
4. One note for an unavailable input (R2-5).
5. Corpus note-count test and the corrected sentence (R2-3), then Documentation
   Sync over the whole delta.
