import { describe, expect, it } from "vitest"
import {
    ArgumentEngine,
    PremiseEngine,
    ClaimLibrary,
} from "../../src/lib/index"
import { ClaimCitationLibrary } from "../../src/lib/core/claim-citation-library"
import {
    type TClaimBoundVariable,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
    type TCorePremise,
} from "../../src/lib/schemata"
import { VariableManager } from "../../src/lib/core/variable-manager"
import { ExpressionManager } from "../../src/lib/core/expression-manager"
import type {
    TExpressionInput,
    TExpressionWithoutPosition,
} from "../../src/lib/core/expression-manager"
import type { TOptionalChecksum } from "../../src/lib/schemata/shared"
import { POSITION_INITIAL } from "../../src/lib/utils/position"
import {
    validateArgument,
    validateArgumentAfterPremiseMutation,
    validateArgumentEvaluability,
    collectArgumentReferencedVariables,
    type TArgumentValidationContext,
    type TValidatablePremise,
} from "../../src/lib/core/argument-validation"
import {
    EXPR_SCHEMA_INVALID,
    EXPR_SELF_REFERENTIAL_PARENT,
    EXPR_PARENT_NOT_FOUND,
    EXPR_PARENT_NOT_CONTAINER,
    EXPR_ROOT_ONLY_VIOLATED,
    EXPR_CHILD_LIMIT_EXCEEDED,
    EXPR_POSITION_DUPLICATE,
    EXPR_CHECKSUM_MISMATCH,
    PREMISE_VARIABLE_REF_NOT_FOUND,
    VAR_SCHEMA_INVALID,
    VAR_DUPLICATE_ID,
    VAR_DUPLICATE_SYMBOL,
    VAR_CHECKSUM_MISMATCH,
    ARG_OWNERSHIP_MISMATCH,
    ARG_CLAIM_REF_NOT_FOUND,
    CLAIM_SCHEMA_INVALID,
    CLAIM_FROZEN_NO_SUCCESSOR,
    CITATION_CLAIM_REF_NOT_FOUND,
    CITATION_SUPPORTING_REF_NOT_FOUND,
} from "../../src/lib/types/validation"
import {
    ARG,
    aLib,
    makeVar,
    makeVarExpr,
    makeOpExpr,
    makeFormulaExpr,
    VAR_P,
    VAR_Q,
} from "./fixtures"

// ---------------------------------------------------------------------------
// ExpressionManager — validate
// ---------------------------------------------------------------------------

