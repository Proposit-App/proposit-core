# Outcome

Scribe now emits claim source anchors. Both halves of the diagnosis in
`initial-request.md` held, and both were addressed.

## What changed

`src/extensions/pipelines/ingestion/scribe/`

- `schemas.ts` — `buildExtractOutputSchema(extension)`: the per-extension
  canonicalization schema widened with the mention slot's item shape, plus
  `TScribeExtractOutput`. Separate from the shared canonicalization envelope
  because that one is `additionalProperties: false`.
- `extract-stage.ts` — the prompt asks for one mention per place a claim is
  stated, `text` copied character for character, `span` documented as an
  approximate hint. The canonicalization adapter now picks two keys rather than
  passing the widened output through. New `extractMentionAdapterStage`.
- `structure-stage.ts` — `evidence` is now required to be
  `{ segmentIds: [], quote: "" }` rather than offered as an option, with the
  reason stated in the prompt: the model is shown claims, not text.
- `scribe.ts` — the mention slot is passed to finalize; the DAG comment and the
  false premise-anchor claim are corrected.

`src/extensions/pipelines/ingestion/canonical-stages.ts` —
`INGESTION_SCRIBE_STAGE_IDS` gains `claim-mention-extraction` at index 3.

## Why no segmentation stage

Scribe's whole premise is two LLM calls. Locating a claim in the text does not
need a third, because anchor resolution already treats quoted text as the fact
and offsets as a tie-break: `buildAnchorByMentionId` falls back to the mention's
own reported start when no segment is found, then locates the quote itself. The
mentions ride along on `extract`, the one stage that is given the input text.

## What is deliberately not fixed

Premises carry no source anchors on this pipeline. Giving `structure` the input
text would let it quote for real, but that is the expensive half of a pipeline
whose reason to exist is being cheap — and claim anchors are what a consumer
hangs a per-claim source cue off anyway. `structure` is now asked for no quote
instead of one it cannot supply, so the warning channel stays honest.

## Also fixed: the locator's first-character tolerance

Live runs surfaced a second, independent cause of lost anchors that the prompt
could not fix. `locateSourceAnchor` gains a third tier — exact, then
whitespace-insensitive, then both again with the quote's first character re-cased.

Two paid runs against the reporting document showed the model re-casing the first
character of a span in **both** directions: a span lifted from mid-sentence came
back capitalized (`the world, to each individual` → `The world, …`), and after the
prompt was tightened against that, spans lifted from sentence starts came back
lower-cased (`This aspect` → `this aspect`, `Let us suppose` → `let us suppose`).
Every one was a single-character miss. Prompt-wrangling the first character is
fighting the tide, so the tolerance moved into the locator, where it also helps
scholar.

It cannot rescue a paraphrase: every character after the first must still match,
and the anchor is built from the range in the input, so the document's casing is
what gets stored.

## Verification

- `pnpm run check` green: 2338 tests, typecheck, lint, build.
- Three new cases in `scribe.test.ts`, written before the fix and failing then:
  anchors slice the input back to their quote; an unlocatable quote costs the
  anchor and one warning but not the argument, and leaves the key absent rather
  than empty; no relation reaches anchor resolution.
- All five golden fixtures now carry claim anchors (2–4 each), where every
  scribe golden previously had zero.

Live runs against the reporting document's own text, through a tarball of this
build installed in `proposit-server`, with real `gpt-5.4-mini` calls:

| run | claims | anchored | mis-sliced | anchor notes |
| --- | --- | --- | --- | --- |
| 6,000-char slice, before the locator tier | 9 | 8 | 0 | 1 |
| same slice, after | 12 | 12 | 0 | 0 |
| **full 96,963-char document** | **9** | **9** | **0** | **0** |

"mis-sliced" counts anchors where `input.slice(startUtf16, endUtf16) !== quote` —
the invariant that makes an anchor mean anything. Zero throughout.

`pnpm run check` in `proposit-server` against the same tarball: 3351 tests,
compiled successfully.

## Caveat on the fixtures

The recorded `extract` responses were hand-extended with mentions rather than
re-recorded against the live API — this repo has no `.env.development` and no key
was available. They are the previously recorded model output plus verbatim spans
taken from each fixture's `input.txt`. Request hashes were recomputed by driving
`createRecordingLlmProvider` in record mode against a stub, so the prompt-drift
guard still works, but these five recordings no longer represent a real model's
response to the new prompt. **Re-record them with `INGESTION_TEST_RECORD=1` and a
real key** — that is also the only thing that proves the new prompt actually
gets verbatim quotes out of `gpt-5.4-mini` rather than paraphrases.

## Consumer impact

Needs a core publish and a repin in `proposit-server`. Two server tests assert
the old stage list and will fail until updated:
`components/client/pipeline/__tests__/canonical-stages.test.ts` (expects length
10) and `use-pipeline-status.test.ts` (expects `stages[5]` to be
`scribe-structure`, now index 6). The server's label map already carries
`claim-mention-extraction`, so its progress UI needs no change.

No server code change is needed for the anchors themselves —
`collectRequestedAnchors` + `seedOriginDataFromIngestion` already handle a
populated `sourceAnchors`.
