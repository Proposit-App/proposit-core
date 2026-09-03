// Mutations enforce Structural rules and throw on violation
// regardless of `behavior`. Per spec §4, Structural is the floor —
// even permissive engines reject Structural violations at mutation
// time. Only Evaluable / Derivable / Presentable violations are
// allowed to surface via validate(tier) without throwing.
//
// These tests assert each S-* rule that the mutation API can violate
// throws in BOTH 'assistive' and 'permissive' modes, locking the
// invariant.

import { describe, it, expect } from "vitest"
import { ArgumentEngine } from "../../src/lib/core/argument-engine.js"
import { ClaimLibrary } from "../../src/lib/core/claim-library.js"
import { EMPTY_CLAIM_LOOKUP } from "../../src/lib/utils/lookup.js"
import type { TExpressionInput } from "../../src/lib/core/expression-manager.js"
import type { TCoreLogicalOperatorType } from "../../src/lib/schemata/index.js"
import { makeArgument } from "./fixtures.js"

const ARG = makeArgument()

function opExpr(
    id: string,
    operator: TCoreLogicalOperatorType,
    parentId: string | null,
    premiseId: string,
    position = 0
): TExpressionInput {
    return {
        id,
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        premiseId,
        type: "operator",
        operator,
        parentId,
        position,
    }
}

function varExpr(
    id: string,
    variableId: string,
    parentId: string | null,
    premiseId: string,
    position = 0
): TExpressionInput {
    return {
        id,
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        premiseId,
        type: "variable",
        variableId,
        parentId,
        position,
    }
}

