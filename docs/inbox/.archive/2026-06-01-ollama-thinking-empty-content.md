# OllamaProvider: thinking-model stages return empty content ("no assistant text content")

**Filed by:** proposit-server (consumer)
**Date:** 2026-06-01
**Affects:** `@proposit/proposit-core` `extensions/ollama` — `OllamaProvider` (`dist/extensions/ollama/provider.js`), installed version **1.7.0**
**Severity:** High for local-LLM dev — the documented default Ollama model (`qwen3.6:latest`) cannot complete the v2 ingestion pipeline.

## Summary

When `OllamaProvider` runs a **thinking** model (e.g. `qwen3.6:latest`) against a structured-output (`format`) stage, the model can emit its entire answer in the **thinking channel** and return **empty `message.content`**. The provider reads only `message.content`, so it throws:

```
SchemaValidationLlmError: Ollama chat response carried no assistant text content.
```

…which is classified as a transient `LLM_TRANSIENT_ERROR`, retried once, fails again the same way, and aborts the stage — and with it the pipeline.

This reproduces deterministically on the v2 `claim-mention-extraction` stage with `qwen3.6:latest`. It is independent of concurrency and of machine sleep (verified).

## Reproduction (direct, faithful to the provider's request shape)

A standalone script replicating the provider's exact request — the `claim-mention-extraction` system prompt, the `ClaimMentionExtractionOutputSchema` run through `typeboxToJsonSchema`, `temperature: 0`, `num_ctx: 32768`, `stream: true`, against a 2-segment input — produced:

| Variant | `think` | wall time | `thinkingChars` | `contentChars` | result |
|--------|---------|-----------|-----------------|----------------|--------|
| A (faithful, provider default) | on (model default) | ~15–17 min | very large | **0** | ❌ empty content → "no assistant text content" |
| B | `false` | **12 s** | 0 | 483 | ✅ valid `{ "mentions": [ … ] }` object |

Variant B's output was schema-perfect (object envelope with `mentions[]`, each `{ mentionId, segmentId, text, span:{start,end} }`) — **not** a bare array.

## Root cause

Two compounding facts in `OllamaProvider`:

1. **Thinking is left ON deliberately.** `runChatLoop` builds the chat request with no `think` field, so Ollama uses the model default (ON for qwen3). The code comment cites a prior finding that `think: false` "degrades structured-output fidelity (the model drops the required object wrapper → bare array, failing `Value.Check`)". **That finding does not reproduce when a `format` schema is set** (see Variant B): the Ollama structured-output grammar enforces the object envelope, so `think: false` yields a valid object. The prior finding was likely observed without `format`, or on a different model/version.

2. **`collectStream` drops the thinking channel.** It accumulates `content += msg.content ?? ""` but never reads `msg.thinking`. `respond()` then throws when `content === ""`. So even when the model *did* produce the answer (in the thinking channel), the provider discards it.

There is also **no way for a consumer to disable thinking** — `TOllamaProviderConfig` exposes `baseUrl`, `client`, `importOllama`, `importUndici`, `requestTimeoutMs`, `numCtx`, `stream`, `maxToolCallRounds`, but **no `think`**. The only consumer workaround is to inject a wrapped SDK `client` or switch models.

## Proposed fix (any one, ideally 1 + 2)

1. **Expose `think` on `TOllamaProviderConfig`** and thread it onto the chat request (default unchanged to avoid surprises, or default to `false` when a `format` schema is present — see #3). This alone unblocks consumers (`new OllamaProvider({ think: false })`).
2. **Empty-content fallback to the thinking channel.** In `collectStream`/`respond`, when `content === ""` but a thinking trace was produced and a `format` schema was requested, attempt to parse the structured object out of the accumulated thinking (or surface the thinking so the caller can). Prevents silently discarding a usable answer.
3. **Default `think: false` when a `format` (structured output) schema is provided.** The grammar enforces the object shape, so the historical "bare array" risk does not apply (evidence above), and it avoids multi-minute thinking traces on every structured stage. Make it overridable via #1.

## Secondary finding (streaming does not cover single-GPU serialization)

The `1.7.0` notes say streaming + per-chunk `bodyTimeout` reset means "a long generation never hits the ceiling even when multiple stages run concurrently." On a single local GPU this isn't sufficient: a single Ollama daemon **serializes** concurrent generations, so when the v2 DAG fans out (e.g. `claim-mention-extraction` / `citation-source-detection` / `axiom-indicator-detection` after `segmentation`), the *queued* requests receive **no body chunk at all** and trip `UND_ERR_BODY_TIMEOUT` even at the 20-min ceiling — observed with `qwen3.6:latest` (two of the three fan-out stages body-timed-out while the solo `segmentation` succeeded). Streaming only resets the timeout while chunks are *arriving*; it can't help a request the daemon hasn't started.

Not necessarily a core bug, but worth either documenting (the "concurrency is safe" claim is hardware-dependent) or offering a provider/runtime hint. The consumer worked around it with an e2e-scoped `executePipeline({ concurrencyLimit: 1 })` clamp.

## Impact on this consumer (proposit-server)

- The local-Ollama ingestion e2e (`e2e/tests/ollama-raw-text-import.spec.ts`) could not pass on the documented default `qwen3.6:latest`. We switched the e2e default to **`gemma2:9b`** (a non-thinking model — clears all 12 stages in ~2 min) and documented that `qwen3.6:latest` is currently unusable for local ingestion.
- We added a `RUN_LOCAL_LLM_E2E`-gated `concurrencyLimit: 1` clamp for the slow-model path.
- With fix #1 (a `think` option), we could return to `qwen3.6:latest` and drop the model swap.

## Suggested test cases (core)

- `OllamaProvider` with `think: false` (or auto-disabled under `format`) returns parsed structured output for a thinking model; assert non-empty `output`.
- Empty-`content`-with-thinking response: provider either parses the thinking channel or raises a *non-transient*, clearly-messaged error (not the current generic "no assistant text content" that masquerades as transient and burns retries).
- Regression: `think: false` + a `format` object schema still yields the object envelope (not a bare array) — pin the behavior that contradicts the old comment.
