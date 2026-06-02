# Upcoming changelog

Commit range: `v1.7.2..HEAD`.

## Ingestion Task Controls — per-stage retry override + pre-call stage-input event (`0ec6c91..a37628d`)

Two additive edges batched for the Ingestion Task Controls initiative. Edge 1 serves the server's no-auto-retry control (C2); Edge 2 serves the "stage Input viewable on start" affordance (A2).

### Added

- **`retry?: Partial<TRetryPolicy>` on `TLlmStageOptionsOverride`.** A caller can now override a stage's framework retry policy through the existing `TIngestionLlmOptions` seam (`defaults` / per-stage `overrides`). Threaded through `resolveLlmStageOptions` as a straight pass-through — the resolver does **not** merge it against `DEFAULT_RETRY_POLICY` (last-writer-wins on the whole `retry` object, like the scalar knobs); `llmStage` still owns the shallow merge over the default. Every LLM stage factory (v1 `parse-argument` + the 8 v2 stages) now forwards `retry: options?.retry` to `llmStage`. Default behavior is unchanged when `retry` is omitted. (`0ec6c91`)
    - The primary consumer is the server's no-auto-retry toggle, which drops `"transient"` from `retryOn`. Dropping `"transient"` disables the retry for **all** transient causes — network/undici timeouts, 5xx, AND `incomplete/max_output_tokens` truncation — not timeouts alone, because every non-Abort transport error and the truncation case both classify as `"transient"`. Timeout-only precision would require a new retry reason (out of scope for this minor).
- **New `TPipelineEvent` variant `{ kind: "stage:llm-request"; stageId; attempt; prompts; at }`.** Emitted from `llmStage` inside the retry loop after the attempt counter increments and the request is built, immediately **before** `respond()`. `prompts.user` is the message as-sent on this attempt (including any retry-suffix). A retried attempt fires a second `stage:llm-request` with the incremented `attempt`; deterministic stages emit none. Per-attempt order is `stage:start → stage:llm-request → stage:llm-call → stage:end`. The existing post-call `stage:llm-call` event is unchanged. (`a37628d`)

### Changed

- `prefixSubPipelineEvent` (the only exhaustive `switch (event.kind)` in core) gains a `case "stage:llm-request"` plus a `default` `never`-exhaustiveness guard so any future variant fails compilation rather than being silently dropped when forwarded from a sub-pipeline. (`a37628d`)

### Tests

- Edge 1: `resolveLlmStageOptions` retry pass-through precedence; the real C2 path through `createIngestionV2Pipeline` — a `retryOn: ["schema_validation"]` override makes a transient error fail-fast (no retry) while a schema-validation failure still retries once; the default policy still retries a transient error. (`0ec6c91`)
- Edge 2: `stage:llm-request` fires once before `stage:llm-call`/`stage:end` carrying prompts + attempt + `at`; single-attempt and retried-attempt event ordering; deterministic stages emit none. Existing `stage:llm-call` exact-sequence assertions updated for the interleaved request event. (`a37628d`)

### Docs

- `docs/api-reference.md`: documented the `retry?` override knob (merge semantics + the transient-breadth caveat) and the `stage:llm-request` event; added the variant to the `TPipelineEvent` union list.
