import { describe, expect, it } from "vitest"
import { ArgumentEngine, PremiseEngine } from "../src/lib/index"
import { Value } from "typebox/value"
import {
    CoreArgumentSchema,
    CorePropositionalVariableSchema,
    CorePropositionalExpressionSchema,
    CorePremiseSchema,
    type TCoreArgument,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
    type TCorePremise,
} from "../src/lib/schemata"
import { ChangeCollector } from "../src/lib/core/ChangeCollector"
import { VariableManager } from "../src/lib/core/VariableManager"
import { ExpressionManager } from "../src/lib/core/ExpressionManager"
import type {
    TExpressionInput,
    TExpressionWithoutPosition,
} from "../src/lib/core/ExpressionManager"
import {
    DEFAULT_CHECKSUM_CONFIG,
    createChecksumConfig,
} from "../src/lib/consts"
import type { TOptionalChecksum } from "../src/lib/schemata/shared"
import type { TCoreExpressionAssignment } from "../src/lib/types/evaluation"
import type { TCoreChangeset } from "../src/lib/types/mutation"
import {
    POSITION_MIN,
    POSITION_MAX,
    POSITION_INITIAL,
    DEFAULT_POSITION_CONFIG,
    midpoint,
    type TCorePositionConfig,
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

type TVariableInput = Omit<TCorePropositionalVariable, "checksum">

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
    opts: {
        parentId?: string | null
        position?: number
        premiseId?: string
    } = {}
): TExpressionInput {
    return {
        id,
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        premiseId: opts.premiseId ?? "premise-1",
        type: "variable",
        variableId,
        parentId: opts.parentId ?? null,
        position: opts.position ?? POSITION_INITIAL,
    }
}

function makeOpExpr(
    id: string,
    operator: "not" | "and" | "or" | "implies" | "iff",
    opts: {
        parentId?: string | null
        position?: number
        premiseId?: string
    } = {}
): TExpressionInput {
    return {
        id,
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        premiseId: opts.premiseId ?? "premise-1",
        type: "operator",
        operator,
        parentId: opts.parentId ?? null,
        position: opts.position ?? POSITION_INITIAL,
    }
}

