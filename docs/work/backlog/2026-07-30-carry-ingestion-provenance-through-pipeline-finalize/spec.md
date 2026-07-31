# Spec — Carry ingestion provenance through pipeline finalize

## Capability changes

**None in this node.** `proposit-core` has no `docs/capabilities/` ledger — the
product master lives in `proposit-shared`, and the epic's nine capability entries
are registered by the shared-node slice, not here. This slice changes no
user-facing behavior on its own: it widens a library output shape so a consumer
can build a feature on top of it.

No taxonomy delta either. The epic's new Vocabulary entries (origin document,
origin link, stance, origin anchor, enthymeme) are registered by the sibling
core slice that adds the origin library; this slice registers none of its own.

## Problem

The scholar ingestion pipeline already computes where each claim and each
inference came from in the input text, then discards it at assembly time.

Grounded in the code:

- `segmentation` emits `{segmentId, text, span}` where `span` is
  `{start, end}` character offsets **into the input**
  (`src/extensions/pipelines/base/stages/schemas.ts:52-62`; prompt at
  `stages/segmentation.ts:51`).
- `claim-mention-extraction` emits `{mentionId, segmentId, text, span}` where
  `span` is **relative to the segment's text, not the input** — the prompt is
  explicit: "relative to the SEGMENT'S TEXT (not the original input)"
  (`stages/schemas.ts:66-79`, `stages/claim-mention-extraction.ts:26`).
- `claim-canonicalization` carries `mentionIds` per canonical claim plus a
  `mentionToClaim` list (`stages/schemas.ts:132-168`).
- `relation-extraction` carries `evidence: {segmentIds, quote}` per relation
  (`stages/schemas.ts:219-238`).
- `formula-compilation` records `sourceRelationId` per compiled premise
  (`stages/schemas.ts:278-301`).

`finalizeResponseV2` then drops all of it. `stripCanonicalizerOnlyFields`
removes `mentionIds` as "an internal trace"
(`finalize-response-v2.ts:172-186`), and no premise field carries
`evidence.quote` — `finalize-response-v2.ts:451-457` builds each premise as
exactly `{miniId, formula, title}`.

So the finalized `TParsedArgumentResponse` a consumer receives contains no path
back to the input text, even though the pipeline held one a function call
earlier.

## Goals

- Each finalized claim carries the verbatim source text it was extracted from,
  with a verified offset range into the pipeline input and a little surrounding
  context.
- Each relation-derived premise carries the relation's `evidence.quote`, same
  shape.
- Zero additional LLM calls, zero prompt edits, zero added token cost. This is
  assembly-time plumbing over data the pipeline already has.
- Emitted offsets are **verified**, not asserted: slicing the pipeline input at
  an emitted range returns exactly the emitted quote, or the anchor is not
  emitted at all.
- The fast (`scribe`) pipeline, which has no segmentation or mention stages,
  degrades to "no claim anchors" rather than to wrong ones.

## Non-goals

- **Storing the source text.** Core emits anchors into the string it was given;
  holding that string is the consumer's job. Segments are not a substitute — the
  segmentation prompt requires only that every *non-whitespace* character fall
  in some span and states that whitespace between segments is owned by neither
  (`stages/segmentation.ts:51-53`), so concatenating segments does not
  reconstruct the input.
- **Fuzzy quote matching.** Exact match, then a whitespace-insensitive retry.
  Nothing approximate; a quote that still does not match yields no anchor.
- **Trusting the model's arithmetic.** The composed segment+mention offset is
  used only as a *search hint* to choose among repeated occurrences. It is never
  emitted unverified.
- **Code-point offsets.** Emitted offsets are JS string indices (UTF-16 code
  units) into the pipeline input, named so downstream cannot mistake them. The
  consumer re-locates the quote in its own stored, normalized document — the
  offsets here are a hint into a string the consumer may not even hold
  byte-identically.
- **Carrying `mentionIds` / `suggestedSymbol` through.** See Design.
- **Anchoring citation sources or axiom indicators.** `citation-source-detection`
  and `axiom-indicator-detection` also emit spans (`stages/schemas.ts:83-114`),
  but neither feeds a finalized entity that a consumer anchors. Out of scope,
  and named here because it is adjacent enough to drift in.
- **New schema validation.** `ParsedClaimSchema` and `ParsedPremiseSchema`
  already declare `additionalProperties: true`
  (`src/lib/parsing/schemata.ts:14-41`), so the new field validates today with
  no schema edit. A TypeScript type is exported for consumers; no TypeBox
  schema is added.

## Design

