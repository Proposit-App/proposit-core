import { describe, expect, it } from "vitest"
import {
    ArgumentEngine,
    ClaimLibrary,
    POSITION_INITIAL,
    PropositCore,
    diffArguments,
    isClaimBound,
} from "../src/index.js"
import type {
    TCoreArgumentDiff,
    TCoreDiffState,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../src/index.js"
import { isDiffEmpty } from "../src/cli/output/diff-renderer.js"

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

/** A claim library where `claim-default` has both version 0 and version 1, so
 * a variable can pin either — modelling a claim edit (version bump). */
function makeClaimLibraryWithBump(): ClaimLibrary {
    const lib = makeClaimLibrary()
    lib.freeze(DEFAULT_CLAIM_ID) // freezes v0 and opens a v1 draft
    return lib
}

/**
 * Builds an engine where variable Q is claim-bound to `claim-default@{qVersion}`
 * and is referenced by three premises:
 *  - p-1: `P → Q` (inference / conclusion),
 *  - p-2: `Q` (bare reference),
 *  - p-3: `Q {p3Op} P` (a constraint premise whose own operator can be edited).
 */
function buildReferenceEngine(
    lib: ClaimLibrary,
    qVersion: 0 | 1,
    p3Op: "and" | "or"
): ArgumentEngine {
    const engine = makeEngine(lib)
    engine.addVariable(makeVar("var-p", "P"))
    engine.addVariable(makeVar("var-q", "Q", qVersion))

    const { result: pm1 } = engine.createPremiseWithId("p-1", {})
    pm1.addExpression(
        opExpr("p-1-implies", "p-1", "implies", null, POSITION_INITIAL)
    )
    pm1.addExpression(varExpr("p-1-p", "p-1", "var-p", "p-1-implies", 0))
    pm1.addExpression(varExpr("p-1-q", "p-1", "var-q", "p-1-implies", 1))

    const { result: pm2 } = engine.createPremiseWithId("p-2", {})
    pm2.addExpression(varExpr("p-2-q", "p-2", "var-q", null, POSITION_INITIAL))

    const { result: pm3 } = engine.createPremiseWithId("p-3", {})
    pm3.addExpression(opExpr("p-3-op", "p-3", p3Op, null, POSITION_INITIAL))
    pm3.addExpression(varExpr("p-3-q", "p-3", "var-q", "p-3-op", 0))
    pm3.addExpression(varExpr("p-3-p", "p-3", "var-p", "p-3-op", 1))

    engine.setConclusionPremise("p-1")
    return engine
}

describe("reference-edge propagation", () => {
    it("marks premises that reference a changed claim as modified-within", () => {
        const lib = makeClaimLibraryWithBump()
        const engineA = buildReferenceEngine(lib, 0, "and")
        const engineB = buildReferenceEngine(lib, 1, "and")

        const diff = diffArguments(engineA, engineB)

        const changedQ = diff.variables.modified.find(
            (v) => v.after.id === "var-q"
        )
        expect(changedQ).toBeDefined()
        expect(changedQ!.state).toBe("modified-own")
        expect(changedQ!.changes).toEqual([
            { field: "claimVersion", before: 0, after: 1 },
        ])

        for (const premiseId of ["p-1", "p-2"]) {
            const entry = diff.premises.modified.find(
                (p) => p.after.id === premiseId
            )
            expect(
                entry,
                `${premiseId} should be modified-within`
            ).toBeDefined()
            expect(entry!.state).toBe("modified-within")
            expect(entry!.changes).toEqual([])
        }
    })

    it("does not double-mark a premise that has its own containment change and also references the changed claim", () => {
        const lib = makeClaimLibraryWithBump()
        const engineA = buildReferenceEngine(lib, 0, "and")
        const engineB = buildReferenceEngine(lib, 1, "or") // p-3 operator edit

        const diff = diffArguments(engineA, engineB)

        const p3Entries = diff.premises.modified.filter(
            (p) => p.after.id === "p-3"
        )
        // Present exactly once — the reference pass must not duplicate a
        // premise already flagged for its own containment change.
        expect(p3Entries).toHaveLength(1)
        // Its containment detail (the operator edit) is preserved, not
        // clobbered into an empty reference-within entry.
        const opEdit = p3Entries[0].expressions.modified.find(
            (e) => e.after.id === "p-3-op"
        )
        expect(opEdit).toBeDefined()
        expect(opEdit!.state).toBe("modified-own")
        expect(opEdit!.changes).toEqual([
            { field: "operator", before: "and", after: "or" },
        ])
    })
})

/**
 * Tallies `modified-own` / `modified-within` across the *entity* records only
 * (variables, premises, and each premise's expressions). The always-present
 * argument root's default `state` is deliberately excluded — emptiness is
 * decided by `isDiffEmpty`, not by the argument's structural default.
 */
function countByState(diff: TCoreArgumentDiff): {
    own: number
    within: number
} {
    let own = 0
    let within = 0
    const tally = (state: TCoreDiffState): void => {
        if (state === "modified-own") own += 1
        else if (state === "modified-within") within += 1
    }
    for (const v of diff.variables.modified) tally(v.state)
    for (const p of diff.premises.modified) {
        tally(p.state)
        for (const e of p.expressions.modified) tally(e.state)
    }
    return { own, within }
}

describe("diff stability (id-stability contract)", () => {
    it("a copy with no edits produces an empty diff", () => {
        const lib = makeClaimLibraryWithBump()
        const engineA = buildReferenceEngine(lib, 0, "and")
        const engineB = buildReferenceEngine(lib, 0, "and")

        const diff = diffArguments(engineA, engineB)

        expect(isDiffEmpty(diff)).toBe(true)
        // No modified-* on any entity record — argument.state's structural
        // default is excluded by countByState.
        expect(countByState(diff)).toEqual({ own: 0, within: 0 })
    })

    it("a single entity edit produces exactly one modified-own origin", () => {
        const lib = makeClaimLibrary()
        const engineA = buildBinaryOpEngine(lib, "and")
        const engineB = buildBinaryOpEngine(lib, "or")

        const diff = diffArguments(engineA, engineB)

        const tally = countByState(diff)
        // Exactly one origin (the edited operator expression); the containing
        // premise is the only within entry.
        expect(tally.own).toBe(1)
        expect(tally.within).toBe(1)
    })
})

/**
 * Builds an engine where one claim (`claim-default`) is referenced BOTH by an
 * authored claim-bound variable and by a derivation premise deriving it. A
 * naive walk would see two variables pinning the claim; the engine's
 * `ensureClaimBoundVariable` reuse means there is exactly one.
 */
function buildSharedClaimEngine(
    lib: ClaimLibrary,
    qVersion: 0 | 1
): ArgumentEngine {
    const engine = makeEngine(lib)
    // Authored variable bound to the claim, referenced by an ordinary premise.
    engine.addVariable(makeVar("var-q", "Q", qVersion))
    const { result: authored } = engine.createPremiseWithId("p-authored", {})
    authored.addExpression(
        varExpr("p-authored-q", "p-authored", "var-q", null, POSITION_INITIAL)
    )
    // Derivation premise deriving the same claim — its naked-Q consequent
    // reuses the authored variable rather than minting a second one.
    engine.createPremiseWithId("p-deriv", {
        type: "derivation",
        derivedClaimId: DEFAULT_CLAIM_ID,
    })
    return engine
}

describe("single origin across the two-variables-per-claim hazard", () => {
    it("keeps one claim-bound variable when a claim is both authored and derived", () => {
        const lib = makeClaimLibraryWithBump()
        const engine = buildSharedClaimEngine(lib, 0)

        const claimBound = engine
            .getVariables()
            .filter(
                (v: TCorePropositionalVariable) =>
                    isClaimBound(v) && v.claimId === DEFAULT_CLAIM_ID
            )
        expect(claimBound).toHaveLength(1)
    })

    it("a single claim-version bump yields exactly one modified-own variable", () => {
        const lib = makeClaimLibraryWithBump()
        const engineA = buildSharedClaimEngine(lib, 0)
        const engineB = buildSharedClaimEngine(lib, 1)

        const diff = diffArguments(engineA, engineB)

        const ownVars = diff.variables.modified.filter(
            (v) => v.state === "modified-own"
        )
        // Exactly one origin. Two would be a real single-origin violation
        // (the claim reference double-counted), not something to dedupe away.
        expect(ownVars).toHaveLength(1)
        expect(ownVars[0].after.id).toBe("var-q")
    })
})

describe("derivation premises diff without special-casing", () => {
    it("an unchanged derivation premise produces no diff entry", () => {
        const lib = makeClaimLibrary()
        const engineA = buildSharedClaimEngine(lib, 0)
        const engineB = buildSharedClaimEngine(lib, 0)

        const diff = diffArguments(engineA, engineB)

        expect(diff.premises.added).toEqual([])
        expect(diff.premises.removed).toEqual([])
        // The derivation premise is not spuriously flagged, and nothing is
        // synthesized into the diff for it.
        expect(diff.premises.modified).toEqual([])
    })

    it("a derivation premise touched by a claim edit is tagged like any referencing premise, exactly once", () => {
        const lib = makeClaimLibraryWithBump()
        const engineA = buildSharedClaimEngine(lib, 0)
        const engineB = buildSharedClaimEngine(lib, 1)

        const diff = diffArguments(engineA, engineB)

        const derivEntries = diff.premises.modified.filter(
            (p) => p.after.id === "p-deriv"
        )
        expect(derivEntries).toHaveLength(1)
        expect(derivEntries[0].state).toBe("modified-within")

        // No premise is duplicated by a synthesized within entry.
        const ids = diff.premises.modified.map((p) => p.after.id)
        expect(new Set(ids).size).toBe(ids.length)
    })
})