describe("ExpressionManager — validate", () => {
    it("returns ok for a valid tree", () => {
        const em = new ExpressionManager()
        em.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 0 })
        )
        em.addExpression(
            makeVarExpr("v-p", "var-p", { parentId: "op-and", position: 0 })
        )
        em.addExpression(
            makeVarExpr("v-q", "var-q", { parentId: "op-and", position: 1 })
        )
        em.flushExpressionChecksums()

        const result = em.validate()
        expect(result.ok).toBe(true)
        expect(result.violations).toEqual([])
    })

    it("returns ok for an empty manager", () => {
        const em = new ExpressionManager()
        const result = em.validate()
        expect(result.ok).toBe(true)
        expect(result.violations).toEqual([])
    })

    it("detects schema violation", () => {
        // Build a valid manager, then directly corrupt an expression's type
        const em = new ExpressionManager({
            behavior: "permissive" as const,
        })
        em.addExpression(
            makeVarExpr("v-p", "var-p", { parentId: null, position: 0 })
        )
        em.flushExpressionChecksums()
        // Tamper: overwrite with invalid type via internal map
        const map = (
            em as unknown as {
                expressions: Map<string, Record<string, unknown>>
            }
        ).expressions
        const expr = map.get("v-p")!
        map.set("v-p", { ...expr, type: "INVALID_TYPE" })
        const result = em.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some((v) => v.code === EXPR_SCHEMA_INVALID)
        ).toBe(true)
    })

    it("detects self-referential parent", () => {
        const em = new ExpressionManager({
            behavior: "permissive" as const,
        })
        em.addExpression(
            makeVarExpr("v-p", "var-p", { parentId: null, position: 0 })
        )
        em.flushExpressionChecksums()
        // Tamper: set parentId to self via internal map
        const map = (
            em as unknown as {
                expressions: Map<string, Record<string, unknown>>
            }
        ).expressions
        const expr = map.get("v-p")!
        map.set("v-p", { ...expr, parentId: "v-p" })
        const result = em.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some(
                (v) => v.code === EXPR_SELF_REFERENTIAL_PARENT
            )
        ).toBe(true)
    })

    it("detects parent not found", () => {
        const em = new ExpressionManager({
            behavior: "permissive" as const,
        })
        em.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 0 })
        )
        em.addExpression(
            makeVarExpr("v-p", "var-p", { parentId: "op-and", position: 0 })
        )
        em.flushExpressionChecksums()
        // Tamper: change parentId to a nonexistent expression
        const map = (
            em as unknown as {
                expressions: Map<string, Record<string, unknown>>
            }
        ).expressions
        const expr = map.get("v-p")!
        map.set("v-p", { ...expr, parentId: "nonexistent" })
        const result = em.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some((v) => v.code === EXPR_PARENT_NOT_FOUND)
        ).toBe(true)
    })

    it("detects parent not a container", () => {
        const em = new ExpressionManager({
            behavior: "permissive" as const,
        })
        em.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 0 })
        )
        em.addExpression(
            makeVarExpr("v-p", "var-p", { parentId: "op-and", position: 0 })
        )
        em.addExpression(
            makeVarExpr("v-q", "var-q", { parentId: "op-and", position: 1 })
        )
        em.flushExpressionChecksums()
        // Tamper: set v-q's parentId to v-p (a variable, not operator/formula)
        const map = (
            em as unknown as {
                expressions: Map<string, Record<string, unknown>>
            }
        ).expressions
        const expr = map.get("v-q")!
        map.set("v-q", { ...expr, parentId: "v-p" })
        const result = em.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some((v) => v.code === EXPR_PARENT_NOT_CONTAINER)
        ).toBe(true)
    })

    it("detects root-only violation for implies with non-null parent", () => {
        // Inject implies under and via internal map — addExpression forbids this
        const em = new ExpressionManager({
            behavior: "permissive" as const,
        })
        em.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 0 })
        )
        em.flushExpressionChecksums()
        const map = (
            em as unknown as {
                expressions: Map<string, TCorePropositionalExpression>
            }
        ).expressions
        const childIndex = (
            em as unknown as {
                childExpressionIdsByParentId: Map<string | null, Set<string>>
            }
        ).childExpressionIdsByParentId
        map.set("op-implies", {
            id: "op-implies",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "operator",
            operator: "implies",
            parentId: "op-and",
            position: 0,
            checksum: "fake",
            descendantChecksum: null,
            combinedChecksum: "fake",
        } as TCorePropositionalExpression)
        const andChildren = childIndex.get("op-and")
        if (andChildren) {
            andChildren.add("op-implies")
        } else {
            childIndex.set("op-and", new Set(["op-implies"]))
        }
        const result = em.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some((v) => v.code === EXPR_ROOT_ONLY_VIOLATED)
        ).toBe(true)
    })

    it("detects child limit exceeded for not operator", () => {
        // not should have at most 1 child — inject second child via internal map
        const em = new ExpressionManager({
            behavior: "permissive" as const,
        })
        em.addExpression(
            makeOpExpr("op-not", "not", { parentId: null, position: 0 })
        )
        em.addExpression(
            makeVarExpr("v-p", "var-p", { parentId: "op-not", position: 0 })
        )
        em.flushExpressionChecksums()
        // Inject a second child directly
        const map = (
            em as unknown as {
                expressions: Map<string, TCorePropositionalExpression>
            }
        ).expressions
        const childIndex = (
            em as unknown as {
                childExpressionIdsByParentId: Map<string | null, Set<string>>
            }
        ).childExpressionIdsByParentId
        map.set("v-q", {
            id: "v-q",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "variable",
            variableId: "var-q",
            parentId: "op-not",
            position: 1,
            checksum: "fake",
            descendantChecksum: null,
            combinedChecksum: "fake",
        } as TCorePropositionalExpression)
        childIndex.get("op-not")!.add("v-q")
        const result = em.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some((v) => v.code === EXPR_CHILD_LIMIT_EXCEEDED)
        ).toBe(true)
    })

    it("detects child limit exceeded for formula node", () => {
        const em = new ExpressionManager({
            behavior: "permissive" as const,
        })
        em.addExpression(makeFormulaExpr("f1", { parentId: null, position: 0 }))
        em.addExpression(
            makeVarExpr("v-p", "var-p", { parentId: "f1", position: 0 })
        )
        em.flushExpressionChecksums()
        // Inject a second child directly
        const map = (
            em as unknown as {
                expressions: Map<string, TCorePropositionalExpression>
            }
        ).expressions
        const childIndex = (
            em as unknown as {
                childExpressionIdsByParentId: Map<string | null, Set<string>>
            }
        ).childExpressionIdsByParentId
        map.set("v-q", {
            id: "v-q",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "variable",
            variableId: "var-q",
            parentId: "f1",
            position: 1,
            checksum: "fake",
            descendantChecksum: null,
            combinedChecksum: "fake",
        } as TCorePropositionalExpression)
        childIndex.get("f1")!.add("v-q")
        const result = em.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some((v) => v.code === EXPR_CHILD_LIMIT_EXCEEDED)
        ).toBe(true)
    })

    it("detects position uniqueness violation", () => {
        const em = new ExpressionManager({
            behavior: "permissive" as const,
        })
        em.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 0 })
        )
        em.addExpression(
            makeVarExpr("v-p", "var-p", { parentId: "op-and", position: 0 })
        )
        em.flushExpressionChecksums()
        // Inject a second child with duplicate position directly
        const map = (
            em as unknown as {
                expressions: Map<string, TCorePropositionalExpression>
            }
        ).expressions
        const childIndex = (
            em as unknown as {
                childExpressionIdsByParentId: Map<string | null, Set<string>>
            }
        ).childExpressionIdsByParentId
        map.set("v-q", {
            id: "v-q",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "variable",
            variableId: "var-q",
            parentId: "op-and",
            position: 0, // duplicate!
            checksum: "fake",
            descendantChecksum: null,
            combinedChecksum: "fake",
        } as TCorePropositionalExpression)
        childIndex.get("op-and")!.add("v-q")
        const result = em.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some((v) => v.code === EXPR_POSITION_DUPLICATE)
        ).toBe(true)
    })

    it("detects checksum mismatch", () => {
        const em = new ExpressionManager()
        em.addExpression(
            makeVarExpr("v-p", "var-p", { parentId: null, position: 0 })
        )
        em.flushExpressionChecksums()
        // Tamper: corrupt the checksum directly in the internal map
        const map = (
            em as unknown as {
                expressions: Map<string, Record<string, unknown>>
            }
        ).expressions
        const expr = map.get("v-p")!
        map.set("v-p", {
            ...expr,
            checksum: "tampered-checksum",
            combinedChecksum: "tampered-checksum",
        })
        const result = em.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some((v) => v.code === EXPR_CHECKSUM_MISMATCH)
        ).toBe(true)
    })

    it("skips checksum comparison for null/empty checksums", () => {
        // A freshly-created manager before flush has valid checksums
        // (attachChecksum sets them), but let's verify validate doesn't
        // false-positive on a manager with null checksums loaded permissively
        const em = new ExpressionManager({
            behavior: "permissive" as const,
        })
        em.addExpression(
            makeVarExpr("v-p", "var-p", { parentId: null, position: 0 })
        )
        em.flushExpressionChecksums()
        const snap = em.snapshot()
        // Set checksums to null (simulating pre-flush entities)
        ;(snap.expressions[0] as Record<string, unknown>).checksum = null
        ;(snap.expressions[0] as Record<string, unknown>).descendantChecksum =
            null
        ;(snap.expressions[0] as Record<string, unknown>).combinedChecksum =
            null
        const restored = ExpressionManager.fromSnapshot(snap)
        const result = restored.validate()
        // Should not flag checksum mismatch for null checksums
        expect(
            result.violations.some((v) => v.code === EXPR_CHECKSUM_MISMATCH)
        ).toBe(false)
    })

    it("collects multiple violations in one pass", () => {
        // Build a tree with multiple problems via internal map injection
        const em = new ExpressionManager({
            behavior: "permissive" as const,
        })
        em.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 0 })
        )
        em.addExpression(
            makeOpExpr("op-not", "not", { parentId: "op-and", position: 1 })
        )
        em.addExpression(
            makeVarExpr("v-p", "var-p", { parentId: "op-not", position: 0 })
        )
        em.flushExpressionChecksums()
        // Inject implies under and (root-only violation) and second child to not (child limit violation)
        const map = (
            em as unknown as {
                expressions: Map<string, TCorePropositionalExpression>
            }
        ).expressions
        const childIndex = (
            em as unknown as {
                childExpressionIdsByParentId: Map<string | null, Set<string>>
            }
        ).childExpressionIdsByParentId
        map.set("op-implies", {
            id: "op-implies",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "operator",
            operator: "implies",
            parentId: "op-and",
            position: 0,
            checksum: "fake",
            descendantChecksum: null,
            combinedChecksum: "fake",
        } as TCorePropositionalExpression)
        childIndex.get("op-and")!.add("op-implies")
        map.set("v-q", {
            id: "v-q",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "variable",
            variableId: "var-q",
            parentId: "op-not",
            position: 1,
            checksum: "fake",
            descendantChecksum: null,
            combinedChecksum: "fake",
        } as TCorePropositionalExpression)
        childIndex.get("op-not")!.add("v-q")
        const result = em.validate()
        expect(result.ok).toBe(false)
        // Should have at least 2 violations (root-only + child limit)
        expect(result.violations.length).toBeGreaterThanOrEqual(2)
        expect(
            result.violations.some((v) => v.code === EXPR_ROOT_ONLY_VIOLATED)
        ).toBe(true)
        expect(
            result.violations.some((v) => v.code === EXPR_CHILD_LIMIT_EXCEEDED)
        ).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// VariableManager — validate
