# Ingestion Pipeline Framework — proposit-core agenda

**Initiative spec:** `/Users/brian/Projects/Proposit-App/docs/superpowers/specs/2026-05-22-ingestion-pipeline-overview.md`
**Initiative plan:** `/Users/brian/Projects/Proposit-App/docs/superpowers/plans/2026-05-22-ingestion-pipeline-overview-plan.md`
**Branch:** `ingestion-pipeline/phase-1` off `proposit-core/main` (currently at `v1.0.2`)
**Reviewer:** `proposit-core-reviewer` after each slice commit batch.
**Target release:** `proposit-core@1.1.0` (minor, additive) at the end of slice 1D.

## Capability changes

None. `proposit-core` is a library — no `capabilities.md` files. After Phase 1 lands, `CLAUDE.md` gains a "Pipeline framework" subsection under "Key design rules" (per slice 1D); no per-capability surface changes.

## Phase 1 scope — slices 1A → 1D (this agenda)

Phase 1 lands the pipeline framework + the OpenAI provider extension + the v1 single-shot ingestion pipeline + a minor release. **Behavior is bit-for-bit identical to today** under recorded-replay golden corpus on a `straightforward` fixture; the v1 pipeline is a port of the existing single-shot parser, routed through the new framework. No user-visible change.

Slice 2A (the 12-stage v2 multi-stage pipeline) follows in Phase 2 — **not** in this agenda. A separate agenda addendum will be appended at the start of Phase 2 with per-stage specs authored by `proposit-architect`.

---

## Slice 1A — Framework primitives + abstract LLM interface

### Goal

Land `src/lib/pipelines/` (framework primitives + scheduler) and `src/lib/llm/` (abstract `LlmProvider` interface). **No third-party SDK deps.** No concrete provider. No ingestion stages — those are slices 1B and 1C.

This slice establishes the shape every subsequent slice plugs into. Get it right; the rest of the initiative depends on this surface.

### Files to create

- `src/lib/pipelines/types.ts` — `Stage<TOutput>`, `Pipeline<TInput, TOutput>` (with `finalize: { dependsOn, run }`), `StageContext` (with `get<T>` + `stageStatus`), `ProcessingFailure`, `PipelineResult<TOut>`, `PipelineEvent`, `DepSpec` (the `string | OptionalDep` union), `optional(id)` helper.
- `src/lib/pipelines/execute.ts` — `executePipeline(pipeline, input, deps)` scheduler.
- `src/lib/pipelines/stage-helpers.ts` — `deterministicStage(config)`, `llmStage(config)`, `subPipelineStage(config)`.
- `src/lib/pipelines/index.ts` — barrel re-exporting the public surface (`executePipeline`, the helper constructors, and the types consumers need).
- `src/lib/llm/types.ts` — `LlmProvider`, `LlmRequest<T>`, `LlmResponse<T>`, `ToolSpec` (discriminated union over `'web_search' | 'file_search' | 'mcp' | 'function'`), `LlmModel` / `ReasoningEffort` literal types.
- `src/lib/llm/index.ts` — barrel.
- `test/pipelines.test.ts` — framework unit tests (mock-provider-driven).
- `test/mocks/llm.ts` — `createMockLlmProvider({ responses, recordCalls?, errorFor? }): LlmProvider` mock implementation.

### Files to modify

- `src/lib/index.ts` — re-export public types from `pipelines/` + `llm/`. Be surgical: export `executePipeline`, `optional`, `deterministicStage`, `llmStage`, `subPipelineStage`, and the public TypeScript types consumers need (`Stage`, `Pipeline`, `StageContext`, `ProcessingFailure`, `PipelineResult`, `PipelineEvent`, `LlmProvider`, `LlmRequest`, `LlmResponse`, `ToolSpec`). Do **not** re-export internal types like the executor's scheduler state.

### Type definitions — exact shapes

Match the spec verbatim. Quoting key shapes for unambiguity:

