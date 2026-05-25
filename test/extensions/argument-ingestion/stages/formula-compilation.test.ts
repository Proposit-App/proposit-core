// Unit tests for `formula-compilation` — the deterministic stage that
// turns the relation graph + conclusion selection into compiled
// premise strings (spec §7.3).
//
// Coverage matrix:
//   - support: s implies t
//   - joint-support: (s1 and s2 and ...) implies t (parenthesized)
//   - joint-support with 1 source: degenerates to plain implication
//   - derivation-support: s implies t (same syntactic shape as support)
//   - conclusion premise: minted exactly once when conclusionMiniId is
//     non-null; its formula is the conclusion claim's symbol alone
//   - conclusionPremiseMiniId === null when conclusion-selection
//     returned null
//   - conclusionPremiseMiniId === null when the conclusion claim has
//     no variable assignment (defensive; emits a failure)
//   - dropped relation when target or any source can't be resolved
//   - empty relation list + null conclusion → empty premises +
//     null conclusionPremiseMiniId

import { describe, expect, it } from "vitest"
import {
    compileFormulas,
    formulaCompilationStage,
    FORMULA_COMPILATION_FAILURE_CODES,
} from "../../../../src/extensions/argument-ingestion/stages/formula-compilation.js"
import { STAGE_IDS } from "../../../../src/extensions/argument-ingestion/stages/schemas.js"
import type {
    TConclusionSelectionOutput,
    TRelationExtractionOutput,
    TVariableAssignmentOutput,
} from "../../../../src/extensions/argument-ingestion/stages/schemas.js"

function counterIdGen(prefix = "p"): () => string {
    let n = 0
    return () => {
        n += 1
        return `${prefix}${n}`
    }
}

function buildVars(
    pairs: Array<[claimMiniId: string, symbol: string]>
): TVariableAssignmentOutput {
    return pairs.map(([claimMiniId, symbol], i) => ({
        miniId: `v${String(i + 1)}`,
        symbol,
        claimMiniId,
    }))
}

describe("compileFormulas — relation compilation rules", () => {
    it("compiles a single `support` relation as `s implies t`", () => {
        const result = compileFormulas({
            relations: [
                {
                    relationId: "r1",
                    type: "support",
                    sources: ["c1"],
                    target: "c2",
                    evidence: { segmentIds: ["s1"], quote: "" },
                },
            ],
            conclusion: { conclusionMiniId: null, rationale: "" },
            variables: buildVars([
                ["c1", "A"],
                ["c2", "B"],
            ]),
            generateId: counterIdGen(),
        })
        expect(result.premises).toHaveLength(1)
        expect(result.premises[0].formula).toBe("A implies B")
        expect(result.premises[0].roleHint).toBe("support")
    })

    it("compiles a `joint-support` relation with multiple sources as parenthesized AND", () => {
        const result = compileFormulas({
            relations: [
                {
                    relationId: "r1",
                    type: "joint-support",
                    sources: ["c1", "c2"],
                    target: "c3",
                    evidence: { segmentIds: [], quote: "" },
                },
            ],
            conclusion: { conclusionMiniId: null, rationale: "" },
            variables: buildVars([
                ["c1", "A"],
                ["c2", "B"],
                ["c3", "C"],
            ]),
            generateId: counterIdGen(),
        })
        expect(result.premises[0].formula).toBe("(A and B) implies C")
        expect(result.premises[0].roleHint).toBe("joint-support")
    })

    it("compiles `joint-support` with 3+ sources with all conjuncts in parens", () => {
        const result = compileFormulas({
            relations: [
                {
                    relationId: "r1",
                    type: "joint-support",
                    sources: ["c1", "c2", "c3"],
                    target: "c4",
                    evidence: { segmentIds: [], quote: "" },
                },
            ],
            conclusion: { conclusionMiniId: null, rationale: "" },
            variables: buildVars([
                ["c1", "A"],
                ["c2", "B"],
                ["c3", "C"],
                ["c4", "D"],
            ]),
            generateId: counterIdGen(),
        })
        expect(result.premises[0].formula).toBe("(A and B and C) implies D")
    })

    it("compiles `derivation-support` the same shape as `support`", () => {
        const result = compileFormulas({
            relations: [
                {
                    relationId: "r1",
                    type: "derivation-support",
                    sources: ["c1"],
                    target: "c2",
                    evidence: { segmentIds: [], quote: "" },
                },
            ],
            conclusion: { conclusionMiniId: null, rationale: "" },
            variables: buildVars([
                ["c1", "A"],
                ["c2", "B"],
            ]),
            generateId: counterIdGen(),
        })
        expect(result.premises[0].formula).toBe("A implies B")
        expect(result.premises[0].roleHint).toBe("derivation")
    })

    it("uses the variable's `symbol` field, not the claim's miniId", () => {
        const result = compileFormulas({
            relations: [
                {
                    relationId: "r1",
                    type: "support",
                    sources: ["c1"],
                    target: "c2",
                    evidence: { segmentIds: [], quote: "" },
                },
            ],
            conclusion: { conclusionMiniId: null, rationale: "" },
            variables: buildVars([
                ["c1", "Lightning"],
                ["c2", "Thunder"],
            ]),
            generateId: counterIdGen(),
        })
        expect(result.premises[0].formula).toBe("Lightning implies Thunder")
    })
})