// ---------------------------------------------------------------------------

describe("VariableManager — validate", () => {
    it("returns ok for a valid set of variables", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(makeVar("var-p", "P"))
        eng.addVariable(makeVar("var-q", "Q"))
        const vm = (eng as unknown as { variables: VariableManager }).variables
        const result = vm.validate()
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
    })

    it("returns ok for an empty manager", () => {
        const vm = new VariableManager()
        const result = vm.validate()
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
    })

    it("detects checksum mismatch after snapshot tampering", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(makeVar("var-p", "P"))
        const snap = (
            eng as unknown as { variables: VariableManager }
        ).variables.snapshot()

        // Tamper the checksum of the variable in the snapshot
        snap.variables[0] = { ...snap.variables[0], checksum: "deadbeef" }

        const vm = VariableManager.fromSnapshot(snap)
        const result = vm.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some((v) => v.code === VAR_CHECKSUM_MISMATCH)
        ).toBe(true)
        expect(result.violations[0].entityId).toBe("var-p")
    })

    it("detects schema violation", () => {
        const vm = new VariableManager()
        // Bypass addVariable to inject a malformed variable directly
        const map = (vm as unknown as { variables: Map<string, unknown> })
            .variables
        const symbolIndex = (
            vm as unknown as { variablesBySymbol: Map<string, string> }
        ).variablesBySymbol
        const bad = {
            id: "var-bad",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "X",
            // Missing claimId/claimVersion and boundPremiseId/boundArgumentId/boundArgumentVersion
            // so it doesn't satisfy either union branch
            checksum: "",
        }
        map.set("var-bad", bad)
        symbolIndex.set("X", "var-bad")
        const result = vm.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some((v) => v.code === VAR_SCHEMA_INVALID)
        ).toBe(true)
    })

    it("detects duplicate ID injected after bypass", () => {
        // Maps cannot have duplicate keys, so we simulate a corrupt state by
        // temporarily overriding toArray() to return an array with repeated IDs.
        const dupVars: TClaimBoundVariable[] = [
            {
                id: "var-dup",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                symbol: "P",
                claimId: "claim-default",
                claimVersion: 0,
                checksum: "",
            },
            {
                id: "var-dup",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                symbol: "Q",
                claimId: "claim-default",
                claimVersion: 0,
                checksum: "",
            },
        ]
        const vm = new VariableManager()
        const origToArray = vm.toArray.bind(vm)
        ;(
            vm as unknown as {
                toArray: () => TCorePropositionalVariable[]
            }
        ).toArray = () => dupVars
        const result = vm.validate()
        ;(
            vm as unknown as {
                toArray: () => TCorePropositionalVariable[]
            }
        ).toArray = origToArray
        expect(result.ok).toBe(false)
        expect(result.violations.some((v) => v.code === VAR_DUPLICATE_ID)).toBe(
            true
        )
    })

    it("detects duplicate symbol injected after bypass", () => {
        const vm = new VariableManager()
        // Bypass addVariable to inject a malformed variable directly
        const map = (vm as unknown as { variables: Map<string, unknown> })
            .variables
        const symbolIndex = (
            vm as unknown as { variablesBySymbol: Map<string, string> }
        ).variablesBySymbol
        // Two variables with the same symbol "P" injected directly
        const v1: TClaimBoundVariable = {
            id: "var-1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "P",
            claimId: "claim-default",
            claimVersion: 0,
            checksum: "",
        }
        const v2: TClaimBoundVariable = {
            id: "var-2",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "P",
            claimId: "claim-default",
            claimVersion: 0,
            checksum: "",
        }
        map.set("var-1", v1)
        map.set("var-2", v2)
        symbolIndex.set("P", "var-2")
        const result = vm.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some((v) => v.code === VAR_DUPLICATE_SYMBOL)
        ).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// PremiseEngine — validate
// ---------------------------------------------------------------------------
describe("PremiseEngine — validate", () => {
    it("returns ok for a valid premise with expressions", () => {
        const vm = new VariableManager()
        vm.addVariable({
            id: "var-p",
            argumentId: "arg-1",
            argumentVersion: 1,
            symbol: "P",
            claimId: "claim-default",
            claimVersion: 0,
            checksum: "",
        } as TCorePropositionalVariable)
        const pe = new PremiseEngine(
            {
                id: "premise-1",
                argumentId: "arg-1",
                argumentVersion: 1,
                type: "freeform" as const,
            } as TOptionalChecksum<TCorePremise>,
            { argument: ARG, variables: vm },
            { behavior: "permissive" as const }
        )
        pe.addExpression(
            makeVarExpr("expr-1", "var-p", { premiseId: "premise-1" })
        )
        // Wire up the variable IDs callback
        pe.setVariableIdsCallback(() => new Set(["var-p"]))
        const result = pe.validate()
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
    })

    it("returns ok for an empty premise", () => {
        const vm = new VariableManager()
        const pe = new PremiseEngine(
            {
                id: "premise-1",
                argumentId: "arg-1",
                argumentVersion: 1,
                type: "freeform" as const,
            } as TOptionalChecksum<TCorePremise>,
            { argument: ARG, variables: vm },
            { behavior: "permissive" as const }
        )
        const result = pe.validate()
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
    })

    it("detects variable reference to non-existent variable", () => {
        const vm = new VariableManager()
        vm.addVariable({
            id: "var-p",
            argumentId: "arg-1",
            argumentVersion: 1,
            symbol: "P",
            claimId: "claim-default",
            claimVersion: 0,
            checksum: "",
        } as TCorePropositionalVariable)
        const pe = new PremiseEngine(
            {
                id: "premise-1",
                argumentId: "arg-1",
                argumentVersion: 1,
                type: "freeform" as const,
            } as TOptionalChecksum<TCorePremise>,
            { argument: ARG, variables: vm },
            { behavior: "permissive" as const }
        )
        pe.addExpression(
            makeVarExpr("expr-1", "var-p", { premiseId: "premise-1" })
        )
        // Set callback returning empty set — var-p won't be found
        pe.setVariableIdsCallback(() => new Set())
        const result = pe.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some(
                (v) => v.code === PREMISE_VARIABLE_REF_NOT_FOUND
            )
        ).toBe(true)
        // The violation should carry the premiseId
        const violation = result.violations.find(
            (v) => v.code === PREMISE_VARIABLE_REF_NOT_FOUND
        )!
        expect(violation.premiseId).toBe("premise-1")
        expect(violation.entityId).toBe("expr-1")
    })
})

