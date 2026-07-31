# Outcome — Carry ingestion provenance through pipeline finalize

Code branch `ingestion-provenance` in `.worktrees/ingestion-provenance`; not
merged, not pushed, no version cut, no tag, no publish. Lifecycle artifacts are
on `main` in the primary checkout.

| Commit    | Task                                                             |
| --------- | ---------------------------------------------------------------- |
| `68f2481` | 1 — quote locator + anchor type, unit tests first                 |
| `10bbc40` | 2 + 3 — finalize wiring, its unit tests, regenerated goldens      |
| `30c4411` | 4 — fixture-level anchor + LLM-call-count assertions             |
| `b1f4cbc` | 6-8 — Documentation Sync                                          |

Tasks 2 and 3 landed as one commit deliberately: the wiring without the
regenerated goldens leaves the suite red, and the plan's own rule is that the
tree must be green at every commit boundary.

**Rework pass** — dual review returned six findings (`rework.md`), all accepted
and all addressed:

| Commit    | Finding                                                       |
| --------- | ------------------------------------------------------------- |
| `bd2b2bb` | 1 HIGH — surrogate-safe `prefix`/`suffix`                      |
| `5ec5e70` | 2 MEDIUM — tolerate a pipeline input with no `text`            |
| `cb1a772` | 3 MEDIUM-LOW — locate segment offsets instead of trusting them |
| `b6deca7` | 4 MEDIUM-LOW — report unresolved and ambiguous quotes          |
| `c3ced9f` | 5 + 6 LOW — `mapPremise` doc clause, call-count caveat comment |

**Rework pass, round 2** — the second review cleared `bd2b2bb` and `b6deca7` as
hard-verified and left them alone, but found `cb1a772` both regressive and
incomplete. Five findings, all accepted after reproducing each:

| Commit    | Finding                                                        |
| --------- | -------------------------------------------------------------- |
| `d4d8afe` | R2-1 HIGH — a rewritten segment derailing the next              |
| `f319564` | R2-2 HIGH — mention offsets located, not trusted                |
| `a03e2c4` | R2-4 MEDIUM-LOW — refuse a range that splits a surrogate pair   |
| `78c799e` | R2-5 MEDIUM-LOW — report an unusable input once, not per quote  |
| `25f98ae` | R2-3 MEDIUM — corrected doc claims, corpus note-count test      |

No golden or recording file was touched during either rework round: `git diff` over
`test/extensions/pipelines/fixtures/` from `b1f4cbc` to `HEAD` is empty. The
located-offset change (finding 3) moved no anchor in the recorded corpus,
because its drift there is only −1 per segment and every quote in it is unique
— which is precisely why the defect was invisible.

## The finalized output shape

**This is the section the `proposit-server` slice needs.** That slice reaches
core's output through `ArgumentParser.mapClaim` → `persistParserOutput`, a field
allowlist that drops unknown fields silently, so the names below have to be
copied exactly.

A new **optional** field `sourceAnchors` appears on **finalized claims** and on
**finalized premises** — `response.argument.claims[i].sourceAnchors` and
`response.argument.premises[i].sourceAnchors`. Nothing else in the response
changed.

```ts
type TIngestionSourceAnchor = {
    quote: string // the input's own text for the range
    startUtf16: number // JS string index of the first character
    endUtf16: number // JS string index one past the last
    prefix: string // up to 32 characters of input before the quote
    suffix: string // up to 32 characters of input after the quote
}
```

Exported as `TIngestionSourceAnchor` from
`@proposit/proposit-core/pipelines/base`, alongside `locateSourceAnchor`,
`TSourceAnchorMatch`, `SOURCE_ANCHOR_CONTEXT_CHARS`, and
`SOURCE_ANCHOR_NOTE_CODES`.

> **The persisted shape did not change during the rework.** The five field
> names and their types are exactly what was reported before review. What
> changed is what goes *into* `prefix`/`suffix` at a surrogate boundary (they
> are now always well-formed), which offsets are used as a search hint
> (located, not model-reported), and that unresolved and ambiguous quotes are
> now reported on `PipelineResult.failures`. A server-side brief written
> against the previous report is still correct as written.

Rules the consumer can rely on:

- `input.slice(startUtf16, endUtf16) === quote` for every emitted anchor, where
  `input` is the exact string handed to the pipeline. Offsets are produced by
  locating the quote, never copied from the model.
- Offsets are **UTF-16 code units** (JS string indices), which is why they are
  named that way. The epic's stored anchors are code points; converting is the
  consuming slice's job. The quote is authoritative — a consumer holding its own
  normalized copy of the document should re-locate the quote there and derive
  positions from that, using `prefix`/`suffix` to pick the occurrence.