function makeFormulaExpr(
    id: string,
    opts: {
        parentId?: string | null
        position?: number
        premiseId?: string
    } = {}
): TExpressionInput {
    return {
        id,
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        premiseId: opts.premiseId ?? "premise-1",
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
function premiseWithVars(): PremiseEngine {
    const eng = new ArgumentEngine(ARG)
    eng.addVariable(VAR_P)
    eng.addVariable(VAR_Q)
    eng.addVariable(VAR_R)
    const { result: pm } = eng.createPremise()
    return pm
}

/** Create a PremiseEngine directly with a deterministic ID (for toData tests). */
function makePremise(extras?: Record<string, unknown>): PremiseEngine {
    const vm = new VariableManager()
    return new PremiseEngine(
        {
            id: "premise-1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            ...extras,
        } as unknown as TCorePremise,
        { argument: ARG, variables: vm }
    )
}

// ---------------------------------------------------------------------------
// addExpression
// ---------------------------------------------------------------------------

describe("addExpression", () => {
    it("adds a root variable expression (parentId: null)", () => {
        const premise = premiseWithVars()
        const expr = makeVarExpr("expr-1", VAR_P.id)
        premise.addExpression(expr)
        expect(premise.removeExpression("expr-1", true).result).toMatchObject({
            id: "expr-1",
        })
    })

    it("adds a root operator expression", () => {
        const premise = premiseWithVars()
        const op = makeOpExpr("op-1", "and")
        premise.addExpression(op)
        expect(premise.removeExpression("op-1", true).result).toMatchObject({
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
        expect(premise.removeExpression("op-1", true).result).toMatchObject({
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
        expect(
            premise.removeExpression("nonexistent", true).result
        ).toBeUndefined()
    })

    it("removes and returns a root expression", () => {
        const premise = premiseWithVars()
        const expr = makeVarExpr("expr-1", VAR_P.id)
        premise.addExpression(expr)

        const { result: removed } = premise.removeExpression("expr-1", true)
        expect(removed).toMatchObject({ id: "expr-1", type: "variable" })
        // Confirm it is gone
        expect(premise.removeExpression("expr-1", true).result).toBeUndefined()
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

        premise.removeExpression("op-1", true)

        // Children should be gone
        expect(premise.removeExpression("expr-1", true).result).toBeUndefined()
        expect(premise.removeExpression("expr-2", true).result).toBeUndefined()
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

        premise.removeExpression("op-root", true)

        expect(
            premise.removeExpression("op-inner", true).result
        ).toBeUndefined()
        expect(
            premise.removeExpression("expr-leaf", true).result
        ).toBeUndefined()
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
        premise.removeExpression("expr-1", true)

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

        const { result: removed } = premise.removeExpression("op-1", true)
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

        premise.removeExpression("expr-p", true)

        // op-not had 0 children remaining and must have been auto-deleted
        expect(premise.removeExpression("op-not", true).result).toBeUndefined()
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

        premise.removeExpression("expr-p", true)

        // op-and had 1 child left → it is removed, expr-q is promoted to root
        expect(premise.removeExpression("op-and", true).result).toBeUndefined()
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
        premise.removeExpression("expr-p", true)

        expect(
            premise.removeExpression("op-inner", true).result
        ).toBeUndefined()
        expect(
            premise.removeExpression("op-outer", true).result
        ).toBeUndefined()
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
        premise.removeExpression("expr-p", true)

        expect(premise.removeExpression("op-and", true).result).toBeUndefined()
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

        premise.removeExpression("expr-p", true)

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

        premise.removeExpression("expr-p", true)

        // op-implies is removed; expr-q (the consequent) is promoted to root
        expect(
            premise.removeExpression("op-implies", true).result
        ).toBeUndefined()
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
        pm.removeExpression("expr-1", true)

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
            .toPremiseData()
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
        const premiseManagers: PremiseEngine[] = []
        const termIdsByPremise = new Map<PremiseEngine, string[]>()
        const referencedVarIds = new Set<string>()

        function pickVar() {
            const v = variables[pick(numVars)]
            referencedVarIds.add(v.id)
            return v
        }

        function emit(
            pm: PremiseEngine,
            expr: TExpressionInput
        ): TExpressionInput {
            pm.addExpression(expr)
            allExpressions.push(expr)
            return expr
        }

        function emitLeaf(
            pm: PremiseEngine,
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
            pm: PremiseEngine,
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
        const rootId = pm.toPremiseData().rootExpressionId!
        const termIds = termIdsByPremise.get(pm)!

        expect(pm.removeExpression(rootId, true).result).toMatchObject({
            id: rootId,
        })
        for (const termId of termIds) {
            expect(pm.removeExpression(termId, true).result).toBeUndefined()
        }
    })

    it("removing one premise does not affect a different premise", () => {
        const { premiseManagers, termIdsByPremise } = buildStress()
        const [pm1, pm2] = premiseManagers
        const root2 = pm2.toPremiseData().rootExpressionId!

        pm1.removeExpression(pm1.toPremiseData().rootExpressionId!, true)

        // Second premise root is still present
        expect(pm2.removeExpression(root2, true).result).toMatchObject({
            id: root2,
        })
        for (const termId of termIdsByPremise.get(pm2)!) {
            expect(pm2.removeExpression(termId, true).result).toBeUndefined()
        }
    })

    it("removing a variable cascade-deletes referencing expressions across premises", () => {
        const { eng, variables, premiseManagers } = buildStress()
        // Pick a variable that is referenced somewhere
        const referencedVar = variables[0]
        const hadExpressions = premiseManagers.some((pm) =>
            pm.toPremiseData().variables.includes(referencedVar.id)
        )
        expect(hadExpressions).toBe(true)

        // Cascade removal should succeed
        const { result } = eng.removeVariable(referencedVar.id)
        expect(result).toBeDefined()
        expect(result!.id).toBe(referencedVar.id)

        // No premise should reference the variable anymore
        for (const pm of premiseManagers) {
            expect(pm.toPremiseData().variables).not.toContain(referencedVar.id)
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
            pm.removeExpression(pm.toPremiseData().rootExpressionId!, true)
        }

        for (const pm of premiseManagers) {
            expect(pm.toPremiseData().rootExpressionId).toBeUndefined()
        }
    })

    it("re-adding a premise after full teardown succeeds", () => {
        const { eng, premiseManagers } = buildStress()

        for (const pm of premiseManagers) {
            pm.removeExpression(pm.toPremiseData().rootExpressionId!, true)
        }

        const { result: newPm } = eng.createPremise({ title: "rebuilt" })
        // Variables are already registered at engine level
        newPm.addExpression(makeOpExpr("new-root", "and"))
        expect(newPm.toPremiseData().rootExpressionId).toBe("new-root")
    })

    it("all expressions appear in exactly one premise", () => {
        const { premiseManagers, allExpressions } = buildStress()
        const counts = new Map<string, number>()
        for (const pm of premiseManagers) {
            for (const expr of pm.toPremiseData().expressions) {
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
            for (const v of pm.toPremiseData().variables) {
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
        expect(premise.removeExpression("f-1", true).result).toMatchObject({
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

        premise.removeExpression("expr-p", true)

        // Formula had 0 children remaining and must have been auto-deleted.
        expect(premise.removeExpression("f-1", true).result).toBeUndefined()
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
        premise.removeExpression("expr-p", true)

        expect(premise.removeExpression("f-inner", true).result).toBeUndefined()
        expect(premise.removeExpression("f-outer", true).result).toBeUndefined()
        expect(premise.removeExpression("op-and", true).result).toBeUndefined()
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
    it("createPremise returns a PremiseEngine with a generated ID", () => {
        const eng = new ArgumentEngine(ARG)
        const { result: pm } = eng.createPremise({ title: "test" })
        expect(pm.toPremiseData().id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        )
        expect((pm.toPremiseData() as Record<string, unknown>).title).toBe(
            "test"
        )
    })

    it("getPremise(id) returns the same instance", () => {
        const eng = new ArgumentEngine(ARG)
        const { result: pm } = eng.createPremise()
        expect(eng.getPremise(pm.toPremiseData().id)).toBe(pm)
    })

    it("getPremise returns undefined for unknown IDs", () => {
        const eng = new ArgumentEngine(ARG)
        expect(eng.getPremise("unknown")).toBeUndefined()
    })

    it("removePremise causes getPremise to return undefined", () => {
        const eng = new ArgumentEngine(ARG)
        const { result: pm } = eng.createPremise()
        const { id } = pm.toPremiseData()
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
        expect(pm1.toPremiseData().expressions).toHaveLength(1)
        expect(pm2.toPremiseData().expressions).toHaveLength(1)
        expect(pm1.getExpression("expr-q")).toBeUndefined()
        expect(pm2.getExpression("expr-p")).toBeUndefined()
    })
})

// ---------------------------------------------------------------------------
// PremiseEngine
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

describe("PremiseEngine — single-root enforcement", () => {
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
        pm.removeExpression("expr-p", true)
        expect(() =>
            pm.addExpression(makeVarExpr("expr-q", VAR_Q.id))
        ).not.toThrow()
    })
})

describe("PremiseEngine — addExpression / removeExpression / insertExpression", () => {
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
        pm.removeExpression("op-and", true)
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
        pm.removeExpression("op-not", true)
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
        pm.removeExpression("expr-p", true)
        expect(pm.toPremiseData().rootExpressionId).toBe("expr-q")
        expect(pm.toDisplayString()).toBe("Q")
    })
})

describe("PremiseEngine — toDisplayString", () => {
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

describe("PremiseEngine — toData", () => {
    it("returns correct id and extras", () => {
        const pm = new PremiseEngine(
            {
                id: "my-id",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                title: "My Premise",
            } as unknown as TCorePremise,
            { argument: ARG, variables: new VariableManager() }
        )
        const data = pm.toPremiseData()
        expect(data.id).toBe("my-id")
        expect((data as Record<string, unknown>).title).toBe("My Premise")
    })

    it("rootExpressionId is absent before any expression is added", () => {
        expect(makePremise().toPremiseData().rootExpressionId).toBeUndefined()
    })

    it("rootExpressionId is set after adding the root expression", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(pm.toPremiseData().rootExpressionId).toBe("expr-p")
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
        const { variables } = pm.toPremiseData()
        expect([...variables].sort()).toEqual([VAR_P.id, VAR_Q.id].sort())
    })

    it("variables does not include registered-but-unreferenced variables", () => {
        const pm = premiseWithVars() // P, Q, R all registered
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id)) // only P referenced
        const { variables } = pm.toPremiseData()
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
            .toPremiseData()
            .expressions.map((e) => e.id)
            .sort()
        expect(ids).toEqual(["expr-p", "expr-q", "op-and"].sort())
    })
})

// ---------------------------------------------------------------------------
// Evaluation support plan
// ---------------------------------------------------------------------------

describe("PremiseEngine — validation and evaluation", () => {
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
    function buildPremiseP(pm: PremiseEngine) {
        pm.addExpression(makeVarExpr(`${pm.getId()}-p`, VAR_P.id))
    }

    function buildPremiseQ(pm: PremiseEngine) {
        pm.addExpression(makeVarExpr(`${pm.getId()}-q`, VAR_Q.id))
    }

    function buildPremiseImplies(pm: PremiseEngine) {
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
        pm: PremiseEngine,
        exprId: string,
        variableId: string
    ) {
        pm.addExpression(makeVarExpr(exprId, variableId))
    }

    function buildNotRoot(
        pm: PremiseEngine,
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
        pm: PremiseEngine,
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
                argumentId: "arg-1",
                argumentVersion: 1,
                rootExpressionId: "r1",
                variables: [] as string[],
                expressions: [] as TCorePropositionalExpression[],
                checksum: "x",
            }
            const after = {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 1,
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
                argumentId: "arg-1",
                argumentVersion: 1,
                rootExpressionId: "r1",
                variables: [] as string[],
                expressions: [] as TCorePropositionalExpression[],
                checksum: "x",
            }
            const after = {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 1,
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
                before: "premise-1",
                after: "premise-1",
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

            // Both engines auto-set premise-1 as conclusion; engineB changes to premise-conc
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
            expect(diff.roles.conclusion.before).toBe("premise-1")
            expect(diff.roles.conclusion.after).toBe("premise-conc")
        })

        it("detects conclusion change between engines", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const { engine: engineB } = buildSimpleEngine(ARG)

            // Both engines auto-set premise-1 as conclusion; add a second premise to engineB and set it as conclusion
            const { result: pm2 } = engineB.createPremiseWithId("premise-2", {
                title: "Second premise",
            })
            pm2.addExpression(
                makeOpExpr("expr-impl-2", "implies", {
                    parentId: null,
                    position: POSITION_INITIAL,
                })
            )
            pm2.addExpression(
                makeVarExpr("expr-p-2", "var-p", {
                    parentId: "expr-impl-2",
                    position: 0,
                })
            )
            pm2.addExpression(
                makeVarExpr("expr-q-2", "var-q", {
                    parentId: "expr-impl-2",
                    position: 1,
                })
            )
            engineB.setConclusionPremise("premise-2")

            const diff = diffArguments(engineA, engineB)
            expect(diff.roles.conclusion.before).toBe("premise-1")
            expect(diff.roles.conclusion.after).toBe("premise-2")
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
// PremiseEngine — three-valued evaluation
// ---------------------------------------------------------------------------

describe("PremiseEngine — three-valued evaluation", () => {
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
            argumentId: "a-1",
            argumentVersion: 0,
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

    it("preserves unknown fields on the argument through snapshot()", () => {
        const engine = new ArgumentEngine(
            ARG_WITH_EXTRAS as Omit<TCoreArgument, "checksum">
        )
        const snap = engine.snapshot()
        expect((snap.argument as Record<string, unknown>).title).toBe(
            "My Argument"
        )
        expect((snap.argument as Record<string, unknown>).customField).toBe(42)
    })

    it("preserves extras on premises through toData()", () => {
        const engine = new ArgumentEngine({ id: "arg-1", version: 1 })
        const { result: pm } = engine.createPremise({
            title: "My Premise",
            priority: "high",
        })
        const data = pm.toPremiseData()
        expect((data as Record<string, unknown>).title).toBe("My Premise")
        expect((data as Record<string, unknown>).priority).toBe("high")
    })

    it("preserves extras on premises through engine.snapshot()", () => {
        const engine = new ArgumentEngine({ id: "arg-1", version: 1 })
        engine.createPremise({ title: "Premise One" })
        const snap = engine.snapshot()
        expect(
            (snap.premises[0].premise as Record<string, unknown>).title
        ).toBe("Premise One")
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
        const data = pm.toPremiseData()
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
    ): PremiseEngine {
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
    ): PremiseEngine {
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
    ): PremiseEngine {
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
    it("POSITION_INITIAL is 0", () => {
        expect(POSITION_INITIAL).toBe(0)
    })

    it("POSITION_MIN is -(2^31-1)", () => {
        expect(POSITION_MIN).toBe(-2147483647)
    })

    it("POSITION_MAX is 2^31-1", () => {
        expect(POSITION_MAX).toBe(2147483647)
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

describe("PremiseEngine — appendExpression and addExpressionRelative", () => {
    it("appendExpression assigns POSITION_INITIAL to first child", () => {
        const pm = premiseWithVars()
        pm.appendExpression(null, {
            id: "root",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
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
            premiseId: "premise-1",
            type: "variable",
            variableId: "var-p",
            parentId: "root",
        })
        pm.appendExpression("root", {
            id: "c2",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
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
            premiseId: "premise-1",
            type: "variable",
            variableId: "var-p",
            parentId: "root",
        })
        pm.addExpressionRelative("c1", "before", {
            id: "c0",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
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
            premiseId: "premise-1",
            type: "variable",
            variableId: "var-p",
            parentId: "root",
        })
        pm.appendExpression("root", {
            id: "c3",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "variable",
            variableId: "var-r",
            parentId: "root",
        })
        pm.addExpressionRelative("c1", "after", {
            id: "c2",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
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
            premiseId: "premise-1",
            type: "variable",
            variableId: "var-p",
            parentId: "root",
        })
        pm.addExpressionRelative("c1", "after", {
            id: "c2",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
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
                premiseId: "premise-1",
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
            premiseId: "premise-1",
            parentId: null,
            position: 0,
            checksum: "x",
        } as TCorePropositionalExpression
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
            checksum: "x",
        } as TCorePropositionalExpression
        const removed = {
            id: "e2",
            type: "operator",
            checksum: "x",
        } as TCorePropositionalExpression
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
            checksum: "x",
        } as TCorePropositionalVariable
        collector.addedVariable(v)
        const cs = collector.toChangeset()
        expect(cs.variables?.added).toEqual([v])
        expect(cs.expressions).toBeUndefined()
    })

    it("collects premise changes", () => {
        const collector = new ChangeCollector()
        const p = {
            id: "p1",
            argumentId: "a1",
            argumentVersion: 0,
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
        const expr = { id: "e1", checksum: "x" } as TCorePropositionalExpression
        collector.addedExpression(expr)
        const cs = collector.toChangeset()
        expect(cs.variables).toBeUndefined()
        expect(cs.premises).toBeUndefined()
        expect(cs.roles).toBeUndefined()
        expect(cs.argument).toBeUndefined()
    })
})

// ---------------------------------------------------------------------------
// PremiseEngine — mutation changesets
// ---------------------------------------------------------------------------

describe("PremiseEngine — mutation changesets", () => {
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
            premiseId: "premise-1",
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
            premiseId: "premise-1",
            parentId: null,
            position: 1,
        })
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "op",
            position: 1,
        })
        pm.addExpression({
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "op",
            position: 2,
        })
        // Remove e1 -> operator collapses (1 child), e2 gets promoted
        const { result, changes } = pm.removeExpression("e1", true)
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
            premiseId: "premise-1",
            parentId: null,
            position: 1,
        })
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "and1",
            position: 1,
        })
        pm.addExpression({
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
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
                premiseId: "premise-1",
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
            premiseId: "premise-1",
            parentId: null,
            position: 1,
        })
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "and1",
            position: 1,
        })
        const { result, changes } = pm.appendExpression("and1", {
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
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
            premiseId: "premise-1",
            parentId: null,
            position: 1,
        })
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "and1",
            position: 1,
        })
        pm.addExpression({
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "and1",
            position: 3,
        })
        const { result, changes } = pm.addExpressionRelative("e1", "after", {
            id: "e3",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
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
        const { result, changes } = pm.removeExpression("nonexistent", true)
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
    it("createPremise returns PremiseEngine and records added premise", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        const { result: pm, changes } = eng.createPremise()
        expect(pm).toBeInstanceOf(PremiseEngine)
        expect(changes.premises?.added).toHaveLength(1)
        expect(changes.premises?.added[0].id).toBe(pm.getId())
    })

    it("createPremiseWithId returns PremiseEngine with specified ID", () => {
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

    describe("PremiseEngine — checksum", () => {
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
                premiseId: "premise-1",
                parentId: null,
                position: 1,
            })
            const after = pm.checksum()
            expect(before).not.toBe(after)
        })

        it("premise checksum does not change when a variable is added (variables are argument-scoped)", () => {
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
            expect(before).toBe(after)
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
            // First premise is auto-set as conclusion
            eng.createPremise()
            const { result: pm2 } = eng.createPremise()
            const before = eng.checksum()
            // Switch conclusion to second premise — checksum should change
            eng.setConclusionPremise(pm2.getId())
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
            premiseId: "premise-1",
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
            premiseId: "premise-1",
            parentId: null,
            position: 1,
        })
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "op",
            position: 1,
        })
        pm.addExpression({
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
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
        const data = pm.toPremiseData()
        expect(data.checksum).toBeDefined()
        expect(typeof data.checksum).toBe("string")
        expect(data.checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("toData expressions include entity checksums", () => {
        const { pm } = setupPremise()
        const data = pm.toPremiseData()
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
            premiseId: "premise-1",
            parentId: null,
            position: 1,
        })
        expect(changes.expressions?.added).toHaveLength(1)
        expect(changes.expressions?.added[0].checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("changeset expressions from removeExpression include checksums", () => {
        const { pm } = setupPremise()
        const { changes } = pm.removeExpression("e1", true)
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
            premiseId: "premise-1",
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

    it("ArgumentEngine getArgument includes argument-level checksum", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        eng.createPremise()
        const arg = eng.getArgument()
        expect(arg.checksum).toBeDefined()
        expect(arg.checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("ArgumentEngine premise checksums via listPremises", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        eng.createPremise()
        const premises = eng.listPremises()
        expect(premises).toHaveLength(1)
        expect(premises[0].checksum()).toMatch(/^[0-9a-f]{8}$/)
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
            premiseId: "premise-1",
            parentId: null,
            position: 1,
        })
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "op",
            position: 1,
        })
        pm.addExpression({
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "op",
            position: 2,
        })
        // Remove e1 -> operator collapses, e2 gets modified (reparented)
        const { changes } = pm.removeExpression("e1", true)
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
// PremiseEngine — deleteExpressionsUsingVariable
// ---------------------------------------------------------------------------

describe("PremiseEngine — deleteExpressionsUsingVariable", () => {
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

// ---------------------------------------------------------------------------
// ArgumentEngine — auto-conclusion on first premise
// ---------------------------------------------------------------------------

describe("ArgumentEngine — auto-conclusion on first premise", () => {
    it("first createPremise auto-sets conclusion", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        const { result: pm, changes } = eng.createPremise()
        expect(eng.getRoleState().conclusionPremiseId).toBe(pm.getId())
        expect(changes.roles?.conclusionPremiseId).toBe(pm.getId())
    })

    it("first createPremiseWithId auto-sets conclusion", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        const { changes } = eng.createPremiseWithId("my-premise")
        expect(eng.getRoleState().conclusionPremiseId).toBe("my-premise")
        expect(changes.roles?.conclusionPremiseId).toBe("my-premise")
    })

    it("second createPremise does not change conclusion", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        const { result: first } = eng.createPremise()
        const { changes } = eng.createPremise()
        expect(eng.getRoleState().conclusionPremiseId).toBe(first.getId())
        expect(changes.roles).toBeUndefined()
    })

    it("createPremise after clearConclusionPremise auto-sets again", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        eng.createPremise()
        eng.clearConclusionPremise()
        const { result: pm2, changes } = eng.createPremise()
        expect(eng.getRoleState().conclusionPremiseId).toBe(pm2.getId())
        expect(changes.roles?.conclusionPremiseId).toBe(pm2.getId())
    })

    it("createPremise after removing conclusion premise auto-sets again", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        const { result: first } = eng.createPremise()
        eng.removePremise(first.getId())
        const { result: second, changes } = eng.createPremise()
        expect(eng.getRoleState().conclusionPremiseId).toBe(second.getId())
        expect(changes.roles?.conclusionPremiseId).toBe(second.getId())
    })

    it("setConclusionPremise overrides auto-assignment", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 })
        eng.createPremise()
        const { result: second } = eng.createPremise()
        eng.setConclusionPremise(second.getId())
        expect(eng.getRoleState().conclusionPremiseId).toBe(second.getId())
    })
})

// ---------------------------------------------------------------------------
// PremiseEngine — updateExpression
// ---------------------------------------------------------------------------

describe("PremiseEngine — updateExpression", () => {
    function setup() {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        eng.addVariable(VAR_R)
        const { result: pm } = eng.createPremise()
        return { eng, pm }
    }

    it("updates position of an expression", () => {
        const { pm } = setup()
        pm.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: "op-and", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-q", VAR_Q.id, { parentId: "op-and", position: 3 })
        )

        const { result, changes } = pm.updateExpression("e-p", { position: 2 })

        expect(result.id).toBe("e-p")
        expect(result.position).toBe(2)
        expect(changes.expressions?.modified).toHaveLength(1)
        expect(changes.expressions?.modified[0].id).toBe("e-p")
        expect(changes.expressions?.modified[0].position).toBe(2)
    })

    it("rejects position collision with sibling", () => {
        const { pm } = setup()
        pm.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: "op-and", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-q", VAR_Q.id, { parentId: "op-and", position: 3 })
        )

        expect(() => pm.updateExpression("e-p", { position: 3 })).toThrowError(
            /Position/
        )
    })

    it("updates variableId on a variable expression", () => {
        const { pm } = setup()
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: null, position: 1 })
        )

        const { result, changes } = pm.updateExpression("e-p", {
            variableId: VAR_Q.id,
        })

        expect(result.id).toBe("e-p")
        expect(
            (result as TCorePropositionalExpression<"variable">).variableId
        ).toBe(VAR_Q.id)
        expect(changes.expressions?.modified).toHaveLength(1)
    })

    it("rejects variableId update on non-variable expression", () => {
        const { pm } = setup()
        pm.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 1 })
        )

        expect(() =>
            pm.updateExpression("op-and", { variableId: VAR_P.id })
        ).toThrowError(/not a variable expression/)
    })

    it("rejects variableId referencing non-existent variable", () => {
        const { pm } = setup()
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: null, position: 1 })
        )

        expect(() =>
            pm.updateExpression("e-p", { variableId: "var-nonexistent" })
        ).toThrowError(/non-existent variable/)
    })

    it("updates expressionsByVariableId index on variableId change (verify via cascade delete)", () => {
        const { pm } = setup()
        // Build: and(P, Q)
        pm.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: "op-and", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-q", VAR_Q.id, { parentId: "op-and", position: 2 })
        )

        // Change e-p from P to R
        pm.updateExpression("e-p", { variableId: VAR_R.id })

        // Cascade-delete P: should remove nothing since e-p is now R
        const { result: removedP } = pm.deleteExpressionsUsingVariable(VAR_P.id)
        expect(removedP).toHaveLength(0)

        // Cascade-delete R: should remove e-p (now referencing R)
        const { result: removedR } = pm.deleteExpressionsUsingVariable(VAR_R.id)
        expect(removedR.length).toBeGreaterThanOrEqual(1)
        expect(pm.getExpression("e-p")).toBeUndefined()
    })

    it("updates operator and to or", () => {
        const { pm } = setup()
        pm.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: "op-and", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-q", VAR_Q.id, { parentId: "op-and", position: 2 })
        )

        const { result } = pm.updateExpression("op-and", { operator: "or" })

        expect(
            (result as TCorePropositionalExpression<"operator">).operator
        ).toBe("or")
    })

    it("updates operator or to and", () => {
        const { pm } = setup()
        pm.addExpression(
            makeOpExpr("op-or", "or", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: "op-or", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-q", VAR_Q.id, { parentId: "op-or", position: 2 })
        )

        const { result } = pm.updateExpression("op-or", { operator: "and" })

        expect(
            (result as TCorePropositionalExpression<"operator">).operator
        ).toBe("and")
    })

    it("updates operator implies to iff", () => {
        const { pm } = setup()
        pm.addExpression(
            makeOpExpr("op-impl", "implies", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: "op-impl", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-q", VAR_Q.id, { parentId: "op-impl", position: 2 })
        )

        const { result } = pm.updateExpression("op-impl", { operator: "iff" })

        expect(
            (result as TCorePropositionalExpression<"operator">).operator
        ).toBe("iff")
    })

    it("updates operator iff to implies", () => {
        const { pm } = setup()
        pm.addExpression(
            makeOpExpr("op-iff", "iff", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: "op-iff", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-q", VAR_Q.id, { parentId: "op-iff", position: 2 })
        )

        const { result } = pm.updateExpression("op-iff", {
            operator: "implies",
        })

        expect(
            (result as TCorePropositionalExpression<"operator">).operator
        ).toBe("implies")
    })

    it("rejects operator change across groups: and to implies", () => {
        const { pm } = setup()
        pm.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: "op-and", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-q", VAR_Q.id, { parentId: "op-and", position: 2 })
        )

        expect(() =>
            pm.updateExpression("op-and", { operator: "implies" })
        ).toThrowError(/not a permitted operator change/)
    })

    it("rejects operator change from not", () => {
        const { pm } = setup()
        pm.addExpression(
            makeOpExpr("op-not", "not", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: "op-not", position: 1 })
        )

        expect(() =>
            pm.updateExpression("op-not", { operator: "and" })
        ).toThrowError(/not a permitted operator change/)
    })

    it("rejects operator change to not", () => {
        const { pm } = setup()
        pm.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: "op-and", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-q", VAR_Q.id, { parentId: "op-and", position: 2 })
        )

        expect(() =>
            pm.updateExpression("op-and", { operator: "not" })
        ).toThrowError(/not a permitted operator change/)
    })

    it("rejects operator update on non-operator expression", () => {
        const { pm } = setup()
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: null, position: 1 })
        )

        expect(() =>
            pm.updateExpression("e-p", { operator: "and" })
        ).toThrowError(/not an operator expression/)
    })

    it("rejects forbidden field: id", () => {
        const { pm } = setup()
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: null, position: 1 })
        )

        expect(() =>
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
            pm.updateExpression("e-p", { id: "new-id" } as any)
        ).toThrowError(/forbidden/)
    })

    it("rejects forbidden field: parentId", () => {
        const { pm } = setup()
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: null, position: 1 })
        )

        expect(() =>
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
            pm.updateExpression("e-p", { parentId: "op-and" } as any)
        ).toThrowError(/forbidden/)
    })

    it("rejects forbidden field: type", () => {
        const { pm } = setup()
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: null, position: 1 })
        )

        expect(() =>
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
            pm.updateExpression("e-p", { type: "operator" } as any)
        ).toThrowError(/forbidden/)
    })

    it("rejects forbidden field: argumentId", () => {
        const { pm } = setup()
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: null, position: 1 })
        )

        expect(() =>
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
            pm.updateExpression("e-p", { argumentId: "arg-2" } as any)
        ).toThrowError(/forbidden/)
    })

    it("rejects forbidden field: argumentVersion", () => {
        const { pm } = setup()
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: null, position: 1 })
        )

        expect(() =>
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
            pm.updateExpression("e-p", { argumentVersion: 99 } as any)
        ).toThrowError(/forbidden/)
    })

    it("rejects forbidden field: checksum", () => {
        const { pm } = setup()
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: null, position: 1 })
        )

        expect(() =>
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
            pm.updateExpression("e-p", { checksum: "abcd1234" } as any)
        ).toThrowError(/forbidden/)
    })

    it("throws for non-existent expression", () => {
        const { pm } = setup()

        expect(() =>
            pm.updateExpression("nonexistent", { position: 5 })
        ).toThrowError(/not found/)
    })

    it("no-ops when updates object is empty", () => {
        const { pm } = setup()
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: null, position: 1 })
        )

        const { result, changes } = pm.updateExpression("e-p", {})

        expect(result.id).toBe("e-p")
        // No expression changes when nothing is updated
        expect(changes.expressions?.modified ?? []).toHaveLength(0)
        expect(changes.expressions?.added ?? []).toHaveLength(0)
        expect(changes.expressions?.removed ?? []).toHaveLength(0)
    })

    it("marks premise checksum dirty after update", () => {
        const { pm } = setup()
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: null, position: 1 })
        )

        const before = pm.checksum()
        pm.updateExpression("e-p", { variableId: VAR_Q.id })
        const after = pm.checksum()

        expect(before).not.toBe(after)
    })

    it("result includes checksum", () => {
        const { pm } = setup()
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: null, position: 1 })
        )

        const { result, changes } = pm.updateExpression("e-p", {
            variableId: VAR_Q.id,
        })

        expect(result.checksum).toMatch(/^[0-9a-f]{8}$/)
        expect(changes.expressions?.modified[0].checksum).toMatch(
            /^[0-9a-f]{8}$/
        )
    })
})

