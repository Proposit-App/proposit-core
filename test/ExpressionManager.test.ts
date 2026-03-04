import { describe, expect, it } from "vitest"
import { ArgumentEngine, PremiseManager } from "../src/lib/index"
import { Value } from "typebox/value"
import {
    CoreArgumentSchema,
    CorePropositionalVariableSchema,
    CorePremiseSchema,
    type TCoreArgument,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
    type TCorePremise,
} from "../src/lib/schemata"
import { ChangeCollector } from "../src/lib/core/ChangeCollector"
import { VariableManager } from "../src/lib/core/VariableManager"
import type { TVariableInput } from "../src/lib/core/VariableManager"
import type { TExpressionInput } from "../src/lib/core/ExpressionManager"
import {
    DEFAULT_CHECKSUM_CONFIG,
    createChecksumConfig,
} from "../src/lib/consts"
import type { TCoreExpressionAssignment } from "../src/lib/types/evaluation"
import {
    POSITION_MIN,
    POSITION_MAX,
    POSITION_INITIAL,
    midpoint,
} from "../src/lib/utils/position"
import {
    defaultCompareArgument,
    defaultCompareVariable,
    defaultComparePremise,
    defaultCompareExpression,
    diffArguments,
} from "../src/lib/core/diff"
import {
    kleeneNot,
    kleeneAnd,
    kleeneOr,
    kleeneImplies,
    kleeneIff,
} from "../src/lib/core/evaluation/shared"
import {
    buildPremiseProfile,
    analyzePremiseRelationships,
} from "../src/lib/core/relationships"
import {
    computeHash,
    canonicalSerialize,
    entityChecksum,
} from "../src/lib/core/checksum"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ARG: Omit<TCoreArgument, "checksum"> = {
    id: "arg-1",
    version: 1,
}

function makeVar(id: string, symbol: string): TVariableInput {
    return {
        id,
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        symbol,
    }
}

function makeVarExpr(
    id: string,
    variableId: string,
    opts: { parentId?: string | null; position?: number } = {}
): TExpressionInput {
    return {
        id,
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        type: "variable",
        variableId,
        parentId: opts.parentId ?? null,
        position: opts.position ?? POSITION_INITIAL,
    }
}

function makeOpExpr(
    id: string,
    operator: "not" | "and" | "or" | "implies" | "iff",
    opts: { parentId?: string | null; position?: number } = {}
): TExpressionInput {
    return {
        id,
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        type: "operator",
        operator,
        parentId: opts.parentId ?? null,
        position: opts.position ?? POSITION_INITIAL,
    }
}

function makeFormulaExpr(
    id: string,
    opts: { parentId?: string | null; position?: number } = {}
): TExpressionInput {
    return {
        id,
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        type: "formula",
        parentId: opts.parentId ?? null,
        position: opts.position ?? POSITION_INITIAL,
    }
}

const VAR_P = makeVar("var-p", "P")
const VAR_Q = makeVar("var-q", "Q")
const VAR_R = makeVar("var-r", "R")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a premise (via ArgumentEngine) with P, Q, R pre-loaded. */
function premiseWithVars(): PremiseManager {
    const eng = new ArgumentEngine(ARG)
    eng.addVariable(VAR_P)
    eng.addVariable(VAR_Q)
    eng.addVariable(VAR_R)
    const { result: pm } = eng.createPremise()
    return pm
}

/** Create a PremiseManager directly with a deterministic ID (for toData tests). */
function makePremise(extras?: Record<string, unknown>): PremiseManager {
    const vm = new VariableManager()
    return new PremiseManager("premise-1", ARG, vm, extras)
}

// ---------------------------------------------------------------------------
// addExpression
// ---------------------------------------------------------------------------

describe("addExpression", () => {
    it("adds a root variable expression (parentId: null)", () => {
        const premise = premiseWithVars()
        const expr = makeVarExpr("expr-1", VAR_P.id)
        premise.addExpression(expr)
        expect(premise.removeExpression("expr-1").result).toMatchObject({
            id: "expr-1",
        })
    })

    it("adds a root operator expression", () => {
        const premise = premiseWithVars()
        const op = makeOpExpr("op-1", "and")
        premise.addExpression(op)
        expect(premise.removeExpression("op-1").result).toMatchObject({
            id: "op-1",
        })
    })

    it("adds a child expression under an existing operator parent", () => {
        const premise = premiseWithVars()
        const op = makeOpExpr("op-1", "and")
        const child = makeVarExpr("expr-1", VAR_P.id, { parentId: "op-1" })

        premise.addExpression(op)
        premise.addExpression(child)

        // child still present: removing op cascades to child, returning root
        expect(premise.removeExpression("op-1").result).toMatchObject({
            id: "op-1",
        })
    })

    it("throws when an expression with the same ID already exists", () => {
        const premise = premiseWithVars()
        // Use a non-root child so the root-uniqueness check does not fire first
        premise.addExpression(makeOpExpr("op-1", "and"))
        const child = makeVarExpr("expr-1", VAR_P.id, { parentId: "op-1" })
        premise.addExpression(child)
        expect(() => premise.addExpression(child)).toThrowError(
            /Expression with ID "expr-1" already exists/
        )
    })

    it("throws when an expression declares itself as its own parent", () => {
        const premise = premiseWithVars()
        // PM's parent-existence check fires before ExpressionManager's self-parent
        // check — either error is acceptable; both indicate an invalid expression.
        const selfParent = makeVarExpr("expr-1", VAR_P.id, {
            parentId: "expr-1",
        })
        expect(() => premise.addExpression(selfParent)).toThrow()
    })

    it("throws when the parent expression does not exist in this premise", () => {
        const premise = premiseWithVars()
        const orphan = makeVarExpr("expr-1", VAR_P.id, {
            parentId: "ghost-parent",
        })
        expect(() => premise.addExpression(orphan)).toThrowError(
            /Parent expression "ghost-parent" does not exist/
        )
    })

    it("throws when the parent expression is not an operator", () => {
        const premise = premiseWithVars()
        const parent = makeVarExpr("parent-1", VAR_P.id)
        const child = makeVarExpr("child-1", VAR_Q.id, { parentId: "parent-1" })

        premise.addExpression(parent)
        expect(() => premise.addExpression(child)).toThrowError(
            /Parent expression "parent-1" is not an operator expression/
        )
    })

    it("throws when a position is already occupied under the same parent", () => {
        const premise = premiseWithVars()
        const op = makeOpExpr("op-1", "and")
        const child1 = makeVarExpr("expr-1", VAR_P.id, {
            parentId: "op-1",
            position: 0,
        })
        const child2 = makeVarExpr("expr-2", VAR_Q.id, {
            parentId: "op-1",
            position: 0,
        })

        premise.addExpression(op)
        premise.addExpression(child1)
        expect(() => premise.addExpression(child2)).toThrowError(
            /Position 0 is already used under parent "op-1"/
        )
    })

    it("throws when implies operator is nested inside another expression", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeOpExpr("op-root", "and"))

        expect(() =>
            premise.addExpression(
                makeOpExpr("op-inf", "implies", { parentId: "op-root" })
            )
        ).toThrowError(/with "implies" must be a root expression/)
    })

    it("throws when iff operator is nested inside another expression", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeOpExpr("op-root", "or"))

        expect(() =>
            premise.addExpression(
                makeOpExpr("op-inf", "iff", { parentId: "op-root" })
            )
        ).toThrowError(/with "iff" must be a root expression/)
    })

    it("throws when a second root expression is added", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            premise.addExpression(makeVarExpr("expr-q", VAR_Q.id))
        ).toThrowError(/already has a root expression/)
    })

    describe("operator child limits", () => {
        it("allows exactly one child under 'not'", () => {
            const premise = premiseWithVars()
            const op = makeOpExpr("op-1", "not")
            premise.addExpression(op)
            premise.addExpression(
                makeVarExpr("expr-1", VAR_P.id, { parentId: "op-1" })
            )

            expect(() =>
                premise.addExpression(
                    makeVarExpr("expr-2", VAR_Q.id, { parentId: "op-1" })
                )
            ).toThrowError(/can only have one child/)
        })

        it("allows exactly two children under 'implies'", () => {
            const premise = premiseWithVars()
            const op = makeOpExpr("op-1", "implies")
            premise.addExpression(op)
            premise.addExpression(
                makeVarExpr("expr-1", VAR_P.id, {
                    parentId: "op-1",
                    position: 0,
                })
            )
            premise.addExpression(
                makeVarExpr("expr-2", VAR_Q.id, {
                    parentId: "op-1",
                    position: 1,
                })
            )

            expect(() =>
                premise.addExpression(
                    makeVarExpr("expr-3", VAR_R.id, { parentId: "op-1" })
                )
            ).toThrowError(/can only have two children/)
        })

        it("allows exactly two children under 'iff'", () => {
            const premise = premiseWithVars()
            const op = makeOpExpr("op-1", "iff")
            premise.addExpression(op)
            premise.addExpression(
                makeVarExpr("expr-1", VAR_P.id, {
                    parentId: "op-1",
                    position: 0,
                })
            )
            premise.addExpression(
                makeVarExpr("expr-2", VAR_Q.id, {
                    parentId: "op-1",
                    position: 1,
                })
            )

            expect(() =>
                premise.addExpression(
                    makeVarExpr("expr-3", VAR_R.id, { parentId: "op-1" })
                )
            ).toThrowError(/can only have two children/)
        })

        it("allows more than two children under 'and'", () => {
            const premise = premiseWithVars()
            const op = makeOpExpr("op-1", "and")
            premise.addExpression(op)
            premise.addExpression(
                makeVarExpr("expr-1", VAR_P.id, {
                    parentId: "op-1",
                    position: 0,
                })
            )
            premise.addExpression(
                makeVarExpr("expr-2", VAR_Q.id, {
                    parentId: "op-1",
                    position: 1,
                })
            )

            expect(() =>
                premise.addExpression(
                    makeVarExpr("expr-3", VAR_R.id, {
                        parentId: "op-1",
                        position: 2,
                    })
                )
            ).not.toThrow()
        })

        it("allows more than two children under 'or'", () => {
            const premise = premiseWithVars()
            const op = makeOpExpr("op-1", "or")
            premise.addExpression(op)
            premise.addExpression(
                makeVarExpr("expr-1", VAR_P.id, {
                    parentId: "op-1",
                    position: 0,
                })
            )
            premise.addExpression(
                makeVarExpr("expr-2", VAR_Q.id, {
                    parentId: "op-1",
                    position: 1,
                })
            )

            expect(() =>
                premise.addExpression(
                    makeVarExpr("expr-3", VAR_R.id, {
                        parentId: "op-1",
                        position: 2,
                    })
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
        const premise = premiseWithVars()
        premise.addExpression(makeOpExpr("op-outer", "and"))
        premise.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-outer",
                position: 0,
            })
        )
        // Insert op-inner wrapping expr-p; op-inner should inherit op-outer's slot 0
        premise.insertExpression(makeOpExpr("op-inner", "or"), "expr-p")
        // op-outer → op-inner (pos 0) → expr-p (pos 0)
        expect(premise.toDisplayString()).toBe("((P))")
    })

    it("inserts new expression into anchor's slot when only right node is provided", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeVarExpr("expr-p", VAR_P.id))
        // expr-p is root; op-or inherits that root slot, expr-p becomes position 1
        premise.insertExpression(makeOpExpr("op-or", "or"), undefined, "expr-p")
        // Position 1 should now be occupied
        expect(() =>
            premise.addExpression(
                makeVarExpr("expr-q", VAR_Q.id, {
                    parentId: "op-or",
                    position: 1,
                })
            )
        ).toThrowError(/Position 1 is already used/)
        // Position 0 should be free
        expect(() =>
            premise.addExpression(
                makeVarExpr("expr-q", VAR_Q.id, {
                    parentId: "op-or",
                    position: 0,
                })
            )
        ).not.toThrow()
    })

    it("inserts binary expression with leftNode at position 0 and rightNode at position 1", () => {
        const premise = premiseWithVars()
        // Both nodes already exist as siblings in a tree
        premise.addExpression(makeOpExpr("op-or", "or"))
        premise.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-or", position: 0 })
        )
        premise.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-or", position: 1 })
        )
        // Insert op-and wrapping both children; anchor is expr-p (pos 0 under op-or)
        premise.insertExpression(
            makeOpExpr("op-and", "and"),
            "expr-p",
            "expr-q"
        )
        // op-or → [op-and(0) → [expr-p(0), expr-q(1)]]
        expect(premise.toDisplayString()).toBe("((P ∧ Q))")
    })

    it("inserts not expression as a unary wrapper around its single left child", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeVarExpr("expr-p", VAR_P.id))
        premise.insertExpression(makeOpExpr("op-not", "not"), "expr-p")
        expect(premise.toDisplayString()).toBe("¬(P)")
    })

    it("inserts implies expression when anchor is at root (parentId: null)", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeVarExpr("expr-p", VAR_P.id))
        // expr-p is the single root; wrap it in implies (left child), then add right
        premise.insertExpression(makeOpExpr("op-implies", "implies"), "expr-p")
        premise.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-implies",
                position: 1,
            })
        )
        expect(premise.toDisplayString()).toBe("(P → Q)")
    })

    it("throws when neither leftNodeId nor rightNodeId is provided", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            premise.insertExpression(
                makeOpExpr("op-and", "and"),
                undefined,
                undefined
            )
        ).toThrowError(/at least one/)
    })

    it("throws when the expression ID already exists", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeVarExpr("expr-p", VAR_P.id))
        premise.insertExpression(makeOpExpr("op-and", "and"), "expr-p")
        expect(() =>
            premise.insertExpression(makeOpExpr("op-and", "and"), "expr-p")
        ).toThrowError(/Expression with ID "op-and" already exists/)
    })

    it("throws when not operator is given both left and right nodes", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeOpExpr("op-or", "or"))
        premise.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-or", position: 0 })
        )
        premise.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-or", position: 1 })
        )
        expect(() =>
            premise.insertExpression(
                makeOpExpr("op-not", "not"),
                "expr-p",
                "expr-q"
            )
        ).toThrowError(/"not" can only have one child/)
    })

    it("throws when leftNode is an implies expression", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeOpExpr("op-implies", "implies"))
        expect(() =>
            premise.insertExpression(makeOpExpr("op-and", "and"), "op-implies")
        ).toThrowError(/"implies"/)
    })

    it("throws when inserting implies and anchor's parentId is not null", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeOpExpr("op-and", "and"))
        premise.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-and", position: 0 })
        )
        // expr-p has a non-null parentId → implies cannot land here
        expect(() =>
            premise.insertExpression(
                makeOpExpr("op-implies", "implies"),
                "expr-p"
            )
        ).toThrowError(/must be a root expression/)
    })

    it("throws when leftNodeId and rightNodeId are the same", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            premise.insertExpression(
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
        const premise = premiseWithVars()
        expect(premise.removeExpression("nonexistent").result).toBeUndefined()
    })

    it("removes and returns a root expression", () => {
        const premise = premiseWithVars()
        const expr = makeVarExpr("expr-1", VAR_P.id)
        premise.addExpression(expr)

        const { result: removed } = premise.removeExpression("expr-1")
        expect(removed).toMatchObject({ id: "expr-1", type: "variable" })
        // Confirm it is gone
        expect(premise.removeExpression("expr-1").result).toBeUndefined()
    })

    it("cascades to direct children", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeOpExpr("op-1", "and"))
        premise.addExpression(
            makeVarExpr("expr-1", VAR_P.id, {
                parentId: "op-1",
                position: 0,
            })
        )
        premise.addExpression(
            makeVarExpr("expr-2", VAR_Q.id, {
                parentId: "op-1",
                position: 1,
            })
        )

        premise.removeExpression("op-1")

        // Children should be gone
        expect(premise.removeExpression("expr-1").result).toBeUndefined()
        expect(premise.removeExpression("expr-2").result).toBeUndefined()
    })

    it("cascades recursively through nested descendants", () => {
        const premise = premiseWithVars()
        // Build: op-root -> op-inner -> expr-leaf
        premise.addExpression(makeOpExpr("op-root", "not"))
        premise.addExpression(
            makeOpExpr("op-inner", "not", { parentId: "op-root" })
        )
        premise.addExpression(
            makeVarExpr("expr-leaf", VAR_P.id, { parentId: "op-inner" })
        )

        premise.removeExpression("op-root")

        expect(premise.removeExpression("op-inner").result).toBeUndefined()
        expect(premise.removeExpression("expr-leaf").result).toBeUndefined()
    })

    it("frees the position so it can be reused after removal", () => {
        const premise = premiseWithVars()
        // Use three children so removing one leaves two — no collapse occurs.
        premise.addExpression(makeOpExpr("op-1", "and"))
        premise.addExpression(
            makeVarExpr("expr-1", VAR_P.id, { parentId: "op-1", position: 0 })
        )
        premise.addExpression(
            makeVarExpr("expr-2", VAR_Q.id, { parentId: "op-1", position: 1 })
        )
        premise.addExpression(
            makeVarExpr("expr-3", VAR_R.id, { parentId: "op-1", position: 2 })
        )
        premise.removeExpression("expr-1")

        // Position 0 should be available again
        expect(() =>
            premise.addExpression(
                makeVarExpr("expr-4", VAR_P.id, {
                    parentId: "op-1",
                    position: 0,
                })
            )
        ).not.toThrow()
    })

    it("returns the root expression, not a descendant", () => {
        const premise = premiseWithVars()
        const op = makeOpExpr("op-1", "not")
        premise.addExpression(op)
        premise.addExpression(
            makeVarExpr("expr-1", VAR_P.id, { parentId: "op-1" })
        )

        const { result: removed } = premise.removeExpression("op-1")
        expect(removed).toMatchObject({ id: "op-1", type: "operator" })
    })
})

// ---------------------------------------------------------------------------
// removeExpression — operator collapse
// ---------------------------------------------------------------------------