```ts
// src/lib/pipelines/types.ts

import type { TSchema } from "typebox"
import type { LlmProvider } from "../llm/types.js"

type OptionalDep = { readonly __optional: true; readonly id: string }
export function optional(id: string): OptionalDep {
    return { __optional: true, id }
}
export type DepSpec = string | OptionalDep

export type Stage<TOutput> = {
    id: string
    dependsOn: readonly DepSpec[]
    outputSchema: TSchema
    run: (ctx: StageContext) => Promise<TOutput>
}

export type StageStatus = "completed" | "skipped" | "failed"

export type StageContext = {
    input: unknown
    get<T>(stageId: string): T | undefined
    stageStatus(stageId: string): StageStatus
    llm: LlmProvider
    generateId: () => string
    signal: AbortSignal
    emit: (event: PipelineEvent) => void
    addFailure: (failure: Omit<ProcessingFailure, "stage">) => void
}

export type Pipeline<TInput, TOutput> = {
    id: string
    version: string
    inputSchema: TSchema
    outputSchema: TSchema
    stages: readonly Stage<unknown>[]
    finalize: {
        dependsOn: readonly DepSpec[]
        run: (ctx: StageContext) => TOutput
    }
}

export type ProcessingFailure = {
    stage: string
    code: string
    message: string
    severity: "warning" | "error"
    context?: Record<string, unknown>
}

export type TokenUsage = {
    input: number
    output: number
    reasoning?: number
}

export type PipelineResult<TOut> = {
    output: TOut | null
    failures: ProcessingFailure[]
    stageOutcomes: Record<string, StageStatus>
    tokenUsage?: TokenUsage
}

export type PipelineEvent =
    | {
          kind: "pipeline:start"
          pipelineId: string
          pipelineVersion: string
          at: number
      }
    | {
          kind: "pipeline:end"
          status: "completed" | "failed"
          output: "present" | "null"
          at: number
      }
    | { kind: "stage:start"; stageId: string; at: number }
    | {
          kind: "stage:end"
          stageId: string
          status: StageStatus
          tokenUsage?: TokenUsage
          at: number
      }
    | {
          kind: "stage:retry"
          stageId: string
          attempt: number
          reason: string
          at: number
      }
```

```ts
// src/lib/llm/types.ts

import type { TSchema } from "typebox"

export type LlmModel = "gpt-5.5" | "gpt-5.4" | "gpt-5.4-mini" | "gpt-5.4-nano"
export type ReasoningEffort = "minimal" | "low" | "medium" | "high"

export type ToolSpec =
    | { kind: "web_search" }
    | { kind: "file_search"; vectorStoreId: string }
    | { kind: "mcp"; serverUrl: string; toolName?: string }
    | {
          kind: "function"
          name: string
          description: string
          parameters: TSchema
          handler: (args: unknown) => Promise<unknown>
      }

export type LlmRequest<T> = {
    model: string // typed as string (not LlmModel) for forward-compat
    reasoningEffort?: ReasoningEffort
    systemPrompt: string
    userMessage: string
    outputSchema: TSchema
    tools?: readonly ToolSpec[]
    maxOutputTokens?: number
    signal?: AbortSignal
    _typeMarker?: T // phantom for inference; runtime undefined
}

export type LlmResponse<T> = {
    output: T
    tokenUsage: { input: number; output: number; reasoning?: number }
    rawResponseId?: string
}

export type LlmProvider = {
    respond<T>(req: LlmRequest<T>): Promise<LlmResponse<T>>
}
```

The `_typeMarker?: T` field is a phantom — its value is always `undefined` at runtime; it exists only so the type system can carry `T` from `outputSchema` (`TSchema`) into the response. The mock provider and the future concrete provider can ignore it. If a cleaner technique exists in this codebase, use it — the goal is `respond` returning a typed output keyed by the schema.

### Helper constructors

