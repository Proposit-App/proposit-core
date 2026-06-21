# OllamaProvider: requests time out at undici's 300s default under concurrent local generation

**Filed by:** proposit-server (local-LLM e2e work, 2026-05-31)
**Affects:** `@proposit/proposit-core` `extensions/ollama` (`OllamaProvider`, `classifyOllamaError`)
**Severity:** Medium — makes the v2 pipeline fail on local Ollama for non-trivial inputs.

## Problem

Running the full v2-multi-stage ingestion pipeline against a local Ollama
daemon (`qwen3.6:latest`, thinking on) deterministically fails at the
post-segmentation **parallel fan-out** — the stages that fire concurrently
right after `segmentation` (`claim-mention-extraction`,
`citation-source-detection`, `axiom-indicator-detection`). All three fail at
once with:

```
[<stage>/LLM_NON_RETRYABLE_ERROR] Unclassified Ollama error: fetch failed
```

Measured precisely: the three stages started at the same instant and all
failed exactly **301.0 seconds** later. That is undici's default
`headersTimeout` / `bodyTimeout` (300s). When the concurrent requests
serialize against a single loaded model instance (Ollama's default
`OLLAMA_NUM_PARALLEL` is conservative), the last request queues past 300s and
undici aborts the `fetch` with `TypeError: fetch failed` whose `.cause.code`
is `UND_ERR_HEADERS_TIMEOUT` (or `UND_ERR_BODY_TIMEOUT`).

## Root cause

Two compounding issues in `extensions/ollama`:

1. **No client-side timeout is configured.** The `ollama` SDK (v0.6.3) issues
   each request via plain `fetch` with no custom dispatcher, so it inherits
   undici's 300s default — too short for local thinking-model generation,
   especially when several stages contend for one GPU.

2. **`classifyOllamaError` does not recognize undici timeout codes.** A
   `fetch failed` whose `.cause.code` is `UND_ERR_HEADERS_TIMEOUT` /
   `UND_ERR_BODY_TIMEOUT` / `UND_ERR_CONNECT_TIMEOUT` falls through to the
   `NonRetryableLlmError("Unclassified Ollama error: …")` default. A genuine
   timeout against a still-working local daemon is **transient**, not
   non-retryable — so even the framework's retry policy never gets a chance.

## Proposed fix

1. **Set a generous request timeout on the OllamaProvider's fetch.** Give the
   provider an undici `Agent` / custom `fetch` with `headersTimeout` and
   `bodyTimeout` raised to something appropriate for local generation (e.g.
   10–20 min, or configurable via an `OllamaProvider` option, default
   generous). Local thinking models legitimately take minutes per stage.

2. **Classify undici timeout cause-codes as transient.** In
   `classifyOllamaError`, map `.cause.code` of `UND_ERR_HEADERS_TIMEOUT`,
   `UND_ERR_BODY_TIMEOUT`, and `UND_ERR_CONNECT_TIMEOUT` (and the bare
   `ETIMEDOUT` already handled) to `TransientLlmError` so the default
   `retryOn: ["transient"]` policy retries.

## Impact on consumer (proposit-server)

The server's local-LLM ingestion e2e (`e2e/tests/ollama-raw-text-import.spec.ts`)
currently works around this by (a) requiring `OLLAMA_NUM_PARALLEL>=4` on the
daemon so the fan-out stages run truly concurrently, and (b) using a minimal
2-sentence fixture to keep per-stage generation short. With the core fix,
both workarounds become unnecessary and local-Ollama dev/ingestion stops
being fragile on longer inputs.

## Secondary observation — thinking is uncapped (very slow stages)

While verifying the above, the `OllamaProvider` was observed to run each LLM
stage with qwen3.6 **thinking left on and no `num_predict`/think cap**, so a
single structured-extraction stage takes 5-15 minutes (the whole 12-stage v2
run is ~45-60 min). The provider sets `temperature: 0` + a generous `num_ctx`
but never passes `think: false` (the `ollama` SDK chat option), so the model
emits a long reasoning trace before the structured JSON. For
deterministic structured-output stages this reasoning is largely wasted time.

Consider an `OllamaProvider` option (or a per-stage `reasoningEffort` →
`think` mapping) to disable / minimize thinking for the extraction stages.
This is the dominant cost making local-Ollama ingestion impractically slow,
independent of the timeout bug above.

## Test cases

- Unit: `classifyOllamaError({ cause: { code: "UND_ERR_HEADERS_TIMEOUT" } })`
  → `TransientLlmError` (tagged `transient`).
- Unit: `classifyOllamaError({ cause: { code: "UND_ERR_BODY_TIMEOUT" } })`
  → `TransientLlmError`.
- Integration (opt-in, live Ollama): a v2 run on a non-trivial input whose
  fan-out would previously exceed 300s now completes (provider's raised
  timeout) or retries cleanly rather than failing `LLM_NON_RETRYABLE_ERROR`.
