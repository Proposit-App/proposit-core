// Where a value came from is answered by intervention: withhold the reader's
// own assertion, recompute closure from what is left, and ask again.

import { describe, it, expect } from "vitest"
import { and, buildArgument, implies, not, or, v } from "./fixtures.js"

describe("conclusion attribution", () => {
    it("reports a conclusion the reader supplied as not reached by the argument", () => {
        // Both claims true, and the reader granted no step. The conclusion is
        // true only because they said so.
        const built = buildArgument({
            conclusion: v("W"),
            premises: [implies(v("M"), v("W"))],
        })

        const result = built.engine.evaluate({
            variables: {
                [built.variableId("M")]: true,
                [built.variableId("W")]: true,
            },
            operatorAssignments: {},
        })

        expect(result.conclusionTrue).toBe(true)
        expect(result.survivingSupportingPremisesTrue).toBe(true)
        expect(result.conclusionAttribution).toEqual({
            assertedByReader: true,
            reachedWithoutAssertion: false,
        })
        expect(result.struckPremiseIds).toEqual([])
    })

    it("credits the argument once the reader grants the step that carries it", () => {
        const built = buildArgument({
            conclusion: v("W"),
            premises: [implies(v("M"), v("W"))],
        })

        const result = built.engine.evaluate({
            variables: {
                [built.variableId("M")]: true,
                [built.variableId("W")]: true,
            },
            operatorAssignments: { [built.rootIds[0]]: "accepted" },
        })

        expect(result.conclusionAttribution).toEqual({
            assertedByReader: true,
            reachedWithoutAssertion: true,
        })
    })

    it("reports the conclusion reached when a granted premise supports it and another is struck", () => {
        const built = buildArgument({
            conclusion: v("C"),
            premises: [implies(v("A"), v("C")), implies(v("B"), v("C"))],
        })

        const result = built.engine.evaluate({
            variables: {
                [built.variableId("A")]: true,
                [built.variableId("B")]: true,
            },
            operatorAssignments: {
                [built.rootIds[0]]: "rejected",
                [built.rootIds[1]]: "accepted",
            },
        })

        expect(result.conclusionTrue).toBe(true)
        expect(result.conclusionAttribution?.reachedWithoutAssertion).toBe(true)
        expect(result.struckPremiseIds).toEqual([built.premiseIds[0]])
        expect(result.survivingSupportingPremisesTrue).toBe(true)
    })

    it("reports nothing reached when every supporting premise is struck", () => {
        const built = buildArgument({
            conclusion: v("C"),
            premises: [implies(v("A"), v("C")), implies(v("B"), v("C"))],
        })

        const result = built.engine.evaluate({
            variables: {
                [built.variableId("A")]: true,
                [built.variableId("B")]: true,
                [built.variableId("C")]: true,
            },
            operatorAssignments: {
                [built.rootIds[0]]: "rejected",
                [built.rootIds[1]]: "rejected",
            },
        })

        expect([...result.struckPremiseIds!].sort()).toEqual(
            [...built.premiseIds].sort()
        )
        expect(result.survivingSupportingPremiseCount).toBe(0)
        // The empty conjunction is vacuously true; it must not compose into a
        // positive reading, which is why attribution is the gate.
        expect(result.survivingSupportingPremisesTrue).toBe(true)
        expect(result.conclusionAttribution?.reachedWithoutAssertion).toBe(
            false
        )
    })

    it("does not treat mutually supporting premises as an independent derivation", () => {
        const built = buildArgument({
            conclusion: v("A"),
            premises: [implies(v("A"), v("B")), implies(v("B"), v("A"))],
        })
        const a = built.variableId("A")

        const result = built.engine.evaluate({
            variables: { [a]: true },
            operatorAssignments: {
                [built.rootIds[0]]: "accepted",
                [built.rootIds[1]]: "accepted",
            },
        })

        expect(result.conclusionAttribution?.reachedWithoutAssertion).toBe(
            false
        )
        expect(result.claimAttribution![a]).toEqual({
            assertedByReader: true,
            reachedWithoutAssertion: false,
        })
    })

    it("reports an intermediate claim that the argument re-derives on its own", () => {
        const built = buildArgument({
            conclusion: v("R"),
            premises: [implies(v("P"), v("Q")), implies(v("Q"), v("R"))],
        })
        const p = built.variableId("P")
        const q = built.variableId("Q")

        const result = built.engine.evaluate({
            variables: { [p]: true, [q]: true },
            operatorAssignments: {
                [built.rootIds[0]]: "accepted",
                [built.rootIds[1]]: "accepted",
            },
        })

        expect(result.claimAttribution![q].reachedWithoutAssertion).toBe(true)
        expect(result.claimAttribution![p].reachedWithoutAssertion).toBe(false)
    })

    it("omits per-claim attribution when no step was granted", () => {
        const built = buildArgument({
            conclusion: v("C"),
            premises: [implies(v("A"), v("C"))],
        })

        const result = built.engine.evaluate({
            variables: { [built.variableId("A")]: true },
            operatorAssignments: {},
        })

        expect(result.claimAttribution).toBeUndefined()
    })

    it("reports the reported shape as unreached with nothing left open", () => {
        // Every claim answered `true`, every step granted, and the conclusion
        // still is not reached on the argument's own merits: the single
        // supporting premise forces nothing the reader had not already said.
        const built = buildArgument({
            conclusion: implies(or(v("A"), not(v("B"))), v("C")),
            premises: [implies(v("A"), and(v("B"), v("C")))],
        })

        const result = built.engine.evaluate({
            variables: {
                [built.variableId("A")]: true,
                [built.variableId("B")]: true,
                [built.variableId("C")]: true,
                [built.variableId("D")]: true,
            },
            operatorAssignments: {
                [built.conclusionRootId]: "accepted",
                [built.rootIds[0]]: "accepted",
            },
        })

        expect(result.conclusionTrue).toBe(true)
        expect(result.premisesHoldConclusionFalse).toBe(false)
        expect(result.struckPremiseIds).toEqual([])
        expect(result.survivingSupportingPremiseCount).toBe(1)
        expect(result.premiseSetSatisfiable).toBe(true)
        expect(result.contestedVariableIds).toEqual([])
        expect(result.conclusionAttribution).toEqual({
            assertedByReader: true,
            reachedWithoutAssertion: false,
        })
        // Nothing is left open: every entry traces back to the reader.
        expect(
            Object.values(result.variableProvenance!).map((p) => p.origin)
        ).toEqual(["asserted", "asserted", "asserted"])
    })

    it("records what provenance reports for a bare-variable derivation premise", () => {
        // (a) A derivation premise whose tree is the bare derived claim.
        //
        // This cannot express "the derivation premise asserts the synthesized
        // variable alone". `buildArgument` swaps the freshly created premise's
        // naked-Q placeholder root for the tree given, and `v("C")` binds
        // claim C's *authored* variable — so the swap reproduces naked-Q form,
        // which the evaluator skips. The premise exists but contributes
        // nothing, and provenance is identical to the no-derivation case.
        const bare = buildArgument({
            conclusion: implies(or(v("A"), not(v("B"))), v("C")),
            premises: [implies(v("A"), and(v("B"), v("C")))],
            derivations: [{ derivedClaim: "C", tree: v("C") }],
        })

        const bareResult = bare.engine.evaluate({
            variables: {
                [bare.variableId("A")]: true,
                [bare.variableId("B")]: true,
                [bare.variableId("C")]: true,
                [bare.variableId("D")]: true,
            },
            operatorAssignments: {
                [bare.conclusionRootId]: "accepted",
                [bare.rootIds[0]]: "accepted",
            },
        })

        expect(bareResult.survivingSupportingPremiseCount).toBe(1)
        expect(
            Object.entries(bareResult.variableProvenance!)
                .map(([id, p]) => [id, p.origin] as const)
                .sort()
        ).toEqual(
            [
                [bare.variableId("A"), "asserted"],
                [bare.variableId("B"), "asserted"],
                [bare.variableId("C"), "asserted"],
            ].sort()
        )

        // (b) A derivation premise carrying a real antecedent. Its consequent
        // is still claim A's authored variable — the same one the reader
        // answered — so every entry reads `asserted` and none reads
        // `unassigned`. A shape where the derivation's consequent is a
        // *second*, engine-synthesized variable on the same claim is not
        // reachable through `buildArgument`: `ensureClaimBoundVariable` reuses
        // the authored variable the fixture already created.
        const derived = buildArgument({
            conclusion: implies(or(v("A"), not(v("B"))), v("C")),
            premises: [implies(v("A"), and(v("B"), v("C")))],
            derivations: [
                {
                    derivedClaim: "A",
                    tree: implies(or(v("P8"), v("P9")), v("A")),
                },
            ],
        })

        const derivedResult = derived.engine.evaluate({
            variables: {
                [derived.variableId("A")]: true,
                [derived.variableId("B")]: true,
                [derived.variableId("C")]: true,
                [derived.variableId("D")]: true,
                [derived.variableId("P8")]: true,
                [derived.variableId("P9")]: true,
            },
            operatorAssignments: {
                [derived.conclusionRootId]: "accepted",
                [derived.rootIds[0]]: "accepted",
                [derived.rootIds[1]]: "accepted",
            },
        })

        expect(derivedResult.survivingSupportingPremiseCount).toBe(2)
        expect(
            Object.entries(derivedResult.variableProvenance!)
                .map(([id, p]) => [id, p.origin] as const)
                .sort()
        ).toEqual(
            [
                [derived.variableId("A"), "asserted"],
                [derived.variableId("B"), "asserted"],
                [derived.variableId("C"), "asserted"],
                [derived.variableId("P8"), "asserted"],
                [derived.variableId("P9"), "asserted"],
            ].sort()
        )
    })
})