```ts
// src/lib/pipelines/stage-helpers.ts

import type { TSchema } from "typebox"
import type { Stage, DepSpec, StageContext } from "./types.js"
import type { LlmRequest, ReasoningEffort, ToolSpec } from "../llm/types.js"

export function deterministicStage<TOutput>(config: {
    id: string
    dependsOn: readonly DepSpec[]
    outputSchema: TSchema
    fn: (ctx: StageContext) => Promise<TOutput> | TOutput
}): Stage<TOutput> {
    return {
        id: config.id,
        dependsOn: config.dependsOn,
        outputSchema: config.outputSchema,
        run: async (ctx) => config.fn(ctx),
    }
}

export type RetryPolicy = {
    maxAttempts: number
    backoffMs: number
    retryOn: readonly ("schema_validation" | "transient" | "rate_limit")[]
    maxAppendedErrorBytes?: number   // default 2048 (2 KB cap per spec §6.3)
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
    maxAttempts: 2,
    backoffMs: 500,
    retryOn: ["schema_validation", "transient"],
    maxAppendedErrorBytes: 2048,
}

export function llmStage<TOutput>(config: {
    id: string
    dependsOn: readonly DepSpec[]
    outputSchema: TSchema
    model: string
    reasoningEffort?: ReasoningEffort
    buildPrompt: (ctx: StageContext) => { system: string; user: string }
    tools?: readonly ToolSpec[]
    retry?: Partial<RetryPolicy>
    maxOutputTokens?: number
}): Stage<TOutput> {
    // Implementation: call ctx.llm.respond(...) with the built prompt + outputSchema.
    // Handle retry per the policy. Schema-validation failures append the (truncated) error
    // to the user message on retry. Transient failures retry with backoff.
    // After maxAttempts exhausted, throw a structured error that the executor catches
    // and turns into a ProcessingFailure with severity "error".
    // See test plan for exact behavior contracts.
    ...
}

export function subPipelineStage<TOutput>(config: {
    id: string
    dependsOn: readonly DepSpec[]
    pipeline: import("./types.js").Pipeline<unknown, TOutput>
}): Stage<TOutput> {
    // Implementation: recursively execute the nested pipeline; bubble events with
    // a prefixed stage id so the outer scheduler doesn't see id collisions.
    // RESERVED FOR FUTURE COMPOSITION. Implementation is required (real code, not a stub)
    // but not used by any ingestion pipeline in this initiative. Unit tests exercise it.
    ...
}
```

### `executePipeline` scheduler — required behavior

Implement per spec §5.4 verbatim. Key points to get right:

1. **Input validation.** `Value.Parse(pipeline.inputSchema, input)` first thing. On failure, throw — input-schema mismatch is a caller bug, not a recoverable runtime failure.
2. **DAG validation at entry.** Walk `pipeline.stages` + `pipeline.finalize.dependsOn`. Reject (throw) on: cycles, unknown deps, self-deps, missing-stage deps. All before any stage runs.
3. **Optional-dep handling.** When a stage's `dependsOn` entry is an `OptionalDep` (the `{ __optional: true, id }` object), the executor's eligibility check treats it as satisfied regardless of upstream outcome. When `ctx.get(id)` is called on an optional dep whose upstream was skipped/failed, return `undefined`. `ctx.stageStatus(id)` returns the actual status.
4. **`ctx.get` strictness.** Throw at executor-build time if a stage calls `ctx.get(id)` where `id` isn't in its `dependsOn` (required or optional). This is a static check: walk the stage's deps once; the closure passed as `ctx.get` validates against that set.
5. **Concurrency.** `concurrencyLimit` defaults to 4. Use a simple semaphore (in-flight counter + waiting promises) or an existing pattern in `proposit-core`; do NOT pull in a heavy dep.
6. **Retry policy.** `llmStage`'s `run` catches retryable errors per the policy. Schema-validation retry: truncate the validation-error message to `maxAppendedErrorBytes` (default 2 KB) before appending to the user message. The truncated suffix uses `…<truncated>` if cut. After `maxAttempts` exhausted, the stage is `failed`.
7. **Failure propagation.** Failed stage → downstream stages with required deps on it are `skipped`. Optional deps → downstream stages run with `ctx.get` returning `undefined`.
8. **Finalize behavior.** If any required `finalize.dependsOn` stage is `skipped` or `failed`, `finalize.run` is **not** called; `output: null` directly. If all required finalize deps completed, `finalize.run` runs even if some optional finalize deps were skipped.
9. **Events.** `pipeline:start` fires once at the top (after input validation + DAG validation, before any stage). `pipeline:end` fires once at the bottom (after finalize or its bypass). `stage:start` / `stage:end` per stage. `stage:retry` on each retry attempt.
10. **Cancellation.** `AbortSignal` propagates: in-flight provider calls receive the signal via `LlmRequest.signal`; pending stages don't start. The executor returns a result with `output: null` and stage outcomes accurately reflecting what ran.
11. **Token usage.** Sum `LlmResponse.tokenUsage` per `stage:end` into `PipelineResult.tokenUsage`. Deterministic stages don't contribute.

### Mock provider

