# Upcoming

## Breaking

- `TPipelineEvent` gains a member, `stage:llm-text-delta`. A `switch` over
  `kind` with no `default` stops compiling until it handles the new kind.

## Added

- `stage:llm-text-delta` pipeline event (`{ stageId, attempt, delta, at }`),
  emitted by `llmStage` once per chunk of streamed assistant output text,
  between `stage:llm-request` and `stage:llm-call`. Not emitted after the
  caller's signal aborts. Prefixed inside `subPipelineStage` like the other
  per-stage events.
- `TLlmRequest.onTextDelta`: an optional per-chunk callback. The OpenAI
  provider calls it in both streaming modes; `readSseEnvelope` parses
  `response.output_text.delta` frames (a top-level `delta` string) and passes
  each chunk to it, unaccumulated.

## Fixed

- The OpenAI provider's default foreground stream dropped the
  `response.created` id instead of passing it to `onResponseCreated`, so
  `stage:llm-response-created` fired only at completion. It now fires
  mid-flight in both streaming modes for a call that makes a single request.
  A function-tool loop still reports its id at completion, since a
  mid-flight id would be the first round's rather than the last round's that
  `stage:llm-call` carries.

## Tests

- SSE fixtures for `response.output_text.delta` now use the documented wire
  shape (top-level `delta`, not nested under `response`).
- The mock provider takes `deltas` and `lateDeltas` on `ok` and
  `schema-invalid` responses.
