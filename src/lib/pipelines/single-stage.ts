// Single-stage / single-finalize entry points, plus the launch/complete
// split for LLM-background stages.
//
// A durable orchestrator (e.g. a server running each stage in its own
// serverless invocation, persisting typed outputs to a database between
// stages) needs to run ONE stage — or the finalize — given the upstream
// stages' persisted outputs AND outcomes, without re-running the whole
// DAG. `executeStage` and `executeFinalize` are the thin, stateless
// (state in, state out) entry points for that: they reuse the same
// `runOneStage` / `runFinalize` bodies the whole-DAG scheduler
// (`scheduler.ts`) uses.

import { Value } from "typebox/value"
import type {
    TPipeline,
    TPipelineEvent,
    TProcessingFailure,
    TStage,
    TStageStatus,
} from "./types.js"
import { depId } from "./types.js"
import {
    readLlmStageConfig,
    buildLlmRequest,
    applyRetrySuffix,
    validateLlmOutcome,
    failureRetryReason,
} from "./stage-helpers.js"
import type { TRetryReason } from "./stage-helpers.js"
import {
    PipelineConfigurationError,
    makeStageContext,
    runOneStage,
    runFinalize,
    now,
    noopEmit,
    defaultGenerateId,
} from "./scheduler.js"
import type { TStageRunState, TStageRecord } from "./scheduler.js"
import type {
    TLlmProvider,
    TLlmRequest,
    TLlmTokenUsage,
    TResponseStatus,
    TRetrievedResponse,
} from "../llm/types.js"

/**
 * The rehydration unit for one upstream stage. Carries both the outcome
 * AND the output so a single-stage run reproduces the monolithic run's
 * semantics exactly: `ctx.get(stageId)` returns the output only for a
 * `completed` upstream, and `ctx.stageStatus(stageId)` returns the
 * outcome. The serialized form of one stage is `{ outcome, output? }`
 * where `output` is the value the stage's `outputSchema` accepts (JSON
 * round-trippable) and is present iff `outcome === "completed"`.
 */
export type TStageOutcomeRecord = {
    outcome: TStageStatus
    /**
     * The stage's validated output. Present only for
     * `outcome === "completed"` — `executeStage` / `executeFinalize`
     * defensively drop it for `skipped` / `failed` records, so a stale
     * persisted output can never leak into a non-completed dependency.
     */
    output?: unknown
}

/**
 * Dependencies for a single-stage / single-finalize / launch / complete
 * run. A subset of `TExecutePipelineDeps`: no `concurrencyLimit` (one unit
 * runs at a time) and no run-level bookends.
 */
export type TExecuteStageDeps = {
    llm: TLlmProvider
    generateId?: () => string
    signal?: AbortSignal
    onEvent?: (event: TPipelineEvent) => void
    /**
     * Submit-only background-response capability — required by
     * `launchStage`, ignored by `executeStage` / `executeFinalize` /
     * `completeStage`. Referenced by **function type only** so `src/lib/`
     * takes no OpenAI-extension import (the zero-SDK-import boundary
     * holds); the consumer supplies the concrete
     * `extensions/openai`#`submitBackgroundResponse` (apiKey-bound). It
     * submits a background response and resolves with `{ responseId,
     * status }` WITHOUT awaiting completion.
     */
    submitBackgroundResponse?: (
        req: TLlmRequest<unknown>,
        opts: { apiKey: string; baseUrl?: string; signal?: AbortSignal }
    ) => Promise<{ responseId: string; status: TResponseStatus }>
}

/**
 * The result of running one stage via `executeStage` (run-to-completion)
 * or `completeStage` (the completion side of the launch/complete split).
 */
export type TExecuteStageResult = {
    /** The stage's own outcome after this single execution. */
    outcome: TStageStatus
    /** The validated output when `outcome === "completed"`; else undefined. */
    output?: unknown
    /** Any ProcessingFailure(s) the stage produced. */
    failures: TProcessingFailure[]
    /** Per-stage token usage, when the stage made an LLM call. */
    tokenUsage?: TLlmTokenUsage
    /**
     * The retry CLASSIFICATION when a `completeStage` result is `failed`
     * for a RETRYABLE reason — a reason code, not a bare boolean, so a
     * durable orchestrator can apply the same `retryOn` + bounded-attempt
     * decision core would. Absent when `completed`, when the failure is
     * non-retryable / fail-fast (`failed` envelope, `content_filter`), or
     * when the outcome is `skipped` (a cancelled response). **Run-to-
     * completion `executeStage` never sets this** (it owns its own retry
     * loop); only `completeStage` does.
     */
    retryReason?: TRetryReason
}

