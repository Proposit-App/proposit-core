import { describe, expect, it } from "vitest"
import { ArgumentEngine, ClaimLibrary } from "../../src/lib/index"
import { Value } from "typebox/value"
import {
    CorePremiseSchema,
    isClaimBound,
    isPremiseBound,
    type TClaimBoundVariable,
    type TPremiseBoundVariable,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
    type TCoreDerivationPremise,
} from "../../src/lib/schemata"
import { POSITION_INITIAL } from "../../src/lib/utils/position"
import { DERIVATION_STRUCTURE_INVALID } from "../../src/lib/types/validation"
import { validateDerivationStructure } from "../../src/lib/grammar/derivation-validation.js"
import { ARG, aLib } from "./fixtures"

describe("Premise type discriminator", () => {
    it("accepts a freeform premise via Value.Check", () => {
        const premise = {
            id: "00000000-0000-0000-0000-000000000001",
            argumentId: "00000000-0000-0000-0000-000000000002",
            argumentVersion: 1,
            type: "freeform",
            checksum: "abcd",
            descendantChecksum: null,
            combinedChecksum: "abcd",
        }
        expect(Value.Check(CorePremiseSchema, premise)).toBe(true)
    })

    it("accepts a derivation premise with derivedClaimId", () => {
        const premise = {
            id: "00000000-0000-0000-0000-000000000001",
            argumentId: "00000000-0000-0000-0000-000000000002",
            argumentVersion: 1,
            type: "derivation",
            derivedClaimId: "00000000-0000-0000-0000-000000000003",
            checksum: "abcd",
            descendantChecksum: null,
            combinedChecksum: "abcd",
        }
        expect(Value.Check(CorePremiseSchema, premise)).toBe(true)
    })

    it("rejects a derivation premise without derivedClaimId", () => {
        const premise = {
            id: "00000000-0000-0000-0000-000000000001",
            argumentId: "00000000-0000-0000-0000-000000000002",
            argumentVersion: 1,
            type: "derivation",
            checksum: "abcd",
            descendantChecksum: null,
            combinedChecksum: "abcd",
        }
        expect(Value.Check(CorePremiseSchema, premise)).toBe(false)
    })

    it("rejects an unknown type literal", () => {
        const premise = {
            id: "00000000-0000-0000-0000-000000000001",
            argumentId: "00000000-0000-0000-0000-000000000002",
            argumentVersion: 1,
            type: "axiomatic",
            checksum: "abcd",
            descendantChecksum: null,
            combinedChecksum: "abcd",
        }
        expect(Value.Check(CorePremiseSchema, premise)).toBe(false)
    })
})

