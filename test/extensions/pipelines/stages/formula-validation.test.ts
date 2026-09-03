// Unit tests for `formula-validation` — re-parses compiled formulas
// via `parseFormula` and audits every atom against the variable-symbol
// table.

import { describe, expect, it } from "vitest"
import {
    validateFormulas,
    formulaValidationStage,
    FORMULA_VALIDATION_FAILURE_CODES,
} from "../../../../src/extensions/pipelines/base/stages/formula-validation.js"
import { STAGE_IDS } from "../../../../src/extensions/pipelines/base/stages/schemas.js"
import type {
    TFormulaCompilationOutput,
    TVariableAssignmentOutput,
} from "../../../../src/extensions/pipelines/base/stages/schemas.js"

function buildVars(
    pairs: [claimMiniId: string, symbol: string][]
): TVariableAssignmentOutput {
    return pairs.map(([claimMiniId, symbol], i) => ({
        miniId: `v${String(i + 1)}`,
        symbol,
        claimMiniId,
    }))
}

describe("validateFormulas — happy path", () => {
    it("emits no failures when every formula parses + every atom is known", () => {
        const compilation: TFormulaCompilationOutput = {
            premises: [
                {
                    premiseMiniId: "p1",
                    formula: "A implies B",
                    roleHint: "freeform",
                    sourceRelationId: "r1",
                },
                {
                    premiseMiniId: "p2",
                    formula: "(A and B) implies C",
                    roleHint: "freeform",
                    sourceRelationId: "r2",
                },
                {
                    premiseMiniId: "p3",
                    formula: "C",
                    roleHint: "conclusion",
                    sourceRelationId: null,
                },
            ],
            conclusionPremiseMiniId: "p3",
            derivationBacking: [],
        }
        const result = validateFormulas({
            compilation,
            variables: buildVars([
                ["c1", "A"],
                ["c2", "B"],
                ["c3", "C"],
            ]),
        })
        expect(result.failures).toEqual([])
    })
})

describe("validateFormulas — parse errors", () => {
    it("emits FORMULA_PARSE_ERROR on syntactically broken formulas", () => {
        const compilation: TFormulaCompilationOutput = {
            premises: [
                {
                    premiseMiniId: "p1",
                    formula: "A implies",
                    roleHint: "freeform",
                    sourceRelationId: "r1",
                },
            ],
            conclusionPremiseMiniId: null,
            derivationBacking: [],
        }
        const result = validateFormulas({
            compilation,
            variables: buildVars([["c1", "A"]]),
        })
        expect(result.failures).toHaveLength(1)
        expect(result.failures[0].code).toBe(
            FORMULA_VALIDATION_FAILURE_CODES.parseError
        )
        expect(result.failures[0].context.premiseMiniId).toBe("p1")
    })

    it("emits parse error for empty formulas", () => {
        const compilation: TFormulaCompilationOutput = {
            premises: [
                {
                    premiseMiniId: "p1",
                    formula: "",
                    roleHint: "freeform",
                    sourceRelationId: "r1",
                },
            ],
            conclusionPremiseMiniId: null,
            derivationBacking: [],
        }
        const result = validateFormulas({
            compilation,
            variables: [],
        })
        expect(
            result.failures.some(
                (f) => f.code === FORMULA_VALIDATION_FAILURE_CODES.parseError
            )
        ).toBe(true)
    })

    it("emits parse error on dangling operator", () => {
        const compilation: TFormulaCompilationOutput = {
            premises: [
                {
                    premiseMiniId: "p1",
                    formula: "A and",
                    roleHint: "freeform",
                    sourceRelationId: "r1",
                },
            ],
            conclusionPremiseMiniId: null,
            derivationBacking: [],
        }
        const result = validateFormulas({
            compilation,
            variables: buildVars([["c1", "A"]]),
        })
        expect(
            result.failures.some(
                (f) => f.code === FORMULA_VALIDATION_FAILURE_CODES.parseError
            )
        ).toBe(true)
    })
})

