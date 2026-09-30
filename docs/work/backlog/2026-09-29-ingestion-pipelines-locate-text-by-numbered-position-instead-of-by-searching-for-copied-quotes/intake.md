# Ingestion pipelines locate text by numbered position instead of by searching for copied quotes

## What should change

Before any model stage runs, the ingestion pipelines (the base stages, Scribe, and Scholar) should prepare the input text in a fixed, deterministic way: split it into numbered sentences (and, if needed, numbered words within a sentence). The model then refers to text by those numbers instead of copying the words and reporting character positions. The code turns the numbers into exact positions, which are correct by construction.

That removes the need for most of `src/extensions/pipelines/base/source-anchors.ts`: the whitespace-insensitive match, the first-letter case flip, both rules in `approximateRange` ("reworded" and "joined") and their tie-breaking rules, and the arithmetic that adds a segment's model-reported start to a mention's model-reported offset (`finalize-response-v2.ts:244`, `:395-403`). To catch a wrong but in-range number, the model may still send its quote, and the code checks it only against the sentence it named. That check is local, with no search of the whole document.

## Why

The model is currently asked to copy free text, and the code then guesses where the copy came from. Every new way the model miscopies has added a layer to `source-anchors.ts` (whitespace, 68f2481; re-casing, 016554e; split emoji, a03e2c4 and bd2b2bb; reworded and spliced quotes, 7d95154 and ae411db). The file will keep growing. The anchors now also decide argument structure, not only highlighting: `scribe/source-attachment.ts:57` (`mentionRange`) uses a mention's position to decide which claim a linked source supports, so an approximate match can attach a source to the wrong claim.

## Requirements from the user

- **Deterministic.** The same input text must always produce the same prepared text and the same numbering: no model involvement, no dependence on locale or runtime. This applies to the preparation for argument ingestion and to anything feeding origin-document source associations.
- **Documented for human readers.** Describe the text preparation step by step in user-facing documentation (README.md, or a reference document a human reader will find from it), so it is clear what happens to text that enters the system. Code comments and the API reference alone are not enough.

## Things to settle in the spec

- Sentence splitting rules (abbreviations, URLs, quoted speech, line breaks, markdown links), and whether word numbers are needed or sentence numbers plus a local check are enough.
- How this relates to `normalizeOriginText` (`src/lib/utils/origin-text.ts`). Stored origin anchors are code-point offsets into text that function produced, so its output must not change. Ingestion positions should be expressible against origin documents without a second, different normalization.
- `locateSourceAnchor` is exported from the `base` subpath. Removing or narrowing it is a small breaking change, so a minor version.
- Measure first: re-run the recorded corpora and count how often each existing matching step fires, and check that numbered positions from the model are more reliable than its copying.
- Prompts, stage schemas and both recorded golden corpora change and need re-recording.

## Origin

The user was reading `src/extensions/pipelines/base/source-anchors.ts` on 2026-09-29, concerned that `approximateRange` does too much. Discussion in the proposit-core session traced the complexity to the design (the model copies text; the code searches for it), and the user chose pre-processing the text so the model returns positions.

## References

- `2026-09-25-scribe-import-attaches-every-linked-source-to-the-claim-it-supports` (completed): added the approximate matching this would replace, and the position-based source attachment that depends on it.
- A wider request was raised separately: one deterministic, documented preparation policy for every text input, in this library and in the applications that use it. This item's ingestion preparation should be one instance of that policy.