describe("validateDerivationStructure", () => {
    const argumentId = "00000000-0000-0000-0000-000000000001"
    const claimId = "00000000-0000-0000-0000-00000000c0a1"
    const variableId = "00000000-0000-0000-0000-00000000a000"
    const exprId = "00000000-0000-0000-0000-00000000e000"
    const premiseId = "00000000-0000-0000-0000-00000000d001"

    function makeNakedQ(): {
        premise: TCoreDerivationPremise
        expressions: TCorePropositionalExpression[]
        variables: TCorePropositionalVariable[]
    } {
        const premise: TCoreDerivationPremise = {
            id: premiseId,
            argumentId,
            argumentVersion: 1,
            type: "derivation",
            derivedClaimId: claimId,
            checksum: "x",
            descendantChecksum: null,
            combinedChecksum: "x",
        }
        const variables: TCorePropositionalVariable[] = [
            {
                id: variableId,
                argumentId,
                argumentVersion: 1,
                symbol: "Q",
                claimId,
                claimVersion: 1,
                checksum: "x",
            },
        ]
        const expressions: TCorePropositionalExpression[] = [
            {
                id: exprId,
                argumentId,
                argumentVersion: 1,
                premiseId: premise.id,
                parentId: null,
                position: POSITION_INITIAL,
                type: "variable",
                variableId,
                checksum: "x",
                descendantChecksum: null,
                combinedChecksum: "x",
            },
        ]
        return { premise, expressions, variables }
    }

    it("accepts naked-Q form (root = variable expression for derivedClaimId)", () => {
        const { premise, expressions, variables } = makeNakedQ()
        const result = validateDerivationStructure(
            premise,
            expressions,
            variables
        )
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
    })

    it("accepts IMPLIES(antecedent, Q) form", () => {
        const { premise, variables } = makeNakedQ()
        const rootId = "00000000-0000-0000-0000-000000000010"
        const antecedentVarId = "00000000-0000-0000-0000-00000000a001"
        const antecedentExprId = "00000000-0000-0000-0000-000000000011"
        const consequentExprId = "00000000-0000-0000-0000-000000000012"
        const allVariables: TCorePropositionalVariable[] = [
            ...variables,
            {
                id: antecedentVarId,
                argumentId,
                argumentVersion: 1,
                symbol: "P",
                claimId: "00000000-0000-0000-0000-00000000c0b1",
                claimVersion: 1,
                checksum: "x",
            },
        ]
        const expressions: TCorePropositionalExpression[] = [
            {
                id: rootId,
                argumentId,
                argumentVersion: 1,
                premiseId,
                parentId: null,
                position: POSITION_INITIAL,
                type: "operator",
                operator: "implies",
                checksum: "x",
                descendantChecksum: "x",
                combinedChecksum: "x",
            },
            {
                id: antecedentExprId,
                argumentId,
                argumentVersion: 1,
                premiseId,
                parentId: rootId,
                position: 0,
                type: "variable",
                variableId: antecedentVarId,
                checksum: "x",
                descendantChecksum: null,
                combinedChecksum: "x",
            },
            {
                id: consequentExprId,
                argumentId,
                argumentVersion: 1,
                premiseId,
                parentId: rootId,
                position: 1,
                type: "variable",
                variableId,
                checksum: "x",
                descendantChecksum: null,
                combinedChecksum: "x",
            },
        ]
        const result = validateDerivationStructure(
            premise,
            expressions,
            allVariables
        )
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
    })

    it("accepts IFF(antecedent, Q) form", () => {
        const { premise, variables } = makeNakedQ()
        const rootId = "00000000-0000-0000-0000-000000000020"
        const antecedentVarId = "00000000-0000-0000-0000-00000000a002"
        const antecedentExprId = "00000000-0000-0000-0000-000000000021"
        const consequentExprId = "00000000-0000-0000-0000-000000000022"
        const allVariables: TCorePropositionalVariable[] = [
            ...variables,
            {
                id: antecedentVarId,
                argumentId,
                argumentVersion: 1,
                symbol: "R",
                claimId: "00000000-0000-0000-0000-00000000c0c1",
                claimVersion: 1,
                checksum: "x",
            },
        ]
        const expressions: TCorePropositionalExpression[] = [
            {
                id: rootId,
                argumentId,
                argumentVersion: 1,
                premiseId,
                parentId: null,
                position: POSITION_INITIAL,
                type: "operator",
                operator: "iff",
                checksum: "x",
                descendantChecksum: "x",
                combinedChecksum: "x",
            },
            {
                id: antecedentExprId,
                argumentId,
                argumentVersion: 1,
                premiseId,
                parentId: rootId,
                position: 0,
                type: "variable",
                variableId: antecedentVarId,
                checksum: "x",
                descendantChecksum: null,
                combinedChecksum: "x",
            },
            {
                id: consequentExprId,
                argumentId,
                argumentVersion: 1,
                premiseId,
                parentId: rootId,
                position: 1,
                type: "variable",
                variableId,
                checksum: "x",
                descendantChecksum: null,
                combinedChecksum: "x",
            },
        ]
        const result = validateDerivationStructure(
            premise,
            expressions,
            allVariables
        )
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
    })

    it("rejects missing root expression", () => {
        const { premise, variables } = makeNakedQ()
        const result = validateDerivationStructure(premise, [], variables)
        expect(result.ok).toBe(false)
        expect(result.violations).toHaveLength(1)
        expect(result.violations[0].code).toBe(DERIVATION_STRUCTURE_INVALID)
    })

    it("rejects multiple root expressions", () => {
        const { premise, expressions, variables } = makeNakedQ()
        const secondRoot: TCorePropositionalExpression = {
            id: "00000000-0000-0000-0000-000000000030",
            argumentId,
            argumentVersion: 1,
            premiseId,
            parentId: null,
            position: POSITION_INITIAL + 1,
            type: "variable",
            variableId,
            checksum: "x",
            descendantChecksum: null,
            combinedChecksum: "x",
        }
        const result = validateDerivationStructure(
            premise,
            [...expressions, secondRoot],
            variables
        )
        expect(result.ok).toBe(false)
        expect(result.violations).toHaveLength(1)
        expect(result.violations[0].code).toBe(DERIVATION_STRUCTURE_INVALID)
    })

    it("rejects root operator that is not implies/iff/variable (e.g., AND root)", () => {
        const { premise, variables } = makeNakedQ()
        const andRoot: TCorePropositionalExpression = {
            id: "00000000-0000-0000-0000-000000000040",
            argumentId,
            argumentVersion: 1,
            premiseId,
            parentId: null,
            position: POSITION_INITIAL,
            type: "operator",
            operator: "and",
            checksum: "x",
            descendantChecksum: null,
            combinedChecksum: "x",
        }
        const result = validateDerivationStructure(
            premise,
            [andRoot],
            variables
        )
        expect(result.ok).toBe(false)
        expect(result.violations).toHaveLength(1)
        expect(result.violations[0].code).toBe(DERIVATION_STRUCTURE_INVALID)
    })

    it("rejects implies arity != 2", () => {
        const { premise, variables } = makeNakedQ()
        const rootId = "00000000-0000-0000-0000-000000000050"
        const onlyChildExprId = "00000000-0000-0000-0000-000000000051"
        // implies with only 1 child (consequent slot missing antecedent)
        const expressions: TCorePropositionalExpression[] = [
            {
                id: rootId,
                argumentId,
                argumentVersion: 1,
                premiseId,
                parentId: null,
                position: POSITION_INITIAL,
                type: "operator",
                operator: "implies",
                checksum: "x",
                descendantChecksum: "x",
                combinedChecksum: "x",
            },
            {
                id: onlyChildExprId,
                argumentId,
                argumentVersion: 1,
                premiseId,
                parentId: rootId,
                position: 1,
                type: "variable",
                variableId,
                checksum: "x",
                descendantChecksum: null,
                combinedChecksum: "x",
            },
        ]
        const result = validateDerivationStructure(
            premise,
            expressions,
            variables
        )
        expect(result.ok).toBe(false)
        expect(result.violations).toHaveLength(1)
        expect(result.violations[0].code).toBe(DERIVATION_STRUCTURE_INVALID)
    })

    it("rejects consequent slot containing non-variable expression (e.g., AND subtree)", () => {
        const { premise, variables } = makeNakedQ()
        const rootId = "00000000-0000-0000-0000-000000000060"
        const antecedentVarId = "00000000-0000-0000-0000-00000000a003"
        const antecedentExprId = "00000000-0000-0000-0000-000000000061"
        const badConsequentId = "00000000-0000-0000-0000-000000000062"
        const allVariables: TCorePropositionalVariable[] = [
            ...variables,
            {
                id: antecedentVarId,
                argumentId,
                argumentVersion: 1,
                symbol: "S",
                claimId: "00000000-0000-0000-0000-00000000c0d1",
                claimVersion: 1,
                checksum: "x",
            },
        ]
        const expressions: TCorePropositionalExpression[] = [
            {
                id: rootId,
                argumentId,
                argumentVersion: 1,
                premiseId,
                parentId: null,
                position: POSITION_INITIAL,
                type: "operator",
                operator: "implies",
                checksum: "x",
                descendantChecksum: "x",
                combinedChecksum: "x",
            },
            {
                id: antecedentExprId,
                argumentId,
                argumentVersion: 1,
                premiseId,
                parentId: rootId,
                position: 0,
                type: "variable",
                variableId: antecedentVarId,
                checksum: "x",
                descendantChecksum: null,
                combinedChecksum: "x",
            },
            {
                // consequent slot is an AND operator, not a variable
                id: badConsequentId,
                argumentId,
                argumentVersion: 1,
                premiseId,
                parentId: rootId,
                position: 1,
                type: "operator",
                operator: "and",
                checksum: "x",
                descendantChecksum: null,
                combinedChecksum: "x",
            },
        ]
        const result = validateDerivationStructure(
            premise,
            expressions,
            allVariables
        )
        expect(result.ok).toBe(false)
        expect(result.violations).toHaveLength(1)
        expect(result.violations[0].code).toBe(DERIVATION_STRUCTURE_INVALID)
    })

    it("rejects consequent slot containing different variable (not Q)", () => {
        const { premise, variables } = makeNakedQ()
        const rootId = "00000000-0000-0000-0000-000000000070"
        const antecedentVarId = "00000000-0000-0000-0000-00000000a004"
        const wrongConsequentVarId = "00000000-0000-0000-0000-00000000a005"
        const antecedentExprId = "00000000-0000-0000-0000-000000000071"
        const wrongConsequentExprId = "00000000-0000-0000-0000-000000000072"
        const allVariables: TCorePropositionalVariable[] = [
            ...variables,
            {
                id: antecedentVarId,
                argumentId,
                argumentVersion: 1,
                symbol: "T",
                claimId: "00000000-0000-0000-0000-00000000c0e1",
                claimVersion: 1,
                checksum: "x",
            },
            {
                id: wrongConsequentVarId,
                argumentId,
                argumentVersion: 1,
                symbol: "U",
                claimId: "00000000-0000-0000-0000-00000000c0f1",
                claimVersion: 1,
                checksum: "x",
            },
        ]
        const expressions: TCorePropositionalExpression[] = [
            {
                id: rootId,
                argumentId,
                argumentVersion: 1,
                premiseId,
                parentId: null,
                position: POSITION_INITIAL,
                type: "operator",
                operator: "implies",
                checksum: "x",
                descendantChecksum: "x",
                combinedChecksum: "x",
            },
            {
                id: antecedentExprId,
                argumentId,
                argumentVersion: 1,
                premiseId,
                parentId: rootId,
                position: 0,
                type: "variable",
                variableId: antecedentVarId,
                checksum: "x",
                descendantChecksum: null,
                combinedChecksum: "x",
            },
            {
                // consequent slot references a variable that is NOT Q (not derivedClaimId's var)
                id: wrongConsequentExprId,
                argumentId,
                argumentVersion: 1,
                premiseId,
                parentId: rootId,
                position: 1,
                type: "variable",
                variableId: wrongConsequentVarId,
                checksum: "x",
                descendantChecksum: null,
                combinedChecksum: "x",
            },
        ]
        const result = validateDerivationStructure(
            premise,
            expressions,
            allVariables
        )
        expect(result.ok).toBe(false)
        expect(result.violations).toHaveLength(1)
        expect(result.violations[0].code).toBe(DERIVATION_STRUCTURE_INVALID)
    })

    it("rejects naked variable that does not reference derivedClaimId", () => {
        const { premise, variables } = makeNakedQ()
        const wrongVarId = "00000000-0000-0000-0000-00000000a006"
        const allVariables: TCorePropositionalVariable[] = [
            ...variables,
            {
                id: wrongVarId,
                argumentId,
                argumentVersion: 1,
                symbol: "V",
                claimId: "00000000-0000-0000-0000-00000000c0a2",
                claimVersion: 1,
                checksum: "x",
            },
        ]
        // Root variable references wrongVarId, not variableId (Q)
        const expressions: TCorePropositionalExpression[] = [
            {
                id: exprId,
                argumentId,
                argumentVersion: 1,
                premiseId,
                parentId: null,
                position: POSITION_INITIAL,
                type: "variable",
                variableId: wrongVarId,
                checksum: "x",
                descendantChecksum: null,
                combinedChecksum: "x",
            },
        ]
        const result = validateDerivationStructure(
            premise,
            expressions,
            allVariables
        )
        expect(result.ok).toBe(false)
        expect(result.violations).toHaveLength(1)
        expect(result.violations[0].code).toBe(DERIVATION_STRUCTURE_INVALID)
    })

    it("rejects when no claim-bound variable for derivedClaimId exists in `variables`", () => {
        const { premise, expressions } = makeNakedQ()
        // Pass empty variables — no claim-bound variable for claimId
        const result = validateDerivationStructure(premise, expressions, [])
        expect(result.ok).toBe(false)
        expect(result.violations).toHaveLength(1)
        expect(result.violations[0].code).toBe(DERIVATION_STRUCTURE_INVALID)
    })

    it("rejects formula as root (formula is not allowed as root)", () => {
        const { premise, variables } = makeNakedQ()
        const formulaRoot: TCorePropositionalExpression = {
            id: "00000000-0000-0000-0000-000000000080",
            argumentId,
            argumentVersion: 1,
            premiseId,
            parentId: null,
            position: POSITION_INITIAL,
            type: "formula",
            checksum: "x",
            descendantChecksum: null,
            combinedChecksum: "x",
        }
        const result = validateDerivationStructure(
            premise,
            [formulaRoot],
            variables
        )
        expect(result.ok).toBe(false)
        expect(result.violations).toHaveLength(1)
        expect(result.violations[0].code).toBe(DERIVATION_STRUCTURE_INVALID)
    })

    it("accepts a consequent naming any variable bound to the derived claim", () => {
        // The derived claim binds two variables; the consequent names the
        // second. Variables arrive id-sorted, so a first-match lookup picks
        // the other one and calls a well-formed premise malformed — both
        // variables stand for the derived claim.
        const { premise, expressions, variables } = makeNakedQ()
        const secondVariableId = "00000000-0000-0000-0000-00000000a999"
        const bothVariables: TCorePropositionalVariable[] = [
            ...variables,
            {
                id: secondVariableId,
                argumentId,
                argumentVersion: 1,
                symbol: "Q2",
                claimId,
                claimVersion: 1,
                checksum: "x",
            },
        ]
        const rootNamingSecond = expressions.map((e) => ({
            ...e,
            variableId: secondVariableId,
        }))
        const result = validateDerivationStructure(
            premise,
            rootNamingSecond,
            bothVariables
        )
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
    })
})