describe("Mutations throw on Structural violations", () => {
    // Test setup uses the permissive-build + setBehavior(assistive)
    // pattern. The Structural-rule contract is "mutations throw on
    // Structural violations regardless of `behavior`" (spec §8). With
    // the new AN post-mutation hook (assistive mode), the eager AN-3
    // collapse of 0-child operators would tear down the partial tree
    // the test is constructing before the violating mutation can fire.
    // To exercise the Structural enforcement in both modes, we build
    // the valid tree in permissive (no AN), flip to the desired
    // behavior, then attempt the violating mutation. The throw must
    // fire regardless of mode.

    describe("S-8 — Binary operator arity (implies/iff have exactly 2 children)", () => {
        for (const behavior of ["assistive", "permissive"] as const) {
            it(`throws in ${behavior} mode when adding a 3rd child under IMPLIES`, () => {
                const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
                    behavior: "permissive",
                })
                const { result: pe } = eng.createPremise()
                const id = pe.getId()
                pe.addExpression(opExpr("imp-1", "implies", null, id))
                // First two children OK.
                pe.addExpression(opExpr("c-0", "and", "imp-1", id, 0))
                pe.addExpression(opExpr("c-1", "or", "imp-1", id, 1))
                // Flip to the test's target behavior before the
                // violating mutation. The Structural check is
                // mode-independent — must throw whether we're
                // assistive or permissive.
                eng.setBehavior(behavior)
                // Third child rejected.
                expect(() =>
                    pe.addExpression(opExpr("c-2", "and", "imp-1", id, 2))
                ).toThrow()
            })
        }
    })

    describe("S-9 — Sibling position uniqueness", () => {
        for (const behavior of ["assistive", "permissive"] as const) {
            it(`throws in ${behavior} mode when two children share a position`, () => {
                const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
                    behavior: "permissive",
                })
                const { result: pe } = eng.createPremise()
                const id = pe.getId()
                pe.addExpression(opExpr("and-1", "and", null, id))
                // Use NOT children to bypass the operator-under-operator check
                // entirely (NOT is allowed as direct child of an operator).
                pe.addExpression(opExpr("not-0", "not", "and-1", id, 0))
                eng.setBehavior(behavior)
                expect(() =>
                    pe.addExpression(opExpr("not-x", "not", "and-1", id, 0))
                ).toThrow(/already used/)
            })
        }
    })

    describe("S-12 — NOT unary arity (exactly 1 child)", () => {
        for (const behavior of ["assistive", "permissive"] as const) {
            it(`throws in ${behavior} mode when adding a 2nd child under NOT`, () => {
                const claimLib = new ClaimLibrary()
                claimLib.create({ id: "claim-p", type: "normal" })
                claimLib.create({ id: "claim-q", type: "normal" })
                const eng = new ArgumentEngine(ARG, claimLib, {
                    behavior: "permissive",
                })
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
                const { result: pe } = eng.createPremise()
                const id = pe.getId()
                pe.addExpression(opExpr("not-1", "not", null, id))
                pe.addExpression(varExpr("v-1", "v-p", "not-1", id, 0))
                eng.setBehavior(behavior)
                expect(() =>
                    pe.addExpression(varExpr("v-2", "v-q", "not-1", id, 1))
                ).toThrow(/one child/)
            })
        }
    })

    describe("S-13 — Formula unary arity (exactly 1 child)", () => {
        for (const behavior of ["assistive", "permissive"] as const) {
            it(`throws in ${behavior} mode when adding a 2nd child under a formula`, () => {
                const claimLib = new ClaimLibrary()
                claimLib.create({ id: "claim-p", type: "normal" })
                claimLib.create({ id: "claim-q", type: "normal" })
                const eng = new ArgumentEngine(ARG, claimLib, {
                    behavior: "permissive",
                })
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
                const { result: pe } = eng.createPremise()
                const id = pe.getId()
                pe.addExpression({
                    id: "f-1",
                    argumentId: ARG.id,
                    argumentVersion: ARG.version,
                    premiseId: id,
                    type: "formula",
                    parentId: null,
                    position: 0,
                })
                pe.addExpression(varExpr("v-1", "v-p", "f-1", id, 0))
                eng.setBehavior(behavior)
                expect(() =>
                    pe.addExpression(varExpr("v-2", "v-q", "f-1", id, 1))
                ).toThrow(/one child/)
            })
        }
    })

    describe("S-14 — Derivation premise root operator (variable, implies, iff)", () => {
        for (const behavior of ["assistive", "permissive"] as const) {
            it(`throws in ${behavior} mode when adding an AND root to a derivation premise`, () => {
                const claimLib = new ClaimLibrary()
                claimLib.create({ id: "claim-Q", type: "normal" })
                // Build the empty derivation premise in permissive
                // (avoids AN-3 colliding with the removeExpression of
                // the auto-created naked-Q root); flip to the target
                // behavior before the violating mutation.
                const eng = new ArgumentEngine(ARG, claimLib, {
                    behavior: "permissive",
                })
                const { result: pe } = eng.createPremise({
                    type: "derivation",
                    derivedClaimId: "claim-Q",
                })
                const id = pe.getId()
                // The naked-Q root expression already exists; remove it so we
                // can attempt to add an AND root (the test of S-14 itself).
                const autoQ = pe.getRootExpression()
                if (autoQ !== undefined) {
                    pe.removeExpression(autoQ.id, true)
                }
                eng.setBehavior(behavior)
                // Adding an AND root to a derivation premise must throw — S-14
                // restricts derivation roots to variable / implies / iff.
                expect(() =>
                    pe.addExpression(opExpr("and-root", "and", null, id))
                ).toThrow()
            })
        }
    })
})

// -- Operator swap arity classes --
//
// `updateExpression({ operator })` may only move an operator to another
// operator of the same arity class: variadic (`and`, `or`, `xor`) or
// binary (`implies`, `iff`). `not` is unary and belongs to neither, so
// it can neither be swapped away from nor swapped to.

const ALL_OPERATORS: TCoreLogicalOperatorType[] = [
    "not",
    "and",
    "or",
    "xor",
    "implies",
    "iff",
]

