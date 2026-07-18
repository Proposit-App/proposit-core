// Descriptor-based DAG scheduling helpers.
//
// These compute stage eligibility from a serializable stage descriptor
// (`{ id, dependsOn }`) plus a plain record map of terminal outcomes — no
// `TStage` with its `run`/`outputSchema`, no live `Map`, no I/O. They exist so
// a consumer that drives the pipeline DAG out of process (e.g. persisting each
// stage outcome and advancing across separate invocations) can decide what to
// launch and what to skip without re-implementing the scheduler-loop
// eligibility rules. They mirror the in-process scheduler's semantics exactly:
//
//   - a REQUIRED dep is satisfied only when its outcome is `completed`;
//   - an OPTIONAL dep is satisfied once it reaches ANY terminal outcome
//     (`completed` / `skipped` / `failed`);
//   - a stage with a REQUIRED dep that reached a non-`completed` terminal
//     outcome is skip-eligible — the dependent skips rather than failing, and
//     marking it `skipped` lets its OPTIONAL-dependent downstream stages then
//     reach eligibility (eager skip propagation).

import { depId, isOptionalDep } from "./types.js"
import type { TDepSpec } from "./types.js"
import type { TStageOutcomeRecord } from "./single-stage.js"

export { optional, depId, isOptionalDep } from "./types.js"
export type { TDepSpec, TOptionalDep } from "./types.js"

/** A serializable stage descriptor — all an eligibility check needs. */
export type TStageDescriptor = {
    id: string
    dependsOn: readonly TDepSpec[]
}

type TRecordMap = Readonly<Record<string, TStageOutcomeRecord>>

/**
 * A stage is eligible to run once every required dep is `completed` and every
 * optional dep has reached some terminal outcome.
 */
export function isStageEligible(
    stage: TStageDescriptor,
    records: TRecordMap
): boolean {
    for (const dep of stage.dependsOn) {
        const id = depId(dep)
        const record = records[id]
        if (isOptionalDep(dep)) {
            // Optional: eligible once the upstream has ANY final outcome.
            if (!record) return false
            continue
        }
        if (!record) return false
        if (record.outcome !== "completed") return false
    }
    return true
}

/**
 * A stage is skip-eligible when a REQUIRED dep reached a non-`completed`
 * terminal outcome (skipped / failed) — the dependent then skips rather than
 * failing.
 */
export function hasRequiredFailureUpstream(
    stage: TStageDescriptor,
    records: TRecordMap
): boolean {
    for (const dep of stage.dependsOn) {
        if (isOptionalDep(dep)) continue
        const record = records[depId(dep)]
        if (record && record.outcome !== "completed") return true
    }
    return false
}

/** The wave's progress: stages to launch + stages to mark skipped. */
export type TDagProgress<TStage extends TStageDescriptor> = {
    /** Stages eligible to run now (deps satisfied, not yet terminal). */
    runnable: TStage[]
    /**
     * Stages whose required dep failed (skip-eligible, not yet terminal).
     * Marking each `skipped` lets its optional-dependent downstream stages
     * then reach eligibility (eager skip propagation).
     */
    skippable: TStage[]
}

/**
 * From the full descriptor list + the committed terminal-outcome map, partition
 * the not-yet-terminal stages into the ones to launch now (`runnable`) and the
 * ones to mark skipped now (`skippable`). An already-terminal stage appears in
 * neither. Skip-eligibility takes precedence over runnability (the two sets are
 * disjoint). Generic over the descriptor subtype so a caller carrying extra
 * serializable fields gets them back on the partitioned stages.
 */
export function computeDagProgress<TStage extends TStageDescriptor>(
    stages: readonly TStage[],
    records: TRecordMap
): TDagProgress<TStage> {
    const runnable: TStage[] = []
    const skippable: TStage[] = []
    for (const stage of stages) {
        if (records[stage.id]) continue // already terminal — never revisit
        if (hasRequiredFailureUpstream(stage, records)) {
            skippable.push(stage)
        } else if (isStageEligible(stage, records)) {
            runnable.push(stage)
        }
    }
    return { runnable, skippable }
}
