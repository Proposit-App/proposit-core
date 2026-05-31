# Provider streaming + OpenAI background mode for long-running LLM calls

**Filed by:** orchestrator (local-LLM work, 2026-05-31)
**Affects:** `@proposit/proposit-core` `extensions/openai` + `extensions/ollama` (providers); a stretch item touches the pipeline framework (`src/lib/pipelines/`) + `proposit-server`'s ingestion task layer.
**Relationship to v1.6.1:** the `1.6.1` fix (raised `requestTimeoutMs` + classifying undici timeout codes as transient) is a **near-term band-aid** for the held-connection timeout. The changes below are the **structural** fix and should supersede the need to lean on a giant timeout. The band-aid stays as a backstop; do not remove it as part of this work.

## Motivating correction — neither provider streams today

It's easy to assume the stack already streams from the model (the UI does show live per-stage progress). It does not at the provider level:

- **OpenAI provider** (`src/extensions/openai/provider.ts`): a single **blocking** `fetch` POST to `/v1/responses`; the full response is awaited on one held connection. No `stream`.
- **Ollama provider** (`src/extensions/ollama/provider.ts:159`): explicitly `stream: false`; the whole generation is awaited on one held connection.
- The "streaming" users see is the **server's** per-stage SSE task-progress (`stage:llm-call` events → SSE to the browser), not token streaming from the model.

So a single LLM call holds one connection open for its entire duration — seconds for hosted GPT, but **5-15 minutes per stage** for a local thinking model (qwen3.6). That held connection is what undici aborts at 300s, and what any proxy/load-balancer between us and the model can drop.

## Proposed changes (scoped into levels)

### Level 1a — Stream Ollama responses (`extensions/ollama`)

Set `stream: true` on the `ollama` SDK `chat()` call, **collect/concatenate the streamed `message.content` parts inside the provider's request method**, and return it as if it were a one-shot response — then `JSON.parse` + TypeBox `Value.Check` the concatenated result exactly as today. The caller never sees a stream; `respond()`'s contract is unchanged.

This is the **community-validated** fix for the hardcoded ~300s (5-minute) timeout that applies specifically to **non-streaming** Ollama requests — see ollama/ollama#5081 (comment): _"If you run bigger models on consumer hardware, you will instantly discover the hardcoded 5-minute timeout for non-streaming requests. Our solution to handle long-running (like 10-minute) requests: `stream=true`, collect all parts in the low-level request method, return it like a one-shot request response."_ (https://github.com/ollama/ollama/issues/5081#issuecomment-2678021167). This complements our own finding (undici client-side `headersTimeout` of 300s): both the client timeout and the known non-streaming ceiling are sidestepped because, with streaming, headers + the first chunk arrive immediately and `bodyTimeout` resets on each token chunk.

**Benefit:** the held-connection timeout class largely disappears for the _actively generating_ case. (The _queued-behind-another-request_ case — concurrent fan-out stages serializing on one loaded model instance — still benefits from the `requestTimeoutMs` backstop and/or `OLLAMA_NUM_PARALLEL`, so keep the 1.6.1 timeout.) **Watch:** streaming + the function-tool agent loop needs care, but ingestion stages are tool-free, so the common path is just "accumulate then parse." This should become the **primary** Ollama fix; the 1.6.1 raised timeout then degrades to a pure backstop for the queueing case.

### Level 1b — Stream OpenAI responses (`extensions/openai`) — optional parity

`stream: true` on `/v1/responses` (SSE), accumulate events. Lower priority (hosted GPT is fast, so the timeout never bites in prod), but it gives connection-drop resilience and behavioral parity between the two providers. Worth doing alongside 1a for symmetry; not load-bearing on its own.

### Level 1c — OpenAI background mode (`extensions/openai`)

Use `background: true` so a long reasoning call does **not** depend on a continuously-held connection:

- POST `/v1/responses` with `background: true` (**requires `store: true`**) → returns a `Response` with an `id` and `status` of `queued` / `in_progress`.
- Poll `GET /v1/responses/{id}` until a terminal status (`completed` / `failed` / `incomplete` / `cancelled`), then read the output as today.
- Optionally `background: true` **and** `stream: true` for a resumable stream: track the `sequence_number` cursor and reconnect with `?stream=true&starting_after=<cursor>` if the connection drops.
- Cancellation: `POST /v1/responses/{id}/cancel` (idempotent) — wire this to the existing `AbortSignal`.

**Encapsulation:** this can live entirely **inside** the OpenAI provider's `respond()` as a submit-then-poll loop — `respond()` still returns the final structured output, so the pipeline framework and the caller are unchanged. That makes Level 1c provider-local.

**Considerations / watch-items:**

- `store: true` is mandatory for background and is **not ZDR-compatible** (data retained ~10 min for polling). Confirm this is acceptable for Proposit's data-retention posture before enabling in prod; consider gating it (e.g. only for stages above some expected-duration threshold) rather than blanket-on.
- Background mode currently has higher time-to-first-token than synchronous — fine for our non-interactive ingestion stages, but don't use it on any latency-sensitive path.
- Interaction with the existing 6-round function-tool agent loop is more complex under background mode (each round would be its own background response). Ingestion is tool-free, so scope Level 1c to the no-tools path first and treat tool-loop + background as a follow-up.

### Level 2 — Resumable pipeline (stretch; pipeline framework + server)

The deepest version of "don't require an active connection": **persist each stage's provider response id** (OpenAI background id; Ollama has no equivalent — see below) so an in-flight ingestion task can be **resumed after a server restart/crash** without re-running completed stages. This needs:

- `src/lib/pipelines/` support for recording + resuming per-stage external job handles, and
- `proposit-server`'s ingestion task layer to persist them alongside the existing `pipelineRuns`/`pipelineStages` observability triple and resume on restart.

Large, cross-repo, and only justified if mid-ingestion durability becomes a real requirement. Capture as a stretch, not part of the near-term streaming/background work.

**Ollama caveat for Level 2:** Ollama's HTTP API is connection-bound — there is **no job-id / poll-status endpoint**. So Level 2 resumability is OpenAI-only; for Ollama, streaming (1a) + the timeout backstop is the ceiling of what's achievable. A resumable design must treat "no external job handle" (Ollama) as a first-class case that simply re-runs the stage.

## Test cases

- Ollama: structured-output parse over **accumulated stream chunks** equals the non-streamed result for the same input (deterministic-ish; assert structural validity, not exact tokens). A previously-300s-failing fan-out completes via streaming without relying on the raised timeout.
- OpenAI background: the submit→poll state machine handles `queued`→`in_progress`→`completed`, surfaces `failed`/`incomplete` as the right error class, and `AbortSignal` → cancel → framework `skipped`. `store: true` is sent; absence of `store` is rejected (matches API).
- Both providers: `respond()`'s external contract (return shape, `tokenUsage`, schema validation, error taxonomy) is unchanged — the pipeline and the server ingestion task need no interface change for Level 1.

## Recommended sequencing

1a (Ollama streaming — biggest robustness win for the dev path) → 1c (OpenAI background — robustness for slow hosted reasoning) → 1b (OpenAI streaming parity) → Level 2 only if durability is required. Each of 1a/1b/1c is an independent provider-local change shippable on its own.
