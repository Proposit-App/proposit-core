import { describe, expect, it, beforeEach } from "vitest"
import { ArgumentEngine } from "../src/lib/index"
import type {
    TArgument,
    TPropositionalExpression,
    TPropositionalVariable,
} from "../src/lib/schemata"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ARG: TArgument = {
    id: "arg-1",
    version: 1,
    title: "Test Argument",
    description: "",
}

function makeVar(id: string, symbol: string): TPropositionalVariable {
    return { id, argumentId: ARG.id, argumentVersion: ARG.version, symbol }
}

function makeVarExpr(
    id: string,
    variableId: string,
    opts: { parentId?: string | null; position?: number | null } = {}
): TPropositionalExpression {
    return {
        id,
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        type: "variable",
        variableId,
        parentId: opts.parentId ?? null,
        position: opts.position ?? null,
    }
}

function makeOpExpr(
    id: string,
    operator: "not" | "and" | "or" | "implies" | "iff",
    opts: { parentId?: string | null; position?: number | null } = {}
): TPropositionalExpression {
    return {
        id,
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        type: "operator",
        operator,
        parentId: opts.parentId ?? null,
        position: opts.position ?? null,
    }
}

const VAR_P = makeVar("var-p", "P")
const VAR_Q = makeVar("var-q", "Q")
const VAR_R = makeVar("var-r", "R")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create an engine with P, Q, R pre-loaded. */
function engineWithVars() {
    return new ArgumentEngine(ARG, [VAR_P, VAR_Q, VAR_R])
}

// ---------------------------------------------------------------------------
// addExpression
// ---------------------------------------------------------------------------

describe("addExpression", () => {
    it("adds a root variable expression (parentId: null)", () => {
        const eng = engineWithVars()
        const expr = makeVarExpr("expr-1", VAR_P.id)
        eng.addExpression(expr)
        expect(eng.removeExpression("expr-1")).toMatchObject({ id: "expr-1" })
    })

    it("adds a root operator expression", () => {
        const eng = engineWithVars()
        const op = makeOpExpr("op-1", "and")
        eng.addExpression(op)
        expect(eng.removeExpression("op-1")).toMatchObject({ id: "op-1" })
    })

    it("adds a child expression under an existing operator parent", () => {
        const eng = engineWithVars()
        const op = makeOpExpr("op-1", "and")
        const child = makeVarExpr("expr-1", VAR_P.id, { parentId: "op-1" })

        eng.addExpression(op)
        eng.addExpression(child)

        // child still present: removing op cascades to child, returning root
        expect(eng.removeExpression("op-1")).toMatchObject({ id: "op-1" })
    })

    it("throws when an expression with the same ID already exists", () => {
        const eng = engineWithVars()
        const expr = makeVarExpr("expr-1", VAR_P.id)
        eng.addExpression(expr)
        expect(() => eng.addExpression(expr)).toThrowError(
            /Expression with ID "expr-1" already exists/
        )
    })

    it("throws when an expression declares itself as its own parent", () => {
        const eng = engineWithVars()
        const selfParent = makeVarExpr("expr-1", VAR_P.id, {
            parentId: "expr-1",
        })
        expect(() => eng.addExpression(selfParent)).toThrowError(
            /"expr-1" cannot be its own parent/
        )
    })

    it("throws when the parent expression does not exist", () => {
        const eng = engineWithVars()
        const orphan = makeVarExpr("expr-1", VAR_P.id, {
            parentId: "ghost-parent",
        })
        expect(() => eng.addExpression(orphan)).toThrowError(
            /Parent expression "ghost-parent" does not exist/
        )
    })

    it("throws when the parent expression is not an operator", () => {
        const eng = engineWithVars()
        const parent = makeVarExpr("parent-1", VAR_P.id)
        const child = makeVarExpr("child-1", VAR_Q.id, { parentId: "parent-1" })

        eng.addExpression(parent)
        expect(() => eng.addExpression(child)).toThrowError(
            /Parent expression "parent-1" is not an operator expression/
        )
    })

    it("throws when a position is already occupied under the same parent", () => {
        const eng = engineWithVars()
        const op = makeOpExpr("op-1", "and")
        const child1 = makeVarExpr("expr-1", VAR_P.id, {
            parentId: "op-1",
            position: 0,
        })
        const child2 = makeVarExpr("expr-2", VAR_Q.id, {
            parentId: "op-1",
            position: 0,
        })

        eng.addExpression(op)
        eng.addExpression(child1)
        expect(() => eng.addExpression(child2)).toThrowError(
            /Position 0 is already used under parent "op-1"/
        )
    })

    describe("operator child limits", () => {
        it("allows exactly one child under 'not'", () => {
            const eng = engineWithVars()
            const op = makeOpExpr("op-1", "not")
            eng.addExpression(op)
            eng.addExpression(
                makeVarExpr("expr-1", VAR_P.id, { parentId: "op-1" })
            )

            expect(() =>
                eng.addExpression(
                    makeVarExpr("expr-2", VAR_Q.id, { parentId: "op-1" })
                )
            ).toThrowError(/can only have one child/)
        })

        it("allows exactly two children under 'implies'", () => {
            const eng = engineWithVars()
            const op = makeOpExpr("op-1", "implies")
            eng.addExpression(op)
            eng.addExpression(
                makeVarExpr("expr-1", VAR_P.id, { parentId: "op-1" })
            )
            eng.addExpression(
                makeVarExpr("expr-2", VAR_Q.id, { parentId: "op-1" })
            )

            expect(() =>
                eng.addExpression(
                    makeVarExpr("expr-3", VAR_R.id, { parentId: "op-1" })
                )
            ).toThrowError(/can only have two children/)
        })

        it("allows exactly two children under 'iff'", () => {
            const eng = engineWithVars()
            const op = makeOpExpr("op-1", "iff")
            eng.addExpression(op)
            eng.addExpression(
                makeVarExpr("expr-1", VAR_P.id, { parentId: "op-1" })
            )
            eng.addExpression(
                makeVarExpr("expr-2", VAR_Q.id, { parentId: "op-1" })
            )

            expect(() =>
                eng.addExpression(
                    makeVarExpr("expr-3", VAR_R.id, { parentId: "op-1" })
                )
            ).toThrowError(/can only have two children/)
        })

        it("allows more than two children under 'and'", () => {
            const eng = engineWithVars()
            const op = makeOpExpr("op-1", "and")
            eng.addExpression(op)
            eng.addExpression(
                makeVarExpr("expr-1", VAR_P.id, { parentId: "op-1" })
            )
            eng.addExpression(
                makeVarExpr("expr-2", VAR_Q.id, { parentId: "op-1" })
            )

            expect(() =>
                eng.addExpression(
                    makeVarExpr("expr-3", VAR_R.id, { parentId: "op-1" })
                )
            ).not.toThrow()
        })

        it("allows more than two children under 'or'", () => {
            const eng = engineWithVars()
            const op = makeOpExpr("op-1", "or")
            eng.addExpression(op)
            eng.addExpression(
                makeVarExpr("expr-1", VAR_P.id, { parentId: "op-1" })
            )
            eng.addExpression(
                makeVarExpr("expr-2", VAR_Q.id, { parentId: "op-1" })
            )

            expect(() =>
                eng.addExpression(
                    makeVarExpr("expr-3", VAR_R.id, { parentId: "op-1" })
                )
            ).not.toThrow()
        })
    })
})