describe("removeExpression — operator collapse", () => {
    it("removes a childless operator when its only child is removed", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeOpExpr("op-not", "not"))
        premise.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-not" })
        )

        premise.removeExpression("expr-p")

        // op-not had 0 children remaining and must have been auto-deleted
        expect(premise.removeExpression("op-not").result).toBeUndefined()
        expect(premise.toDisplayString()).toBe("")
    })

    it("promotes the surviving child when a binary operator loses one child", () => {
        const premise = premiseWithVars()
        // op-and (root) → [expr-p (pos 0), expr-q (pos 1)]
        premise.addExpression(makeOpExpr("op-and", "and"))
        premise.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-and", position: 0 })
        )
        premise.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-and", position: 1 })
        )

        premise.removeExpression("expr-p")

        // op-and had 1 child left → it is removed, expr-q is promoted to root
        expect(premise.removeExpression("op-and").result).toBeUndefined()
        // expr-q is now the root
        expect(premise.toDisplayString()).toBe("Q")
    })

    it("cascades collapse up multiple levels", () => {
        const premise = premiseWithVars()
        // op-outer (and, root) → [op-inner (not, pos 0) → expr-p, expr-q (pos 1)]
        premise.addExpression(makeOpExpr("op-outer", "and"))
        premise.addExpression(
            makeOpExpr("op-inner", "not", { parentId: "op-outer", position: 0 })
        )
        premise.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-inner" })
        )
        premise.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-outer",
                position: 1,
            })
        )

        // Remove expr-p → op-inner (0 children) is deleted
        // → op-outer now has 1 child (expr-q) → op-outer is deleted, expr-q promoted to root
        premise.removeExpression("expr-p")

        expect(premise.removeExpression("op-inner").result).toBeUndefined()
        expect(premise.removeExpression("op-outer").result).toBeUndefined()
        expect(premise.toDisplayString()).toBe("Q")
    })

    it("promotes the surviving child to a non-root slot (nested collapse)", () => {
        const premise = premiseWithVars()
        // op-root (or, root) → [op-and (pos 0) → [expr-p (pos 0), expr-q (pos 1)], expr-r (pos 1)]
        premise.addExpression(makeOpExpr("op-root", "or"))
        premise.addExpression(
            makeOpExpr("op-and", "and", { parentId: "op-root", position: 0 })
        )
        premise.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-and", position: 0 })
        )
        premise.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-and", position: 1 })
        )
        premise.addExpression(
            makeVarExpr("expr-r", VAR_R.id, {
                parentId: "op-root",
                position: 1,
            })
        )

        // Remove expr-p → op-and has 1 child (expr-q)
        // op-and is removed; expr-q is promoted into op-and's slot under op-root (pos 0)
        // op-root now has 2 children: expr-q (pos 0) and expr-r (pos 1) — no further collapse
        premise.removeExpression("expr-p")

        expect(premise.removeExpression("op-and").result).toBeUndefined()
        // op-root still exists with expr-q and expr-r as children
        expect(premise.toDisplayString()).toBe("(Q ∨ R)")
    })

    it("does not collapse an operator that still has two or more children", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeOpExpr("op-and", "and"))
        premise.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-and", position: 0 })
        )
        premise.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-and", position: 1 })
        )
        premise.addExpression(
            makeVarExpr("expr-r", VAR_R.id, { parentId: "op-and", position: 2 })
        )

        premise.removeExpression("expr-p")

        // op-and still has expr-q and expr-r — must survive
        expect(premise.toDisplayString()).toBe("(Q ∧ R)")
    })

    it("promotes the surviving child of implies to the root", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeOpExpr("op-implies", "implies"))
        premise.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-implies",
                position: 0,
            })
        )
        premise.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-implies",
                position: 1,
            })
        )

        premise.removeExpression("expr-p")

        // op-implies is removed; expr-q (the consequent) is promoted to root
        expect(premise.removeExpression("op-implies").result).toBeUndefined()
        expect(premise.toDisplayString()).toBe("Q")
    })
})

// ---------------------------------------------------------------------------
// removeVariable
// ---------------------------------------------------------------------------

describe("removeVariable", () => {
    it("succeeds when no expression references the variable", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        eng.addVariable(VAR_R)
        eng.createPremise()
        // No expressions added — removeVariable should succeed
        expect(() => eng.removeVariable(VAR_P.id)).not.toThrow()
    })

    it("cascade-deletes expressions when a referenced variable is removed", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        eng.addVariable(VAR_R)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeVarExpr("expr-1", VAR_P.id))

        const { result } = eng.removeVariable(VAR_P.id)
        expect(result).toBeDefined()
        expect(result!.id).toBe(VAR_P.id)
        // Expression should also be gone
        expect(pm.getExpression("expr-1")).toBeUndefined()
    })

    it("succeeds after the referencing expression is manually removed", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        eng.addVariable(VAR_R)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeVarExpr("expr-1", VAR_P.id))
        pm.removeExpression("expr-1")

        // Variable should now be removable
        expect(() => eng.removeVariable(VAR_P.id)).not.toThrow()
    })
})

// ---------------------------------------------------------------------------
// addExpression ordering
// ---------------------------------------------------------------------------

describe("addExpression ordering", () => {
    it("adding a child before its parent throws", () => {
        const premise = premiseWithVars()
        const child = makeVarExpr("expr-1", VAR_P.id, { parentId: "op-1" })
        // op-1 has not been added yet — PM requires parent-first ordering
        expect(() => premise.addExpression(child)).toThrowError(
            /does not exist in this premise/
        )
    })

    it("adding parent first then child succeeds", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeOpExpr("op-1", "and"))
        expect(() =>
            premise.addExpression(
                makeVarExpr("expr-1", VAR_P.id, { parentId: "op-1" })
            )
        ).not.toThrow()
    })
})

// ---------------------------------------------------------------------------
// toArray behaviour (via toData().expressions)
// ---------------------------------------------------------------------------

describe("toArray behaviour (via toData().expressions)", () => {
    it("reflects expressions added one-by-one", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeOpExpr("op-1", "and"))
        premise.addExpression(
            makeVarExpr("expr-1", VAR_P.id, { parentId: "op-1", position: 0 })
        )
        premise.addExpression(
            makeVarExpr("expr-2", VAR_Q.id, { parentId: "op-1", position: 1 })
        )

        const ids = premise
            .toData()
            .expressions.map((e) => e.id)
            .sort()
        expect(ids).toEqual(["expr-1", "expr-2", "op-1"].sort())
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

        const allExpressions: TExpressionInput[] = []
        const premiseManagers: PremiseManager[] = []
        const termIdsByPremise = new Map<PremiseManager, string[]>()
        const referencedVarIds = new Set<string>()

        function pickVar() {
            const v = variables[pick(numVars)]
            referencedVarIds.add(v.id)
            return v
        }

        function emit(
            pm: PremiseManager,
            expr: TExpressionInput
        ): TExpressionInput {
            pm.addExpression(expr)
            allExpressions.push(expr)
            return expr
        }

        function emitLeaf(
            pm: PremiseManager,
            parentId: string,
            position: number,
            key: string,
            negate: boolean
        ): string[] {
            const v = pickVar()
            const vId = `${key}-v`
            if (negate) {
                const notId = `${key}-not`
                emit(pm, makeOpExpr(notId, "not", { parentId, position }))
                emit(
                    pm,
                    makeVarExpr(vId, v.id, { parentId: notId, position: 0 })
                )
                return [notId, vId]
            }
            emit(pm, makeVarExpr(vId, v.id, { parentId, position }))
            return [vId]
        }

        function emitSide(
            pm: PremiseManager,
            parentId: string,
            position: number,
            key: string,
            numLeaves: number
        ): string[] {
            if (numLeaves === 1) {
                return emitLeaf(pm, parentId, position, `${key}-s0`, bool(0.25))
            }
            const clusterId = `${key}-cl`
            emit(
                pm,
                makeOpExpr(clusterId, bool() ? "and" : "or", {
                    parentId,
                    position,
                })
            )
            const ids = [clusterId]
            for (let i = 0; i < numLeaves; i++) {
                ids.push(
                    ...emitLeaf(pm, clusterId, i, `${key}-s${i}`, bool(0.25))
                )
            }
            return ids
        }

        for (const v of variables) eng.addVariable(v)

        for (let p = 0; p < numPremises; p++) {
            const { result: pm } = eng.createPremise({ title: `premise-${p}` })
            premiseManagers.push(pm)

            const numSlots = minTerms + pick(maxTerms - minTerms + 1)
            const premiseRootId = `premise-${p}`
            const termIds: string[] = []

            if (bool()) {
                // Inference premise: implies/iff is the root
                const infOp = bool() ? ("implies" as const) : ("iff" as const)
                emit(pm, makeOpExpr(premiseRootId, infOp))
                const antLeaves = 1 + pick(numSlots - 1)
                const conLeaves = numSlots - antLeaves
                termIds.push(
                    ...emitSide(pm, premiseRootId, 0, `p${p}-ant`, antLeaves),
                    ...emitSide(pm, premiseRootId, 1, `p${p}-con`, conLeaves)
                )
            } else {
                // Non-inference premise: and/or root with flat leaf children
                emit(pm, makeOpExpr(premiseRootId, bool() ? "and" : "or"))
                for (let t = 0; t < numSlots; t++) {
                    termIds.push(
                        ...emitLeaf(
                            pm,
                            premiseRootId,
                            t,
                            `p${p}-s${t}`,
                            bool(0.25)
                        )
                    )
                }
            }

            termIdsByPremise.set(pm, termIds)
        }

        return {
            eng,
            variables,
            premiseManagers,
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
        const { premiseManagers, termIdsByPremise } = buildStress()
        const pm = premiseManagers[0]
        const rootId = pm.toData().rootExpressionId!
        const termIds = termIdsByPremise.get(pm)!

        expect(pm.removeExpression(rootId).result).toMatchObject({ id: rootId })
        for (const termId of termIds) {
            expect(pm.removeExpression(termId).result).toBeUndefined()
        }
    })

    it("removing one premise does not affect a different premise", () => {
        const { premiseManagers, termIdsByPremise } = buildStress()
        const [pm1, pm2] = premiseManagers
        const root2 = pm2.toData().rootExpressionId!

        pm1.removeExpression(pm1.toData().rootExpressionId!)

        // Second premise root is still present
        expect(pm2.removeExpression(root2).result).toMatchObject({ id: root2 })
        for (const termId of termIdsByPremise.get(pm2)!) {
            expect(pm2.removeExpression(termId).result).toBeUndefined()
        }
    })

    it("removing a variable cascade-deletes referencing expressions across premises", () => {
        const { eng, variables, premiseManagers } = buildStress()
        // Pick a variable that is referenced somewhere
        const referencedVar = variables[0]
        const hadExpressions = premiseManagers.some((pm) =>
            pm.toData().variables.includes(referencedVar.id)
        )
        expect(hadExpressions).toBe(true)

        // Cascade removal should succeed
        const { result } = eng.removeVariable(referencedVar.id)
        expect(result).toBeDefined()
        expect(result!.id).toBe(referencedVar.id)

        // No premise should reference the variable anymore
        for (const pm of premiseManagers) {
            expect(pm.toData().variables).not.toContain(referencedVar.id)
        }
    })

    it("all variables become removable via engine", () => {
        const { eng, variables } = buildStress()
        for (const v of variables) {
            expect(() => eng.removeVariable(v.id)).not.toThrow()
        }
    })

    it("all premises can be removed in reverse order without error", () => {
        const { premiseManagers } = buildStress()

        for (const pm of [...premiseManagers].reverse()) {
            pm.removeExpression(pm.toData().rootExpressionId!)
        }

        for (const pm of premiseManagers) {
            expect(pm.toData().rootExpressionId).toBeUndefined()
        }
    })

    it("re-adding a premise after full teardown succeeds", () => {
        const { eng, premiseManagers } = buildStress()

        for (const pm of premiseManagers) {
            pm.removeExpression(pm.toData().rootExpressionId!)
        }

        const { result: newPm } = eng.createPremise({ title: "rebuilt" })
        // Variables are already registered at engine level
        newPm.addExpression(makeOpExpr("new-root", "and"))
        expect(newPm.toData().rootExpressionId).toBe("new-root")
    })

    it("all expressions appear in exactly one premise", () => {
        const { premiseManagers, allExpressions } = buildStress()
        const counts = new Map<string, number>()
        for (const pm of premiseManagers) {
            for (const expr of pm.toData().expressions) {
                counts.set(expr.id, (counts.get(expr.id) ?? 0) + 1)
            }
        }
        for (const expr of allExpressions) {
            expect(counts.get(expr.id)).toBe(1)
        }
    })

    it("all referenced variables appear in at least one premise", () => {
        const { premiseManagers, referencedVarIds } = buildStress()
        const variableIdsInPremises = new Set<string>()
        for (const pm of premiseManagers) {
            for (const v of pm.toData().variables) {
                variableIdsInPremises.add(v)
            }
        }
        for (const varId of referencedVarIds) {
            expect(variableIdsInPremises.has(varId)).toBe(true)
        }
    })
})

// ---------------------------------------------------------------------------
// formula expression type
// ---------------------------------------------------------------------------

describe("formula", () => {
    it("adds a root formula expression", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeFormulaExpr("f-1"))
        expect(premise.removeExpression("f-1").result).toMatchObject({
            id: "f-1",
            type: "formula",
        })
    })

    it("adds a variable child inside a formula", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeFormulaExpr("f-1"))
        premise.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "f-1" })
        )
        expect(premise.toDisplayString()).toBe("(P)")
    })

    it("renders nested formulas as double parentheses", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeFormulaExpr("f-outer"))
        premise.addExpression(
            makeFormulaExpr("f-inner", { parentId: "f-outer" })
        )
        premise.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "f-inner" })
        )
        expect(premise.toDisplayString()).toBe("((P))")
    })

    it("renders a formula wrapping an operator subtree", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeFormulaExpr("f-1"))
        premise.addExpression(makeOpExpr("op-and", "and", { parentId: "f-1" }))
        premise.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-and",
                position: 0,
            })
        )
        premise.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-and",
                position: 1,
            })
        )
        expect(premise.toDisplayString()).toBe("((P ∧ Q))")
    })

    it("throws when adding a second child to a formula", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeFormulaExpr("f-1"))
        premise.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "f-1" })
        )
        expect(() =>
            premise.addExpression(
                makeVarExpr("expr-q", VAR_Q.id, { parentId: "f-1" })
            )
        ).toThrowError(/Formula expression "f-1" can only have one child/)
    })

    it("throws when the parent expression is a variable (not formula or operator)", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            premise.addExpression(
                makeVarExpr("expr-q", VAR_Q.id, { parentId: "expr-p" })
            )
        ).toThrowError(/is not an operator expression/)
    })

    it("collapses the formula when its only child is removed", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeFormulaExpr("f-1"))
        premise.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "f-1" })
        )

        premise.removeExpression("expr-p")

        // Formula had 0 children remaining and must have been auto-deleted.
        expect(premise.removeExpression("f-1").result).toBeUndefined()
        expect(premise.toDisplayString()).toBe("")
    })

    it("cascades formula collapse up multiple levels", () => {
        const premise = premiseWithVars()
        // op-and (root) → [f-outer (pos 0) → f-inner → expr-p, expr-q (pos 1)]
        premise.addExpression(makeOpExpr("op-and", "and"))
        premise.addExpression(
            makeFormulaExpr("f-outer", { parentId: "op-and", position: 0 })
        )
        premise.addExpression(
            makeFormulaExpr("f-inner", { parentId: "f-outer" })
        )
        premise.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "f-inner" })
        )
        premise.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-and",
                position: 1,
            })
        )

        // Remove expr-p → f-inner collapses (0 children)
        // → f-outer collapses (0 children)
        // → op-and has 1 child left (expr-q) → op-and collapses, expr-q promoted to root
        premise.removeExpression("expr-p")

        expect(premise.removeExpression("f-inner").result).toBeUndefined()
        expect(premise.removeExpression("f-outer").result).toBeUndefined()
        expect(premise.removeExpression("op-and").result).toBeUndefined()
        expect(premise.toDisplayString()).toBe("Q")
    })

    it("insertExpression wraps a node in a formula", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeVarExpr("expr-p", VAR_P.id))
        premise.insertExpression(makeFormulaExpr("f-1"), "expr-p")
        expect(premise.toDisplayString()).toBe("(P)")
    })

    it("insertExpression throws when formula is given both left and right nodes", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeOpExpr("op-or", "or"))
        premise.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-or", position: 0 })
        )
        premise.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-or", position: 1 })
        )
        expect(() =>
            premise.insertExpression(makeFormulaExpr("f-1"), "expr-p", "expr-q")
        ).toThrowError(/Formula expression "f-1" can only have one child/)
    })

    it("a formula can be nested inside an operator", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeOpExpr("op-and", "and"))
        premise.addExpression(
            makeFormulaExpr("f-1", { parentId: "op-and", position: 0 })
        )
        premise.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "f-1" })
        )
        premise.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-and",
                position: 1,
            })
        )
        expect(premise.toDisplayString()).toBe("((P) ∧ Q)")
    })
})

// ---------------------------------------------------------------------------
// ArgumentEngine premise CRUD
// ---------------------------------------------------------------------------

describe("ArgumentEngine premise CRUD", () => {
    it("createPremise returns a PremiseManager with a generated ID", () => {
        const eng = new ArgumentEngine(ARG)
        const { result: pm } = eng.createPremise({ title: "test" })
        expect(pm.toData().id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        )
        expect((pm.toData() as Record<string, unknown>).title).toBe("test")
    })

    it("getPremise(id) returns the same instance", () => {
        const eng = new ArgumentEngine(ARG)
        const { result: pm } = eng.createPremise()
        expect(eng.getPremise(pm.toData().id)).toBe(pm)
    })

    it("getPremise returns undefined for unknown IDs", () => {
        const eng = new ArgumentEngine(ARG)
        expect(eng.getPremise("unknown")).toBeUndefined()
    })

    it("removePremise causes getPremise to return undefined", () => {
        const eng = new ArgumentEngine(ARG)
        const { result: pm } = eng.createPremise()
        const { id } = pm.toData()
        eng.removePremise(id)
        expect(eng.getPremise(id)).toBeUndefined()
    })

    it("multiple premises coexist independently", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm1 } = eng.createPremise({ title: "first" })
        const { result: pm2 } = eng.createPremise({ title: "second" })
        pm1.addExpression(makeVarExpr("expr-p", VAR_P.id))
        pm2.addExpression(makeVarExpr("expr-q", VAR_Q.id))
        expect(pm1.toData().expressions).toHaveLength(1)
        expect(pm2.toData().expressions).toHaveLength(1)
        expect(pm1.getExpression("expr-q")).toBeUndefined()
        expect(pm2.getExpression("expr-p")).toBeUndefined()
    })
})

// ---------------------------------------------------------------------------
// PremiseManager
// ---------------------------------------------------------------------------

describe("ArgumentEngine — addVariable / removeVariable", () => {
    it("registers a variable and allows it to be referenced in a premise", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(pm.getExpression("expr-p")).toMatchObject({ id: "expr-p" })
    })

    it("throws when adding a duplicate variable symbol", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        expect(() => eng.addVariable(makeVar("var-p2", "P"))).toThrowError(
            /already exists/
        )
    })

    it("removes an unreferenced variable", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        expect(eng.removeVariable(VAR_P.id).result).toMatchObject({
            id: VAR_P.id,
        })
    })

    it("cascade-deletes expressions when removing a referenced variable", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))

        const { result, changes } = eng.removeVariable(VAR_P.id)
        expect(result).toMatchObject({ id: VAR_P.id })
        // The expression referencing VAR_P should have been cascade-deleted
        expect(pm.getExpression("expr-p")).toBeUndefined()
        expect(changes.expressions?.removed).toHaveLength(1)
        expect(changes.expressions?.removed[0].id).toBe("expr-p")
    })

    it("throws when adding an expression that references an unregistered variable", () => {
        const eng = new ArgumentEngine(ARG)
        const { result: pm } = eng.createPremise()
        expect(() =>
            pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        ).toThrowError(/references non-existent variable/)
    })

    it("throws when the variable does not belong to this argument", () => {
        const eng = new ArgumentEngine(ARG)
        const foreignVar = {
            ...makeVar("var-f", "F"),
            argumentId: "other-arg",
            argumentVersion: 99,
        }
        expect(() => eng.addVariable(foreignVar)).toThrowError(/does not match/)
    })
})

describe("PremiseManager — single-root enforcement", () => {
    it("accepts the first root expression", () => {
        const pm = premiseWithVars()
        expect(() =>
            pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        ).not.toThrow()
    })

    it("throws when a second root expression is added", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            pm.addExpression(makeVarExpr("expr-q", VAR_Q.id))
        ).toThrowError(/already has a root expression/)
    })

    it("throws when the parent is not in this premise", () => {
        const pm = premiseWithVars()
        expect(() =>
            pm.addExpression(
                makeVarExpr("expr-p", VAR_P.id, { parentId: "ghost" })
            )
        ).toThrowError(/does not exist in this premise/)
    })

    it("allows a new root after the old root is removed (premise emptied)", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        pm.removeExpression("expr-p")
        expect(() =>
            pm.addExpression(makeVarExpr("expr-q", VAR_Q.id))
        ).not.toThrow()
    })
})

