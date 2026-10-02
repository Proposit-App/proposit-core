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
- **`reconnectStream`** (on main since `6e690549`, before the spec; the spec's sweep of `readSseEnvelope` callers missed it) reads a stream but takes no request and so no `onTextDelta`. Reconnecting is a recovery path for a dropped background response, not a live view, so it is left as is. It could gain an optional callback later without breaking anything.

## Merging note

`docs/changelogs/upcoming.md` and `docs/release-notes/upcoming.md` are new on this branch and also exist on `feat/response-arguments`, so combining the two branches needs those files merged by hand.

## Fixes after the verify assessment (2026-10-02)

The read-only verify assessment found all nine criteria met, the wire shape confirmed against OpenAI's reference, and the suite green. It also found one defect, which the plan and spec both missed, and three gaps. All are now fixed:

- **D1, the defect.** For a stage with function tools on the default foreground stream, the provider sends one request per round. The foreground id fix made `stage:llm-response-created` report the first round's id mid-flight, while `stage:llm-call` reports the last round's. Before the fix the two agreed. So a function-tool loop now leaves the mid-flight id uncalled, and its id arrives at completion as before; only a call that makes a single request reports it mid-flight. Written test first (`a1e09f58`): the new stage-level test failed with `expected [ 'resp_round1', 'resp_round2' ] to deeply equal [ 'resp_round2', 'resp_round2' ]`.
- **G1.** Text a model writes in an earlier tool round streams under the same `attempt` as the final answer. That is documented now in `TLlmRequest.onTextDelta`, the API reference and the release notes (`54b6608a`). Marking round boundaries was not added: no built-in stage uses function tools, and it can be added later without breaking anything.
- **G2.** The stale comments that described mid-flight ids as background-only (`src/lib/pipelines/types.ts`, published through typedoc, and `llm-stage-helpers.ts`), and the provider's "single round" comment, are rewritten.
- **G3.** The id event says nothing about which mode produced it. Not changed: the documentation already says recovery is guaranteed only for background-stream responses, and a consumer chooses its own provider mode, so it knows which mode it is in.
- **Minor.** The outcome's date for `reconnectStream` is corrected above. The small object the parser allocates per delta frame whether or not anyone listens is left as it is; it is negligible next to the `JSON.parse` every frame already does.

`pnpm run check` passes at `54b6608a`: 2764 tests passed, 13 skipped.