// ---------------------------------------------------------------------------
// createPremise typed-bag overload + derivation init flow
// ---------------------------------------------------------------------------

describe("createPremise with type and derivedClaimId", () => {
    function setupArgumentWithClaim() {
        const claimLib = new ClaimLibrary()
        const claim = claimLib.create({ type: "normal" })
        const claimId = claim.id
        const argumentEngine = new ArgumentEngine(ARG, claimLib, {
            behavior: "permissive",
        })
        return { argumentEngine, claimLib, claimId }
    }

    it("creates a freeform premise when type is omitted (default)", () => {
        const { argumentEngine } = setupArgumentWithClaim()
        const { result: pm } = argumentEngine.createPremise()
        expect(pm.toPremiseData().type).toBe("freeform")
    })

    it("creates a freeform premise via explicit type: 'freeform'", () => {
        const { argumentEngine } = setupArgumentWithClaim()
        const { result: pm } = argumentEngine.createPremise({
            type: "freeform",
        })
        expect(pm.toPremiseData().type).toBe("freeform")
    })

    it("creates a derivation premise with naked-Q expression tree", () => {
        const { argumentEngine, claimId } = setupArgumentWithClaim()
        const { result: pm } = argumentEngine.createPremise({
            type: "derivation",
            derivedClaimId: claimId,
        })
        const premiseData = pm.toPremiseData()
        expect(premiseData.type).toBe("derivation")
        expect((premiseData as TCoreDerivationPremise).derivedClaimId).toBe(
            claimId
        )
        // Verify the premise's expression tree is a single naked-Q variable expression.
        const expressions = pm.getExpressions()
        expect(expressions).toHaveLength(1)
        const root = expressions.find((e) => e.parentId === null)
        expect(root?.type).toBe("variable")
    })

    it("ensures a claim-bound variable for the derivedClaimId", () => {
        const { argumentEngine, claimId } = setupArgumentWithClaim()
        const variablesBefore = argumentEngine.getVariables().length
        argumentEngine.createPremise({
            type: "derivation",
            derivedClaimId: claimId,
        })
        const variablesAfter = argumentEngine.getVariables().length
        // Two variables created: one premise-bound (auto) + one claim-bound (for derivedClaimId)
        expect(variablesAfter).toBeGreaterThan(variablesBefore)
        const claimBoundVar = argumentEngine
            .getVariables()
            .find(
                (v) =>
                    isClaimBound(
                        v as unknown as import("../../src/lib/schemata").TCorePropositionalVariable
                    ) &&
                    (v as unknown as TClaimBoundVariable).claimId === claimId
            )
        expect(claimBoundVar).toBeDefined()
    })

    it("is idempotent: calling ensureClaimBoundVariable twice reuses the variable", () => {
        const { argumentEngine, claimId } = setupArgumentWithClaim()
        // Ensure the variable once first.
        argumentEngine.ensureClaimBoundVariable(claimId)
        const variablesBefore = argumentEngine.getVariables().length
        // Creating a derivation premise with the same claimId should NOT add another claim-bound variable.
        argumentEngine.createPremise({
            type: "derivation",
            derivedClaimId: claimId,
        })
        const variablesAfter = argumentEngine.getVariables().length
        // Only the premise-bound variable (auto) should be new.
        expect(variablesAfter).toBe(variablesBefore + 1)
    })

    it("throws CREATE_DERIVATION_REQUIRES_DERIVED_CLAIM_ID when type=derivation has no derivedClaimId", () => {
        const { argumentEngine } = setupArgumentWithClaim()
        expect(() =>
            argumentEngine.createPremise({ type: "derivation" })
        ).toThrow(/CREATE_DERIVATION_REQUIRES_DERIVED_CLAIM_ID/)
    })

    it("throws CREATE_DERIVATION_CLAIM_NOT_FOUND when claim is missing", () => {
        const { argumentEngine } = setupArgumentWithClaim()
        expect(() =>
            argumentEngine.createPremise({
                type: "derivation",
                derivedClaimId: "00000000-0000-0000-0000-000000000999",
            })
        ).toThrow(/CREATE_DERIVATION_CLAIM_NOT_FOUND/)
    })
})

