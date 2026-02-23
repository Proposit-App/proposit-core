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

    it("throws when implies operator is nested inside another expression", () => {
        const eng = engineWithVars()
        eng.addExpression(makeOpExpr("op-root", "and"))

        expect(() =>
            eng.addExpression(
                makeOpExpr("op-inf", "implies", { parentId: "op-root" })
            )
        ).toThrowError(/with "implies" must be a root expression/)
    })

    it("throws when iff operator is nested inside another expression", () => {
        const eng = engineWithVars()
        eng.addExpression(makeOpExpr("op-root", "or"))

        expect(() =>
            eng.addExpression(
                makeOpExpr("op-inf", "iff", { parentId: "op-root" })
            )
        ).toThrowError(/with "iff" must be a root expression/)
    })

    it("throws during construction when an implies op has a non-null parentId", () => {
        const root = makeOpExpr("root", "and")
        const nested = makeOpExpr("inf", "implies", { parentId: "root" })

        expect(() => new ArgumentEngine(ARG, [], [root, nested])).toThrowError(
            /with "implies" must be a root expression/
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
// insertExpression
// ---------------------------------------------------------------------------

describe("insertExpression", () => {
    it("inserts new expression into anchor's slot when only left node is provided", () => {
        const eng = engineWithVars()
        eng.addExpression(makeOpExpr("op-outer", "and"))
        eng.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-outer",
                position: 0,
            })
        )
        // Insert op-inner wrapping expr-p; op-inner should inherit op-outer's slot 0
        eng.insertExpression(makeOpExpr("op-inner", "or"), "expr-p")
        // op-outer → op-inner (pos 0) → expr-p (pos 0)
        expect(eng.toDisplayString()).toBe("((P))")
    })

    it("inserts new expression into anchor's slot when only right node is provided", () => {
        const eng = engineWithVars()
        eng.addExpression(makeVarExpr("expr-p", VAR_P.id))
        // expr-p is root; op-or inherits that root slot, expr-p becomes position 1
        eng.insertExpression(makeOpExpr("op-or", "or"), undefined, "expr-p")
        // Position 1 should now be occupied
        expect(() =>
            eng.addExpression(
                makeVarExpr("expr-q", VAR_Q.id, {
                    parentId: "op-or",
                    position: 1,
                })
            )
        ).toThrowError(/Position 1 is already used/)
        // Position 0 should be free
        expect(() =>
            eng.addExpression(
                makeVarExpr("expr-q", VAR_Q.id, {
                    parentId: "op-or",
                    position: 0,
                })
            )
        ).not.toThrow()
    })

    it("inserts binary expression with leftNode at position 0 and rightNode at position 1", () => {
        const eng = engineWithVars()
        eng.addExpression(makeVarExpr("expr-p", VAR_P.id))
        eng.addExpression(makeVarExpr("expr-q", VAR_Q.id))
        eng.insertExpression(makeOpExpr("op-and", "and"), "expr-p", "expr-q")
        expect(eng.toDisplayString()).toBe("(P ∧ Q)")
    })

    it("inserts not expression as a unary wrapper around its single left child", () => {
        const eng = engineWithVars()
        eng.addExpression(makeVarExpr("expr-p", VAR_P.id))
        eng.insertExpression(makeOpExpr("op-not", "not"), "expr-p")
        expect(eng.toDisplayString()).toBe("¬(P)")
    })

    it("inserts implies expression when anchor is at root (parentId: null)", () => {
        const eng = engineWithVars()
        eng.addExpression(makeVarExpr("expr-p", VAR_P.id))
        eng.addExpression(makeVarExpr("expr-q", VAR_Q.id))
        eng.insertExpression(
            makeOpExpr("op-implies", "implies"),
            "expr-p",
            "expr-q"
        )
        expect(eng.toDisplayString()).toBe("(P → Q)")
    })

    it("throws when neither leftNodeId nor rightNodeId is provided", () => {
        const eng = engineWithVars()
        eng.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            eng.insertExpression(
                makeOpExpr("op-and", "and"),
                undefined,
                undefined
            )
        ).toThrowError(/at least one/)
    })

    it("throws when the expression ID already exists", () => {
        const eng = engineWithVars()
        eng.addExpression(makeVarExpr("expr-p", VAR_P.id))
        eng.addExpression(makeOpExpr("op-and", "and"))
        expect(() =>
            eng.insertExpression(makeOpExpr("op-and", "and"), "expr-p")
        ).toThrowError(/Expression with ID "op-and" already exists/)
    })

    it("throws when not operator is given both left and right nodes", () => {
        const eng = engineWithVars()
        eng.addExpression(makeVarExpr("expr-p", VAR_P.id))
        eng.addExpression(makeVarExpr("expr-q", VAR_Q.id))
        expect(() =>
            eng.insertExpression(
                makeOpExpr("op-not", "not"),
                "expr-p",
                "expr-q"
            )
        ).toThrowError(/"not" can only have one child/)
    })

    it("throws when leftNode is an implies expression", () => {
        const eng = engineWithVars()
        eng.addExpression(makeOpExpr("op-implies", "implies"))
        expect(() =>
            eng.insertExpression(makeOpExpr("op-and", "and"), "op-implies")
        ).toThrowError(/"implies"/)
    })

    it("throws when inserting implies and anchor's parentId is not null", () => {
        const eng = engineWithVars()
        eng.addExpression(makeOpExpr("op-and", "and"))
        eng.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-and", position: 0 })
        )
        // expr-p has a non-null parentId → implies cannot land here
        expect(() =>
            eng.insertExpression(makeOpExpr("op-implies", "implies"), "expr-p")
        ).toThrowError(/must be a root expression/)
    })

    it("throws when leftNodeId and rightNodeId are the same", () => {
        const eng = engineWithVars()
        eng.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            eng.insertExpression(
                makeOpExpr("op-and", "and"),
                "expr-p",
                "expr-p"
            )
        ).toThrowError(/leftNodeId and rightNodeId must be different/)
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

// ---------------------------------------------------------------------------
// Stress test
// ---------------------------------------------------------------------------

describe("stress test", () => {
    interface StressConfig {
        numVars?: number
        numPremises?: number
        minTerms?: number
        maxTerms?: number
    }

    const DEFAULTS = {
        numVars: 10,
        numPremises: 20,
        minTerms: 3,
        maxTerms: 8,
    } satisfies Required<StressConfig>

    /**
     * Mulberry32 PRNG — deterministic, uniform output in [0, 1).
     * Using a seeded PRNG keeps the stress tests reproducible while still
     * exercising a varied distribution of term counts and variable picks.
     */
    function prng(seed: number) {
        let s = seed >>> 0
        return (): number => {
            s = (s + 0x6d2b79f5) >>> 0
            let t = Math.imul(s ^ (s >>> 15), 1 | s)
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
            return ((t ^ (t >>> 14)) >>> 0) / 0x100000000
        }
    }

    function buildStress(cfg: StressConfig = {}, seed = 42) {
        const { numVars, numPremises, minTerms, maxTerms } = {
            ...DEFAULTS,
            ...cfg,
        }
        const rand = prng(seed)
        const pick = (n: number) => Math.floor(rand() * n)
        const bool = (p = 0.5) => rand() < p

        const eng = new ArgumentEngine(ARG)

        const variables = Array.from({ length: numVars }, (_, i) =>
            makeVar(`var-${i}`, `X${i}`)
        )
        for (const variable of variables) {
            eng.addVariable(variable)
        }

        const allExpressions: TPropositionalExpression[] = []
        const premiseIds: string[] = []
        const termIdsByPremise = new Map<string, string[]>()
        const referencedVarIds = new Set<string>()

        function pickVar() {
            const v = variables[pick(numVars)]
            referencedVarIds.add(v.id)
            return v
        }

        function emit(
            expr: TPropositionalExpression
        ): TPropositionalExpression {
            eng.addExpression(expr)
            allExpressions.push(expr)
            return expr
        }

        /**
         * Emit a variable expression, optionally wrapped in a "not" operator.
         * Returns IDs of all expressions added.
         */
        function emitLeaf(
            parentId: string,
            position: number,
            key: string,
            negate: boolean
        ): string[] {
            const v = pickVar()
            const vId = `${key}-v`
            if (negate) {
                const notId = `${key}-not`
                emit(makeOpExpr(notId, "not", { parentId, position }))
                emit(makeVarExpr(vId, v.id, { parentId: notId, position: 0 }))
                return [notId, vId]
            }
            emit(makeVarExpr(vId, v.id, { parentId, position }))
            return [vId]
        }

        /**
         * Emit one side of an inference operator: either a direct (possibly-negated)
         * leaf when numLeaves is 1, or an and/or cluster when numLeaves > 1.
         * Returns IDs of all expressions added.
         */
        function emitSide(
            parentId: string,
            position: number,
            key: string,
            numLeaves: number
        ): string[] {
            if (numLeaves === 1) {
                return emitLeaf(parentId, position, `${key}-s0`, bool(0.25))
            }
            const clusterId = `${key}-cl`
            emit(
                makeOpExpr(clusterId, bool() ? "and" : "or", {
                    parentId,
                    position,
                })
            )
            const ids = [clusterId]
            for (let i = 0; i < numLeaves; i++) {
                ids.push(...emitLeaf(clusterId, i, `${key}-s${i}`, bool(0.25)))
            }
            return ids
        }

        for (let p = 0; p < numPremises; p++) {
            const numSlots = minTerms + pick(maxTerms - minTerms + 1)
            const premiseId = `premise-${p}`
            premiseIds.push(premiseId)

            const termIds: string[] = []

            if (bool()) {
                // Inference premise: implies/iff is the root. Split numSlots
                // between antecedent (position 0) and consequent (position 1),
                // guaranteeing at least one leaf per side.
                const infOp = bool() ? ("implies" as const) : ("iff" as const)
                emit(makeOpExpr(premiseId, infOp))
                const antLeaves = 1 + pick(numSlots - 1)
                const conLeaves = numSlots - antLeaves
                termIds.push(
                    ...emitSide(premiseId, 0, `p${p}-ant`, antLeaves),
                    ...emitSide(premiseId, 1, `p${p}-con`, conLeaves)
                )
            } else {
                // Non-inference premise: and/or root with flat leaf children.
                emit(makeOpExpr(premiseId, bool() ? "and" : "or"))
                for (let t = 0; t < numSlots; t++) {
                    termIds.push(
                        ...emitLeaf(premiseId, t, `p${p}-s${t}`, bool(0.25))
                    )
                }
            }

            termIdsByPremise.set(premiseId, termIds)
        }

        return {
            eng,
            variables,
            premiseIds,
            termIdsByPremise,
            referencedVarIds,
            allExpressions,
        }
    }

    it("builds with default config (10 vars, 20 premises, 3–8 terms)", () => {
        expect(() => buildStress()).not.toThrow()
    })

    it("uses all five logical operators across premises", () => {
        const { allExpressions } = buildStress()
        const usedOps = new Set(
            allExpressions
                .filter((e) => e.type === "operator")
                .map((e) => e.operator)
        )
        expect(usedOps).toContain("and")
        expect(usedOps).toContain("or")
        expect(usedOps).toContain("not")
        expect(usedOps).toContain("implies")
        expect(usedOps).toContain("iff")
    })

    it("builds with high load (100 vars, 200 premises, 5–20 terms)", () => {
        expect(() => {
            buildStress({
                numVars: 100,
                numPremises: 200,
                minTerms: 5,
                maxTerms: 20,
            })
        }).not.toThrow()
    })

    it("removing a premise cascades to all of its terms", () => {
        const { eng, premiseIds, termIdsByPremise } = buildStress()
        const premiseId = premiseIds[0]
        const termIds = termIdsByPremise.get(premiseId)!

        expect(eng.removeExpression(premiseId)).toMatchObject({ id: premiseId })
        for (const termId of termIds) {
            expect(eng.removeExpression(termId)).toBeUndefined()
        }
    })

    it("removing one premise does not affect a different premise", () => {
        const { eng, premiseIds, termIdsByPremise } = buildStress()
        const [first, second] = premiseIds

        eng.removeExpression(first)

        // Second premise root is still present.
        expect(eng.removeExpression(second)).toMatchObject({ id: second })
        // Its terms were cascade-deleted alongside the root.
        for (const termId of termIdsByPremise.get(second)!) {
            expect(eng.removeExpression(termId)).toBeUndefined()
        }
    })

    it("referenced variables cannot be removed while premises exist", () => {
        const { eng, variables, referencedVarIds } = buildStress()
        const referenced = variables.filter((v) => referencedVarIds.has(v.id))
        for (const variable of referenced) {
            expect(() => eng.removeVariable(variable.id)).toThrowError(
                /cannot be removed because it is referenced/
            )
        }
    })

    it("all variables become removable once every premise is removed", () => {
        const { eng, variables, premiseIds } = buildStress()
        for (const premiseId of premiseIds) {
            eng.removeExpression(premiseId)
        }
        for (const variable of variables) {
            expect(() => eng.removeVariable(variable.id)).not.toThrow()
        }
    })

    it("all premises can be removed in reverse order without error", () => {
        const { eng, premiseIds, termIdsByPremise } = buildStress()

        for (const premiseId of [...premiseIds].reverse()) {
            eng.removeExpression(premiseId)
        }

        // Every root and term should now be absent.
        for (const premiseId of premiseIds) {
            expect(eng.removeExpression(premiseId)).toBeUndefined()
        }
        for (const termIds of termIdsByPremise.values()) {
            for (const termId of termIds) {
                expect(eng.removeExpression(termId)).toBeUndefined()
            }
        }
    })

    it("re-adding premises after full teardown succeeds", () => {
        const { eng, variables, premiseIds } = buildStress()

        // Tear everything down.
        for (const premiseId of premiseIds) {
            eng.removeExpression(premiseId)
        }

        // Rebuild a fresh set of premises and confirm they load cleanly.
        const op = makeOpExpr("new-premise-0", "and")
        const term = makeVarExpr("new-term-0", variables[0].id, {
            parentId: "new-premise-0",
            position: 0,
        })
        eng.addExpression(op)
        eng.addExpression(term)

        expect(eng.removeExpression("new-premise-0")).toMatchObject({
            id: "new-premise-0",
        })
    })
})
