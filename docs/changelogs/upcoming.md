# upcoming changelog

> **⚠️ BREAKING (shipped as a minor):** despite the minor version bump, this release removes a public subpath export. The `@proposit/proposit-core/extensions/ollama` provider extension (and its `OllamaProvider`) is gone, replaced by a new `@proposit/proposit-core/extensions/chat-completions` provider. Shipped as a minor because no consumer imports the removed subpath — see the release notes "Upgrading" section.

## Added

- New `@proposit/proposit-core/extensions/chat-completions` subpath exporting `createChatCompletionsProvider` (+ `TCreateChatCompletionsProviderOptions` / `TChatCompletionsProviderConfig`) — a second concrete `TLlmProvider` for running the LLM stack against any OpenAI-compatible `/v1/chat/completions` endpoint (a local `llama-server` by default: base `http://127.0.0.1:46373/v1`, model `local-coder`), at zero API cost. It talks to the endpoint over **raw `fetch`** with **no new dependency** and no SDK. Synchronous and structured-output-only: one POST per call, no streaming/background/poll, no function-tool loop. `maxOutputTokens` maps to `max_tokens`; `reasoningEffort` is ignored; `temperature` is fixed at 0; `rawResponseId` is left undefined; `signal` is honored (composed with the per-request `AbortSignal.timeout`). A request carrying `tools` fails fast with `NonRetryableLlmError`.
- The new subpath also exports the lax `typeboxToJsonSchema` converter (+ `TChatCompletionsJsonSchema`) and the provider error classes + classifiers (`NonRetryableLlmError`, `RateLimitLlmError`, `QuotaExhaustedLlmError`, `SchemaValidationLlmError`, `TransientLlmError`, `classifyHttpError`, `classifyFetchError`).

## Removed

- **BREAKING:** removed the `@proposit/proposit-core/extensions/ollama` subpath export, the `OllamaProvider`, and the extension's standard-JSON-schema converter + error classes. The `ollama` and `undici` optional `peerDependencies` (and the matching dev dependencies) are dropped — `undici` was used only by the Ollama provider's per-request-timeout dispatcher, which the new provider replaces with a standard `AbortSignal.timeout`.

## Changed

- `docs/api-reference.md` replaces the Ollama provider section with the chat-completions provider section, and updates the LLM-options seam example + the model-string example to the local-model alias (`local-coder`).

## Tests

- Added `test/extensions/chat-completions/` — `structured-output.test.ts` (the lax converter), `errors.test.ts` (the status/fetch classifiers), `provider.test.ts` (request shape, response parsing, error classification, the tools fail-fast, abort), and a gated `provider-live.test.ts` (smoke round-trip + a structured-output gate + an e2e `createScholarPipeline` run; reads `LOCAL_LLM_BASE_URL` / `LOCAL_LLM_MODEL`, gated on `RUN_LOCAL_LLM_TESTS=1`).
- Deleted `test/extensions/ollama/` (the 5 Ollama provider suites).
