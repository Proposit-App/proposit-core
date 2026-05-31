# Upcoming changelog

Commit range: `v1.6.0..HEAD`.

## Fixed

- `src/extensions/ollama/errors.ts`: `classifyOllamaError` now maps undici timeout cause-codes (`UND_ERR_HEADERS_TIMEOUT`, `UND_ERR_BODY_TIMEOUT`, `UND_ERR_CONNECT_TIMEOUT`) — including when wrapped as a `fetch failed` `.cause.code` — to `TransientLlmError` (`retryReason: "transient"`). Previously these fell through to the `NonRetryableLlmError` default, so a long local-thinking-model generation that outran undici's 300s `headersTimeout`/`bodyTimeout` killed the whole v2 ingestion run instead of retrying.

## Added

- `src/extensions/ollama/timeout-fetch.ts` + `TOllamaProviderConfig.requestTimeoutMs` (default `1_200_000` = 20 min): the `OllamaProvider` now applies a generous per-request HTTP timeout via a **per-provider** undici `Agent` (raised `headersTimeout`/`bodyTimeout`/`connectTimeout`) passed as the `ollama` SDK client's `fetch` dispatcher — **no global state mutation** (never `setGlobalDispatcher`). `undici` is a new optional `peerDependency` (`>=6.0.0`, mirroring the `ollama` peer); when absent the provider falls back to the SDK default fetch and the transient-timeout classification keeps the timeout retryable. Set `requestTimeoutMs: 0` to opt out of the custom dispatcher.

## Docs

- `docs/api-reference.md`: added a "Pipeline & providers" section documenting the previously-undocumented public surface that has shipped since 1.1.0 — the abstract `TLlmProvider` interface (`respond<T>`, `TLlmRequest`/`TLlmResponse`/`TToolSpec`, free-form `model`), the pipeline framework (`executePipeline`, `TPipeline`/`TStage`/`TStageContext`/`TProcessingFailure`/`TPipelineResult`/`TPipelineEvent`, `DEFAULT_RETRY_POLICY`, and the `failure-codes.ts` constants), the two concrete providers as subpath exports (`extensions/openai` production default + `extensions/ollama` dev-only), and the ingestion factories (`createIngestionV1Pipeline` / `createIngestionV2Pipeline` + `basicsExtension`) with the `TIngestionLlmOptions` / `TLlmStageOptionsOverride` options seam and the new `model?` knob. Docs-only — no `src/` change.