describe("createPremise positional signature", () => {
    it("accepts no arguments", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const { result: pm } = eng.createPremise()
        expect(pm.toPremiseData().type).toBe("freeform")
    })

    it("accepts (extras) positional", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const { result: pm } = eng.createPremise({ title: "hello" })
        const data = pm.toPremiseData()
        expect(data.type).toBe("freeform")
        expect((data as Record<string, unknown>).title).toBe("hello")
    })

    it("accepts (extras, symbol) positional", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const { result: pm } = eng.createPremise({ title: "hello" }, "MySymbol")
        const data = pm.toPremiseData()
        expect(data.type).toBe("freeform")
        expect((data as Record<string, unknown>).title).toBe("hello")
        const vars = eng.getVariables()
        const premiseBound = vars.find(
            (v) =>
                isPremiseBound(
                    v as unknown as import("../../src/lib/schemata").TCorePropositionalVariable
                ) &&
                (v as unknown as TPremiseBoundVariable).symbol === "MySymbol"
        )
        expect(premiseBound).toBeDefined()
    })

    it("accepts (undefined, symbol) positional", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const { result: _pm } = eng.createPremise(undefined, "XSym")
        const vars = eng.getVariables()
        const premiseBound = vars.find(
            (v) =>
                isPremiseBound(
                    v as unknown as import("../../src/lib/schemata").TCorePropositionalVariable
                ) && (v as unknown as TPremiseBoundVariable).symbol === "XSym"
        )
        expect(premiseBound).toBeDefined()
    })
})