/**
 * The result of `launchStage`: the submitted background response's id +
 * its submit-time status. The caller persists `responseId` and builds the
 * durable hook token before suspending; `status` may already be terminal
 * on a small/cached submit (the caller then proceeds straight to
 * `completeStage` via `retrieveResponse`).
 */
export type TLaunchStageResult = {
    responseId: string
    status: TResponseStatus
}

/** The result of running the finalize via `executeFinalize`. */
export type TExecuteFinalizeResult<TOutput> = {
    /**
     * The pipeline output finalize produced; `null` when a required
     * finalize dep was not `completed` (the same gate `executePipeline`
     * applies) or when finalize itself threw (a `FINALIZE_UNCAUGHT_ERROR`
     * failure).
     */
    output: TOutput | null
    failures: TProcessingFailure[]
}

// Seed a fresh `records` map from the caller-supplied `upstream`,
// keeping only the entries the consumer (a stage or finalize) actually
// depends on, and dropping `output` for any non-`completed` record so a
// caller bug can't leak a stale output into a skipped/failed dependency.
function seedRecordsFromUpstream(
    upstream: Readonly<Record<string, TStageOutcomeRecord>>,
    depIds: Set<string>
): Map<string, TStageRecord> {
    const records = new Map<string, TStageRecord>()
    for (const id of depIds) {
        const supplied = upstream[id]
        if (!supplied) continue
        if (supplied.outcome === "completed") {
            records.set(id, {
                outcome: "completed",
                output: supplied.output,
            })
        } else {
            records.set(id, {
                outcome: supplied.outcome,
                output: undefined,
            })
        }
    }
    return records
}

// Shared run-state builder for the single-shot entry points. The
// `setConfigError` disposition differs from the whole-DAG scheduler's:
// a `ctx.get`-on-non-dep error throws straight out of the entry point
// (there are no run-level bookends to emit first), so it is surfaced
// directly to the caller as the caller bug it is.
function buildSingleShotState(
    upstream: Readonly<Record<string, TStageOutcomeRecord>>,
    depIds: Set<string>,
    input: unknown,
    deps: TExecuteStageDeps
): TStageRunState {
    return {
        records: seedRecordsFromUpstream(upstream, depIds),
        failures: [],
        signal: deps.signal ?? new AbortController().signal,
        emit: deps.onEvent ?? noopEmit,
        generateId: deps.generateId ?? defaultGenerateId,
        llm: deps.llm,
        input,
        setConfigError: (error) => {
            throw error
        },
    }
}

/**
 * Run a single stage of `pipeline` against the caller-supplied upstream
 * records, without re-running the whole DAG. The upstream map carries
 * each dependency's `{ outcome, output? }` so `ctx.get` / `ctx.stageStatus`
 * reproduce monolithic-run semantics exactly. `input` is validated +
 * transformed via `Value.Parse(pipeline.inputSchema, input)` (a schema
 * mismatch throws, same as `executePipeline`) and the PARSED value seeds
 * `ctx.input`.
 *
 * Emits the per-stage events only (`stage:start`, `stage:llm-request`,
 * `stage:llm-response-created`, `stage:llm-call`, `stage:retry`,
 * `stage:end`) — no `pipeline:*` bookends. Throws `PipelineConfigurationError`
 * (`UNKNOWN_STAGE`) when `stageId` is not in `pipeline.stages`, and throws a
 * `PipelineConfigurationError` (`GET_OUTSIDE_DEPS` / `STATUS_OUTSIDE_DEPS`)
 * out directly when the stage reads a non-dependency — both are caller
 * bugs, surfaced rather than swallowed into the result.
 *
 * The caller may pass a superset of `upstream` records; `executeStage`
 * uses the stage's own `dependsOn` to pick the relevant ones. It does NOT
 * decide whether the stage SHOULD run given its upstream outcomes — a
 * required-failed upstream just means `ctx.get` returns `undefined`; the
 * skip decision belongs to the caller's scheduler.
 */
