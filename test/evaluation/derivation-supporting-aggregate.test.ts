// A derivation premise is engine-synthesized wiring, not authored support.
// The claim it derives may be referenced by no other premise, so a reader's
// answer about it must not move any aggregate that speaks for the argument.

import { describe, it, expect } from "vitest"
import { buildArgument, implies, v } from "./fixtures.js"

describe("derivation premises and the supporting aggregate", () => {
    // `C` is the conclusion, carried by the one authored supporting premise
    // `A → C`. `U` is a normal claim no authored premise references; it exists
    // only as the consequent of its own citation-backed derivation premise.
    const build = () =>
        buildArgument({
            conclusion: v("C"),
            premises: [implies(v("A"), v("C"))],
            derivations: [
                { derivedClaim: "U", tree: implies(v("cite"), v("U")) },
            ],
            claimTypes: { cite: "citation" },
        })

    const evaluateWithU = (unusedClaimAnswer: boolean) => {
        const built = build()
        return {
            built,
            result: built.engine.evaluate({
                variables: {
                    [built.variableId("A")]: true,
                    [built.variableId("C")]: true,
                    [built.variableId("cite")]: true,
                    [built.variableId("U")]: unusedClaimAnswer,
                },
                operatorAssignments: {},
            }),
        }
    }

    it("does not move the supporting aggregate when the reader answers an unreferenced claim", () => {
        const answered = evaluateWithU(true).result
        const rejected = evaluateWithU(false).result

        expect(answered.survivingSupportingPremisesTrue).toBe(true)
        expect(rejected.survivingSupportingPremisesTrue).toBe(true)
    })

    it("counts only the authored supporting premise", () => {
        expect(evaluateWithU(true).result.survivingSupportingPremiseCount).toBe(
            1
        )
        expect(
            evaluateWithU(false).result.survivingSupportingPremiseCount
        ).toBe(1)
    })

    it("leaves the constraint facts alone", () => {
        // The rejected alternative fix — filtering at the bucket split rather
        // than at the fold — relocates the derivation premise into
        // `constraintPremises` and flips `isAdmissibleAssignment` instead.
        for (const answer of [true, false]) {
            const result = evaluateWithU(answer).result
            expect(result.isAdmissibleAssignment).toBe(true)
            expect(result.premisesHoldConclusionFalse).toBe(false)
        }
    })

    it("keeps the derivation premise in listSupportingPremises", () => {
        // The public method classifies by tree shape and is correct to: every
        // derivation premise has role 'supporting'. Only the aggregate narrows.
        const { built } = evaluateWithU(true)
        const supporting = built.engine.listSupportingPremises()

        expect(
            supporting.some((pm) => pm.getPremiseType?.() === "derivation")
        ).toBe(true)
    })
})