// ---------------------------------------------------------------------------
// removeExpression — deleteSubtree parameter
// ---------------------------------------------------------------------------

describe("removeExpression — deleteSubtree parameter", () => {
    function setup() {
        const eng = new ArgumentEngine({ id: ARG.id, version: ARG.version })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise()
        return { eng, pm }
    }

    it("deleteSubtree: true — same as original behavior (collapse promotes sibling)", () => {
        const { pm } = setup()
        // Tree: and(P, Q)
        pm.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-and", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-and", position: 2 })
        )

        // Remove P with deleteSubtree: true — collapse promotes Q to root
        pm.removeExpression("expr-p", true)

        const data = pm.toPremiseData()
        expect(data.rootExpressionId).toBe("expr-q")
        expect(data.expressions).toHaveLength(1)
        expect(data.expressions[0].id).toBe("expr-q")
        expect(data.expressions[0].parentId).toBeNull()
    })

    it("deleteSubtree: false — promotes single child (operator)", () => {
        const { pm } = setup()
        // Tree: and(or(P, Q))
        pm.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeOpExpr("op-or", "or", { parentId: "op-and", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-or", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-or", position: 2 })
        )

        // Remove and with deleteSubtree: false — or promoted to root
        pm.removeExpression("op-and", false)

        const data = pm.toPremiseData()
        expect(data.rootExpressionId).toBe("op-or")
        expect(data.expressions).toHaveLength(3)
        const orExpr = data.expressions.find((e) => e.id === "op-or")!
        expect(orExpr.parentId).toBeNull()
        // Children of or are intact
        const pExpr = data.expressions.find((e) => e.id === "expr-p")!
        const qExpr = data.expressions.find((e) => e.id === "expr-q")!
        expect(pExpr.parentId).toBe("op-or")
        expect(qExpr.parentId).toBe("op-or")
    })

    it("deleteSubtree: false — promotes single child (leaf)", () => {
        const { pm } = setup()
        // Tree: not(P)
        pm.addExpression(
            makeOpExpr("op-not", "not", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-not", position: 1 })
        )

        // Remove not with deleteSubtree: false — P promoted to root
        pm.removeExpression("op-not", false)

        const data = pm.toPremiseData()
        expect(data.rootExpressionId).toBe("expr-p")
        expect(data.expressions).toHaveLength(1)
        expect(data.expressions[0].id).toBe("expr-p")
        expect(data.expressions[0].parentId).toBeNull()
    })

    it("deleteSubtree: false — errors on multiple children", () => {
        const { pm } = setup()
        // Tree: and(P, Q)
        pm.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-and", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-and", position: 2 })
        )

        // Removing and with deleteSubtree: false throws — has 2 children
        expect(() => pm.removeExpression("op-and", false)).toThrow(
            /multiple children/
        )

        // Tree is unchanged
        const data = pm.toPremiseData()
        expect(data.expressions).toHaveLength(3)
        expect(data.rootExpressionId).toBe("op-and")
    })

    it("deleteSubtree: false — leaf node with collapse on parent", () => {
        const { pm } = setup()
        // Tree: and(P, Q)
        pm.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-and", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-and", position: 2 })
        )

        // Remove leaf P with deleteSubtree: false — collapse promotes Q to root
        pm.removeExpression("expr-p", false)

        const data = pm.toPremiseData()
        expect(data.rootExpressionId).toBe("expr-q")
        expect(data.expressions).toHaveLength(1)
        expect(data.expressions[0].id).toBe("expr-q")
        expect(data.expressions[0].parentId).toBeNull()
    })

    it("deleteSubtree: false — promotes child into non-root slot", () => {
        const { pm } = setup()
        // Tree: and(not(or(P, Q)))
        pm.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeOpExpr("op-not", "not", { parentId: "op-and", position: 1 })
        )
        pm.addExpression(
            makeOpExpr("op-or", "or", { parentId: "op-not", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-or", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-or", position: 2 })
        )

        // Remove not with deleteSubtree: false — or promoted into not's slot under and
        pm.removeExpression("op-not", false)

        const data = pm.toPremiseData()
        expect(data.rootExpressionId).toBe("op-and")
        expect(data.expressions).toHaveLength(4) // and, or, P, Q
        const orExpr = data.expressions.find((e) => e.id === "op-or")!
        expect(orExpr.parentId).toBe("op-and")
        const pExpr = data.expressions.find((e) => e.id === "expr-p")!
        expect(pExpr.parentId).toBe("op-or")
        const qExpr = data.expressions.find((e) => e.id === "expr-q")!
        expect(qExpr.parentId).toBe("op-or")
    })

    it("deleteSubtree: false — changeset records removed and modified", () => {
        const { pm } = setup()
        // Tree: not(P)
        pm.addExpression(
            makeOpExpr("op-not", "not", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-not", position: 1 })
        )

        // Remove not with deleteSubtree: false
        const { result, changes } = pm.removeExpression("op-not", false)

        expect(result?.id).toBe("op-not")
        // Changeset: 1 removed (not) + 1 modified (P promoted)
        expect(changes.expressions!.removed).toHaveLength(1)
        expect(changes.expressions!.removed[0].id).toBe("op-not")
        expect(changes.expressions!.modified).toHaveLength(1)
        expect(changes.expressions!.modified[0].id).toBe("expr-p")
        expect(changes.expressions!.modified[0].parentId).toBeNull()
    })

    it("deleteSubtree: false — no collapse runs after promotion", () => {
        const { pm } = setup()
        // Tree: and(not(P))
        pm.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeOpExpr("op-not", "not", { parentId: "op-and", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-not", position: 1 })
        )

        // Remove and with deleteSubtree: false — not promoted to root, tree intact as not(P)
        pm.removeExpression("op-and", false)

        const data = pm.toPremiseData()
        expect(data.rootExpressionId).toBe("op-not")
        expect(data.expressions).toHaveLength(2)
        const notExpr = data.expressions.find((e) => e.id === "op-not")!
        expect(notExpr.parentId).toBeNull()
        const pExpr = data.expressions.find((e) => e.id === "expr-p")!
        expect(pExpr.parentId).toBe("op-not")
    })

    it("deleteSubtree: false — expressionsByVariableId cleaned for removed expr only", () => {
        const { pm } = setup()
        // Tree: formula(P)
        pm.addExpression(
            makeFormulaExpr("f-1", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "f-1", position: 1 })
        )

        // Remove formula with deleteSubtree: false — P promoted
        pm.removeExpression("f-1", false)

        const data = pm.toPremiseData()
        expect(data.rootExpressionId).toBe("expr-p")
        expect(data.expressions).toHaveLength(1)

        // Verify variable cascade still works on P
        // (P should still be tracked in expressionsByVariableId)
        pm.deleteExpressionsUsingVariable(VAR_P.id)
        const dataAfter = pm.toPremiseData()
        expect(dataAfter.expressions).toHaveLength(0)
        expect(dataAfter.rootExpressionId).toBeUndefined()
    })
})

