# Change request: per-stage + finalize execute + context serialize/rehydrate (carrying outcome)

**Requested by:** `proposit-server` (durable, unattended ingestion via Vercel
Workflows). **Type:** public-API addition (pipeline framework) — **two** symmetric
functions (`executeStage` + `executeFinalize`) + their types. **Target:** a
minor (e.g. `1.11.0`). **Consumer-validation-gated** before publish.

## Problem

`proposit-server` is moving ingestion off the single in-process `executePipeline`
call and onto a durable orchestrator (Vercel Workflows) that runs **each stage in
its own serverless invocation**, persisting typed stage outputs to Postgres
between stages. To run stage N in a fresh invocation, the server must hand core
stage N's upstream stages' typed outputs **and their outcomes** so `ctx.get` and
`ctx.stageStatus` behave exactly as they do inside the monolithic run. The same is
true of the pipeline's **finalize** step: once all of finalize's deps complete, the
Workflow must run finalize from the persisted upstream records — so the change
must expose finalize as its own entry point too (finalize is multi-parent and is
not a stage).

Today the inter-stage state (`records: Map`) is private to one `executePipeline`
call (`src/lib/pipelines/execute.ts:229`), and `ctx.get` returns the output only
for a `completed` upstream (`execute.ts:264-267`). There is no public way to
inject pre-computed upstream records and run a single stage.

## Root cause

The engine has no single-stage and no standalone-finalize entry point.
`executePipeline` validates the whole DAG, schedules all stages, runs finalize,
and emits run-level bookends — all welded together. A separate-invocation model
needs two thin, stateless calls — "run one stage given its upstream records" and
"run finalize given its upstream records" — that reuse the existing per-stage and
finalize semantics verbatim.

## Proposed API

Add `executeStage` AND `executeFinalize` (free functions, alongside
`executePipeline`), exported from the pipeline barrel + package root:

```ts
export type TStageOutcomeRecord = {
    outcome: TStageStatus // "completed" | "skipped" | "failed"
    output?: unknown // present iff outcome === "completed"
}

export type TExecuteStageDeps = {
    llm: TLlmProvider
    generateId?: () => string
    signal?: AbortSignal
    onEvent?: (event: TPipelineEvent) => void
}

export type TExecuteStageResult = {
    outcome: TStageStatus
    output?: unknown // present iff outcome === "completed"
    failures: TProcessingFailure[]
    tokenUsage?: TLlmTokenUsage
}

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

export function executeFinalize<TOutput>(
    pipeline: TPipeline<unknown, TOutput>,
    upstream: Readonly<Record<string, TStageOutcomeRecord>>,
    input: unknown,
    deps: TExecuteStageDeps
): Promise<TExecuteFinalizeResult<TOutput>>
```

Requirements:

1. **Reuse, don't reimplement — explicit state threading.** Extract the per-stage
   body of `runStage` (`execute.ts:325-473`) into a private
   `runOneStage(stage, ctx, state)`, AND the finalize body of `executePipeline`
   (`execute.ts:600-626`) into a private `runFinalize(pipeline, ctx, state)`, where
   `state` is a small `TStageRunState` threaded **explicitly** (NOT closure-
   captured): `{ records: Map<string, TStageRecord>; failures:
TProcessingFailure[]; signal: AbortSignal; emit: (e: TPipelineEvent) => void;
setConfigError: (e: PipelineConfigurationError) => void }`. Both
   `executePipeline` and the new functions construct this state and share one
   source of truth. `executeStage` / `executeFinalize` each build a fresh `ctx` via
   the existing `makeCtx` logic (`execute.ts:249-297`), seed the `records` map from
   `upstream`, and run exactly one stage / the finalize. Same `ctx.get` "completed
   only" rule, same `ctx.stageStatus`, same token-usage WeakMap
   (`stage-helpers.ts:490-513`), same abort handling, same output `Value.Check`;
   for finalize, the same `finalizeRequiredOk()` gate (`execute.ts:603-610`) and the
   same `FINALIZE_UNCAUGHT_ERROR` capture (`execute.ts:616-625`).
2. **Input-validation parity.** Both functions MUST run
   `Value.Parse(pipeline.inputSchema, input)` and seed `ctx.input` with the
   **parsed** value (the Default/Convert/Clean-transformed form), exactly mirroring
   `executePipeline` (`execute.ts:199-200`). Two v2 stages read `ctx.input`
   (segmentation, claim-canonicalization), so seeding the raw value would diverge
   from the monolithic run. A schema mismatch throws (caller bug), as in
   `executePipeline`.
3. **Carry outcome, not just output.** `ctx.get(dep)` must return `undefined` for
   a non-`completed` upstream; `ctx.stageStatus(dep)` must return the supplied
   outcome. (This is the whole reason the unit is `{ outcome, output? }` and not a
   bare output map.)
4. **Normalize defensively.** Both functions drop `output` when
   `outcome !== "completed"` before seeding `records`, so a caller bug can't leak a
   stale output into a skipped/failed dependency.
5. **Accept a superset.** The caller may pass all persisted upstream records;
   core uses the stage's (or finalize's) own `dependsOn` to pick the relevant ones
   (the caller should not have to re-derive the dep set core already knows).