describe("PremiseManager — addExpression / removeExpression / insertExpression", () => {
    it("builds a tree and getExpression finds each node", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-and", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-and", position: 1 })
        )
        expect(pm.getExpression("op-and")).toMatchObject({ type: "operator" })
        expect(pm.getExpression("expr-p")).toMatchObject({ type: "variable" })
    })

    it("removeExpression cascades through descendants", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-and", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-and", position: 1 })
        )
        pm.removeExpression("op-and")
        expect(pm.getExpression("op-and")).toBeUndefined()
        expect(pm.getExpression("expr-p")).toBeUndefined()
        expect(pm.getExpression("expr-q")).toBeUndefined()
    })

    it("removeExpression cleans up variable references in expressionsByVariableId", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-not", "not"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-not" })
        )
        // Removing the root cascades to expr-p; the variable tracking should be cleaned up.
        pm.removeExpression("op-not")
        // deleteExpressionsUsingVariable should be a no-op since all refs are already gone
        const { result } = pm.deleteExpressionsUsingVariable(VAR_P.id)
        expect(result).toEqual([])
    })

    it("insertExpression wraps a node and toDisplayString reflects it", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        pm.insertExpression(makeOpExpr("op-not", "not"), "expr-p")
        expect(pm.toDisplayString()).toBe("¬(P)")
    })

    it("rootExpressionId updates when collapse promotes a new root", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-and", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-and", position: 1 })
        )
        // Removing expr-p leaves op-and with 1 child; op-and is collapsed and
        // expr-q is promoted to root.
        pm.removeExpression("expr-p")
        expect(pm.toData().rootExpressionId).toBe("expr-q")
        expect(pm.toDisplayString()).toBe("Q")
    })
})

describe("PremiseManager — toDisplayString", () => {
    it("returns empty string when the premise is empty", () => {
        expect(makePremise().toDisplayString()).toBe("")
    })

    it("renders a binary operator", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-and", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-and", position: 1 })
        )
        expect(pm.toDisplayString()).toBe("(P ∧ Q)")
    })

    it("renders an implies root", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-impl", "implies"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-impl",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-impl",
                position: 1,
            })
        )
        expect(pm.toDisplayString()).toBe("(P → Q)")
    })

    it("renders a formula wrapper", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeFormulaExpr("f-1"))
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id, { parentId: "f-1" }))
        expect(pm.toDisplayString()).toBe("(P)")
    })
})

describe("PremiseManager — toData", () => {
    it("returns correct id and extras", () => {
        const pm = new PremiseManager("my-id", ARG, new VariableManager(), {
            title: "My Premise",
        })
        const data = pm.toData()
        expect(data.id).toBe("my-id")
        expect((data as Record<string, unknown>).title).toBe("My Premise")
    })

    it("rootExpressionId is absent before any expression is added", () => {
        expect(makePremise().toData().rootExpressionId).toBeUndefined()
    })

    it("rootExpressionId is set after adding the root expression", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(pm.toData().rootExpressionId).toBe("expr-p")
    })

    it("isConstraint for non-inference roots", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        expect(pm.isConstraint()).toBe(true)
        expect(pm.isInference()).toBe(false)
    })

    it("isInference for an implies root", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-impl", "implies"))
        expect(pm.isInference()).toBe(true)
        expect(pm.isConstraint()).toBe(false)
    })

    it("isInference for an iff root", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-iff", "iff"))
        expect(pm.isInference()).toBe(true)
        expect(pm.isConstraint()).toBe(false)
    })

    it("isConstraint when the premise is empty", () => {
        expect(makePremise().isConstraint()).toBe(true)
        expect(makePremise().isInference()).toBe(false)
    })

    it("variables contains only referenced variables without duplicates", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p1", VAR_P.id, {
                parentId: "op-and",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-p2", VAR_P.id, {
                parentId: "op-and",
                position: 1,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-and", position: 2 })
        )
        const { variables } = pm.toData()
        expect([...variables].sort()).toEqual([VAR_P.id, VAR_Q.id].sort())
    })

    it("variables does not include registered-but-unreferenced variables", () => {
        const pm = premiseWithVars() // P, Q, R all registered
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id)) // only P referenced
        const { variables } = pm.toData()
        expect(variables).toEqual([VAR_P.id])
    })

    it("expressions contains all nodes in the tree", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-and", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-and", position: 1 })
        )
        const ids = pm
            .toData()
            .expressions.map((e) => e.id)
            .sort()
        expect(ids).toEqual(["expr-p", "expr-q", "op-and"].sort())
    })
})

// ---------------------------------------------------------------------------
// Evaluation support plan
// ---------------------------------------------------------------------------

describe("PremiseManager — validation and evaluation", () => {
    it("validateEvaluability reports empty premise", () => {
        const pm = makePremise()
        const result = pm.validateEvaluability()
        expect(result.ok).toBe(false)
        expect(result.issues.map((i) => i.code)).toContain("PREMISE_EMPTY")
    })

    it("evaluates a simple implication with diagnostics", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("impl", "implies"))
        pm.addExpression(
            makeVarExpr("p-expr", VAR_P.id, { parentId: "impl", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("q-expr", VAR_Q.id, { parentId: "impl", position: 1 })
        )

        const result = pm.evaluate({
            variables: { [VAR_P.id]: true, [VAR_Q.id]: false },
            rejectedExpressionIds: [],
        })
        expect(result.rootValue).toBe(false)
        expect(result.premiseType).toBe("inference")
        expect(result.inferenceDiagnostic).toMatchObject({
            kind: "implies",
            antecedentTrue: true,
            consequentTrue: false,
            fired: true,
            firedAndHeld: false,
            isVacuouslyTrue: false,
        })
    })

    it("evaluates iff with directional vacuity diagnostics", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("iff", "iff"))
        pm.addExpression(
            makeVarExpr("p-expr", VAR_P.id, { parentId: "iff", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("q-expr", VAR_Q.id, { parentId: "iff", position: 1 })
        )

        const result = pm.evaluate({
            variables: { [VAR_P.id]: false, [VAR_Q.id]: true },
            rejectedExpressionIds: [],
        })
        expect(result.rootValue).toBe(false)
        expect(result.inferenceDiagnostic).toMatchObject({
            kind: "iff",
            bothSidesTrue: false,
            bothSidesFalse: false,
        })
        if (result.inferenceDiagnostic?.kind === "iff") {
            expect(result.inferenceDiagnostic.leftToRight.isVacuouslyTrue).toBe(
                true
            )
            expect(result.inferenceDiagnostic.rightToLeft.fired).toBe(true)
        }
    })
})

describe("ArgumentEngine — roles and evaluation", () => {
    function buildPremiseP(pm: PremiseManager) {
        pm.addExpression(makeVarExpr(`${pm.getId()}-p`, VAR_P.id))
    }

    function buildPremiseQ(pm: PremiseManager) {
        pm.addExpression(makeVarExpr(`${pm.getId()}-q`, VAR_Q.id))
    }

    function buildPremiseImplies(pm: PremiseManager) {
        const rootId = `${pm.getId()}-impl`
        pm.addExpression(makeOpExpr(rootId, "implies"))
        pm.addExpression(
            makeVarExpr(`${rootId}-p`, VAR_P.id, {
                parentId: rootId,
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr(`${rootId}-q`, VAR_Q.id, {
                parentId: rootId,
                position: 1,
            })
        )
    }

    it("supports role APIs and removes roles when a premise is deleted", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: support } = eng.createPremise({ title: "support" })
        const { result: conclusion } = eng.createPremise({
            title: "conclusion",
        })
        buildPremiseImplies(support)
        buildPremiseImplies(conclusion)

        eng.setConclusionPremise(conclusion.getId())

        // support is an inference premise and not the conclusion, so it is automatically supporting
        expect(eng.listSupportingPremises().map((pm) => pm.getId())).toEqual([
            support.getId(),
        ])
        expect(eng.getRoleState()).toMatchObject({
            conclusionPremiseId: conclusion.getId(),
        })

        eng.removePremise(conclusion.getId())
        expect(eng.getRoleState().conclusionPremiseId).toBeUndefined()
    })

    it("prevents duplicate variable symbols at the engine level", () => {
        const eng = new ArgumentEngine(ARG)

        const varA = makeVar("var-a", "X")
        const varB = makeVar("var-b", "X")

        eng.addVariable(varA)
        // Shared VariableManager enforces unique symbols
        expect(() => eng.addVariable(varB)).toThrowError(/already exists/)
    })

    it("evaluates an assignment and identifies inadmissible non-counterexamples", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: support } = eng.createPremise({ title: "P->Q" })
        const { result: conclusion } = eng.createPremise({ title: "Q" })
        const { result: constraint } = eng.createPremise({ title: "P" })

        buildPremiseImplies(support)
        buildPremiseQ(conclusion)
        buildPremiseP(constraint)

        eng.setConclusionPremise(conclusion.getId())

        const result = eng.evaluate({
            variables: { [VAR_P.id]: false, [VAR_Q.id]: false },
            rejectedExpressionIds: [],
        })
        expect(result.ok).toBe(true)
        expect(result.isAdmissibleAssignment).toBe(false)
        expect(result.isCounterexample).toBe(false)
        expect(result.preservesTruthUnderAssignment).toBe(true)
        expect(result.constraintPremises).toHaveLength(1)
    })

    it("finds a counterexample for an invalid argument", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: support } = eng.createPremise({ title: "P->Q" })
        const { result: conclusion } = eng.createPremise({ title: "Q" })
        buildPremiseImplies(support)
        buildPremiseQ(conclusion)

        eng.setConclusionPremise(conclusion.getId())
        // support has implies root → automatically supporting

        const validity = eng.checkValidity({ mode: "firstCounterexample" })
        expect(validity.ok).toBe(true)
        expect(validity.isValid).toBe(false)
        expect(validity.counterexamples).toHaveLength(1)
        expect(
            validity.counterexamples?.[0]?.assignment.variables
        ).toMatchObject({
            [VAR_P.id]: false,
            [VAR_Q.id]: false,
        })
    })

    it("proves modus ponens form valid", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: support1 } = eng.createPremise({ title: "P->Q" })
        const { result: support2 } = eng.createPremise({ title: "P" })
        const { result: conclusion } = eng.createPremise({ title: "Q" })
        buildPremiseImplies(support1)
        buildPremiseP(support2)
        buildPremiseQ(conclusion)

        eng.setConclusionPremise(conclusion.getId())
        // support1 (P->Q) has implies root → automatically supporting
        // support2 (P) is a constraint (variable root, not inference)

        const validity = eng.checkValidity({ mode: "exhaustive" })
        expect(validity.ok).toBe(true)
        expect(validity.isValid).toBe(true)
        expect(validity.counterexamples).toEqual([])
        expect(validity.numAssignmentsChecked).toBe(4)
    })
})

