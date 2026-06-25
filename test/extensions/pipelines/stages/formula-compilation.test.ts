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
    rerouteDerivationOnlyRelations,
    resolveClaimTypes,
    FORMULA_COMPILATION_FAILURE_CODES,
    RELATION_PLACEMENT_FAILURE_CODES,
} from "../../../../src/extensions/pipelines/base/stages/formula-compilation.js"
import { STAGE_IDS } from "../../../../src/extensions/pipelines/base/stages/schemas.js"
import type {
    TClaimTypeClassificationEntry,
    TConclusionSelectionOutput,
    TRelation,
    TRelationExtractionOutput,
    TVariableAssignmentOutput,
} from "../../../../src/extensions/pipelines/base/stages/schemas.js"

function counterIdGen(prefix = "p"): () => string {
    let n = 0
    return () => {
        n += 1
        return `${prefix}${n}`
    }
}

function buildVars(
    pairs: [claimMiniId: string, symbol: string][]
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
            conclusion: {
                conclusionMiniId: null,
                conclusionCandidates: [],
                rationale: "",
            },
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
            conclusion: {
                conclusionMiniId: null,
                conclusionCandidates: [],
                rationale: "",
            },
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
            conclusion: {
                conclusionMiniId: null,
                conclusionCandidates: [],
                rationale: "",
            },
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
            conclusion: {
                conclusionMiniId: null,
                conclusionCandidates: [],
                rationale: "",
            },
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
            conclusion: {
                conclusionMiniId: null,
                conclusionCandidates: [],
                rationale: "",
            },
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
            conclusionCandidates: ["c2"],
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
            conclusion: {
                conclusionMiniId: null,
                conclusionCandidates: [],
                rationale: "",
            },
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
            conclusion: {
                conclusionMiniId: "c3",
                conclusionCandidates: ["c3"],
                rationale: "",
            },
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
        const failures: { code: string }[] = []
        const result = compileFormulas({
            relations: [],
            conclusion: {
                conclusionMiniId: "c2",
                conclusionCandidates: ["c2"],
                rationale: "",
            },
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
        const failures: { code: string }[] = []
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
            conclusion: {
                conclusionMiniId: null,
                conclusionCandidates: [],
                rationale: "",
            },
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
        const failures: { code: string }[] = []
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
            conclusion: {
                conclusionMiniId: null,
                conclusionCandidates: [],
                rationale: "",
            },
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
        const failures: { code: string }[] = []
        const relations: TRelationExtractionOutput["relations"] = [
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
            conclusion: {
                conclusionMiniId: null,
                conclusionCandidates: [],
                rationale: "",
            },
            variables: buildVars([["c1", "A"]]),
            generateId: counterIdGen(),
            addFailure: (f) => failures.push({ code: f.code }),
        })
        expect(result.premises).toHaveLength(0)
        expect(
            failures.find(
                (f) => f.code === FORMULA_COMPILATION_FAILURE_CODES.emptySources
            )
        ).toBeDefined()
    })
})

describe("compileFormulas — empty input", () => {
    it("returns empty premises + null conclusion id on empty everything", () => {
        const result = compileFormulas({
            relations: [],
            conclusion: {
                conclusionMiniId: null,
                conclusionCandidates: [],
                rationale: "",
            },
            variables: [],
            generateId: counterIdGen(),
        })
        expect(result.premises).toEqual([])
        expect(result.conclusionPremiseMiniId).toBeNull()
    })
})

// The relation pre-pass keeps citation/axiomatic claims out of freeform
// (support / joint-support) premises: it relabels a single-source
// freeform relation whose source is such a claim to `derivation-support`,
// and drops a relation it can't make compliant — recording a warning so
// the import still succeeds.
function buildClaimTypeMap(
    pairs: [claimMiniId: string, type: TClaimTypeClassificationEntry["type"]][]
): Map<string, TClaimTypeClassificationEntry["type"]> {
    return new Map(pairs)
}

