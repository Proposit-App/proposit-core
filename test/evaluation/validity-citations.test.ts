import { describe, expect, it } from "vitest"

import { and, buildArgument, implies, v } from "./fixtures.js"

// A citation-backed claim reports what a source says. The default assignment
// has always seeded it `true` alongside an axiom; the validity check used to
// hand it a free column anyway, so a failing case could rest on the source
// saying the opposite of what it says. Validity now gives citations the same
// treatment it gives axioms: out of the enumeration, pinned true.
describe("checkValidity treats a citation as given", () => {
    it("drops the citation's column from the enumeration", () => {
        const withCitation = buildArgument({
            conclusion: implies(and(v("A"), v("C")), v("Q")),
            premises: [implies(v("A"), v("Q"))],
            claimTypes: { C: "citation" },
        })
        const withNormal = buildArgument({
            conclusion: implies(and(v("A"), v("C")), v("Q")),
            premises: [implies(v("A"), v("Q"))],
        })

        const cited = withCitation.engine.checkValidity({ mode: "exhaustive" })
        const normal = withNormal.engine.checkValidity({ mode: "exhaustive" })

        expect(cited.ok).toBe(true)
        expect(normal.ok).toBe(true)
        expect(cited.checkedVariableIds).not.toContain(
            withCitation.variableId("C")
        )
        expect(normal.checkedVariableIds).toContain(withNormal.variableId("C"))
        // One fewer free variable is exactly half the rows.
        expect(cited.numAssignmentsChecked).toBe(
            (normal.numAssignmentsChecked ?? 0) / 2
        )
    })

    it("never reports a failing case in which the cited claim is false", () => {
        // `(C ∧ A) → Q` fails wherever Q is false and the antecedent does not
        // hold. Three of those rows exist while C is a free column and two of
        // them get there by setting the cited claim false — the failing cases
        // this fix exists to stop reporting. One row survives with C given, so
        // the assertion is about *which* cases are found, not about finding
        // none.
        const built = buildArgument({
            conclusion: v("Q"),
            premises: [implies(and(v("C"), v("A")), v("Q"))],
            claimTypes: { C: "citation" },
        })

        const result = built.engine.checkValidity({ mode: "exhaustive" })

        expect(result.ok).toBe(true)
        const counterexamples = result.counterexamples ?? []
        expect(counterexamples.length).toBeGreaterThan(0)
        const citationVariableId = built.variableId("C")
        for (const counterexample of counterexamples) {
            expect(counterexample.assignment.variables[citationVariableId]).toBe(
                true
            )
        }
    })

    it("finds an argument valid whose only counterexample needed the citation false", () => {
        // `C → Q` with `C` cited: the sole row that breaks it is C true, Q
        // false — reachable only because nothing forces Q. Add the citation as
        // the antecedent of the supporting step and the argument holds for
        // every row a given citation permits.
        const built = buildArgument({
            conclusion: v("Q"),
            premises: [implies(v("C"), v("Q"))],
            claimTypes: { C: "citation" },
        })

        const result = built.engine.checkValidity({ mode: "exhaustive" })

        expect(result.ok).toBe(true)
        expect(result.isValid).toBe(true)
        expect(result.counterexamples ?? []).toHaveLength(0)
    })
})
