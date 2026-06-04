// The pipeline scheduler.
//
// Validates input + DAG up front, then runs eligible stages
// concurrently (bounded by `concurrencyLimit`). Failure propagation
// is required-vs-optional aware: a failed stage marks downstream
// stages with required deps on it as `skipped`; optional dependents
// run with `ctx.get` returning `undefined`.
//
// Schema-validation failures on a stage's `outputSchema` and
// retry-exhaustion thrown from `llmStage` turn into
// `ProcessingFailure { severity: "error" }`. Throws that escape are
// reserved for executor-build errors: DAG misconfiguration, input-
// schema rejection, and abort (we surface those by returning early
// with `output: null` for abort; we throw for misconfiguration).

import { Value } from "typebox/value"
import type {
    TDepSpec,
    TPipeline,
    TPipelineEvent,
    TPipelineResult,
    TProcessingFailure,
    TStage,
    TStageContext,
    TStageStatus,
} from "./types.js"
import { depId, isOptionalDep } from "./types.js"
import {
    LlmStageRetryExhaustedError,
    StageAbortedError,
    SubPipelineFailedError,
    readStashedTokenUsage,
    readLlmStageConfig,
    buildLlmRequest,
    applyRetrySuffix,
    validateLlmOutcome,
    failureRetryReason,
} from "./stage-helpers.js"
import type { TRetryReason } from "./stage-helpers.js"
import {
    debugPipelineEnd,
    debugPipelineStart,
    debugStageEnd,
    debugStageStart,
} from "./debug-log.js"
import type {
    TLlmProvider,
    TLlmRequest,
    TLlmTokenUsage,
    TResponseStatus,
    TRetrievedResponse,
} from "../llm/types.js"

export type TExecutePipelineDeps = {
    llm: TLlmProvider
    generateId?: () => string
    signal?: AbortSignal
    onEvent?: (event: TPipelineEvent) => void
    /** Default 4. */
    concurrencyLimit?: number
}

export class PipelineConfigurationError extends Error {
    public readonly code:
        | "DAG_CYCLE"
        | "SELF_DEP"
        | "UNKNOWN_DEP"
        | "UNKNOWN_STAGE"
        | "DUPLICATE_STAGE_ID"
        | "GET_OUTSIDE_DEPS"
        | "STATUS_OUTSIDE_DEPS"
    public readonly stageId?: string
    public readonly depId?: string

    constructor(args: {
        code: PipelineConfigurationError["code"]
        message: string
        stageId?: string
        depId?: string
    }) {
        super(args.message)
        this.name = "PipelineConfigurationError"
        this.code = args.code
        this.stageId = args.stageId
        this.depId = args.depId
    }
}

function now(): number {
    return typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now()
}

function defaultGenerateId(): string {
    return globalThis.crypto.randomUUID()
}

function noopEmit(_event: TPipelineEvent): void {
    // intentional no-op
}