describe("VariableManager — generic type parameter", () => {
    it("accepts and returns an extended variable type", () => {
        type ExtendedVar = TCorePropositionalVariable & { color: string }
        const vm = new VariableManager<ExtendedVar>()
        const v: ExtendedVar = {
            id: "v1",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "P",
            checksum: "abc",
            color: "red",
        }
        vm.addVariable(v)
        const retrieved = vm.getVariable("v1")!
        expect(retrieved.color).toBe("red")
        expect(retrieved.symbol).toBe("P")

        const all = vm.toArray()
        expect(all[0].color).toBe("red")

        const updated = vm.updateVariable("v1", { symbol: "Q" })!
        expect(updated.color).toBe("red")
        expect(updated.symbol).toBe("Q")

        const removed = vm.removeVariable("v1")!
        expect(removed.color).toBe("red")
    })
})

// ---------------------------------------------------------------------------
// mutation types — generic changesets
// ---------------------------------------------------------------------------

describe("mutation types — generic changesets", () => {
    it("TCoreChangeset accepts extended entity types", () => {
        type ExtVar = TCorePropositionalVariable & { color: string }

        const changeset: TCoreChangeset<TCorePropositionalExpression, ExtVar> =
            {
                variables: {
                    added: [
                        {
                            id: "v1",
                            argumentId: "a1",
                            argumentVersion: 0,
                            symbol: "P",
                            checksum: "abc",
                            color: "red",
                        },
                    ],
                    modified: [],
                    removed: [],
                },
            }
        expect(changeset.variables!.added[0].color).toBe("red")
    })
})

// ---------------------------------------------------------------------------
// ExpressionManager — generic type parameter
// ---------------------------------------------------------------------------

describe("ExpressionManager — generic type parameter", () => {
    it("stores and returns extended expression types", () => {
        type ExtExpr = TCorePropositionalExpression & { tag: string }
        const em = new ExpressionManager<ExtExpr>()

        const expr: TExpressionInput<ExtExpr> = {
            id: "e1",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: null,
            position: 1000,
            type: "variable" as const,
            variableId: "v1",
            tag: "custom",
        }
        em.addExpression(expr)

        const retrieved = em.getExpression("e1")!
        expect((retrieved as unknown as { tag: string }).tag).toBe("custom")

        const all = em.toArray()
        expect((all[0] as unknown as { tag: string }).tag).toBe("custom")
    })
})

describe("PremiseEngine — generic type parameters", () => {
    it("preserves extended premise type in toData()", () => {
        type ExtPremise = TCorePremise & { color: string }
        const arg: TCoreArgument = { id: "a1", version: 0, checksum: "x" }
        const vm = new VariableManager()
        const pm = new PremiseEngine<TCoreArgument, ExtPremise>(
            {
                id: "p1",
                argumentId: arg.id,
                argumentVersion: arg.version,
                color: "blue",
            } as ExtPremise,
            { argument: arg, variables: vm }
        )
        const data = pm.toPremiseData()
        expect(data.color).toBe("blue")
    })
})