- An entity with nothing resolvable **omits the key entirely**. There is no
  `sourceAnchors: []` and no `sourceAnchors: null`. Test with
  `"sourceAnchors" in claim`.
- Claims carry one anchor per mention that resolved, in `mentionIds` order,
  deduped by `(startUtf16, endUtf16)`. Premises carry at most one. The
  conclusion premise never carries any — it is synthesized from a bare symbol
  and has no source relation.
- Only `createScholarPipeline` produces claim anchors. See the findings below
  for what `createScribePipeline` does.
- Unresolved and ambiguous quotes are reported as `severity: "warning"` entries
  on `PipelineResult.failures`, codes `SOURCE_ANCHOR_UNRESOLVED` and
  `SOURCE_ANCHOR_AMBIGUOUS`. The consuming slice was asked to measure the
  quote-location hit rate; this is the channel to measure it from, rather than
  diffing anchor counts against claim counts.

## What the request got wrong, corrected in place

1. **"Stop stripping `mentionIds`" would not have met the request's own goal.**
   The root-cause section names `stripCanonicalizerOnlyFields` as where
   provenance dies, which reads as "carry the ids through". Mention records are
   not part of the finalized response, so `["m3","m7"]` on a claim would
   reference an id space the consumer never receives. `mentionIds` and
   `suggestedSymbol` stay stripped; the trace is resolved into `sourceAnchors`
   instead, which is the actionable form. Recorded in `spec.md` before
   implementing.

2. **Mention spans are segment-relative, not input-relative.** The request
   describes mentions as carrying "their own spans" without saying relative to
   what. The `claim-mention-extraction` prompt is explicit: "relative to the
   SEGMENT'S TEXT (not the original input)". An implementation that forwards
   them raw produces offsets that drift further the deeper into a document a
   claim sits. The hint is `segment.span.start + mention.span.start`, and a
   fixture in `finalize-source-anchors.test.ts` fails if the composition is
   dropped.

3. **The spec's plan to declare optional finalize deps on both pipelines was
   wrong, and the suite caught it.** `optional(id)` on a stage a pipeline does
   not contain is a hard `PipelineConfigurationError: UNKNOWN_DEP` at DAG
   validation — and `ctx.get` outside `dependsOn` is a configuration error too,
   so finalize cannot simply probe. Corrected: `TFinalizeResponseV2Input` gained
   optional `segmentation` and `mentions`, the scholar factory declares the deps
   and passes the outputs, and the scribe factory does neither. This keeps the
   declaration and the read in the same file per pipeline instead of splitting
   them.

4. **"Assert the stage-call count is unchanged against the existing recorded
   run" does not work as stated.** A fixture's `*-recorded-llm.json` holds
   *more* records than a run makes calls — record mode replaces by request hash
   and never prunes, so entries from earlier recordings accumulate (11 records
   for 8 calls on `with-url-citation`). The assertion is instead against the
   pipeline's LLM-stage count directly: 8 for scholar, 2 for scribe, named
   constants in the two e2e drivers. That is what "no new LLM calls" actually
   means, and it fails loudly if a stage is added.