describe("ArgumentEngine — complex argument scenarios across multiple evaluations", () => {
    function addVars(eng: ArgumentEngine, ...vars: TVariableInput[]) {
        for (const v of vars) {
            try {
                eng.addVariable(v)
            } catch {
                // Variable may already be registered; ignore duplicates
            }
        }
    }

    function buildVarRoot(
        pm: PremiseManager,
        exprId: string,
        variableId: string
    ) {
        pm.addExpression(makeVarExpr(exprId, variableId))
    }

    function buildNotRoot(
        pm: PremiseManager,
        rootId: string,
        childExprId: string,
        variableId: string
    ) {
        pm.addExpression(makeOpExpr(rootId, "not"))
        pm.addExpression(
            makeVarExpr(childExprId, variableId, {
                parentId: rootId,
                position: 0,
            })
        )
    }

    function buildBinaryRoot(
        pm: PremiseManager,
        rootId: string,
        operator: "and" | "or" | "implies" | "iff",
        left: { exprId: string; variableId: string },
        right: { exprId: string; variableId: string }
    ) {
        pm.addExpression(makeOpExpr(rootId, operator))
        pm.addExpression(
            makeVarExpr(left.exprId, left.variableId, {
                parentId: rootId,
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr(right.exprId, right.variableId, {
                parentId: rootId,
                position: 1,
            })
        )
    }

    function summarizeEvaluation(
        eng: ArgumentEngine,
        variables: Record<string, boolean>
    ) {
        const result = eng.evaluate({
            variables,
            rejectedExpressionIds: [],
        })
        expect(result.ok).toBe(true)
        return {
            assignment: variables,
            admissible: result.isAdmissibleAssignment,
            supportsTrue: result.allSupportingPremisesTrue,
            conclusionTrue: result.conclusionTrue,
            counterexample: result.isCounterexample,
            preservesTruth: result.preservesTruthUnderAssignment,
        }
    }

    function classifyAtActualAssignment(
        eng: ArgumentEngine,
        variables: Record<string, boolean>
    ) {
        const validity = eng.checkValidity({ mode: "exhaustive" })
        expect(validity.ok).toBe(true)

        const evaluation = eng.evaluate({
            variables,
            rejectedExpressionIds: [],
        })
        expect(evaluation.ok).toBe(true)

        const premisesTrue =
            evaluation.isAdmissibleAssignment === true &&
            evaluation.allSupportingPremisesTrue === true
        const conclusionTrue = evaluation.conclusionTrue === true

        return {
            isValid: validity.isValid === true,
            isSound:
                validity.isValid === true && premisesTrue && conclusionTrue,
            isUnsound:
                validity.isValid !== true || !premisesTrue || !conclusionTrue,
            premisesTrue,
            conclusionTrue,
        }
    }

    it("affirming the consequent shows multiple evaluation outcomes and a single counterexample", () => {
        const eng = new ArgumentEngine(ARG)
        addVars(eng, VAR_P, VAR_Q)
        const { result: pImpliesQ } = eng.createPremise({ title: "P -> Q" })
        const { result: qPremise } = eng.createPremise({ title: "Q" })
        const { result: pConclusion } = eng.createPremise({ title: "P" })

        buildBinaryRoot(
            pImpliesQ,
            "impl-p-q",
            "implies",
            { exprId: "impl-p-q-left", variableId: VAR_P.id },
            { exprId: "impl-p-q-right", variableId: VAR_Q.id }
        )
        buildVarRoot(qPremise, "q-root", VAR_Q.id)
        buildVarRoot(pConclusion, "p-root", VAR_P.id)

        eng.setConclusionPremise(pConclusion.getId())
        // pImpliesQ has implies root → automatically supporting
        // qPremise has variable root → constraint

        const summaries = [
            summarizeEvaluation(eng, { [VAR_P.id]: false, [VAR_Q.id]: false }),
            summarizeEvaluation(eng, { [VAR_P.id]: false, [VAR_Q.id]: true }),
            summarizeEvaluation(eng, { [VAR_P.id]: true, [VAR_Q.id]: true }),
        ]

        expect(summaries).toEqual([
            {
                assignment: { [VAR_P.id]: false, [VAR_Q.id]: false },
                admissible: false,
                supportsTrue: true,
                conclusionTrue: false,
                counterexample: false,
                preservesTruth: true,
            },
            {
                assignment: { [VAR_P.id]: false, [VAR_Q.id]: true },
                admissible: true,
                supportsTrue: true,
                conclusionTrue: false,
                counterexample: true,
                preservesTruth: false,
            },
            {
                assignment: { [VAR_P.id]: true, [VAR_Q.id]: true },
                admissible: true,
                supportsTrue: true,
                conclusionTrue: true,
                counterexample: false,
                preservesTruth: true,
            },
        ])

        const validity = eng.checkValidity({ mode: "exhaustive" })
        expect(validity.ok).toBe(true)
        expect(validity.isValid).toBe(false)
        expect(validity.counterexamples).toHaveLength(1)
        expect(
            validity.counterexamples?.[0]?.assignment.variables
        ).toMatchObject({
            [VAR_P.id]: false,
            [VAR_Q.id]: true,
        })

        const actualWorld = classifyAtActualAssignment(eng, {
            [VAR_P.id]: true,
            [VAR_Q.id]: true,
        })
        expect(actualWorld.isValid).toBe(false)
        expect(actualWorld.isSound).toBe(false)
        expect(actualWorld.isUnsound).toBe(true)
        expect(actualWorld.premisesTrue).toBe(true)
        expect(actualWorld.conclusionTrue).toBe(true)
    })

    it("a constrained transitive argument mixes admissible/inadmissible assignments and remains valid", () => {
        const eng = new ArgumentEngine(ARG)
        const { result: pImpliesQ } = eng.createPremise({ title: "P -> Q" })
        const { result: qImpliesR } = eng.createPremise({ title: "Q -> R" })
        const { result: pPremise } = eng.createPremise({ title: "P" })
        const { result: rConclusion } = eng.createPremise({ title: "R" })
        const { result: constraintNotR } = eng.createPremise({ title: "not R" })

        addVars(eng, VAR_P, VAR_Q, VAR_R)

        buildBinaryRoot(
            pImpliesQ,
            "root-p-q",
            "implies",
            { exprId: "root-p-q-left", variableId: VAR_P.id },
            { exprId: "root-p-q-right", variableId: VAR_Q.id }
        )
        buildBinaryRoot(
            qImpliesR,
            "root-q-r",
            "implies",
            { exprId: "root-q-r-left", variableId: VAR_Q.id },
            { exprId: "root-q-r-right", variableId: VAR_R.id }
        )
        buildVarRoot(pPremise, "root-p", VAR_P.id)
        buildVarRoot(rConclusion, "root-r", VAR_R.id)
        buildNotRoot(constraintNotR, "root-not-r", "root-not-r-child", VAR_R.id)

        eng.setConclusionPremise(rConclusion.getId())
        // pImpliesQ and qImpliesR have implies roots → automatically supporting
        // pPremise has variable root → constraint (along with constraintNotR)

        const evalInadmissible = summarizeEvaluation(eng, {
            [VAR_P.id]: true,
            [VAR_Q.id]: true,
            [VAR_R.id]: true,
        })
        const evalAdmissibleCounterexampleCandidate = summarizeEvaluation(eng, {
            [VAR_P.id]: true,
            [VAR_Q.id]: true,
            [VAR_R.id]: false,
        })
        const evalInadmissiblePremiseFalse = summarizeEvaluation(eng, {
            [VAR_P.id]: false,
            [VAR_Q.id]: false,
            [VAR_R.id]: false,
        })

        expect(evalInadmissible.admissible).toBe(false)
        expect(evalInadmissible.counterexample).toBe(false)

        expect(evalAdmissibleCounterexampleCandidate.admissible).toBe(true)
        expect(evalAdmissibleCounterexampleCandidate.supportsTrue).toBe(false)
        expect(evalAdmissibleCounterexampleCandidate.counterexample).toBe(false)

        // P is now a constraint, so P=false makes this inadmissible
        expect(evalInadmissiblePremiseFalse.admissible).toBe(false)
        expect(evalInadmissiblePremiseFalse.conclusionTrue).toBe(false)

        const validity = eng.checkValidity({ mode: "exhaustive" })
        expect(validity.ok).toBe(true)
        expect(validity.isValid).toBe(true)
        expect(validity.counterexamples).toEqual([])
        expect(validity.numAssignmentsChecked).toBe(8)
        // Only P=true AND R=false are admissible (2 of 8)
        expect(validity.numAdmissibleAssignments).toBe(2)
    })

    it("distinguishes valid+sound from valid+unsound using a designated actual assignment", () => {
        const eng = new ArgumentEngine(ARG)
        const { result: pImpliesQ } = eng.createPremise({ title: "P -> Q" })
        const { result: pPremise } = eng.createPremise({ title: "P" })
        const { result: qConclusion } = eng.createPremise({ title: "Q" })

        addVars(eng, VAR_P, VAR_Q)

        buildBinaryRoot(
            pImpliesQ,
            "mp-root",
            "implies",
            { exprId: "mp-left", variableId: VAR_P.id },
            { exprId: "mp-right", variableId: VAR_Q.id }
        )
        buildVarRoot(pPremise, "mp-p", VAR_P.id)
        buildVarRoot(qConclusion, "mp-q", VAR_Q.id)

        eng.setConclusionPremise(qConclusion.getId())
        // pImpliesQ has implies root → automatically supporting
        // pPremise has variable root → constraint

        const soundCase = classifyAtActualAssignment(eng, {
            [VAR_P.id]: true,
            [VAR_Q.id]: true,
        })
        expect(soundCase).toMatchObject({
            isValid: true,
            isSound: true,
            isUnsound: false,
            premisesTrue: true,
            conclusionTrue: true,
        })

        const unsoundCase = classifyAtActualAssignment(eng, {
            [VAR_P.id]: false,
            [VAR_Q.id]: false,
        })
        expect(unsoundCase).toMatchObject({
            isValid: true,
            isSound: false,
            isUnsound: true,
            premisesTrue: false,
            conclusionTrue: false,
        })
    })
})

describe("diffArguments", () => {
    describe("defaultCompareArgument", () => {
        it("returns empty array (no core diffable fields)", () => {
            const a = { ...ARG } as TCoreArgument
            const b = { ...ARG, version: 2 } as TCoreArgument
            expect(defaultCompareArgument(a, b)).toEqual([])
        })
    })

    describe("defaultCompareVariable", () => {
        it("returns empty array when symbol matches", () => {
            expect(
                defaultCompareVariable(
                    VAR_P as TCorePropositionalVariable,
                    VAR_P as TCorePropositionalVariable
                )
            ).toEqual([])
        })

        it("detects symbol change", () => {
            const before = makeVar("var-p", "P") as TCorePropositionalVariable
            const after = makeVar("var-p", "X") as TCorePropositionalVariable
            expect(defaultCompareVariable(before, after)).toEqual([
                { field: "symbol", before: "P", after: "X" },
            ])
        })
    })

    describe("defaultComparePremise", () => {
        it("returns empty when rootExpressionId matches", () => {
            const before = {
                id: "p1",
                rootExpressionId: "r1",
                variables: [] as string[],
                expressions: [] as TCorePropositionalExpression[],
                checksum: "x",
            }
            const after = {
                id: "p1",
                rootExpressionId: "r1",
                variables: [] as string[],
                expressions: [] as TCorePropositionalExpression[],
                checksum: "x",
            }
            expect(defaultComparePremise(before, after)).toEqual([])
        })

        it("detects rootExpressionId change", () => {
            const before = {
                id: "p1",
                rootExpressionId: "r1",
                variables: [] as string[],
                expressions: [] as TCorePropositionalExpression[],
                checksum: "x",
            }
            const after = {
                id: "p1",
                rootExpressionId: "r2",
                variables: [] as string[],
                expressions: [] as TCorePropositionalExpression[],
                checksum: "x",
            }
            expect(defaultComparePremise(before, after)).toEqual([
                { field: "rootExpressionId", before: "r1", after: "r2" },
            ])
        })
    })

    describe("defaultCompareExpression", () => {
        it("detects parentId change", () => {
            const before = makeVarExpr("e1", "var-p", {
                parentId: "p1",
                position: 0,
            }) as TCorePropositionalExpression
            const after = makeVarExpr("e1", "var-p", {
                parentId: "p2",
                position: 0,
            }) as TCorePropositionalExpression
            expect(defaultCompareExpression(before, after)).toEqual([
                { field: "parentId", before: "p1", after: "p2" },
            ])
        })

        it("detects position change", () => {
            const before = makeVarExpr("e1", "var-p", {
                parentId: "p1",
                position: 0,
            }) as TCorePropositionalExpression
            const after = makeVarExpr("e1", "var-p", {
                parentId: "p1",
                position: 1,
            }) as TCorePropositionalExpression
            expect(defaultCompareExpression(before, after)).toEqual([
                { field: "position", before: 0, after: 1 },
            ])
        })

        it("detects variableId change on variable expression", () => {
            const before = makeVarExpr("e1", "var-p", {
                parentId: null,
                position: POSITION_INITIAL,
            }) as TCorePropositionalExpression
            const after = makeVarExpr("e1", "var-q", {
                parentId: null,
                position: POSITION_INITIAL,
            }) as TCorePropositionalExpression
            expect(defaultCompareExpression(before, after)).toEqual([
                { field: "variableId", before: "var-p", after: "var-q" },
            ])
        })

        it("detects operator change on operator expression", () => {
            const before = makeOpExpr("e1", "and", {
                parentId: null,
                position: POSITION_INITIAL,
            }) as TCorePropositionalExpression
            const after = makeOpExpr("e1", "or", {
                parentId: null,
                position: POSITION_INITIAL,
            }) as TCorePropositionalExpression
            expect(defaultCompareExpression(before, after)).toEqual([
                { field: "operator", before: "and", after: "or" },
            ])
        })

        it("detects type change between expression types", () => {
            const before = makeVarExpr("e1", "var-p", {
                parentId: null,
                position: POSITION_INITIAL,
            }) as TCorePropositionalExpression
            const after = makeOpExpr("e1", "and", {
                parentId: null,
                position: POSITION_INITIAL,
            }) as TCorePropositionalExpression
            expect(defaultCompareExpression(before, after)).toEqual([
                { field: "type", before: "variable", after: "operator" },
            ])
        })
    })

    // Helper: create an engine with one premise containing P → Q
    function buildSimpleEngine(arg: Omit<TCoreArgument, "checksum">): {
        engine: ArgumentEngine
        premiseId: string
    } {
        const engine = new ArgumentEngine(arg)
        const varP = makeVar("var-p", "P")
        const varQ = makeVar("var-q", "Q")
        engine.addVariable(varP)
        engine.addVariable(varQ)

        const { result: pm } = engine.createPremiseWithId("premise-1", {
            title: "First premise",
        })
        pm.addExpression(
            makeOpExpr("expr-implies", "implies", {
                parentId: null,
                position: POSITION_INITIAL,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-p", "var-p", {
                parentId: "expr-implies",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", "var-q", {
                parentId: "expr-implies",
                position: 1,
            })
        )

        // premise-1 has implies root → automatically supporting
        return { engine, premiseId: "premise-1" }
    }

    describe("diffArguments function", () => {
        it("returns empty diff for identical engines", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const { engine: engineB } = buildSimpleEngine(ARG)
            const diff = diffArguments(engineA, engineB)

            expect(diff.argument.changes).toEqual([])
            expect(diff.variables.added).toEqual([])
            expect(diff.variables.removed).toEqual([])
            expect(diff.variables.modified).toEqual([])
            expect(diff.premises.added).toEqual([])
            expect(diff.premises.removed).toEqual([])
            expect(diff.premises.modified).toEqual([])
            expect(diff.roles.conclusion).toEqual({
                before: undefined,
                after: undefined,
            })
        })

        it("detects added and removed variables", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const { engine: engineB } = buildSimpleEngine(ARG)

            // Add a new variable to engineB
            const varR = makeVar("var-r", "R")
            engineB.addVariable(varR)

            const diff = diffArguments(engineA, engineB)
            expect(diff.variables.added).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ id: "var-r", symbol: "R" }),
                ])
            )
        })

        it("detects modified variable (symbol change)", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const argB = { ...ARG }
            const engineB = new ArgumentEngine(argB)
            // Same variable ID, different symbol
            engineB.addVariable(makeVar("var-p", "X"))
            engineB.addVariable(makeVar("var-q", "Q"))
            const { result: pm } = engineB.createPremiseWithId("premise-1", {
                title: "First premise",
            })
            pm.addExpression(
                makeOpExpr("expr-implies", "implies", {
                    parentId: null,
                    position: POSITION_INITIAL,
                })
            )
            pm.addExpression(
                makeVarExpr("expr-p", "var-p", {
                    parentId: "expr-implies",
                    position: 0,
                })
            )
            pm.addExpression(
                makeVarExpr("expr-q", "var-q", {
                    parentId: "expr-implies",
                    position: 1,
                })
            )
            // premise-1 has implies root → automatically supporting

            const diff = diffArguments(engineA, engineB)
            expect(diff.variables.modified).toEqual([
                expect.objectContaining({
                    changes: [{ field: "symbol", before: "P", after: "X" }],
                }),
            ])
        })

        it("detects added premise", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const { engine: engineB } = buildSimpleEngine(ARG)

            const { result: pm2 } = engineB.createPremiseWithId("premise-2", {
                title: "Second premise",
            })
            pm2.addExpression(
                makeVarExpr("expr-p2", "var-p", {
                    parentId: null,
                    position: POSITION_INITIAL,
                })
            )

            const diff = diffArguments(engineA, engineB)
            expect(diff.premises.added).toHaveLength(1)
            expect(diff.premises.added[0].id).toBe("premise-2")
        })

        it("detects removed premise", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const engineB = new ArgumentEngine(ARG)

            const diff = diffArguments(engineA, engineB)
            expect(diff.premises.removed).toHaveLength(1)
            expect(diff.premises.removed[0].id).toBe("premise-1")
        })

        it("detects modified premise (rootExpressionId change)", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const engineB = new ArgumentEngine(ARG)
            engineB.addVariable(makeVar("var-p", "P"))
            engineB.addVariable(makeVar("var-q", "Q"))
            const { result: pm } = engineB.createPremiseWithId("premise-1", {
                title: "First premise",
            })
            // Different root expression to trigger a rootExpressionId change
            pm.addExpression(
                makeOpExpr("expr-iff", "iff", {
                    parentId: null,
                    position: POSITION_INITIAL,
                })
            )
            pm.addExpression(
                makeVarExpr("expr-p", "var-p", {
                    parentId: "expr-iff",
                    position: 0,
                })
            )
            pm.addExpression(
                makeVarExpr("expr-q", "var-q", {
                    parentId: "expr-iff",
                    position: 1,
                })
            )
            // premise-1 has iff root → automatically supporting

            const diff = diffArguments(engineA, engineB)
            expect(diff.premises.modified).toHaveLength(1)
            expect(diff.premises.modified[0].changes).toEqual([
                {
                    field: "rootExpressionId",
                    before: "expr-implies",
                    after: "expr-iff",
                },
            ])
        })

        it("detects modified expressions within a premise", () => {
            // Build engineA with an 'and' root so removing one child doesn't collapse
            const engineA = new ArgumentEngine(ARG)
            engineA.addVariable(makeVar("var-p", "P"))
            engineA.addVariable(makeVar("var-q", "Q"))
            const { result: pmA } = engineA.createPremiseWithId("premise-1", {
                title: "First premise",
            })
            pmA.addExpression(
                makeOpExpr("expr-and", "and", {
                    parentId: null,
                    position: POSITION_INITIAL,
                })
            )
            pmA.addExpression(
                makeVarExpr("expr-p", "var-p", {
                    parentId: "expr-and",
                    position: 0,
                })
            )
            pmA.addExpression(
                makeVarExpr("expr-q", "var-q", {
                    parentId: "expr-and",
                    position: 1,
                })
            )
            // Add a third child so removing one still leaves 2 (no collapse)
            engineA.addVariable(makeVar("var-r", "R"))
            pmA.addExpression(
                makeVarExpr("expr-r", "var-r", {
                    parentId: "expr-and",
                    position: 2,
                })
            )

            // Build engineB identically, then swap expr-r for expr-s
            const engineB = new ArgumentEngine(ARG)
            engineB.addVariable(makeVar("var-p", "P"))
            engineB.addVariable(makeVar("var-q", "Q"))
            engineB.addVariable(makeVar("var-r", "R"))
            const { result: pmB } = engineB.createPremiseWithId("premise-1", {
                title: "First premise",
            })
            pmB.addExpression(
                makeOpExpr("expr-and", "and", {
                    parentId: null,
                    position: POSITION_INITIAL,
                })
            )
            pmB.addExpression(
                makeVarExpr("expr-p", "var-p", {
                    parentId: "expr-and",
                    position: 0,
                })
            )
            pmB.addExpression(
                makeVarExpr("expr-q", "var-q", {
                    parentId: "expr-and",
                    position: 1,
                })
            )
            // Different expression at position 2
            const varS = makeVar("var-s", "S")
            engineB.addVariable(varS)
            pmB.addExpression(
                makeVarExpr("expr-s", "var-s", {
                    parentId: "expr-and",
                    position: 2,
                })
            )

            const diff = diffArguments(engineA, engineB)
            expect(diff.premises.modified).toHaveLength(1)
            const premiseDiff = diff.premises.modified[0]
            expect(premiseDiff.expressions.removed).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ id: "expr-r" }),
                ])
            )
            expect(premiseDiff.expressions.added).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ id: "expr-s" }),
                ])
            )
        })

        it("detects conclusion change", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const { engine: engineB } = buildSimpleEngine(ARG)

            // engineA has no conclusion, engineB sets one
            const { result: pmConc } = engineB.createPremiseWithId(
                "premise-conc",
                {
                    title: "Conclusion",
                }
            )
            pmConc.addExpression(
                makeOpExpr("expr-impl-conc", "implies", {
                    parentId: null,
                    position: POSITION_INITIAL,
                })
            )
            pmConc.addExpression(
                makeVarExpr("expr-p-conc", "var-p", {
                    parentId: "expr-impl-conc",
                    position: 0,
                })
            )
            pmConc.addExpression(
                makeVarExpr("expr-q-conc", "var-q", {
                    parentId: "expr-impl-conc",
                    position: 1,
                })
            )
            engineB.setConclusionPremise("premise-conc")

            const diff = diffArguments(engineA, engineB)
            expect(diff.roles.conclusion.before).toBeUndefined()
            expect(diff.roles.conclusion.after).toBe("premise-conc")
        })

        it("detects conclusion change between engines", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const { engine: engineB } = buildSimpleEngine(ARG)

            // engineA has no conclusion, engineB sets premise-1 as conclusion
            engineB.setConclusionPremise("premise-1")

            const diff = diffArguments(engineA, engineB)
            expect(diff.roles.conclusion.before).toBeUndefined()
            expect(diff.roles.conclusion.after).toBe("premise-1")
        })

        it("uses custom comparator extending default", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const { engine: engineB } = buildSimpleEngine(ARG)
            engineB.getPremise("premise-1")!.setExtras({ title: "Updated" })

            const diff = diffArguments(engineA, engineB, {
                comparePremise: (before, after) => {
                    const changes = [...defaultComparePremise(before, after)]
                    const bTitle = (before as Record<string, unknown>).title
                    const aTitle = (after as Record<string, unknown>).title
                    if (bTitle !== aTitle) {
                        changes.push({
                            field: "title",
                            before: bTitle,
                            after: aTitle,
                        })
                    }
                    // Custom: always report a "custom" field
                    changes.push({
                        field: "customField",
                        before: "a",
                        after: "b",
                    })
                    return changes
                },
            })

            expect(diff.premises.modified).toHaveLength(1)
            expect(diff.premises.modified[0].changes).toEqual([
                {
                    field: "title",
                    before: "First premise",
                    after: "Updated",
                },
                { field: "customField", before: "a", after: "b" },
            ])
        })

        it("custom comparator replaces default entirely", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const { engine: engineB } = buildSimpleEngine(ARG)
            engineB.getPremise("premise-1")!.setExtras({ title: "Updated" })

            // Custom comparator that ignores extras changes
            const diff = diffArguments(engineA, engineB, {
                comparePremise: () => [],
            })

            // Premise is not in modified because comparator returned no changes
            // (and no expression changes either since engines are otherwise identical)
            expect(diff.premises.modified).toEqual([])
        })
    })
})

// ---------------------------------------------------------------------------
// Kleene three-valued logic helpers
// ---------------------------------------------------------------------------

describe("Kleene three-valued logic helpers", () => {
    describe("kleeneNot", () => {
        it("NOT true = false", () => {
            expect(kleeneNot(true)).toBe(false)
        })

        it("NOT false = true", () => {
            expect(kleeneNot(false)).toBe(true)
        })

        it("NOT null = null", () => {
            expect(kleeneNot(null)).toBeNull()
        })
    })

    describe("kleeneAnd", () => {
        it("true AND true = true", () => {
            expect(kleeneAnd(true, true)).toBe(true)
        })

        it("true AND false = false", () => {
            expect(kleeneAnd(true, false)).toBe(false)
        })

        it("true AND null = null", () => {
            expect(kleeneAnd(true, null)).toBeNull()
        })

        it("false AND true = false", () => {
            expect(kleeneAnd(false, true)).toBe(false)
        })

        it("false AND false = false", () => {
            expect(kleeneAnd(false, false)).toBe(false)
        })

        it("false AND null = false", () => {
            expect(kleeneAnd(false, null)).toBe(false)
        })

        it("null AND true = null", () => {
            expect(kleeneAnd(null, true)).toBeNull()
        })

        it("null AND false = false", () => {
            expect(kleeneAnd(null, false)).toBe(false)
        })

        it("null AND null = null", () => {
            expect(kleeneAnd(null, null)).toBeNull()
        })
    })

    describe("kleeneOr", () => {
        it("true OR true = true", () => {
            expect(kleeneOr(true, true)).toBe(true)
        })

        it("true OR false = true", () => {
            expect(kleeneOr(true, false)).toBe(true)
        })

        it("true OR null = true", () => {
            expect(kleeneOr(true, null)).toBe(true)
        })

        it("false OR true = true", () => {
            expect(kleeneOr(false, true)).toBe(true)
        })

        it("false OR false = false", () => {
            expect(kleeneOr(false, false)).toBe(false)
        })

        it("false OR null = null", () => {
            expect(kleeneOr(false, null)).toBeNull()
        })

        it("null OR true = true", () => {
            expect(kleeneOr(null, true)).toBe(true)
        })

        it("null OR false = null", () => {
            expect(kleeneOr(null, false)).toBeNull()
        })

        it("null OR null = null", () => {
            expect(kleeneOr(null, null)).toBeNull()
        })
    })

    describe("kleeneImplies", () => {
        it("true -> true = true", () => {
            expect(kleeneImplies(true, true)).toBe(true)
        })

        it("true -> false = false", () => {
            expect(kleeneImplies(true, false)).toBe(false)
        })

        it("true -> null = null", () => {
            expect(kleeneImplies(true, null)).toBeNull()
        })

        it("false -> true = true", () => {
            expect(kleeneImplies(false, true)).toBe(true)
        })

        it("false -> false = true", () => {
            expect(kleeneImplies(false, false)).toBe(true)
        })

        it("false -> null = true", () => {
            expect(kleeneImplies(false, null)).toBe(true)
        })

        it("null -> true = true", () => {
            expect(kleeneImplies(null, true)).toBe(true)
        })

        it("null -> false = null", () => {
            expect(kleeneImplies(null, false)).toBeNull()
        })

        it("null -> null = null", () => {
            expect(kleeneImplies(null, null)).toBeNull()
        })
    })

    describe("kleeneIff", () => {
        it("true <-> true = true", () => {
            expect(kleeneIff(true, true)).toBe(true)
        })

        it("true <-> false = false", () => {
            expect(kleeneIff(true, false)).toBe(false)
        })

        it("true <-> null = null", () => {
            expect(kleeneIff(true, null)).toBeNull()
        })

        it("false <-> true = false", () => {
            expect(kleeneIff(false, true)).toBe(false)
        })

        it("false <-> false = true", () => {
            expect(kleeneIff(false, false)).toBe(true)
        })

        it("false <-> null = null", () => {
            expect(kleeneIff(false, null)).toBeNull()
        })

        it("null <-> true = null", () => {
            expect(kleeneIff(null, true)).toBeNull()
        })

        it("null <-> false = null", () => {
            expect(kleeneIff(null, false)).toBeNull()
        })

        it("null <-> null = null", () => {
            expect(kleeneIff(null, null)).toBeNull()
        })
    })
})