describe("ArgumentEngine — generic type parameters", () => {
    it("preserves extended argument type", () => {
        type ExtArg = TCoreArgument & { projectId: string }
        const arg: Omit<ExtArg, "checksum"> = {
            id: "a1",
            version: 0,
            projectId: "proj-1",
        }
        const engine = new ArgumentEngine<ExtArg>(arg)
        const retrieved = engine.getArgument()
        expect(retrieved.projectId).toBe("proj-1")
        expect(typeof retrieved.checksum).toBe("string")
    })

    it("preserves extended variable type through addVariable", () => {
        type ExtVar = TCorePropositionalVariable & { color: string }
        const engine = new ArgumentEngine<
            TCoreArgument,
            TCorePremise,
            TCorePropositionalExpression,
            ExtVar
        >({ id: "a1", version: 0 })
        const { result } = engine.addVariable({
            id: "v1",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "P",
            color: "red",
        })
        expect(result.color).toBe("red")
        expect(typeof result.checksum).toBe("string")
    })
})

describe("diffArguments — generic type parameters", () => {
    it("accepts and returns extended types", () => {
        type ExtArg = TCoreArgument & { projectId: string }
        const argA: Omit<ExtArg, "checksum"> = {
            id: "a1",
            version: 0,
            projectId: "proj-1",
        }
        const argB: Omit<ExtArg, "checksum"> = {
            id: "a1",
            version: 1,
            projectId: "proj-1",
        }
        const engineA = new ArgumentEngine<ExtArg>(argA)
        const engineB = new ArgumentEngine<ExtArg>(argB)

        const diff = diffArguments(engineA, engineB)
        expect(diff.argument.before.projectId).toBe("proj-1")
        expect(diff.argument.after.projectId).toBe("proj-1")
    })
})

describe("configurable position range", () => {
    it("DEFAULT_POSITION_CONFIG has signed int32 range", () => {
        expect(DEFAULT_POSITION_CONFIG).toEqual({
            min: -2147483647,
            max: 2147483647,
            initial: 0,
        })
    })

    it("POSITION_MIN is -(2^31-1)", () => {
        expect(POSITION_MIN).toBe(-2147483647)
    })

    it("POSITION_MAX is 2^31-1", () => {
        expect(POSITION_MAX).toBe(2147483647)
    })

    it("POSITION_INITIAL is 0", () => {
        expect(POSITION_INITIAL).toBe(0)
    })

    it("schema allows negative positions", () => {
        const expr = {
            id: "e1",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "premise-1",
            parentId: null,
            position: -100,
            checksum: "x",
            type: "variable" as const,
            variableId: "v1",
        }
        expect(Value.Check(CorePropositionalExpressionSchema, expr)).toBe(true)
    })

    it("ExpressionManager uses custom positionConfig in appendExpression", () => {
        const config: TCorePositionConfig = { min: 100, max: 300, initial: 200 }
        const em = new ExpressionManager({ positionConfig: config })

        em.appendExpression(null, {
            id: "root",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "premise-1",
            type: "operator",
            operator: "and",
            parentId: null,
        })
        const root = em.getExpression("root")!
        expect(root.position).toBe(200) // initial

        em.appendExpression("root", {
            id: "c1",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "premise-1",
            type: "variable",
            variableId: "v1",
            parentId: "root",
        })
        const c1 = em.getExpression("c1")!
        expect(c1.position).toBe(200) // first child gets initial

        em.appendExpression("root", {
            id: "c2",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "premise-1",
            type: "variable",
            variableId: "v2",
            parentId: "root",
        })
        const c2 = em.getExpression("c2")!
        expect(c2.position).toBe(midpoint(200, 300)) // midpoint(c1.pos, max)
    })

    it("ExpressionManager uses custom positionConfig in addExpressionRelative before", () => {
        const config: TCorePositionConfig = { min: 100, max: 300, initial: 200 }
        const em = new ExpressionManager({ positionConfig: config })

        em.addExpression({
            id: "root",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "premise-1",
            type: "operator",
            operator: "and",
            parentId: null,
            position: 200,
        })
        em.appendExpression("root", {
            id: "c1",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "premise-1",
            type: "variable",
            variableId: "v1",
            parentId: "root",
        })

        em.addExpressionRelative("c1", "before", {
            id: "c0",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "premise-1",
            type: "variable",
            variableId: "v2",
            parentId: "root",
        })
        const c0 = em.getExpression("c0")!
        expect(c0.position).toBe(midpoint(100, 200)) // midpoint(min, c1.pos)
    })

    it("PremiseEngine forwards positionConfig to ExpressionManager", () => {
        const config: TCorePositionConfig = { min: 100, max: 300, initial: 200 }
        const vm = new VariableManager()
        vm.addVariable({
            id: "v1",
            argumentId: "arg-1",
            argumentVersion: 1,
            symbol: "P",
            checksum: "x",
        })
        const pm = new PremiseEngine(
            {
                id: "p1",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
            } as unknown as TCorePremise,
            { argument: ARG, variables: vm },
            { positionConfig: config }
        )

        pm.appendExpression(null, {
            id: "root",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "premise-1",
            type: "operator",
            operator: "and",
            parentId: null,
        })
        const root = pm.getExpression("root")!
        expect(root.position).toBe(200)
    })

    it("ArgumentEngine passes positionConfig to premises", () => {
        const config: TCorePositionConfig = { min: 100, max: 300, initial: 200 }
        const eng = new ArgumentEngine(ARG, { positionConfig: config })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise()

        pm.appendExpression(null, {
            id: "root",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "operator",
            operator: "and",
            parentId: null,
        })
        const root = pm.getExpression("root")!
        expect(root.position).toBe(200)

        pm.appendExpression("root", {
            id: "c1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "variable",
            variableId: "var-p",
            parentId: "root",
        })
        pm.appendExpression("root", {
            id: "c2",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "variable",
            variableId: "var-q",
            parentId: "root",
        })
        const children = pm.getChildExpressions("root")
        expect(children[0].position).toBe(200)
        expect(children[1].position).toBe(midpoint(200, 300))
    })

    it("ArgumentEngine defaults work without positionConfig", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise()

        pm.appendExpression(null, {
            id: "root",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "variable",
            variableId: "var-p",
            parentId: null,
        })
        const root = pm.getExpression("root")!
        expect(root.position).toBe(POSITION_INITIAL)
    })
})

describe("ExpressionManager — snapshot and fromSnapshot", () => {
    it("round-trips an empty manager", () => {
        const em = new ExpressionManager()
        const snap = em.snapshot()
        expect(snap.expressions).toEqual([])
        expect(snap.config).toBeUndefined()

        const restored = ExpressionManager.fromSnapshot(snap)
        expect(restored.toArray()).toEqual([])
    })

    it("round-trips a manager with expressions", () => {
        const em = new ExpressionManager()
        em.addExpression({
            id: "root",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "premise-1",
            type: "operator",
            operator: "and",
            parentId: null,
            position: 0,
        })
        em.addExpression({
            id: "c1",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "premise-1",
            type: "variable",
            variableId: "v1",
            parentId: "root",
            position: 0,
        })
        em.addExpression({
            id: "c2",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "premise-1",
            type: "variable",
            variableId: "v2",
            parentId: "root",
            position: 1,
        })

        const snap = em.snapshot()
        expect(snap.expressions).toHaveLength(3)

        const restored = ExpressionManager.fromSnapshot(snap)
        const originalArr = em.toArray()
        const restoredArr = restored.toArray()
        expect(restoredArr).toHaveLength(originalArr.length)
        for (let i = 0; i < originalArr.length; i++) {
            expect(restoredArr[i].id).toBe(originalArr[i].id)
            expect(restoredArr[i].parentId).toBe(originalArr[i].parentId)
            expect(restoredArr[i].position).toBe(originalArr[i].position)
        }

        // Verify tree structure
        const children = restored.getChildExpressions("root")
        expect(children).toHaveLength(2)
        expect(children[0].id).toBe("c1")
        expect(children[1].id).toBe("c2")
    })

    it("preserves config in snapshot", () => {
        const config = {
            positionConfig: { min: 10, max: 90, initial: 50 },
        }
        const em = new ExpressionManager(config)
        const snap = em.snapshot()
        expect(snap.config).toEqual(config)

        const restored = ExpressionManager.fromSnapshot(snap)
        // Verify config is applied by checking position behavior
        restored.appendExpression(null, {
            id: "root",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "premise-1",
            type: "variable",
            variableId: "v1",
            parentId: null,
        })
        const root = restored.getExpression("root")!
        expect(root.position).toBe(50) // custom initial
    })

    it("restored manager is functionally independent", () => {
        const em = new ExpressionManager()
        em.addExpression({
            id: "root",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "premise-1",
            type: "variable",
            variableId: "v1",
            parentId: null,
            position: 0,
        })

        const snap = em.snapshot()
        const restored = ExpressionManager.fromSnapshot(snap)

        // Mutate restored — should not affect original
        restored.removeExpression("root", true)
        expect(restored.toArray()).toHaveLength(0)
        expect(em.toArray()).toHaveLength(1)
    })
})

describe("VariableManager — snapshot and fromSnapshot", () => {
    it("round-trips an empty manager", () => {
        const vm = new VariableManager()
        const snap = vm.snapshot()
        expect(snap.variables).toEqual([])
        expect(snap.config).toBeUndefined()

        const restored = VariableManager.fromSnapshot(snap)
        expect(restored.toArray()).toEqual([])
    })

    it("round-trips with variables", () => {
        const vm = new VariableManager()
        vm.addVariable({
            id: "v1",
            argumentId: "arg-1",
            argumentVersion: 1,
            symbol: "P",
            checksum: "x",
        })
        vm.addVariable({
            id: "v2",
            argumentId: "arg-1",
            argumentVersion: 1,
            symbol: "Q",
            checksum: "y",
        })

        const snap = vm.snapshot()
        expect(snap.variables).toHaveLength(2)

        const restored = VariableManager.fromSnapshot(snap)
        const restoredArr = restored.toArray()
        expect(restoredArr).toHaveLength(2)
        expect(restoredArr[0].symbol).toBe("P")
        expect(restoredArr[1].symbol).toBe("Q")
        expect(restored.hasVariable("v1")).toBe(true)
        expect(restored.hasVariable("v2")).toBe(true)
    })

    it("preserves config in snapshot", () => {
        const config = {
            positionConfig: { min: 10, max: 90, initial: 50 },
        }
        const vm = new VariableManager(config)
        const snap = vm.snapshot()
        expect(snap.config).toEqual(config)
    })

    it("restored manager is independent", () => {
        const vm = new VariableManager()
        vm.addVariable({
            id: "v1",
            argumentId: "arg-1",
            argumentVersion: 1,
            symbol: "P",
            checksum: "x",
        })

        const snap = vm.snapshot()
        const restored = VariableManager.fromSnapshot(snap)

        // Mutate restored — should not affect original
        restored.removeVariable("v1")
        expect(restored.hasVariable("v1")).toBe(false)
        expect(vm.hasVariable("v1")).toBe(true)
    })
})

