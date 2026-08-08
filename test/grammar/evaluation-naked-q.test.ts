// Evaluation no-op on naked-Q derivation premises.
//
// Per CLAUDE.md "Key design rules" + spec §8: a derivation premise
// whose tree is a single variable at the root (naked-Q form)
// contributes nothing to `evaluate()` and `checkValidity()` — the
// evaluator skips it. Naked-Q premises neither assert their consequent
// nor support its derivation. This replaces the pre-1.0
// `DERIVATION_STRUCTURE_INVALID_AT_EVALUATION` throw on naked-Q.
//
// The publish-time pruning step (server-side) deletes naked-Q
// derivation premises before storage so post-publish arguments never
// carry them; this engine-side skip is the v1.0 contract for pre-
// publish state.

import { describe, it, expect } from "vitest"
import { ArgumentEngine } from "../../src/lib/core/argument-engine.js"
import { ClaimLibrary } from "../../src/lib/core/claim-library.js"
import { makeArgument } from "./fixtures.js"

const ARG = makeArgument()

describe("Evaluation no-op on naked-Q derivation premises", () => {
    it("evaluate() does not throw DERIVATION_STRUCTURE_INVALID_AT_EVALUATION on a naked-Q derivation supporting premise", () => {
        const claimLib = new ClaimLibrary()
        const derivedClaim = claimLib.create({
            id: "claim-derived",
            type: "normal",
        })
        const concClaim = claimLib.create({ id: "claim-c", type: "normal" })
        const eng = new ArgumentEngine(ARG, claimLib)

        // Conclusion: simple freeform premise with one variable.
        const { result: conclusionPe } = eng.createPremise()
        const varC = eng.ensureClaimBoundVariable(concClaim.id)
        conclusionPe.addExpression({
            id: "v-c-expr",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: conclusionPe.getId(),
            type: "variable",
            variableId: varC.id,
            parentId: null,
            position: 0,
        })

        // Supporting: naked-Q derivation premise (auto-created at
        // createPremise time when type='derivation').
        eng.createPremise({
            type: "derivation",
            derivedClaimId: derivedClaim.id,
        })

        // Evaluate with the conclusion variable assigned true.
        // The naked-Q derivation premise should be skipped by the
        // evaluator — no throw, no DERIVATION_STRUCTURE_INVALID_AT_EVALUATION
        // error, and the conclusion's truth value should drive the result.
        expect(() =>
            eng.evaluate({
                variables: { [varC.id]: true },
                operatorAssignments: {},
            })
        ).not.toThrow()
    })

    it("evaluate() produces a coherent result with one naked-Q derivation + one freeform conclusion", () => {
        const claimLib = new ClaimLibrary()
        const derivedClaim = claimLib.create({
            id: "claim-derived",
            type: "normal",
        })
        const concClaim = claimLib.create({ id: "claim-c", type: "normal" })
        const eng = new ArgumentEngine(ARG, claimLib)

        // Conclusion premise: just the conclusion claim variable.
        const { result: conclusionPe } = eng.createPremise()
        const varC = eng.ensureClaimBoundVariable(concClaim.id)
        conclusionPe.addExpression({
            id: "v-c-expr",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: conclusionPe.getId(),
            type: "variable",
            variableId: varC.id,
            parentId: null,
            position: 0,
        })

        // Naked-Q derivation (skipped during evaluation).
        eng.createPremise({
            type: "derivation",
            derivedClaimId: derivedClaim.id,
        })

        const result = eng.evaluate({
            variables: { [varC.id]: true },
            operatorAssignments: {},
        })
        // The naked-Q's contribution is none, so the conclusion's truth
        // determines whether the argument's premises hold. The exact
        // result shape varies by engine — assert it doesn't error out.
        expect(result).toBeDefined()
    })

    it("checkValidity() does not throw on a naked-Q derivation premise", () => {
        const claimLib = new ClaimLibrary()
        const derivedClaim = claimLib.create({
            id: "claim-derived",
            type: "normal",
        })
        const concClaim = claimLib.create({ id: "claim-c", type: "normal" })
        const eng = new ArgumentEngine(ARG, claimLib)

        const { result: conclusionPe } = eng.createPremise()
        const varC = eng.ensureClaimBoundVariable(concClaim.id)
        conclusionPe.addExpression({
            id: "v-c-expr",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: conclusionPe.getId(),
            type: "variable",
            variableId: varC.id,
            parentId: null,
            position: 0,
        })

        eng.createPremise({
            type: "derivation",
            derivedClaimId: derivedClaim.id,
        })

        expect(() => eng.checkValidity()).not.toThrow()
    })

    it("evaluate() produces the same result with and without a naked-Q derivation premise (proves skip, not just no-throw)", () => {
        // Stronger contract than "doesn't throw": adding a naked-Q
        // derivation premise alongside a freeform conclusion must
        // produce a result indistinguishable from the argument that
        // never had the derivation premise at all. The evaluator-context
        // filter in `asEvaluationContext` is what guarantees this; the
        // test is the regression guard against accidentally surfacing
        // the naked-Q to the evaluator (which would either throw or
        // change the result shape).
        const claimLib = new ClaimLibrary()
        const derivedClaim = claimLib.create({
            id: "claim-derived",
            type: "normal",
        })
        const concClaim = claimLib.create({ id: "claim-c", type: "normal" })

        // Baseline: engine with only the conclusion premise.
        const baselineEng = new ArgumentEngine(ARG, claimLib)
        const { result: baselineConcPe } = baselineEng.createPremise()
        const baselineVarC = baselineEng.ensureClaimBoundVariable(concClaim.id)
        baselineConcPe.addExpression({
            id: "v-c-expr-a",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: baselineConcPe.getId(),
            type: "variable",
            variableId: baselineVarC.id,
            parentId: null,
            position: 0,
        })
        const baselineResult = baselineEng.evaluate({
            variables: { [baselineVarC.id]: true },
            operatorAssignments: {},
        })

        // Compare: engine with the same conclusion premise plus an
        // extra naked-Q derivation premise.
        const compareEng = new ArgumentEngine(ARG, claimLib)
        const { result: compareConcPe } = compareEng.createPremise()
        const compareVarC = compareEng.ensureClaimBoundVariable(concClaim.id)
        compareConcPe.addExpression({
            id: "v-c-expr-b",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: compareConcPe.getId(),
            type: "variable",
            variableId: compareVarC.id,
            parentId: null,
            position: 0,
        })
        compareEng.createPremise({
            type: "derivation",
            derivedClaimId: derivedClaim.id,
        })
        const compareResult = compareEng.evaluate({
            variables: { [compareVarC.id]: true },
            operatorAssignments: {},
        })

        // The argument-level summary truth fields must match — the
        // naked-Q derivation contributed nothing because it was skipped.
        expect(compareResult.conclusionTrue).toBe(baselineResult.conclusionTrue)
        expect(compareResult.survivingSupportingPremisesTrue).toBe(
            baselineResult.survivingSupportingPremisesTrue
        )
        expect(compareResult.isAdmissibleAssignment).toBe(
            baselineResult.isAdmissibleAssignment
        )
        // The supporting-premises list in the compare run must be the
        // same length as the baseline's — the naked-Q derivation premise
        // is not in the listing because the evaluator never saw it.
        // (Baseline has 0 supporting premises; compare also has 0
        // because the naked-Q is filtered out by `asEvaluationContext`.)
        const baselineSupportCount =
            baselineResult.supportingPremises?.length ?? 0
        const compareSupportCount =
            compareResult.supportingPremises?.length ?? 0
        expect(compareSupportCount).toBe(baselineSupportCount)
    })
})