// The ordered pairs permitted before `xor` existed. None of these may
// stop being permitted — widening the rule must lose nothing.
const PERMITTED_BEFORE_XOR = [
    "and->or",
    "or->and",
    "implies->iff",
    "iff->implies",
] as const

// The ordered pairs `xor` adds, and the only ones it may add.
const PERMITTED_ADDED_BY_XOR = [
    "and->xor",
    "xor->and",
    "or->xor",
    "xor->or",
] as const

const EXPECTED_PERMITTED_SWAPS = new Set<string>([
    ...PERMITTED_BEFORE_XOR,
    ...PERMITTED_ADDED_BY_XOR,
])

/**
 * Builds a fresh premise whose root is `from` (with the children that
 * operator legally takes) and attempts to swap it to `to`.
 */
function attemptOperatorSwap(
    from: TCoreLogicalOperatorType,
    to: TCoreLogicalOperatorType
): { permitted: boolean; message: string } {
    const claimLib = new ClaimLibrary()
    claimLib.create({ id: "claim-p", type: "normal" })
    claimLib.create({ id: "claim-q", type: "normal" })
    const eng = new ArgumentEngine(ARG, claimLib, { behavior: "permissive" })
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
    const { result: pe } = eng.createPremise()
    const premiseId = pe.getId()
    pe.addExpression(opExpr("op-1", from, null, premiseId))
    pe.addExpression(varExpr("x-1", "v-p", "op-1", premiseId, 0))
    if (from !== "not") {
        pe.addExpression(varExpr("x-2", "v-q", "op-1", premiseId, 1))
    }
    try {
        pe.updateExpression("op-1", { operator: to })
        return { permitted: true, message: "" }
    } catch (error) {
        return { permitted: false, message: (error as Error).message }
    }
}

describe("Operator swaps are permitted within an arity class", () => {
    it("permits exactly the pre-xor set plus the xor pairs, over every ordered pair", () => {
        const permitted: string[] = []
        for (const from of ALL_OPERATORS) {
            for (const to of ALL_OPERATORS) {
                if (from === to) continue
                if (attemptOperatorSwap(from, to).permitted) {
                    permitted.push(`${from}->${to}`)
                }
            }
        }
        expect(new Set(permitted)).toEqual(EXPECTED_PERMITTED_SWAPS)
    })

    it("keeps every swap that was permitted before xor existed", () => {
        for (const pair of PERMITTED_BEFORE_XOR) {
            const [from, to] = pair.split("->") as [
                TCoreLogicalOperatorType,
                TCoreLogicalOperatorType,
            ]
            expect({
                pair,
                permitted: attemptOperatorSwap(from, to).permitted,
            }).toEqual({ pair, permitted: true })
        }
    })

    it("permits or -> and, which a one-successor-per-operator table would refuse", () => {
        expect(attemptOperatorSwap("or", "and").permitted).toBe(true)
    })

    it("permits xor against both other variadic operators in both directions", () => {
        for (const pair of PERMITTED_ADDED_BY_XOR) {
            const [from, to] = pair.split("->") as [
                TCoreLogicalOperatorType,
                TCoreLogicalOperatorType,
            ]
            expect({
                pair,
                permitted: attemptOperatorSwap(from, to).permitted,
            }).toEqual({ pair, permitted: true })
        }
    })

    it("refuses every swap that crosses the variadic / binary boundary", () => {
        const variadic: TCoreLogicalOperatorType[] = ["and", "or", "xor"]
        const binary: TCoreLogicalOperatorType[] = ["implies", "iff"]
        for (const v of variadic) {
            for (const b of binary) {
                expect({
                    pair: `${v}->${b}`,
                    permitted: attemptOperatorSwap(v, b).permitted,
                }).toEqual({ pair: `${v}->${b}`, permitted: false })
                expect({
                    pair: `${b}->${v}`,
                    permitted: attemptOperatorSwap(b, v).permitted,
                }).toEqual({ pair: `${b}->${v}`, permitted: false })
            }
        }
    })

    it("leaves not unswappable in both directions", () => {
        for (const other of ALL_OPERATORS) {
            if (other === "not") continue
            expect({
                pair: `not->${other}`,
                permitted: attemptOperatorSwap("not", other).permitted,
            }).toEqual({ pair: `not->${other}`, permitted: false })
            expect({
                pair: `${other}->not`,
                permitted: attemptOperatorSwap(other, "not").permitted,
            }).toEqual({ pair: `${other}->not`, permitted: false })
        }
    })

    it("names the arity classes in the refusal message, without claiming a fixed pair list", () => {
        const { message } = attemptOperatorSwap("and", "implies")
        expect(message).toContain('from "and" to "implies"')
        expect(message).toContain("and, or, xor")
        expect(message).toContain("implies, iff")
        expect(message).toContain("not")
        expect(message).not.toContain("Permitted: and↔or, implies↔iff.")
    })
})

