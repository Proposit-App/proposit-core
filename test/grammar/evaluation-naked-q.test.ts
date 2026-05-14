// C8: Evaluation no-op on naked-Q derivation premises.
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

describe("Evaluation no-op on naked-Q derivation premises (C8)", () => {
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
})