// ---------------------------------------------------------------------------
// PremiseManager — three-valued evaluation
// ---------------------------------------------------------------------------

describe("PremiseManager — three-valued evaluation", () => {
    it("evaluates unset variables as null", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise()
        // Single variable expression as root
        pm.addExpression(makeVarExpr("e-p", "var-p"))

        const assignment: TCoreExpressionAssignment = {
            variables: { "var-p": null },
            rejectedExpressionIds: [],
        }
        const result = pm.evaluate(assignment)
        expect(result.rootValue).toBeNull()
        expect(result.expressionValues["e-p"]).toBeNull()
    })

    it("missing variables default to null", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeVarExpr("e-p", "var-p"))

        const assignment: TCoreExpressionAssignment = {
            variables: {},
            rejectedExpressionIds: [],
        }
        const result = pm.evaluate(assignment)
        expect(result.rootValue).toBeNull()
        expect(result.expressionValues["e-p"]).toBeNull()
    })

    it("propagates null through AND (Kleene)", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise()
        // (P and Q) as root
        pm.addExpression(makeOpExpr("and-root", "and"))
        pm.addExpression(
            makeVarExpr("e-p", "var-p", { parentId: "and-root", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("e-q", "var-q", { parentId: "and-root", position: 1 })
        )

        // true AND null = null
        const r1 = pm.evaluate({
            variables: { "var-p": true, "var-q": null },
            rejectedExpressionIds: [],
        })
        expect(r1.rootValue).toBeNull()

        // false AND null = false
        const r2 = pm.evaluate({
            variables: { "var-p": false, "var-q": null },
            rejectedExpressionIds: [],
        })
        expect(r2.rootValue).toBe(false)
    })

    it("propagates null through OR (Kleene)", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeOpExpr("or-root", "or"))
        pm.addExpression(
            makeVarExpr("e-p", "var-p", { parentId: "or-root", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("e-q", "var-q", { parentId: "or-root", position: 1 })
        )

        // true OR null = true
        const r1 = pm.evaluate({
            variables: { "var-p": true, "var-q": null },
            rejectedExpressionIds: [],
        })
        expect(r1.rootValue).toBe(true)

        // false OR null = null
        const r2 = pm.evaluate({
            variables: { "var-p": false, "var-q": null },
            rejectedExpressionIds: [],
        })
        expect(r2.rootValue).toBeNull()
    })

    it("propagates null through implies (Kleene)", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeOpExpr("imp-root", "implies"))
        pm.addExpression(
            makeVarExpr("e-p", "var-p", { parentId: "imp-root", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("e-q", "var-q", { parentId: "imp-root", position: 1 })
        )

        // false implies null = true
        const r1 = pm.evaluate({
            variables: { "var-p": false, "var-q": null },
            rejectedExpressionIds: [],
        })
        expect(r1.rootValue).toBe(true)

        // null implies true = true
        const r2 = pm.evaluate({
            variables: { "var-p": null, "var-q": true },
            rejectedExpressionIds: [],
        })
        expect(r2.rootValue).toBe(true)

        // true implies null = null
        const r3 = pm.evaluate({
            variables: { "var-p": true, "var-q": null },
            rejectedExpressionIds: [],
        })
        expect(r3.rootValue).toBeNull()
    })

    it("rejected operator evaluates to false and skips children", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise()
        // (P and Q)
        pm.addExpression(makeOpExpr("and-root", "and"))
        pm.addExpression(
            makeVarExpr("e-p", "var-p", { parentId: "and-root", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("e-q", "var-q", { parentId: "and-root", position: 1 })
        )

        const result = pm.evaluate({
            variables: { "var-p": true, "var-q": true },
            rejectedExpressionIds: ["and-root"],
        })
        expect(result.rootValue).toBe(false)
        // Children should NOT be in expressionValues because they were skipped
        expect(result.expressionValues["e-p"]).toBeUndefined()
        expect(result.expressionValues["e-q"]).toBeUndefined()
    })

    it("rejected formula evaluates to false", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise()
        // (P) as root formula wrapping variable
        pm.addExpression(makeFormulaExpr("f-root"))
        pm.addExpression(
            makeVarExpr("e-p", "var-p", { parentId: "f-root", position: 0 })
        )

        const result = pm.evaluate({
            variables: { "var-p": true },
            rejectedExpressionIds: ["f-root"],
        })
        expect(result.rootValue).toBe(false)
        // Child skipped
        expect(result.expressionValues["e-p"]).toBeUndefined()
    })

    it("rejected nested operator forces false while parent computes normally", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        eng.addVariable(VAR_R)
        const { result: pm } = eng.createPremise()
        // (P and Q) or R
        pm.addExpression(makeOpExpr("or-root", "or"))
        pm.addExpression(
            makeOpExpr("and-child", "and", {
                parentId: "or-root",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("e-p", "var-p", { parentId: "and-child", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("e-q", "var-q", { parentId: "and-child", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-r", "var-r", { parentId: "or-root", position: 1 })
        )

        // Reject the AND operator, set C=true
        // (false) or true → true
        const result = pm.evaluate({
            variables: { "var-p": true, "var-q": true, "var-r": true },
            rejectedExpressionIds: ["and-child"],
        })
        expect(result.rootValue).toBe(true)
        // AND evaluates to false due to rejection
        expect(result.expressionValues["and-child"]).toBe(false)
        // Children of the rejected AND should be skipped
        expect(result.expressionValues["e-p"]).toBeUndefined()
        expect(result.expressionValues["e-q"]).toBeUndefined()
        // R evaluates normally
        expect(result.expressionValues["e-r"]).toBe(true)
    })

    it("rejected inference root evaluates to false with no inference diagnostic", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise()
        // P implies Q
        pm.addExpression(makeOpExpr("imp", "implies"))
        pm.addExpression(
            makeVarExpr("e-p", "var-p", { parentId: "imp", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("e-q", "var-q", { parentId: "imp", position: 1 })
        )

        const result = pm.evaluate({
            variables: { "var-p": true, "var-q": true },
            rejectedExpressionIds: ["imp"],
        })
        expect(result.rootValue).toBe(false)
        expect(result.inferenceDiagnostic).toBeUndefined()
        // Children should not have been evaluated
        expect(result.expressionValues["e-p"]).toBeUndefined()
        expect(result.expressionValues["e-q"]).toBeUndefined()
    })
})

describe("ArgumentEngine — three-valued evaluation", () => {
    const VAR_A = makeVar("var-a", "A")
    const VAR_B = makeVar("var-b", "B")
    const VAR_C = makeVar("var-c", "C")
    const VAR_D = makeVar("var-d", "D")

    function buildSimpleArgument() {
        // A implies B (conclusion), C implies A (supporting), D (constraint)
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(VAR_A)
        engine.addVariable(VAR_B)
        engine.addVariable(VAR_C)
        engine.addVariable(VAR_D)

        const { result: conclusion } = engine.createPremise({
            title: "conclusion",
        })
        conclusion.addExpression(makeOpExpr("c-imp", "implies"))
        conclusion.addExpression(
            makeVarExpr("c-a", VAR_A.id, { parentId: "c-imp", position: 0 })
        )
        conclusion.addExpression(
            makeVarExpr("c-b", VAR_B.id, { parentId: "c-imp", position: 1 })
        )

        const { result: supporting } = engine.createPremise({
            title: "supporting",
        })
        supporting.addExpression(makeOpExpr("s-imp", "implies"))
        supporting.addExpression(
            makeVarExpr("s-c", VAR_C.id, { parentId: "s-imp", position: 0 })
        )
        supporting.addExpression(
            makeVarExpr("s-a", VAR_A.id, { parentId: "s-imp", position: 1 })
        )

        const { result: constraint } = engine.createPremise({
            title: "constraint",
        })
        constraint.addExpression(makeVarExpr("d-var", VAR_D.id))

        engine.setConclusionPremise(conclusion.getId())
        // supporting has implies root → automatically supporting

        return { engine }
    }

    it("returns null for isAdmissibleAssignment when constraint is null", () => {
        const { engine } = buildSimpleArgument()
        const result = engine.evaluate({
            variables: {
                [VAR_A.id]: true,
                [VAR_B.id]: true,
                [VAR_C.id]: true,
                [VAR_D.id]: null,
            },
            rejectedExpressionIds: [],
        })
        expect(result.ok).toBe(true)
        expect(result.isAdmissibleAssignment).toBe(null)
    })

    it("returns null for isCounterexample when conclusion is null", () => {
        const { engine } = buildSimpleArgument()
        const result = engine.evaluate({
            variables: {
                [VAR_A.id]: true,
                [VAR_B.id]: null,
                [VAR_C.id]: true,
                [VAR_D.id]: true,
            },
            rejectedExpressionIds: [],
        })
        expect(result.ok).toBe(true)
        expect(result.isAdmissibleAssignment).toBe(true)
        expect(result.conclusionTrue).toBe(null)
        expect(result.isCounterexample).toBe(null)
    })

    it("rejected conclusion root makes conclusionTrue false", () => {
        const { engine } = buildSimpleArgument()
        const result = engine.evaluate({
            variables: {
                [VAR_A.id]: true,
                [VAR_B.id]: true,
                [VAR_C.id]: true,
                [VAR_D.id]: true,
            },
            rejectedExpressionIds: ["c-imp"],
        })
        expect(result.ok).toBe(true)
        expect(result.conclusionTrue).toBe(false)
    })

    it("preservesTruthUnderAssignment is null when isCounterexample is null", () => {
        const { engine } = buildSimpleArgument()
        const result = engine.evaluate({
            variables: {
                [VAR_A.id]: true,
                [VAR_B.id]: null,
                [VAR_C.id]: true,
                [VAR_D.id]: true,
            },
            rejectedExpressionIds: [],
        })
        expect(result.ok).toBe(true)
        expect(result.isCounterexample).toBe(null)
        expect(result.preservesTruthUnderAssignment).toBe(null)
    })
})

describe("schema shapes with additionalProperties", () => {
    it("CoreArgumentSchema accepts { id, version, checksum } with additional properties", () => {
        const valid = Value.Check(CoreArgumentSchema, {
            id: "x",
            version: 0,
            checksum: "abc123",
            title: "Test",
            custom: 42,
        })
        expect(valid).toBe(true)
    })

    it("CoreArgumentSchema rejects missing required fields", () => {
        const invalid = Value.Check(CoreArgumentSchema, { id: "x" })
        expect(invalid).toBe(false)
    })

    it("CorePropositionalVariableSchema accepts { id, argumentId, argumentVersion, symbol, checksum } with additional properties", () => {
        const valid = Value.Check(CorePropositionalVariableSchema, {
            id: "v-1",
            argumentId: "a-1",
            argumentVersion: 0,
            symbol: "P",
            checksum: "abc123",
            label: "Proposition P",
        })
        expect(valid).toBe(true)
    })

    it("CorePremiseSchema accepts minimal shape with additional properties", () => {
        const valid = Value.Check(CorePremiseSchema, {
            id: "p-1",
            variables: [],
            expressions: [],
            checksum: "abc123",
            title: "My Premise",
            priority: 1,
        })
        expect(valid).toBe(true)
    })
})

describe("field preservation — unknown fields survive round-trips", () => {
    const ARG_WITH_EXTRAS = {
        id: "arg-1",
        version: 1,
        title: "My Argument",
        customField: 42,
    }

    it("preserves unknown fields on the argument through getArgument()", () => {
        const engine = new ArgumentEngine(
            ARG_WITH_EXTRAS as Omit<TCoreArgument, "checksum">
        )
        const result = engine.getArgument()
        expect((result as Record<string, unknown>).title).toBe("My Argument")
        expect((result as Record<string, unknown>).customField).toBe(42)
    })

    it("preserves unknown fields on the argument through toData()", () => {
        const engine = new ArgumentEngine(
            ARG_WITH_EXTRAS as Omit<TCoreArgument, "checksum">
        )
        const data = engine.toData()
        expect((data.argument as Record<string, unknown>).title).toBe(
            "My Argument"
        )
        expect((data.argument as Record<string, unknown>).customField).toBe(42)
    })

    it("preserves extras on premises through toData()", () => {
        const engine = new ArgumentEngine({ id: "arg-1", version: 1 })
        const { result: pm } = engine.createPremise({
            title: "My Premise",
            priority: "high",
        })
        const data = pm.toData()
        expect((data as Record<string, unknown>).title).toBe("My Premise")
        expect((data as Record<string, unknown>).priority).toBe("high")
    })

    it("preserves extras on premises through engine.toData()", () => {
        const engine = new ArgumentEngine({ id: "arg-1", version: 1 })
        engine.createPremise({ title: "Premise One" })
        const data = engine.toData()
        expect((data.premises[0] as Record<string, unknown>).title).toBe(
            "Premise One"
        )
    })

    it("setExtras replaces all extras, not merges", () => {
        const engine = new ArgumentEngine({ id: "arg-1", version: 1 })
        const { result: pm } = engine.createPremise({ a: "1", b: "2" })
        pm.setExtras({ c: "3" })
        expect(pm.getExtras()).toEqual({ c: "3" })
        expect(pm.getExtras()).not.toHaveProperty("a")
    })

    it("structural fields in toData() cannot be shadowed by extras", () => {
        const engine = new ArgumentEngine({ id: "arg-1", version: 1 })
        const { result: pm } = engine.createPremise({
            id: "should-be-overridden",
            rootExpressionId: "fake",
        })
        const data = pm.toData()
        expect(data.id).not.toBe("should-be-overridden")
        expect(data.id).toBe(pm.getId())
        expect(data.rootExpressionId).toBeUndefined()
    })
})

// ---------------------------------------------------------------------------
// analyzePremiseRelationships
// ---------------------------------------------------------------------------

describe("buildPremiseProfile", () => {
    const VAR_A = makeVar("var-a", "A")
    const VAR_B = makeVar("var-b", "B")
    const VAR_C = makeVar("var-c", "C")
    const VAR_F = makeVar("var-f", "F")

    it("profiles an implies premise with simple antecedent and consequent", () => {
        // A → B
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_A)
        eng.addVariable(VAR_B)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeOpExpr("impl", "implies"))
        pm.addExpression(
            makeVarExpr("ve-a", VAR_A.id, { parentId: "impl", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("ve-b", VAR_B.id, { parentId: "impl", position: 1 })
        )

        const profile = buildPremiseProfile(pm)
        expect(profile.isInference).toBe(true)
        expect(profile.appearances).toEqual(
            expect.arrayContaining([
                {
                    variableId: VAR_A.id,
                    side: "antecedent",
                    polarity: "positive",
                },
                {
                    variableId: VAR_B.id,
                    side: "consequent",
                    polarity: "positive",
                },
            ])
        )
        expect(profile.appearances).toHaveLength(2)
    })

    it("profiles negation as negative polarity", () => {
        // F → ¬A
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_F)
        eng.addVariable(VAR_A)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeOpExpr("impl", "implies"))
        pm.addExpression(
            makeVarExpr("ve-f", VAR_F.id, { parentId: "impl", position: 0 })
        )
        pm.addExpression(
            makeOpExpr("not-1", "not", { parentId: "impl", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("ve-a", VAR_A.id, { parentId: "not-1", position: 0 })
        )

        const profile = buildPremiseProfile(pm)
        expect(profile.appearances).toEqual(
            expect.arrayContaining([
                {
                    variableId: VAR_F.id,
                    side: "antecedent",
                    polarity: "positive",
                },
                {
                    variableId: VAR_A.id,
                    side: "consequent",
                    polarity: "negative",
                },
            ])
        )
    })

    it("profiles double negation as positive polarity", () => {
        // ¬(¬A ∧ B) → C
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_A)
        eng.addVariable(VAR_B)
        eng.addVariable(VAR_C)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeOpExpr("impl", "implies"))
        pm.addExpression(
            makeOpExpr("not-outer", "not", { parentId: "impl", position: 0 })
        )
        pm.addExpression(
            makeOpExpr("and-1", "and", { parentId: "not-outer", position: 0 })
        )
        pm.addExpression(
            makeOpExpr("not-inner", "not", { parentId: "and-1", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("ve-a", VAR_A.id, {
                parentId: "not-inner",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("ve-b", VAR_B.id, { parentId: "and-1", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("ve-c", VAR_C.id, { parentId: "impl", position: 1 })
        )

        const profile = buildPremiseProfile(pm)
        expect(profile.appearances).toEqual(
            expect.arrayContaining([
                {
                    variableId: VAR_A.id,
                    side: "antecedent",
                    polarity: "positive",
                },
                {
                    variableId: VAR_B.id,
                    side: "antecedent",
                    polarity: "negative",
                },
                {
                    variableId: VAR_C.id,
                    side: "consequent",
                    polarity: "positive",
                },
            ])
        )
        expect(profile.appearances).toHaveLength(3)
    })

    it("profiles compound antecedent and consequent", () => {
        // (A ∧ B) → (B ∧ C)
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_A)
        eng.addVariable(VAR_B)
        eng.addVariable(VAR_C)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeOpExpr("impl", "implies"))
        pm.addExpression(
            makeOpExpr("and-l", "and", { parentId: "impl", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("ve-a", VAR_A.id, { parentId: "and-l", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("ve-b1", VAR_B.id, { parentId: "and-l", position: 1 })
        )
        pm.addExpression(
            makeOpExpr("and-r", "and", { parentId: "impl", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("ve-b2", VAR_B.id, { parentId: "and-r", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("ve-c", VAR_C.id, { parentId: "and-r", position: 1 })
        )

        const profile = buildPremiseProfile(pm)
        expect(profile.appearances).toEqual(
            expect.arrayContaining([
                {
                    variableId: VAR_A.id,
                    side: "antecedent",
                    polarity: "positive",
                },
                {
                    variableId: VAR_B.id,
                    side: "antecedent",
                    polarity: "positive",
                },
                {
                    variableId: VAR_B.id,
                    side: "consequent",
                    polarity: "positive",
                },
                {
                    variableId: VAR_C.id,
                    side: "consequent",
                    polarity: "positive",
                },
            ])
        )
        expect(profile.appearances).toHaveLength(4)
    })

    it("profiles iff as left=antecedent, right=consequent", () => {
        // A ↔ B
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_A)
        eng.addVariable(VAR_B)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeOpExpr("iff-1", "iff"))
        pm.addExpression(
            makeVarExpr("ve-a", VAR_A.id, { parentId: "iff-1", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("ve-b", VAR_B.id, { parentId: "iff-1", position: 1 })
        )

        const profile = buildPremiseProfile(pm)
        expect(profile.isInference).toBe(true)
        expect(profile.appearances).toEqual(
            expect.arrayContaining([
                {
                    variableId: VAR_A.id,
                    side: "antecedent",
                    polarity: "positive",
                },
                {
                    variableId: VAR_B.id,
                    side: "consequent",
                    polarity: "positive",
                },
            ])
        )
    })

    it("profiles a constraint premise as non-inference with no appearances", () => {
        // A ∧ B (constraint)
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_A)
        eng.addVariable(VAR_B)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeOpExpr("and-1", "and"))
        pm.addExpression(
            makeVarExpr("ve-a", VAR_A.id, { parentId: "and-1", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("ve-b", VAR_B.id, { parentId: "and-1", position: 1 })
        )

        const profile = buildPremiseProfile(pm)
        expect(profile.isInference).toBe(false)
        expect(profile.appearances).toEqual([])
    })

    it("profiles an empty premise as non-inference with no appearances", () => {
        const eng = new ArgumentEngine(ARG)
        const { result: pm } = eng.createPremise()

        const profile = buildPremiseProfile(pm)
        expect(profile.isInference).toBe(false)
        expect(profile.appearances).toEqual([])
    })
})

describe("analyzePremiseRelationships — direct relationships", () => {
    const VAR_A = makeVar("var-a", "A")
    const VAR_B = makeVar("var-b", "B")
    const VAR_C = makeVar("var-c", "C")
    const VAR_D = makeVar("var-d", "D")

    /** Build an implies premise: left → right (single variables). */
    function buildImplies(
        eng: ArgumentEngine,
        premiseId: string,
        leftVar: TVariableInput,
        rightVar: TVariableInput
    ): PremiseManager {
        try {
            eng.addVariable(leftVar)
        } catch {
            /* already registered */
        }
        if (leftVar.id !== rightVar.id) {
            try {
                eng.addVariable(rightVar)
            } catch {
                /* already registered */
            }
        }
        const { result: pm } = eng.createPremiseWithId(premiseId)
        pm.addExpression(makeOpExpr(`${premiseId}-impl`, "implies"))
        pm.addExpression(
            makeVarExpr(`${premiseId}-ve-l`, leftVar.id, {
                parentId: `${premiseId}-impl`,
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr(`${premiseId}-ve-r`, rightVar.id, {
                parentId: `${premiseId}-impl`,
                position: 1,
            })
        )
        return pm
    }

    it("classifies a premise whose consequent feeds the focused antecedent as supporting", () => {
        // P1: A → B, P2 (focused): B → C
        const eng = new ArgumentEngine(ARG)
        buildImplies(eng, "p1", VAR_A, VAR_B)
        buildImplies(eng, "p2", VAR_B, VAR_C)

        const result = analyzePremiseRelationships(eng, "p2")
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("supporting")
        expect(p1Result.transitive).toBe(false)
        expect(p1Result.variableDetails).toEqual(
            expect.arrayContaining([
                { variableId: VAR_B.id, relationship: "supporting" },
            ])
        )
    })

    it("classifies a premise with negated consequent as contradicting", () => {
        // P1: A → ¬B, P2 (focused): B → C
        const eng = new ArgumentEngine(ARG)
        try {
            eng.addVariable(VAR_A)
        } catch {
            /* already registered */
        }
        try {
            eng.addVariable(VAR_B)
        } catch {
            /* already registered */
        }
        const { result: p1 } = eng.createPremiseWithId("p1")
        p1.addExpression(makeOpExpr("p1-impl", "implies"))
        p1.addExpression(
            makeVarExpr("p1-ve-a", VAR_A.id, {
                parentId: "p1-impl",
                position: 0,
            })
        )
        p1.addExpression(
            makeOpExpr("p1-not", "not", {
                parentId: "p1-impl",
                position: 1,
            })
        )
        p1.addExpression(
            makeVarExpr("p1-ve-b", VAR_B.id, {
                parentId: "p1-not",
                position: 0,
            })
        )
        buildImplies(eng, "p2", VAR_B, VAR_C)

        const result = analyzePremiseRelationships(eng, "p2")
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("contradicting")
        expect(p1Result.variableDetails).toEqual(
            expect.arrayContaining([
                { variableId: VAR_B.id, relationship: "contradicting" },
            ])
        )
    })

    it("classifies a premise with variable in both ante and conseq as restricting", () => {
        // P1: B → (B ∧ C), P2 (focused): B → D
        const eng = new ArgumentEngine(ARG)
        try {
            eng.addVariable(VAR_B)
        } catch {
            /* already registered */
        }
        try {
            eng.addVariable(VAR_C)
        } catch {
            /* already registered */
        }
        const { result: p1 } = eng.createPremiseWithId("p1")
        p1.addExpression(makeOpExpr("p1-impl", "implies"))
        p1.addExpression(
            makeVarExpr("p1-ve-b1", VAR_B.id, {
                parentId: "p1-impl",
                position: 0,
            })
        )
        p1.addExpression(
            makeOpExpr("p1-and", "and", {
                parentId: "p1-impl",
                position: 1,
            })
        )
        p1.addExpression(
            makeVarExpr("p1-ve-b2", VAR_B.id, {
                parentId: "p1-and",
                position: 0,
            })
        )
        p1.addExpression(
            makeVarExpr("p1-ve-c", VAR_C.id, {
                parentId: "p1-and",
                position: 1,
            })
        )
        buildImplies(eng, "p2", VAR_B, VAR_D)

        const result = analyzePremiseRelationships(eng, "p2")
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("restricting")
        expect(p1Result.variableDetails).toEqual(
            expect.arrayContaining([
                { variableId: VAR_B.id, relationship: "restricting" },
            ])
        )
    })

    it("classifies a constraint premise sharing variables as restricting", () => {
        // P1: A ∧ B (constraint), P2 (focused): B → C
        const eng = new ArgumentEngine(ARG)
        try {
            eng.addVariable(VAR_A)
        } catch {
            /* already registered */
        }
        try {
            eng.addVariable(VAR_B)
        } catch {
            /* already registered */
        }
        const { result: p1 } = eng.createPremiseWithId("p1")
        p1.addExpression(makeOpExpr("p1-and", "and"))
        p1.addExpression(
            makeVarExpr("p1-ve-a", VAR_A.id, {
                parentId: "p1-and",
                position: 0,
            })
        )
        p1.addExpression(
            makeVarExpr("p1-ve-b", VAR_B.id, {
                parentId: "p1-and",
                position: 1,
            })
        )
        buildImplies(eng, "p2", VAR_B, VAR_C)

        const result = analyzePremiseRelationships(eng, "p2")
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("restricting")
    })

    it("classifies a premise taking the focused consequent as downstream", () => {
        // P1 (focused): A → B, P2: B → C
        const eng = new ArgumentEngine(ARG)
        buildImplies(eng, "p1", VAR_A, VAR_B)
        buildImplies(eng, "p2", VAR_B, VAR_C)

        const result = analyzePremiseRelationships(eng, "p1")
        const p2Result = result.premises.find((p) => p.premiseId === "p2")!
        expect(p2Result.relationship).toBe("downstream")
        expect(p2Result.transitive).toBe(false)
    })

    it("classifies a premise with no shared variables as unrelated", () => {
        // P1: A → B, P2 (focused): C → D
        const eng = new ArgumentEngine(ARG)
        buildImplies(eng, "p1", VAR_A, VAR_B)
        buildImplies(eng, "p2", VAR_C, VAR_D)

        const result = analyzePremiseRelationships(eng, "p2")
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("unrelated")
        expect(p1Result.variableDetails).toEqual([])
    })

    it("excludes the focused premise from results", () => {
        const eng = new ArgumentEngine(ARG)
        buildImplies(eng, "p1", VAR_A, VAR_B)
        buildImplies(eng, "p2", VAR_B, VAR_C)

        const result = analyzePremiseRelationships(eng, "p2")
        expect(
            result.premises.find((p) => p.premiseId === "p2")
        ).toBeUndefined()
    })

    it("throws when focused premise does not exist", () => {
        const eng = new ArgumentEngine(ARG)
        expect(() => analyzePremiseRelationships(eng, "nonexistent")).toThrow()
    })

    it("returns empty premises array when argument has only the focused premise", () => {
        const eng = new ArgumentEngine(ARG)
        buildImplies(eng, "p1", VAR_A, VAR_B)

        const result = analyzePremiseRelationships(eng, "p1")
        expect(result.premises).toEqual([])
    })
})

describe("analyzePremiseRelationships — transitive relationships", () => {
    const VAR_A = makeVar("var-a", "A")
    const VAR_B = makeVar("var-b", "B")
    const VAR_C = makeVar("var-c", "C")
    const VAR_D = makeVar("var-d", "D")
    const VAR_E = makeVar("var-e", "E")
    const VAR_F = makeVar("var-f", "F")

    function buildImplies(
        eng: ArgumentEngine,
        premiseId: string,
        leftVar: TVariableInput,
        rightVar: TVariableInput
    ): PremiseManager {
        try {
            eng.addVariable(leftVar)
        } catch {
            /* already registered */
        }
        if (leftVar.id !== rightVar.id) {
            try {
                eng.addVariable(rightVar)
            } catch {
                /* already registered */
            }
        }
        const { result: pm } = eng.createPremiseWithId(premiseId)
        pm.addExpression(makeOpExpr(`${premiseId}-impl`, "implies"))
        pm.addExpression(
            makeVarExpr(`${premiseId}-ve-l`, leftVar.id, {
                parentId: `${premiseId}-impl`,
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr(`${premiseId}-ve-r`, rightVar.id, {
                parentId: `${premiseId}-impl`,
                position: 1,
            })
        )
        return pm
    }

    it("classifies transitive support through a chain", () => {
        // P1: A → B, P2: B → C, P3 (focused): C → D
        const eng = new ArgumentEngine(ARG)
        buildImplies(eng, "p1", VAR_A, VAR_B)
        buildImplies(eng, "p2", VAR_B, VAR_C)
        buildImplies(eng, "p3", VAR_C, VAR_D)

        const result = analyzePremiseRelationships(eng, "p3")
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("supporting")
        expect(p1Result.transitive).toBe(true)

        const p2Result = result.premises.find((p) => p.premiseId === "p2")!
        expect(p2Result.relationship).toBe("supporting")
        expect(p2Result.transitive).toBe(false)
    })

    it("unrelated premise remains unrelated even when other premises form a chain", () => {
        // P1: E → F (unrelated), P2: B → C, P3 (focused): C → D
        const eng = new ArgumentEngine(ARG)
        buildImplies(eng, "p1", VAR_E, VAR_F)
        buildImplies(eng, "p2", VAR_B, VAR_C)
        buildImplies(eng, "p3", VAR_C, VAR_D)

        const result = analyzePremiseRelationships(eng, "p3")
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("unrelated")
    })

    it("classifies transitive downstream", () => {
        // P1 (focused): A → B, P2: B → C, P3: C → D
        const eng = new ArgumentEngine(ARG)
        buildImplies(eng, "p1", VAR_A, VAR_B)
        buildImplies(eng, "p2", VAR_B, VAR_C)
        buildImplies(eng, "p3", VAR_C, VAR_D)

        const result = analyzePremiseRelationships(eng, "p1")
        const p3Result = result.premises.find((p) => p.premiseId === "p3")!
        expect(p3Result.relationship).toBe("downstream")
        expect(p3Result.transitive).toBe(true)
    })

    it("propagates contradicting polarity through a chain", () => {
        // P1: A → ¬B, P2: B → C, P3 (focused): C → D
        // P1 contradicts P2's antecedent, so P1 is transitively contradicting P3
        const eng = new ArgumentEngine(ARG)
        try {
            eng.addVariable(VAR_A)
        } catch {
            /* already registered */
        }
        try {
            eng.addVariable(VAR_B)
        } catch {
            /* already registered */
        }
        const { result: p1 } = eng.createPremiseWithId("p1")
        p1.addExpression(makeOpExpr("p1-impl", "implies"))
        p1.addExpression(
            makeVarExpr("p1-ve-a", VAR_A.id, {
                parentId: "p1-impl",
                position: 0,
            })
        )
        p1.addExpression(
            makeOpExpr("p1-not", "not", {
                parentId: "p1-impl",
                position: 1,
            })
        )
        p1.addExpression(
            makeVarExpr("p1-ve-b", VAR_B.id, {
                parentId: "p1-not",
                position: 0,
            })
        )
        buildImplies(eng, "p2", VAR_B, VAR_C)
        buildImplies(eng, "p3", VAR_C, VAR_D)

        const result = analyzePremiseRelationships(eng, "p3")
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("contradicting")
        expect(p1Result.transitive).toBe(true)
    })

    it("double negation through chain cancels to supporting", () => {
        // P1: A → ¬B, P2: ¬B → C, P3 (focused): C → D
        // P1's conseq is B(negative), P2's ante is B(negative) → polarity match → supporting
        const eng = new ArgumentEngine(ARG)
        try {
            eng.addVariable(VAR_A)
        } catch {
            /* already registered */
        }
        try {
            eng.addVariable(VAR_B)
        } catch {
            /* already registered */
        }
        try {
            eng.addVariable(VAR_C)
        } catch {
            /* already registered */
        }
        const { result: p1 } = eng.createPremiseWithId("p1")
        p1.addExpression(makeOpExpr("p1-impl", "implies"))
        p1.addExpression(
            makeVarExpr("p1-ve-a", VAR_A.id, {
                parentId: "p1-impl",
                position: 0,
            })
        )
        p1.addExpression(
            makeOpExpr("p1-not", "not", {
                parentId: "p1-impl",
                position: 1,
            })
        )
        p1.addExpression(
            makeVarExpr("p1-ve-b", VAR_B.id, {
                parentId: "p1-not",
                position: 0,
            })
        )

        const { result: p2 } = eng.createPremiseWithId("p2")
        p2.addExpression(makeOpExpr("p2-impl", "implies"))
        p2.addExpression(
            makeOpExpr("p2-not", "not", {
                parentId: "p2-impl",
                position: 0,
            })
        )
        p2.addExpression(
            makeVarExpr("p2-ve-b", VAR_B.id, {
                parentId: "p2-not",
                position: 0,
            })
        )
        p2.addExpression(
            makeVarExpr("p2-ve-c", VAR_C.id, {
                parentId: "p2-impl",
                position: 1,
            })
        )

        buildImplies(eng, "p3", VAR_C, VAR_D)

        const result = analyzePremiseRelationships(eng, "p3")
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("supporting")
        expect(p1Result.transitive).toBe(true)
    })

    it("constraint premise connected transitively is restricting", () => {
        // P1: A ∧ B (constraint), P2: B → C, P3 (focused): C → D
        // P1 shares B with P2 which supports P3 → P1 restricts P3 transitively
        const eng = new ArgumentEngine(ARG)
        try {
            eng.addVariable(VAR_A)
        } catch {
            /* already registered */
        }
        try {
            eng.addVariable(VAR_B)
        } catch {
            /* already registered */
        }
        const { result: p1 } = eng.createPremiseWithId("p1")
        p1.addExpression(makeOpExpr("p1-and", "and"))
        p1.addExpression(
            makeVarExpr("p1-ve-a", VAR_A.id, {
                parentId: "p1-and",
                position: 0,
            })
        )
        p1.addExpression(
            makeVarExpr("p1-ve-b", VAR_B.id, {
                parentId: "p1-and",
                position: 1,
            })
        )
        buildImplies(eng, "p2", VAR_B, VAR_C)
        buildImplies(eng, "p3", VAR_C, VAR_D)

        const result = analyzePremiseRelationships(eng, "p3")
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("restricting")
        expect(p1Result.transitive).toBe(true)
    })
})

describe("analyzePremiseRelationships — precedence and edge cases", () => {
    const VAR_A = makeVar("var-a", "A")
    const VAR_B = makeVar("var-b", "B")
    const VAR_C = makeVar("var-c", "C")
    const VAR_D = makeVar("var-d", "D")

    function buildImplies(
        eng: ArgumentEngine,
        premiseId: string,
        leftVar: TVariableInput,
        rightVar: TVariableInput
    ): PremiseManager {
        try {
            eng.addVariable(leftVar)
        } catch {
            /* already registered */
        }
        if (leftVar.id !== rightVar.id) {
            try {
                eng.addVariable(rightVar)
            } catch {
                /* already registered */
            }
        }
        const { result: pm } = eng.createPremiseWithId(premiseId)
        pm.addExpression(makeOpExpr(`${premiseId}-impl`, "implies"))
        pm.addExpression(
            makeVarExpr(`${premiseId}-ve-l`, leftVar.id, {
                parentId: `${premiseId}-impl`,
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr(`${premiseId}-ve-r`, rightVar.id, {
                parentId: `${premiseId}-impl`,
                position: 1,
            })
        )
        return pm
    }

    it("contradicting takes precedence over supporting", () => {
        // P1: A → (¬B ∧ C), P2 (focused): (B ∧ C) → D
        // B: contradicting (¬B in conseq, B in ante), C: supporting (C in conseq, C in ante)
        // Precedence: contradicting wins
        const eng = new ArgumentEngine(ARG)
        try {
            eng.addVariable(VAR_A)
        } catch {
            /* already registered */
        }
        try {
            eng.addVariable(VAR_B)
        } catch {
            /* already registered */
        }
        try {
            eng.addVariable(VAR_C)
        } catch {
            /* already registered */
        }
        try {
            eng.addVariable(VAR_D)
        } catch {
            /* already registered */
        }
        const { result: p1 } = eng.createPremiseWithId("p1")
        p1.addExpression(makeOpExpr("p1-impl", "implies"))
        p1.addExpression(
            makeVarExpr("p1-ve-a", VAR_A.id, {
                parentId: "p1-impl",
                position: 0,
            })
        )
        p1.addExpression(
            makeOpExpr("p1-and", "and", {
                parentId: "p1-impl",
                position: 1,
            })
        )
        p1.addExpression(
            makeOpExpr("p1-not", "not", {
                parentId: "p1-and",
                position: 0,
            })
        )
        p1.addExpression(
            makeVarExpr("p1-ve-b", VAR_B.id, {
                parentId: "p1-not",
                position: 0,
            })
        )
        p1.addExpression(
            makeVarExpr("p1-ve-c", VAR_C.id, {
                parentId: "p1-and",
                position: 1,
            })
        )

        const { result: p2 } = eng.createPremiseWithId("p2")
        p2.addExpression(makeOpExpr("p2-impl", "implies"))
        p2.addExpression(
            makeOpExpr("p2-and", "and", {
                parentId: "p2-impl",
                position: 0,
            })
        )
        p2.addExpression(
            makeVarExpr("p2-ve-b", VAR_B.id, {
                parentId: "p2-and",
                position: 0,
            })
        )
        p2.addExpression(
            makeVarExpr("p2-ve-c", VAR_C.id, {
                parentId: "p2-and",
                position: 1,
            })
        )
        p2.addExpression(
            makeVarExpr("p2-ve-d", VAR_D.id, {
                parentId: "p2-impl",
                position: 1,
            })
        )

        const result = analyzePremiseRelationships(eng, "p2")
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("contradicting")
    })

    it("restricting takes precedence over supporting", () => {
        // P1: B → (B ∧ C), P2 (focused): (B ∧ C) → D
        // B: restricting (in both ante and conseq of P1, in ante of P2)
        // C: supporting (in conseq of P1, in ante of P2)
        // Precedence: restricting wins
        const eng = new ArgumentEngine(ARG)
        try {
            eng.addVariable(VAR_B)
        } catch {
            /* already registered */
        }
        try {
            eng.addVariable(VAR_C)
        } catch {
            /* already registered */
        }
        try {
            eng.addVariable(VAR_D)
        } catch {
            /* already registered */
        }
        const { result: p1 } = eng.createPremiseWithId("p1")
        p1.addExpression(makeOpExpr("p1-impl", "implies"))
        p1.addExpression(
            makeVarExpr("p1-ve-b1", VAR_B.id, {
                parentId: "p1-impl",
                position: 0,
            })
        )
        p1.addExpression(
            makeOpExpr("p1-and", "and", {
                parentId: "p1-impl",
                position: 1,
            })
        )
        p1.addExpression(
            makeVarExpr("p1-ve-b2", VAR_B.id, {
                parentId: "p1-and",
                position: 0,
            })
        )
        p1.addExpression(
            makeVarExpr("p1-ve-c", VAR_C.id, {
                parentId: "p1-and",
                position: 1,
            })
        )

        const { result: p2 } = eng.createPremiseWithId("p2")
        p2.addExpression(makeOpExpr("p2-impl", "implies"))
        p2.addExpression(
            makeOpExpr("p2-and", "and", {
                parentId: "p2-impl",
                position: 0,
            })
        )
        p2.addExpression(
            makeVarExpr("p2-ve-b", VAR_B.id, {
                parentId: "p2-and",
                position: 0,
            })
        )
        p2.addExpression(
            makeVarExpr("p2-ve-c", VAR_C.id, {
                parentId: "p2-and",
                position: 1,
            })
        )
        p2.addExpression(
            makeVarExpr("p2-ve-d", VAR_D.id, {
                parentId: "p2-impl",
                position: 1,
            })
        )

        const result = analyzePremiseRelationships(eng, "p2")
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("restricting")
    })

    it("handles constraint-focused premise by classifying all sharers as restricting", () => {
        // P1: A → B, P2 (focused): A ∧ B (constraint)
        const eng = new ArgumentEngine(ARG)
        buildImplies(eng, "p1", VAR_A, VAR_B)
        const { result: p2 } = eng.createPremiseWithId("p2")
        p2.addExpression(makeOpExpr("p2-and", "and"))
        p2.addExpression(
            makeVarExpr("p2-ve-a", VAR_A.id, {
                parentId: "p2-and",
                position: 0,
            })
        )
        p2.addExpression(
            makeVarExpr("p2-ve-b", VAR_B.id, {
                parentId: "p2-and",
                position: 1,
            })
        )

        const result = analyzePremiseRelationships(eng, "p2")
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("restricting")
    })

    it("handles empty premise as unrelated", () => {
        const eng = new ArgumentEngine(ARG)
        eng.createPremiseWithId("p1") // empty
        buildImplies(eng, "p2", VAR_A, VAR_B)

        const result = analyzePremiseRelationships(eng, "p2")
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("unrelated")
    })

    it("handles graph cycles without hanging", () => {
        // P1: A → B, P2: B → A, P3 (focused): A → C
        const eng = new ArgumentEngine(ARG)
        buildImplies(eng, "p1", VAR_A, VAR_B)
        buildImplies(eng, "p2", VAR_B, VAR_A)
        buildImplies(eng, "p3", VAR_A, VAR_C)

        // Should complete without infinite loop
        const result = analyzePremiseRelationships(eng, "p3")
        expect(result.premises).toHaveLength(2)
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("supporting")
    })
})

describe("position utilities", () => {
    it("POSITION_INITIAL is midpoint of range", () => {
        expect(POSITION_INITIAL).toBe(Math.floor(Number.MAX_SAFE_INTEGER / 2))
    })

    it("POSITION_MIN is 0", () => {
        expect(POSITION_MIN).toBe(0)
    })

    it("POSITION_MAX is MAX_SAFE_INTEGER", () => {
        expect(POSITION_MAX).toBe(Number.MAX_SAFE_INTEGER)
    })

    it("midpoint computes average of two numbers", () => {
        expect(midpoint(0, 100)).toBe(50)
        expect(midpoint(10, 20)).toBe(15)
    })

    it("midpoint works with large numbers", () => {
        const a = POSITION_INITIAL
        const b = POSITION_MAX
        const m = midpoint(a, b)
        expect(m).toBeGreaterThan(a)
        expect(m).toBeLessThan(b)
    })

    it("midpoint of equal values returns that value", () => {
        expect(midpoint(50, 50)).toBe(50)
    })
})

describe("PremiseManager — appendExpression and addExpressionRelative", () => {
    it("appendExpression assigns POSITION_INITIAL to first child", () => {
        const pm = premiseWithVars()
        pm.appendExpression(null, {
            id: "root",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            type: "operator",
            operator: "and",
            parentId: null,
        })
        const root = pm.getExpression("root")!
        expect(root.position).toBe(POSITION_INITIAL)
    })

    it("appendExpression appends after last child", () => {
        const pm = premiseWithVars()
        pm.addExpression(
            makeOpExpr("root", "and", {
                parentId: null,
                position: POSITION_INITIAL,
            })
        )
        pm.appendExpression("root", {
            id: "c1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            type: "variable",
            variableId: "var-p",
            parentId: "root",
        })
        pm.appendExpression("root", {
            id: "c2",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            type: "variable",
            variableId: "var-q",
            parentId: "root",
        })
        const children = pm.getChildExpressions("root")
        expect(children).toHaveLength(2)
        expect(children[0].id).toBe("c1")
        expect(children[1].id).toBe("c2")
        expect(children[0].position).toBeLessThan(children[1].position)
    })

    it("addExpressionRelative before inserts before sibling", () => {
        const pm = premiseWithVars()
        pm.addExpression(
            makeOpExpr("root", "and", {
                parentId: null,
                position: POSITION_INITIAL,
            })
        )
        pm.appendExpression("root", {
            id: "c1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            type: "variable",
            variableId: "var-p",
            parentId: "root",
        })
        pm.addExpressionRelative("c1", "before", {
            id: "c0",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            type: "variable",
            variableId: "var-q",
            parentId: "root",
        })
        const children = pm.getChildExpressions("root")
        expect(children).toHaveLength(2)
        expect(children[0].id).toBe("c0")
        expect(children[1].id).toBe("c1")
    })

    it("addExpressionRelative after inserts after sibling", () => {
        const pm = premiseWithVars()
        pm.addExpression(
            makeOpExpr("root", "and", {
                parentId: null,
                position: POSITION_INITIAL,
            })
        )
        pm.appendExpression("root", {
            id: "c1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            type: "variable",
            variableId: "var-p",
            parentId: "root",
        })
        pm.appendExpression("root", {
            id: "c3",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            type: "variable",
            variableId: "var-r",
            parentId: "root",
        })
        pm.addExpressionRelative("c1", "after", {
            id: "c2",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            type: "variable",
            variableId: "var-q",
            parentId: "root",
        })
        const children = pm.getChildExpressions("root")
        expect(children).toHaveLength(3)
        expect(children[0].id).toBe("c1")
        expect(children[1].id).toBe("c2")
        expect(children[2].id).toBe("c3")
    })

    it("addExpressionRelative after last child appends", () => {
        const pm = premiseWithVars()
        pm.addExpression(
            makeOpExpr("root", "and", {
                parentId: null,
                position: POSITION_INITIAL,
            })
        )
        pm.appendExpression("root", {
            id: "c1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            type: "variable",
            variableId: "var-p",
            parentId: "root",
        })
        pm.addExpressionRelative("c1", "after", {
            id: "c2",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            type: "variable",
            variableId: "var-q",
            parentId: "root",
        })
        const children = pm.getChildExpressions("root")
        expect(children).toHaveLength(2)
        expect(children[0].id).toBe("c1")
        expect(children[1].id).toBe("c2")
        expect(children[0].position).toBeLessThan(children[1].position)
    })

    it("addExpressionRelative throws if sibling not found", () => {
        const pm = premiseWithVars()
        expect(() =>
            pm.addExpressionRelative("nonexistent", "before", {
                id: "c1",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                type: "variable",
                variableId: "var-p",
                parentId: null,
            })
        ).toThrow(/not found/)
    })
})

describe("ChangeCollector", () => {
    it("starts with an empty changeset", () => {
        const collector = new ChangeCollector()
        const cs = collector.toChangeset()
        expect(cs).toEqual({})
    })

    it("collects added expressions", () => {
        const collector = new ChangeCollector()
        const expr = {
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "a1",
            argumentVersion: 0,
            parentId: null,
            position: 0,
        } as TExpressionInput
        collector.addedExpression(expr)
        const cs = collector.toChangeset()
        expect(cs.expressions?.added).toEqual([expr])
        expect(cs.expressions?.modified).toEqual([])
        expect(cs.expressions?.removed).toEqual([])
    })

    it("collects modified and removed expressions", () => {
        const collector = new ChangeCollector()
        const modified = {
            id: "e1",
            type: "variable",
        } as TExpressionInput
        const removed = {
            id: "e2",
            type: "operator",
        } as TExpressionInput
        collector.modifiedExpression(modified)
        collector.removedExpression(removed)
        const cs = collector.toChangeset()
        expect(cs.expressions?.added).toEqual([])
        expect(cs.expressions?.modified).toEqual([modified])
        expect(cs.expressions?.removed).toEqual([removed])
    })

    it("collects variable changes", () => {
        const collector = new ChangeCollector()
        const v = {
            id: "v1",
            symbol: "P",
            argumentId: "a1",
            argumentVersion: 0,
        } as TVariableInput
        collector.addedVariable(v)
        const cs = collector.toChangeset()
        expect(cs.variables?.added).toEqual([v])
        expect(cs.expressions).toBeUndefined()
    })

    it("collects premise changes", () => {
        const collector = new ChangeCollector()
        const p = {
            id: "p1",
            variables: [],
            expressions: [],
            checksum: "x",
        } as TCorePremise
        collector.addedPremise(p)
        const cs = collector.toChangeset()
        expect(cs.premises?.added).toEqual([p])
    })

    it("records role state changes", () => {
        const collector = new ChangeCollector()
        const roles = {
            conclusionPremiseId: "p1",
        }
        collector.setRoles(roles)
        const cs = collector.toChangeset()
        expect(cs.roles).toEqual(roles)
    })

    it("omits unchanged categories from changeset", () => {
        const collector = new ChangeCollector()
        const expr = { id: "e1" } as TExpressionInput
        collector.addedExpression(expr)
        const cs = collector.toChangeset()
        expect(cs.variables).toBeUndefined()
        expect(cs.premises).toBeUndefined()
        expect(cs.roles).toBeUndefined()
        expect(cs.argument).toBeUndefined()
    })
})

// ---------------------------------------------------------------------------
// PremiseManager — mutation changesets
// ---------------------------------------------------------------------------

describe("PremiseManager — mutation changesets", () => {
    function setup() {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        const v1 = {
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
        }
        const v2 = {
            id: "v2",
            symbol: "Q",
            argumentId: "arg1",
            argumentVersion: 0,
        }
        eng.addVariable(v1)
        eng.addVariable(v2)
        const { result: pm } = eng.createPremise()
        return { eng, pm, v1, v2 }
    }

    it("addExpression returns the added expression in result and changes", () => {
        const { pm } = setup()
        const expr: TExpressionInput = {
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            parentId: null,
            position: 1,
        }
        const { result, changes } = pm.addExpression(expr)
        expect(result.id).toBe("e1")
        expect(changes.expressions?.added).toHaveLength(1)
        expect(changes.expressions?.added[0].id).toBe("e1")
        expect(changes.expressions?.modified).toEqual([])
        expect(changes.expressions?.removed).toEqual([])
    })

    it("removeExpression with collapse returns all affected expressions", () => {
        const { pm } = setup()
        // Build: and(v1, v2)
        pm.addExpression({
            id: "op",
            type: "operator",
            operator: "and",
            argumentId: "arg1",
            argumentVersion: 0,
            parentId: null,
            position: 1,
        })
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            parentId: "op",
            position: 1,
        })
        pm.addExpression({
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg1",
            argumentVersion: 0,
            parentId: "op",
            position: 2,
        })
        // Remove e1 -> operator collapses (1 child), e2 gets promoted
        const { result, changes } = pm.removeExpression("e1")
        expect(result?.id).toBe("e1")
        // e1 removed, operator removed (collapse)
        const removedIds = changes.expressions!.removed.map((e) => e.id).sort()
        expect(removedIds).toContain("e1")
        expect(removedIds).toContain("op")
        // e2 modified (reparented to root)
        expect(changes.expressions!.modified).toHaveLength(1)
        expect(changes.expressions!.modified[0].id).toBe("e2")
        expect(changes.expressions!.modified[0].parentId).toBeNull()
    })

    it("insertExpression returns added expression and records reparented children", () => {
        const { pm } = setup()
        // Build: and(v1, v2), then insert formula wrapping v1
        pm.addExpression({
            id: "and1",
            type: "operator",
            operator: "and",
            argumentId: "arg1",
            argumentVersion: 0,
            parentId: null,
            position: 1,
        })
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            parentId: "and1",
            position: 1,
        })
        pm.addExpression({
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg1",
            argumentVersion: 0,
            parentId: "and1",
            position: 2,
        })
        // Insert a formula node wrapping e1
        const { result, changes } = pm.insertExpression(
            {
                id: "f1",
                type: "formula",
                argumentId: "arg1",
                argumentVersion: 0,
                parentId: "and1",
                position: 1,
            },
            "e1"
        )
        expect(result.id).toBe("f1")
        expect(changes.expressions?.added).toHaveLength(1)
        expect(changes.expressions?.added[0].id).toBe("f1")
        // e1 was reparented under f1
        expect(changes.expressions?.modified?.length).toBeGreaterThanOrEqual(1)
        const modifiedE1 = changes.expressions?.modified?.find(
            (e) => e.id === "e1"
        )
        expect(modifiedE1?.parentId).toBe("f1")
    })

    it("appendExpression returns expression with computed position", () => {
        const { pm } = setup()
        pm.addExpression({
            id: "and1",
            type: "operator",
            operator: "and",
            argumentId: "arg1",
            argumentVersion: 0,
            parentId: null,
            position: 1,
        })
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            parentId: "and1",
            position: 1,
        })
        const { result, changes } = pm.appendExpression("and1", {
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg1",
            argumentVersion: 0,
            parentId: "and1",
        })
        expect(result.id).toBe("e2")
        expect(result.position).toBeGreaterThan(1) // computed position after e1
        expect(changes.expressions?.added).toHaveLength(1)
        expect(changes.expressions?.added[0].id).toBe("e2")
    })

    it("addExpressionRelative returns expression with computed position", () => {
        const { pm } = setup()
        pm.addExpression({
            id: "and1",
            type: "operator",
            operator: "and",
            argumentId: "arg1",
            argumentVersion: 0,
            parentId: null,
            position: 1,
        })
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            parentId: "and1",
            position: 1,
        })
        pm.addExpression({
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg1",
            argumentVersion: 0,
            parentId: "and1",
            position: 3,
        })
        const { result, changes } = pm.addExpressionRelative("e1", "after", {
            id: "e3",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            parentId: "and1",
        })
        expect(result.id).toBe("e3")
        // Should be between e1 (pos 1) and e2 (pos 3)
        expect(result.position).toBeGreaterThan(1)
        expect(result.position).toBeLessThan(3)
        expect(changes.expressions?.added).toHaveLength(1)
        expect(changes.expressions?.added[0].id).toBe("e3")
    })

    it("removeExpression for non-existent ID returns undefined result and empty changes", () => {
        const { pm } = setup()
        const { result, changes } = pm.removeExpression("nonexistent")
        expect(result).toBeUndefined()
        expect(changes).toEqual({})
    })

    it("addVariable returns the variable in result and changes", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        const v = {
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
        }
        const { result, changes } = eng.addVariable(v)
        expect(result.id).toBe("v1")
        expect(result.symbol).toBe("P")
        expect(changes.variables?.added).toHaveLength(1)
        expect(changes.variables?.added[0].id).toBe("v1")
    })

    it("removeVariable returns removed variable in result and changes", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        const v = {
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
        }
        eng.addVariable(v)
        const { result, changes } = eng.removeVariable("v1")
        expect(result?.id).toBe("v1")
        expect(changes.variables?.removed).toHaveLength(1)
        expect(changes.variables?.removed[0].id).toBe("v1")
    })

    it("removeVariable for non-existent variable returns undefined with empty changes", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        const { result, changes } = eng.removeVariable("nonexistent")
        expect(result).toBeUndefined()
        expect(changes).toEqual({})
    })

    it("setExtras returns new extras with empty changes", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        const { result: pm } = eng.createPremise()
        const { result, changes } = pm.setExtras({ title: "Test" })
        expect(result).toEqual({ title: "Test" })
        expect(changes).toEqual({})
    })
})

// ---------------------------------------------------------------------------
// ArgumentEngine — mutation changesets
// ---------------------------------------------------------------------------

describe("ArgumentEngine — mutation changesets", () => {
    it("createPremise returns PremiseManager and records added premise", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        const { result: pm, changes } = eng.createPremise()
        expect(pm).toBeInstanceOf(PremiseManager)
        expect(changes.premises?.added).toHaveLength(1)
        expect(changes.premises?.added[0].id).toBe(pm.getId())
    })

    it("createPremiseWithId returns PremiseManager with specified ID", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        const { result: pm, changes } = eng.createPremiseWithId("my-premise")
        expect(pm.getId()).toBe("my-premise")
        expect(changes.premises?.added).toHaveLength(1)
        expect(changes.premises?.added[0].id).toBe("my-premise")
    })

    it("removePremise returns premise data and records removal", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        eng.createPremise()
        const premiseId = eng.listPremiseIds()[0]
        const { result, changes } = eng.removePremise(premiseId)
        expect(result?.id).toBe(premiseId)
        expect(changes.premises?.removed).toHaveLength(1)
        expect(changes.premises?.removed[0].id).toBe(premiseId)
    })

    it("removePremise that was conclusion also records role change", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        const { result: pm } = eng.createPremise()
        eng.setConclusionPremise(pm.getId())
        const { changes } = eng.removePremise(pm.getId())
        expect(changes.roles).toBeDefined()
        expect(changes.roles?.conclusionPremiseId).toBeUndefined()
    })

    it("removePremise for non-existent ID returns undefined", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        const { result, changes } = eng.removePremise("nope")
        expect(result).toBeUndefined()
        expect(changes).toEqual({})
    })

    it("setConclusionPremise returns new role state", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        const { result: pm } = eng.createPremise()
        const { result, changes } = eng.setConclusionPremise(pm.getId())
        expect(result.conclusionPremiseId).toBe(pm.getId())
        expect(changes.roles?.conclusionPremiseId).toBe(pm.getId())
    })

    it("clearConclusionPremise returns empty role state", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        const { result: pm } = eng.createPremise()
        eng.setConclusionPremise(pm.getId())
        const { result, changes } = eng.clearConclusionPremise()
        expect(result.conclusionPremiseId).toBeUndefined()
        expect(changes.roles).toBeDefined()
    })
})

// ---------------------------------------------------------------------------
// checksum utilities
// ---------------------------------------------------------------------------

describe("checksum utilities", () => {
    describe("computeHash", () => {
        it("produces consistent hash for same input", () => {
            expect(computeHash("hello")).toBe(computeHash("hello"))
        })

        it("produces different hash for different input", () => {
            expect(computeHash("a")).not.toBe(computeHash("b"))
        })

        it("returns 8-character hex string", () => {
            const hash = computeHash("test")
            expect(hash).toMatch(/^[0-9a-f]{8}$/)
        })
    })

    describe("canonicalSerialize", () => {
        it("sorts object keys", () => {
            const a = canonicalSerialize({ b: 2, a: 1 })
            const b = canonicalSerialize({ a: 1, b: 2 })
            expect(a).toBe(b)
        })

        it("handles nested objects", () => {
            const a = canonicalSerialize({ z: { b: 2, a: 1 }, a: 0 })
            const b = canonicalSerialize({ a: 0, z: { a: 1, b: 2 } })
            expect(a).toBe(b)
        })

        it("handles arrays (preserves order)", () => {
            const a = canonicalSerialize([3, 1, 2])
            expect(a).toBe("[3,1,2]")
        })

        it("handles null and primitives", () => {
            expect(canonicalSerialize(null)).toBe("null")
            expect(canonicalSerialize(42)).toBe("42")
            expect(canonicalSerialize("hello")).toBe('"hello"')
        })
    })

    describe("entityChecksum", () => {
        it("uses only specified fields", () => {
            const cs1 = entityChecksum(
                { id: "1", symbol: "P", extra: "ignored" },
                ["id", "symbol"]
            )
            const cs2 = entityChecksum(
                { id: "1", symbol: "P", extra: "different" },
                ["id", "symbol"]
            )
            expect(cs1).toBe(cs2)
        })

        it("differs when included fields differ", () => {
            const cs1 = entityChecksum({ id: "1", symbol: "P" }, [
                "id",
                "symbol",
            ])
            const cs2 = entityChecksum({ id: "1", symbol: "Q" }, [
                "id",
                "symbol",
            ])
            expect(cs1).not.toBe(cs2)
        })

        it("field order does not affect checksum", () => {
            const cs1 = entityChecksum({ id: "1", symbol: "P" }, [
                "symbol",
                "id",
            ])
            const cs2 = entityChecksum({ id: "1", symbol: "P" }, [
                "id",
                "symbol",
            ])
            expect(cs1).toBe(cs2)
        })

        it("skips fields not present on entity", () => {
            const cs1 = entityChecksum({ id: "1" }, ["id", "missing"])
            const cs2 = entityChecksum({ id: "1" }, ["id"])
            expect(cs1).toBe(cs2)
        })
    })

    describe("PremiseManager — checksum", () => {
        it("returns consistent checksum for same state", () => {
            const eng = new ArgumentEngine({ id: "arg1", version: 0 })
            const { result: pm } = eng.createPremise()
            const cs1 = pm.checksum()
            const cs2 = pm.checksum()
            expect(cs1).toBe(cs2)
        })

        it("checksum changes when an expression is added", () => {
            const eng = new ArgumentEngine({ id: "arg1", version: 0 })
            const v = {
                id: "v1",
                symbol: "P",
                argumentId: "arg1",
                argumentVersion: 0,
            }
            eng.addVariable(v)
            const { result: pm } = eng.createPremise()
            const before = pm.checksum()
            pm.addExpression({
                id: "e1",
                type: "variable",
                variableId: "v1",
                argumentId: "arg1",
                argumentVersion: 0,
                parentId: null,
                position: 1,
            })
            const after = pm.checksum()
            expect(before).not.toBe(after)
        })

        it("checksum changes when a variable is added", () => {
            const eng = new ArgumentEngine({ id: "arg1", version: 0 })
            const { result: pm } = eng.createPremise()
            const before = pm.checksum()
            eng.addVariable({
                id: "v1",
                symbol: "P",
                argumentId: "arg1",
                argumentVersion: 0,
            })
            const after = pm.checksum()
            expect(before).not.toBe(after)
        })

        it("identical premises built the same way produce same checksum", () => {
            const eng = new ArgumentEngine({ id: "arg1", version: 0 })
            const v1 = {
                id: "v1",
                symbol: "P",
                argumentId: "arg1",
                argumentVersion: 0,
            }
            eng.addVariable(v1)
            const { result: pm1 } = eng.createPremiseWithId("p1")
            const { result: pm2 } = eng.createPremiseWithId("p2")
            // Different premise IDs mean different checksums (id is part of checksum)
            expect(pm1.checksum()).not.toBe(pm2.checksum())
        })
    })

    describe("ArgumentEngine — checksum", () => {
        it("returns consistent checksum for same state", () => {
            const eng = new ArgumentEngine({ id: "arg1", version: 0 })
            expect(eng.checksum()).toBe(eng.checksum())
        })

        it("checksum changes when a premise is added", () => {
            const eng = new ArgumentEngine({ id: "arg1", version: 0 })
            const before = eng.checksum()
            eng.createPremise()
            const after = eng.checksum()
            expect(before).not.toBe(after)
        })

        it("checksum changes when conclusion is set", () => {
            const eng = new ArgumentEngine({ id: "arg1", version: 0 })
            const { result: pm } = eng.createPremise()
            const before = eng.checksum()
            eng.setConclusionPremise(pm.getId())
            const after = eng.checksum()
            expect(before).not.toBe(after)
        })

        it("accepts custom checksum config", () => {
            const eng = new ArgumentEngine(
                { id: "arg1", version: 0 },
                { checksumConfig: { argumentFields: new Set(["id"]) } }
            )
            const cs = eng.checksum()
            expect(cs).toMatch(/^[0-9a-f]{8}$/)
        })
    })
})

// ---------------------------------------------------------------------------
// Entity checksum fields
// ---------------------------------------------------------------------------

describe("entity checksum fields", () => {
    function setupPremise() {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        const v = {
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
        }
        eng.addVariable(v)
        const { result: pm } = eng.createPremise()
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            parentId: null,
            position: 1,
        })
        return { eng, pm }
    }

    it("getExpressions returns expressions with checksums", () => {
        const { pm } = setupPremise()
        const exprs = pm.getExpressions()
        expect(exprs).toHaveLength(1)
        expect(exprs[0].checksum).toBeDefined()
        expect(typeof exprs[0].checksum).toBe("string")
        expect(exprs[0].checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("getExpression returns expression with checksum", () => {
        const { pm } = setupPremise()
        const expr = pm.getExpression("e1")
        expect(expr).toBeDefined()
        expect(expr!.checksum).toBeDefined()
        expect(expr!.checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("getRootExpression returns expression with checksum", () => {
        const { pm } = setupPremise()
        const root = pm.getRootExpression()
        expect(root).toBeDefined()
        expect(root!.checksum).toBeDefined()
        expect(root!.checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("getChildExpressions returns expressions with checksums", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
        })
        eng.addVariable({
            id: "v2",
            symbol: "Q",
            argumentId: "arg1",
            argumentVersion: 0,
        })
        const { result: pm } = eng.createPremise()
        pm.addExpression({
            id: "op",
            type: "operator",
            operator: "and",
            argumentId: "arg1",
            argumentVersion: 0,
            parentId: null,
            position: 1,
        })
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            parentId: "op",
            position: 1,
        })
        pm.addExpression({
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg1",
            argumentVersion: 0,
            parentId: "op",
            position: 2,
        })
        const children = pm.getChildExpressions("op")
        expect(children).toHaveLength(2)
        expect(children[0].checksum).toMatch(/^[0-9a-f]{8}$/)
        expect(children[1].checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("getVariables returns variables with checksums", () => {
        const { pm } = setupPremise()
        const vars = pm.getVariables()
        expect(vars).toHaveLength(1)
        expect(vars[0].checksum).toBeDefined()
        expect(typeof vars[0].checksum).toBe("string")
        expect(vars[0].checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("toData includes premise-level checksum", () => {
        const { pm } = setupPremise()
        const data = pm.toData()
        expect(data.checksum).toBeDefined()
        expect(typeof data.checksum).toBe("string")
        expect(data.checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("toData expressions include entity checksums", () => {
        const { pm } = setupPremise()
        const data = pm.toData()
        expect(data.expressions).toHaveLength(1)
        expect(data.expressions[0].checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("changeset expressions from addExpression include checksums", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
        })
        const { result: pm } = eng.createPremise()
        const { changes } = pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            parentId: null,
            position: 1,
        })
        expect(changes.expressions?.added).toHaveLength(1)
        expect(changes.expressions?.added[0].checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("changeset expressions from removeExpression include checksums", () => {
        const { pm } = setupPremise()
        const { changes } = pm.removeExpression("e1")
        expect(changes.expressions?.removed).toHaveLength(1)
        expect(changes.expressions?.removed[0].checksum).toMatch(
            /^[0-9a-f]{8}$/
        )
    })

    it("changeset variables from addVariable include checksums", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        const { changes } = eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
        })
        expect(changes.variables?.added).toHaveLength(1)
        expect(changes.variables?.added[0].checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("changeset variables from removeVariable include checksums", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
        })
        const { changes } = eng.removeVariable("v1")
        expect(changes.variables?.removed).toHaveLength(1)
        expect(changes.variables?.removed[0].checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("addExpression result includes checksum", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
        })
        const { result: pm } = eng.createPremise()
        const { result } = pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            parentId: null,
            position: 1,
        })
        expect(result.checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("addVariable result includes checksum", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        const { result } = eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
        })
        expect(result.checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("ArgumentEngine toData includes argument-level checksum", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        eng.createPremise()
        const data = eng.toData()
        expect(data.argument.checksum).toBeDefined()
        expect(data.argument.checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("ArgumentEngine toData premises include premise-level checksums", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        eng.createPremise()
        const data = eng.toData()
        expect(data.premises).toHaveLength(1)
        expect(data.premises[0].checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("expression checksum is consistent across getters", () => {
        const { pm } = setupPremise()
        const fromGetExpressions = pm.getExpressions()[0].checksum
        const fromGetExpression = pm.getExpression("e1")!.checksum
        const fromGetRoot = pm.getRootExpression()!.checksum
        expect(fromGetExpressions).toBe(fromGetExpression)
        expect(fromGetExpressions).toBe(fromGetRoot)
    })

    it("changeset modified expressions include checksums after collapse", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
        })
        eng.addVariable({
            id: "v2",
            symbol: "Q",
            argumentId: "arg1",
            argumentVersion: 0,
        })
        const { result: pm } = eng.createPremise()
        pm.addExpression({
            id: "op",
            type: "operator",
            operator: "and",
            argumentId: "arg1",
            argumentVersion: 0,
            parentId: null,
            position: 1,
        })
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            parentId: "op",
            position: 1,
        })
        pm.addExpression({
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg1",
            argumentVersion: 0,
            parentId: "op",
            position: 2,
        })
        // Remove e1 -> operator collapses, e2 gets modified (reparented)
        const { changes } = pm.removeExpression("e1")
        expect(changes.expressions!.modified).toHaveLength(1)
        expect(changes.expressions!.modified[0].checksum).toMatch(
            /^[0-9a-f]{8}$/
        )
    })
})

describe("createChecksumConfig", () => {
    it("returns defaults when given empty config", () => {
        const config = createChecksumConfig({})
        expect(config.expressionFields).toEqual(
            DEFAULT_CHECKSUM_CONFIG.expressionFields
        )
        expect(config.variableFields).toEqual(
            DEFAULT_CHECKSUM_CONFIG.variableFields
        )
        expect(config.premiseFields).toEqual(
            DEFAULT_CHECKSUM_CONFIG.premiseFields
        )
        expect(config.argumentFields).toEqual(
            DEFAULT_CHECKSUM_CONFIG.argumentFields
        )
        expect(config.roleFields).toEqual(DEFAULT_CHECKSUM_CONFIG.roleFields)
    })

    it("merges additional fields into defaults", () => {
        const config = createChecksumConfig({
            expressionFields: new Set(["customField"]),
        })
        expect(config.expressionFields!.has("id")).toBe(true)
        expect(config.expressionFields!.has("customField")).toBe(true)
    })

    it("does not duplicate fields already in defaults", () => {
        const config = createChecksumConfig({
            variableFields: new Set(["id", "extra"]),
        })
        const arr = [...config.variableFields!]
        expect(arr.filter((f) => f === "id")).toHaveLength(1)
        expect(config.variableFields!.has("extra")).toBe(true)
    })

    it("returns a new Set instance (not the same reference as defaults)", () => {
        const config = createChecksumConfig({})
        expect(config.expressionFields).not.toBe(
            DEFAULT_CHECKSUM_CONFIG.expressionFields
        )
    })
})

// ---------------------------------------------------------------------------
// ArgumentEngine — variable management
// ---------------------------------------------------------------------------

describe("ArgumentEngine — variable management", () => {
    it("addVariable registers a variable accessible from all premises", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        const { result: pm1 } = eng.createPremise()
        const { result: pm2 } = eng.createPremise()

        // Both premises can add expressions referencing VAR_P
        pm1.addExpression(
            makeVarExpr("e-p1", VAR_P.id, { parentId: null, position: 1 })
        )
        pm2.addExpression(
            makeVarExpr("e-p2", VAR_P.id, { parentId: null, position: 1 })
        )

        expect(pm1.getVariables()).toHaveLength(1)
        expect(pm2.getVariables()).toHaveLength(1)
    })

    it("addVariable throws for duplicate symbol", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        expect(() =>
            eng.addVariable({
                id: "var-other",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                symbol: "P",
            })
        ).toThrow(/already exists/)
    })

    it("addVariable throws for duplicate id", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        expect(() => eng.addVariable(VAR_P)).toThrow(/already exists/)
    })

    it("addVariable throws for wrong argumentId", () => {
        const eng = new ArgumentEngine(ARG)
        expect(() =>
            eng.addVariable({
                id: "var-x",
                argumentId: "other",
                argumentVersion: ARG.version,
                symbol: "X",
            })
        ).toThrow(/does not match/)
    })

    it("addVariable throws for wrong argumentVersion", () => {
        const eng = new ArgumentEngine(ARG)
        expect(() =>
            eng.addVariable({
                id: "var-x",
                argumentId: ARG.id,
                argumentVersion: 99,
                symbol: "X",
            })
        ).toThrow(/does not match/)
    })

    it("addVariable returns mutation result with changeset", () => {
        const eng = new ArgumentEngine(ARG)
        const { result, changes } = eng.addVariable(VAR_P)
        expect(result.id).toBe(VAR_P.id)
        expect(result.checksum).toBeDefined()
        expect(changes.variables?.added).toHaveLength(1)
    })

    it("updateVariable renames a symbol", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        const { result } = eng.updateVariable(VAR_P.id, { symbol: "P_new" })
        expect(result?.symbol).toBe("P_new")

        const { result: pm } = eng.createPremise()
        expect(pm.getVariables()[0].symbol).toBe("P_new")
    })

    it("updateVariable returns undefined for non-existent variable", () => {
        const eng = new ArgumentEngine(ARG)
        const { result } = eng.updateVariable("nope", { symbol: "X" })
        expect(result).toBeUndefined()
    })

    it("updateVariable throws for conflicting symbol", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        expect(() => eng.updateVariable(VAR_P.id, { symbol: "Q" })).toThrow(
            /already in use/
        )
    })

    it("updateVariable returns changeset with modified variable", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        const { changes } = eng.updateVariable(VAR_P.id, { symbol: "X" })
        expect(changes.variables?.modified).toHaveLength(1)
        expect(changes.variables?.modified[0].symbol).toBe("X")
    })

    it("getVariables returns all variables with checksums", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const vars = eng.getVariables()
        expect(vars).toHaveLength(2)
        expect(vars[0].checksum).toBeDefined()
        expect(vars[1].checksum).toBeDefined()
    })

    it("removeVariable with no references removes cleanly", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        const { result, changes } = eng.removeVariable(VAR_P.id)
        expect(result?.id).toBe(VAR_P.id)
        expect(changes.variables?.removed).toHaveLength(1)
        expect(eng.getVariables()).toHaveLength(0)
    })

    it("removeVariable returns undefined for non-existent variable", () => {
        const eng = new ArgumentEngine(ARG)
        const { result, changes } = eng.removeVariable("nonexistent")
        expect(result).toBeUndefined()
        expect(changes).toEqual({})
    })

    it("removeVariable cascade-deletes referencing expressions in one premise", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise()

        // Add two root-level expressions (only one root allowed, so use an and operator)
        pm.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: "op-and", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-q", VAR_Q.id, { parentId: "op-and", position: 2 })
        )

        const { changes } = eng.removeVariable(VAR_P.id)
        // e-p gone, operator collapsed (1 child remaining → Q promoted)
        expect(pm.getExpression("e-p")).toBeUndefined()
        expect(pm.getExpression("e-q")).toBeDefined()
        expect(changes.expressions?.removed.length).toBeGreaterThan(0)
    })

    it("removeVariable cascade-deletes across multiple premises", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        const { result: pm1 } = eng.createPremise()
        const { result: pm2 } = eng.createPremise()

        pm1.addExpression(
            makeVarExpr("e-p1", VAR_P.id, { parentId: null, position: 1 })
        )
        pm2.addExpression(
            makeVarExpr("e-p2", VAR_P.id, { parentId: null, position: 1 })
        )

        eng.removeVariable(VAR_P.id)

        expect(pm1.getExpression("e-p1")).toBeUndefined()
        expect(pm2.getExpression("e-p2")).toBeUndefined()
    })

    it("removeVariable triggers operator collapse", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise()

        // Build (P ∧ Q)
        pm.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: "op-and", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-q", VAR_Q.id, { parentId: "op-and", position: 2 })
        )

        eng.removeVariable(VAR_P.id)

        // op-and gone (collapsed: 1 child remaining), Q promoted to root
        expect(pm.getExpression("op-and")).toBeUndefined()
        expect(pm.getRootExpression()?.id).toBe("e-q")
    })

    it("removeVariable deletes subtrees when removing from implies", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise()

        // Build P → Q
        pm.addExpression(
            makeOpExpr("op-impl", "implies", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: "op-impl", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-q", VAR_Q.id, { parentId: "op-impl", position: 2 })
        )

        eng.removeVariable(VAR_P.id)

        // implies collapses (1 child remaining), Q survives as root
        expect(pm.getExpression("op-impl")).toBeUndefined()
        expect(pm.getExpression("e-p")).toBeUndefined()
        expect(pm.getRootExpression()?.id).toBe("e-q")
    })
})