```ts
// test/mocks/llm.ts

import type { LlmProvider, LlmRequest, LlmResponse, TokenUsage } from "../../src/lib/llm/types.js"
import { Value } from "typebox/value"

export type MockResponse =
    | { kind: "ok"; output: unknown; tokenUsage?: TokenUsage }
    | { kind: "error"; error: Error }
    | { kind: "schema-invalid"; output: unknown }  // returns output but it fails outputSchema parse

export type MockCallRecord = {
    stageId?: string          // when invoking via llmStage, the stage id is encoded in the system prompt; pull it via convention or pass explicitly
    model: string
    systemPrompt: string
    userMessage: string
    at: number                // performance.now()
}

export function createMockLlmProvider(opts: {
    responses: Record<string, MockResponse[]>  // keyed by an explicit stage-id field embedded in systemPrompt OR by call-order
    onCall?: (record: MockCallRecord) => void
}): LlmProvider {
    ...
}
```

Mock-provider keying: the simplest approach is for `llmStage`'s `buildPrompt` to embed a `<!--stage-id: <id> -->` marker in the system prompt. The mock provider greps for it to look up the canned response. (The real OpenAI provider ignores this marker — it's a no-op HTML comment in the system message.) Alternatively: have the mock take a `keyByCallOrder: true` option and require tests to enumerate responses in scheduling order. Pick whichever feels cleaner; document the choice.

### Test plan (TDD — author tests before implementation)

Coverage from spec §11.1, all against the mock provider:

1. **DAG validation at entry.**
    - Pipeline with a cycle: `executePipeline` throws with `DAG_CYCLE` error before any stage runs.
    - Pipeline with an unknown dep: throws with `UNKNOWN_DEP`.
    - Pipeline with a self-dep: throws with `SELF_DEP`.
    - Pipeline with a `finalize.dependsOn` entry referencing a non-existent stage: throws.

2. **Concurrency.**
    - Two stages with no shared deps: assert via mock's `onCall` records that they overlap in time (start within 50ms of each other; resolve before the next batch).
    - Three independent stages with `concurrencyLimit: 2`: at most two in flight simultaneously.

3. **Failure propagation.**
    - Required dep: stage A fails → stage B (with required dep on A) has outcome `skipped`, never starts.
    - Optional dep: stage A fails → stage B (with optional dep on A) runs; `ctx.get<TA>('a')` returns `undefined`; `ctx.stageStatus('a')` returns `'failed'`.
    - Mixed: stage A fails, stage B (required on A) is skipped, stage C (optional on B + required on D-which-passes) runs and sees `B` as `skipped`.

4. **Schema validation.**
    - Stage returns output that fails `outputSchema`: emits `ProcessingFailure { code: 'OUTPUT_SCHEMA_INVALID', severity: 'error' }`; stage marked `failed`; downstream-required marked `skipped`.

5. **Retry.**
    - Schema-validation failure on attempt 1, success on attempt 2: stage completes; one `stage:retry` event with `reason: 'schema_validation'`.
    - Schema-validation failure on both attempts: stage `failed`; final `ProcessingFailure` carries the latest validation error.
    - Validation error longer than `maxAppendedErrorBytes`: appended portion is truncated with `…<truncated>`.
    - Transient (5xx-style mock error) retry: same shape but `reason: 'transient'`.
    - Rate-limit not in `retryOn` by default: no retry; stage `failed` immediately.

6. **Token usage aggregation.**
    - Three llmStages with `tokenUsage: { input: 100, output: 50 }`, `{ input: 200, output: 100 }`, `{ input: 50, output: 25 }` → `PipelineResult.tokenUsage: { input: 350, output: 175 }`.
    - Deterministic stages don't contribute.

7. **Cancellation.**
    - Signal aborted mid-stage: provider receives the signal; in-flight stage's mock response races with abort; pending stages don't start; result has `output: null` and accurate `stageOutcomes`.

8. **Pipeline events.**
    - Happy path: `pipeline:start` → ordered `stage:start` / `stage:end` per stage (concurrent stages interleave) → `pipeline:end` with `status: 'completed'`, `output: 'present'`.
    - Failure path: `pipeline:end` has `status: 'completed'` (the pipeline succeeded; the failure is a ProcessingFailure) OR `status: 'failed'` (an exceptional throw escaped). Be precise about which case is which — the spec says only DAG-validation errors and abort throw; everything else surfaces in the result.
    - `output: 'null'` when finalize returns null OR its required deps were skipped.

