// Runs one stage, or a pipeline's finalize, against an explicit run state.
//
// The whole-pipeline scheduler (`scheduler.ts`) and the single-stage entry
// points (`single-stage.ts`) both execute stages through these functions,
// so the per-stage and finalize behaviour is written once.

import { Value } from "typebox/value"
import type {
    TPipeline,
    TPipelineEvent,
    TProcessingFailure,
    TStage,
    TStageContext,
    TStageStatus,
} from "./types.js"
import { depId, isOptionalDep } from "./types.js"
import {
    LlmStageRetryExhaustedError,
    PipelineConfigurationError,
    StageAbortedError,
    SubPipelineFailedError,
    now,
    readStashedTokenUsage,
} from "./stage-primitives.js"
import { debugStageEnd, debugStageStart } from "./debug-log.js"
import type { TLlmProvider, TLlmTokenUsage } from "../llm/types.js"

export function defaultPipelineGenerateId(): string {
    return globalThis.crypto.randomUUID()
}

export function noopEmit(_event: TPipelineEvent): void {
    // intentional no-op
}

export type TStageRecord = {
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

export type TStageRunState = {
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
export function makeStageContext(
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
export async function runOneStage(
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
export function runFinalize<TOutput>(
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
