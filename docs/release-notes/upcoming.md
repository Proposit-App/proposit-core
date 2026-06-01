# Upcoming release notes

## Per-stage retry control for ingestion pipelines

**You can now override the retry policy of an individual ingestion stage.** The pipeline LLM-options seam (`TIngestionLlmOptions`, the `llm` knob on the v1 and v2 ingestion factories) gained a `retry` field alongside the existing `model`, `maxOutputTokens`, and `reasoningEffort` knobs. Set it per pipeline (`defaults`) or per stage (`overrides`) to tune `maxAttempts`, `backoffMs`, or which failure reasons retry. The most common use is turning off automatic retries by dropping `"transient"` from `retryOn`. Note that dropping `"transient"` suppresses retries for every transient cause — network timeouts, server 5xx errors, and output-truncation — not just timeouts. When the `retry` knob is omitted, behavior is exactly as before (two attempts, retrying schema-validation and transient failures).

## New pre-call event for live pipeline observability

**Pipeline observers can now see a stage's prompt the instant its model call begins.** A new `stage:llm-request` event fires just before each LLM call is sent, carrying the exact system and user prompts for that attempt (including any retry annotation) and the attempt number. Previously the prompts were only visible after the call returned, bundled into the post-call event. This lets a UI show a stage's Input the moment it starts working, rather than waiting for the response. The existing post-call event is unchanged, so existing observers keep working without modification.