describe("ArgumentEngine — validateInvariants", () => {
    // `validateInvariants()` is distinct from the tier-aware
    // `validate(tier)` grammar validator. This describe
    // block exercises the invariant sweep (schema conformance,
    // reference integrity, ownership, conclusion ref, circularity);
    // the four-tier grammar validator is tested separately under
    // `test/grammar/engine-validate.test.ts`.
    const ARG = { id: "arg-1", version: 1 }

    it("valid argument with premises and variables → ok", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.createPremise()
        eng.addVariable(makeVar("v-extra", "X"))

        const result = eng.validateInvariants()
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
    })

    it("empty argument → ok", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        // Clear conclusion (constructor doesn't auto-assign without premises)
        const result = eng.validateInvariants()
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
    })

    it("detects claim reference to non-existent claim", () => {
        // Create engine with a claim-bound variable referencing claim-default
        const claimLib = aLib()
        const eng = new ArgumentEngine(ARG, claimLib, {
            behavior: "permissive",
        })
        eng.addVariable(makeVar("v1", "A"))

        // Snapshot, then restore with an empty ClaimLibrary
        const snap = eng.snapshot()
        const emptyClaimLib = new ClaimLibrary()

        // Restore from snapshot, bypassing addVariable's runtime check
        // by directly building engine and injecting variables
        const engine2 = new ArgumentEngine(snap.argument, emptyClaimLib, {
            behavior: "permissive",
        })
        // Inject variables directly into the VariableManager via snapshot restore
        const vm = VariableManager.fromSnapshot(snap.variables)
        ;(engine2 as unknown as { variables: VariableManager }).variables = vm

        const result = engine2.validateInvariants()
        expect(result.ok).toBe(false)
        const claimViolations = result.violations.filter(
            (v) => v.code === ARG_CLAIM_REF_NOT_FOUND
        )
        expect(claimViolations.length).toBeGreaterThan(0)
        expect(claimViolations[0].entityId).toBe("v1")
    })

    it("detects conclusion referencing non-existent premise", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.createPremise()

        const snap = eng.snapshot()
        // Tamper: set conclusionPremiseId to a non-existent ID
        snap.conclusionPremiseId = "non-existent-premise"

        // fromSnapshot now validates, so loading a tampered snapshot throws
        expect(() =>
            ArgumentEngine.fromSnapshot(snap, aLib(), "ignore")
        ).toThrow(/non-existent-premise/)
    })

    it("detects ownership mismatch on variable", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.createPremise()

        // Snapshot normally, then restore to get a clean engine
        const snap = eng.snapshot()
        const restored = ArgumentEngine.fromSnapshot(snap, aLib(), "ignore")

        // Tamper: directly mutate the variable in the VariableManager
        // to have a wrong argumentId (bypassing ArgumentEngine's guards)
        const vars = restored.getVariables()
        expect(vars.length).toBeGreaterThan(0)
        const vm = (restored as unknown as { variables: VariableManager })
            .variables
        const original = vars[0]
        vm.removeVariable(original.id)
        vm.addVariable({
            ...original,
            argumentId: "wrong-arg",
        } as typeof original)

        const result = restored.validateInvariants()
        expect(result.ok).toBe(false)
        const ownershipViolations = result.violations.filter(
            (v) => v.code === ARG_OWNERSHIP_MISMATCH
        )
        expect(ownershipViolations.length).toBeGreaterThan(0)
    })
})