describe("rerouteDerivationOnlyRelations — citation/axiomatic placement", () => {
    it("relabels a `support` relation whose source is a citation to `derivation-support`", () => {
        const relations: TRelation[] = [
            {
                relationId: "r1",
                type: "support",
                sources: ["c1"],
                target: "c2",
                evidence: { segmentIds: [], quote: "" },
            },
        ]
        const placed = rerouteDerivationOnlyRelations({
            relations,
            typeByClaimMiniId: buildClaimTypeMap([
                ["c1", "citation"],
                ["c2", "normal"],
            ]),
        })
        expect(placed).toHaveLength(1)
        expect(placed[0].type).toBe("derivation-support")
    })

    it("relabels a `support` relation whose source is axiomatic to `derivation-support`", () => {
        const placed = rerouteDerivationOnlyRelations({
            relations: [
                {
                    relationId: "r1",
                    type: "support",
                    sources: ["c1"],
                    target: "c2",
                    evidence: { segmentIds: [], quote: "" },
                },
            ],
            typeByClaimMiniId: buildClaimTypeMap([
                ["c1", "axiomatic"],
                ["c2", "normal"],
            ]),
        })
        expect(placed[0].type).toBe("derivation-support")
    })

    it("leaves a freeform relation with only normal sources untouched", () => {
        const placed = rerouteDerivationOnlyRelations({
            relations: [
                {
                    relationId: "r1",
                    type: "support",
                    sources: ["c1"],
                    target: "c2",
                    evidence: { segmentIds: [], quote: "" },
                },
            ],
            typeByClaimMiniId: buildClaimTypeMap([
                ["c1", "normal"],
                ["c2", "normal"],
            ]),
        })
        expect(placed[0].type).toBe("support")
    })

    it("drops an irreparable multi-source citation-in-freeform relation and records a warning", () => {
        const failures: { code: string; severity: string }[] = []
        const placed = rerouteDerivationOnlyRelations({
            relations: [
                {
                    relationId: "r1",
                    type: "joint-support",
                    sources: ["c1", "c2"],
                    target: "c3",
                    evidence: { segmentIds: [], quote: "" },
                },
            ],
            typeByClaimMiniId: buildClaimTypeMap([
                ["c1", "citation"],
                ["c2", "normal"],
                ["c3", "normal"],
            ]),
            addFailure: (f) =>
                failures.push({ code: f.code, severity: f.severity }),
        })
        expect(placed).toHaveLength(0)
        const dropped = failures.find(
            (f) =>
                f.code ===
                RELATION_PLACEMENT_FAILURE_CODES.droppedNoncompliantRelation
        )
        expect(dropped).toBeDefined()
        expect(dropped!.severity).toBe("warning")
    })

    it("keeps the other relations when one is dropped (import is not aborted)", () => {
        const failures: { code: string }[] = []
        const placed = rerouteDerivationOnlyRelations({
            relations: [
                // Irreparable — dropped.
                {
                    relationId: "r1",
                    type: "joint-support",
                    sources: ["c1", "c2"],
                    target: "c3",
                    evidence: { segmentIds: [], quote: "" },
                },
                // Fine — survives.
                {
                    relationId: "r2",
                    type: "support",
                    sources: ["c2"],
                    target: "c3",
                    evidence: { segmentIds: [], quote: "" },
                },
            ],
            typeByClaimMiniId: buildClaimTypeMap([
                ["c1", "citation"],
                ["c2", "normal"],
                ["c3", "normal"],
            ]),
            addFailure: (f) => failures.push({ code: f.code }),
        })
        expect(placed.map((r) => r.relationId)).toEqual(["r2"])
    })

    it("leaves an already-`derivation-support` citation relation as-is", () => {
        const placed = rerouteDerivationOnlyRelations({
            relations: [
                {
                    relationId: "r1",
                    type: "derivation-support",
                    sources: ["c1"],
                    target: "c2",
                    evidence: { segmentIds: [], quote: "" },
                },
            ],
            typeByClaimMiniId: buildClaimTypeMap([
                ["c1", "citation"],
                ["c2", "normal"],
            ]),
        })
        expect(placed[0].type).toBe("derivation-support")
    })

    it("a rerouted citation `support` relation compiles to a derivation premise", () => {
        // End-to-end through the pre-pass + compile: the freeform support
        // relation becomes a derivation premise rather than a support one.
        const placed = rerouteDerivationOnlyRelations({
            relations: [
                {
                    relationId: "r1",
                    type: "support",
                    sources: ["c1"],
                    target: "c2",
                    evidence: { segmentIds: [], quote: "" },
                },
            ],
            typeByClaimMiniId: buildClaimTypeMap([
                ["c1", "citation"],
                ["c2", "normal"],
            ]),
        })
        const result = compileFormulas({
            relations: placed,
            conclusion: {
                conclusionMiniId: null,
                conclusionCandidates: [],
                rationale: "",
            },
            variables: buildVars([
                ["c1", "Citation"],
                ["c2", "Claim"],
            ]),
            generateId: counterIdGen(),
        })
        expect(result.premises).toHaveLength(1)
        expect(result.premises[0].roleHint).toBe("derivation")
        expect(result.premises[0].formula).toBe("Citation implies Claim")
    })
})