// ---------------------------------------------------------------------------
// PremiseManager — deleteExpressionsUsingVariable
// ---------------------------------------------------------------------------

describe("PremiseManager — deleteExpressionsUsingVariable", () => {
    it("returns empty result when variable has no expressions", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise()

        const { result, changes } = pm.deleteExpressionsUsingVariable(VAR_P.id)
        expect(result).toHaveLength(0)
        expect(changes).toEqual({})
    })

    it("deletes a single variable expression", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise()

        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: null, position: 1 })
        )

        const { result, changes } = pm.deleteExpressionsUsingVariable(VAR_P.id)
        expect(result).toHaveLength(1)
        expect(pm.getExpression("e-p")).toBeUndefined()
        expect(changes.expressions?.removed.length).toBeGreaterThan(0)
    })

    it("deletes multiple expressions referencing the same variable", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise()

        // Build (P ∧ P)
        pm.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-p1", VAR_P.id, { parentId: "op-and", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-p2", VAR_P.id, { parentId: "op-and", position: 2 })
        )

        const { result } = pm.deleteExpressionsUsingVariable(VAR_P.id)

        // Both P expressions removed (and operator collapses too)
        expect(result.length).toBeGreaterThanOrEqual(2)
        expect(pm.getExpression("e-p1")).toBeUndefined()
        expect(pm.getExpression("e-p2")).toBeUndefined()
        expect(pm.getExpression("op-and")).toBeUndefined()
    })

    it("handles already-removed expressions from subtree cascade", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise()

        // Build not(P)
        pm.addExpression(
            makeOpExpr("op-not", "not", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: "op-not", position: 1 })
        )

        const { result } = pm.deleteExpressionsUsingVariable(VAR_P.id)

        // P is directly removed, not collapses (0 children)
        expect(result).toHaveLength(1)
        expect(pm.getExpression("e-p")).toBeUndefined()
        expect(pm.getExpression("op-not")).toBeUndefined()
        expect(pm.getExpressions()).toHaveLength(0)
    })
})

// ---------------------------------------------------------------------------
// Variable expressions cannot have children
// ---------------------------------------------------------------------------

describe("variable expressions cannot have children", () => {
    it("addExpression rejects a child whose parent is a variable expression", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            premise.addExpression(
                makeVarExpr("expr-q", VAR_Q.id, { parentId: "expr-p" })
            )
        ).toThrowError(/is not an operator expression/)
    })

    it("insertExpression rejects inserting a variable expression (which would gain children)", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            premise.insertExpression(
                makeVarExpr("wrap-var", VAR_Q.id),
                "expr-p"
            )
        ).toThrowError(/variable.*cannot have children/i)
    })

    it("insertExpression rejects a variable expression wrapping two nodes", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeOpExpr("op-and", "and"))
        premise.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-and",
                position: 0,
            })
        )
        premise.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-and",
                position: 1,
            })
        )
        expect(() =>
            premise.insertExpression(
                makeVarExpr("wrap-var", VAR_R.id),
                "expr-p",
                "expr-q"
            )
        ).toThrowError(/variable.*cannot have children/i)
    })
})