describe("createPremiseWithId with derivation type", () => {
    function setupArgumentWithClaim() {
        const claimLib = new ClaimLibrary()
        const claim = claimLib.create({ type: "normal" })
        const claimId = claim.id
        const argumentEngine = new ArgumentEngine(ARG, claimLib, {
            behavior: "permissive",
        })
        return { argumentEngine, claimLib, claimId }
    }

    it("creates a derivation premise with given id", () => {
        const { argumentEngine, claimId } = setupArgumentWithClaim()
        const customId = "00000000-0000-0000-0000-000000000111"
        const { result: pm } = argumentEngine.createPremiseWithId(customId, {
            type: "derivation",
            derivedClaimId: claimId,
        })
        expect(pm.getId()).toBe(customId)
        expect(pm.toPremiseData().type).toBe("derivation")
        expect(
            (pm.toPremiseData() as TCoreDerivationPremise).derivedClaimId
        ).toBe(claimId)
    })

    it("creates naked-Q expression tree via createPremiseWithId", () => {
        const { argumentEngine, claimId } = setupArgumentWithClaim()
        const { result: pm } = argumentEngine.createPremiseWithId(
            "00000000-0000-0000-0000-000000000222",
            { type: "derivation", derivedClaimId: claimId }
        )
        const expressions = pm.getExpressions()
        expect(expressions).toHaveLength(1)
        expect(expressions[0].type).toBe("variable")
    })

    it("positional extras work via createPremiseWithId", () => {
        const { argumentEngine } = setupArgumentWithClaim()
        const { result: pm } = argumentEngine.createPremiseWithId(
            "00000000-0000-0000-0000-000000000333",
            { title: "legacy" }
        )
        const data = pm.toPremiseData()
        expect(data.type).toBe("freeform")
        expect((data as Record<string, unknown>).title).toBe("legacy")
    })

    it("throws CREATE_DERIVATION_REQUIRES_DERIVED_CLAIM_ID from createPremiseWithId", () => {
        const { argumentEngine } = setupArgumentWithClaim()
        expect(() =>
            argumentEngine.createPremiseWithId(
                "00000000-0000-0000-0000-000000000444",
                {
                    type: "derivation",
                }
            )
        ).toThrow(/CREATE_DERIVATION_REQUIRES_DERIVED_CLAIM_ID/)
    })

    it("throws CREATE_DERIVATION_CLAIM_NOT_FOUND from createPremiseWithId", () => {
        const { argumentEngine } = setupArgumentWithClaim()
        expect(() =>
            argumentEngine.createPremiseWithId(
                "00000000-0000-0000-0000-000000000555",
                {
                    type: "derivation",
                    derivedClaimId: "00000000-0000-0000-0000-000000000999",
                }
            )
        ).toThrow(/CREATE_DERIVATION_CLAIM_NOT_FOUND/)
    })
})

