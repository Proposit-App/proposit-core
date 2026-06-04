# Change request: per-stage + finalize execute + launch/complete split + context serialize/rehydrate (carrying outcome)

**Requested by:** `proposit-server` (durable, unattended ingestion via Vercel
Workflows). **Type:** public-API addition (pipeline framework).
**Status note:** `executeStage` + `executeFinalize` (run-to-completion) are
**already implemented + verified (commit `1484abc`)** — reqs 1-10 below describe
the SHIPPED behavior, do not rebuild. **This change-request's WORK is the
launch/complete delta (reqs 11-16):** the PACKAGE-INTERNAL `llmStage` seam
(`buildLlmRequest`/`validateLlmOutcome` + an internal config carrier; `llmStage`'s
public `TStage` return type is UNCHANGED — no `TLlmStage` widening), `launchStage` +
`completeStage`, the `submitBackgroundResponse` provider capability + typed dep, the
additive `TRetrievedResponse.incompleteReason`/`errorMessage`, and the `retryReason`
result field. **Target:** a minor (e.g. `1.11.0`). **Consumer-validation-gated**
before publish.

## Problem

`proposit-server` is moving ingestion off the single in-process `executePipeline`
call and onto a durable orchestrator (Vercel Workflows) that runs **each stage in
its own serverless invocation**, persisting typed stage outputs to Postgres
between stages. To run stage N in a fresh invocation, the server must hand core
stage N's upstream stages' typed outputs **and their outcomes** so `ctx.get` and
`ctx.stageStatus` behave exactly as they do inside the monolithic run. The same is
true of the pipeline's **finalize** step (multi-parent, not a stage).

**Plus a control-flow constraint confirmed by a Vercel-Workflows spike:** for an
LLM stage, the workflow must submit the background OpenAI response and learn its
`responseId` **without blocking** for the call's full duration, suspend on a hook
keyed by that id, and — after the `response.completed` webhook resumes — turn the
retrieved response into a stage result. Running the LLM call inline to completion
inside a workflow step would block for the full LLM duration (bounded by
`maxDuration ~60s`) and reintroduce the very timeout this work removes. So an LLM
stage needs a **launch (submit → return `responseId`) / complete (validate the
retrieved response)** split, not just run-to-completion.

Today the inter-stage state (`records: Map`) is private to one `executePipeline`
call (`src/lib/pipelines/execute.ts:229`), and `ctx.get` returns the output only
for a `completed` upstream (`execute.ts:264-267`). There is no public way to
inject pre-computed upstream records and run a single stage. And although the
OpenAI provider's `runBackground` (`provider.ts:911`) already submits
`{ background:true, store:true }` and extracts `submitEnvelope.id` (`:931`), it
then polls to completion — there is **no public submit-only-return-`responseId`
path.**

## Root cause

The engine has no single-stage / standalone-finalize / submit-only entry points.
`executePipeline` validates the whole DAG, schedules all stages, runs finalize,
emits run-level bookends — all welded; and every background mode runs to
completion. A separate-invocation durable model needs thin, stateless calls that
reuse the existing per-stage / finalize / submit semantics: run a deterministic
stage; run finalize; **launch** an LLM stage (submit → responseId, no await);
**complete** an LLM stage (from the retrieved response).

## Proposed API

