import { describe, it } from "vitest"

// Per-rule scaffolds for Structural-tier validators (S-1..S-14).
// Real assertions land in Phase B1 — one test at a time via the canonical
// TDD pattern in docs/superpowers/plans/grammar-tiers-core-plan.md.

describe("grammar/structural", () => {
    describe("S-1 FK soundness", () => {
        it.todo(
            "returns a violation when expression.parentId points at a missing expression"
        )
        it.todo(
            "returns a violation when variable.boundPremiseId points at a missing premise"
        )
        it.todo(
            "returns a violation when claim-bound variable.claimId points at a missing claim"
        )
        it.todo("returns an empty array when every FK resolves")
    })

    describe("S-2 operator types", () => {
        it.todo(
            "returns a violation when expression.type is not one of the allowed discriminators"
        )
        it.todo("returns an empty array for every legal operator type")
    })

    describe("S-3 variable required reference", () => {
        it.todo(
            "returns a violation when a variable has neither claim ref nor premise ref"
        )
        it.todo(
            "returns a violation when a variable has both claim ref and premise ref"
        )
        it.todo(
            "returns an empty array when exactly one of the two refs is present"
        )
    })

    describe("S-4 no cycles", () => {
        it.todo(
            "returns a violation when the expression tree of a premise has a cycle"
        )
        it.todo(
            "returns a violation when the argument's claim/citation/axiom graph has a cycle"
        )
        it.todo("returns an empty array for acyclic graphs")
    })

    describe("S-5 root-only IMPLIES/IFF", () => {
        it.todo("returns a violation when implies appears as a non-root child")
        it.todo("returns a violation when iff appears as a non-root child")
        it.todo(
            "returns a violation when a premise has more than one implies/iff at root"
        )
        it.todo(
            "returns an empty array when implies/iff is exactly at root and there is at most one per premise"
        )
    })

    describe("S-6 premise type discriminator consistency", () => {
        it.todo(
            "returns a violation when type='derivation' premise has null derivedClaimId"
        )
        it.todo(
            "returns a violation when type='freeform' premise has non-null derivedClaimId"
        )
        it.todo(
            "returns an empty array for consistent type+derivedClaimId pairs"
        )
    })

    describe("S-7 claim type immutability", () => {
        // S-7 is a creation-time invariant enforced by ClaimLibrary; the
        // validator is a no-op at the AST level. The test confirms it.
        it.todo(
            "validateS7 returns an empty array for any context (rule is creation-time only)"
        )
    })

    describe("S-8 binary operator arity + positions", () => {
        it.todo("returns a violation when implies has != 2 children")
        it.todo("returns a violation when iff has != 2 children")
        it.todo(
            "returns a violation when implies children are not at positions 0 and 1"
        )
        it.todo(
            "returns a violation when iff children are not at positions 0 and 1"
        )
        it.todo("returns an empty array for IMPLIES(a@0, b@1)")
    })

    describe("S-9 sibling position uniqueness", () => {
        it.todo(
            "returns a violation when two siblings under the same parent share a position value"
        )
        it.todo(
            "returns an empty array when every sibling group has unique positions"
        )
    })

    describe("S-10 entity ID uniqueness", () => {
        it.todo(
            "returns a violation when two premises in the same argument share an ID"
        )
        it.todo(
            "returns a violation when two expressions in the same argument share an ID"
        )
        it.todo(
            "returns a violation when two variables in the same argument share an ID"
        )
        it.todo("returns an empty array when all entity IDs are unique")
    })

    describe("S-11 variable symbol uniqueness", () => {
        it.todo(
            "returns a violation when two variables share a symbol within an argument"
        )
        it.todo("returns an empty array when every variable symbol is unique")
    })

    describe("S-12 NOT unary arity", () => {
        it.todo("returns a violation when a not expression has 0 children")
        it.todo("returns a violation when a not expression has 2 children")
        it.todo("returns an empty array when every not has exactly one child")
    })

    describe("S-13 formula unary arity", () => {
        it.todo("returns a violation when a formula expression has 0 children")
        it.todo("returns a violation when a formula expression has 2+ children")
        it.todo(
            "returns an empty array when every formula has exactly one child"
        )
    })

    describe("S-14 derivation premise root operator", () => {
        it.todo("returns a violation when a derivation premise root is 'and'")
        it.todo("returns a violation when a derivation premise root is 'or'")
        it.todo("returns a violation when a derivation premise root is 'not'")
        it.todo(
            "returns a violation when a derivation premise root is 'formula'"
        )
        it.todo(
            "returns an empty array when the root is 'variable', 'implies', or 'iff'"
        )
    })

    describe("aggregator validateStructural", () => {
        it.todo("concatenates every per-rule validator's output")
    })
})