describe("compileFormulas — conclusion premise minting", () => {
    it("mints exactly one conclusion premise (formula = symbol alone) when conclusionMiniId is set", () => {
        const conclusion: TConclusionSelectionOutput = {
            conclusionMiniId: "c2",
            rationale: "",
        }
        const result = compileFormulas({
            relations: [],
            conclusion,
            variables: buildVars([
                ["c1", "A"],
                ["c2", "B"],
            ]),
            generateId: counterIdGen(),
        })
        expect(result.premises).toHaveLength(1)
        expect(result.premises[0]).toMatchObject({
            formula: "B",
            roleHint: "conclusion",
            sourceRelationId: null,
        })
        expect(result.conclusionPremiseMiniId).toBe(
            result.premises[0].premiseMiniId
        )
    })

    it("returns null `conclusionPremiseMiniId` when conclusionMiniId is null", () => {
        const result = compileFormulas({
            relations: [
                {
                    relationId: "r1",
                    type: "support",
                    sources: ["c1"],
                    target: "c2",
                    evidence: { segmentIds: [], quote: "" },
                },
            ],
            conclusion: { conclusionMiniId: null, rationale: "" },
            variables: buildVars([
                ["c1", "A"],
                ["c2", "B"],
            ]),
            generateId: counterIdGen(),
        })
        // Relation premise still emitted; no conclusion premise.
        expect(result.premises).toHaveLength(1)
        expect(result.premises[0].roleHint).toBe("support")
        expect(result.conclusionPremiseMiniId).toBeNull()
    })

    it("emits exactly one conclusion premise even when relations also target the conclusion claim", () => {
        // Two relations target c3 (the conclusion), but only one
        // dedicated `roleHint: "conclusion"` premise must be minted.
        const result = compileFormulas({
            relations: [
                {
                    relationId: "r1",
                    type: "support",
                    sources: ["c1"],
                    target: "c3",
                    evidence: { segmentIds: [], quote: "" },
                },
                {
                    relationId: "r2",
                    type: "support",
                    sources: ["c2"],
                    target: "c3",
                    evidence: { segmentIds: [], quote: "" },
                },
            ],
            conclusion: { conclusionMiniId: "c3", rationale: "" },
            variables: buildVars([
                ["c1", "A"],
                ["c2", "B"],
                ["c3", "C"],
            ]),
            generateId: counterIdGen(),
        })
        const conclusionPremises = result.premises.filter(
            (p) => p.roleHint === "conclusion"
        )
        expect(conclusionPremises).toHaveLength(1)
        expect(conclusionPremises[0].formula).toBe("C")
        // The two relation premises still exist with their own
        // role hints.
        expect(
            result.premises.filter((p) => p.roleHint === "support")
        ).toHaveLength(2)
    })

    it("emits a failure and leaves conclusionPremiseMiniId null when the conclusion claim has no variable", () => {
        const failures: Array<{ code: string }> = []
        const result = compileFormulas({
            relations: [],
            conclusion: { conclusionMiniId: "c2", rationale: "" },
            variables: buildVars([["c1", "A"]]),
            generateId: counterIdGen(),
            addFailure: (f) => failures.push({ code: f.code }),
        })
        expect(result.conclusionPremiseMiniId).toBeNull()
        expect(
            failures.find(
                (f) =>
                    f.code ===
                    FORMULA_COMPILATION_FAILURE_CODES.unresolvedConclusion
            )
        ).toBeDefined()
    })
})