Public surface (exported): the four free functions
(`executeStage`/`executeFinalize` shipped; `launchStage`/`completeStage` new) +
`submitBackgroundResponse` (openai extension) + their result types + the additive
`TRetrievedResponse` fields. The `llmStage` **seam** (`buildLlmRequest` /
`validateLlmOutcome` / `TLlmStageConfig` / the internal carrier+accessor) is
**PACKAGE-INTERNAL — NOT exported** (re-review #3), and **`llmStage`'s public return
type stays `TStage`** (it does NOT widen):

```ts
export type TStageOutcomeRecord = {
    outcome: TStageStatus           // "completed" | "skipped" | "failed"
    output?: unknown                // present iff outcome === "completed"
}

export type TExecuteStageDeps = {
    llm: TLlmProvider
    generateId?: () => string
    signal?: AbortSignal
    onEvent?: (event: TPipelineEvent) => void
    // launch/complete only — submit-only background-response capability,
    // referenced by FUNCTION TYPE so lib/ takes no openai import (the
    // lib/extensions boundary holds). Required by launchStage; ignored by
    // executeStage/executeFinalize.
    submitBackgroundResponse?: (
        req: TLlmRequest<unknown>,
        opts: { apiKey: string; baseUrl?: string; signal?: AbortSignal }
    ) => Promise<{ responseId: string; status: TResponseStatus }>
}

export type TExecuteStageResult = {
    outcome: TStageStatus
    output?: unknown                // present iff outcome === "completed"
    failures: TProcessingFailure[]
    tokenUsage?: TLlmTokenUsage     // completeStage: retrieved.tokenUsage, direct
    // launch/complete: the retry CLASSIFICATION when a `completeStage` failure
    // is retryable — a REASON CODE, not a bool, so the workflow applies the
    // SAME retryOn + bounded attempts core would. `schema_validation |
    // transient | rate_limit | quota_exhausted`; absent when completed or for a
    // non-retryable / fail-fast failure (content_filter, cancelled). Unused by
    // the run-to-completion executeStage.
    retryReason?: TRetryReason
}

// Run a DETERMINISTIC (non-LLM) stage inline to completion.
export function executeStage(
    pipeline: TPipeline<unknown, unknown>,
    stageId: string,
    upstream: Readonly<Record<string, TStageOutcomeRecord>>,
    input: unknown,
    deps: TExecuteStageDeps
): Promise<TExecuteStageResult>

export type TExecuteFinalizeResult<TOutput> = {
    // The pipeline output finalize produced; null when a required
    // finalize dep was not completed (the finalizeRequiredOk() gate),
    // or when finalize itself threw (FINALIZE_UNCAUGHT_ERROR).
    output: TOutput | null
    failures: TProcessingFailure[]
}

// Run the pipeline's finalize inline from rehydrated upstream records.
export function executeFinalize<TOutput>(
    pipeline: TPipeline<unknown, TOutput>,
    upstream: Readonly<Record<string, TStageOutcomeRecord>>,
    input: unknown,
    deps: TExecuteStageDeps
): Promise<TExecuteFinalizeResult<TOutput>>

// --- the llmStage seam (PACKAGE-INTERNAL — NOT exported; see "Why a seam") ---

// llmStage's body is factored into two PACKAGE-INTERNAL fns that BOTH the in-process
// llmStage.run loop AND launchStage/completeStage call (single source of truth for
// prompt-build + parse/Value.Check). llmStage's PUBLIC return type stays TStage; the
// config rides an internal-symbol carrier read by an internal accessor (no widening).
type TLlmStageConfig<TOutput> = {           // package-internal
    id: string
    outputSchema: TSchema
    model: string
    reasoningEffort?: TReasoningEffort
    buildPrompt: (ctx: TStageContext) => { system: string; user: string }
    tools?: readonly TToolSpec[]
    maxOutputTokens?: number
    retryPolicy: TRetryPolicy            // resolved (defaults merged)
}
declare const LLM_STAGE_CONFIG: unique symbol               // internal symbol key
function readLlmStageConfig<T>(stage: TStage<T>): TLlmStageConfig<T> | undefined  // internal
export function llmStage<TOutput>(config: { … }): TStage<TOutput>  // PUBLIC TYPE UNCHANGED

function buildLlmRequest<TOutput>(       // package-internal
    cfg: TLlmStageConfig<TOutput>, ctx: TStageContext, userMessage?: string
): { req: TLlmRequest<TOutput>; prompts: { system: string; user: string } }

function validateLlmOutcome<TOutput>(    // package-internal
    cfg: TLlmStageConfig<TOutput>,
    rawText: string | undefined,         // retrieved.output — RAW STRING (req 12)
    status: TResponseStatus,
    incompleteReason: string | undefined // retrieved.incompleteReason (req 14)
): {
    outcome: "completed" | "failed" | "skipped"   // skipped for cancelled (TABLE)
    output?: TOutput
    failure?: { reason: TRetryReason; code: string; message: string }
    validationError?: string
}

