import { describe, expect, it } from "vitest"
import {
    ArgumentEngine,
    ClaimLibrary,
    POSITION_INITIAL,
    PropositCore,
    diffArguments,
} from "../src/index.js"
import type {
    TCoreDiffState,
    TCorePropositionalExpression,
} from "../src/index.js"

const ARG_ID = "arg-1"

/** A fresh deterministic id generator so two engines mint identical id
 * sequences — lets us diff by stable id without fork remapping. */
function makeGenerateId(): () => string {
    let n = 0
    return () => `gen-${n++}`
}

const DEFAULT_CLAIM_ID = "claim-default"

/** A claim library seeded with one normal claim so engines can hold
 * claim-bound variables (the only kind `addVariable` accepts). */
function makeClaimLibrary(): ClaimLibrary {
    const lib = new ClaimLibrary()
    lib.create({ id: DEFAULT_CLAIM_ID, type: "normal" })
    return lib
}

function makeEngine(lib: ClaimLibrary): ArgumentEngine {
    return new ArgumentEngine({ id: ARG_ID, version: 0 }, lib, {
        behavior: "permissive",
        generateId: makeGenerateId(),
    })
}

function makeVar(id: string, symbol: string, claimVersion = 0) {
    return {
        id,
        argumentId: ARG_ID,
        argumentVersion: 0,
        symbol,
        claimId: DEFAULT_CLAIM_ID,
        claimVersion,
    }
}

function varExpr(
    id: string,
    premiseId: string,
    variableId: string,
    parentId: string | null,
    position: number
): TCorePropositionalExpression {
    return {
        id,
        argumentId: ARG_ID,
        argumentVersion: 0,
        premiseId,
        type: "variable",
        variableId,
        parentId,
        position,
    } as TCorePropositionalExpression
}

function opExpr(
    id: string,
    premiseId: string,
    operator: string,
    parentId: string | null,
    position: number
): TCorePropositionalExpression {
    return {
        id,
        argumentId: ARG_ID,
        argumentVersion: 0,
        premiseId,
        type: "operator",
        operator,
        parentId,
        position,
    } as TCorePropositionalExpression
}

/**
 * Builds an engine with a single constraint premise `(P {op} Q)` — a root
 * operator (`and`/`or`) over two plain variables. Deterministic ids let a
 * sibling-built engine pair every entity by id.
 */
function buildBinaryOpEngine(
    lib: ClaimLibrary,
    operator: "and" | "or",
    pSymbol = "P"
): ArgumentEngine {
    const engine = makeEngine(lib)
    engine.addVariable(makeVar("var-p", pSymbol))
    engine.addVariable(makeVar("var-q", "Q"))
    const { result: pm } = engine.createPremiseWithId("p-1", { title: "P1" })
    pm.addExpression(opExpr("expr-op", "p-1", operator, null, POSITION_INITIAL))
    pm.addExpression(varExpr("expr-p", "p-1", "var-p", "expr-op", 0))
    pm.addExpression(varExpr("expr-q", "p-1", "var-q", "expr-op", 1))
    return engine
}

describe("diff state discriminant", () => {
    it("exposes exactly the four-member state vocabulary", () => {
        const states: TCoreDiffState[] = [
            "added",
            "removed",
            "modified-own",
            "modified-within",
        ]
        expect(states).toHaveLength(4)
        expect(typeof PropositCore).toBe("function")
    })
})

describe("own-vs-within tagging", () => {
    it("tags an operator edit as the expression's modified-own", () => {
        const lib = makeClaimLibrary()
        const engineA = buildBinaryOpEngine(lib, "and")
        const engineB = buildBinaryOpEngine(lib, "or")

        const diff = diffArguments(engineA, engineB)

        const premise = diff.premises.modified.find((p) => p.after.id === "p-1")
        expect(premise).toBeDefined()
        const opDiff = premise!.expressions.modified.find(
            (e) => e.after.id === "expr-op"
        )
        expect(opDiff).toBeDefined()
        expect(opDiff!.state).toBe("modified-own")
        expect(opDiff!.changes).toEqual([
            { field: "operator", before: "and", after: "or" },
        ])
    })

    it("tags a premise whose subtree changed but own fields did not as modified-within", () => {
        const lib = makeClaimLibrary()
        const engineA = buildBinaryOpEngine(lib, "and")
        const engineB = buildBinaryOpEngine(lib, "or")

        const diff = diffArguments(engineA, engineB)

        const premise = diff.premises.modified.find((p) => p.after.id === "p-1")
        expect(premise).toBeDefined()
        expect(premise!.changes).toEqual([])
        expect(premise!.state).toBe("modified-within")
    })

    it("tags a variable symbol rename as modified-own", () => {
        const lib = makeClaimLibrary()
        const engineA = buildBinaryOpEngine(lib, "and", "P")
        const engineB = buildBinaryOpEngine(lib, "and", "X")

        const diff = diffArguments(engineA, engineB)

        const renamed = diff.variables.modified.find(
            (v) => v.after.id === "var-p"
        )
        expect(renamed).toBeDefined()
        expect(renamed!.state).toBe("modified-own")
        expect(renamed!.changes).toEqual([
            { field: "symbol", before: "P", after: "X" },
        ])
    })
})

/** Builds an engine with two inference premises so the conclusion role can be
 * reassigned between them without touching any premise content. */
function buildTwoInferencePremiseEngine(
    lib: ClaimLibrary,
    conclusionPremiseId: "p-1" | "p-2"
): ArgumentEngine {
    const engine = makeEngine(lib)
    engine.addVariable(makeVar("var-p", "P"))
    engine.addVariable(makeVar("var-q", "Q"))
    for (const premiseId of ["p-1", "p-2"] as const) {
        const { result: pm } = engine.createPremiseWithId(premiseId, {})
        pm.addExpression(
            opExpr(
                `${premiseId}-implies`,
                premiseId,
                "implies",
                null,
                POSITION_INITIAL
            )
        )
        pm.addExpression(
            varExpr(
                `${premiseId}-p`,
                premiseId,
                "var-p",
                `${premiseId}-implies`,
                0
            )
        )
        pm.addExpression(
            varExpr(
                `${premiseId}-q`,
                premiseId,
                "var-q",
                `${premiseId}-implies`,
                1
            )
        )
    }
    engine.setConclusionPremise(conclusionPremiseId)
    return engine
}

describe("conclusion role folded into argument own-state", () => {
    it("marks the argument modified-own when the conclusion premise is reassigned", () => {
        const lib = makeClaimLibrary()
        const engineA = buildTwoInferencePremiseEngine(lib, "p-1")
        const engineB = buildTwoInferencePremiseEngine(lib, "p-2")

        const diff = diffArguments(engineA, engineB)

        expect(diff.roles.conclusion.before).not.toBe(
            diff.roles.conclusion.after
        )
        expect(diff.argument.state).toBe("modified-own")
    })
})