### The emitted shape

One new type, exported from the pipelines extension:

```ts
export type TIngestionSourceAnchor = {
    /** Verbatim text from the pipeline input. Authoritative. */
    quote: string
    /** JS string index (UTF-16 code unit) of the quote's first character. */
    startUtf16: number
    /** JS string index one past the quote's last character. */
    endUtf16: number
    /** Up to 32 characters of input immediately before `startUtf16`. */
    prefix: string
    /** Up to 32 characters of input immediately after `endUtf16`. */
    suffix: string
}
```

`input.slice(startUtf16, endUtf16) === quote` holds for every emitted anchor —
by construction, because the offsets are produced by locating the quote rather
than by copying the model's.

The field is `sourceAnchors?: TIngestionSourceAnchor[]`, attached to finalized
claims and finalized premises. **Omitted entirely when empty** — never
`sourceAnchors: []`.

Name choice: `sourceAnchors`, not `originAnchors`. The epic reserves "origin"
for the entity vocabulary the sibling core slice introduces
(`TOriginAnchor` and friends in `src/lib/schemata/`); a distinct name here keeps
a pipeline-extension output type from colliding with a library entity type that
means something narrower.

Offset-name choice: `startUtf16` / `endUtf16` rather than `start` / `end`. The
epic makes offset-unit confusion its named correctness risk and mitigates it by
naming; the same mitigation applies to the field that crosses the package
boundary. Reusing the bare `start` / `end` of `SpanSchema`
(`stages/schemas.ts:25-34`) would be the exact ambiguity the epic is designed
against.

### Where the anchors come from

**Claims.** For canonical claim `c`, for each `mentionId` in `c.mentionIds`,
resolve the mention from `claim-mention-extraction`, resolve its segment from
`segmentation`, and compute the search hint as
`segment.span.start + mention.span.start` — the composition is required, because
mention spans are segment-relative (see Problem). Then locate `mention.text` in
the input near that hint. Anchors are emitted in `mentionIds` order and deduped
by `(startUtf16, endUtf16)`.

Under `scribe` neither stage exists, and its `extract` prompt instructs the model
to emit synthetic mention ids ("scribe does not track sub-claim mentions",
`ingestion/scribe/extract-stage.ts:41`). Every mention lookup misses, so claims
carry no `sourceAnchors`. That is the correct degradation, not a gap.

**Premises.** For each compiled premise with a non-null `sourceRelationId`,
take the source relation's `evidence.quote` and locate it, hinted by the
smallest `span.start` among the segments named in `evidence.segmentIds`. The
conclusion premise is synthesized from a bare symbol and has
`sourceRelationId: null` (`stages/schemas.ts:286-287`), so it carries none.
`scribe`'s `structure` stage emits the same per-relation shape, evidence
included (`ingestion/scribe/schemas.ts:23-30`), so **premise anchors work under
both pipelines**.

### Locating a quote

New module `src/extensions/pipelines/base/source-anchors.ts`, one exported
function plus the type. The ladder, in order:

1. Every exact occurrence of `quote` in `input`; pick the one whose start is
   nearest the hint.
2. If none, retry whitespace-insensitively: match the quote's non-whitespace
   character sequence against the input, allowing any run of whitespace where
   the quote has whitespace. This covers the common model behavior of
   normalizing a line break to a space when copying. The emitted `quote` is then
   the input's own text for the matched range, not the model's copy — so the
   `slice === quote` invariant still holds.
3. Otherwise return nothing. No anchor, no guess.

Empty and whitespace-only quotes return nothing before step 1.

### Why `mentionIds` still does not survive

The request's root-cause section names `stripCanonicalizerOnlyFields` as the
place provenance dies, which reads as "stop stripping `mentionIds`". Carrying
the raw ids forward would not meet the request's own stated goal: mention
records are not part of the finalized output, so `["m3","m7"]` on a claim
references an id space the consumer never receives. The resolved anchors are
what a consumer can act on. `mentionIds` and `suggestedSymbol` therefore stay
stripped, and the strip function's comment is corrected to say the trace is
resolved into `sourceAnchors` rather than merely discarded.

### Finalize's dependency list

Both pipeline factories gain `optional(STAGE_IDS.segmentation)` and
`optional(STAGE_IDS.claimMentionExtraction)` on `finalize.dependsOn`
(`ingestion/scholar/scholar.ts:202-212`, `ingestion/scribe/scribe.ts:116-128`).
Optional deps never propagate a skip and `ctx.get` returns `undefined` when the
stage did not run (`src/lib/pipelines/types.ts:39-43`), which is exactly the
scribe case. Adding them changes no stage's execution — they already run in
scholar and do not exist in scribe.