// ---------------------------------------------------------------------------
// ClaimLibrary — validate
// ---------------------------------------------------------------------------

describe("ClaimLibrary — validate", () => {
    it("returns ok for a valid library", () => {
        const lib = aLib()
        const result = lib.validate()
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
    })

    it("returns ok for an empty library", () => {
        const lib = new ClaimLibrary()
        const result = lib.validate()
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
    })

    it("detects frozen claim without successor", () => {
        const lib = new ClaimLibrary()
        lib.create({ id: "claim-a", type: "normal" })
        // First freeze: version 0 (frozen) + version 1 (unfrozen)
        lib.freeze("claim-a")
        // Second freeze: version 1 (frozen) + version 2 (unfrozen)
        lib.freeze("claim-a")

        // Remove version 1 so version 0 is frozen but version 1 (its
        // direct successor) is missing, while version 2 still exists
        const snap = lib.snapshot()
        const tamperedClaims = snap.claims.filter(
            (c) => !(c.id === "claim-a" && c.version === 1)
        )
        const tamperedSnap = { claims: tamperedClaims }

        const restored = ClaimLibrary.fromSnapshot(tamperedSnap)
        const result = restored.validate()
        expect(result.ok).toBe(false)
        const violations = result.violations.filter(
            (v) => v.code === CLAIM_FROZEN_NO_SUCCESSOR
        )
        expect(violations.length).toBe(1)
        expect(violations[0].entityId).toBe("claim-a")
    })

    it("detects claim failing schema check", () => {
        const lib = new ClaimLibrary()
        lib.create({ id: "claim-b", type: "normal" })
        const snap = lib.snapshot()
        // Tamper: remove the checksum field to break schema
        const tampered = snap.claims.map((c) => {
            const { checksum: _omit, ...rest } = c
            return rest
        })
        const restored = ClaimLibrary.fromSnapshot({
            claims: tampered as Parameters<
                typeof ClaimLibrary.fromSnapshot
            >[0]["claims"],
        })
        const result = restored.validate()
        expect(result.ok).toBe(false)
        const violations = result.violations.filter(
            (v) => v.code === CLAIM_SCHEMA_INVALID
        )
        expect(violations.length).toBeGreaterThan(0)
    })
})

// ---------------------------------------------------------------------------
// ClaimCitationLibrary — validate
// ---------------------------------------------------------------------------

