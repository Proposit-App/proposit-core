# Upcoming changelog

Commit range: `v1.5.1..HEAD`.

## Added

- **Dev-only Ollama provider extension** (`912b834`). New
  `src/extensions/ollama/` implementing `TLlmProvider` via the official
  `ollama` npm SDK, surfaced at the `@proposit/proposit-core/extensions/ollama`
  subpath export. Lets a developer run the entire LLM-backed stack
  (notably the v2 argument-ingestion pipeline) against a local Ollama
  daemon (`qwen3.6:latest`) with zero API cost. Production stays on
  OpenAI; this is purely additive and opt-in. - `ollama` is declared as an **optional `peerDependency`** (`>=0.5.0`,
  `peerDependenciesMeta.ollama.optional: true`) plus a devDependency
  so typecheck/test/build resolve it. Consumers that never touch the
  extension don't need it; a missing package surfaces as an actionable
  construction-time error. - `OllamaProvider` (`provider.ts`): builds an `ollama` SDK
  `chat({ model, messages, format, options, tools? })` call,
  `temperature: 0`, maps `maxOutputTokens → options.num_predict`
  (positive values only — never `0`; `-1`/`-2` sentinels never
  emitted), ignores `reasoningEffort` (no Ollama analogue), parses
  `message.content` as JSON, leaves `rawResponseId` undefined (the
  chat response is not request-id-bearing), honors `signal` via the
  SDK client's `abort()`, and runs a bounded function-tool agent loop
  (hosted-tool kinds throw `NonRetryableLlmError`). - `typeboxToJsonSchema` (`structured-output.ts`): the Ollama
  converter, producing **standard** JSON Schema — `Type.Optional(T)`
  omits the key from `required`; no forced `additionalProperties:
false`. A deliberate divergence from `typeboxToOpenAiSchema`, which
  is left untouched. - `classifyOllamaError` (`errors.ts`): own error classes carrying the
  same `retryReason` tags + lib `failure-codes` constants (no
  `ollama → openai` dependency, no `src/lib/` change). Mapping:
  `ECONNREFUSED`→NonRetryable, model-not-pulled (404)→NonRetryable,
  context-length overflow→NonRetryable (deterministic; **never**
  `SchemaValidationLlmError`, which is tagged `transient` and would be
  retried), `ECONNRESET`/socket-drop→Transient, cold-VRAM-load
  5xx→Transient, 429→RateLimit, unclassified→NonRetryable (fail-fast). - `tokenUsage`: `prompt_eval_count → input`, `eval_count → output`,
  `reasoning` unset. - `numCtx?` on `TOllamaProviderConfig` → `options.num_ctx`, defaulting
  to a generous **32768**. Ollama silently truncates any prompt longer
  than `num_ctx` (no error — the model emits schema-valid JSON from a
  truncated prompt, so a quietly-wrong parse passes the framework's
  `Value.Check`), and its per-model default is often ~4096 — far below
  a real multi-KB ingestion prompt. The generous default lets the
  default-constructed provider run the whole pipeline on real text
  without silent truncation; raise it further for very large inputs.

- **`model` override on the per-stage LLM options seam** (`922a049`).
  Added `model?: string` to `TLlmStageOptionsOverride`
  (`src/extensions/argument-ingestion/shared/types.ts`); threaded
  through `resolveLlmStageOptions` (pipeline-default + per-stage merge
  clauses); each of the 8 v2 LLM stage factories now folds its
  hard-coded model const into its `*_STAGE_DEFAULTS` and reads
  `options?.model ?? STAGE_CONST`. A caller can retarget every v2 LLM
  stage at a different backend without forking stages, e.g.
  `createIngestionV2Pipeline(basicsExtension, { llm: { defaults: {
model: "qwen3.6:latest" } } })`. Every stage keeps its `gpt-5.x`
  default when no override is supplied — production behavior unchanged.
  v1 (`createIngestionV1Pipeline`) is untouched (its `model?` is
  independent by design).

## Tests

- Always-on deterministic units (CI-safe, no daemon): converter
  conversion cases (incl. the Optional-omitted-from-`required` /
  no-`additionalProperties:false` divergence), `classifyOllamaError`
  mapping cases, `OllamaProvider.respond` against a mocked client
  (request shape, tokenUsage mapping, tool loop, abort), and a
  seam-regression guard asserting a `model` override actually reaches
  the built `llmStage` request.
- Opt-in live suite (`test/extensions/ollama/provider-live.test.ts`),
  gated on `RUN_LOCAL_LLM_TESTS=1` + a `:11434` reachability probe —
  never runs in CI. Confirms `respond()` round-trip, the structured-
  output `format` gate, and one end-to-end `createIngestionV2Pipeline`
  run on `qwen3.6:latest`.
