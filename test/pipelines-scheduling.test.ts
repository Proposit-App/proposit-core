// Unit tests for the descriptor-based DAG scheduling helpers surfaced at
// the `@proposit/proposit-core/pipelines/scheduling` subpath. These are the
// pure eligibility primitives an out-of-process DAG driver (e.g. a
// database-backed advancer) uses so it need not re-implement core's
// scheduler-loop semantics.

import { describe, expect, it } from "vitest"
import {
    isStageEligible,
    hasRequiredFailureUpstream,
    computeDagProgress,
    optional,
} from "../src/lib/pipelines/scheduling.js"
import type { TStageDescriptor } from "../src/lib/pipelines/scheduling.js"
import type { TStageOutcomeRecord } from "../src/lib/index.js"

const stage = (
    id: string,
    dependsOn: TStageDescriptor["dependsOn"] = []
): TStageDescriptor => ({ id, dependsOn })

const completed: TStageOutcomeRecord = { outcome: "completed" }
const skipped: TStageOutcomeRecord = { outcome: "skipped" }
const failed: TStageOutcomeRecord = { outcome: "failed" }

describe("isStageEligible", () => {
    it("is eligible when every required dep is completed", () => {
        const s = stage("c", ["a", "b"])
        expect(isStageEligible(s, { a: completed, b: completed })).toBe(true)
    })

    it("is not eligible when a required dep has no record yet", () => {
        const s = stage("c", ["a", "b"])
        expect(isStageEligible(s, { a: completed })).toBe(false)
    })

    it("is not eligible when a required dep reached a non-completed outcome", () => {
        const s = stage("c", ["a"])
        expect(isStageEligible(s, { a: skipped })).toBe(false)
        expect(isStageEligible(s, { a: failed })).toBe(false)
    })

    it("treats an optional dep as satisfied once it has any terminal outcome", () => {
        const s = stage("c", [optional("a")])
        expect(isStageEligible(s, { a: completed })).toBe(true)
        expect(isStageEligible(s, { a: skipped })).toBe(true)
        expect(isStageEligible(s, { a: failed })).toBe(true)
    })

    it("is not eligible when an optional dep has no terminal outcome yet", () => {
        const s = stage("c", [optional("a")])
        expect(isStageEligible(s, {})).toBe(false)
    })

    it("is eligible with no dependencies", () => {
        expect(isStageEligible(stage("a"), {})).toBe(true)
    })
})

describe("hasRequiredFailureUpstream", () => {
    it("is true when a required dep reached a non-completed terminal outcome", () => {
        expect(
            hasRequiredFailureUpstream(stage("c", ["a"]), { a: skipped })
        ).toBe(true)
        expect(
            hasRequiredFailureUpstream(stage("c", ["a"]), { a: failed })
        ).toBe(true)
    })

    it("is false when the required dep completed", () => {
        expect(
            hasRequiredFailureUpstream(stage("c", ["a"]), { a: completed })
        ).toBe(false)
    })

    it("ignores optional deps", () => {
        expect(
            hasRequiredFailureUpstream(stage("c", [optional("a")]), {
                a: failed,
            })
        ).toBe(false)
    })
})

describe("computeDagProgress", () => {
    it("partitions not-yet-terminal stages into runnable and skippable", () => {
        const stages = [stage("a"), stage("b", ["a"]), stage("c", ["a"])]
        const records: Record<string, TStageOutcomeRecord> = { a: failed }
        const progress = computeDagProgress(stages, records)
        expect(progress.runnable.map((s) => s.id)).toEqual([])
        expect(progress.skippable.map((s) => s.id)).toEqual(["b", "c"])
    })

    it("excludes already-terminal stages from both partitions", () => {
        const stages = [stage("a"), stage("b", ["a"])]
        const records: Record<string, TStageOutcomeRecord> = {
            a: completed,
            b: completed,
        }
        const progress = computeDagProgress(stages, records)
        expect(progress.runnable).toEqual([])
        expect(progress.skippable).toEqual([])
    })

    it("marks a stage runnable once its required deps complete", () => {
        const stages = [stage("a"), stage("b", ["a"])]
        const progress = computeDagProgress(stages, { a: completed })
        expect(progress.runnable.map((s) => s.id)).toEqual(["b"])
        expect(progress.skippable).toEqual([])
    })
})