describe("ClaimCitationLibrary — validate", () => {
    it("returns ok for a library with valid citations", () => {
        const claimLib = new ClaimLibrary()
        claimLib.create({ id: "claim-x", type: "normal" })
        claimLib.create({ id: "source-x", type: "citation" })
        const ccLibrary = new ClaimCitationLibrary(claimLib)
        ccLibrary.add({
            id: "cit-1",
            claimId: "claim-x",
            claimVersion: 0,
            supportingClaimId: "source-x",
            supportingClaimVersion: 0,
        })
        const result = ccLibrary.validate()
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
    })

    it("returns ok for an empty library", () => {
        const ccLibrary = new ClaimCitationLibrary(aLib())
        const result = ccLibrary.validate()
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
    })

    it("detects citation referencing non-existent citing claim", () => {
        const claimLib = new ClaimLibrary()
        claimLib.create({ id: "claim-y", type: "normal" })
        claimLib.create({ id: "source-y", type: "citation" })
        const ccLibrary = new ClaimCitationLibrary(claimLib)
        ccLibrary.add({
            id: "cit-2",
            claimId: "claim-y",
            claimVersion: 0,
            supportingClaimId: "source-y",
            supportingClaimVersion: 0,
        })

        // Restore against an empty ClaimLibrary so neither ref is found
        const snap = ccLibrary.snapshot()
        const emptyClaimLib = new ClaimLibrary()
        const restored = ClaimCitationLibrary.fromSnapshot(snap, emptyClaimLib)
        const result = restored.validate()
        expect(result.ok).toBe(false)
        const violations = result.violations.filter(
            (v) => v.code === CITATION_CLAIM_REF_NOT_FOUND
        )
        expect(violations.length).toBe(1)
        expect(violations[0].entityId).toBe("cit-2")
    })

    it("detects citation referencing non-existent source claim", () => {
        const claimLib = new ClaimLibrary()
        claimLib.create({ id: "claim-z", type: "normal" })
        claimLib.create({ id: "source-z", type: "citation" })
        const ccLibrary = new ClaimCitationLibrary(claimLib)
        ccLibrary.add({
            id: "cit-3",
            claimId: "claim-z",
            claimVersion: 0,
            supportingClaimId: "source-z",
            supportingClaimVersion: 0,
        })

        // Restore against a ClaimLibrary that only has the citing claim, not the source
        const snap = ccLibrary.snapshot()
        const partialClaimLib = new ClaimLibrary()
        partialClaimLib.create({ id: "claim-z", type: "normal" })
        const restored = ClaimCitationLibrary.fromSnapshot(
            snap,
            partialClaimLib
        )
        const result = restored.validate()
        expect(result.ok).toBe(false)
        const violations = result.violations.filter(
            (v) => v.code === CITATION_SUPPORTING_REF_NOT_FOUND
        )
        expect(violations.length).toBe(1)
        expect(violations[0].entityId).toBe("cit-3")
    })
})

describe("ArgumentEngine — withValidation bracket", () => {
    it("valid operations still work after wrapping", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(makeVar("var-p", "P"))
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeVarExpr("v1", "var-p", { premiseId: pm.getId() }))
        expect(eng.validateInvariants().ok).toBe(true)
    })

    it("existing per-operation errors still throw with rollback", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        expect(() =>
            eng.addVariable({ ...makeVar("v1", "P"), argumentId: "wrong-arg" })
        ).toThrow()
        expect(eng.getVariables()).toHaveLength(0)
    })

    it("state is consistent after successful removePremise", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const { result: pm } = eng.createPremise()
        eng.removePremise(pm.getId())
        expect(eng.hasPremise(pm.getId())).toBe(false)
        expect(eng.validateInvariants().ok).toBe(true)
    })
})

describe("PremiseEngine — withValidation bracket", () => {
    it("triggers argument-level validation on expression mutation", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(makeVar("var-p", "P"))
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeVarExpr("v1", "var-p", { premiseId: pm.getId() }))
        expect(eng.validateInvariants().ok).toBe(true)
    })

    it("rolls back on failed expression mutation (nonexistent variable)", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const { result: pm } = eng.createPremise()
        expect(() =>
            pm.addExpression(
                makeVarExpr("v1", "nonexistent-var", {
                    premiseId: pm.getId(),
                })
            )
        ).toThrow()
        expect(pm.getExpressions()).toHaveLength(0)
    })

    it("rolls back appendExpression on failure", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const { result: pm } = eng.createPremise()
        expect(() =>
            pm.appendExpression(null, {
                id: "e1",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                premiseId: pm.getId(),
                type: "variable",
                variableId: "nonexistent-var",
            } as TExpressionWithoutPosition)
        ).toThrow()
        expect(pm.getExpressions()).toHaveLength(0)
    })

    it("valid operations through PremiseEngine produce correct state", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(makeVar("var-p", "P"))
        eng.addVariable(makeVar("var-q", "Q"))
        const { result: pm } = eng.createPremise()

        // Build: and(P, Q)
        pm.addExpression({
            id: "op1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: pm.getId(),
            type: "operator",
            operator: "and",
            parentId: null,
            position: POSITION_INITIAL,
        } as TExpressionInput)
        pm.addExpression(
            makeVarExpr("v1", "var-p", {
                premiseId: pm.getId(),
                parentId: "op1",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("v2", "var-q", {
                premiseId: pm.getId(),
                parentId: "op1",
                position: 100,
            })
        )

        expect(pm.getExpressions()).toHaveLength(3)
        expect(eng.validateInvariants().ok).toBe(true)
    })

    it("removeExpression rolls back on invariant violation", () => {
        // Build a valid premise with a single variable expression, then try
        // removing it — the premise itself stays valid (empty is fine) so
        // this should succeed and not roll back.
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(makeVar("var-p", "P"))
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeVarExpr("v1", "var-p", { premiseId: pm.getId() }))
        pm.removeExpression("v1", true)
        expect(pm.getExpressions()).toHaveLength(0)
        expect(eng.validateInvariants().ok).toBe(true)
    })

    it("setExtras succeeds under validation", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const { result: pm } = eng.createPremise()
        pm.setExtras({ label: "test" })
        expect(pm.getExtras()).toEqual({ label: "test" })
        expect(eng.validateInvariants().ok).toBe(true)
    })

    it("updateExpression rolls back on nonexistent variable reference", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(makeVar("var-p", "P"))
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeVarExpr("v1", "var-p", { premiseId: pm.getId() }))
        // Try updating to a nonexistent variable — should throw and roll back
        expect(() =>
            pm.updateExpression("v1", { variableId: "nonexistent" })
        ).toThrow()
        // Expression should still reference original variable
        const expr = pm.getExpression("v1")!
        expect(expr.type === "variable" && expr.variableId).toBe("var-p")
    })

    it("expression index is restored on rollback", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const { result: pm } = eng.createPremise()
        // Try adding an expression referencing a nonexistent variable
        expect(() =>
            pm.addExpression(
                makeVarExpr("v1", "nonexistent-var", {
                    premiseId: pm.getId(),
                })
            )
        ).toThrow()
        // Verify the expression is not in the engine's expression lookup
        expect(eng.getExpressionPremiseId("v1")).toBeUndefined()
    })
})

