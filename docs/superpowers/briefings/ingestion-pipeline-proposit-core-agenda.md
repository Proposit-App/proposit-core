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

---

## Slice 1B — OpenAI Responses-API provider (extensions/openai/)

**Branch:** continue on `ingestion-pipeline/phase-1` (do NOT branch from main again; build on top of slice 1A.1).

### Goal

Land `src/extensions/openai/` containing the concrete `TLlmProvider` implementation backed by raw `fetch` to `https://api.openai.com/v1/responses`. Promote the existing `src/cli/llm/openai.ts` body into this extension and switch from `/v1/chat/completions` to the Responses API in the same move. Declare `openai` as an optional `peerDependency` — forward-looking insurance; V1 implementation does not import the SDK.

### Files to create

- `src/extensions/openai/provider.ts` — `createOpenAiResponsesProvider({ apiKey, model?, baseUrl?, fetch? }): TLlmProvider`.
- `src/extensions/openai/structured-output.ts` — inlined TypeBox → OpenAI structured-output JSON Schema converter. Minimum subset: `Type.Object`, `Type.Array`, `Type.String`, `Type.Number`, `Type.Integer`, `Type.Boolean`, `Type.Union(Literal(...))` (discriminated unions over string literals), `Type.Literal`, `Type.Optional`, `Type.Record` (Record<string, T>). Unsupported TypeBox primitives throw at converter-build time with a clear error naming the unsupported primitive.
- `src/extensions/openai/types.ts` — extension-internal types (Responses-API request shape, response shape, tool-call shape) that the provider uses but doesn't re-export.
- `src/extensions/openai/index.ts` — barrel re-exporting `createOpenAiResponsesProvider` + any caller-facing config types.
- `test/extensions/openai/structured-output.test.ts` — converter unit tests. 8-10 small TypeBox shapes → expected OpenAI JSON Schema strings (assert structural equality, not byte-equal). Cover every primitive in the supported subset; assert throws for an unsupported primitive (e.g. `Type.Tuple` or `Type.Date`).
- `test/extensions/openai/provider.test.ts` — provider unit tests with an injected `fetch` mock. Cover:
    - Request body shape: `model`, `input` (Responses API uses `input`, not `messages`), `response_format: { type: "json_schema", json_schema: { name, schema, strict: true } }`, `tools` (translated from `TToolSpec[]`), `max_output_tokens` (only when caller supplied `maxOutputTokens`).
    - Response parsing: `output` extracted from the Responses-API `output` field (text content block → JSON.parse via TypeBox), `tokenUsage` extracted from `usage.input_tokens` / `usage.output_tokens` / `usage.reasoning_tokens`, `rawResponseId` set from `id`.
    - Tool-call agent loop for a `function`-kind tool: model returns tool_call → extension calls the handler → appends tool_result → re-calls. Cap iterations at `maxToolCallRounds: 6` (configurable). Loop exhaustion throws an error that the calling `llmStage` surfaces as `TOOL_LOOP_EXHAUSTED`.
    - Error classification: 5xx + 429 → throw `TransientLlmError`; 400/422 (OpenAI's strict-mode schema validation failures) → throw `SchemaValidationLlmError`; other 4xx → throw `NonRetryableLlmError`. These error classes already exist in `src/lib/llm/types.ts` (from slice 1A) or live in `src/extensions/openai/provider.ts` next to the provider — pick the cleanest location; the framework's retry policy in `llmStage` keys off the error class name regardless.
    - `AbortSignal` propagation: when the caller's signal aborts, the provider's `fetch` receives the signal and surfaces an abort error. Slice 1A.1 already wires this to `StageAbortedError` in the framework; the provider just needs to pass `signal` through.
- `test/extensions/openai/integration.test.ts` (optional, gated): one integration test gated by `INTEGRATION_TEST_OPENAI=1` that hits the real Responses API with a trivial structured-output request. Not run in CI; documented as a manual pre-release gate.

### Files to modify

- `src/cli/llm/index.ts` + `src/cli/llm/openai.ts` — move the existing OpenAI adapter body into `src/extensions/openai/provider.ts`, then either delete `src/cli/llm/openai.ts` entirely or replace with a one-line re-export `export { createOpenAiResponsesProvider } from "../../extensions/openai/index.js"` for a one-release transition. Decide based on what `src/cli/commands/parse.ts` imports — if `parse.ts` is updated in this slice, you can delete; if you want to defer the CLI import update to slice 1C, leave the re-export.
- `src/cli/commands/parse.ts` — update imports to point at `src/extensions/openai/` (or via the lib barrel if that's cleaner). Behavior of the `parse` command is unchanged. The CLI smoke test (`pnpm cli -- parse "test text" --dry-run` with `OPENAI_API_KEY` set) must still work end-to-end; without the key, the existing error path is preserved. **Critical caveat:** today's `parse.ts` calls chat-completions; the Responses API has a different output shape (text content block vs. message content). The slice 1B implementation must produce JSON in the exact shape `parse.ts` parses today, OR `parse.ts`'s downstream parser code must be adapted in the same commit. Verify the CLI smoke still works before committing — this is the most likely place behavior could drift.
- `package.json`:
    - Add `peerDependencies: { "openai": ">=4.0.0" }`.
    - Add `peerDependenciesMeta: { "openai": { "optional": true } }`.
    - Do not add to `dependencies`. The V1 implementation uses raw `fetch`; the SDK is forward-looking only.
- `src/lib/index.ts` — re-export `createOpenAiResponsesProvider` from `src/extensions/openai/index.ts` so server / CLI consumers can import from the package root. Be surgical: only the constructor + caller-facing types.

### Provider implementation notes

- **Base URL.** Default to `https://api.openai.com/v1/responses`. Allow override via `baseUrl` config for local proxies, Azure routing, or future redirects.
- **`fetch` defaults to `globalThis.fetch`.** Caller can inject a polyfill via the `fetch` config option (useful for tests with a `fetchMock`, or for older Node where the global isn't present). Per spec §6.2: Node ≥18 and modern browsers have it natively; mobile (Expo) has it.
- **Structured output.** `response_format: { type: "json_schema", json_schema: { name, schema, strict: true } }`. `name` derives from `outputSchema.$id` if present, otherwise a stable short hash of the schema JSON (e.g. first 12 hex chars of SHA-256). The Responses API requires `strict: true` for proper enforcement; do not omit it.
- **Tool translation.** Translate `TToolSpec[]` directly: `web_search` / `file_search` / `mcp` map to the Responses API's built-in tool shape; `function` tools translate to the function-call schema with the TypeBox `parameters` converted to JSON Schema via the same converter used for the response.
- **Agent loop (for `function` tools).** When the model's response contains tool_calls instead of (or in addition to) the structured output, the provider:
    1. Executes each tool's handler with the model-provided args (validated against the tool's `parameters` schema via `Value.Parse`).
    2. Appends a tool_result message to the input list with the handler's return.
    3. Re-calls the Responses API with the extended input.
    4. Repeats up to `maxToolCallRounds: 6` (config); on exhaustion throws an error the framework's retry policy classifies as non-retryable (`TOOL_LOOP_EXHAUSTED`).
       Built-in tools (`web_search`, `file_search`, `mcp`) execute on OpenAI's infrastructure and don't enter this loop — they appear in the response with their results already incorporated.
- **Error classification.** Surface `TransientLlmError` / `SchemaValidationLlmError` / `NonRetryableLlmError` (introduce these error classes if slice 1A didn't already; place them in `src/lib/llm/types.ts` if framework-wide useful, otherwise in `src/extensions/openai/provider.ts`). The framework's `llmStage` retry policy keys off `instanceof TransientLlmError` and `instanceof SchemaValidationLlmError` for the default `retryOn: ["schema_validation", "transient"]` behavior.
- **Token usage.** Map Responses API `usage` field → `{ input: usage.input_tokens, output: usage.output_tokens, reasoning: usage.reasoning_tokens }`. The framework's `llmStage` invokes the WeakMap side-channel to attach this to the next `stage:end` event.

### Deferred decisions locked in this briefing

- **TypeBox → OpenAI JSON Schema converter is INLINED** (per spec §14 item 2 + the dispatch-prompt decision). `extensions/openai/structured-output.ts` is ~150 lines covering the minimum subset listed above. Do NOT add `typebox-to-openai` as a dep. If a future stage needs a TypeBox primitive not in the supported subset, the converter's `throws` path surfaces a clear error and the stage's per-stage spec must change to use a supported primitive (or the converter must be extended in a separate slice).
- **`fetch` polyfill posture** (per spec §14 item 9): no polyfill ships with `proposit-core`. The provider reads `globalThis.fetch` by default; callers in older runtimes inject. Node ≥18 / Expo / modern browsers all have it.
- **Agent loop max iterations:** 6 (matches typical OpenAI examples). Tunable per call via `maxToolCallRounds` on the `TLlmRequest`.

### Test plan (TDD — author tests before implementation)

Coverage per the agenda + the spec §11.1 framework tests already covering the framework side:

1. **Structured-output converter unit tests.**
    - 8-10 small TypeBox shapes (object, array, string, number, boolean, union of literals, literal, optional, record). For each, the produced JSON Schema validates a TypeBox-valid value (round-trip via `Value.Parse`).
    - Unsupported primitive (e.g. `Type.Tuple([...])`) throws with a clear message naming the primitive.

2. **Provider request shape.**
    - Inject `fetch` mock; assert the URL is the Responses API endpoint; assert `Authorization: Bearer <apiKey>` header; assert body has `model`, `input` (with system + user content blocks per Responses-API shape), `response_format` with `strict: true`, `tools` translated correctly when supplied.
    - When `maxOutputTokens` is supplied, it appears as `max_output_tokens`; when omitted, the field is absent.

3. **Provider response parsing.**
    - Mock response with `output` containing a JSON text block → returns `{ output: parsed, tokenUsage: {...}, rawResponseId: ... }`.
    - Token usage extracted from `usage.input_tokens` / `output_tokens` / `reasoning_tokens`.

4. **Tool-call agent loop.**
    - Mock response with `tool_calls` for a `function` tool → provider invokes handler, appends tool_result, re-calls (assert two `fetch` invocations).
    - Loop exhaustion after 6 rounds → throws (assert the error message / class).
    - Built-in tool (`web_search`) declared → does NOT enter the loop (assert single `fetch` call when model doesn't return tool_calls).

5. **Error classification.**
    - 500 → `TransientLlmError`.
    - 429 → `TransientLlmError`.
    - 400 (invalid schema) → `SchemaValidationLlmError`.
    - 422 (strict-mode violation) → `SchemaValidationLlmError`.
    - 401 → `NonRetryableLlmError`.
    - 403 → `NonRetryableLlmError`.

6. **Abort propagation.**
    - Inject a `fetch` mock that observes `signal`. Call `respond` with a signal; abort the signal before the fetch resolves; assert the fetch sees the abort.

7. **CLI smoke** (manual or scripted, NOT in the test file): `pnpm build && pnpm cli -- parse "<small test text>" --dry-run` runs end-to-end with `OPENAI_API_KEY` set. The dry-run path doesn't actually call the Responses API (it short-circuits before the request); use this to verify the CLI still wires up correctly. For a real-API smoke, run `pnpm cli -- parse "<text>"` once locally (your judgment on which corpus).

### Commit shape

- Suggested order: (1) error classes + interfaces (if introducing new classes); (2) structured-output converter + tests; (3) provider with fetch mock + tests for request/response shapes; (4) tool-call agent loop + tests; (5) error classification + tests; (6) CLI imports updated; (7) package.json peerDep update; (8) one-line re-export or deletion of `src/cli/llm/openai.ts`.
- Each commit `pnpm run check` green.
- Final commit message: `feat(openai): land Responses-API provider in extensions/openai/ (slice 1B)`.

### Exit criteria

- All extension unit tests pass (converter + provider).
- `pnpm test`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run build` green.
- `package.json` carries `peerDependencies.openai` + `peerDependenciesMeta.openai.optional: true`.
- `src/cli/llm/openai.ts` either deleted or reduced to a one-line re-export. The CLI's `parse.ts` imports the provider via the new path (extension barrel or lib barrel).
- CLI smoke: `pnpm cli -- parse "<small text>"` runs end-to-end against a real key (run manually before commit; cite the output in the status return).
- Grep proof: `grep -r "from \"openai" src/` returns nothing (no SDK imports anywhere; raw fetch only).
- Grep proof: no remaining references to `/v1/chat/completions` (we've switched to Responses API).

### What is NOT in this slice

- Ingestion pipelines (slice 1C).
- Any change to `src/lib/parsing/` (left intact for slice 1C).
- A real `openai` SDK import (the peerDep is forward-looking; raw fetch only in V1).
- The Agents SDK (`@openai/agents`) — explicit non-goal per spec §3.
- Changing the framework primitives from slice 1A (don't widen `TLlmProvider`'s interface or change retry semantics — those are framework-side concerns, this slice is provider-side only).

### Notes for the dev agent

- This slice builds on the slice 1A + 1A.1 work in commits `89adac1..edccb33`. Read those commits + the resulting `src/lib/pipelines/` + `src/lib/llm/` code before writing the provider.
- Same skill stack as slice 1A (TDD, verification-before-completion, brain-style TS).
- **Responses-API shape vs chat-completions shape.** The two APIs differ: Responses uses `input` (an array of content blocks) instead of `messages`; the `output` is an array of content blocks instead of `choices[0].message.content`; tool calls and usage have similar but different field names. Read OpenAI's current Responses-API docs before writing the request/response shape — don't extrapolate from the chat-completions code in `src/cli/llm/openai.ts`. The point of this slice is the switch.
- **CLI parity** is the most likely place behavior drifts unexpectedly. Test it. If you're uncertain whether the CLI smoke will still work after the move, surface as DONE_WITH_CONCERNS and let the orchestrator decide.

---

## Slice 1B.1 — Reviewer fold (P1s + P2 polish)

**Triggered by:** dual-review synthesis at `/Users/brian/Projects/Proposit-App/docs/reviews/proposit-core/2026-05-22-6c804b4-f823e16-ingestion-pipeline-1B.md`.
**Branch:** continue on `ingestion-pipeline/phase-1`.

### Scope — fold these items in one commit batch

**P1 #1 — Tool agent loop drops the original `function_call` items from the running input array.**

When the model returns one or more `function_call` items in the response, the provider currently appends only `function_call_output` items to the input array before re-calling. The live Responses API requires the original `function_call` items to be echoed back too (per the conversation history contract), or the next round returns 400 with a conversation-state error.

**Fix in `src/extensions/openai/provider.ts:154-174` (or wherever the agent loop assembles the next-round input):**

- For each `function_call` item the model returned, append it (verbatim) to the running input list _before_ appending its matching `function_call_output`. Preserve the order the model emitted them in.
- Pair `function_call.call_id` ↔ `function_call_output.call_id` correctly; the API enforces this.

**Test in `test/extensions/openai/provider.test.ts`:**

- Extend the existing tool-loop test (around line 393) to assert that the second `fetch` invocation's `input` field contains BOTH the original `function_call` items AND the matching `function_call_output` items, in that order, with paired `call_id`s.
- Add a multi-tool-call test: model returns two `function_call` items in one response → handler executes both → second round's input contains all four items (two `function_call` + two `function_call_output`), order preserved.

**P1 #2 — `Type.Optional` properties produce strict-mode-invalid JSON Schema.**

The converter at `src/extensions/openai/structured-output.ts:173-192` (`convertObject` or equivalent) currently omits `Type.Optional(...)` properties from the `required` array. OpenAI strict mode requires **every declared property in `required`**; the way to express optionality is `{ anyOf: [<schema>, { type: "null" }] }` while keeping the property name in `required`. Today's converter unit test at `test/extensions/openai/structured-output.test.ts:29-46` actually pins the broken behavior — it must be updated to pin the corrected behavior.

**Fix in `structured-output.ts`:**

- When a property is `Type.Optional(T)`, emit it as `{ anyOf: [<T-converted>, { type: "null" }] }` in `properties` AND include its name in `required`.
- Document this in the converter's leading docstring so the next maintainer doesn't reintroduce the bug.

**Tests in `test/extensions/openai/structured-output.test.ts`:**

- **Update** the existing `Type.Optional` test to assert the new correct shape (anyOf-with-null + still in `required`).
- Add a test: `Type.Object({ a: Type.String(), b: Type.Optional(Type.Number()) })` → required `["a", "b"]`, `b.anyOf = [{ type: "number" }, { type: "null" }]`.
- Add an integration-shape test (no real API call needed): an object with a mix of required, Optional, and Nullable (Union with Null) properties produces a strict-mode-valid schema.

**P2 #1 — Split 400 from 422 in `classifyHttpError`.**

Today both 400 and 422 are classified as `SchemaValidationLlmError`. A 400 is more likely a converter bug or malformed request — retrying is wasted work. A 422 (strict-mode violation by the model's output) _can_ sometimes succeed on a re-roll.

**Fix in `src/extensions/openai/provider.ts` (or wherever `classifyHttpError` lives):**

- 400 → `NonRetryableLlmError` (with the OpenAI error body in `message` if extractable).
- 422 → `SchemaValidationLlmError` (with `retryReason: "transient"` per the V1 workaround discussed in 1B; framework refactor to a real `schema_validation` retry tag is deferred).
- Other 4xx (401/403/404) → `NonRetryableLlmError` (unchanged).
- 5xx + 429 → `TransientLlmError` / `RateLimitLlmError` (unchanged).

**Test:** add (or extend) the error-classification test in `provider.test.ts` to pin 400 → `NonRetryableLlmError` separately from 422 → `SchemaValidationLlmError`.

**P2 #2 — Document the simultaneous `function_call` + `message` emission edge case.**

When the model returns both a `function_call` and a final assistant `message` in the same response (rare but possible), the provider currently short-circuits to the next round (treats it as a tool call). This is acceptable behavior but undocumented; the next maintainer reading the agent loop will likely puzzle over it.

**Fix:** add a docstring near the tool-loop dispatch in `provider.ts` explaining the policy: "When a response contains both `function_call` items and a final `message`, the loop treats it as a tool-call round (executes handlers, ignores the message, re-calls). If you wanted the message even when tools fire, you'd need a different exit condition — but the Responses API contract is that the model can't both call tools AND give a final answer in the same turn; this case shouldn't happen in practice, and our policy is conservative."

### Items NOT in this fold (deferred or rejected)

- **P3 (JSON-parse classification):** acceptable for V1 (already in the original DWC); revisit if a real-corpus regression surfaces in slice 1C or later.
- **Framework refactor: `classifyError` getting its own `"schema_validation"` retry tag:** deferred. The current `retryReason: "transient"` workaround on `SchemaValidationLlmError` works — schema-validation 422s retry once per default policy. A proper framework-side refactor is out of scope for this slice; track as an open question (could land alongside slice 1C or be a separate Phase 2 follow-up).

### Test plan additions

Per the fix sections above. Roughly 4 new tests:

- Tool-loop function_call-history assertion (extend existing).
- Tool-loop multi-tool-call test (new).
- Optional → anyOf-with-null + required (replace existing + add complex case).
- 400 vs 422 classification split (extend existing).

### Exit criteria

- All previous tests still pass.
- New tests pass.
- `pnpm run check` green.
- One commit on `ingestion-pipeline/phase-1`: `fix(openai): fold reviewer P1s + P2 polish for slice 1B`.
- Spec §6.2 patch landed by the orchestrator (FYI: `text.format` is the live shape; the orchestrator has already updated the spec).

### Carry-forward to slice 1C

- The v1 single-shot pipeline uses `BasicsParsingSchema` which today uses `Nullable(...)` (Union with Null) — that pattern is strict-mode-clean and unchanged by this fold.
- If any future stage spec (in slice 2A) uses `Type.Optional(...)`, the converter now handles it correctly post-fold.
- The `additionalProperties: true` overridden to `false` by strict-mode behavior is unchanged and still relies on slice 1C's corpus replay to catch any parser-side dependency on extra fields.

---

## Slice 1C — v1-single-shot ingestion pipeline + golden corpus

**Branch:** continue on `ingestion-pipeline/phase-1` (do NOT branch from main; build on top of slice 1B.1 at `e69afed`).

### Goal

Land `src/extensions/argument-ingestion/` with the v1 single-shot pipeline + the shared `finalize-response.ts` / `role-derivation.ts` helpers that v2 will also use. Behavior is **bit-for-bit identical to today's CLI/server path** on a recorded golden corpus. CLI's `parse` command switches to invoking the pipeline factory.

Strict-mode caveat surfaced in slice 1B reviewer: today's `BasicsParsingSchema` uses `Nullable(...)`, not `Type.Optional(...)`, so the converter's strict-mode rewrite (`additionalProperties: false`) doesn't break the schema. But if the live LLM was _historically_ emitting extra fields the parser ignored, strict mode now blocks those. The golden corpus is the gate that catches such drift — record carefully, watch for regressions vs the chat-completions baseline.

### Files to create

- `src/extensions/argument-ingestion/index.ts` — barrel; exports `createIngestionV1Pipeline`, `basicsExtension` (composes `BasicsParsingSchema` + per-entity extension schemas from `src/extensions/basics/`).
- `src/extensions/argument-ingestion/v1-single-shot.ts` — `createIngestionV1Pipeline(extension: TIngestionExtension): TPipeline<...>` factory. One stage: `llmStage` with `gpt-5.4`, outputSchema = `extension.responseSchema`. `finalize.dependsOn: ["parse-argument"]` (required); `finalize.run(ctx)` merges `processingFailures: []`.
- `src/extensions/argument-ingestion/shared/finalize-response.ts` — assembles `TParsedArgumentResponse` from accumulated stage outputs + failures. For v1, just merges the single LLM stage's output with empty `processingFailures`; for v2 this does most of the work.
- `src/extensions/argument-ingestion/shared/role-derivation.ts` — pure function: given relations + selected conclusion miniId, returns per-claim role assignment (`'conclusion' | 'premise' | 'intermediate'`). For v1, trivially returns the LLM's assigned roles unchanged (the LLM produces them); for v2 this is load-bearing.
- `src/extensions/argument-ingestion/shared/types.ts` — `TIngestionExtension` type (`{ responseSchema, claimSchema, variableSchema, premiseSchema, argumentSchema }`); internal stage-output types reused across v1/v2.
- `src/extensions/argument-ingestion/shared/basics-extension.ts` — `basicsExtension: TIngestionExtension` value composed from `src/extensions/basics/`. The default extension passed to `createIngestionV1Pipeline` (and later `createIngestionV2Pipeline`).
- `test/extensions/argument-ingestion/v1-single-shot.test.ts` — pipeline unit tests with mock provider. Asserts stage outputs known shape → finalize produces expected `TParsedArgumentResponse`; single LLM stage's prompt matches `buildParsingPrompt(BasicsParsingSchema)`.
- `test/extensions/argument-ingestion/finalize-response.test.ts` — shared finalize helper unit tests.
- `test/extensions/argument-ingestion/role-derivation.test.ts` — shared role-derivation unit tests (v1 + v2 cases).
- `test/extensions/argument-ingestion/e2e.test.ts` — golden-corpus e2e test driver using `RecordingLlmProvider`.
- `test/extensions/argument-ingestion/recording-provider.ts` — `RecordingLlmProvider` impl (records on `INGESTION_TEST_RECORD=1`, replays in CI). **Includes the prompt-drift guard** per spec §11.3: on replay, recompute the prompt+schema hash from the current `buildPrompt(ctx)` and compare against the recorded hash; fail with `RECORDED_PROMPT_STALE: stage <id> — prompt has changed since recording; re-record with INGESTION_TEST_RECORD=1` on mismatch.
- Golden corpus fixtures:
    - `test/extensions/argument-ingestion/fixtures/straightforward/input.txt`
    - `test/extensions/argument-ingestion/fixtures/straightforward/expected.json` (or `expected-v1.json` if `parity: "v2-strict-upgrade"` later)
    - `test/extensions/argument-ingestion/fixtures/straightforward/recorded-llm.json`
    - Same triplet for `with-url-citation`, `with-axiom`, `ambiguous-conclusion`, `enthymeme`.

### Files to modify

- `src/lib/index.ts` — re-export `createIngestionV1Pipeline` + `basicsExtension` + `TIngestionExtension` type so server + CLI consumers can import from the package root.
- `src/cli/commands/parse.ts` — switch the CLI's `parse` command to call:
    ```ts
    const pipeline = createIngestionV1Pipeline(basicsExtension)
    const result = await executePipeline(pipeline, { text }, { llm: provider })
    if (result.output === null) {
        // surface result.failures + the failureText
    } else {
        const built = parser.build(result.output)
        // ... existing CLI persistence + output path
    }
    ```
    Add a `--pipeline <v1|v2>` flag with default `v1` in Phase 1 (Phase 2 will add `v2`). The flag wires only `v1` for now; passing `v2` errors out cleanly with "v2 pipeline not yet shipped — coming in Phase 2."

### Recording / replay protocol

- `RecordingLlmProvider` constructor: `createRecordingLlmProvider({ fixtureDir: string; mode: "record" | "replay" }): TLlmProvider`. The mode is controlled by `INGESTION_TEST_RECORD=1` env var; when set, mode is `record`, otherwise `replay`.
- **Record mode:** the real OpenAI provider is invoked; each call's `{ systemPrompt, userMessage, outputSchema, ... }` is hashed (SHA-256 over a stable JSON of the request); the request + response are written to `recorded-llm.json` keyed by the hash. Multiple calls in one pipeline run produce a JSON array of records.
- **Replay mode:** each call computes the same hash, looks up the matching record, returns the recorded response. If the hash doesn't match any recorded entry: throw `RECORDED_PROMPT_STALE` with the stage id and a hint to re-record.
- The recorded JSON files are checked into the repo and reviewed in PRs; the CI lane runs replay-only with no `OPENAI_API_KEY` set.

### Golden corpus seeds

Per spec §11.3:

| Fixture                | Input shape                                                            | Expected output                                                                                                                                                                                                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `straightforward`      | 3-claim argument, single conclusion, two normal premises, no citations | Full `TParsedArgumentResponse` with `argument != null`, 3 claims (1 conclusion + 2 premise), 2 premises, no citations                                                                                                                                                                                                              |
| `with-url-citation`    | `"According to <URL>, X. Therefore Y."`                                | Argument with at least one citation-typed claim carrying the URL                                                                                                                                                                                                                                                                   |
| `with-axiom`           | `"By definition, X. So Y."`                                            | Argument with at least one axiomatic-typed claim                                                                                                                                                                                                                                                                                   |
| `ambiguous-conclusion` | Text with multiple plausible conclusions                               | Expected to fail soft: `argument: null`, `failureText: "No single conclusion could be selected."` OR (under v1's force-choice behavior) one specific conclusion the LLM picked — record what v1 actually does and pin it. The fixture will likely be `parity: "v2-strict-upgrade"` in slice 2A; for now just record v1's behavior. |
| `enthymeme`            | Argument with implicit premise                                         | v1 should NOT invent claims — record what it actually does (likely produces only the explicit claims)                                                                                                                                                                                                                              |

### Test plan (TDD)

1. **Pipeline unit tests** (mock-provider-driven):
    - Construct `createIngestionV1Pipeline(basicsExtension)`. Assert the pipeline has one stage (`parse-argument`), correct `dependsOn` (empty), `outputSchema === basicsExtension.responseSchema`.
    - Inject a mock provider that returns a known `TParsedArgumentResponse`-shaped value; assert `executePipeline` returns `{ output: { ...mock.output, processingFailures: [] }, ... }`.
    - Inject a mock provider that returns a schema-invalid output; assert the stage fails with `OUTPUT_SCHEMA_INVALID`; result is `output: null` (because finalize.dependsOn requires this stage).
    - Inject a mock provider that returns `{ argument: null, failureText: "..." }`; assert finalize passes it through with `processingFailures: []`.

2. **`finalize-response` unit tests:** trivial input/output mapping; covers the merge logic.

3. **`role-derivation` unit tests** (will be much richer in slice 2A; for now): given a relations + conclusion-miniId input, returns the right per-claim role map. v1 trivial case: LLM already produced roles; pass them through.

4. **`RecordingLlmProvider` unit tests:**
    - Record mode: real-fetch is replaced with a fake; hashing is deterministic; output file is written in expected shape.
    - Replay mode: hash hit → returns recorded response.
    - Replay mode: hash miss → throws `RECORDED_PROMPT_STALE` with correct stage id + message.

5. **Golden corpus e2e tests:**
    - Record once locally (`INGESTION_TEST_RECORD=1 OPENAI_API_KEY=... pnpm test`).
    - Commit the resulting `recorded-llm.json` + `expected.json` files.
    - CI replay (no API key): all 5 fixtures pass replay; final `TParsedArgumentResponse` matches `expected.json`.
    - Prompt-drift guard: deliberately tamper with `buildPrompt` in a test → recording-provider throws `RECORDED_PROMPT_STALE`.

6. **CLI smoke:** `pnpm cli -- parse "<small text>" --pipeline v1` runs end-to-end with `OPENAI_API_KEY` set. `--pipeline v2` errors out cleanly.

### Recording instructions for the dev

The dev needs to record corpus fixtures against the real OpenAI Responses API. This requires:

- An `OPENAI_API_KEY` set in the local environment (the user has one).
- A small budget — each fixture is one LLM call (v1 is single-shot), so 5 fixtures = 5 calls. Total cost should be cents.
- Recording is one-time; subsequent CI runs use replay only.

The dev should:

1. Implement the pipeline + provider first.
2. Implement the `RecordingLlmProvider` with record + replay modes.
3. Write the fixture input files (`input.txt` for each of the 5 fixtures).
4. Record: `INGESTION_TEST_RECORD=1 OPENAI_API_KEY=$OPENAI_API_KEY pnpm vitest run test/extensions/argument-ingestion/e2e.test.ts`. This populates `recorded-llm.json` + a draft `expected.json` for each fixture.
5. **Review the draft `expected.json` files manually** — they should reflect the actual v1 behavior, including the `ambiguous-conclusion` case where v1 may force a choice and the `enthymeme` case where v1 may or may not invent claims. Don't blindly accept; make sure the recorded output is what you'd want to assert v1 produces.
6. Commit the input, recorded-llm, and expected files together.
7. Run again _without_ `INGESTION_TEST_RECORD` to verify CI-style replay passes.

If any fixture surfaces a strict-mode regression (the model produces a field that strict mode now rejects), that's a load-bearing finding for the spec — surface as a concern.

### Exit criteria

- All pipeline + helper + recording-provider unit tests pass.
- All 5 golden-corpus e2e tests pass under CI replay (no API key needed).
- Prompt-drift guard fails as expected when `buildPrompt` is tampered with.
- CLI `parse --pipeline v1` runs end-to-end against a real key; CLI `parse --pipeline v2` errors out cleanly.
- `pnpm test`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run build` green.
- `pnpm run check` green.
- Bash CLI smoke test (`bash scripts/smoke-test.sh` after `pnpm build`) still passes.
- Reviewer P1 findings folded.

### What is NOT in this slice

- v2-multi-stage pipeline (slice 2A).
- Per-stage prompts for v2 stages (slice 2A).
- v1-v2 parity test (slice 2A — can't exist until v2 does).
- Server-side integration (slice 1G).
- Publishing core 1.1.0 (slice 1D).

### Notes for the dev agent

- This slice builds on slices 1A + 1A.1 + 1B + 1B.1 (commit range `89adac1..e69afed`). Skim the framework + provider before writing.
- The existing `src/lib/parsing/ArgumentParser` is **unchanged** — your pipeline produces a `TParsedArgumentResponse` and the existing `.build()` consumes it to hydrate an `ArgumentEngine`. Don't refactor `ArgumentParser`.
- `basicsExtension` should compose the schemas from `src/extensions/basics/schemata.ts`. Read that file to understand what extension fields look like (claim union `title+body | title+url | axiom+title`, premise `+title`, argument `+title`).
- **Recording is one-time, manual, with a real API key.** Do not commit a fake `recorded-llm.json` that wasn't actually recorded; the prompt-drift guard would mask the regression. Record properly.
- **The strict-mode caveat from slice 1B reviewer is load-bearing here.** If any fixture's recording surfaces a model output that strict mode now rejects (which would manifest as a 422 from OpenAI mid-record), that's the regression slice 1B's reviewer expected this corpus to catch. Surface as DONE_WITH_CONCERNS.
- Same skill stack: TDD, verification-before-completion, brain-style TS, no co-authoring trailers.