9. **Finalize semantics.**
    - All required finalize deps `completed`: `finalize.run` invoked; result reflects what it returned.
    - One required finalize dep `failed`: `finalize.run` NOT invoked; `output: null`; the failed stage's `ProcessingFailure` is in `failures`.
    - Optional finalize dep `skipped`: `finalize.run` invoked normally; `ctx.get<T>('that-stage')` returns `undefined`.

10. **`subPipelineStage` smoke test.**
    - One nested pipeline runs inside a larger one; events from the nested pipeline are visible (with prefixed stage ids); the nested result becomes the outer stage's output.

### Commit shape

- Roughly 4–8 commits in logical order.
- Suggested order: (a) types files first (types + barrels, no runtime); (b) mock provider; (c) `executePipeline` minimum viable (input validation + DAG validation + linear execution); (d) concurrency; (e) helper constructors + retry; (f) failure propagation + finalize semantics; (g) events; (h) any remaining tests.
- Each commit should leave `pnpm run check` green.
- Final commit message: `feat(pipelines): land framework primitives + abstract LLM interface (slice 1A)`.

### Exit criteria

- All framework unit tests pass: `pnpm test`.
- `pnpm run typecheck` clean.
- `pnpm run lint` clean.
- `pnpm run build` clean.
- `src/lib/index.ts` exports the new public surface; barrel resolves with no missing imports.
- No `openai` or other third-party SDK imports under `src/lib/`. Grep-proof: `grep -r "from \"openai" src/lib/` returns nothing.
- Smoke: `pnpm cli -- --help` still runs (CLI commands aren't touched by this slice, but the lib changes shouldn't break the CLI build).

### What is NOT in this slice

- Concrete `LlmProvider` implementations (slice 1B).
- Ingestion pipeline implementations (slice 1C).
- Any change to existing `src/lib/parsing/` code (left intact for slice 1C to reuse).
- The `src/cli/llm/openai.ts` move (slice 1B does it).
- Real OpenAI API calls of any kind.

### Notes for the dev agent

- **Use the `superpowers:test-driven-development` skill** — write failing tests first per the test plan, then implementation. The skill is mandatory for this dev role per the team protocol in CLAUDE.md.
- **Use `superpowers:verification-before-completion`** before claiming the slice done. Run `pnpm run check` and verify all four sub-commands pass; cite the exact output.
- **Brain-style TypeScript naming.** The `skill-cefailures:brain-style` skill governs identifier casing in this repo. Apply it.
- **No co-authoring trailers** in commits (per `proposit-core/CLAUDE.md`).
- **If any spec section is ambiguous** between what the agenda says and what the spec at `/Users/brian/Projects/Proposit-App/docs/superpowers/specs/2026-05-22-ingestion-pipeline-overview.md` says, follow this agenda — it's the most-distilled version. If both seem ambiguous, surface as a question via the implementer-prompt template (DONE_WITH_CONCERNS or NEEDS_CONTEXT status) rather than guess.
- **Working branch:** `ingestion-pipeline/phase-1` off `proposit-core/main`. Create the branch as your first action if not already on it. Final merge to `main` happens after slice 1D's release commit.

---

## Slice 1A.1 — Reviewer fold (P2 + selected P3s)

**Triggered by:** dual-review synthesis at `/Users/brian/Projects/Proposit-App/docs/reviews/proposit-core/2026-05-22-89adac1-7e28be0-ingestion-pipeline-1A.md`.
**Branch:** continue on `ingestion-pipeline/phase-1`.

### Scope — fold these items in one commit batch

**P2 #1 — Mid-flight aborted stage surfaces as `failed` with `LLM_NON_RETRYABLE_ERROR`.**

When an `AbortSignal` fires during an in-flight `llmStage` provider call, the stage currently catches the abort, classifies it via the non-retryable branch, and surfaces as `failed` with `LLM_NON_RETRYABLE_ERROR`. This is wrong for two reasons: (a) the spec's cancellation contract (§5.4 step 11) says aborted in-flight stages don't constitute a "failure" — they're scheduled-and-cancelled, more like `skipped`; (b) when slice 1B lands the real OpenAI provider, real cancellation will produce confusing failure codes that the server's task-status logic will likely misroute.