describe("Library — withValidation brackets", () => {
    it("ClaimLibrary validates after create", () => {
        const lib = new ClaimLibrary()
        lib.create({ id: "c1", type: "normal" })
        expect(lib.validate().ok).toBe(true)
    })

    it("ClaimLibrary validates after freeze", () => {
        const lib = new ClaimLibrary()
        lib.create({ id: "c1", type: "normal" })
        lib.freeze("c1")
        expect(lib.validate().ok).toBe(true)
    })

    it("ClaimLibrary rolls back on duplicate create", () => {
        const lib = new ClaimLibrary()
        lib.create({ id: "c1", type: "normal" })
        expect(() => lib.create({ id: "c1", type: "normal" })).toThrow()
        // Only one entry should exist after rollback
        expect(lib.getAll()).toHaveLength(1)
    })

    it("ClaimCitationLibrary validates after add", () => {
        const cl = aLib()
        cl.create({ id: "s1", type: "citation" })
        const ccl = new ClaimCitationLibrary(cl)
        ccl.add({
            id: "a1",
            claimId: "claim-default",
            claimVersion: 0,
            supportingClaimId: "s1",
            supportingClaimVersion: 0,
        })
        expect(ccl.validate().ok).toBe(true)
    })

    it("ClaimCitationLibrary validates after remove", () => {
        const cl = aLib()
        cl.create({ id: "s1", type: "citation" })
        const ccl = new ClaimCitationLibrary(cl)
        ccl.add({
            id: "a1",
            claimId: "claim-default",
            claimVersion: 0,
            supportingClaimId: "s1",
            supportingClaimVersion: 0,
        })
        ccl.remove("a1")
        expect(ccl.validate().ok).toBe(true)
        expect(ccl.getAll()).toHaveLength(0)
    })

    it("ClaimCitationLibrary rolls back on duplicate add", () => {
        const cl = aLib()
        cl.create({ id: "s1", type: "citation" })
        const ccl = new ClaimCitationLibrary(cl)
        ccl.add({
            id: "a1",
            claimId: "claim-default",
            claimVersion: 0,
            supportingClaimId: "s1",
            supportingClaimVersion: 0,
        })
        expect(() =>
            ccl.add({
                id: "a1",
                claimId: "claim-default",
                claimVersion: 0,
                supportingClaimId: "s1",
                supportingClaimVersion: 0,
            })
        ).toThrow()
        expect(ccl.getAll()).toHaveLength(1)
    })
})

describe("ArgumentEngine — bulk path validation", () => {
    // Load no longer enforces caller-supplied grammarConfig at load
    // time — the load runs Structural-only validation via PERMISSIVE
    // grammar config internally. Lower-tier violations surface post-load
    // via engine.validate(tier). There is no grammarConfig parameter on
    // fromData/fromSnapshot.
    it("rollback validates and rejects invalid snapshot", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const { result: pm } = eng.createPremise()
        const premiseId = pm.getId()
        const goodSnap = eng.snapshot()
        // Tamper conclusionPremiseId
        const badSnap = { ...goodSnap, conclusionPremiseId: "nonexistent" }
        expect(() => eng.rollback(badSnap)).toThrow()
        // Engine should still hold the good state
        expect(eng.hasPremise(premiseId)).toBe(true)
        expect(eng.validateInvariants().ok).toBe(true)
    })
})

