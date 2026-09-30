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
    TStageStatus,
} from "./types.js"
import { depId, isOptionalDep } from "./types.js"
import { PipelineConfigurationError, now } from "./stage-primitives.js"
import {
    defaultPipelineGenerateId,
    makeStageContext,
    noopEmit,
    runFinalize,
    runOneStage,
    type TStageRecord,
    type TStageRunState,
} from "./stage-runner.js"
import {
    debugPipelineEnd,
    debugPipelineStart,
    debugStageEnd,
    debugStageStart,
} from "./debug-log.js"
import type { TLlmProvider, TLlmTokenUsage } from "../llm/types.js"

export { PipelineConfigurationError }

export type TExecutePipelineDeps = {
    llm: TLlmProvider
    generateId?: () => string
    signal?: AbortSignal
    onEvent?: (event: TPipelineEvent) => void
    /** Default 4. */
    concurrencyLimit?: number
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

// Drive every stage of `pipeline` to completion against the shared `state`,
// honoring `concurrencyLimit`. Mutates `state.records` / `state.failures` (and,
// via `state.setConfigError`, the caller's captured config error) as stages
// settle; returns once every stage has a final outcome. Kept separate from
// `executePipeline`, which calls it, because the scheduler loop and its
// eligibility helpers are the largest part of that work.
async function runSchedulerLoop(
    pipeline: TPipeline<unknown, unknown>,
    stageById: Map<string, TStage<unknown>>,
    stageDepIds: Map<string, Set<string>>,
    state: TStageRunState,
    emit: (event: TPipelineEvent) => void,
    concurrencyLimit: number
): Promise<void> {
    const { records } = state

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
    const generateId = deps.generateId ?? defaultPipelineGenerateId
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

    await runSchedulerLoop(
        pipeline as unknown as TPipeline<unknown, unknown>,
        stageById,
        stageDepIds,
        state,
        emit,
        concurrencyLimit
    )

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
