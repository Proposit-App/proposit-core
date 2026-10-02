# Outcome: stream LLM text deltas to executeTurn and executePipeline callers

Branch `feat/stream-text-deltas`, off `main` at 5.4.3. Planned to ship in 6.0.0 (the requester's decision on the maintainer's behalf), so the new `TPipelineEvent` member is listed as Breaking.

## What shipped

| Task | Commit | What |
|---|---|---|
| 1-2 | `26603076` | The default foreground stream now passes `onResponseId` to `readSseEnvelope`, so `onResponseCreated` and `stage:llm-response-created` fire mid-flight. Test first: it failed with `expected [] to deeply equal [ 'resp_fg' ]`. JSDoc and `docs/api-reference.md` reworded in the same commit. |
| 3 | `a5f88e2f` | `parseSseEvent` recognises `response.output_text.delta`, and `readSseEnvelope` takes an `onTextDelta` callback. New `test/extensions/openai/sse-parsing.test.ts`; the delta test failed first. The guard for a non-string `delta` was proved by removing it, which turned its test red. The three wrongly shaped delta fixtures in `provider.test.ts` are corrected. |
| 4-5 | `75d898e3` | `fetchResponseEnvelope` passes the callback on both streaming branches, and `TLlmRequest.onTextDelta` is added and passed through by the OpenAI provider. Provider tests cover: foreground deltas arrive before `respond()` resolves; the response is the same with or without deltas; background-stream mode. The two delta tests failed first. |
| 6 | `b3f376f8` | The `stage:llm-text-delta` event, emitted per attempt from `runLlmStageAttempt`, and the mock provider's `deltas` and `lateDeltas`. Five tests, each failing first: the order of events, retry attempts, `executeTurn`, abort, and nested-pipeline prefixing. The abort guard and the nested prefix case were each proved by removing them, which turned their tests red. |
| 7 | `6739f9ce`, `0c19850c` | API reference, changelog, release notes, the published skill's pipelines doc, and the API surface. |

`pnpm run check` passes at `0c19850c`: 2763 tests passed, 13 skipped.

## The delta wire shape

The plan made confirming the shape a precondition. It is confirmed: OpenAI's reference, "Responses streaming events" (https://developers.openai.com/api/reference/resources/responses/streaming-events.md, schema `ResponseTextDeltaEvent`, read 2026-10-02), gives `delta: string` at the top level, beside `item_id`, `output_index`, `content_index`, `sequence_number` and `logprobs`. That is what the spec assumed.

## What the plan or spec got wrong

- **Line numbers.** Both were written at 5.0.0 and every citation had drifted by 5.4.3. Each was re-found before editing; the code at each spot was as described.
- **A sixth event site the plan missed.** `prefixSubPipelineEvent` (`src/lib/pipelines/stage-helpers.ts`) switches over every event kind with a never-check. The new kind failed compilation there, as that check is designed to do, and needed a case so a nested stage's deltas get the prefixed stage id. The plan's sweep covered only the path from the stream to `ctx.emit`, not the event's consumers inside core.
- **Abort needed a guard, not just a test.** Criterion 6 says no delta follows an abort. Nothing in the plan made that true when a provider delivers a buffered chunk after the abort. The emitter now drops chunks once `ctx.signal` is aborted, and the mock's `lateDeltas` is what proves it.
- **Docs the plan said would not fire.** The published skill's `pipelines.md` describes `onEvent`, and it gained one sentence about the event. The plan's documentation list predates that skill doc.
- **The foreground id guarantee.** The spec said the fix "narrows" the background-only caveat. The rewording keeps the recovery guarantee background-only, because a foreground response is not guaranteed to keep generating after a disconnect; only the timing of the id changed.
- **The test file paths.** The plan named `test/pipelines.test.ts` and `test/conversation.test.ts`; they now live at `test/pipelines/pipelines.test.ts` and `test/conversation/conversation.test.ts`.

## Not done, and why

- **The live suite** (`RUN_LIVE_LLM_TESTS=1`) was not run: no API key in this session. The shape is confirmed from the reference instead. The maintainer can run the two live suites named in the plan before release.
- **A consumer trial** against a tarball was not done in this session; the release-notes example shows the intended use.
- **`reconnectStream`**, added after the spec, reads a stream but takes no request and so no `onTextDelta`. Reconnecting is a recovery path for a dropped background response, not a live view, so it is left as is. It could gain an optional callback later without breaking anything.

## Merging note

`docs/changelogs/upcoming.md` and `docs/release-notes/upcoming.md` are new on this branch and also exist on `feat/response-arguments`, so combining the two branches needs those files merged by hand.