function validateDag(pipeline: TPipeline<unknown, unknown>): {
    stageById: Map<string, TStage<unknown>>
} {
    const stageById = new Map<string, TStage<unknown>>()
    for (const stage of pipeline.stages) {
        if (stageById.has(stage.id)) {
            throw new PipelineConfigurationError({
                code: "DUPLICATE_STAGE_ID",
                message: `Duplicate stage id "${stage.id}" in pipeline ${pipeline.id}.`,
                stageId: stage.id,
            })
        }
        stageById.set(stage.id, stage)
    }

    const checkRef = (
        stageId: string,
        deps: readonly TDepSpec[],
        kind: "stage" | "finalize"
    ): void => {
        for (const dep of deps) {
            const id = depId(dep)
            if (kind === "stage" && id === stageId) {
                throw new PipelineConfigurationError({
                    code: "SELF_DEP",
                    message: `Stage "${stageId}" cannot depend on itself.`,
                    stageId,
                    depId: id,
                })
            }
            if (!stageById.has(id)) {
                throw new PipelineConfigurationError({
                    code: "UNKNOWN_DEP",
                    message: `${
                        kind === "stage"
                            ? `Stage "${stageId}"`
                            : `Finalize step in pipeline "${pipeline.id}"`
                    } depends on unknown stage "${id}".`,
                    stageId: kind === "stage" ? stageId : undefined,
                    depId: id,
                })
            }
        }
    }

    for (const stage of pipeline.stages) {
        checkRef(stage.id, stage.dependsOn, "stage")
    }
    checkRef(pipeline.id, pipeline.finalize.dependsOn, "finalize")

    // Cycle detection via DFS over required+optional deps. Optional
    // deps are part of the graph for cycle purposes (the stage still
    // schedules after them when they aren't skipped/failed).
    type TVisitState = "unvisited" | "visiting" | "visited"
    const visit = new Map<string, TVisitState>()
    for (const stage of pipeline.stages) {
        visit.set(stage.id, "unvisited")
    }
    const stack: string[] = []

    const dfs = (stageId: string): void => {
        const state = visit.get(stageId)
        if (state === "visiting") {
            const cycleStart = stack.indexOf(stageId)
            const cycle = stack.slice(cycleStart).concat(stageId).join(" → ")
            throw new PipelineConfigurationError({
                code: "DAG_CYCLE",
                message: `Cycle detected in pipeline "${pipeline.id}": ${cycle}.`,
                stageId,
            })
        }
        if (state === "visited") {
            return
        }
        visit.set(stageId, "visiting")
        stack.push(stageId)
        const stage = stageById.get(stageId)
        if (stage) {
            for (const dep of stage.dependsOn) {
                dfs(depId(dep))
            }
        }
        stack.pop()
        visit.set(stageId, "visited")
    }

    for (const stage of pipeline.stages) {
        dfs(stage.id)
    }

    return { stageById }
}

type TStageRecord = {
    outcome: TStageStatus
    output: unknown
    tokenUsage?: TLlmTokenUsage
}

// -- Shared per-stage / finalize run state -------------------------------
//
// Both the whole-DAG scheduler (`executePipeline`) and the single-stage /
// single-finalize entry points (`executeStage` / `executeFinalize`)
// execute the very same per-stage and finalize bodies. To keep one
// source of truth without relying on a closure over `executePipeline`'s
// locals, the bodies are extracted into module-level `runOneStage` /
// `runFinalize` that take this state explicitly. The scheduler and the
// single-shot functions each construct a `TStageRunState` and pass it in.

type TStageRunState = {
    /** The inter-stage record store `ctx.get` / `ctx.stageStatus` read. */
    records: Map<string, TStageRecord>
    /** Aggregated structured failures the run produces. */
    failures: TProcessingFailure[]
    /** Cancellation signal threaded into each stage's `ctx.signal`. */
    signal: AbortSignal
    /** Observability hook for `TPipelineEvent`s. */
    emit: (event: TPipelineEvent) => void
    /** ID generator threaded into each stage's `ctx.generateId`. */
    generateId: () => string
    /** The provider every `llmStage` calls. */
    llm: TLlmProvider
    /**
     * The parsed (Default/Convert/Clean-transformed) pipeline input that
     * seeds every stage's `ctx.input`.
     */
    input: unknown
    /**
     * Disposition seam for a `PipelineConfigurationError` raised by
     * `ctx.get` / `ctx.stageStatus` on a non-dependency stage id (a
     * caller bug). The whole-DAG scheduler captures the first one and
     * re-throws it after emitting the bookend events; the single-stage
     * path supplies a callback that throws immediately (it has no
     * bookends to emit). One extracted body, two dispositions.
     */
    setConfigError: (error: PipelineConfigurationError) => void
}