// ---------------------------------------------------------------------------
// Derivation premise extras handling
// ---------------------------------------------------------------------------

describe("derivation premise extras handling", () => {
    function setupArgumentWithClaim() {
        const claimLib = new ClaimLibrary()
        const claim = claimLib.create({ type: "normal" })
        const claimId = claim.id
        const argumentEngine = new ArgumentEngine(ARG, claimLib, {
            behavior: "permissive",
        })
        return { argumentEngine, claimId }
    }

    it("getExtras() does not include type or derivedClaimId on a derivation premise", () => {
        const { argumentEngine, claimId } = setupArgumentWithClaim()
        const { result: pm } = argumentEngine.createPremise({
            type: "derivation",
            derivedClaimId: claimId,
            extras: { foo: "bar" },
        })
        const extras = pm.getExtras()
        expect(extras).not.toHaveProperty("type")
        expect(extras).not.toHaveProperty("derivedClaimId")
        expect(extras).toMatchObject({ foo: "bar" })
    })

    it("setExtras() preserves type and derivedClaimId after replacement", () => {
        const { argumentEngine, claimId } = setupArgumentWithClaim()
        const { result: pm } = argumentEngine.createPremise({
            type: "derivation",
            derivedClaimId: claimId,
        })
        pm.setExtras({ note: "replacement" })
        const premise = pm.toPremiseData()
        expect(premise.type).toBe("derivation")
        expect((premise as TCoreDerivationPremise).derivedClaimId).toBe(claimId)
        expect(pm.getExtras()).toMatchObject({ note: "replacement" })
    })
})