// --- launch/complete split for LLM-background stages ---

export type TLaunchStageResult = {
    responseId: string              // the background response id; no await
    status: TResponseStatus         // submit-time status; may be terminal (req 15)
}

// Rehydrate ctx from upstream + parsed input, build the request via
// buildLlmRequest(cfg, ctx), SUBMIT via deps.submitBackgroundResponse,
// and return { responseId, status } WITHOUT awaiting completion. Emits
// stage:start + stage:llm-request + stage:llm-response-created (NO stage:end).
// `attempt` (default 1) re-derives the retry-suffixed userMessage for attempt 2+.
export function launchStage(
    pipeline: TPipeline<unknown, unknown>,
    stageId: string,
    upstream: Readonly<Record<string, TStageOutcomeRecord>>,
    input: unknown,
    deps: TExecuteStageDeps,        // deps.submitBackgroundResponse REQUIRED here
    attempt?: number
): Promise<TLaunchStageResult>

// safeParseJson the RAW retrieved.output, then validateLlmOutcome(cfg,…),
// then classify per the TABLE. Emits stage:llm-call + stage:end (NO stage:start).
// Attaches retrieved.tokenUsage directly. Returns retryReason on a retryable fail.
export function completeStage(
    pipeline: TPipeline<unknown, unknown>,
    stageId: string,
    retrieved: TRetrievedResponse,  // output is RAW TEXT (req 12)
    deps: TExecuteStageDeps,
    attempt?: number
): Promise<TExecuteStageResult>
```

Plus, on `TRetrievedResponse` (additive — req 14) and the OpenAI extension barrel:

```ts
// Additive fields on TRetrievedResponse (retrieveResponse already reads
// envelope.incomplete_details / envelope.error — surface them):
//   incompleteReason?: string   // envelope.incomplete_details.reason
//   errorMessage?: string       // envelope.error.message (for status:"failed")

