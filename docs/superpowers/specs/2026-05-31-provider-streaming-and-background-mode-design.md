# Provider streaming + OpenAI background mode — design

**Date:** 2026-05-31
**Repo:** `proposit-core` (`@proposit/proposit-core`)
**Source request:** `docs/inbox/.archive/2026-05-31-provider-streaming-and-openai-background-mode.md`
**Scope:** Levels 1a + 1b + 1c (all provider-local). Level 2 (resumable pipeline) is cross-repo + flagged a stretch by the source request — explicitly out of scope here.

## Capability changes

None. This is an internal robustness change to two LLM provider extensions. `respond()`'s external contract is unchanged, so no user-facing or API-surface capability doc changes. (proposit-core does not maintain `capabilities.md` files; the capability layer lives in the consumer apps.)

## Problem

Neither concrete `TLlmProvider` streams from the model today:

- **OpenAI** (`src/extensions/openai/provider.ts`): a single blocking `fetch` POST to `/v1/responses`; the full response is awaited on one held connection. No `stream`, no `background`.
- **Ollama** (`src/extensions/ollama/provider.ts:159`): explicitly `stream: false`; the whole generation is awaited on one held connection.

A single LLM call therefore holds one connection open for its entire duration — seconds for hosted GPT, but **5–15 minutes per stage** for a local thinking model (`qwen3.6`). That held connection is what undici aborts at its 300s default, and what any proxy/load-balancer can drop. The v1.6.1 fix (raised `requestTimeoutMs` + classifying undici timeout codes as transient) is a **near-term band-aid**; the changes below are the **structural** fix. The band-aid stays as a backstop and is **not removed** by this work.

## Guiding invariant

`TLlmProvider.respond<T>()` keeps its exact contract:

- Same return shape (`output`, `tokenUsage`, `rawResponseId`).
- Same error taxonomy (`retryReason` tags + lib `failure-codes`).
- Same `AbortSignal` → re-thrown `AbortError` → framework `skipped` behavior.

**Zero changes to `src/lib/`.** The pipeline framework, `TLlmProvider`, `TLlmRequest`, `TLlmResponse`, and `llmStage` are all untouched. Every change is provider-local inside `src/extensions/{ollama,openai}/`. The callers — `llmStage`, the v1/v2 ingestion pipelines, the server ingestion task layer — need no interface change.

## Design

### Level 1a — Ollama streaming (default ON)

**Mechanism.** `runChatLoop` switches `client.chat()` from `stream: false` to `stream: true`. The `ollama` SDK then returns an `AsyncIterable<ChatResponse>` rather than a single `ChatResponse`. A new isolated helper consumes the iterable and **synthesizes one `TOllamaChatResponse`**:

- concatenate each chunk's `message.content`;
- capture `tool_calls` from the chunk(s) that carry them (terminal chunk in the common case);
- read `prompt_eval_count` / `eval_count` from the final (`done: true`) chunk.

Everything downstream of the call — `safeParseJson`, `Value.Check` (in `llmStage`), the tool-loop branch, `mergeUsage`, the debug-log calls — is **unchanged** because it still operates on a single synthesized response object. The caller never sees a stream.

**Why it fixes the timeout.** With streaming, response headers and the first chunk arrive immediately, and undici's `bodyTimeout` resets on each chunk, so the 300s held-connection ceiling never trips for the *actively-generating* case. This is the community-validated fix for the hardcoded ~300s non-streaming Ollama timeout (ollama/ollama#5081).

**Escape hatch.** New `TOllamaProviderConfig.stream?: boolean`, **default `true`**. `false` restores today's one-shot path verbatim.

**Backstop retained.** The 20-min `requestTimeoutMs` + undici-timeout-as-transient classification (v1.6.1) stays as a backstop for the *queued-behind-another-request* case (concurrent fan-out stages serializing on one loaded model instance, where the first chunk is delayed by queueing rather than generation). Not removed.

**Type changes (`src/extensions/ollama/types.ts`).**
- Widen `TOllamaChatRequest.stream` from `false` to `boolean`.
- Model `TOllamaClient.chat()` as returning `Promise<TOllamaChatResponse> | AsyncIterable<TOllamaChatResponse>` (or an overload pair) so a streaming mock and the real SDK both satisfy it.
- Add a streamed-chunk type carrying `done?: boolean` alongside the existing fields.

**Tools caveat.** Ingestion is tool-free, so the common path is purely accumulate-then-parse. Streamed `tool_calls` are captured from the terminal chunk and fed into the existing tool-loop branch; documented as the V1 behavior for the (unused-by-ingestion) tool path.

### Level 1b — OpenAI streaming (default ON)

**Mechanism.** The HTTP helper (`callOnce`) gains a streaming variant. When streaming, the request body sets `stream: true` and the helper reads `response.body` as an SSE stream. The parser **relies on the terminal event** (`response.completed` / `response.incomplete` / `response.failed`), whose payload carries the full `response` object — i.e. the same `TOpenAiResponsesEnvelope` shape the provider already processes. The helper reconstructs that envelope and returns it, so the **existing, unchanged** envelope-processing code in `respond()` runs verbatim: incomplete-reason classification (v1.3.1), tool-call detection, usage extraction, text parse. Delta events (`response.output_text.delta`) are ignored — the provider returns one response, not a live stream.

**Default.** New `TCreateOpenAiResponsesProviderOptions.stream?: boolean`, **default `true`**. `false` restores the blocking `response.json()` path.