// ---------------------------------------------------------------------------
// removeExpression
// ---------------------------------------------------------------------------

describe("removeExpression", () => {
    it("returns undefined when the expression does not exist", () => {
        const eng = engineWithVars()
        expect(eng.removeExpression("nonexistent")).toBeUndefined()
    })

    it("removes and returns a root expression", () => {
        const eng = engineWithVars()
        const expr = makeVarExpr("expr-1", VAR_P.id)
        eng.addExpression(expr)

        const removed = eng.removeExpression("expr-1")
        expect(removed).toMatchObject({ id: "expr-1", type: "variable" })
        // Confirm it is gone
        expect(eng.removeExpression("expr-1")).toBeUndefined()
    })

    it("cascades to direct children", () => {
        const eng = engineWithVars()
        eng.addExpression(makeOpExpr("op-1", "and"))
        eng.addExpression(makeVarExpr("expr-1", VAR_P.id, { parentId: "op-1" }))
        eng.addExpression(makeVarExpr("expr-2", VAR_Q.id, { parentId: "op-1" }))

        eng.removeExpression("op-1")

        // Children should be gone
        expect(eng.removeExpression("expr-1")).toBeUndefined()
        expect(eng.removeExpression("expr-2")).toBeUndefined()
    })

    it("cascades recursively through nested descendants", () => {
        const eng = engineWithVars()
        // Build: op-root -> op-inner -> expr-leaf
        eng.addExpression(makeOpExpr("op-root", "not"))
        eng.addExpression(
            makeOpExpr("op-inner", "not", { parentId: "op-root" })
        )
        eng.addExpression(
            makeVarExpr("expr-leaf", VAR_P.id, { parentId: "op-inner" })
        )

        eng.removeExpression("op-root")

        expect(eng.removeExpression("op-inner")).toBeUndefined()
        expect(eng.removeExpression("expr-leaf")).toBeUndefined()
    })

    it("frees the position so it can be reused after removal", () => {
        const eng = engineWithVars()
        eng.addExpression(makeOpExpr("op-1", "and"))
        eng.addExpression(
            makeVarExpr("expr-1", VAR_P.id, { parentId: "op-1", position: 0 })
        )
        eng.removeExpression("expr-1")

        // Position 0 should be available again
        expect(() =>
            eng.addExpression(
                makeVarExpr("expr-2", VAR_Q.id, {
                    parentId: "op-1",
                    position: 0,
                })
            )
        ).not.toThrow()
    })

    it("returns the root expression, not a descendant", () => {
        const eng = engineWithVars()
        const op = makeOpExpr("op-1", "not")
        eng.addExpression(op)
        eng.addExpression(makeVarExpr("expr-1", VAR_P.id, { parentId: "op-1" }))

        const removed = eng.removeExpression("op-1")
        expect(removed).toMatchObject({ id: "op-1", type: "operator" })
    })
})