describe("PremiseEngine — snapshot and fromSnapshot", () => {
    const ARG = { id: "arg-1", version: 1 }

    it("round-trips an empty premise", () => {
        const vm = new VariableManager()
        const pe = new PremiseEngine(
            {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 1,
            } as TCorePremise,
            { argument: ARG as TCoreArgument, variables: vm }
        )
        const snap = pe.snapshot()
        const restored = PremiseEngine.fromSnapshot(
            snap,
            ARG as TCoreArgument,
            vm
        )
        expect(restored.getId()).toBe("p1")
        expect(restored.getExpressions()).toEqual([])
    })

    it("round-trips a premise with expressions", () => {
        const eng = new ArgumentEngine(ARG as TCoreArgument)
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
        })
        const { result: pe } = eng.createPremise()
        pe.appendExpression(null, {
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: pe.getId(),
            parentId: null,
        })
        const snap = pe.snapshot()
        // Create a fresh VariableManager with same variables for restore
        const vm2 = new VariableManager()
        vm2.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
            checksum: "x",
        })
        const restored = PremiseEngine.fromSnapshot(
            snap,
            ARG as TCoreArgument,
            vm2
        )
        expect(restored.getExpressions().length).toBe(1)
        expect(restored.toDisplayString()).toBe(pe.toDisplayString())
    })

    it("snapshot excludes variables and argument", () => {
        const vm = new VariableManager()
        const pe = new PremiseEngine(
            {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 1,
            } as TCorePremise,
            { argument: ARG as TCoreArgument, variables: vm }
        )
        const snap = pe.snapshot()
        expect(snap).not.toHaveProperty("variables")
        expect(snap).not.toHaveProperty("argument")
        expect(snap).toHaveProperty("premise")
        expect(snap).toHaveProperty("expressions")
        expect(snap).toHaveProperty("config")
    })

    it("restored premise is independent from original", () => {
        const eng = new ArgumentEngine(ARG as TCoreArgument)
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
        })
        const { result: pe } = eng.createPremise()
        pe.addExpression({
            id: "op1",
            type: "operator",
            operator: "and",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: pe.getId(),
            parentId: null,
            position: 0,
        })
        pe.appendExpression("op1", {
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: pe.getId(),
            parentId: "op1",
        })
        const snap = pe.snapshot()
        const vm2 = new VariableManager()
        vm2.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
            checksum: "x",
        })
        const restored = PremiseEngine.fromSnapshot(
            snap,
            ARG as TCoreArgument,
            vm2
        )

        // Mutate restored — add a second child to the operator
        restored.appendExpression("op1", {
            id: "e2",
            type: "variable",
            variableId: "v1",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: restored.getId(),
            parentId: "op1",
        })
        expect(restored.getExpressions().length).toBe(3)
        expect(pe.getExpressions().length).toBe(2)
    })

    it("restores rootExpressionId correctly", () => {
        const eng = new ArgumentEngine(ARG as TCoreArgument)
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
        })
        const { result: pe } = eng.createPremise()
        pe.appendExpression(null, {
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: pe.getId(),
            parentId: null,
        })
        const snap = pe.snapshot()
        const vm2 = new VariableManager()
        vm2.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
            checksum: "x",
        })
        const restored = PremiseEngine.fromSnapshot(
            snap,
            ARG as TCoreArgument,
            vm2
        )
        // The root expression ID should be preserved
        const data = restored.toPremiseData()
        expect(data.rootExpressionId).toBe("e1")
    })

    it("rebuilds expressionsByVariableId index on restore", () => {
        const eng = new ArgumentEngine(ARG as TCoreArgument)
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
        })
        eng.addVariable({
            id: "v2",
            symbol: "Q",
            argumentId: "arg-1",
            argumentVersion: 1,
        })
        const { result: pe } = eng.createPremise()
        pe.addExpression({
            id: "op1",
            type: "operator",
            operator: "and",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: pe.getId(),
            parentId: null,
            position: 0,
        })
        pe.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: pe.getId(),
            parentId: "op1",
            position: 0,
        })
        pe.addExpression({
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: pe.getId(),
            parentId: "op1",
            position: 1,
        })

        const snap = pe.snapshot()
        const vm2 = new VariableManager()
        vm2.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
            checksum: "x",
        })
        vm2.addVariable({
            id: "v2",
            symbol: "Q",
            argumentId: "arg-1",
            argumentVersion: 1,
            checksum: "x",
        })
        const restored = PremiseEngine.fromSnapshot(
            snap,
            ARG as TCoreArgument,
            vm2
        )

        // deleteExpressionsUsingVariable relies on the index; if the index
        // was not rebuilt this would be a no-op.
        const { result: removed } =
            restored.deleteExpressionsUsingVariable("v1")
        expect(removed.length).toBeGreaterThan(0)
    })
})

describe("ArgumentEngine — snapshot, fromSnapshot, and rollback", () => {
    const ARG = { id: "arg-1", version: 1 }

    function makeVariable(
        id: string,
        symbol: string
    ): Omit<TCorePropositionalVariable, "checksum"> {
        return { id, symbol, argumentId: "arg-1", argumentVersion: 1 }
    }

    it("round-trips an empty engine", () => {
        const engine = new ArgumentEngine(ARG)
        const snap = engine.snapshot()
        const restored = ArgumentEngine.fromSnapshot(snap)
        expect(restored.getArgument().id).toBe("arg-1")
        expect(restored.listPremiseIds()).toEqual([])
        expect(restored.getVariables()).toEqual([])
        expect(restored.getRoleState()).toEqual({})
    })

    it("round-trips engine with premises and variables", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(makeVariable("v1", "P"))
        engine.addVariable(makeVariable("v2", "Q"))
        const { result: pm } = engine.createPremiseWithId("p1")
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            parentId: null,
            position: 0,
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "p1",
        })

        const snap = engine.snapshot()
        const restored = ArgumentEngine.fromSnapshot(snap)

        expect(restored.listPremiseIds()).toEqual(["p1"])
        expect(restored.getVariables()).toHaveLength(2)
        const restoredPm = restored.getPremise("p1")!
        expect(restoredPm.getExpressions()).toHaveLength(1)
        expect(restoredPm.getExpressions()[0].id).toBe("e1")
    })

    it("preserves conclusion role through round-trip", () => {
        const engine = new ArgumentEngine(ARG)
        engine.createPremiseWithId("p1")
        engine.createPremiseWithId("p2")
        engine.setConclusionPremise("p2")

        const snap = engine.snapshot()
        const restored = ArgumentEngine.fromSnapshot(snap)

        expect(restored.getRoleState().conclusionPremiseId).toBe("p2")
    })

    it("snapshot includes config", () => {
        const config = {
            checksumConfig: DEFAULT_CHECKSUM_CONFIG,
            positionConfig: DEFAULT_POSITION_CONFIG,
        }
        const engine = new ArgumentEngine(ARG, config)
        const snap = engine.snapshot()
        expect(snap.config).toBeDefined()
        expect(snap.config!.positionConfig).toEqual(DEFAULT_POSITION_CONFIG)
    })

    it("fromSnapshot produces independent copy", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(makeVariable("v1", "P"))
        engine.createPremiseWithId("p1")

        const snap = engine.snapshot()
        const restored = ArgumentEngine.fromSnapshot(snap)

        // Mutate restored, original should be unaffected
        restored.createPremiseWithId("p2")
        expect(engine.listPremiseIds()).toEqual(["p1"])
        expect(restored.listPremiseIds()).toEqual(["p1", "p2"])
    })

    it("rollback restores previous state", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(makeVariable("v1", "P"))
        engine.createPremiseWithId("p1")

        const snap = engine.snapshot()

        // Mutate the engine
        engine.addVariable(makeVariable("v2", "Q"))
        engine.createPremiseWithId("p2")

        expect(engine.listPremiseIds()).toEqual(["p1", "p2"])
        expect(engine.getVariables()).toHaveLength(2)

        // Rollback
        engine.rollback(snap)

        expect(engine.listPremiseIds()).toEqual(["p1"])
        expect(engine.getVariables()).toHaveLength(1)
        expect(engine.getVariables()[0].symbol).toBe("P")
    })

    it("rollback after multiple mutations restores correct state", () => {
        const engine = new ArgumentEngine(ARG)
        engine.addVariable(makeVariable("v1", "P"))
        const { result: pm } = engine.createPremiseWithId("p1")
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            parentId: null,
            position: 0,
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "p1",
        })
        engine.setConclusionPremise("p1")

        const snap = engine.snapshot()

        // Multiple mutations
        engine.createPremiseWithId("p2")
        engine.addVariable(makeVariable("v2", "Q"))
        engine.setConclusionPremise("p2")
        engine.removeVariable("v1")

        // Rollback to original
        engine.rollback(snap)

        expect(engine.listPremiseIds()).toEqual(["p1"])
        expect(engine.getVariables()).toHaveLength(1)
        expect(engine.getVariables()[0].id).toBe("v1")
        expect(engine.getRoleState().conclusionPremiseId).toBe("p1")
        const restoredPm = engine.getPremise("p1")!
        expect(restoredPm.getExpressions()).toHaveLength(1)
        expect(restoredPm.getExpressions()[0].id).toBe("e1")
    })
})