// Build the per-stage / finalize `ctx`. `allowedDeps` is the set of
// stage ids this context may read (the stage's or finalize's own
// `dependsOn`); `ctx.get` returns the output only for a `completed`
// upstream, exactly as the monolithic run does.
function makeStageContext(
    state: TStageRunState,
    allowedDeps: Set<string>,
    contextLabel: string
): TStageContext {
    return {
        input: state.input,
        get<T>(stageId: string): T | undefined {
            if (!allowedDeps.has(stageId)) {
                throw new PipelineConfigurationError({
                    code: "GET_OUTSIDE_DEPS",
                    message: `${contextLabel} called ctx.get("${stageId}"), which is not in its dependsOn.`,
                    stageId: contextLabel,
                    depId: stageId,
                })
            }
            const record = state.records.get(stageId)
            if (!record) return undefined
            if (record.outcome !== "completed") return undefined
            return record.output as T
        },
        stageStatus(stageId: string): TStageStatus {
            // Mirror the `ctx.get` strictness: stages may only
            // query the status of stages declared in their own
            // `dependsOn` (required OR optional). Querying a
            // non-dependency is a caller bug — surface it loudly
            // rather than silently returning "skipped" for a
            // stage id the calling stage shouldn't be peeking at.
            if (!allowedDeps.has(stageId)) {
                throw new PipelineConfigurationError({
                    code: "STATUS_OUTSIDE_DEPS",
                    message: `${contextLabel} called ctx.stageStatus("${stageId}"), which is not in its dependsOn.`,
                    stageId: contextLabel,
                    depId: stageId,
                })
            }
            const record = state.records.get(stageId)
            if (record) return record.outcome
            return "skipped"
        },
        llm: state.llm,
        generateId: state.generateId,
        signal: state.signal,
        emit: state.emit,
        addFailure: (failure) => {
            state.failures.push({ ...failure, stage: contextLabel })
        },
    }
}

// Execute exactly one stage against the supplied `ctx` + `state`. Records
// the stage's outcome into `state.records`, pushes any failure into
// `state.failures`, emits the `stage:start` / `stage:end` bookends, and
// routes a `ctx.get`-on-non-dep `PipelineConfigurationError` through
// `state.setConfigError`. The single source of truth for per-stage
// execution semantics, shared by the scheduler and `executeStage`.
async function runOneStage(
    stage: TStage<unknown>,
    ctx: TStageContext,
    state: TStageRunState
): Promise<void> {
    const stageDeps = stage.dependsOn.map((d) => depId(d))
    const stageStartAt = now()
    const finishStage = (args: {
        status: TStageStatus
        tokenUsage?: TLlmTokenUsage
        outputPresent: boolean
    }): void => {
        const endAt = now()
        const event: TPipelineEvent =
            args.tokenUsage !== undefined
                ? {
                      kind: "stage:end",
                      stageId: stage.id,
                      status: args.status,
                      tokenUsage: args.tokenUsage,
                      at: endAt,
                  }
                : {
                      kind: "stage:end",
                      stageId: stage.id,
                      status: args.status,
                      at: endAt,
                  }
        state.emit(event)
        debugStageEnd({
            stageId: stage.id,
            status: args.status,
            durationMs: endAt - stageStartAt,
            outputPresence: args.outputPresent
                ? "present"
                : "null-or-undefined",
            tokenUsage: args.tokenUsage,
        })
    }

    if (state.signal.aborted) {
        // Pending stages don't start once aborted. Emit `stage:start`
        // before `stage:end` so consumers walking the event stream
        // for symmetric pairs (e.g. a server SSE bridge) see
        // a balanced sequence — every `stage:end` is preceded by a
        // matching `stage:start`.
        state.emit({ kind: "stage:start", stageId: stage.id, at: stageStartAt })
        debugStageStart({ stageId: stage.id, deps: stageDeps })
        state.records.set(stage.id, { outcome: "skipped", output: undefined })
        finishStage({ status: "skipped", outputPresent: false })
        return
    }
    state.emit({ kind: "stage:start", stageId: stage.id, at: stageStartAt })
    debugStageStart({ stageId: stage.id, deps: stageDeps })
    try {
        const output = await stage.run(ctx)
        if (!Value.Check(stage.outputSchema, output)) {
            const errors = [...Value.Errors(stage.outputSchema, output)]
            const message = errors
                .map((e) => `${e.instancePath}: ${e.message}`)
                .join("; ")
            state.failures.push({
                stage: stage.id,
                code: "OUTPUT_SCHEMA_INVALID",
                message,
                severity: "error",
            })
            state.records.set(stage.id, {
                outcome: "failed",
                output: undefined,
            })
            finishStage({ status: "failed", outputPresent: false })
            return
        }
        const tokenUsage = readStashedTokenUsage(ctx, stage.id)
        state.records.set(stage.id, {
            outcome: "completed",
            output,
            tokenUsage,
        })
        finishStage({
            status: "completed",
            tokenUsage,
            outputPresent: output !== null && output !== undefined,
        })
    } catch (err) {
        if (err instanceof PipelineConfigurationError) {
            // ctx.get violation — caller bug. Route through the
            // disposition seam, mark the stage failed for bookkeeping,
            // and emit stage:end so consumers see a clean per-stage close.
            state.records.set(stage.id, {
                outcome: "failed",
                output: undefined,
            })
            finishStage({ status: "failed", outputPresent: false })
            state.setConfigError(err)
            return
        }
        if (err instanceof StageAbortedError) {
            // Caller cancellation surfaced mid-stage. This is not
            // a stage failure to report — no ProcessingFailure is
            // recorded — and the outcome is `skipped` rather than
            // `failed` so consumers can distinguish abort from a
            // genuine provider error.
            state.records.set(stage.id, {
                outcome: "skipped",
                output: undefined,
            })
            finishStage({ status: "skipped", outputPresent: false })
            return
        }
        if (err instanceof LlmStageRetryExhaustedError) {
            state.failures.push({
                stage: stage.id,
                code: err.code,
                message: err.message,
                severity: "error",
                context: err.failureContext,
            })
            state.records.set(stage.id, {
                outcome: "failed",
                output: undefined,
            })
            finishStage({ status: "failed", outputPresent: false })
            return
        }
        if (err instanceof SubPipelineFailedError) {
            state.failures.push({
                stage: stage.id,
                code: err.code,
                message: err.message,
                severity: "error",
                context: err.failureContext,
            })
            state.records.set(stage.id, {
                outcome: "failed",
                output: undefined,
            })
            finishStage({ status: "failed", outputPresent: false })
            return
        }
        const message = err instanceof Error ? err.message : String(err)
        state.failures.push({
            stage: stage.id,
            code: "STAGE_UNCAUGHT_ERROR",
            message,
            severity: "error",
        })
        state.records.set(stage.id, { outcome: "failed", output: undefined })
        finishStage({ status: "failed", outputPresent: false })
    }
}