describe("compileFormulas — symbol-resolution failures", () => {
    it("drops a relation whose target has no variable assignment", () => {
        const failures: Array<{ code: string }> = []
        const result = compileFormulas({
            relations: [
                {
                    relationId: "r1",
                    type: "support",
                    sources: ["c1"],
                    target: "c99",
                    evidence: { segmentIds: [], quote: "" },
                },
            ],
            conclusion: { conclusionMiniId: null, rationale: "" },
            variables: buildVars([["c1", "A"]]),
            generateId: counterIdGen(),
            addFailure: (f) => failures.push({ code: f.code }),
        })
        expect(result.premises).toHaveLength(0)
        expect(
            failures.find(
                (f) =>
                    f.code ===
                    FORMULA_COMPILATION_FAILURE_CODES.unresolvedTarget
            )
        ).toBeDefined()
    })

    it("drops a relation when any source has no variable assignment", () => {
        const failures: Array<{ code: string }> = []
        const result = compileFormulas({
            relations: [
                {
                    relationId: "r1",
                    type: "joint-support",
                    sources: ["c1", "c99"],
                    target: "c2",
                    evidence: { segmentIds: [], quote: "" },
                },
            ],
            conclusion: { conclusionMiniId: null, rationale: "" },
            variables: buildVars([
                ["c1", "A"],
                ["c2", "B"],
            ]),
            generateId: counterIdGen(),
            addFailure: (f) => failures.push({ code: f.code }),
        })
        expect(result.premises).toHaveLength(0)
        expect(
            failures.find(
                (f) =>
                    f.code ===
                    FORMULA_COMPILATION_FAILURE_CODES.unresolvedSource
            )
        ).toBeDefined()
    })

    it("emits FORMULA_COMPILATION_SOURCES_EMPTY when a relation has no sources", () => {
        const failures: Array<{ code: string }> = []
        const relations: TRelationExtractionOutput = [
            {
                relationId: "r1",
                type: "support",
                sources: [],
                target: "c1",
                evidence: { segmentIds: [], quote: "" },
            },
        ]
        const result = compileFormulas({
            relations,
            conclusion: { conclusionMiniId: null, rationale: "" },
            variables: buildVars([["c1", "A"]]),
            generateId: counterIdGen(),
            addFailure: (f) => failures.push({ code: f.code }),
        })
        expect(result.premises).toHaveLength(0)
        expect(
            failures.find(
                (f) =>
                    f.code ===
                    FORMULA_COMPILATION_FAILURE_CODES.emptySources
            )
        ).toBeDefined()
    })
})

describe("compileFormulas — empty input", () => {
    it("returns empty premises + null conclusion id on empty everything", () => {
        const result = compileFormulas({
            relations: [],
            conclusion: { conclusionMiniId: null, rationale: "" },
            variables: [],
            generateId: counterIdGen(),
        })
        expect(result.premises).toEqual([])
        expect(result.conclusionPremiseMiniId).toBeNull()
    })
})

describe("formulaCompilationStage — TStage wiring", () => {
    it("declares the right id + deps", () => {
        expect(formulaCompilationStage.id).toBe(STAGE_IDS.formulaCompilation)
        expect([...formulaCompilationStage.dependsOn].sort()).toEqual(
            [
                STAGE_IDS.relationExtraction,
                STAGE_IDS.conclusionSelection,
                STAGE_IDS.variableAssignment,
                STAGE_IDS.claimTypeClassification,
            ].sort()
        )
    })
})
