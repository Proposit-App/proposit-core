// C5: Mutations enforce Structural rules and throw on violation
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
import { makeArgument } from "./fixtures.js"

const ARG = makeArgument()

function opExpr(
    id: string,
    operator: "not" | "and" | "or" | "implies" | "iff",
    parentId: string | null,
    premiseId: string,
    position: number = 0
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
    position: number = 0
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

describe("Mutations throw on Structural violations (C5)", () => {
    describe("S-8 — Binary operator arity (implies/iff have exactly 2 children)", () => {
        for (const behavior of ["assistive", "permissive"] as const) {
            it(`throws in ${behavior} mode when adding a 3rd child under IMPLIES`, () => {
                const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
                    behavior,
                })
                const { result: pe } = eng.createPremise()
                const id = pe.getId()
                pe.addExpression(opExpr("imp-1", "implies", null, id))
                // First two children OK.
                pe.addExpression(opExpr("c-0", "and", "imp-1", id, 0))
                pe.addExpression(opExpr("c-1", "or", "imp-1", id, 1))
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
                    behavior,
                })
                const { result: pe } = eng.createPremise()
                const id = pe.getId()
                pe.addExpression(opExpr("and-1", "and", null, id))
                // Use NOT children to bypass the operator-under-operator check
                // entirely (NOT is allowed as direct child of an operator).
                pe.addExpression(opExpr("not-0", "not", "and-1", id, 0))
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
                const { result: pe } = eng.createPremise()
                const id = pe.getId()
                pe.addExpression(opExpr("not-1", "not", null, id))
                pe.addExpression(varExpr("v-1", "v-p", "not-1", id, 0))
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
                const eng = new ArgumentEngine(ARG, claimLib, { behavior })
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
                // Adding an AND root to a derivation premise must throw — S-14
                // restricts derivation roots to variable / implies / iff.
                //
                // NOTE: The pre-1.0 enforcement of this lived in
                // ManagedDerivationPremiseEngine. The C-phase code path is the
                // regular PremiseEngine, which does not (yet) check S-14 at
                // mutation time — that's exactly the gap this test asserts
                // against. C5 plugs it.
                expect(() =>
                    pe.addExpression(opExpr("and-root", "and", null, id))
                ).toThrow()
            })
        }
    })
})
