// Unit matrix for `sortInferenceRelations` — the deterministic stage that
// routes citation/axiomatic antecedents out of freeform premises and into
// derivation backing. This is the heart of the fix that keeps citation /
// axiomatic claims from ever landing in a freeform premise.

import { describe, expect, it } from "vitest"
import {
    sortInferenceRelations,
    RELATION_PLACEMENT_FAILURE_CODES,
} from "../../../../src/extensions/pipelines/base/stages/formula-compilation.js"
import type {
    TClaimTypeClassificationEntry,
    TInferenceRelation,
} from "../../../../src/extensions/pipelines/base/stages/schemas.js"

type TClaimType = TClaimTypeClassificationEntry["type"]

const typeMap = (pairs: [string, TClaimType][]) =>
    new Map<string, TClaimType>(pairs)

const rel = (
    antecedents: string[],
    consequent: string,
    relationId = "r1"
): TInferenceRelation => ({
    relationId,
    type: "inference",
    antecedents,
    consequent,
    title: "",
    evidence: { segmentIds: ["s1"], quote: "q" },
})

const run = (
    relations: TInferenceRelation[],
    types: [string, TClaimType][]
) => {
    const warnings: { code: string }[] = []
    const result = sortInferenceRelations({
        relations,
        typeByClaimMiniId: typeMap(types),
        addFailure: (f) => warnings.push(f),
    })
    return { ...result, warnings }
}

describe("sortInferenceRelations", () => {
    it("keeps a single normal antecedent as a freeform relation", () => {
        const r = run(
            [rel(["c1"], "c2")],
            [
                ["c1", "normal"],
                ["c2", "normal"],
            ]
        )
        expect(r.freeformRelations).toEqual([
            { relationId: "r1", antecedents: ["c1"], consequent: "c2" },
        ])
        expect(r.derivationBacking.size).toBe(0)
    })

    it("routes a citation antecedent into derivation backing, no freeform", () => {
        const r = run(
            [rel(["cit"], "c2")],
            [
                ["cit", "citation"],
                ["c2", "normal"],
            ]
        )
        expect(r.freeformRelations).toEqual([])
        expect(r.derivationBacking.get("c2")).toEqual(["cit"])
    })

    it("routes an axiomatic antecedent into derivation backing", () => {
        const r = run(
            [rel(["ax"], "c2")],
            [
                ["ax", "axiomatic"],
                ["c2", "normal"],
            ]
        )
        expect(r.derivationBacking.get("c2")).toEqual(["ax"])
    })

    it("splits mixed antecedents: normal stays freeform, typed becomes backing", () => {
        const r = run(
            [rel(["cit", "c1"], "c2")],
            [
                ["cit", "citation"],
                ["c1", "normal"],
                ["c2", "normal"],
            ]
        )
        expect(r.freeformRelations).toEqual([
            { relationId: "r1", antecedents: ["c1"], consequent: "c2" },
        ])
        expect(r.derivationBacking.get("c2")).toEqual(["cit"])
    })

    it("drops a relation whose consequent is citation/axiomatic", () => {
        const r = run(
            [rel(["c1"], "cit")],
            [
                ["c1", "normal"],
                ["cit", "citation"],
            ]
        )
        expect(r.freeformRelations).toEqual([])
        expect(r.derivationBacking.size).toBe(0)
        expect(r.warnings.map((w) => w.code)).toContain(
            RELATION_PLACEMENT_FAILURE_CODES.droppedTypedConsequent
        )
    })

    it("dedupes duplicate antecedents", () => {
        const r = run(
            [rel(["c1", "c1"], "c2")],
            [
                ["c1", "normal"],
                ["c2", "normal"],
            ]
        )
        expect(r.freeformRelations[0].antecedents).toEqual(["c1"])
    })

    it("drops a self-referential antecedent", () => {
        const r = run(
            [rel(["c2", "c1"], "c2")],
            [
                ["c1", "normal"],
                ["c2", "normal"],
            ]
        )
        expect(r.freeformRelations[0].antecedents).toEqual(["c1"])
    })

    it("drops a relation left with no antecedents after removing self-reference", () => {
        const r = run([rel(["c2"], "c2")], [["c2", "normal"]])
        expect(r.freeformRelations).toEqual([])
        expect(r.warnings.map((w) => w.code)).toContain(
            RELATION_PLACEMENT_FAILURE_CODES.droppedEmptyAntecedents
        )
    })

    it("drops (never normalizes) an antecedent whose type cannot be resolved", () => {
        // Regression guard: an unresolved mini-id must NOT be treated as
        // `normal` and silently kept in a freeform premise — that is the
        // failure mode that let a citation slip into a freeform premise.
        const r = run([rel(["ghost"], "c2")], [["c2", "normal"]])
        expect(r.freeformRelations).toEqual([])
        expect(r.warnings.map((w) => w.code)).toContain(
            RELATION_PLACEMENT_FAILURE_CODES.droppedUnresolvedClaim
        )
    })

    it("merges deduped backing across relations for the same consequent", () => {
        const r = run(
            [rel(["cit1"], "c2", "r1"), rel(["cit1", "cit2"], "c2", "r2")],
            [
                ["cit1", "citation"],
                ["cit2", "citation"],
                ["c2", "normal"],
            ]
        )
        expect(r.derivationBacking.get("c2")).toEqual(["cit1", "cit2"])
    })
})