5. **Acceptance criterion 3 ("every relation-derived premise carries an
   anchor") was too strong.** One recorded quote in the corpus is not verbatim
   — see the findings. Dropping that anchor is the designed behavior, not a
   regression, so the e2e now asserts the invariant (everything emitted resolves
   against the input) and lets the goldens pin exactly which premises are
   anchored. The unit suite still pins the mechanism.

## Findings

- **Model quote fidelity for claims is 100% on the recorded corpus.** Every
  claim in all four fixtures with a non-null argument carries at least one
  anchor. This is the first time the pipeline's quotes have been checked against
  the input at all.
- **One relation quote in five is elided rather than verbatim.**
  `with-url-citation`'s r2 evidence reads
  `"global temperatures have risen significantly... Rising global temperatures
  cause..."` — the model joined two clauses with an ellipsis. It cannot be
  located, so that premise carries no anchor, which is exactly the designed
  degradation. Worth knowing for the epic's open question about whether fuzzy
  matching is needed: this failure is *not* one fuzzy matching would fix
  correctly, since the elided middle is real text the quote deliberately omits.
- **`createScribePipeline` currently produces no anchors at all.** Claims cannot
  be anchored — it has no segmentation or mention stage, and its `extract`
  prompt asks for synthetic mention ids. Premises *should* be anchorable from
  its `structure` relations, but that stage's prompt states an empty quote is
  acceptable and the recorded fixtures take that option, so every scribe
  evidence quote in the corpus is `""`. The mechanism works (a unit test proves
  it with a non-empty quote); the prompt is what withholds the data. Changing it
  would be a prompt edit and a re-record, both out of scope here — **worth
  filing as follow-up work** if the fast pipeline is expected to feed the
  origin-data feature.

## Rework findings, one by one

1. **HIGH, surrogate-split context — fixed.** `dropEdgeLoneSurrogates` in
   `buildAnchor` shrinks the window by one code unit rather than emit an
   ill-formed string. Two new locator tests: one asserting no lone surrogate
   survives with an emoji straddling the boundary on both sides, one asserting a
   pair that *fits* is kept whole. `String.prototype.isWellFormed` is ES2024 and
   this package targets ES2022, so the tests detect lone surrogates with a
   regex rather than widening the lib for a test convenience.
2. **MEDIUM, unchecked `ctx.input` — fixed.** `readInputText` returns `""` for
   any shape without a string `text`. Three new tests: a foreign
   `{ document }` input still assembles a full argument, emits no anchors, and
   `null` / a bare string do not throw. All three reproduced the reported
   `TypeError` before the fix.
3. **MEDIUM-LOW, model arithmetic in the hint — fixed.** `resolveSegmentStarts`
   locates each segment's verbatim text, scanning left to right behind a cursor
   so a repeated segment cannot collapse onto an earlier copy, falling back to
   the reported number only when the text is not found. Three new tests: a
   drifted segment span no longer misresolves a repeated mention, the same for a
   relation's evidence quote, and the fallback path when a segment was rewritten.
   The first test failed instructively — under drift *both* of the claim's
   mentions collapsed onto the first occurrence and deduped to a single wrong
   anchor, which is worse than the reported symptom.
4. **MEDIUM-LOW, silent drops — fixed.** `locateSourceAnchor` now returns
   `{ anchor, occurrences }`, and finalize emits `SOURCE_ANCHOR_UNRESOLVED` /
   `SOURCE_ANCHOR_AMBIGUOUS` warnings through `ctx.addFailure`. Five new tests
   cover: nothing unresolved on a clean fixture, an unresolvable mention quote,
   an unresolvable relation quote, a repeated quote reported as ambiguous with
   its occurrence count, and every note being a `warning`. An empty relation
   evidence quote is deliberately *not* reported — the fast pipeline's prompt
   explicitly permits it, so it is a legal "no span to cite" rather than a failed
   lookup, and reporting it would bury the real signal under one note per
   relation on every fast-pipeline run.
5. **LOW, `mapClaim` doc note — fixed.** The clause now names `mapPremise` too
   and says the field must be listed in *both* hooks, since claims and premises
   are anchored independently.
6. **LOW, call-count caveat — comment added** to both e2e drivers. The assertion
   itself is unchanged, as advised.

**Measured effect of the new warning channel on the recorded corpus:** exactly
one note across all five fixtures — the already-known elided quote on
`with-url-citation`'s r2. No ambiguity notes at all, and no unresolved mention
quotes. The channel starts with signal and no noise, which is the property that
makes a coverage drop detectable later.

## Round-2 findings, one by one

1. **R2-1 HIGH, stalled cursor — fixed, and it was a real regression.** The
   not-found branch left `cursor` behind the skipped segment, so the next
   segment could match a duplicate inside it; the pre-`cb1a772` code got that
   case right. Two changes rather than the suggested one-liner: the cursor now
   advances to `segment.span.end` on fallback, **and** the winner among
   candidates at or after the cursor is the one nearest the model's reported
   start rather than the first. The second is what makes the first safe — a
   cursor advanced by a model number that overshoots by one would otherwise make
   the next segment's scan miss its true position and take a later duplicate,
   converting one failure mode into another. New test reproduces the reviewer's
   exact case (12 instead of 53) and pins both the verbatim and paraphrased
   shapes; the old test only had a trailing segment, which is why it passed.
2. **R2-2 HIGH, drift lives in the mention term — fixed.** Confirmed by
   measurement: `with-url-citation` m1's segment is located at 0 and reported as
   0, so all 14 characters of error are in `mention.span.start`.
   `nearestOccurrence(segment.text, mention.text, mention.span.start)` yields
   exactly 74 / 142 / 224 on that fixture. Both halves of the hint are now
   located, with the model's number as tie-breaker only. Two new tests: a
   drifted mention span no longer misresolves a repeated mention, and the
   fallback when the mention is not in its segment. The **"accumulates with
   document length" claim was unsupported and is corrected everywhere** it
   appeared — the module comment, `docs/changelogs/upcoming.md`, and
   `docs/api-reference.md`. Measured drift is a flat 1.
3. **R2-3 MEDIUM, the corpus emits two notes, not one — corrected.** The claim
   was measured on the thorough pipeline alone. New
   `corpus-anchor-notes.test.ts` replays all ten recordings across both
   pipelines and asserts the exact note list, not just a count, so a new note has
   to be looked at. **Decision on suppressing notes under the fast pipeline: no.**
   The note is factually true — the model returned a quote that is not in the
   input, which is what the channel exists to say — and it is currently the only
   evidence that the fast pipeline fabricates evidence quotes rather than copying
   them. Suppressing it would mean teaching a deliberately pipeline-agnostic
   assembler which pipeline it is under, in order to hide a true signal. The fast
   pipeline's lack of anchors is already filed separately; when that is fixed
   these notes become directly actionable.
4. **R2-4 MEDIUM-LOW, `anchor.quote` — fixed.** `splitsSurrogatePair` discards a
   candidate range whose start or end falls between the halves of a pair.
   Discarding the range rather than trimming the quote is what preserves
   `input.slice(start, end) === quote`. Two new tests: half-pair quotes yield no
   anchor; a quote on a whole pair still anchors.
5. **R2-5 MEDIUM-LOW, N notes blaming the model — fixed.** Resolution is skipped
   wholesale when the input carries no text, and a single
   `SOURCE_ANCHOR_INPUT_UNAVAILABLE` is emitted with no quote in its context.
   New test asserts exactly one code and that the message does not echo the
   extracted text.

## Recorded, deliberately not fixed

- **`occurrences` counts on two bases.** `exactOccurrences` steps `from = at + 1`
  and therefore counts overlapping hits —
  `locateSourceAnchor("aaaa", "aa", 0).occurrences === 3` — while the
  whitespace-insensitive path uses `matchAll`, which does not. It affects the
  ambiguity note's message text only: the chosen range, the emitted anchor, and
  the output shape are all unaffected either way. Left as-is rather than
  normalized, because the note's job is "this was a tie-break, look at it" and
  neither count changes that answer.
- **`docs/changelogs/upcoming.md` carries `ending-hash="HEAD"`.** Every other
  changelog entry has a concrete hash. Pinned at version cut, along with the
  starting hash, rather than churned on every commit of an open branch.

## Verification

`pnpm run check` in the worktree, exit code 0:

```
> @proposit/proposit-core@3.3.0 check
> pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build

 Test Files  67 passed | 5 skipped (72)
      Tests  2100 passed | 14 skipped (2114)
   Duration  7.79s

[info] html generated at ./docs/api
```

(2077 → 2091 → 2100 tests: 14 added in round 1, 9 more in round 2.)

Beyond the suite:

- `git diff main..HEAD -- '*-recorded-llm.json'` is empty. No prompt changed and
  no recording was re-captured; the replay harness's prompt-hash guard would
  have raised `RecordedPromptStaleError` otherwise.
- Only the four scholar `v2-expected.json` files changed among the goldens. The
  five `scribe-expected.json` files are byte-unchanged, and
  `ambiguous-conclusion/v2-expected.json` is too (its argument is null).
- The regenerated goldens came from replay mode with no API key, via a throwaway
  harness that was deleted after use.
- No `*.tgz` in the package root, no `pnpm version`, no tag, no publish, no
  push.

## Documentation Sync

Re-evaluated over the whole reworked diff. The same three entries fired; the
rework's doc updates are in `c3ced9f`, the original pass in `b1f4cbc`:

- `docs/changelogs/upcoming.md` [Any-Code-Change] — commit range `68f2481` to
  `30c4411`, plus the three findings above.
- `docs/api-reference.md` [Public-API] — a "Source anchors" subsection under the
  ingestion pipelines (shape, the slice invariant, the offset unit, the
  omitted-when-empty rule, per-pipeline availability, `locateSourceAnchor`), and
  a pointer from `TParsedClaim` warning that a field-plucking `mapClaim` **or
  `mapPremise`** drops it. The rework added the well-formed-UTF-16 guarantee,
  the `TSourceAnchorMatch` return shape, a "Resolution notes" table for the two
  warning codes, the located-not-trusted segment-offset rule, and the
  foreign-input-shape behavior.
- `docs/release-notes/upcoming.md` [Public-API] — plain language.

Did not fire: `README.md` (both entries), `CLI_EXAMPLES.md`,
`scripts/smoke-test.sh` — no CLI or validation-rule change; `AGENTS.md`
[Routing] — no new easy-to-violate invariant and no new canonical doc route;
the engine/library JSDoc entries and `examples/arguments/*.yaml` — untouched
surfaces.

## Handoff

- This branch and the sibling origin-library branch both ship in **one**
  `@proposit/proposit-core` release, gated on consumer-side validation
  coordinated at the workspace root.
- The `proposit-server` slice that consumes this is blocked until then, and must
  add `sourceAnchors` to its `mapClaim` allowlist and its premise-persist path.