describe("xor takes the variadic child limit", () => {
    /** Builds a premise rooted at `xor` with `childCount` variable children. */
    function addXorChildren(childCount: number): () => void {
        const claimLib = new ClaimLibrary()
        const eng = new ArgumentEngine(ARG, claimLib, {
            behavior: "permissive",
        })
        for (let i = 0; i < childCount; i++) {
            claimLib.create({ id: `claim-${i}`, type: "normal" })
            eng.addVariable({
                id: `v-${i}`,
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                symbol: `S${i}`,
                claimId: `claim-${i}`,
                claimVersion: 0,
            })
        }
        const { result: pe } = eng.createPremise()
        const premiseId = pe.getId()
        pe.addExpression(opExpr("xor-1", "xor", null, premiseId))
        return () => {
            for (let i = 0; i < childCount; i++) {
                pe.addExpression(
                    varExpr(`x-${i}`, `v-${i}`, "xor-1", premiseId, i)
                )
            }
        }
    }

    for (const childCount of [2, 3, 4]) {
        it(`accepts ${childCount} children under xor`, () => {
            expect(addXorChildren(childCount)).not.toThrow()
        })
    }

    it("does not cap xor at two children the way iff is capped", () => {
        const claimLib = new ClaimLibrary()
        const eng = new ArgumentEngine(ARG, claimLib, {
            behavior: "permissive",
        })
        const { result: pe } = eng.createPremise()
        const premiseId = pe.getId()
        pe.addExpression(opExpr("iff-1", "iff", null, premiseId))
        pe.addExpression(opExpr("n-0", "not", "iff-1", premiseId, 0))
        pe.addExpression(opExpr("n-1", "not", "iff-1", premiseId, 1))
        expect(() =>
            pe.addExpression(opExpr("n-2", "not", "iff-1", premiseId, 2))
        ).toThrow(/two children/)
    })

    it("defers the >= 2 floor to the Evaluable tier rather than throwing at mutation time", () => {
        const claimLib = new ClaimLibrary()
        claimLib.create({ id: "claim-p", type: "normal" })
        const eng = new ArgumentEngine(ARG, claimLib, {
            behavior: "permissive",
        })
        eng.addVariable({
            id: "v-p",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "P",
            claimId: "claim-p",
            claimVersion: 0,
        })
        const { result: pe } = eng.createPremise()
        const premiseId = pe.getId()
        pe.addExpression(opExpr("xor-1", "xor", null, premiseId))
        // One child: legal to build, illegal to evaluate.
        expect(() =>
            pe.addExpression(varExpr("x-0", "v-p", "xor-1", premiseId, 0))
        ).not.toThrow()
        const underfilled = eng
            .validate("evaluable")
            .filter((v) => v.code === "E-1" && v.expressionId === "xor-1")
        expect(underfilled.length).toBe(1)
    })
})