`ctx.input` is `TIngestionInput` (`{text: string}`), reachable from
`finalize.run` (`src/lib/pipelines/types.ts:61-70`), so finalize can validate
against the actual input string.

### Recorded fixtures

The five `v2-expected.json` fixtures and `scribe-expected.json` are deep-equal
targets in replay mode (`test/extensions/pipelines/v2-e2e.test.ts:181-200`).
They gain `sourceAnchors` and must be regenerated **from replay**, with no API
key and no live call — the recorded request/response pairs in
`v2-recorded-llm.json` are untouched, which is itself the proof that no prompt
changed.

## Acceptance criteria

1. `pnpm run check` passes in the worktree.
2. For every non-null-argument scholar fixture in replay mode: every finalized
   claim carries at least one `sourceAnchors` entry.
3. For every non-null-argument scholar fixture in replay mode: every premise
   whose compiled record has a non-null `sourceRelationId` carries a
   `sourceAnchors` entry whose `quote` is non-empty; the conclusion premise
   carries no `sourceAnchors` key.
4. For every emitted anchor across all fixtures:
   `0 <= startUtf16 < endUtf16 <= input.length` and
   `input.slice(startUtf16, endUtf16) === quote`.
5. `prefix` is `input.slice(max(0, startUtf16 - 32), startUtf16)` and `suffix`
   is `input.slice(endUtf16, min(input.length, endUtf16 + 32))`, asserted on at
   least one anchor at each boundary (an anchor at offset 0 has an empty
   `prefix`).
6. The number of LLM calls made during each fixture's replay is identical to the
   number of recorded entries in that fixture's `v2-recorded-llm.json`, and
   every recorded prompt still matches (the prompt-drift guard,
   `RecordedPromptStaleError`, does not fire). No fixture's
   `v2-recorded-llm.json` or `scribe-recorded-llm.json` is modified by this
   change — asserted by `git diff --stat` being empty for those paths.
7. Under the scribe pipeline, finalized claims carry no `sourceAnchors` key and
   relation-derived premises do carry one.
8. A quote that does not occur in the input yields no anchor and no throw; a
   quote that occurs twice resolves to the occurrence nearer the hint, asserted
   by a unit test that would pick the wrong one under a first-match rule.
9. A quote whose internal whitespace differs from the input (line break vs
   space) resolves via the whitespace-insensitive retry, and its emitted `quote`
   equals the *input's* text for that range.
10. An entity with no resolvable provenance has no `sourceAnchors` key at all —
    asserted with `"sourceAnchors" in claim === false`, not against `[]`.

## Risks

- **Mention spans are segment-relative and it is easy to forget.** Treating them
  as input-relative produces a hint that drifts further the deeper into the
  document a claim appears. Mitigated by verifying every offset against the
  input before emitting, which makes a wrong hint degrade to "picked a different
  occurrence" or "no anchor" rather than to a wrong span. Criterion 4 is the
  check.
- **Recorded fixtures are deep-equal.** Regenerating six expected files by hand
  invites a silent behavioral change riding along. Mitigated by regenerating
  from replay only, and by criterion 6's assertion that the recordings
  themselves are byte-unchanged.
- **The consumer allowlist.** `ArgumentParser.mapClaim` is consumer-implemented
  (`src/lib/parsing/argument-parser.ts:364-365`) and the server's
  implementation is a field allowlist, so `sourceAnchors` reaches core's output
  and is dropped there until the consuming server slice adds it. Nothing this
  slice can do about it; `outcome.md` must state the field names exactly.
- **Model quote fidelity is unmeasured.** The prompts tell the model to copy
  verbatim, but nothing enforced it before, because nothing consumed it. The
  fixture assertions (criteria 2-3) measure it for the first time on five
  recorded inputs. If a fixture fails them, that is a finding about model
  behavior to report, not a test to loosen.

## Notes

- The request's verification bullet asks that "slicing the input at the span
  returns text matching the recorded mention". That is only satisfiable by
  locating the quote in core rather than by forwarding the model's numbers,
  which is why the design does the former. It is a stronger reading of the
  request than "carry the offsets through", and it is the reading that makes the
  criterion checkable.
- The epic's stated position that the model's offsets are "not stored and not
  trusted, not even as a tiebreaker" is honored in substance: the model's
  arithmetic never reaches the output. It is used only to disambiguate among
  occurrences of a quote that has already been located in the input by exact
  text match — a choice among verified candidates, not a trusted position.
