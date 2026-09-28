import { describe, expect, it } from "vitest"
import { ArgumentEngine, ClaimLibrary } from "../src/lib/index"
import type { PremiseEngine } from "../src/lib/core/premise-engine"

// The premise engine's read-only routines live in module functions and read
// the engine's state through a context. These pin that they read it the way
// the methods did before they moved: each field when it is used, and each
// callback with the engine as `this`.

const ARG = { id: "arg-1", version: 1 }

function premiseOverTwoVariables(): PremiseEngine {
    const claims = new ClaimLibrary()
    claims.create({ id: "claim-default", type: "normal" })
    const engine = new ArgumentEngine(ARG, claims, { behavior: "permissive" })
    for (const [id, symbol] of [
        ["var-p", "P"],
        ["var-q", "Q"],
    ]) {
        engine.addVariable({
            id,
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol,
            claimId: "claim-default",
            claimVersion: 0,
        })
    }
    const { result: premise } = engine.createPremise()
    const base = {
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        premiseId: premise.getId(),
    }
    premise.addExpression({
        ...base,
        id: "op-and",
        type: "operator",
        operator: "and",
        parentId: null,
        position: 0,
    })
    premise.addExpression({
        ...base,
        id: "expr-p",
        type: "variable",
        variableId: "var-p",
        parentId: "op-and",
        position: 0,
    })
    premise.addExpression({
        ...base,
        id: "expr-q",
        type: "variable",
        variableId: "var-q",
        parentId: "op-and",
        position: 1,
    })
    return premise
}

const boundPremiseWarnings = (premise: PremiseEngine) =>
    premise
        .validateEvaluability()
        .issues.filter((issue) => issue.code === "EXPR_BOUND_PREMISE_EMPTY")

describe("PremiseEngine — read-only routines read the engine as they use it", () => {
    it("sees a callback replaced while the check is running", () => {
        const premise = premiseOverTwoVariables()
        premise.setEmptyBoundPremiseCheck(() => {
            premise.setEmptyBoundPremiseCheck(() => false)
            return true
        })

        expect(boundPremiseWarnings(premise)).toHaveLength(1)
    })

    it("runs a callback with the engine as `this`", () => {
        const premise = premiseOverTwoVariables()
        const receivers: unknown[] = []
        premise.setEmptyBoundPremiseCheck(function (this: unknown) {
            receivers.push(this)
            return false
        })

        boundPremiseWarnings(premise)

        expect(receivers).toHaveLength(2)
        expect(receivers.every((receiver) => receiver === premise)).toBe(true)
    })
})