// ---------------------------------------------------------------------------
// validateEvaluability derivation pre-flight + validateDerivationStructures
// ---------------------------------------------------------------------------

describe("ArgumentEngine validateEvaluability with derivation pre-flight", () => {
    /**
     * Builds an ArgumentEngine whose single derivation premise has an empty
     * expression tree (no root expression → structure violation).
     */
    function setupArgumentWithBrokenDerivation() {
        const claimLib = new ClaimLibrary()
        const claim = claimLib.create({ type: "normal" })

        const engine = new ArgumentEngine(
            { id: "arg-broken", version: 1 },
            claimLib,
            { behavior: "permissive" }
        )
        engine.createPremise({ type: "derivation", derivedClaimId: claim.id })

        // Take snapshot and strip all expressions from the derivation premise.
        const snap = engine.snapshot()
        const derivPremSnap = snap.premises.find(
            (p) => (p.premise as Record<string, unknown>).type === "derivation"
        )!
        derivPremSnap.expressions = { expressions: [] }
        derivPremSnap.rootExpressionId = undefined

        // Restore via ArgumentEngine.fromSnapshot — uses PremiseEngine (no
        // derivation structure check), so the broken tree loads without error.
        const argumentEngine = ArgumentEngine.fromSnapshot(snap, claimLib)
        return { argumentEngine }
    }

    /**
     * Builds an ArgumentEngine with a well-formed derivation premise
     * (naked-Q form created by createPremise).
     */
    function setupArgumentWithGoodDerivation() {
        const claimLib = new ClaimLibrary()
        const claim = claimLib.create({ type: "normal" })

        const engine = new ArgumentEngine(
            { id: "arg-good", version: 1 },
            claimLib,
            { behavior: "permissive" }
        )
        engine.createPremise({ type: "derivation", derivedClaimId: claim.id })
        return { argumentEngine: engine }
    }

    // `validateEvaluability` / `validateDerivationStructures` pass
    // through the underlying `DERIVATION_STRUCTURE_INVALID` code from
    // the derivation-validation utility unchanged. Naked-Q is a
    // no-throw skip; the structurally-broken case (empty tree, no
    // root) still surfaces as a `DERIVATION_STRUCTURE_INVALID`
    // violation through these wrapper APIs.
    it("flags a structurally-broken derivation premise with DERIVATION_STRUCTURE_INVALID", () => {
        const { argumentEngine } = setupArgumentWithBrokenDerivation()
        const result = argumentEngine.validateEvaluability()
        expect(
            result.issues.some((v) => v.code === "DERIVATION_STRUCTURE_INVALID")
        ).toBe(true)
    })

    it("evaluate returns {ok: false} when derivation premise is broken", () => {
        const { argumentEngine } = setupArgumentWithBrokenDerivation()
        const result = argumentEngine.evaluate({
            variables: {},
            operatorAssignments: {},
        })
        expect(result.ok).toBe(false)
        expect(
            result.validation?.issues.some(
                (v) => v.code === "DERIVATION_STRUCTURE_INVALID"
            )
        ).toBe(true)
    })

    it("checkValidity flags broken derivation premises (parity with evaluate)", () => {
        const { argumentEngine } = setupArgumentWithBrokenDerivation()
        const result = argumentEngine.checkValidity()
        expect(
            result.validation?.issues.some(
                (v) => v.code === "DERIVATION_STRUCTURE_INVALID"
            )
        ).toBe(true)
    })

    it("does not flag well-formed derivation premises", () => {
        const { argumentEngine } = setupArgumentWithGoodDerivation()
        const result = argumentEngine.validateEvaluability()
        const derivationIssues = result.issues.filter(
            (v) => v.code === "DERIVATION_STRUCTURE_INVALID"
        )
        expect(derivationIssues).toEqual([])
    })
})