describe("validateArgument (standalone)", () => {
    it("is exported from the library", async () => {
        const mod = await import("../../src/lib/index.js")
        expect(typeof mod.validateArgument).toBe("function")
        expect(typeof mod.validateArgumentAfterPremiseMutation).toBe("function")
        expect(typeof mod.validateArgumentEvaluability).toBe("function")
        expect(typeof mod.collectArgumentReferencedVariables).toBe("function")
    })

    /** Helper to build a validation context from an ArgumentEngine. */
    function validationCtxFrom(
        eng: ArgumentEngine
    ): TArgumentValidationContext {
        return {
            argumentId: eng.getArgument().id,
            argumentVersion: eng.getArgument().version,
            conclusionPremiseId: eng.getRoleState().conclusionPremiseId,
            getArgument: () => eng.getArgument(),
            getVariables: () => eng.getVariables(),
            listPremises: () =>
                eng.listPremises() as unknown as TValidatablePremise[],
            hasPremise: (premiseId) => eng.getPremise(premiseId) !== undefined,
            lookupClaim: (claimId, claimVersion) => {
                // Access the claim library used by the engine — for tests
                // we just use the engine's own validate() as the reference.
                // But for rigged tests we override this.
                void claimId
                void claimVersion
                return undefined
            },
            flushAndGetChecksumDeltas: () => {
                // Force a flush by calling getArgument(), which calls
                // flushChecksums() internally.
                eng.getArgument()
                return {
                    savedMeta: undefined,
                    savedDescendant: undefined,
                    savedCombined: undefined,
                    currentMeta: undefined,
                    currentDescendant: undefined,
                    currentCombined: undefined,
                }
            },
            validateVariables: () => ({ ok: true, violations: [] }),
            wouldCreateCycle: () => false,
        }
    }

    describe("collectArgumentReferencedVariables", () => {
        it("indexes variables by ID and symbol across premises", () => {
            const eng = new ArgumentEngine(ARG, aLib(), {
                behavior: "permissive",
            })
            eng.addVariable(VAR_P)
            eng.addVariable(VAR_Q)
            const { result: pm1 } = eng.createPremise({ title: "pm1" })
            const { result: pm2 } = eng.createPremise({ title: "pm2" })
            pm1.addExpression(
                makeVarExpr(`${pm1.getId()}-p`, VAR_P.id, {
                    premiseId: pm1.getId(),
                })
            )
            // pm2 gets an AND with P and Q as children
            const andId = `${pm2.getId()}-and`
            pm2.addExpression(
                makeOpExpr(andId, "and", { premiseId: pm2.getId() })
            )
            pm2.addExpression(
                makeVarExpr(`${pm2.getId()}-p`, VAR_P.id, {
                    premiseId: pm2.getId(),
                    parentId: andId,
                    position: 0,
                })
            )
            pm2.addExpression(
                makeVarExpr(`${pm2.getId()}-q`, VAR_Q.id, {
                    premiseId: pm2.getId(),
                    parentId: andId,
                    position: 1,
                })
            )

            const ctx = validationCtxFrom(eng)
            const result = collectArgumentReferencedVariables(ctx)

            expect(result.variableIds).toEqual([VAR_P.id, VAR_Q.id].sort())
            expect(result.byId[VAR_P.id].symbol).toBe("P")
            expect(result.byId[VAR_P.id].premiseIds).toHaveLength(2)
            expect(result.byId[VAR_Q.id].symbol).toBe("Q")
            expect(result.byId[VAR_Q.id].premiseIds).toHaveLength(1)
            expect(result.bySymbol.P.variableIds).toEqual([VAR_P.id])
            expect(result.bySymbol.Q.variableIds).toEqual([VAR_Q.id])
        })
    })

    describe("validateArgument", () => {
        it("detects ownership mismatch via a rigged context", () => {
            const ctx: TArgumentValidationContext = {
                argumentId: "arg-A",
                argumentVersion: 1,
                conclusionPremiseId: undefined,
                getArgument: () => ({
                    id: "arg-A",
                    version: 1,
                    checksum: "x",
                    descendantChecksum: null,
                    combinedChecksum: "x",
                }),
                getVariables: () => [
                    {
                        id: "var-1",
                        argumentId: "arg-WRONG",
                        argumentVersion: 99,
                        symbol: "X",
                        claimId: "c",
                        claimVersion: 0,
                    } as TCorePropositionalVariable,
                ],
                listPremises: () => [],
                hasPremise: () => false,
                lookupClaim: () => ({ id: "c" }),
                flushAndGetChecksumDeltas: () => ({
                    savedMeta: undefined,
                    savedDescendant: undefined,
                    savedCombined: undefined,
                    currentMeta: undefined,
                    currentDescendant: undefined,
                    currentCombined: undefined,
                }),
                validateVariables: () => ({ ok: true, violations: [] }),
                wouldCreateCycle: () => false,
            }

            const result = validateArgument(ctx)
            expect(result.ok).toBe(false)
            expect(
                result.violations.some((v) => v.code === ARG_OWNERSHIP_MISMATCH)
            ).toBe(true)
        })
    })

    describe("validateArgumentEvaluability", () => {
        it("reports missing conclusion via a rigged context", () => {
            const ctx: TArgumentValidationContext = {
                argumentId: "arg-A",
                argumentVersion: 1,
                conclusionPremiseId: undefined,
                getArgument: () => ({
                    id: "arg-A",
                    version: 1,
                    checksum: "x",
                    descendantChecksum: null,
                    combinedChecksum: "x",
                }),
                getVariables: () => [],
                listPremises: () => [],
                hasPremise: () => false,
                lookupClaim: () => undefined,
                flushAndGetChecksumDeltas: () => ({
                    savedMeta: undefined,
                    savedDescendant: undefined,
                    savedCombined: undefined,
                    currentMeta: undefined,
                    currentDescendant: undefined,
                    currentCombined: undefined,
                }),
                validateVariables: () => ({ ok: true, violations: [] }),
                wouldCreateCycle: () => false,
            }

            const result = validateArgumentEvaluability(ctx)
            expect(result.ok).toBe(false)
            expect(
                result.issues.some((i) => i.code === "ARGUMENT_NO_CONCLUSION")
            ).toBe(true)
        })
    })

    describe("validateArgumentAfterPremiseMutation", () => {
        it("reports missing conclusion premise via context", () => {
            const ctx: TArgumentValidationContext = {
                argumentId: "arg-A",
                argumentVersion: 1,
                conclusionPremiseId: "missing-premise",
                getArgument: () => ({
                    id: "arg-A",
                    version: 1,
                    checksum: "x",
                    descendantChecksum: null,
                    combinedChecksum: "x",
                }),
                getVariables: () => [],
                listPremises: () => [],
                hasPremise: () => false,
                lookupClaim: () => undefined,
                flushAndGetChecksumDeltas: () => ({
                    savedMeta: undefined,
                    savedDescendant: undefined,
                    savedCombined: undefined,
                    currentMeta: undefined,
                    currentDescendant: undefined,
                    currentCombined: undefined,
                }),
                validateVariables: () => ({ ok: true, violations: [] }),
                wouldCreateCycle: () => false,
            }

            const result = validateArgumentAfterPremiseMutation(ctx)
            expect(result.ok).toBe(false)
            expect(
                result.violations.some(
                    (v) => v.code === "ARG_CONCLUSION_NOT_FOUND"
                )
            ).toBe(true)
        })
    })
})
