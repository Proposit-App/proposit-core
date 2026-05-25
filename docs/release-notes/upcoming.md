# Upcoming release notes

## New `stage:llm-call` event for LLM-backed stages

Added a new `stage:llm-call` variant to the `TPipelineEvent` union. Every
LLM-backed stage (`llmStage`) now emits one event per LLM-call attempt —
including schema-failed attempts whose retry is about to fire — carrying
the actual prompts sent (system + user, with the as-sent user message
including any retry-suffix appended on attempt 2+), the raw provider
output, and the call's token usage.

A new optional `validationError` field is set when the output failed
`outputSchema` validation and a retry will fire; it is `undefined` when
the schema accepted the output. The payload shape is identical on
success and validation-failure — `validationError` is the only
discriminator, so consumers can write per-attempt rows uniformly.

Consumers (for example, a server-side observability bridge writing
per-stage LLM I/O to a database for later inspection) can subscribe to
this event to capture full per-attempt prompts and outputs without
hooking into the `TLlmProvider` interface or wrapping individual stage
implementations.

Deterministic stages do not emit `stage:llm-call` events. The thrown-
error branch in `llmStage` (transient/rate-limit/non-retryable LLM
errors) also does not emit — there is no response payload to surface
when the provider threw before returning.

This is an additive change to the public `TPipelineEvent` union; existing
consumers that exhaustively switch on `event.kind` will see TypeScript
flag the new variant at compile time and must extend their switch (the
no-op `return event` branch is sufficient if the consumer doesn't care
about this kind).