**Fix:**
- In `llmStage`'s catch branch, detect aborted-due-to-signal (`error.name === 'AbortError'` or equivalent; whichever the framework uses to surface signal cancellation) and re-throw a typed `StageAbortedError` (new class).
- In the executor, when a stage throws `StageAbortedError`, mark the stage `skipped` (not `failed`); emit a `stage:end` event with `status: 'skipped'`; do not add a `ProcessingFailure` (the abort is not a failure to report; it's the caller's cancellation taking effect).
- Add a test: in-flight stage + abort fires mid-stage → stage outcome `skipped`, no `ProcessingFailure`, `stage:end.status === 'skipped'`.
- Update the existing cancellation test that only asserts downstream outcome — extend it to also assert the aborted stage's own outcome.

**P3 #1 — Abort fast-path emits `stage:end` without preceding `stage:start`.**

The executor's pre-stage abort check (when a stage is about to start but the signal has already fired) emits `stage:end` directly without `stage:start`. This is inconsistent with every other path (failure, skip-via-required-dep, success) which all emit both.

**Fix:** either (a) emit `stage:start` immediately before the `stage:end` in the abort fast-path, or (b) document that pre-start-aborted stages get no events at all and remove the orphan `stage:end`. Pick (a) for consistency — the SSE bridge in slice 2C will rely on paired start/end events.

**P3 #2 — Optional-dep cycle detection has no test pinning the behavior.**

The dev's implementation correctly rejects cycles even when the cycle edge is via `optional(...)`. The agenda is silent on this, so the dev's choice is defensible. Add one test that pins it: pipeline with stage A depending on `optional("b")` and stage B depending on `"a"` → DAG validation throws with `DAG_CYCLE` at `executePipeline` entry, before any stage runs.

**P3 #3 — `ctx.stageStatus(id)` does not enforce the `dependsOn` allowlist that `ctx.get` enforces.**

For consistency, `ctx.stageStatus(stageId)` should throw with `PipelineConfigurationError` (or the same error class `ctx.get` throws) when called with an `id` not in the calling stage's `dependsOn` (required OR optional). This is the conservative default — if a stage isn't declared as a dep, the calling stage shouldn't be peeking at its status. (The orchestrator's decision: yes, match strictness.)

**Fix:** mirror the `ctx.get` closure check in `ctx.stageStatus`. Add a test that pins the throw.

**P3 #5 — `subPipelineStage` null-output throws `LlmStageRetryExhaustedError` (misnomer).**

When a `subPipelineStage`'s nested pipeline returns `output: null`, the wrapping stage currently throws `LlmStageRetryExhaustedError` — which is semantically wrong (no LLM, no retry). Introduce a new error class `SubPipelineFailedError` and throw that instead. Add a test that pins the new class name in the thrown error's `name` field.

### Items NOT in this fold (deferred or rejected)

- **P3 #4 (UTF-16 vs UTF-8 byte counting in `maxAppendedErrorBytes`):** accept as-is for V1. Add a one-line comment in `stage-helpers.ts` near the truncation site noting that the cap is measured in JavaScript string `.length` (UTF-16 code units), not UTF-8 bytes — so a 2048 cap is roughly 2-4 KB of UTF-8 depending on character distribution. No behavior change.
- **`pipeline:end.status` partial-failure semantics:** non-finding per the synthesis. No action.
- **Briefing markdown prettify (concern #5):** already absorbed in the dev's commit `7e28be0`. The orchestrator accepts the change. No action.

### Test plan additions

- One new test in `test/pipelines.test.ts` for each of P2 #1, P3 #1, P3 #2, P3 #3, P3 #5. Five new tests minimum.

### Exit criteria

- All previous tests still pass.
- Five new tests pass (one per fold item).
- `pnpm run check` green.
- One commit on `ingestion-pipeline/phase-1` with message `fix(pipelines): fold dual-review findings (P2 + P3s) for slice 1A`.

### Carry-forward to slice 1B (and slice 1E in shared)

- Type aliases are exported with `T*` prefix (`TStage`, `TPipeline`, `TStageContext`, `TProcessingFailure`, `TPipelineResult`, `TPipelineEvent`, `TDepSpec`, `TOptionalDep`, `TLlmProvider`, `TLlmRequest`, `TLlmResponse`, `TToolSpec`). Helper values keep their unprefixed names. Downstream slices (1B, 1C) and the shared-repo `processing-failure.ts` re-export module must use these `T*` spellings on imports. The spec text uses unprefixed names for spec-text readability only; the runtime/types are prefixed.