**Connection drop mid-stream.** If the stream ends without a terminal event, throw `TransientLlmError` (retryable) — the connection-drop-resilience win.

**No data-retention implications.** Foreground streaming does not require `store`.

### Level 1c — OpenAI background mode (opt-in, default OFF)

**Mechanism.** New `TCreateOpenAiResponsesProviderOptions.backgroundMode?: boolean`, **default `false`**. When enabled, `respond()` runs a submit-then-poll loop fully inside the provider:

1. POST `/v1/responses` with `background: true` **+ `store: true`** → 200 with `{ id, status: "queued" | "in_progress" }`.
2. Poll `GET /v1/responses/{id}` with bounded backoff (configurable `backgroundPollIntervalMs`, default e.g. 2000ms) until a terminal status: `completed` / `failed` / `incomplete` / `cancelled`.
3. On terminal, hand the envelope to the **existing** processing code (same classification + extraction path).
4. `AbortSignal` fires → POST `/v1/responses/{id}/cancel` (idempotent) → surface via the abort path → framework marks the stage `skipped`. A polled `status: "cancelled"` is treated the same.

**Precedence.** `backgroundMode` true → poll path; else `stream` (default true) → SSE path; else → blocking path.

**Tools scope (V1).** Background mode targets the **no-tools path** only (per the source request). A request that sets `backgroundMode` *and* carries `tools` throws a clear `NonRetryableLlmError` at the top of `respond()` — explicit over silent fallback. Tool-loop-under-background (each round its own background response) is a documented follow-up, not built here.

**Resumable background+stream variant** (track `sequence_number` cursor, reconnect with `?stream=true&starting_after=<cursor>`) is **out of scope** — it overlaps Level 2 durability and is not needed for the encapsulated submit-then-poll robustness win.

**ZDR note.** `store: true` retains the response server-side (~10 min, for polling) and is **not ZDR-compatible**. This is why background mode is opt-in/off by default. The constraint is documented in the config JSDoc.

## Error handling

- All three modes route errors through the **existing** `classifyHttpError` / `classifyOllamaError` and error-class taxonomy. No new error classes.
- OpenAI streaming connection drop (no terminal event) → `TransientLlmError`.
- OpenAI background terminal `failed` → classified from the envelope's `error`/status via the existing path; terminal `incomplete` → existing incomplete-reason classification; `cancelled` → abort path.
- Ollama streaming errors thrown mid-iteration are classified by the existing `classifyOllamaError` (abort short-circuit preserved).

## Testing

All default-suite tests use injected mocks — no network, no daemon, no API key.

- **1a (`test/extensions/ollama/provider.test.ts`):** extend the mock `chat` to return an `AsyncIterable` of chunks when `stream: true`. Assert (a) accumulated content parses identically to the one-shot result for the same input; (b) `tokenUsage` comes from the final (`done: true`) chunk; (c) abort mid-stream re-throws as `AbortError`; (d) `stream: false` config falls back to the one-shot path; (e) request carries `stream: true` by default.
- **1b (`test/extensions/openai/provider.test.ts`):** mock `fetch` returns an SSE `ReadableStream` with a terminal `response.completed` event → assert envelope reconstructed + output identical to the blocking path. Separate cases: `response.failed` / `response.incomplete` map to the right error classes; mid-stream drop (no terminal event) → `TransientLlmError`; abort honored; `stream: false` config restores the blocking path.
- **1c (`test/extensions/openai/provider.test.ts`):** mock `fetch` sequence (POST→`queued`, GET→`in_progress`→`completed`) → assert the poll loop terminates, `background: true` + `store: true` are sent, and the terminal envelope is classified through the existing path. Cases: `AbortSignal` → cancel POST issued → re-thrown abort; terminal `failed` / `incomplete` → right error class; `backgroundMode` + `tools` → `NonRetryableLlmError`.
- **Contract regression:** a parametrized assertion that `respond()`'s return shape / `tokenUsage` / error taxonomy is identical across blocking, streaming, and background modes.
- **Live (opt-in, `RUN_LIVE_LLM_TESTS=1`):** extend `test/extensions/ollama/provider-live.test.ts` for the real streaming path (a previously-300s-failing fan-out completes via streaming without relying on the raised timeout). Add an OpenAI background live case gated the same way (requires `OPENAI_API_KEY`).

## Versioning & documentation sync

- Feature work across two extensions → **`pnpm version minor`** (1.6.1 → **1.7.0**), offered after implementation + review.
- Documentation-sync targets (per `proposit-core/CLAUDE.md`):
  - `proposit-core/CLAUDE.md` "Dev-only Ollama provider" bullet (`stream: false` → streaming default; new `stream` knob) and the OpenAI provider description (new `stream` + `backgroundMode` + `backgroundPollIntervalMs` knobs). [Public-API]
  - `docs/release-notes/upcoming.md` (plain-language) + `docs/changelogs/upcoming.md` (commit-range). [Public-API / Any-Code-Change]
  - `docs/api-reference.md` if the provider config types are documented there. [Public-API]
  - `README.md` "Invalid Constructions" — not applicable (no validation-rule/error change).

## Out of scope

- **Level 2** (resumable pipeline: persist per-stage external job handles in `src/lib/pipelines/` + `proposit-server` resume-on-restart). Cross-repo, orchestrator-owned, only justified if mid-ingestion durability becomes a real requirement.
- **OpenAI resumable background+stream** (sequence_number cursor reconnect).
- **Tool-loop under background mode.**
