# Plan — Carry ingestion provenance through pipeline finalize

Code lands in the worktree `.worktrees/ingestion-provenance` on branch
`ingestion-provenance`; lifecycle artifacts land on `main` in the primary
checkout. One commit per task. The suite is green at every task boundary.

Ordering reason: the locator is the only non-trivial logic in the change, so it
is built and pinned by its own unit tests **first**, in isolation, with no
finalize wiring to hide a bug behind. Wiring (task 2) then has a proven
primitive. The recorded fixtures (task 3) move last among the code tasks because
they are deep-equal targets — regenerating them before the behavior is final
would just mean regenerating them twice.

## Tasks

### 1. Quote locator + anchor type

**Changes:** new `src/extensions/pipelines/base/source-anchors.ts` exporting
`TIngestionSourceAnchor` and `locateSourceAnchor(input, quote, hintUtf16)`.
Re-export both from `src/extensions/pipelines/base/index.js`. Constant
`SOURCE_ANCHOR_CONTEXT_CHARS = 32`.

Ladder: reject empty/whitespace-only quote → all exact occurrences, pick the
start nearest the hint → whitespace-insensitive retry (any whitespace run in the
quote matches any whitespace run in the input) → `undefined`. On a
whitespace-insensitive hit the emitted `quote` is the *input's* text for the
matched range.

**Verified by:** new `test/extensions/pipelines/source-anchors.test.ts`, written
before the implementation. Cases: exact single occurrence; repeated occurrence
resolved by hint (with a hint that a first-match rule would get wrong); hint
past the end of the input; quote absent → `undefined`; empty and whitespace-only
quote → `undefined`; line-break-vs-space quote resolved by the retry, with the
emitted quote equal to the input's text; prefix/suffix clamped at both ends
(anchor at offset 0 → empty prefix; anchor at the end → empty suffix); the
invariant `input.slice(startUtf16, endUtf16) === quote` on every returned anchor.

### 2. Attach anchors in finalize

**Changes:**

- `src/extensions/pipelines/base/finalize-response-v2.ts` — read the optional
  `segmentation` and `claim-mention-extraction` outputs and `ctx.input.text`;
  build a mentionId → anchor map (hint = `segment.span.start +
  mention.span.start`, the composition mention spans require); attach
  `sourceAnchors` to each claim from its `mentionIds`, in order, deduped by
  `(startUtf16, endUtf16)`; attach `sourceAnchors` to each relation-derived
  premise from `evidence.quote`, hinted by the smallest segment start among
  `evidence.segmentIds`. Omit the key when the list is empty. Correct the
  `stripCanonicalizerOnlyFields` comment.
- `src/extensions/pipelines/ingestion/scholar/scholar.ts` and
  `.../scribe/scribe.ts` — add `optional(STAGE_IDS.segmentation)` and
  `optional(STAGE_IDS.claimMentionExtraction)` to `finalize.dependsOn`.

**Verified by:** new cases in
`test/extensions/pipelines/finalize-response-v2.test.ts`, driven by a synthetic
`TStageContext` (the file's existing idiom): a claim with two mentions gets two
anchors; a claim whose mention text is absent from the input gets no
`sourceAnchors` **key** (asserted with `in`, not against `[]`); a
relation-derived premise carries its evidence quote; the conclusion premise
carries no key; with segmentation and mention stages absent (the scribe shape)
claims carry no key while relation-derived premises still do; every emitted
anchor satisfies `input.slice(start, end) === quote`.

### 3. Regenerate the recorded expected fixtures

**Changes:** the five `test/extensions/pipelines/fixtures/*/v2-expected.json`
and `fixtures/straightforward/scribe-expected.json`, regenerated from replay
mode with no API key. `*-recorded-llm.json` files are not touched.

**Verified by:** `pnpm exec vitest run test/extensions/pipelines/` green;
`git diff --stat` over `**/-recorded-llm.json` empty; and the review of the
regenerated diff confirming the only new keys are `sourceAnchors`.

### 4. Fixture-level provenance assertions

**Changes:** `test/extensions/pipelines/v2-e2e.test.ts` gains a per-fixture
assertion block over the replayed output — every claim has ≥1 anchor, every
relation-derived premise has one, every anchor's slice equals its quote, every
anchor's prefix/suffix matches the input's neighbourhood — plus an assertion
that the replayed LLM call count equals the recorded entry count for that
fixture (the no-new-calls check; the existing `RecordedPromptStaleError` guard
already covers prompt drift). Same call-count assertion added to
`scribe-e2e.test.ts`.

**Verified by:** the suite. This is the task that measures model quote fidelity
for the first time; a failure here is a finding to report in `outcome.md`, not a
test to loosen.

### 5. Full check

**Changes:** none beyond fixes the check surfaces.

**Verified by:** `pnpm run check` in the worktree, output recorded verbatim in
`outcome.md`.

## Documentation Sync

Evaluated against every entry in `AGENTS.md`. Scheduled as one block after the
code tasks, answered in a single pass over the finished diff.

**Expected to fire:**

- **6. `docs/changelogs/upcoming.md` [Any-Code-Change]** — always fires. Record
  the new module, the finalize behavior, and the commit range.
- **7. `docs/api-reference.md` [Public-API]** — fires. The file documents
  `TParsedClaim` (`:1976`), `TParsedArgumentResponse` (`:1950`),
  `finalizeResponseV2` as a `pipelines/base` export (`:1807`), and both pipeline
  factories (`:1811`, `:1815`). The new `sourceAnchors` field and the
  `TIngestionSourceAnchor` / `locateSourceAnchor` exports belong there,
  including the explicit statement that offsets are UTF-16 code units into the
  pipeline input.
- **8. `docs/release-notes/upcoming.md` [Public-API]** — fires, plain language:
  an ingested argument now says which part of the original text each claim and
  each inference came from.

**Evaluated, does not fire:** `README.md` [Public-CLI-API] and
[Validation-Rules], `CLI_EXAMPLES.md`, `scripts/smoke-test.sh` (no CLI surface
changes, no validation rule changes); `AGENTS.md` [Routing] (no new
easy-to-violate invariant and no new canonical doc route — the mention-span
composition rule is a pipeline detail that belongs in `api-reference.md`); the
five engine/library interface JSDoc entries and `proposit-core.ts` /
`argument-library.ts` / `fork-library.ts` / `fork-namespace.ts` [Public-API]
(the engine and library surfaces are untouched); `examples/arguments/*.yaml`
[Argument-Schema] (no core or CLI argument-schema change — the finalize output
is not the YAML import shape).

Tasks 6-8 are one commit, separate from the code commits.

## Verification

Beyond the suite:

- **No new LLM calls, confirmed structurally as well as by assertion.** The
  recorded request/response files are unchanged byte-for-byte, which is only
  possible if no prompt and no stage set changed. `git diff` over
  `**/*-recorded-llm.json` must be empty at the end of the branch.
- **No version cut, no tag, no publish, no push.** The release is grouped with
  the sibling core slice and gated on consumer-side validation at the workspace
  root.
- **`outcome.md` must state the exact finalized field names**
  (`sourceAnchors`, and within each entry `quote` / `startUtf16` / `endUtf16` /
  `prefix` / `suffix`) and that they attach to both claims and premises. The
  consuming server slice reaches core's output through a field allowlist
  (`ArgumentParser.mapClaim` → `persistParserOutput`) that drops unknown fields
  silently, so an approximate description there costs that slice a debugging
  session.