describe("ArgumentEngine — fromData bulk loading", () => {
    it("loads an engine from flat arrays", () => {
        const arg = { id: "arg-1", version: 1 }
        const variables = [
            {
                id: "v1",
                symbol: "P",
                argumentId: "arg-1",
                argumentVersion: 1,
            },
            {
                id: "v2",
                symbol: "Q",
                argumentId: "arg-1",
                argumentVersion: 1,
            },
        ]
        const premises: TOptionalChecksum<TCorePremise>[] = [
            {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 1,
                variables: [],
                expressions: [],
            },
            {
                id: "p2",
                argumentId: "arg-1",
                argumentVersion: 1,
                variables: [],
                expressions: [],
            },
        ]
        const expressions = [
            {
                id: "e1",
                type: "variable" as const,
                variableId: "v1",
                argumentId: "arg-1",
                argumentVersion: 1,
                premiseId: "p1",
                parentId: null,
                position: 0,
            },
            {
                id: "e2",
                type: "variable" as const,
                variableId: "v2",
                argumentId: "arg-1",
                argumentVersion: 1,
                premiseId: "p2",
                parentId: null,
                position: 0,
            },
        ]
        const roles = { conclusionPremiseId: "p2" }
        const engine = ArgumentEngine.fromData(
            arg,
            variables,
            premises,
            expressions,
            roles
        )
        expect(engine.getVariables().length).toBe(2)
        expect(engine.listPremiseIds()).toEqual(["p1", "p2"])
        expect(engine.getRoleState().conclusionPremiseId).toBe("p2")
        expect(engine.getPremise("p1")?.getExpressions().length).toBe(1)
    })

    it("handles premises with no expressions", () => {
        const arg = { id: "arg-1", version: 1 }
        const engine = ArgumentEngine.fromData(
            arg,
            [],
            [
                {
                    id: "p1",
                    argumentId: "arg-1",
                    argumentVersion: 1,
                    variables: [],
                    expressions: [],
                },
            ] as TOptionalChecksum<TCorePremise>[],
            [],
            {}
        )
        expect(engine.listPremiseIds()).toEqual(["p1"])
    })

    it("groups expressions by premiseId correctly", () => {
        const arg = { id: "arg-1", version: 1 }
        const variables = [
            {
                id: "v1",
                symbol: "P",
                argumentId: "arg-1",
                argumentVersion: 1,
            },
        ]
        const premises: TOptionalChecksum<TCorePremise>[] = [
            {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 1,
                variables: [],
                expressions: [],
            },
            {
                id: "p2",
                argumentId: "arg-1",
                argumentVersion: 1,
                variables: [],
                expressions: [],
            },
        ]
        const expressions = [
            {
                id: "e1",
                type: "variable" as const,
                variableId: "v1",
                argumentId: "arg-1",
                argumentVersion: 1,
                premiseId: "p1",
                parentId: null,
                position: 0,
            },
            {
                id: "e2",
                type: "variable" as const,
                variableId: "v1",
                argumentId: "arg-1",
                argumentVersion: 1,
                premiseId: "p2",
                parentId: null,
                position: 0,
            },
        ]
        const engine = ArgumentEngine.fromData(
            arg,
            variables,
            premises,
            expressions,
            {}
        )
        expect(engine.getPremise("p1")?.getExpressions().length).toBe(1)
        expect(engine.getPremise("p2")?.getExpressions().length).toBe(1)
    })

    it("loads nested expressions in BFS order", () => {
        const arg = { id: "arg-1", version: 1 }
        const variables = [
            {
                id: "v1",
                symbol: "P",
                argumentId: "arg-1",
                argumentVersion: 1,
            },
            {
                id: "v2",
                symbol: "Q",
                argumentId: "arg-1",
                argumentVersion: 1,
            },
        ]
        const premises: TOptionalChecksum<TCorePremise>[] = [
            {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 1,
                variables: [],
                expressions: [],
            },
        ]
        // Expressions out of order — child before parent
        const expressions = [
            {
                id: "e2",
                type: "variable" as const,
                variableId: "v1",
                argumentId: "arg-1",
                argumentVersion: 1,
                premiseId: "p1",
                parentId: "e1",
                position: 0,
            },
            {
                id: "e3",
                type: "variable" as const,
                variableId: "v2",
                argumentId: "arg-1",
                argumentVersion: 1,
                premiseId: "p1",
                parentId: "e1",
                position: 1,
            },
            {
                id: "e1",
                type: "operator" as const,
                operator: "and" as const,
                argumentId: "arg-1",
                argumentVersion: 1,
                premiseId: "p1",
                parentId: null,
                position: 0,
            },
        ]
        const engine = ArgumentEngine.fromData(
            arg,
            variables,
            premises,
            expressions,
            {}
        )
        expect(engine.getPremise("p1")?.getExpressions().length).toBe(3)
    })

    it("infers generic types from parameters", () => {
        type MyArg = TCoreArgument & { customField: string }
        const arg: MyArg = {
            id: "arg-1",
            version: 1,
            checksum: "x",
            customField: "hello",
        }
        const engine = ArgumentEngine.fromData<MyArg>(arg, [], [], [], {})
        const result = engine.getArgument()
        expect(result.customField).toBe("hello")
    })
})

describe("ArgumentEngine — toDisplayString", () => {
    const ARG = { id: "arg-1", version: 1 }

    it("renders an empty argument", () => {
        const eng = new ArgumentEngine(ARG)
        const display = eng.toDisplayString()
        expect(display).toContain("Argument: arg-1 (v1)")
    })

    it("labels conclusion premise", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
        })
        const { result: p1 } = eng.createPremise()
        p1.appendExpression(null, {
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: p1.getId(),
            parentId: null,
        })
        const display = eng.toDisplayString()
        expect(display).toContain("[Conclusion]")
        expect(display).toContain("P")
    })

    it("labels constraint and supporting premises correctly", () => {
        const eng = new ArgumentEngine(ARG)
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
        })
        eng.addVariable({
            id: "v2",
            symbol: "Q",
            argumentId: "arg-1",
            argumentVersion: 1,
        })

        // p1: implies (inference) - will be conclusion (auto-assigned as first)
        const { result: p1 } = eng.createPremise()
        p1.appendExpression(null, {
            id: "op1",
            type: "operator",
            operator: "implies",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: p1.getId(),
            parentId: null,
        })
        p1.appendExpression("op1", {
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: p1.getId(),
            parentId: "op1",
        })
        p1.appendExpression("op1", {
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: p1.getId(),
            parentId: "op1",
        })

        // p2: implies (inference) - will be supporting
        const { result: p2 } = eng.createPremise()
        p2.appendExpression(null, {
            id: "op2",
            type: "operator",
            operator: "implies",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: p2.getId(),
            parentId: null,
        })
        p2.appendExpression("op2", {
            id: "e3",
            type: "variable",
            variableId: "v1",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: p2.getId(),
            parentId: "op2",
        })
        p2.appendExpression("op2", {
            id: "e4",
            type: "variable",
            variableId: "v2",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: p2.getId(),
            parentId: "op2",
        })

        // p3: plain variable (constraint)
        const { result: p3 } = eng.createPremise()
        p3.appendExpression(null, {
            id: "e5",
            type: "variable",
            variableId: "v1",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: p3.getId(),
            parentId: null,
        })

        const display = eng.toDisplayString()
        expect(display).toContain("[Conclusion]")
        expect(display).toContain("[Supporting]")
        expect(display).toContain("[Constraint]")
    })
})

describe("VariableManager — getVariableBySymbol", () => {
    const makeVar = (id: string, symbol: string) => ({
        id,
        symbol,
        argumentId: "arg-1",
        argumentVersion: 0,
        checksum: "x",
    })

    it("returns undefined for unknown symbol", () => {
        const vm = new VariableManager()
        expect(vm.getVariableBySymbol("P")).toBeUndefined()
    })

    it("returns the variable matching the symbol", () => {
        const vm = new VariableManager()
        const v = makeVar("v1", "P")
        vm.addVariable(v)
        expect(vm.getVariableBySymbol("P")).toEqual(v)
    })

    it("returns undefined after the variable is removed", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVar("v1", "P"))
        vm.removeVariable("v1")
        expect(vm.getVariableBySymbol("P")).toBeUndefined()
    })

    it("tracks symbol changes after rename", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVar("v1", "P"))
        vm.renameVariable("v1", "Q")
        expect(vm.getVariableBySymbol("P")).toBeUndefined()
        expect(vm.getVariableBySymbol("Q")?.id).toBe("v1")
    })

    it("tracks symbol changes after updateVariable", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVar("v1", "P"))
        vm.updateVariable("v1", { symbol: "R" })
        expect(vm.getVariableBySymbol("P")).toBeUndefined()
        expect(vm.getVariableBySymbol("R")?.id).toBe("v1")
    })

    it("survives snapshot round-trip", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVar("v1", "P"))
        vm.addVariable(makeVar("v2", "Q"))
        const restored = VariableManager.fromSnapshot(vm.snapshot())
        expect(restored.getVariableBySymbol("P")?.id).toBe("v1")
        expect(restored.getVariableBySymbol("Q")?.id).toBe("v2")
    })
})

describe("PremiseEngine — shared expression index", () => {
    const arg = { id: "arg-1", version: 0 }
    const makeVariable = (id: string, symbol: string) => ({
        id,
        symbol,
        argumentId: "arg-1",
        argumentVersion: 0,
        checksum: "x",
    })
    const makeVarExpr = (
        id: string,
        parentId: string | null,
        premiseId: string,
        overrides: Record<string, unknown> = {}
    ) => ({
        id,
        type: "variable" as const,
        variableId: "v1",
        parentId,
        position: 0,
        argumentId: "arg-1",
        argumentVersion: 0,
        premiseId,
        ...overrides,
    })

    it("populates the shared index on addExpression", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVariable("v1", "P"))
        const index = new Map<string, string>()
        const pe = new PremiseEngine(
            {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 0,
            } as TCorePremise,
            {
                argument: arg as TCoreArgument,
                variables: vm,
                expressionIndex: index,
            }
        )
        pe.addExpression(makeVarExpr("e1", null, "p1"))
        expect(index.get("e1")).toBe("p1")
    })

    it("removes entries from the shared index on removeExpression", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVariable("v1", "P"))
        const index = new Map<string, string>()
        const pe = new PremiseEngine(
            {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 0,
            } as TCorePremise,
            {
                argument: arg as TCoreArgument,
                variables: vm,
                expressionIndex: index,
            }
        )
        pe.addExpression(makeVarExpr("e1", null, "p1"))
        pe.removeExpression("e1", true)
        expect(index.has("e1")).toBe(false)
    })

    it("removes subtree entries from the shared index", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVariable("v1", "P"))
        const index = new Map<string, string>()
        const pe = new PremiseEngine(
            {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 0,
            } as TCorePremise,
            {
                argument: arg as TCoreArgument,
                variables: vm,
                expressionIndex: index,
            }
        )
        pe.addExpression({
            id: "op1",
            type: "operator",
            operator: "and",
            parentId: null,
            position: 0,
            argumentId: "arg-1",
            argumentVersion: 0,
            premiseId: "p1",
        } as TExpressionInput)
        pe.addExpression(makeVarExpr("e1", "op1", "p1", { position: 0 }))
        pe.addExpression(
            makeVarExpr("e2", "op1", "p1", { position: 1, id: "e2" })
        )
        pe.removeExpression("op1", true)
        expect(index.has("op1")).toBe(false)
        expect(index.has("e1")).toBe(false)
        expect(index.has("e2")).toBe(false)
    })

    it("populates the shared index on appendExpression", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVariable("v1", "P"))
        const index = new Map<string, string>()
        const pe = new PremiseEngine(
            {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 0,
            } as TCorePremise,
            {
                argument: arg as TCoreArgument,
                variables: vm,
                expressionIndex: index,
            }
        )
        pe.appendExpression(null, {
            id: "e1",
            type: "variable" as const,
            variableId: "v1",
            argumentId: "arg-1",
            argumentVersion: 0,
            premiseId: "p1",
        } as TExpressionWithoutPosition)
        expect(index.get("e1")).toBe("p1")
    })

    it("populates the shared index on insertExpression", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVariable("v1", "P"))
        const index = new Map<string, string>()
        const pe = new PremiseEngine(
            {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 0,
            } as TCorePremise,
            {
                argument: arg as TCoreArgument,
                variables: vm,
                expressionIndex: index,
            }
        )
        pe.addExpression(makeVarExpr("e1", null, "p1"))
        pe.insertExpression(
            {
                id: "op1",
                type: "operator",
                operator: "not",
                parentId: null,
                position: 0,
                argumentId: "arg-1",
                argumentVersion: 0,
                premiseId: "p1",
            } as TExpressionInput,
            "e1"
        )
        expect(index.get("op1")).toBe("p1")
        expect(index.get("e1")).toBe("p1")
    })

    it("works correctly when no shared index is provided", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVariable("v1", "P"))
        const pe = new PremiseEngine(
            {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 0,
            } as TCorePremise,
            { argument: arg as TCoreArgument, variables: vm }
        )
        pe.addExpression(makeVarExpr("e1", null, "p1"))
        pe.removeExpression("e1", true)
    })

    it("removes entries on deleteExpressionsUsingVariable", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVariable("v1", "P"))
        vm.addVariable(makeVariable("v2", "Q"))
        const index = new Map<string, string>()
        const pe = new PremiseEngine(
            {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 0,
            } as TCorePremise,
            {
                argument: arg as TCoreArgument,
                variables: vm,
                expressionIndex: index,
            }
        )
        pe.addExpression({
            id: "op1",
            type: "operator",
            operator: "and",
            parentId: null,
            position: 0,
            argumentId: "arg-1",
            argumentVersion: 0,
            premiseId: "p1",
        } as TExpressionInput)
        pe.addExpression(makeVarExpr("e1", "op1", "p1", { position: 0 }))
        pe.addExpression({
            id: "e2",
            type: "variable" as const,
            variableId: "v2",
            parentId: "op1",
            position: 1,
            argumentId: "arg-1",
            argumentVersion: 0,
            premiseId: "p1",
        })
        pe.deleteExpressionsUsingVariable("v1")
        expect(index.has("e1")).toBe(false)
    })

    it("populates the shared index via fromSnapshot", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVariable("v1", "P"))
        const index = new Map<string, string>()
        const pe = new PremiseEngine(
            {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 0,
            } as TCorePremise,
            {
                argument: arg as TCoreArgument,
                variables: vm,
                expressionIndex: index,
            }
        )
        pe.addExpression(makeVarExpr("e1", null, "p1"))
        const snap = pe.snapshot()

        const newIndex = new Map<string, string>()
        PremiseEngine.fromSnapshot(snap, arg as TCoreArgument, vm, newIndex)
        expect(newIndex.get("e1")).toBe("p1")
    })
})