// ---------------------------------------------------------------------------
// hasVariableReference (tested indirectly via removeVariable)
// ---------------------------------------------------------------------------

describe("hasVariableReference", () => {
    it("reports false when no expression references the variable", () => {
        const eng = engineWithVars()
        // No expressions added — removeVariable should succeed
        expect(() => eng.removeVariable(VAR_P.id)).not.toThrow()
    })

    it("reports true when a variable expression references the variable", () => {
        const eng = engineWithVars()
        eng.addExpression(makeVarExpr("expr-1", VAR_P.id))

        expect(() => eng.removeVariable(VAR_P.id)).toThrowError(
            /Variable "var-p" cannot be removed because it is referenced/
        )
    })

    it("reports false after the referencing expression is removed", () => {
        const eng = engineWithVars()
        eng.addExpression(makeVarExpr("expr-1", VAR_P.id))
        eng.removeExpression("expr-1")

        // Variable should now be removable
        expect(() => eng.removeVariable(VAR_P.id)).not.toThrow()
    })
})

// ---------------------------------------------------------------------------
// Constructor — loadInitialExpressions
// ---------------------------------------------------------------------------

describe("constructor with initial expressions", () => {
    it("loads expressions whose parents come after them in the array", () => {
        // child listed before parent — loader must resolve order
        const op = makeOpExpr("op-1", "and")
        const child = makeVarExpr("expr-1", VAR_P.id, { parentId: "op-1" })

        expect(
            () => new ArgumentEngine(ARG, [VAR_P], [child, op])
        ).not.toThrow()
    })

    it("loads multiple levels of nesting in any order", () => {
        const grandparent = makeOpExpr("gp", "and")
        const parent = makeOpExpr("p", "not", { parentId: "gp" })
        const child = makeVarExpr("c", VAR_P.id, { parentId: "p" })

        // Supply in reverse dependency order
        expect(
            () => new ArgumentEngine(ARG, [VAR_P], [child, parent, grandparent])
        ).not.toThrow()
    })

    it("throws when parent references are unresolvable", () => {
        const orphan = makeVarExpr("expr-1", VAR_P.id, {
            parentId: "does-not-exist",
        })

        expect(() => new ArgumentEngine(ARG, [VAR_P], [orphan])).toThrowError(
            /Could not resolve parent relationships/
        )
    })

    it("allows an empty initial expressions array", () => {
        expect(() => new ArgumentEngine(ARG, [VAR_P], [])).not.toThrow()
    })
})

// ---------------------------------------------------------------------------
// toArray (via ArgumentEngine internal state checks)
// ---------------------------------------------------------------------------

describe("toArray behaviour (via removeExpression round-trips)", () => {
    it("reflects expressions added one-by-one", () => {
        const eng = engineWithVars()
        eng.addExpression(makeOpExpr("op-1", "and"))
        eng.addExpression(makeVarExpr("expr-1", VAR_P.id, { parentId: "op-1" }))
        eng.addExpression(makeVarExpr("expr-2", VAR_Q.id, { parentId: "op-1" }))

        // Confirm all three are present by removing them
        expect(eng.removeExpression("op-1")).toBeDefined()
        expect(eng.removeExpression("expr-1")).toBeUndefined() // cascade-deleted
        expect(eng.removeExpression("expr-2")).toBeUndefined() // cascade-deleted
    })
})