export async function executeStage(
    pipeline: TPipeline<unknown, unknown>,
    stageId: string,
    upstream: Readonly<Record<string, TStageOutcomeRecord>>,
    input: unknown,
    deps: TExecuteStageDeps
): Promise<TExecuteStageResult> {
    const stage = pipeline.stages.find((s) => s.id === stageId)
    if (!stage) {
        throw new PipelineConfigurationError({
            code: "UNKNOWN_STAGE",
            message: `Pipeline "${pipeline.id}" has no stage "${stageId}".`,
            stageId,
        })
    }

    // Input-validation parity with `executePipeline`: parse + seed the
    // PARSED (Default/Convert/Clean-transformed) value into ctx.input.
    const parsedInput = Value.Parse(pipeline.inputSchema, input)

    const depIds = new Set(stage.dependsOn.map((d) => depId(d)))
    const state = buildSingleShotState(upstream, depIds, parsedInput, deps)
    const ctx = makeStageContext(state, depIds, stage.id)

    await runOneStage(stage, ctx, state)

    const record = state.records.get(stage.id)
    const outcome: TStageStatus = record?.outcome ?? "skipped"
    const result: TExecuteStageResult = {
        outcome,
        failures: state.failures,
    }
    if (outcome === "completed") {
        result.output = record?.output
        if (record?.tokenUsage !== undefined) {
            result.tokenUsage = record.tokenUsage
        }
    }
    return result
}

/**
 * Run `pipeline.finalize` against the caller-supplied upstream records,
 * without re-running the whole DAG. Symmetric with `executeStage`:
 * `input` is parsed via `Value.Parse(pipeline.inputSchema, input)` and the
 * PARSED value seeds the finalize `ctx.input`; the finalize `ctx` is built
 * with `pipeline.finalize.dependsOn` as its allowed-dep set; the
 * required-finalize-dep gate (`output` stays `null` if any required dep is
 * not `completed`) and the `FINALIZE_UNCAUGHT_ERROR` capture match
 * `executePipeline`.
 *
 * Emits NO events (finalize is not a stage — it has no `stage:*`
 * lifecycle — and there are no `pipeline:*` bookends). `async` purely for
 * signature symmetry with `executeStage`; `TPipelineFinalize.run` stays
 * synchronous and the `async` wrapper just resolves its result.
 */
// `async` is deliberate (a Promise-returning signature symmetric with
// `executeStage`, so callers `await` both uniformly) even though the
// synchronous finalize body has nothing to await — the eslint
// require-await rule does not apply here.
// eslint-disable-next-line @typescript-eslint/require-await
export async function executeFinalize<TOutput>(
    pipeline: TPipeline<unknown, TOutput>,
    upstream: Readonly<Record<string, TStageOutcomeRecord>>,
    input: unknown,
    deps: TExecuteStageDeps
): Promise<TExecuteFinalizeResult<TOutput>> {
    // Input-validation parity with `executePipeline` (see `executeStage`).
    const parsedInput = Value.Parse(pipeline.inputSchema, input)

    const depIds = new Set(pipeline.finalize.dependsOn.map((d) => depId(d)))
    // Finalize emits no events, so swallow any caller-supplied onEvent.
    const state = buildSingleShotState(upstream, depIds, parsedInput, {
        ...deps,
        onEvent: undefined,
    })
    const ctx = makeStageContext(state, depIds, "finalize")

    const output = runFinalize(pipeline, ctx, state)
    return { output, failures: state.failures }
}

// -- Launch / complete split for LLM-background stages -------------------
//
// A durable orchestrator (e.g. a server workflow) cannot block a single
// step for an LLM call's full duration. `launchStage` submits the
// background response and returns its `responseId` WITHOUT awaiting;
// `completeStage` — in a later invocation, after the response completed —
// validates the retrieved response into a `TExecuteStageResult`. Both
// reuse the package-internal `llmStage` seam (`buildLlmRequest` /
// `validateLlmOutcome`) so prompt assembly + output validation have a
// single implementation shared with the in-process `llmStage` loop.