describe("validateFormulas — symbol-resolution errors", () => {
    it("emits FORMULA_SYMBOL_UNRESOLVED for unknown atoms", () => {
        const compilation: TFormulaCompilationOutput = {
            premises: [
                {
                    premiseMiniId: "p1",
                    formula: "A implies Mystery",
                    roleHint: "freeform",
                    sourceRelationId: "r1",
                },
            ],
            conclusionPremiseMiniId: null,
            derivationBacking: [],
        }
        const result = validateFormulas({
            compilation,
            variables: buildVars([["c1", "A"]]),
        })
        expect(result.failures).toHaveLength(1)
        expect(result.failures[0].code).toBe(
            FORMULA_VALIDATION_FAILURE_CODES.symbolUnresolved
        )
        expect(result.failures[0].context.unresolvedSymbol).toBe("Mystery")
    })

    it("emits one symbol-unresolved failure per missing atom in a single formula", () => {
        const compilation: TFormulaCompilationOutput = {
            premises: [
                {
                    premiseMiniId: "p1",
                    formula: "(Mystery and Unknown) implies B",
                    roleHint: "freeform",
                    sourceRelationId: "r1",
                },
            ],
            conclusionPremiseMiniId: null,
            derivationBacking: [],
        }
        const result = validateFormulas({
            compilation,
            variables: buildVars([["c1", "B"]]),
        })
        const unresolved = result.failures.filter(
            (f) => f.code === FORMULA_VALIDATION_FAILURE_CODES.symbolUnresolved
        )
        expect(unresolved).toHaveLength(2)
        const names = unresolved.map((f) => f.context.unresolvedSymbol).sort()
        expect(names).toEqual(["Mystery", "Unknown"])
    })
})

describe("validateFormulas — undefined compilation", () => {
    it("returns no failures when compilation is undefined", () => {
        const result = validateFormulas({
            compilation: undefined,
            variables: [],
        })
        expect(result.failures).toEqual([])
    })
})

describe("formulaValidationStage — TStage wiring", () => {
    it("declares the correct id + deps", () => {
        expect(formulaValidationStage.id).toBe(STAGE_IDS.formulaValidation)
        expect([...formulaValidationStage.dependsOn].sort()).toEqual(
            [STAGE_IDS.formulaCompilation, STAGE_IDS.variableAssignment].sort()
        )
    })
})

describe("validateFormulas — exclusive disjunction", () => {
    it("audits the atoms an xor node holds", () => {
        const compilation: TFormulaCompilationOutput = {
            premises: [
                {
                    premiseMiniId: "p1",
                    formula: "A xor Unknown",
                    roleHint: "freeform",
                    sourceRelationId: "r1",
                },
            ],
            conclusionPremiseMiniId: "p1",
            derivationBacking: [],
        }
        const result = validateFormulas({
            compilation,
            variables: buildVars([["c1", "A"]]),
        })
        expect(result.failures).toHaveLength(1)
        expect(result.failures[0]).toMatchObject({
            code: FORMULA_VALIDATION_FAILURE_CODES.symbolUnresolved,
            context: { unresolvedSymbol: "Unknown" },
        })
    })

    it("emits no failure when every xor operand is a known symbol", () => {
        const compilation: TFormulaCompilationOutput = {
            premises: [
                {
                    premiseMiniId: "p1",
                    formula: "A ⊻ B ⊻ C",
                    roleHint: "freeform",
                    sourceRelationId: "r1",
                },
            ],
            conclusionPremiseMiniId: "p1",
            derivationBacking: [],
        }
        const result = validateFormulas({
            compilation,
            variables: buildVars([
                ["c1", "A"],
                ["c2", "B"],
                ["c3", "C"],
            ]),
        })
        expect(result.failures).toEqual([])
    })
})
