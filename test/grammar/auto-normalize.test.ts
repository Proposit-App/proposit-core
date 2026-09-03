// AN post-hook bridge tests.
//
// Per spec §5, the engine in `assistive` mode runs the AN rule set
// (AN-1..AN-4) as a uniform post-hook after every successful
// Structural mutation; in `permissive` mode AN does not run and the
// engine guarantees only Structural integrity. The
// `runAssistiveNormalization(engine)` call is wired into `setOnMutate`
// at the 3 PE-callback sites in ArgumentEngine.
//
// **Test setup pattern.** The spec's preservation contract is "if
// the pre-mutation state was Presentable, the post-mutation state is
// Presentable" — AN-3 collapses 0-child operators eagerly in
// assistive mode, which makes the obvious "addExpression(or, null)
// then addExpression(and, or)" pattern incompatible with assistive
// mode (the first call's post-hook AN-3 deletes the OR before the
// second call can attach). To exercise the assistive post-hook
// without tripping AN-3 mid-build:
//
//   1. Build the prerequisite tree (including the P-1 violation) in
//      `permissive` so AN doesn't fire during the build.
//   2. Flip to `assistive` (the flip itself does NOT auto-normalize
//      per setBehavior JSDoc).
//   3. Trigger ANY mutation on the engine — typically a variable
//      addExpression on a separate premise (variables aren't subject
//      to AN-3 so no 0-child collapse). The post-hook fires globally
//      and the AN sweep finds the pre-existing P-1 violation and
//      repairs it via AN-1.
//
// This setup directly validates the contract "after each mutation in
// assistive mode, AN runs globally."

import { describe, it, expect } from "vitest"
import { ArgumentEngine } from "../../src/lib/core/argument-engine.js"
import { ClaimLibrary } from "../../src/lib/core/claim-library.js"
import { EMPTY_CLAIM_LOOKUP } from "../../src/lib/utils/lookup.js"
import type { TExpressionInput } from "../../src/lib/core/expression-manager.js"
import { POSITION_INITIAL } from "../../src/lib/utils/position.js"
import type { TCoreLogicalOperatorType } from "../../src/lib/schemata/index.js"
import { makeArgument } from "./fixtures.js"

/**
 * Build a fresh claim library + ArgumentEngine pair seeded with two
 * claim-bound variables `v-p` and `v-q`. Returns the engine and the
 * variable IDs. Claim-bound variables (vs premise-bound) can be
 * referenced from any premise's expression tree without circular-
 * binding errors.
 */
function makeEngineWithVars(behavior: "assistive" | "permissive") {
    const claimLib = new ClaimLibrary()
    claimLib.create({ id: "claim-p", type: "normal" })
    claimLib.create({ id: "claim-q", type: "normal" })
    const eng = new ArgumentEngine(ARG, claimLib, { behavior })
    eng.addVariable({
        id: "v-p",
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        symbol: "P",
        claimId: "claim-p",
        claimVersion: 0,
    })
    eng.addVariable({
        id: "v-q",
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        symbol: "Q",
        claimId: "claim-q",
        claimVersion: 0,
    })
    return { eng, vP: "v-p", vQ: "v-q" }
}

const ARG = makeArgument()