describe("resolveClaimTypes — classification with canonical fallback", () => {
    it("prefers the classification entry's type over the drafted type", () => {
        const map = resolveClaimTypes({
            classifications: [
                { miniId: "c1", type: "citation", sourceString: null },
            ],
            canonicalClaims: [{ miniId: "c1", type: "normal" }],
        })
        expect(map.get("c1")).toBe("citation")
    })

    it("falls back to the canonical drafted type when unclassified", () => {
        // A claim the canonicalizer drafted `citation` but the classifier
        // omitted must still resolve to `citation` — otherwise the
        // pre-pass would treat it as normal and let it sit in a freeform
        // premise, the very placement this guards against.
        const map = resolveClaimTypes({
            classifications: [],
            canonicalClaims: [{ miniId: "c1", type: "citation" }],
        })
        expect(map.get("c1")).toBe("citation")
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
                STAGE_IDS.claimCanonicalization,
            ].sort()
        )
    })

    it("runs the placement pre-pass off the stage's claim-type input", async () => {
        // Drive the stage's `run` with a context that supplies a citation
        // source on a `support` relation; the stage must reroute it to a
        // derivation premise using the claim-type classification it reads.
        const outputs: Record<string, unknown> = {
            [STAGE_IDS.relationExtraction]: {
                relations: [
                    {
                        relationId: "r1",
                        type: "support",
                        sources: ["c1"],
                        target: "c2",
                        evidence: { segmentIds: [], quote: "" },
                    },
                ],
            } satisfies TRelationExtractionOutput,
            [STAGE_IDS.conclusionSelection]: {
                conclusionMiniId: null,
                conclusionCandidates: [],
                rationale: "",
            } satisfies TConclusionSelectionOutput,
            [STAGE_IDS.variableAssignment]: buildVars([
                ["c1", "Citation"],
                ["c2", "Claim"],
            ]),
            [STAGE_IDS.claimTypeClassification]: {
                classifications: [
                    { miniId: "c1", type: "citation", sourceString: null },
                    { miniId: "c2", type: "normal", sourceString: null },
                ],
            },
        }
        const idGen = counterIdGen()
        const ctx = {
            input: { text: "ignored" },
            get<T>(stageId: string): T | undefined {
                return outputs[stageId] as T | undefined
            },
            stageStatus: () => "completed",
            llm: {} as never,
            generateId: idGen,
            signal: new AbortController().signal,
            emit: () => undefined,
            addFailure: () => undefined,
        }
        const result = await formulaCompilationStage.run(ctx as never)
        const relationPremise = result.premises.find(
            (p) => p.sourceRelationId === "r1"
        )!
        expect(relationPremise.roleHint).toBe("derivation")
    })

    it("reroutes a citation source the classifier omitted, using the drafted type", async () => {
        // The classifier returned no entry for c1, but the canonicalizer
        // drafted it `citation`. The stage must still keep it out of a
        // freeform premise via the canonical-type fallback.
        const outputs: Record<string, unknown> = {
            [STAGE_IDS.relationExtraction]: {
                relations: [
                    {
                        relationId: "r1",
                        type: "support",
                        sources: ["c1"],
                        target: "c2",
                        evidence: { segmentIds: [], quote: "" },
                    },
                ],
            } satisfies TRelationExtractionOutput,
            [STAGE_IDS.conclusionSelection]: {
                conclusionMiniId: null,
                conclusionCandidates: [],
                rationale: "",
            } satisfies TConclusionSelectionOutput,
            [STAGE_IDS.variableAssignment]: buildVars([
                ["c1", "Citation"],
                ["c2", "Claim"],
            ]),
            [STAGE_IDS.claimCanonicalization]: {
                canonicalClaims: [
                    {
                        miniId: "c1",
                        mentionIds: [],
                        suggestedSymbol: "Citation",
                        type: "citation",
                    },
                    {
                        miniId: "c2",
                        mentionIds: [],
                        suggestedSymbol: "Claim",
                        type: "normal",
                    },
                ],
                mentionToClaim: [],
            },
            // No classification entry for c1.
            [STAGE_IDS.claimTypeClassification]: {
                classifications: [
                    { miniId: "c2", type: "normal", sourceString: null },
                ],
            },
        }
        const ctx = {
            input: { text: "ignored" },
            get<T>(stageId: string): T | undefined {
                return outputs[stageId] as T | undefined
            },
            stageStatus: () => "completed",
            llm: {} as never,
            generateId: counterIdGen(),
            signal: new AbortController().signal,
            emit: () => undefined,
            addFailure: () => undefined,
        }
        const result = await formulaCompilationStage.run(ctx as never)
        const relationPremise = result.premises.find(
            (p) => p.sourceRelationId === "r1"
        )!
        expect(relationPremise.roleHint).toBe("derivation")
    })
})