describe("ArgumentEngine — lookup methods", () => {
    function setupEngine() {
        const arg = { id: "arg-1", version: 0 }
        const engine = new ArgumentEngine(arg)
        engine.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 0,
        })
        engine.addVariable({
            id: "v2",
            symbol: "Q",
            argumentId: "arg-1",
            argumentVersion: 0,
        })
        const { result: p1 } = engine.createPremiseWithId("p1")
        const { result: p2 } = engine.createPremiseWithId("p2")

        p1.addExpression({
            id: "e1",
            type: "variable" as const,
            variableId: "v1",
            parentId: null,
            position: 0,
            argumentId: "arg-1",
            argumentVersion: 0,
            premiseId: "p1",
        })

        p2.addExpression({
            id: "op1",
            type: "operator" as const,
            operator: "and",
            parentId: null,
            position: 0,
            argumentId: "arg-1",
            argumentVersion: 0,
            premiseId: "p2",
        } as TExpressionInput)
        p2.addExpression({
            id: "e2",
            type: "variable" as const,
            variableId: "v1",
            parentId: "op1",
            position: 0,
            argumentId: "arg-1",
            argumentVersion: 0,
            premiseId: "p2",
        })
        p2.addExpression({
            id: "e3",
            type: "variable" as const,
            variableId: "v2",
            parentId: "op1",
            position: 1,
            argumentId: "arg-1",
            argumentVersion: 0,
            premiseId: "p2",
        })

        return { engine, p1, p2 }
    }

    describe("getVariable", () => {
        it("returns the variable by ID", () => {
            const { engine } = setupEngine()
            expect(engine.getVariable("v1")?.symbol).toBe("P")
        })

        it("returns undefined for unknown ID", () => {
            const { engine } = setupEngine()
            expect(engine.getVariable("unknown")).toBeUndefined()
        })
    })

    describe("hasVariable", () => {
        it("returns true for existing variable", () => {
            const { engine } = setupEngine()
            expect(engine.hasVariable("v1")).toBe(true)
        })

        it("returns false for unknown variable", () => {
            const { engine } = setupEngine()
            expect(engine.hasVariable("unknown")).toBe(false)
        })
    })

    describe("getVariableBySymbol", () => {
        it("returns the variable by symbol", () => {
            const { engine } = setupEngine()
            expect(engine.getVariableBySymbol("P")?.id).toBe("v1")
        })

        it("returns undefined for unknown symbol", () => {
            const { engine } = setupEngine()
            expect(engine.getVariableBySymbol("Z")).toBeUndefined()
        })

        it("reflects updates after updateVariable", () => {
            const { engine } = setupEngine()
            engine.updateVariable("v1", { symbol: "R" })
            expect(engine.getVariableBySymbol("P")).toBeUndefined()
            expect(engine.getVariableBySymbol("R")?.id).toBe("v1")
        })
    })

    describe("buildVariableIndex", () => {
        it("builds a custom-keyed map from variables", () => {
            const { engine } = setupEngine()
            const bySymbol = engine.buildVariableIndex((v) => v.symbol)
            expect(bySymbol.get("P")?.id).toBe("v1")
            expect(bySymbol.get("Q")?.id).toBe("v2")
            expect(bySymbol.size).toBe(2)
        })
    })

    describe("getExpression", () => {
        it("returns an expression from any premise by ID", () => {
            const { engine } = setupEngine()
            const e1 = engine.getExpression("e1")
            expect(e1?.id).toBe("e1")
            const e3 = engine.getExpression("e3")
            expect(e3?.id).toBe("e3")
        })

        it("returns undefined for unknown ID", () => {
            const { engine } = setupEngine()
            expect(engine.getExpression("unknown")).toBeUndefined()
        })
    })

    describe("hasExpression", () => {
        it("returns true for existing expression", () => {
            const { engine } = setupEngine()
            expect(engine.hasExpression("e1")).toBe(true)
        })

        it("returns false for unknown expression", () => {
            const { engine } = setupEngine()
            expect(engine.hasExpression("unknown")).toBe(false)
        })
    })

    describe("getExpressionPremiseId", () => {
        it("returns the premiseId for an expression", () => {
            const { engine } = setupEngine()
            expect(engine.getExpressionPremiseId("e1")).toBe("p1")
            expect(engine.getExpressionPremiseId("e3")).toBe("p2")
        })

        it("returns undefined for unknown expression", () => {
            const { engine } = setupEngine()
            expect(engine.getExpressionPremiseId("unknown")).toBeUndefined()
        })
    })

    describe("findPremiseByExpressionId", () => {
        it("returns the PremiseEngine containing the expression", () => {
            const { engine } = setupEngine()
            const pe = engine.findPremiseByExpressionId("e3")
            expect(pe?.getId()).toBe("p2")
        })

        it("returns undefined for unknown expression", () => {
            const { engine } = setupEngine()
            expect(engine.findPremiseByExpressionId("unknown")).toBeUndefined()
        })
    })

    describe("getAllExpressions", () => {
        it("returns all expressions across all premises sorted by ID", () => {
            const { engine } = setupEngine()
            const all = engine.getAllExpressions()
            const ids = all.map((e) => e.id).sort()
            expect(ids).toEqual(["e1", "e2", "e3", "op1"])
        })
    })

    describe("getExpressionsByVariableId", () => {
        it("returns expressions referencing the variable across premises", () => {
            const { engine } = setupEngine()
            const exprs = engine.getExpressionsByVariableId("v1")
            const ids = exprs.map((e) => e.id).sort()
            expect(ids).toEqual(["e1", "e2"])
        })

        it("returns empty array for unreferenced variable", () => {
            const { engine } = setupEngine()
            expect(engine.getExpressionsByVariableId("unknown")).toEqual([])
        })
    })

    describe("listRootExpressions", () => {
        it("returns root expressions from all premises", () => {
            const { engine } = setupEngine()
            const roots = engine.listRootExpressions()
            const ids = roots.map((e) => e.id).sort()
            expect(ids).toEqual(["e1", "op1"])
        })
    })

    describe("expression index stays in sync after mutations", () => {
        it("tracks expression removal via PremiseEngine", () => {
            const { engine, p2 } = setupEngine()
            p2.removeExpression("e2", true)
            expect(engine.hasExpression("e2")).toBe(false)
            expect(engine.hasExpression("e3")).toBe(true)
        })

        it("tracks premise removal via ArgumentEngine", () => {
            const { engine } = setupEngine()
            engine.removePremise("p1")
            expect(engine.hasExpression("e1")).toBe(false)
        })

        it("tracks cascade variable removal", () => {
            const { engine } = setupEngine()
            engine.removeVariable("v1")
            expect(engine.hasExpression("e1")).toBe(false)
            expect(engine.hasExpression("e2")).toBe(false)
        })

        it("survives snapshot round-trip", () => {
            const { engine } = setupEngine()
            const snap = engine.snapshot()
            const restored = ArgumentEngine.fromSnapshot(snap)
            expect(restored.getExpression("e1")?.id).toBe("e1")
            expect(restored.getExpressionPremiseId("e3")).toBe("p2")
        })

        it("survives fromData round-trip", () => {
            const { engine } = setupEngine()
            const vars = engine.getVariables()
            const premises = engine.listPremises().map((pe) => pe.toPremiseData())
            const expressions = engine.getAllExpressions()
            const roles = engine.getRoleState()
            const restored = ArgumentEngine.fromData(
                engine.getArgument(),
                vars,
                premises,
                expressions,
                roles
            )
            expect(restored.getExpression("e1")?.id).toBe("e1")
            expect(restored.getExpressionPremiseId("e3")).toBe("p2")
        })

        it("survives rollback", () => {
            const { engine, p1 } = setupEngine()
            const snap = engine.snapshot()
            // e1 is the root (type variable, parentId null) — can't add children to a variable.
            // Instead, remove the root and add an operator with children.
            p1.removeExpression("e1", true)
            p1.addExpression({
                id: "op99",
                type: "operator" as const,
                operator: "and",
                parentId: null,
                position: 0,
                argumentId: "arg-1",
                argumentVersion: 0,
                premiseId: "p1",
            } as TExpressionInput)
            expect(engine.hasExpression("op99")).toBe(true)
            engine.rollback(snap)
            expect(engine.hasExpression("op99")).toBe(false)
            expect(engine.hasExpression("e1")).toBe(true)
        })
    })
})
