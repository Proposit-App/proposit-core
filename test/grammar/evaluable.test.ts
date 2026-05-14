import { describe, it } from "vitest"

// Per-rule scaffolds for Evaluable-tier validators (E-1, E-3..E-7).
// Real assertions land in Phase B2.

describe("grammar/evaluable", () => {
    describe("E-1 variadic operator arity floor", () => {
        it.todo("returns a violation when 'and' has 0 children")
        it.todo("returns a violation when 'and' has 1 child")
        it.todo("returns a violation when 'or' has 0 children")
        it.todo("returns a violation when 'or' has 1 child")
        it.todo("returns an empty array when 'and' and 'or' have 2+ children")
    })

    // E-2 is reserved — see spec §4.2. No test block.

    describe("E-3 variable binding resolves", () => {
        it.todo(
            "returns a violation when a claim-bound variable references a non-existent claim"
        )
        it.todo(
            "returns a violation when a premise-bound variable references a non-existent premise"
        )
        it.todo("returns an empty array when every binding resolves")
    })

    describe("E-4 axiomatic-binding constraint (no-op at AST level)", () => {
        // E-4 is a runtime guard on caller-supplied evaluation input. The
        // validator cannot detect it from the argument tree alone. Documented
        // in JSDoc; the test confirms ctx-only checker is a no-op.
        it.todo(
            "validateE4 returns an empty array regardless of argument shape (runtime-only guard)"
        )
    })

    describe("E-5 derivation premise consequent present", () => {
        it.todo(
            "returns a violation when a derivation premise tree contains no variable bound to derivedClaimId"
        )
        it.todo(
            "returns an empty array for naked-Q (lone variable at root is the consequent)"
        )
        it.todo(
            "returns an empty array for populated form (consequent at position 1)"
        )
    })

    describe("E-6 claim-derivation pairing", () => {
        it.todo(
            "returns a violation when a normal claim has 2+ derivation premises with matching derivedClaimId"
        )
        it.todo(
            "returns an empty array when a normal claim has 0 derivation premises (post-pruning state)"
        )
        it.todo(
            "returns an empty array when a normal claim has exactly 1 derivation premise (mid-edit state)"
        )
    })

    describe("E-7 argument has conclusion premise", () => {
        it.todo(
            "returns a violation when an argument with premises has no conclusion designated"
        )
        it.todo(
            "returns an empty array for an argument with zero premises (brand-new)"
        )
        it.todo(
            "returns an empty array for an argument with one conclusion premise designated"
        )
    })

    describe("aggregator validateEvaluable", () => {
        it.todo("concatenates every per-rule validator's output")
    })
})
