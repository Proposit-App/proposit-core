# Upcoming changelog

## Changed

- Both structured-output schema converters (`typeboxToOpenAiSchema`, `typeboxToJsonSchema`) now project a free-text String field's length budget into the wire schema to steer the model below its declared `maxLength`, instead of dropping the budget entirely. For a free-text String with a `maxLength`, the converter emits a _shrunk_ `maxLength` (`floor(original * SHRINK)`, `SHRINK` default 0.9) and appends `; at most <shrunk> characters` to the field `description`. Exact-value String fields are exempt (kept at their original `maxLength`, no hint): a String declaring a `format` (e.g. `uri`) or a very small `maxLength`. Fields with no `maxLength` are unchanged. The shrink/hint logic lives in one shared helper (`projectStringLengthHint` + the exported `SHRINK` constant, `src/extensions/structured-output/length-hint.ts`); the two converters remain separate. On a respected-`maxLength` consumer (chat-completions → GBNF) the shrunk cap keeps output strictly below the true limit; on OpenAI strict mode `maxLength` is ignored, so the `description` hint is what steers. (`src/extensions/openai/structured-output.ts`, `src/extensions/chat-completions/structured-output.ts`)
- The OpenAI Responses request body now sets `text.verbosity: "low"` on both assembly sites — the initial request (`provider.ts`) and the background submit/retrieve body (`openai-retrieval.ts`) — via a shared `buildResponseTextBlock` helper, so background-mode ingestion gets the same terse-output steering. `TOpenAiResponsesRequestBody.text` gains a `verbosity?: "low" | "medium" | "high"` slot. Set unconditionally (ingestion runs GPT-5-family models, which support it).
- The basics citation `url` field (`src/extensions/basics/schemata.ts`) now declares `format: "uri"`, marking it as an exact value so the length steering does not shrink a URL's `maxLength`. Inert at runtime (no TypeBox format registry is configured). `format` is read only to make the exemption decision — it is **not** projected onto the wire schema, so the converters still emit only structural fields (OpenAI strict mode rejects string formats outside its fixed set, and `uri` is not one of them).

## Fixed

- Claim titles and other free-text ingestion fields no longer routinely overshoot their declared length limit and surface to the user cut off mid-word. The post-hoc clamp (`clampMaxLengthStrings`) remains the last-resort safety net and still truncates against the **original** (unshrunk) schema; the shrink lives only in the converters' throwaway wire schema, never in validation.

## Added

- A debug-gated `output:truncated` breadcrumb (behind `PROPOSIT_PIPELINE_DEBUG`, via `debugMaxLengthTruncation`) emitted when the safety-net clamp truncates an over-long field — surfacing the field path, the limit, and the original length so devs can see whether the length steering is still letting overshoots through.

## Tests

- `test/extensions/structured-output/length-hint.test.ts` — the shared length-hint projection (shrink + floor + hint wording; no-maxLength untouched; `format`/tiny-`maxLength` exemption).
- Added free-text-steering cases to both converter suites (`test/extensions/openai/structured-output.test.ts`, `test/extensions/chat-completions/structured-output.test.ts`).
- `test/extensions/pipelines/stages/schema-converter-regression.test.ts` — pins the real ingestion claim-record schema: the free-text `title` shrinks to 45 with the appended budget while the exact-value `url` keeps its original limit.
- Added `text.verbosity: "low"` assertions to the initial request body and the background submit body (`test/extensions/openai/provider.test.ts`).
- `test/pipelines-debug-log.test.ts` — the `output:truncated` breadcrumb (and that the clamp uses the original, unshrunk limit).
- Re-keyed the v2 + scribe golden-corpus recordings for the `format: "uri"` schema change (hash + the one added `format` annotation per affected record).