6. **`executeStage` emits per-stage events only.** Emit `stage:start`,
   `stage:llm-request`, `stage:llm-response-created`, `stage:llm-call`,
   `stage:retry`, `stage:end` — so the server's existing `onEvent` persistence
   bridge works per stage unchanged. Do **not** emit `pipeline:start` /
   `pipeline:end` (run-level bookends are the server orchestrator's concern).
   **`executeFinalize` emits no events at all** (finalize has no `stage:*`
   lifecycle, matching `executePipeline`, and no `pipeline:*` bookends).
7. **No whole-DAG reachability validation** inside either function. `executeStage`
   validates only that `stageId` exists in the pipeline, throwing a
   `PipelineConfigurationError` with a new **`UNKNOWN_STAGE`** `code` (a deliberate
   additive member of the `code` union — NOT a reuse of `UNKNOWN_DEP`) otherwise;
   `executeFinalize` needs no stage-id (it always targets the pipeline's single
   `finalize`).
8. **`async`/sync finalize.** `executeFinalize` is `async` ONLY for signature
   symmetry with `executeStage` (so callers `await` both uniformly).
   `TPipelineFinalize.run` stays **synchronous** (`types.ts:83-86` — do NOT change
   it to return a Promise); the `async` wrapper just resolves the synchronous
   finalize result.
9. **Config-error disposition (single-stage path).** A `ctx.get`/`ctx.stageStatus`
   call on a non-dependency stage id (`GET_OUTSIDE_DEPS`/`STATUS_OUTSIDE_DEPS`) is
   a caller bug; it **throws OUT of `executeStage`**, NOT swallowed into the
   result's `failures`. (In `executePipeline` it is captured via `setConfigError`
   and re-thrown after the bookends; `executeStage` has no bookends, so it throws
   immediately. The `setConfigError` seam in `TStageRunState` lets the two paths
   route to their respective dispositions from one extracted body.)
10. **Boundary on required-failed upstream:** `executeStage` runs the stage's
    `run` regardless of upstream outcomes it was handed (letting `ctx.get` return
    undefined for non-completed deps). The "a required dep failed → skip this
    stage" decision belongs to the scheduler in `executePipeline` and to the
    server orchestrator in the durable model — document this boundary so the
    consumer doesn't expect core to refuse the call. `executeFinalize` mirrors
    `executePipeline`: a required finalize dep that is not `completed` yields
    `output: null` (the `finalizeRequiredOk()` gate); an `optional(...)` finalize
    dep that is skipped/failed lets finalize run with `ctx.get(dep) === undefined`.

## Serialize/rehydrate contract

The contract is the `TStageOutcomeRecord` type (consumed by both functions) plus a
documented invariant:

> A stage's serialized form is `{ outcome, output? }`; `output` is the value the
> stage's `outputSchema` accepts and is JSON round-trippable; `output` is present
> iff `outcome === "completed"`. Rehydration reads the persisted record back into
> a `TStageOutcomeRecord`. The pipeline's finalize output is likewise JSON
> round-trippable (it is persisted + parsed downstream).

Add a **unit assertion in the TEST file (not `lib/` source)** that representative
**values** for every shipped v2 ingestion stage output AND a representative
finalize output round-trip through JSON — `JSON.parse(JSON.stringify(v))`
deep-equals `v` (a VALUE round-trip, NOT a schema→JSON→schema check; the v2
finalize `outputSchema` is intentionally `additionalProperties: true`, so a
schema-level round-trip would be inaccurate). This guards the "JSON serializable"
half of the contract for the whole serialize/rehydrate surface. (Plain unit test;
not tied to the background-mode build-time assertion.)

## Impact on the consumer

`proposit-server` will: persist each stage's `{ outcome, output }` to Postgres
(jsonb); in each per-stage Workflow step, read the upstream records back and call
`executeStage(pipeline, stageId, upstream, input, { llm, onEvent })`; once all
finalize deps complete, call
`executeFinalize(pipeline, upstream, input, { llm })` to produce the pipeline
output; reuse the existing `onEvent` bridge for per-stage persistence + SSE. No
other core API changes are needed — `backgroundStreamMode`, `onResponseCreated`,
`retrieveResponse`, `reconnectStream`, `cancelResponse` (all shipped in 1.10.0)
are reused as-is.

## Test cases (the dev writes these first)

- single-stage run from fixed upstream `completed` outputs;
- input parity: an `inputSchema` with a Default/Convert transform → `ctx.input` is
  the parsed (transformed) value, identical to `executePipeline`'s seed (both
  functions);
- `skipped` upstream → `ctx.get` undefined AND `ctx.stageStatus` === "skipped";
- `failed` required upstream → stage runs, `ctx.get` undefined (boundary #10);
- config error: a stage calling `ctx.get` on a non-dep → `executeStage` REJECTS
  with `PipelineConfigurationError` (not a `failed` result);
- unknown stage id → `executeStage` throws `PipelineConfigurationError`
  (`UNKNOWN_STAGE`);
- retry (attempt-1 schema-invalid → attempt-2 ok) emits the identical per-stage
  event sequence to the whole-run path;
- token usage surfaced in the result;
- `executeStage` emits no `pipeline:start`/`pipeline:end`; `executeFinalize` emits
  no events at all;
- `executeFinalize` happy path returns the finalize output; a not-`completed`
  REQUIRED finalize dep (use `claim-canonicalization` or `formula-compilation`,
  NOT `variable-assignment`) → `output: null`; a skipped `optional(...)` finalize
  dep → finalize runs with `ctx.get(dep) === undefined`; a throwing finalize →
  `output: null` + `FINALIZE_UNCAUGHT_ERROR`;
- normalization drops `output` on non-completed records (both functions);
- JSON VALUE round-trip (`JSON.parse(JSON.stringify(v))` deep-equals `v`) for
  representative values of all 12 v2 stage outputs AND a finalize output;
- the existing `executePipeline` suite stays green after the `runOneStage` +
  `runFinalize` extractions.

## Out of scope

- Any change to the OpenAI provider, the response-lifecycle API, or stage
  prompts/schemas — all already shipped in 1.10.0.
- Cross-invocation state in core. Durability lives in the consumer's Postgres;
  `executeStage` and `executeFinalize` are stateless (state in, state out).