// Submit a background response and return its id WITHOUT polling/streaming to
// completion (thin extraction of runBackground's submit half:
// callOnce({...background:true, store:true}) → parse → return id+status).
// Handles the terminal-on-submit fast-path (req 15). Same no-tools precondition.
export function submitBackgroundResponse<T>(
    req: TLlmRequest<T>,
    options: { apiKey: string; baseUrl?: string; fetch?: TOpenAiFetch; signal?: AbortSignal }
): Promise<{ responseId: string; status: TResponseStatus }>
```

Requirements:

1. **Reuse, don't reimplement — explicit state threading.** `runOneStage(stage, ctx,
   state)` + `runFinalize(pipeline, ctx, state)` extracted from `executePipeline`
   with an explicit `TStageRunState`. (Shipped 1484abc.)
2. **Input-validation parity.** All rehydrating functions run
   `Value.Parse(pipeline.inputSchema, input)` and seed `ctx.input` with the parsed
   value. A schema mismatch throws.
3. **Carry outcome, not just output.** `ctx.get(dep)` returns `undefined` for a
   non-`completed` upstream; `ctx.stageStatus(dep)` returns the supplied outcome.
4. **Normalize defensively.** Drop `output` when `outcome !== "completed"`.
5. **Accept a superset.** Core uses the stage's / finalize's own `dependsOn`.
6. **`executeStage` emits per-stage events only.** No `pipeline:*` bookends.
   `executeFinalize` emits no events at all.
7. **No whole-DAG reachability validation.** `executeStage` throws
   `PipelineConfigurationError` `UNKNOWN_STAGE` for an unknown id.
8. **`async`/sync finalize.** `executeFinalize` is `async` for symmetry only;
   `TPipelineFinalize.run` stays synchronous.
9. **Config-error disposition (single-stage path).** A `ctx.get`-on-non-dep throws
   OUT of `executeStage`, not swallowed into `failures`.
10. **Boundary on required-failed upstream:** `executeStage` runs the stage's `run`
   regardless of upstream outcomes; `executeFinalize` mirrors `executePipeline`
   (required finalize dep not completed → `output: null`).
> **Why a seam (reqs 11-12) — the original "front/back half of `runOneStage`"
> framing was IMPOSSIBLE.** `runOneStage` sees only an opaque `TStage`
> (`{id,dependsOn,outputSchema,run}`) and calls `stage.run(ctx)` as one black box.
> ALL LLM machinery (`buildPrompt`, the `TLlmRequest` assembly, `ctx.llm.respond()`,
> the `Value.Check`+`classifyError` decision, the events, the `policy`) is sealed in
> the **`llmStage` factory closure** (`stage-helpers.ts:221-481`). So the seam must
> be carved out of **`llmStage`**.

11. **Carve the PACKAGE-INTERNAL `llmStage` seam (single source of truth, scoped).**
   Factor `llmStage`'s body so it calls two **package-internal** fns (NOT exported):
   `buildLlmRequest(cfg, ctx, userMessage?)` (front: prompt-build + `TLlmRequest`
   assembly) and `validateLlmOutcome(cfg, rawText, status, incompleteReason)` (back:
   parse + `Value.Check` + the `lib/`-side mirror classification) — that the
   in-process `llmStage.run` retry loop ALSO calls. **`llmStage`'s public return type
   STAYS `TStage<TOutput>`** (it does NOT widen). Because `TStage` is opaque, the
   config rides a **package-internal carrier** (an internal-symbol-keyed,
   non-enumerable property) read by a package-internal accessor
   `readLlmStageConfig(stage)`. `launchStage`/`completeStage` recover the config via
   that accessor (clear throw if not an LLM stage). The seam fns + carrier/accessor
   are **NOT in the barrel** — no consumer use case. Existing `llmStage` callers +
   `executePipeline` are byte-identically unaffected.
12. **`launchStage` (front) + `completeStage` (back) via the seam.**
   - `launchStage`: `Value.Parse` input → build `ctx` from `upstream` → recover the
     config via `readLlmStageConfig(stage)` (throws if not an LLM stage) → compute the
     per-attempt `userMessage` (attempt 1 = `buildPrompt(ctx).user`; attempt 2+ = the
     SAME retry-suffix the in-process loop appends, via a package-internal shared
     helper) → `buildLlmRequest(cfg, ctx, userMessage)` → emit `stage:start` +
     `stage:llm-request` → **submit-only** via `deps.submitBackgroundResponse` →
     emit `stage:llm-response-created` → return `{ responseId, status }`. NO await,
     NO output validation, NO `stage:llm-call`/`stage:end`. Throws clearly if the
     submit dep is absent. (Minor: `req.onResponseCreated` is UNUSED here — the id
     comes from the submit RETURN; `launchStage` erases `TOutput` at the
     `TLlmRequest<unknown>` dep boundary, with the typed output recovered in
     `completeStage` via the schema.)
   - `completeStage`: recover `cfg` via `readLlmStageConfig(stage)`. **`retrieved.output`
     is RAW assistant TEXT, not parsed** (`provider.ts:674`). So: if
     `status==="completed"`, parse the raw text FIRST (a parse throw →
     `retryReason:"schema_validation"`), THEN `Value.Check`; for a non-completed
     status, classify `(status, incompleteReason)` per the TABLE below. Emit
     `stage:llm-call` + `stage:end` (NO `stage:start`). Attach `retrieved.tokenUsage`
     DIRECTLY (no `ctx`-WeakMap stash — it's per-`ctx` and cannot bridge the two
     invocations). Return `{ outcome, output?, failures, tokenUsage, retryReason }`.
   - **The parse + `Value.Check` half of `validateLlmOutcome` is shared** with the
     in-process loop; but the **status/reason→outcome+retry mapping is a `lib/`-side
     MIRROR** of the provider's classification (the provider's classifier lives in
     `src/extensions/`, and `src/lib/` may not import it — the zero-SDK-import
     invariant). The mirror is guarded against drift by a CONTRACT TEST.

   **`completeStage` status/reason → outcome + `retryReason` TABLE:**

   | `retrieved.status` | `incompleteReason` | outcome | `retryReason` |
   |---|---|---|---|
   | `completed` + parses + schema-valid | — | `completed` | — |
   | `completed` + parse throws (bad JSON) | — | `failed` | `schema_validation` |
   | `completed` + schema-invalid | — | `failed` | `schema_validation` |
   | `incomplete` | `max_output_tokens` | `failed` | `transient` |
   | `incomplete` | `content_filter` | `failed` | **none — fail-fast** |
   | `incomplete` | other / unspecified | `failed` | `transient` (conservative) |
   | `failed` | — | `failed` | **none — fail-fast** (a terminal `failed` envelope is `NonRetryableLlmError` → `classifyError` → `non_retryable`; surface `errorMessage`. `transient` would be WRONG — it's in `DEFAULT_RETRY_POLICY.retryOn` and the workflow would retry it.) |
   | `cancelled` | — | **`skipped`** | none (a `cancelled` background status → `StageAbortedError` → recorded `skipped` with NO `ProcessingFailure`; NOT `failed`. `TExecuteStageResult.outcome` admits `skipped`.) |

   The `cancelled → skipped` row is the only non-`failed` non-completed outcome —
   **SRV-2 treats a `skipped`-on-cancel completion as a SKIP** (optional-dep/skip
   semantics, not failure — SRV-2 fold D).
13. **Single-attempt; the workflow owns retries — reason CODE, not a bool.**
   `launchStage`/`completeStage` do NOT loop. `completeStage` sets
   **`result.retryReason`** on a retryable failure, and **NO `retryReason` for the
   genuinely-non-retryable cases** (`failed`, `content_filter`, `cancelled`-which-is-
   `skipped`). The workflow's re-launch predicate is `retryReason != null &&
   retryCount < INGESTION_STAGE_MAX_ATTEMPTS`. This moves the per-attempt loop out of
   core into the durable orchestrator.
14. **Surface `incompleteReason` (+ `errorMessage`) on `TRetrievedResponse`
   (additive).** `retrieveResponse` already reads `envelope.incomplete_details` /
   `envelope.error` — carry `incompleteReason?: string` + `errorMessage?: string`
   onto the returned shape. Additive + backward-compatible.
15. **New provider capability — `submitBackgroundResponse` (submit-only) + a typed
   dep.** Extract `runBackground`'s submit half + the terminal-on-submit fast-path
   into a public OpenAI-extension fn that returns `{ responseId, status }` at submit
   WITHOUT the poll loop; handle the already-terminal-on-submit envelope (return it).
   Same no-tools precondition. **Inject it as a NEW optional, structurally-typed field
   `submitBackgroundResponse?` on `TExecuteStageDeps`** (function-type only — `lib/`
   takes NO openai import). `launchStage` requires it. **DESIGN DECISION (resolved at
   human-check):** keep `submitBackgroundResponse` OpenAI-extension-only — the
   launch/complete split is inherently an OpenAI-background concept; the typed-dep
   shape implements this with NO `TLlmProvider` change.
16. **Event-split is a cross-slice contract.** Across the split the per-stage events
   are NOT a balanced start/end pair per invocation: `launchStage` emits
   `stage:start`/`stage:llm-request`/`stage:llm-response-created` (NO end);
   `completeStage` emits `stage:llm-call`/`stage:end` (NO start). The pair spans two
   invocations, bridged by the persisted stage row.

## Serialize/rehydrate contract

> A stage's serialized form is `{ outcome, output? }`; `output` is the value the
> stage's `outputSchema` accepts and is JSON round-trippable; `output` is present
> iff `outcome === "completed"`. Rehydration reads the persisted record back into
> a `TStageOutcomeRecord`. The pipeline's finalize output is likewise JSON
> round-trippable.

A **unit assertion in the TEST file** (not `lib/` source) checks that representative
values for every shipped v2 ingestion stage output AND a representative finalize
output round-trip through JSON — `JSON.parse(JSON.stringify(v))` deep-equals `v`.

## Impact on the consumer

`proposit-server` persists each stage's `{ outcome, output }` to Postgres (jsonb)
and rehydrates upstream records per step. Per LLM stage the Workflow:
`launchStage(...)` → `{ responseId, status }` → AWAITED persist of the id →
`createHook({ token: responseId })` → suspend → (on the `response.completed`
webhook) `retrieveResponse(responseId)` → `completeStage(pipeline, stageId,
retrieved, { llm, onEvent })` → if `result.retryReason != null && retryCount <
INGESTION_STAGE_MAX_ATTEMPTS`, re-`launchStage` a fresh attempt, else persist +
advance/settle (a `skipped`-on-cancel completion advances as a SKIP, not a
failure). A terminal `status` returned from `launchStage` means no hook fires; SRV-2
detects it and goes straight to `completeStage`. Deterministic stages run inline via
`executeStage`; finalize runs inline via `executeFinalize`. The existing `onEvent`
bridge is reused. The shipped `retrieveResponse` / `reconnectStream` /
`cancelResponse` (1.10.0) are reused as-is; `backgroundStreamMode`/`onResponseCreated`
are NOT used on the durable path.

## Test cases (the dev writes these first)

Reqs 1-10 (shipped 1484abc — keep green): single-stage run; input parity; skipped/
failed upstream rehydration; config-error throw-out; unknown-stage throw; token
usage; no-bookend events; `executeFinalize` happy / required-dep-not-completed /
optional-skipped / throws; defensive normalization; JSON value round-trip over all
12 stage outputs + finalize.

Launch/complete delta (reqs 11-16):

- **seam (package-internal):** `llmStage(...)` still returns `TStage`;
  `executePipeline` over a v2 pipeline stays green; `readLlmStageConfig(stage)`
  recovers the config (undefined for non-LLM); `buildLlmRequest(cfg, ctx)` produces
  the same `TLlmRequest` the in-process loop assembles; `validateLlmOutcome(cfg,
  rawText, "completed", undefined)` reproduces the in-process accept/reject.
- **drift-guard CONTRACT TEST (#12):** for each `(status, incompleteReason)`
  envelope in the TABLE, assert `validateLlmOutcome`'s `(outcome, retryReason)`
  matches what `provider.respond()` throws/classifies for the SAME envelope (drive
  the provider with a mock fetch). Must cover the corrected rows: `failed` →
  fail-fast (NO `retryReason`), `cancelled` → `skipped`.
- `submitBackgroundResponse` returns `{ responseId, status }` at submit WITHOUT a
  poll GET (mock fetch called once); a `completed` submit envelope returns
  `status:"completed"` (fast-path #15); tool-bearing request throws
  `NonRetryableLlmError`;
- `launchStage` returns `{ responseId, status }`, emits start/request/
  response-created (NO llm-call/end), does NOT await; missing
  `submitBackgroundResponse` → clear throw; non-LLM `stageId` → clear throw;
- `completeStage` raw-text parse THEN schema check; malformed JSON → `failed` +
  `retryReason:"schema_validation"`; the classification TABLE (parametric) incl. the
  corrected `failed`→fail-fast and `cancelled`→`skipped` rows; `incompleteReason`
  threaded from `retrieved.incompleteReason`;
- launch+complete reuses the seam: a fixture through (a) in-process `executeStage`
  with a sync provider and (b) `launchStage`→`completeStage` → identical output +
  identical per-stage event payloads;
- retry-suffix parity: `launchStage(..., attempt:2)` builds the same retry-suffixed
  `userMessage` the in-process loop appends on its 2nd attempt;
- `llmStage`/`executePipeline` suites stay green after the seam refactor (public
  `TStage` return UNCHANGED).

## Out of scope

- Changes to the OpenAI response-lifecycle API (`retrieveResponse` /
  `reconnectStream` / `cancelResponse`) or stage prompts/schemas — all already
  shipped in 1.10.0. (`submitBackgroundResponse` is net-new + the additive
  `incompleteReason`/`errorMessage`, a thin submit-only extraction + field surfacing.)
- Cross-invocation state in core. Durability lives in the consumer's Postgres; all
  functions are stateless — the per-attempt retry loop for LLM stages lives in the
  WORKFLOW, not core.