// Resolve the LLM config carried by an `llmStage`-built stage, or throw a
// clear error when the looked-up stage is not an LLM stage (no carrier).
function requireLlmStage(
    pipeline: TPipeline<unknown, unknown>,
    stageId: string,
    fnName: string
): {
    stage: TStage<unknown>
    cfg: NonNullable<ReturnType<typeof readLlmStageConfig<unknown>>>
} {
    const stage = pipeline.stages.find((s) => s.id === stageId)
    if (!stage) {
        throw new PipelineConfigurationError({
            code: "UNKNOWN_STAGE",
            message: `Pipeline "${pipeline.id}" has no stage "${stageId}".`,
            stageId,
        })
    }
    const cfg = readLlmStageConfig(stage)
    if (!cfg) {
        throw new PipelineConfigurationError({
            code: "UNKNOWN_STAGE",
            message: `${fnName} requires an LLM stage, but stage "${stageId}" in pipeline "${pipeline.id}" is not one (it carries no LLM config). Run deterministic stages via executeStage.`,
            stageId,
        })
    }
    return { stage, cfg }
}

/**
 * Launch an LLM-background stage: rehydrate `ctx` from `upstream` +
 * parsed input, build the request via the shared seam, submit it via the
 * injected `deps.submitBackgroundResponse`, and return
 * `{ responseId, status }` WITHOUT awaiting completion.
 *
 * Emits `stage:start`, `stage:llm-request`, and `stage:llm-response-created`
 * (from the submit's returned id) — but NO `stage:llm-call` / `stage:end`
 * (the completion side emits those, in a later invocation). The
 * per-stage event pair therefore spans two invocations; an `onEvent`
 * consumer must NOT assume a balanced start↔end per call.
 *
 * `deps.submitBackgroundResponse` is REQUIRED; `launchStage` throws if it
 * is absent. `stageId` must name an LLM stage (built by `llmStage`);
 * a non-LLM stage throws. `attempt` (default 1) lets a re-launch rebuild
 * the retry-suffixed user message for attempt 2+.
 */
export async function launchStage(
    pipeline: TPipeline<unknown, unknown>,
    stageId: string,
    upstream: Readonly<Record<string, TStageOutcomeRecord>>,
    input: unknown,
    deps: TExecuteStageDeps,
    attempt = 1
): Promise<TLaunchStageResult> {
    const submit = deps.submitBackgroundResponse
    if (!submit) {
        throw new PipelineConfigurationError({
            code: "UNKNOWN_STAGE",
            message: `launchStage requires deps.submitBackgroundResponse (the submit-only background-response capability), but it was not supplied.`,
            stageId,
        })
    }
    const { stage, cfg } = requireLlmStage(pipeline, stageId, "launchStage")

    // Input-validation parity: parse + seed the parsed ctx.input. The
    // stage's `ctx` reads its own dependsOn as allowed deps.
    const parsedInput = Value.Parse(pipeline.inputSchema, input)
    const allowedDeps = new Set(stage.dependsOn.map((d) => depId(d)))
    const state = buildSingleShotState(upstream, allowedDeps, parsedInput, deps)
    const ctx = makeStageContext(state, allowedDeps, stageId)

    // Compute the per-attempt user message. Attempt 1 is the prompt's
    // user message; attempt 2+ appends the same retry-suffix the
    // in-process loop adds after a schema-validation failure (the shared
    // `applyRetrySuffix` helper). The exact prior-attempt validation
    // error does not cross the durable suspend, so the re-launch suffix
    // carries a generic prior-error note — the wrapper text matches the
    // in-process loop's phrasing.
    const baseUser = cfg.buildPrompt(ctx).user
    const userMessage =
        attempt > 1
            ? applyRetrySuffix(
                  baseUser,
                  "the previous attempt's output did not conform to the schema",
                  cfg.retryPolicy.maxAppendedErrorBytes ?? 2048
              )
            : baseUser

    const { req } = buildLlmRequest(cfg, ctx, userMessage)

    state.emit({ kind: "stage:start", stageId, at: now() })
    state.emit({
        kind: "stage:llm-request",
        stageId,
        attempt,
        prompts: { system: req.systemPrompt, user: req.userMessage },
        at: now(),
    })

    // The req is already TLlmRequest<unknown> (the recovered config is
    // generic-erased at the lookup boundary); the typed output is
    // recovered in completeStage via the stage's outputSchema.
    const submitResult = await submit(req, {
        apiKey: resolveApiKey(deps),
        signal: deps.signal,
    })

    state.emit({
        kind: "stage:llm-response-created",
        stageId,
        attempt,
        responseId: submitResult.responseId,
        at: now(),
    })

    return submitResult
}

