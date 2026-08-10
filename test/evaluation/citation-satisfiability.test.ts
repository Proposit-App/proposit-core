// A citation reports what its source says, and `checkValidity` already gives it
// that standing. Evaluation asked the satisfiability question the other way —
// citations free — so the same premise set could hold for one entry point and
// contradict itself for the other.
//
// Closing that gap must not close a second one by accident.
// `forcedTrueVariableIds` means three things inside `evaluateArgument`: pinned
// in the satisfiability walk, not a reader's assertion, and out of the
// reached-without-assertion counterfactual. Only the first should take
// citations, because a reader may disagree with a source.

import { describe, it, expect } from "vitest"
import { buildArgument, and, implies, not, v } from "./fixtures.js"

describe("evaluation gives the citation when asking whether the premises hold", () => {
    // A premise set that holds only while the cited claim is false: `C` is
    // citation-backed, and a constraint premise demands `¬C`. With the citation
    // given, the two cannot both stand.
    function contradictedByItsSource() {
        return buildArgument({
            conclusion: v("Q"),
            premises: [implies(v("A"), v("Q")), not(v("C")), v("A")],
            claimTypes: { C: "citation" },
        })
    }

    it("reports the premise set unsatisfiable", () => {
        const built = contradictedByItsSource()

        const result = built.engine.evaluate({
            variables: {},
            operatorAssignments: {},
        })

        expect(result.premiseSetSatisfiable).toBe(false)
    })

    it("agrees with the validity check's own precompute", () => {
        const built = contradictedByItsSource()

        const evaluated = built.engine.evaluate({
            variables: {},
            operatorAssignments: {},
        })
        const validity = built.engine.checkValidity({ mode: "exhaustive" })

        // The validity check runs the same question over the same premise set.
        // Before this change the two answered differently, which is the defect.
        expect(validity.ok).toBe(true)
        expect(evaluated.premiseSetSatisfiable).toBe(false)
    })

    it("leaves an argument whose premises do not need the source unaffected", () => {
        const built = buildArgument({
            conclusion: v("Q"),
            premises: [implies(and(v("A"), v("C")), v("Q")), v("A")],
            claimTypes: { C: "citation" },
        })

        const result = built.engine.evaluate({
            variables: {},
            operatorAssignments: {},
        })

        expect(result.premiseSetSatisfiable).toBe(true)
    })
})

describe("a reader may still disagree with a source", () => {
    // These pass before the change. They are the trap: the naive fix — passing
    // the grounded set as `forcedTrueVariableIds` — makes citations invisible
    // to `isReaderAsserted`, and a reader's own assignment stops being theirs.

    it("still accepts an assignment on a citation-bound variable", () => {
        const built = buildArgument({
            conclusion: v("Q"),
            premises: [implies(v("C"), v("Q"))],
            claimTypes: { C: "citation" },
        })
        const citation = built.variableId("C")

        const result = built.engine.evaluate({
            variables: { [citation]: false },
            operatorAssignments: {},
        })

        expect(result.ok).not.toBe(false)
        expect(result.propagatedVariableValues![citation]).toBe(false)
    })

    it("credits the reader with asserting a cited conclusion claim", () => {
        // Attribution, not provenance, is what `forcedTrueVariableIds` governs:
        // it drives `isReaderAsserted`, which decides both `assertedByReader`
        // and which claims get an attribution entry at all. A citation swept
        // into that set stops being anything the reader did.
        const built = buildArgument({
            conclusion: v("C"),
            premises: [implies(v("A"), v("C")), v("A")],
            claimTypes: { C: "citation" },
        })
        const citation = built.variableId("C")

        const result = built.engine.evaluate({
            variables: { [citation]: true },
            operatorAssignments: {},
        })

        expect(result.conclusionAttribution?.assertedByReader).toBe(true)
    })

    it("keeps a cited claim in the reached-without-assertion counterfactual", () => {
        // `conclusionClaimVariableIds` drops forced-true variables, so under
        // the naive widening a citation-backed conclusion never gets the
        // withhold-and-re-close treatment and the counterfactual answers from
        // the reader's own assertion instead of despite it.
        const built = buildArgument({
            conclusion: v("C"),
            premises: [implies(v("A"), v("C")), v("A")],
            claimTypes: { C: "citation" },
        })
        const citation = built.variableId("C")

        const result = built.engine.evaluate({
            variables: { [citation]: true },
            operatorAssignments: {},
        })

        // Withhold the reader's assertion and the conclusion no longer stands,
        // so it was not reached without them. Under the naive widening the
        // counterfactual is skipped entirely and the answer inverts to `true`
        // — the argument claims to reach its conclusion on its own merits
        // using a value the reader supplied.
        expect(result.conclusionAttribution?.reachedWithoutAssertion).toBe(
            false
        )
    })

    it("still refuses an assignment on an axiomatic-bound variable", () => {
        const built = buildArgument({
            conclusion: v("Q"),
            premises: [implies(v("X"), v("Q"))],
            claimTypes: { X: "axiomatic" },
        })
        const axiom = built.variableId("X")

        expect(() =>
            built.engine.evaluate({
                variables: { [axiom]: false },
                operatorAssignments: {},
            })
        ).toThrow()
    })
})

describe("a caller's own forced-true set", () => {
    it("reaches the satisfiability question as well as the evaluation", () => {
        // `¬B` as a constraint, with the caller pinning `B` true: the premise
        // set cannot hold, and it takes the caller's set reaching the walk to
        // notice.
        const built = buildArgument({
            conclusion: v("Q"),
            premises: [implies(v("A"), v("Q")), not(v("B")), v("A")],
        })

        const result = built.engine.evaluate(
            { variables: {}, operatorAssignments: {} },
            { forcedTrueVariableIds: new Set([built.variableId("B")]) }
        )

        expect(result.premiseSetSatisfiable).toBe(false)
    })
})