function opExpr(
    id: string,
    operator: TCoreLogicalOperatorType,
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

describe("ArgumentEngine.behavior bridges to AN cleanup", () => {
    it("assistive mode: post-hook AN-1 repairs an existing P-1 violation after the next mutation", () => {
        // Build OR(AND(VAR_P, VAR_Q), VAR_P) in permissive. AND
        // directly under OR is a P-1 violation. AND has 2 children
        // (VAR_P and VAR_Q) so AN-3 does NOT collapse it (AN-3
        // collapses 0-child operators and promotes 1-child non-not
        // operators; multi-child operators are stable). OR also has
        // 2 children so it stays put.
        const { eng, vP, vQ } = makeEngineWithVars("permissive")
        const { result: pe1 } = eng.createPremise()
        const premiseId = pe1.getId()
        pe1.addExpression(opExpr("or-1", "or", null))
        pe1.addExpression(opExpr("and-1", "and", "or-1", 100))
        pe1.addExpression({
            id: "var-1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId,
            type: "variable",
            variableId: vP,
            parentId: "and-1",
            position: 0,
        })
        pe1.addExpression({
            id: "var-2",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId,
            type: "variable",
            variableId: vQ,
            parentId: "and-1",
            position: 1,
        })
        pe1.addExpression({
            id: "var-3",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId,
            type: "variable",
            variableId: vP,
            parentId: "or-1",
            position: 200,
        })

        // Sanity: pre-flip P-1 violation present.
        const preAnd = pe1.getExpressions().find((e) => e.id === "and-1")!
        expect(preAnd.parentId).toBe("or-1")

        // Flip to assistive. setBehavior does NOT auto-normalize per
        // its JSDoc, so the P-1 violation persists until the next
        // mutation triggers the post-hook.
        eng.setBehavior("assistive")
        expect(
            pe1.getExpressions().find((e) => e.id === "and-1")!.parentId
        ).toBe("or-1")

        // Trigger the post-hook via an unrelated mutation on a
        // fresh premise. A variable expression doesn't engage AN-3
        // (variables aren't operators), so the trigger itself is
        // AN-inert; the post-hook's global sweep then catches the
        // P-1 violation in pe1 and AN-1 inserts the buffer.
        const { result: pe2 } = eng.createPremise()
        pe2.addExpression({
            id: "trigger-var",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: pe2.getId(),
            type: "variable",
            variableId: vP,
            parentId: null,
            position: 0,
        })

        // Post-hook fired in pe1: AN-1 inserted a formula buffer
        // between OR and AND.
        const exprs = pe1.getExpressions()
        const and = exprs.find((e) => e.id === "and-1")!
        expect(and.parentId).not.toBe("or-1")
        const formulaBetween = exprs.find(
            (e) => e.type === "formula" && e.parentId === "or-1"
        )
        expect(formulaBetween).toBeDefined()
        expect(and.parentId).toBe(formulaBetween!.id)
    })

    it("assistive mode: post-hook AN-1 buffers a XOR under an OR and the buffer survives", () => {
        // Same shape as the AND-under-OR case, with XOR as the inner
        // operator. AN-1 must insert the buffer, and the AN pass must
        // then settle: a buffer AN-3 does not recognize as justified is
        // stripped and re-inserted until the convergence cap throws.
        const { eng, vP, vQ } = makeEngineWithVars("permissive")
        const { result: pe1 } = eng.createPremise()
        const premiseId = pe1.getId()
        pe1.addExpression(opExpr("or-1", "or", null))
        pe1.addExpression(opExpr("xor-1", "xor", "or-1", 100))
        pe1.addExpression({
            id: "var-1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId,
            type: "variable",
            variableId: vP,
            parentId: "xor-1",
            position: 0,
        })
        pe1.addExpression({
            id: "var-2",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId,
            type: "variable",
            variableId: vQ,
            parentId: "xor-1",
            position: 1,
        })
        pe1.addExpression({
            id: "var-3",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId,
            type: "variable",
            variableId: vP,
            parentId: "or-1",
            position: 200,
        })

        expect(
            pe1.getExpressions().find((e) => e.id === "xor-1")!.parentId
        ).toBe("or-1")

        eng.setBehavior("assistive")

        const { result: pe2 } = eng.createPremise()
        expect(() =>
            pe2.addExpression({
                id: "trigger-var",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                premiseId: pe2.getId(),
                type: "variable",
                variableId: vP,
                parentId: null,
                position: 0,
            })
        ).not.toThrow()

        const exprs = pe1.getExpressions()
        const xor = exprs.find((e) => e.id === "xor-1")!
        const formulaBetween = exprs.find(
            (e) => e.type === "formula" && e.parentId === "or-1"
        )
        expect(formulaBetween).toBeDefined()
        expect(xor.parentId).toBe(formulaBetween!.id)
        // Both operands stayed under the XOR.
        expect(
            exprs
                .filter((e) => e.parentId === "xor-1")
                .map((e) => e.id)
                .sort()
        ).toEqual(["var-1", "var-2"])
    })

    it("permissive mode: AND under OR is allowed with no formula buffer", () => {
        const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
            behavior: "permissive",
        })
        const { result: pe } = eng.createPremise()

        pe.addExpression(opExpr("or-1", "or", null))
        // In permissive mode no AN post-hook runs: the OR retains
        // its 0-child shape, the AND-under-OR mutation is accepted
        // unchanged, and no formula buffer is inserted.
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
        // Build OR(AND(VAR_P, VAR_Q), VAR_P) in permissive — AND
        // directly under OR is a P-1 violation; the AND has 2
        // variable children so AN-3 won't collapse it.
        const { eng, vP, vQ } = makeEngineWithVars("permissive")
        const { result: pe1 } = eng.createPremise()
        const premiseId = pe1.getId()
        pe1.addExpression(opExpr("or-1", "or", null))
        pe1.addExpression(opExpr("and-1", "and", "or-1", 100))
        pe1.addExpression({
            id: "var-1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId,
            type: "variable",
            variableId: vP,
            parentId: "and-1",
            position: 0,
        })
        pe1.addExpression({
            id: "var-2",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId,
            type: "variable",
            variableId: vQ,
            parentId: "and-1",
            position: 1,
        })
        pe1.addExpression({
            id: "var-3",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId,
            type: "variable",
            variableId: vP,
            parentId: "or-1",
            position: 200,
        })

        // Pre-flip state: AND directly under OR (P-1 violation
        // persists; permissive does not normalize).
        expect(
            pe1.getExpressions().find((e) => e.id === "and-1")!.parentId
        ).toBe("or-1")

        // Switch to assistive. The flip itself does not auto-run
        // normalize() (per setBehavior JSDoc) — the existing P-1
        // violation stays put until the next mutation triggers the
        // post-hook.
        eng.setBehavior("assistive")
        expect(
            pe1.getExpressions().find((e) => e.id === "and-1")!.parentId
        ).toBe("or-1")

        // Trigger the post-hook via an AN-inert mutation (variable
        // expression on a fresh premise). The global AN sweep finds
        // the pre-existing P-1 violation and AN-1 inserts the
        // formula buffer.
        const { result: pe2 } = eng.createPremise()
        pe2.addExpression({
            id: "trigger-var",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: pe2.getId(),
            type: "variable",
            variableId: vP,
            parentId: null,
            position: 0,
        })

        const exprs = pe1.getExpressions()
        const and = exprs.find((e) => e.id === "and-1")!
        expect(and.parentId).not.toBe("or-1")
        const buffer = exprs.find(
            (e) => e.type === "formula" && e.id === and.parentId
        )
        expect(buffer).toBeDefined()
        expect(buffer!.parentId).toBe("or-1")
    })

    it("setBehavior(assistive → permissive) disarms AN on subsequent mutations", () => {
        // Build OR(AND(VAR_P, VAR_Q), VAR_P) in permissive — P-1
        // violation present. Flip to assistive, observe AN runs on
        // the next mutation. Then flip back to permissive, introduce
        // a second P-1 violation, observe AN does NOT run.
        const { eng, vP, vQ } = makeEngineWithVars("permissive")
        const { result: pe1 } = eng.createPremise()
        const premiseId = pe1.getId()
        pe1.addExpression(opExpr("or-1", "or", null))
        pe1.addExpression(opExpr("and-1", "and", "or-1", 100))
        pe1.addExpression({
            id: "var-1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId,
            type: "variable",
            variableId: vP,
            parentId: "and-1",
            position: 0,
        })
        pe1.addExpression({
            id: "var-2",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId,
            type: "variable",
            variableId: vQ,
            parentId: "and-1",
            position: 1,
        })
        pe1.addExpression({
            id: "var-3",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId,
            type: "variable",
            variableId: vP,
            parentId: "or-1",
            position: 200,
        })

        // Flip to assistive + trigger AN. The first P-1 violation
        // is repaired by AN-1.
        eng.setBehavior("assistive")
        const { result: pe2 } = eng.createPremise()
        pe2.addExpression({
            id: "trigger-1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: pe2.getId(),
            type: "variable",
            variableId: vP,
            parentId: null,
            position: 0,
        })
        // Sanity: AN-1 fired.
        expect(
            pe1.getExpressions().find((e) => e.id === "and-1")!.parentId
        ).not.toBe("or-1")
        const buffer1Id = pe1
            .getExpressions()
            .find((e) => e.id === "and-1")!.parentId

        // Flip to permissive. Introduce a SECOND P-1 violation by
        // adding another AND-with-children directly under OR. The
        // post-hook does NOT run in permissive, so this second
        // violation stays put.
        eng.setBehavior("permissive")
        pe1.addExpression(opExpr("and-2", "and", "or-1", 400))
        pe1.addExpression({
            id: "var-4",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId,
            type: "variable",
            variableId: vP,
            parentId: "and-2",
            position: 0,
        })
        pe1.addExpression({
            id: "var-5",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId,
            type: "variable",
            variableId: vQ,
            parentId: "and-2",
            position: 1,
        })

        // and-2 still sits directly under OR; AN-1 has not fired on
        // it. (The previous buffer from the first P-1 repair is
        // unrelated and unchanged.)
        const exprs = pe1.getExpressions()
        const and2 = exprs.find((e) => e.id === "and-2")!
        expect(and2.parentId).toBe("or-1")
        // The existing buffer1 from the assistive-mode repair is
        // still present (it doesn't disappear just because we
        // flipped to permissive).
        expect(exprs.find((e) => e.id === buffer1Id)).toBeDefined()
    })

    it("createPremise() after setBehavior('permissive') inherits permissive config", () => {
        // setBehavior() propagates to PEs that already exist, but PEs
        // created AFTER the switch must also inherit the new behavior.
        // This test exercises a brand-new PE
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
        // Sanity: the assistive path for newly-created PEs is
        // exercised by the first test in this describe block; make
        // the matched-pair assertion explicit. Same permissive-build
        // + flip-to-assistive + trigger-mutation pattern as the
        // first test, but the engine starts in DEFAULT (assistive)
        // mode and we have to flip to permissive for the build then
        // back to assistive.
        const claimLib = new ClaimLibrary()
        claimLib.create({ id: "claim-p", type: "normal" })
        claimLib.create({ id: "claim-q", type: "normal" })
        const eng = new ArgumentEngine(ARG, claimLib)
        expect(eng.behavior).toBe("assistive")
        eng.addVariable({
            id: "v-p",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "P",
            claimId: "claim-p",
            claimVersion: 0,
        })
        eng.addVariable({
            id: "v-q",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "Q",
            claimId: "claim-q",
            claimVersion: 0,
        })

        eng.setBehavior("permissive")
        const { result: pe1 } = eng.createPremise()
        const premiseId = pe1.getId()
        pe1.addExpression(opExpr("or-1", "or", null))
        pe1.addExpression(opExpr("and-1", "and", "or-1", 100))
        pe1.addExpression({
            id: "var-1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId,
            type: "variable",
            variableId: "v-p",
            parentId: "and-1",
            position: 0,
        })
        pe1.addExpression({
            id: "var-2",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId,
            type: "variable",
            variableId: "v-q",
            parentId: "and-1",
            position: 1,
        })
        pe1.addExpression({
            id: "var-3",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId,
            type: "variable",
            variableId: "v-p",
            parentId: "or-1",
            position: 200,
        })

        eng.setBehavior("assistive")
        // Trigger the post-hook in a fresh premise (newly created
        // PEs after setBehavior must inherit assistive). The AN
        // sweep on the trigger mutation finds pe1's P-1 violation
        // and inserts the buffer.
        const { result: pe2 } = eng.createPremise()
        pe2.addExpression({
            id: "trigger-var",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: pe2.getId(),
            type: "variable",
            variableId: "v-p",
            parentId: null,
            position: 0,
        })

        const and = pe1.getExpressions().find((e) => e.id === "and-1")!
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
