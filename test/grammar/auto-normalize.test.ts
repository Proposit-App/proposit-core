// C2: AN post-hook bridge tests.
//
// In v1.0, the engine ships with the legacy per-flag `grammarConfig`
// machinery still in place. The C2 bridge in `ArgumentEngine`
// (`computeEffectiveGrammarConfig`) routes the new `behavior` setting
// to that legacy config so owned `PremiseEngine`s do the right thing
// inside their mutations:
//
//   - `behavior === 'assistive'` → PremiseEngine sees the engine's
//     configured `grammarConfig` (or DEFAULT_GRAMMAR_CONFIG when none
//     was supplied), which has `enforceFormulaBetweenOperators: true`
//     and `autoNormalize: true`. AN-1 fires inside `addExpression`
//     and inserts a formula buffer between OR and AND.
//
//   - `behavior === 'permissive'` → PremiseEngine sees
//     PERMISSIVE_GRAMMAR_CONFIG. No AN cleanup runs; AND is permitted
//     as a direct child of OR (no throw, no buffer).
//
// The tests below exercise the bridge by performing a mutation that
// would trigger AN-1 (`OR(...)` then `addExpression(AND, parentId: OR)`)
// and asserting the post-mutation tree shape.

import { describe, it, expect } from "vitest"
import { ArgumentEngine } from "../../src/lib/core/argument-engine.js"
import { EMPTY_CLAIM_LOOKUP } from "../../src/lib/utils/lookup.js"
import type { TExpressionInput } from "../../src/lib/core/expression-manager.js"
import { POSITION_INITIAL } from "../../src/lib/utils/position.js"
import { makeArgument } from "./fixtures.js"

const ARG = makeArgument()

function opExpr(
    id: string,
    operator: "not" | "and" | "or" | "implies" | "iff",
    parentId: string | null,
    position: number = POSITION_INITIAL
): TExpressionInput {
    return {
        id,
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        premiseId: "auto-normalize-test",
        type: "operator",
        operator,
        parentId,
        position,
    }
}

describe("ArgumentEngine.behavior bridges to AN cleanup (C2)", () => {
    it("assistive mode: AND under OR triggers AN-1 formula buffer insertion", () => {
        const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
            behavior: "assistive",
        })
        const { result: pe } = eng.createPremise()

        // Build OR root, then add AND as child of OR.
        pe.addExpression(opExpr("or-1", "or", null))
        pe.addExpression(opExpr("and-1", "and", "or-1"))

        const exprs = pe.getExpressions()
        const and = exprs.find((e) => e.id === "and-1")!
        // AN-1 fired: AND is no longer a direct child of OR.
        expect(and.parentId).not.toBe("or-1")

        // A formula buffer was inserted; the OR has it as its child, and
        // the formula has AND as its child.
        const formulaBetween = exprs.find(
            (e) => e.type === "formula" && e.parentId === "or-1"
        )
        expect(formulaBetween).toBeDefined()
        expect(and.parentId).toBe(formulaBetween!.id)
    })

    it("permissive mode: AND under OR is allowed with no formula buffer", () => {
        const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
            behavior: "permissive",
        })
        const { result: pe } = eng.createPremise()

        pe.addExpression(opExpr("or-1", "or", null))
        // In permissive mode the operator-under-operator check is bypassed:
        // no throw, no buffer inserted.
        expect(() =>
            pe.addExpression(opExpr("and-1", "and", "or-1"))
        ).not.toThrow()

        const exprs = pe.getExpressions()
        const and = exprs.find((e) => e.id === "and-1")!
        expect(and.parentId).toBe("or-1")

        // No formula buffer should have been inserted between OR and AND.
        const formulaBetween = exprs.find(
            (e) => e.type === "formula" && e.parentId === "or-1"
        )
        expect(formulaBetween).toBeUndefined()
    })

    it("setBehavior(permissive → assistive) re-arms AN on subsequent mutations", () => {
        // Start permissive: first AND lands directly under OR (no buffer).
        const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
            behavior: "permissive",
        })
        const { result: pe } = eng.createPremise()

        pe.addExpression(opExpr("or-1", "or", null))
        pe.addExpression(opExpr("and-1", "and", "or-1", POSITION_INITIAL))

        let exprs = pe.getExpressions()
        const andPermissive = exprs.find((e) => e.id === "and-1")!
        expect(andPermissive.parentId).toBe("or-1")

        // Switch to assistive — the next mutation must see the bridge
        // re-route grammarConfig back to the default.
        eng.setBehavior("assistive")

        // Add a second operator child of OR at a fresh position; this
        // mutation should now trigger AN-1.
        pe.addExpression(opExpr("and-2", "and", "or-1", POSITION_INITIAL * 2))

        exprs = pe.getExpressions()
        const and2 = exprs.find((e) => e.id === "and-2")!
        expect(and2.parentId).not.toBe("or-1")
        const buffer = exprs.find(
            (e) => e.type === "formula" && e.id === and2.parentId
        )
        expect(buffer).toBeDefined()
        expect(buffer!.parentId).toBe("or-1")
    })

    it("setBehavior(assistive → permissive) disarms AN on subsequent mutations", () => {
        // Start assistive (default): an early OR-under-OR mutation would
        // require a buffer, but we set up the tree with a single OR root
        // and then flip to permissive before adding the AND.
        const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP)
        expect(eng.behavior).toBe("assistive")
        const { result: pe } = eng.createPremise()
        pe.addExpression(opExpr("or-1", "or", null))

        eng.setBehavior("permissive")

        // After the switch, AND-under-OR is permitted without a buffer.
        pe.addExpression(opExpr("and-1", "and", "or-1"))
        const exprs = pe.getExpressions()
        const and = exprs.find((e) => e.id === "and-1")!
        expect(and.parentId).toBe("or-1")
        expect(
            exprs.find((e) => e.type === "formula" && e.parentId === "or-1")
        ).toBeUndefined()
    })

    it("createPremise() after setBehavior('permissive') inherits permissive config (P1 review gap)", () => {
        // Per the C1+C2 dual-review P1: setBehavior() propagates to PEs
        // that already exist, but PEs created AFTER the switch must also
        // inherit the new behavior. This test exercises a brand-new PE
        // created post-switch and asserts it sees PERMISSIVE_GRAMMAR_CONFIG
        // (no buffer insertion in its first mutation).
        const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP)
        eng.setBehavior("permissive")

        const { result: pe } = eng.createPremise()
        pe.addExpression(opExpr("or-1", "or", null))
        pe.addExpression(opExpr("and-1", "and", "or-1"))

        const and = pe.getExpressions().find((e) => e.id === "and-1")!
        expect(and.parentId).toBe("or-1")
        expect(
            pe
                .getExpressions()
                .find((e) => e.type === "formula" && e.parentId === "or-1")
        ).toBeUndefined()
    })

    it("createPremise() in default (assistive) mode also gets the right config", () => {
        // Sanity: the assistive path for newly-created PEs is exercised
        // elsewhere by the first test in this describe block, but make
        // the corresponding default-construct assertion explicit so the
        // matched pair is visible.
        const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP)
        expect(eng.behavior).toBe("assistive")

        const { result: pe } = eng.createPremise()
        pe.addExpression(opExpr("or-1", "or", null))
        pe.addExpression(opExpr("and-1", "and", "or-1"))

        const and = pe.getExpressions().find((e) => e.id === "and-1")!
        expect(and.parentId).not.toBe("or-1")
    })
})