// Run the pipeline's finalize against the supplied `ctx` + `state`.
// Applies the `finalizeRequiredOk()` gate (output stays `null` when a
// required finalize dep is not `completed`) and captures a thrown
// finalize as a `FINALIZE_UNCAUGHT_ERROR` failure. The single source of
// truth for finalize semantics, shared by the scheduler and
// `executeFinalize`. Returns the finalize output, or `null` when the
// gate blocks it / the run is aborted / finalize threw.
function runFinalize<TOutput>(
    pipeline: TPipeline<unknown, TOutput>,
    ctx: TStageContext,
    state: TStageRunState
): TOutput | null {
    const finalizeRequiredOk = (): boolean => {
        for (const dep of pipeline.finalize.dependsOn) {
            if (isOptionalDep(dep)) continue
            const record = state.records.get(depId(dep))
            if (record?.outcome !== "completed") return false
        }
        return true
    }

    if (!finalizeRequiredOk() || state.signal.aborted) {
        return null
    }
    try {
        return pipeline.finalize.run(ctx)
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        state.failures.push({
            stage: "finalize",
            code: "FINALIZE_UNCAUGHT_ERROR",
            message,
            severity: "error",
        })
        return null
    }
}

export async function executePipeline<TInput, TOutput>(
    pipeline: TPipeline<TInput, TOutput>,
    input: TInput,
    deps: TExecutePipelineDeps
): Promise<TPipelineResult<TOutput>> {
    // 1. Input validation. A schema mismatch is a caller bug; we throw.
    // Value.Parse infers its return type from the schema; since
    // pipeline.inputSchema is typed as TSchema, that inference comes
    // out broad — we re-narrow to TInput, which is the caller's
    // declared input type for the pipeline.
    const parsedInput = Value.Parse(pipeline.inputSchema, input)
    const validatedInput = parsedInput as TInput

    // 2. DAG validation. All before any stage runs.
    const { stageById } = validateDag(
        pipeline as unknown as TPipeline<unknown, unknown>
    )

    const emit = deps.onEvent ?? noopEmit
    const signal = deps.signal ?? new AbortController().signal
    const generateId = deps.generateId ?? defaultGenerateId
    const concurrencyLimit = deps.concurrencyLimit ?? 4

    const startAt = now()
    emit({
        kind: "pipeline:start",
        pipelineId: pipeline.id,
        pipelineVersion: pipeline.version,
        at: startAt,
    })
    debugPipelineStart({
        pipelineId: pipeline.id,
        pipelineVersion: pipeline.version,
        stageCount: pipeline.stages.length,
        rootStages: pipeline.stages
            .filter((s) => s.dependsOn.length === 0)
            .map((s) => s.id),
    })

    const failures: TProcessingFailure[] = []
    const records = new Map<string, TStageRecord>()
    // A PipelineConfigurationError raised inside a stage's `run`
    // (i.e. a `ctx.get` called on a non-dependency stage id) is a
    // caller bug, not a recoverable runtime failure. We capture the
    // first one and re-throw after the scheduler drains so the
    // executor still emits the bookend events.
    let capturedConfigError: PipelineConfigurationError | null = null

    // The explicit run state shared with the extracted `runOneStage` /
    // `runFinalize` bodies. The scheduler's disposition for a
    // `ctx.get`-on-non-dep config error is "capture the first, re-throw
    // after the bookends" (see the drain-end re-throw below).
    const state: TStageRunState = {
        records,
        failures,
        signal,
        emit,
        generateId,
        llm: deps.llm,
        input: validatedInput,
        setConfigError: (error) => {
            capturedConfigError ??= error
        },
    }

    // Build per-stage `ctx.get` dep sets up front so we can throw on
    // out-of-deps access.
    const stageDepIds = new Map<string, Set<string>>()
    for (const stage of pipeline.stages) {
        stageDepIds.set(stage.id, new Set(stage.dependsOn.map((d) => depId(d))))
    }
    const finalizeDepIds = new Set(
        pipeline.finalize.dependsOn.map((d) => depId(d))
    )

    // -- Helpers --

    const isStageEligible = (stage: TStage<unknown>): boolean => {
        for (const dep of stage.dependsOn) {
            const id = depId(dep)
            const record = records.get(id)
            if (isOptionalDep(dep)) {
                // Optional: eligible once the upstream has any final outcome.
                if (!record) return false
                continue
            }
            if (!record) return false
            if (record.outcome !== "completed") return false
        }
        return true
    }

    const hasRequiredFailureUpstream = (stage: TStage<unknown>): boolean => {
        for (const dep of stage.dependsOn) {
            if (isOptionalDep(dep)) continue
            const record = records.get(depId(dep))
            if (record && record.outcome !== "completed") return true
        }
        return false
    }

    // -- Stage execution --

    const runStage = async (stage: TStage<unknown>): Promise<void> => {
        const ctx = makeStageContext(
            state,
            stageDepIds.get(stage.id) ?? new Set(),
            stage.id
        )
        await runOneStage(stage, ctx, state)
    }

    // -- Scheduler loop --
    //
    // We maintain a pool of in-flight stage promises capped at
    // concurrencyLimit. On each iteration, we mark newly skip-eligible
    // stages (whose required deps are known-failed), then start any
    // eligible stages until either the pool is full or no eligible
    // stages remain. We await `Promise.race(pool)` to yield, then loop.

    const remaining = new Set(pipeline.stages.map((s) => s.id))
    type TPoolEntry = { id: string; promise: Promise<void> }
    const pool: TPoolEntry[] = []

    while (remaining.size > 0 || pool.length > 0) {
        // Eagerly mark skipped stages whose required deps are now failed.
        let skippedAny = true
        while (skippedAny) {
            skippedAny = false
            for (const id of remaining) {
                const stage = stageById.get(id)
                if (!stage) continue
                if (hasRequiredFailureUpstream(stage)) {
                    records.set(stage.id, {
                        outcome: "skipped",
                        output: undefined,
                    })
                    const skipStartAt = now()
                    emit({
                        kind: "stage:start",
                        stageId: stage.id,
                        at: skipStartAt,
                    })
                    debugStageStart({
                        stageId: stage.id,
                        deps: stage.dependsOn.map((d) => depId(d)),
                    })
                    const skipEndAt = now()
                    emit({
                        kind: "stage:end",
                        stageId: stage.id,
                        status: "skipped",
                        at: skipEndAt,
                    })
                    debugStageEnd({
                        stageId: stage.id,
                        status: "skipped",
                        durationMs: skipEndAt - skipStartAt,
                        outputPresence: "null-or-undefined",
                    })
                    remaining.delete(id)
                    skippedAny = true
                    break
                }
            }
        }

        // Start eligible stages up to the concurrency cap.
        let startedSomething = true
        while (startedSomething && pool.length < concurrencyLimit) {
            startedSomething = false
            for (const id of remaining) {
                const stage = stageById.get(id)
                if (!stage) continue
                if (!isStageEligible(stage)) continue
                remaining.delete(id)
                const promise = runStage(stage).then(
                    () => {
                        const idx = pool.findIndex((p) => p.id === id)
                        if (idx >= 0) pool.splice(idx, 1)
                    },
                    (err) => {
                        const idx = pool.findIndex((p) => p.id === id)
                        if (idx >= 0) pool.splice(idx, 1)
                        throw err
                    }
                )
                pool.push({ id, promise })
                startedSomething = true
                if (pool.length >= concurrencyLimit) break
            }
        }

        if (pool.length === 0) {
            // Nothing in flight and nothing eligible. If `remaining`
            // is non-empty, those stages are unreachable — DAG
            // validation should have caught this; fail loudly.
            if (remaining.size > 0) {
                throw new PipelineConfigurationError({
                    code: "DAG_CYCLE",
                    message: `Unreachable stages remain at scheduler exhaustion: ${[
                        ...remaining,
                    ].join(", ")}.`,
                })
            }
            break
        }

        await Promise.race(pool.map((p) => p.promise))
    }

    // Wait for the pool to drain (race exits at the first settled
    // promise; we want them all settled).
    await Promise.allSettled(pool.map((p) => p.promise))

    // If a stage observed a configuration violation (ctx.get on a
    // non-dep), surface that as a thrown error after emitting the
    // pipeline:end bookend so event consumers still see a clean
    // close.
    if (capturedConfigError !== null) {
        const err: PipelineConfigurationError = capturedConfigError
        const failEndAt = now()
        emit({
            kind: "pipeline:end",
            status: "failed",
            output: "null",
            at: failEndAt,
        })
        debugPipelineEnd({
            pipelineId: pipeline.id,
            status: "failed",
            output: "null",
            durationMs: failEndAt - startAt,
        })
        throw err
    }

    // -- Finalize --

    const finalizeCtx = makeStageContext(state, finalizeDepIds, "finalize")
    const output: TOutput | null = runFinalize(pipeline, finalizeCtx, state)

    // Aggregate stage outcomes + token usage.
    const stageOutcomes: Record<string, TStageStatus> = {}
    let aggregatedTokens: TLlmTokenUsage | undefined
    for (const stage of pipeline.stages) {
        const record = records.get(stage.id)
        stageOutcomes[stage.id] = record?.outcome ?? "skipped"
        if (record?.tokenUsage) {
            aggregatedTokens ??= { input: 0, output: 0 }
            aggregatedTokens.input += record.tokenUsage.input
            aggregatedTokens.output += record.tokenUsage.output
            if (record.tokenUsage.reasoning !== undefined) {
                aggregatedTokens.reasoning =
                    (aggregatedTokens.reasoning ?? 0) +
                    record.tokenUsage.reasoning
            }
        }
    }

    const endStatus: "completed" | "failed" = signal.aborted
        ? "failed"
        : "completed"
    const endAt = now()
    const outputPresence: "present" | "null" =
        output === null ? "null" : "present"
    emit({
        kind: "pipeline:end",
        status: endStatus,
        output: outputPresence,
        at: endAt,
    })
    debugPipelineEnd({
        pipelineId: pipeline.id,
        status: endStatus,
        output: outputPresence,
        durationMs: endAt - startAt,
        tokenUsage: aggregatedTokens,
    })

    return {
        output,
        failures,
        stageOutcomes,
        tokenUsage: aggregatedTokens,
    }
}

// -- Single-stage / single-finalize entry points -------------------------
//
// A durable orchestrator (e.g. a server running each stage in its own
// serverless invocation, persisting typed outputs to a database between
// stages) needs to run ONE stage — or the finalize — given the upstream
// stages' persisted outputs AND outcomes, without re-running the whole
// DAG. `executeStage` and `executeFinalize` are the thin, stateless
// (state in, state out) entry points for that: they reuse the same
// `runOneStage` / `runFinalize` bodies the whole-DAG scheduler uses.

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
