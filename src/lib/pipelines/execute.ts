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
} from "./stage-helpers.js"
import type { TLlmProvider, TLlmTokenUsage } from "../llm/types.js"

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

    const failures: TProcessingFailure[] = []
    const records = new Map<string, TStageRecord>()
    // A PipelineConfigurationError raised inside a stage's `run`
    // (i.e. a `ctx.get` called on a non-dependency stage id) is a
    // caller bug, not a recoverable runtime failure. We capture the
    // first one and re-throw after the scheduler drains so the
    // executor still emits the bookend events.
    let capturedConfigError: PipelineConfigurationError | null = null

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

    const makeCtx = (
        allowedDeps: Set<string>,
        contextLabel: string
    ): TStageContext => {
        const ctx: TStageContext = {
            input: validatedInput,
            get<T>(stageId: string): T | undefined {
                if (!allowedDeps.has(stageId)) {
                    throw new PipelineConfigurationError({
                        code: "GET_OUTSIDE_DEPS",
                        message: `${contextLabel} called ctx.get("${stageId}"), which is not in its dependsOn.`,
                        stageId: contextLabel,
                        depId: stageId,
                    })
                }
                const record = records.get(stageId)
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
                const record = records.get(stageId)
                if (record) return record.outcome
                return "skipped"
            },
            llm: deps.llm,
            generateId,
            signal,
            emit,
            addFailure: (failure) => {
                failures.push({ ...failure, stage: contextLabel })
            },
        }
        return ctx
    }

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
        if (signal.aborted) {
            // Pending stages don't start once aborted. Emit `stage:start`
            // before `stage:end` so consumers walking the event stream
            // for symmetric pairs (e.g. the SSE bridge in slice 2C) see
            // a balanced sequence — every `stage:end` is preceded by a
            // matching `stage:start`.
            const startAt = now()
            emit({ kind: "stage:start", stageId: stage.id, at: startAt })
            records.set(stage.id, { outcome: "skipped", output: undefined })
            emit({
                kind: "stage:end",
                stageId: stage.id,
                status: "skipped",
                at: now(),
            })
            return
        }
        emit({ kind: "stage:start", stageId: stage.id, at: now() })
        const ctx = makeCtx(stageDepIds.get(stage.id) ?? new Set(), stage.id)
        try {
            const output = await stage.run(ctx)
            if (!Value.Check(stage.outputSchema, output)) {
                const errors = [...Value.Errors(stage.outputSchema, output)]
                const message = errors
                    .map((e) => `${e.instancePath}: ${e.message}`)
                    .join("; ")
                failures.push({
                    stage: stage.id,
                    code: "OUTPUT_SCHEMA_INVALID",
                    message,
                    severity: "error",
                })
                records.set(stage.id, {
                    outcome: "failed",
                    output: undefined,
                })
                emit({
                    kind: "stage:end",
                    stageId: stage.id,
                    status: "failed",
                    at: now(),
                })
                return
            }
            const tokenUsage = readStashedTokenUsage(ctx, stage.id)
            records.set(stage.id, {
                outcome: "completed",
                output,
                tokenUsage,
            })
            emit({
                kind: "stage:end",
                stageId: stage.id,
                status: "completed",
                tokenUsage,
                at: now(),
            })
        } catch (err) {
            if (err instanceof PipelineConfigurationError) {
                // ctx.get violation — caller bug. Stash for re-throw,
                // mark the stage failed for bookkeeping, and emit
                // stage:end so consumers see a clean per-stage close.
                records.set(stage.id, {
                    outcome: "failed",
                    output: undefined,
                })
                emit({
                    kind: "stage:end",
                    stageId: stage.id,
                    status: "failed",
                    at: now(),
                })
                capturedConfigError ??= err
                return
            }
            if (err instanceof StageAbortedError) {
                // Caller cancellation surfaced mid-stage. This is not
                // a stage failure to report — no ProcessingFailure is
                // recorded — and the outcome is `skipped` rather than
                // `failed` so consumers can distinguish abort from a
                // genuine provider error.
                records.set(stage.id, {
                    outcome: "skipped",
                    output: undefined,
                })
                emit({
                    kind: "stage:end",
                    stageId: stage.id,
                    status: "skipped",
                    at: now(),
                })
                return
            }
            if (err instanceof LlmStageRetryExhaustedError) {
                failures.push({
                    stage: stage.id,
                    code: err.code,
                    message: err.message,
                    severity: "error",
                    context: err.failureContext,
                })
                records.set(stage.id, {
                    outcome: "failed",
                    output: undefined,
                })
                emit({
                    kind: "stage:end",
                    stageId: stage.id,
                    status: "failed",
                    at: now(),
                })
                return
            }
            if (err instanceof SubPipelineFailedError) {
                failures.push({
                    stage: stage.id,
                    code: err.code,
                    message: err.message,
                    severity: "error",
                    context: err.failureContext,
                })
                records.set(stage.id, {
                    outcome: "failed",
                    output: undefined,
                })
                emit({
                    kind: "stage:end",
                    stageId: stage.id,
                    status: "failed",
                    at: now(),
                })
                return
            }
            const message = err instanceof Error ? err.message : String(err)
            failures.push({
                stage: stage.id,
                code: "STAGE_UNCAUGHT_ERROR",
                message,
                severity: "error",
            })
            records.set(stage.id, { outcome: "failed", output: undefined })
            emit({
                kind: "stage:end",
                stageId: stage.id,
                status: "failed",
                at: now(),
            })
        }
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
                    emit({
                        kind: "stage:start",
                        stageId: stage.id,
                        at: now(),
                    })
                    emit({
                        kind: "stage:end",
                        stageId: stage.id,
                        status: "skipped",
                        at: now(),
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
        emit({
            kind: "pipeline:end",
            status: "failed",
            output: "null",
            at: now(),
        })
        throw err
    }

    // -- Finalize --

    let output: TOutput | null = null
    const finalizeRequiredOk = (): boolean => {
        for (const dep of pipeline.finalize.dependsOn) {
            if (isOptionalDep(dep)) continue
            const record = records.get(depId(dep))
            if (record?.outcome !== "completed") return false
        }
        return true
    }

    if (finalizeRequiredOk() && !signal.aborted) {
        const finalizeCtx = makeCtx(finalizeDepIds, "finalize")
        try {
            output = pipeline.finalize.run(finalizeCtx)
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            failures.push({
                stage: "finalize",
                code: "FINALIZE_UNCAUGHT_ERROR",
                message,
                severity: "error",
            })
            output = null
        }
    }

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
    emit({
        kind: "pipeline:end",
        status: endStatus,
        output: output === null ? "null" : "present",
        at: now(),
    })

    return {
        output,
        failures,
        stageOutcomes,
        tokenUsage: aggregatedTokens,
    }
}