describe("runAssistiveNormalization(engine)", () => {
    it("is a no-op when behavior is 'permissive' (does not collapse a buffer-less violation)", async () => {
        const { runAssistiveNormalization } =
            await import("../../src/lib/grammar/auto-normalize.js")

        const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
            behavior: "permissive",
        })
        const { result: pe } = eng.createPremise()
        pe.addExpression(opExpr("or-1", "or", null))
        pe.addExpression(opExpr("and-1", "and", "or-1"))

        // Pre-call: AND is a direct child of OR (a P-1 violation).
        const before = pe.getExpressions()
        expect(before.find((e) => e.id === "and-1")!.parentId).toBe("or-1")

        runAssistiveNormalization(eng)

        // Post-call: structure is unchanged. Permissive mode does not run AN.
        const after = pe.getExpressions()
        expect(after.find((e) => e.id === "and-1")!.parentId).toBe("or-1")
        expect(
            after.find((e) => e.type === "formula" && e.parentId === "or-1")
        ).toBeUndefined()
    })

    it("runs the AN rule set when behavior is 'assistive' (cleans up a P-1 violation introduced in permissive)", async () => {
        const { runAssistiveNormalization } =
            await import("../../src/lib/grammar/auto-normalize.js")

        // Build a tree with a P-1 violation (AND direct child of OR) while
        // behavior is permissive — AN is disarmed inside the mutation.
        const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
            behavior: "permissive",
        })
        const { result: pe } = eng.createPremise()
        pe.addExpression(opExpr("or-1", "or", null))
        pe.addExpression(opExpr("and-1", "and", "or-1"))

        // Pre-call: AND is a direct child of OR (P-1 violation).
        expect(
            pe.getExpressions().find((e) => e.id === "and-1")!.parentId
        ).toBe("or-1")

        // Flip to assistive, then run the AN post-hook. Cleanup must fire.
        eng.setBehavior("assistive")
        runAssistiveNormalization(eng)

        // The AN pass collapsed the empty AND (AN-3 empty-operator collapse)
        // and then the empty OR — leaving the premise with no root.
        // The exact shape post-cleanup depends on AN-3's collapse rules;
        // the key invariant is that the P-1 violation no longer holds:
        // no operator should sit as a direct child of another non-not
        // operator without an intervening formula buffer.
        const after = pe.getExpressions()
        const byId = new Map(after.map((e) => [e.id, e]))
        const stillViolation = after.some((child) => {
            if (child.type !== "operator" || child.operator === "not")
                return false
            if (child.parentId === null) return false
            const parent = byId.get(child.parentId)
            return parent?.type === "operator"
        })
        expect(stillViolation).toBe(false)
    })
})
