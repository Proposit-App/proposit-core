import { describe, it } from "vitest"

// Per-rule scaffolds for Derivable-tier validators (D-1..D-6).
// Real assertions land in Phase B3.

describe("grammar/derivable", () => {
    describe("D-1 derivation premise canonical shape", () => {
        it.todo(
            "accepts naked-Q form (single variable at root bound to derivedClaimId)"
        )
        it.todo(
            "accepts populated form IMPLIES(citation-var, Q) (single citation)"
        )
        it.todo(
            "accepts populated form IMPLIES(OR(citation-vars...), Q) (multi-citation)"
        )
        it.todo(
            "accepts populated form with intervening formula buffer IMPLIES(formula(OR(...)), Q)"
        )
        it.todo("rejects populated form with IFF at root")
        it.todo(
            "rejects populated form where antecedent mixes axioms and citations"
        )
        it.todo(
            "rejects populated form where antecedent is a non-claim variable"
        )
    })

    describe("D-2 single-citation derivation form", () => {
        it.todo(
            "rejects IMPLIES(OR(single-citation-var), Q) — should be IMPLIES(citation-var, Q)"
        )
        it.todo("accepts IMPLIES(citation-var, Q)")
    })

    describe("D-3 no mixing axioms and citations in one derivation", () => {
        it.todo("rejects IMPLIES(OR(axiom-var, citation-var), Q)")
        it.todo("rejects IMPLIES(formula(OR(axiom-var, citation-var)), Q)")
        it.todo("accepts IMPLIES(OR(citation-var, citation-var), Q)")
        it.todo("accepts IMPLIES(OR(axiom-var, axiom-var), Q)")
    })

    describe("D-4 axiomatic claim placement", () => {
        it.todo(
            "rejects axiomatic-bound variable appearing in a freeform premise"
        )
        it.todo(
            "rejects axiomatic-bound variable at the consequent slot of a derivation premise"
        )
        it.todo(
            "accepts axiomatic-bound variable in the antecedent of a derivation premise"
        )
    })

    describe("D-5 citation claim placement", () => {
        it.todo("rejects citation-bound variable in a freeform premise")
        it.todo(
            "rejects citation-bound variable at the consequent slot of a derivation premise"
        )
        it.todo(
            "accepts citation-bound variable in the antecedent of a derivation premise"
        )
    })

    describe("D-6 derivation premise role", () => {
        it.todo("rejects a derivation premise designated as conclusion")
        it.todo("accepts a derivation premise as supporting")
    })

    // D-7 reserved — see spec §4.3. No test block.

    describe("aggregator validateDerivable", () => {
        it.todo("concatenates every per-rule validator's output")
    })
})