describe("ArgumentEngine.validateDerivationStructures", () => {
    function setupArgumentWithBrokenDerivation() {
        const claimLib = new ClaimLibrary()
        const claim = claimLib.create({ type: "normal" })

        const engine = new ArgumentEngine(
            { id: "arg-broken2", version: 1 },
            claimLib,
            { behavior: "permissive" }
        )
        engine.createPremise({ type: "derivation", derivedClaimId: claim.id })

        const snap = engine.snapshot()
        const derivPremSnap = snap.premises.find(
            (p) => (p.premise as Record<string, unknown>).type === "derivation"
        )!
        derivPremSnap.expressions = { expressions: [] }
        derivPremSnap.rootExpressionId = undefined

        const argumentEngine = ArgumentEngine.fromSnapshot(snap, claimLib)
        return { argumentEngine }
    }

    it("returns the derivation-specific subset of validateEvaluability checks", () => {
        const { argumentEngine } = setupArgumentWithBrokenDerivation()
        const result = argumentEngine.validateDerivationStructures()
        expect(result.violations.length).toBeGreaterThan(0)
        // The wrapper does not rename the code: the underlying
        // `DERIVATION_STRUCTURE_INVALID` code (from
        // `validateDerivationStructure`) flows through unchanged.
        for (const v of result.violations) {
            expect(v.code).toBe("DERIVATION_STRUCTURE_INVALID")
        }
    })
})