/**
 * Complete an LLM-background stage from its retrieved response. Recovers
 * the stage's LLM config, parses the RAW assistant text in
 * `retrieved.output` against the stage's schema (via the shared seam),
 * classifies a non-`completed` status per the launch/complete table, and
 * returns the standard `TExecuteStageResult`.
 *
 * Emits `stage:llm-call` + `stage:end` (NO `stage:start` — that fired in
 * the launch invocation). `tokenUsage` is taken directly from
 * `retrieved.tokenUsage` (the per-`ctx` WeakMap cannot bridge the two
 * invocations). On a RETRYABLE failure the result carries `retryReason`
 * (the reason code); a fail-fast failure (`failed` envelope,
 * `content_filter`) carries none; a `cancelled` response settles as
 * `outcome: "skipped"` with no `ProcessingFailure`.
 *
 * `stageId` must name an LLM stage; a non-LLM stage throws.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function completeStage(
    pipeline: TPipeline<unknown, unknown>,
    stageId: string,
    retrieved: TRetrievedResponse,
    deps: TExecuteStageDeps,
    attempt = 1
): Promise<TExecuteStageResult> {
    const { cfg } = requireLlmStage(pipeline, stageId, "completeStage")
    const emit = deps.onEvent ?? noopEmit

    const validated = validateLlmOutcome(
        cfg,
        retrieved.output,
        retrieved.status,
        retrieved.incompleteReason
    )

    // The output shown on stage:llm-call is the parsed value when the
    // response parsed + validated; otherwise the raw assistant text (so a
    // consumer's bridge can persist whatever the model returned).
    const callOutput =
        validated.output !== undefined ? validated.output : retrieved.output

    emit({
        kind: "stage:llm-call",
        stageId,
        attempt,
        prompts: { system: "", user: "" },
        output: callOutput,
        tokenUsage: retrieved.tokenUsage ?? { input: 0, output: 0 },
        rawResponseId: retrieved.rawResponseId,
        validationError: validated.validationError,
        at: now(),
    })

    const failures: TProcessingFailure[] = []
    let retryReason: TRetryReason | undefined
    if (validated.outcome === "failed" && validated.failure) {
        // A cancelled response settled as `skipped` above (no failure);
        // only genuine failures push a ProcessingFailure.
        failures.push({
            stage: stageId,
            code: validated.failure.code,
            message: validated.failure.message,
            severity: "error",
        })
        retryReason = failureRetryReason(validated.failure)
    }

    const stageEndEvent: TPipelineEvent =
        retrieved.tokenUsage !== undefined
            ? {
                  kind: "stage:end",
                  stageId,
                  status: validated.outcome,
                  tokenUsage: retrieved.tokenUsage,
                  at: now(),
              }
            : {
                  kind: "stage:end",
                  stageId,
                  status: validated.outcome,
                  at: now(),
              }
    emit(stageEndEvent)

    const result: TExecuteStageResult = {
        outcome: validated.outcome,
        failures,
    }
    if (validated.outcome === "completed") {
        result.output = validated.output
    }
    if (retrieved.tokenUsage !== undefined) {
        result.tokenUsage = retrieved.tokenUsage
    }
    if (retryReason !== undefined) {
        result.retryReason = retryReason
    }
    return result
}

// API-key resolution for the submit dep. The injected
// `submitBackgroundResponse` is apiKey-bound by the consumer, so core
// passes an empty key — the bound capability ignores it. (Kept as a seam
// in case a future dep shape threads the key through deps.)
function resolveApiKey(_deps: TExecuteStageDeps): string {
    return ""
}
