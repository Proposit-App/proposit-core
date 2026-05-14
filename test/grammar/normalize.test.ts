// C3: ArgumentEngine.normalize(tier?) global pass tests.
//
// Per spec §6 (and CLAUDE.md "Key design rules"):
//   - normalize() is an explicit user-initiated global pass that runs the
//     AN rule set everywhere it can fire. It DOES NOT auto-fire on
//     `setBehavior('permissive' → 'assistive')`; the UI prompts the user.
//   - In v1.0 every AN rule (AN-1..AN-4) targets a Presentable invariant,
//     so calls with `tier` ∈ {structural, evaluable, derivable} are
//     effectively no-ops; the parameter is forward-compatible API surface.
//   - Non-destructive in the logical-meaning sense: never deletes a
//     variable, changes a claim reference, or modifies operator semantics.
//   - Cannot recover from Evaluable / Derivable violations (those require
//     user intent via repair primitives — Phase C4).
//   - Bypasses `behavior`: a user clicking "Tidy" in a permissive-mode
//     engine still expects cleanup to run.

import { describe, it, expect } from "vitest"
import { ArgumentEngine } from "../../src/lib/core/argument-engine.js"
import { EMPTY_CLAIM_LOOKUP } from "../../src/lib/utils/lookup.js"
import type { TExpressionInput } from "../../src/lib/core/expression-manager.js"
import type { TCorePropositionalExpression } from "../../src/lib/schemata/index.js"
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
        premiseId: "normalize-test",
        type: "operator",
        operator,
        parentId,
        position,
    }
}

/**
 * Returns true iff any non-`not` operator sits directly under another
 * operator without an intervening formula buffer — the P-1 violation
 * shape.
 */
function hasP1Violation(exprs: TCorePropositionalExpression[]): boolean {
    const byId = new Map(exprs.map((e) => [e.id, e]))
    return exprs.some((child) => {
        if (child.type !== "operator" || child.operator === "not") return false
        if (child.parentId === null) return false
        const parent = byId.get(child.parentId)
        return parent?.type === "operator"
    })
}

describe("ArgumentEngine.normalize(tier?)", () => {
    it("defaults tier to 'presentable' and cleans up a P-1 violation", () => {
        // Build a tree with a P-1 violation (AND direct child of OR) under
        // permissive mode so AN is disarmed at mutation time.
        const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
            behavior: "permissive",
        })
        const { result: pe } = eng.createPremise()
        pe.addExpression(opExpr("or-1", "or", null))
        pe.addExpression(opExpr("and-1", "and", "or-1"))

        // Pre-call: the violation is present.
        expect(hasP1Violation(pe.getExpressions())).toBe(true)

        // No-arg normalize() defaults to 'presentable'.
        eng.normalize()

        // Post-call: the violation is gone.
        expect(hasP1Violation(pe.getExpressions())).toBe(false)
    })

    it("normalize('derivable') is a no-op in v1.0 (forward-compat)", () => {
        const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
            behavior: "permissive",
        })
        const { result: pe } = eng.createPremise()
        pe.addExpression(opExpr("or-1", "or", null))
        pe.addExpression(opExpr("and-1", "and", "or-1"))

        // Snapshot expression IDs + parents before the call.
        const before = pe
            .getExpressions()
            .map((e) => `${e.id}@${e.parentId ?? "root"}`)
            .sort()

        eng.normalize("derivable")

        const after = pe
            .getExpressions()
            .map((e) => `${e.id}@${e.parentId ?? "root"}`)
            .sort()

        expect(after).toEqual(before)
        // And the P-1 violation is still there — proof normalize() didn't
        // fire AN.
        expect(hasP1Violation(pe.getExpressions())).toBe(true)
    })

    it("normalize('evaluable') and normalize('structural') are also no-ops in v1.0", () => {
        const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
            behavior: "permissive",
        })
        const { result: pe } = eng.createPremise()
        pe.addExpression(opExpr("or-1", "or", null))
        pe.addExpression(opExpr("and-1", "and", "or-1"))

        const snap = (): string[] =>
            pe
                .getExpressions()
                .map((e) => `${e.id}@${e.parentId ?? "root"}`)
                .sort()

        const before = snap()

        eng.normalize("evaluable")
        expect(snap()).toEqual(before)

        eng.normalize("structural")
        expect(snap()).toEqual(before)
    })

    it("runs cleanup even when behavior is 'permissive' (user-initiated bypass)", () => {
        // Critical: normalize() is what the UI calls after the user
        // confirms. Even in permissive mode, normalize() must do its job.
        const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
            behavior: "permissive",
        })
        const { result: pe } = eng.createPremise()
        pe.addExpression(opExpr("or-1", "or", null))
        pe.addExpression(opExpr("and-1", "and", "or-1"))

        eng.normalize("presentable")

        // After normalize, the P-1 violation must be gone.
        expect(hasP1Violation(pe.getExpressions())).toBe(false)
    })

    it("restores the engine's behavior after running (idempotent w.r.t. behavior)", () => {
        // normalize() may need to temporarily route through default-config
        // grammar internally, but the engine's observable `behavior` must
        // be unchanged after the call returns.
        const engPermissive = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
            behavior: "permissive",
        })
        engPermissive.normalize()
        expect(engPermissive.behavior).toBe("permissive")

        const engAssistive = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
            behavior: "assistive",
        })
        engAssistive.normalize()
        expect(engAssistive.behavior).toBe("assistive")
    })

    it("preserves permissive behavior on subsequent mutations after normalize()", () => {
        // After normalize() returns, subsequent mutations on a permissive
        // engine must still go through unchecked (no AN). This guards
        // against a buggy implementation that flips PE configs to default
        // and forgets to restore them.
        const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
            behavior: "permissive",
        })
        const { result: pe } = eng.createPremise()

        eng.normalize()

        // Now mutate — AND under OR should land directly (P-1 violation
        // permitted, no buffer inserted, no throw).
        pe.addExpression(opExpr("or-1", "or", null))
        pe.addExpression(opExpr("and-1", "and", "or-1"))

        const and = pe.getExpressions().find((e) => e.id === "and-1")!
        expect(and.parentId).toBe("or-1")
        const buffer = pe
            .getExpressions()
            .find((e) => e.type === "formula" && e.parentId === "or-1")
        expect(buffer).toBeUndefined()
    })

    it("does not throw on a trivially-violating tree (E-1: AND with 0 children)", () => {
        // normalize() handles whatever it can without crashing. Recovery
        // from Evaluable violations is the repair primitives' job (C4).
        const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
            behavior: "permissive",
        })
        const { result: pe } = eng.createPremise()
        pe.addExpression(opExpr("and-root", "and", null))

        expect(() => eng.normalize()).not.toThrow()
    })

    it("is safe to call on an empty engine (no premises)", () => {
        const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP)
        expect(() => eng.normalize()).not.toThrow()
        expect(() => eng.normalize("presentable")).not.toThrow()
        expect(() => eng.normalize("derivable")).not.toThrow()
    })
})
