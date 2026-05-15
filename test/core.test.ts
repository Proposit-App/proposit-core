import { describe, expect, it } from "vitest"
import {
    ArgumentEngine,
    PremiseEngine,
    ClaimLibrary,
    mergeChangesets,
    orderChangeset,
    createLookup,
    EMPTY_CLAIM_LOOKUP,
    forkArgumentEngine,
    ForkNamespace,
    ForkLibrary,
    ArgumentLibrary,
    PropositCore,
    InvalidArgumentStructureError,
    UnknownExpressionError,
    NotOperatorNotDecidableError,
    collectArgumentReferencedClaims,
    canonicalizeOperatorAssignments,
} from "../src/lib/index"
import type {
    TOrderedOperation,
    TCoreEntityForkRecord,
    TCoreExpressionForkRecord,
    TCoreClaimForkRecord,
} from "../src/lib/index"
import { ClaimCitationLibrary } from "../src/lib/core/claim-citation-library"
import type { TReactiveSnapshot } from "../src/lib/index"
import { Value } from "typebox/value"
import {
    CoreArgumentSchema,
    CoreClaimSchema,
    CorePropositionalVariableSchema,
    CorePropositionalExpressionSchema,
    CorePremiseSchema,
    CoreEntityForkRecordSchema,
    CoreExpressionForkRecordSchema,
    CoreClaimForkRecordSchema,
    isClaimBound,
    isPremiseBound,
    isExternallyBound,
    type TClaimBoundVariable,
    type TPremiseBoundVariable,
    type TCoreArgument,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
    type TCorePremise,
    type TCoreDerivationPremise,
    type TCoreClaimConnection,
} from "../src/lib/schemata"
import { ChangeCollector } from "../src/lib/core/change-collector"
import { VariableManager } from "../src/lib/core/variable-manager"
import { ExpressionManager } from "../src/lib/core/expression-manager"
import type {
    TExpressionInput,
    TExpressionWithoutPosition,
} from "../src/lib/core/expression-manager"
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
} from "../src/lib/core/evaluation/kleene"
import {
    propagateOperatorConstraints,
    evaluateArgument,
    checkArgumentValidity,
    type TArgumentEvaluationContext,
    type TEvaluablePremise,
} from "../src/lib/core/evaluation/argument-evaluation"
import {
    validateArgument,
    validateArgumentAfterPremiseMutation,
    validateArgumentEvaluability,
    collectArgumentReferencedVariables,
    type TArgumentValidationContext,
    type TValidatablePremise,
} from "../src/lib/core/argument-validation"
import {
    buildPremiseProfile,
    analyzePremiseRelationships,
} from "../src/lib/core/relationships"
import {
    computeHash,
    canonicalSerialize,
    entityChecksum,
} from "../src/lib/core/checksum"
import {
    EXPR_SCHEMA_INVALID,
    EXPR_SELF_REFERENTIAL_PARENT,
    EXPR_PARENT_NOT_FOUND,
    EXPR_PARENT_NOT_CONTAINER,
    EXPR_ROOT_ONLY_VIOLATED,
    EXPR_CHILD_LIMIT_EXCEEDED,
    EXPR_POSITION_DUPLICATE,
    EXPR_CHECKSUM_MISMATCH,
    PREMISE_VARIABLE_REF_NOT_FOUND,
    VAR_SCHEMA_INVALID,
    VAR_DUPLICATE_ID,
    VAR_DUPLICATE_SYMBOL,
    VAR_CHECKSUM_MISMATCH,
    ARG_OWNERSHIP_MISMATCH,
    ARG_CLAIM_REF_NOT_FOUND,
    CLAIM_SCHEMA_INVALID,
    CLAIM_FROZEN_NO_SUCCESSOR,
    CITATION_CLAIM_REF_NOT_FOUND,
    CITATION_SUPPORTING_REF_NOT_FOUND,
    CITATION_NOT_FOUND,
    AXIOM_NOT_FOUND,
    DERIVATION_STRUCTURE_INVALID,
} from "../src/lib/types/validation"
import {
    ParsedClaimSchema,
    ParsedVariableSchema,
    ParsedPremiseSchema,
    ParsedArgumentResponseSchema,
    buildParsingResponseSchema,
    getParsingResponseSchema,
} from "../src/lib/parsing/schemata"
import type {
    TParsedClaim,
    TParsedVariable,
    TParsedPremise,
    TParsedArgumentResponse,
} from "../src/lib/parsing/schemata"
import { buildParsingPrompt } from "../src/lib/parsing/prompt-builder"
import { ArgumentParser } from "../src/lib/parsing/argument-parser"
import Type from "typebox"
import { resolveApiKey, createLlmProvider } from "../src/cli/llm/index"
import { validateDerivationStructure } from "../src/lib/utils/derivation-validation.js"
import { emptyClaimConnectionLookup } from "../src/lib/utils/lookup"
import { InvariantViolationError } from "../src/lib/index"
import { ClaimAxiomLibrary } from "../src/lib/core/claim-axiom-library"

type TVariableInput = TOptionalChecksum<TClaimBoundVariable>

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ARG: TOptionalChecksum<TCoreArgument> = {
    id: "arg-1",
    version: 1,
}

function aLib() {
    const lib = new ClaimLibrary()
    lib.create({ id: "claim-default", type: "normal" })
    return lib
}

function makeVar(
    id: string,
    symbol: string,
    claimId = "claim-default",
    claimVersion = 0
): TVariableInput {
    return {
        id,
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        symbol,
        claimId,
        claimVersion,
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
    const eng = new ArgumentEngine(ARG, aLib())
    eng.addVariable(VAR_P)
    eng.addVariable(VAR_Q)
    eng.addVariable(VAR_R)
    const { result: pm } = eng.createPremise()
    return pm
}

/**
 * D2 — pre-v1.0 helper: build a permissive PremiseEngine (no AN
 * post-hook), preserved as a thin shim over `behavior: "permissive"`.
 * The pre-v1.0 helper toggled `grammarConfig` flags to disable
 * mutation-time AN cascades; under v1.0 `behavior: "permissive"` is
 * the single equivalent control. Tests that asserted on the pre-v1.0
 * P-1 enforcement throws were deleted in D2 (the throws don't exist
 * any more).
 */
function premiseWithVarsStrict(): PremiseEngine {
    const eng = new ArgumentEngine(ARG, aLib(), {
        behavior: "permissive",
    })
    eng.addVariable(VAR_P)
    eng.addVariable(VAR_Q)
    eng.addVariable(VAR_R)
    const { result: pm } = eng.createPremise()
    return pm
}

/**
 * D2 — pre-v1.0 helper: build a PremiseEngine with granular AN flags.
 * Preserved as a thin shim over `behavior: "permissive"` so test
 * scaffolding compiles. The per-flag config parameter is ignored — all
 * AN behavior is now controlled by `engine.behavior`.
 */
function premiseWithVarsGranular(_config: {
    wrapInsertFormula?: boolean
    negationInsertFormula?: boolean
    collapseDoubleNegation?: boolean
    collapseEmptyFormula?: boolean
    repositionOnCollision?: boolean
    absorbSameOperator?: boolean
}): PremiseEngine {
    const eng = new ArgumentEngine(ARG, aLib(), {
        behavior: "permissive",
    })
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
            type: "freeform" as const,
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
            makeFormulaExpr("formula-1", {
                parentId: "op-outer",
                position: 0,
            })
        )
        premise.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "formula-1",
                position: 0,
            })
        )
        // Insert op-inner wrapping expr-p; op-inner should inherit formula-1's slot 0
        premise.insertExpression(makeOpExpr("op-inner", "or"), "expr-p")
        // op-outer → formula-1 (pos 0) → op-inner (pos 0) → expr-p (pos 0)
        expect(premise.toDisplayString()).toBe("(((P)))")
    })

    it("inserts new expression into anchor's slot when only right node is provided", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeVarExpr("expr-p", VAR_P.id))
        // expr-p is root; op-or inherits that root slot, expr-p becomes POSITION_INITIAL
        premise.insertExpression(makeOpExpr("op-or", "or"), undefined, "expr-p")
        // POSITION_INITIAL should now be occupied
        expect(() =>
            premise.addExpression(
                makeVarExpr("expr-q", VAR_Q.id, {
                    parentId: "op-or",
                    position: POSITION_INITIAL,
                })
            )
        ).toThrowError(/Position 0 is already used/)
        // A different position should be free
        expect(() =>
            premise.addExpression(
                makeVarExpr("expr-q", VAR_Q.id, {
                    parentId: "op-or",
                    position: 1,
                })
            )
        ).not.toThrow()
    })

    it("inserts binary expression with leftNode at POSITION_INITIAL and rightNode at midpoint", () => {
        // Use ExpressionManager directly to allow two root-level expressions
        const em = new ExpressionManager()
        em.addExpression(makeVarExpr("expr-p", VAR_P.id))
        em.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: null,
                position: 1,
            })
        )
        // Insert op-and: anchor is expr-p (root), so op-and becomes root
        em.insertExpression(makeOpExpr("op-and", "and"), "expr-p", "expr-q")
        // op-and (root) → [expr-p(POSITION_INITIAL), expr-q(midpoint)]
        const andExpr = em.getExpression("op-and")!
        expect(andExpr.parentId).toBeNull()
        const pExpr = em.getExpression("expr-p")!
        expect(pExpr.parentId).toBe("op-and")
        expect(pExpr.position).toBe(POSITION_INITIAL)
        const qExpr = em.getExpression("expr-q")!
        expect(qExpr.parentId).toBe("op-and")
        expect(qExpr.position).toBe(midpoint(POSITION_INITIAL, POSITION_MAX))
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


// ---------------------------------------------------------------------------
// removeVariable
// ---------------------------------------------------------------------------

describe("removeVariable", () => {
    it("succeeds when no expression references the variable", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        eng.addVariable(VAR_R)
        eng.createPremise()
        // No expressions added — removeVariable should succeed
        expect(() => eng.removeVariable(VAR_P.id)).not.toThrow()
    })

    it("cascade-deletes expressions when a referenced variable is removed", () => {
        const eng = new ArgumentEngine(ARG, aLib())
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
        const eng = new ArgumentEngine(ARG, aLib())
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
            .getExpressions()
            .map((e) => e.id)
            .sort()
        expect(ids).toEqual(["expr-1", "expr-2", "op-1"].sort())
    })
})

// ---------------------------------------------------------------------------
// Stress test
// ---------------------------------------------------------------------------

describe("stress test", () => {
    interface TStressConfig {
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
    } satisfies Required<TStressConfig>

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

    function buildStress(cfg: TStressConfig = {}, seed = 42) {
        const { numVars, numPremises, minTerms, maxTerms } = {
            ...DEFAULTS,
            ...cfg,
        }
        const rand = prng(seed)
        const pick = (n: number) => Math.floor(rand() * n)
        const bool = (p = 0.5) => rand() < p

        const eng = new ArgumentEngine(ARG, aLib())

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
            // Insert a formula buffer between the operator parent and the cluster operator
            const formulaId = `${key}-f`
            emit(pm, makeFormulaExpr(formulaId, { parentId, position }))
            const clusterId = `${key}-cl`
            emit(
                pm,
                makeOpExpr(clusterId, bool() ? "and" : "or", {
                    parentId: formulaId,
                    position: 0,
                })
            )
            const ids = [formulaId, clusterId]
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
    }, 30_000)

    it("removing a premise cascades to all of its terms", () => {
        const { premiseManagers, termIdsByPremise } = buildStress()
        const pm = premiseManagers[0]
        const rootId = pm.getRootExpressionId()!
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
        const root2 = pm2.getRootExpressionId()!

        pm1.removeExpression(pm1.getRootExpressionId()!, true)

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
            pm.getReferencedVariableIds().has(referencedVar.id)
        )
        expect(hadExpressions).toBe(true)

        // Cascade removal should succeed
        const { result } = eng.removeVariable(referencedVar.id)
        expect(result).toBeDefined()
        expect(result!.id).toBe(referencedVar.id)

        // No premise should reference the variable anymore
        for (const pm of premiseManagers) {
            expect(pm.getReferencedVariableIds().has(referencedVar.id)).toBe(
                false
            )
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
            pm.removeExpression(pm.getRootExpressionId()!, true)
        }

        for (const pm of premiseManagers) {
            expect(pm.getRootExpressionId()).toBeUndefined()
        }
    })

    it("re-adding a premise after full teardown succeeds", () => {
        const { eng, premiseManagers } = buildStress()

        for (const pm of premiseManagers) {
            pm.removeExpression(pm.getRootExpressionId()!, true)
        }

        const { result: newPm } = eng.createPremise({ title: "rebuilt" })
        // Variables are already registered at engine level
        newPm.addExpression(makeOpExpr("new-root", "and"))
        expect(newPm.getRootExpressionId()).toBe("new-root")
    })

    it("all expressions appear in exactly one premise", () => {
        const { premiseManagers, allExpressions } = buildStress()
        const counts = new Map<string, number>()
        for (const pm of premiseManagers) {
            for (const expr of pm.getExpressions()) {
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
            for (const v of pm.getReferencedVariableIds()) {
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
        const eng = new ArgumentEngine(ARG, aLib())
        const { result: pm } = eng.createPremise({ title: "test" })
        expect(pm.toPremiseData().id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        )
        expect((pm.toPremiseData() as Record<string, unknown>).title).toBe(
            "test"
        )
    })

    it("getPremise(id) returns the same instance", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const { result: pm } = eng.createPremise()
        expect(eng.getPremise(pm.toPremiseData().id)).toBe(pm)
    })

    it("getPremise returns undefined for unknown IDs", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        expect(eng.getPremise("unknown")).toBeUndefined()
    })

    it("removePremise causes getPremise to return undefined", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const { result: pm } = eng.createPremise()
        const { id } = pm.toPremiseData()
        eng.removePremise(id)
        expect(eng.getPremise(id)).toBeUndefined()
    })

    it("multiple premises coexist independently", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm1 } = eng.createPremise({ title: "first" })
        const { result: pm2 } = eng.createPremise({ title: "second" })
        pm1.addExpression(makeVarExpr("expr-p", VAR_P.id))
        pm2.addExpression(makeVarExpr("expr-q", VAR_Q.id))
        expect(pm1.getExpressions()).toHaveLength(1)
        expect(pm2.getExpressions()).toHaveLength(1)
        expect(pm1.getExpression("expr-q")).toBeUndefined()
        expect(pm2.getExpression("expr-p")).toBeUndefined()
    })
})

// ---------------------------------------------------------------------------
// PremiseEngine
// ---------------------------------------------------------------------------

describe("ArgumentEngine — addVariable / removeVariable", () => {
    it("registers a variable and allows it to be referenced in a premise", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(pm.getExpression("expr-p")).toMatchObject({ id: "expr-p" })
    })

    it("throws when adding a duplicate variable symbol", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_P)
        expect(() => eng.addVariable(makeVar("var-p2", "P"))).toThrowError(
            /already exists/
        )
    })

    it("removes an unreferenced variable", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_P)
        expect(eng.removeVariable(VAR_P.id).result).toMatchObject({
            id: VAR_P.id,
        })
    })

    it("cascade-deletes expressions when removing a referenced variable", () => {
        const eng = new ArgumentEngine(ARG, aLib())
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
        const eng = new ArgumentEngine(ARG, aLib())
        const { result: pm } = eng.createPremise()
        expect(() =>
            pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        ).toThrowError(/references non-existent variable/)
    })

    it("throws when the variable does not belong to this argument", () => {
        const eng = new ArgumentEngine(ARG, aLib())
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
        expect(pm.getRootExpressionId()).toBe("expr-q")
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
                type: "freeform" as const,
            } as unknown as TCorePremise,
            { argument: ARG, variables: new VariableManager() }
        )
        const data = pm.toPremiseData()
        expect(data.id).toBe("my-id")
        expect((data as Record<string, unknown>).title).toBe("My Premise")
    })

    it("rootExpressionId is absent before any expression is added", () => {
        expect(makePremise().getRootExpressionId()).toBeUndefined()
    })

    it("rootExpressionId is set after adding the root expression", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(pm.getRootExpressionId()).toBe("expr-p")
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
        const variables = pm.getReferencedVariableIds()
        expect([...variables].sort()).toEqual([VAR_P.id, VAR_Q.id].sort())
    })

    it("variables does not include registered-but-unreferenced variables", () => {
        const pm = premiseWithVars() // P, Q, R all registered
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id)) // only P referenced
        const variables = pm.getReferencedVariableIds()
        expect([...variables]).toEqual([VAR_P.id])
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
            .getExpressions()
            .map((e) => e.id)
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
            operatorAssignments: {},
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
            operatorAssignments: {},
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
        const eng = new ArgumentEngine(ARG, aLib())
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
        const eng = new ArgumentEngine(ARG, aLib())

        const varA = makeVar("var-a", "X")
        const varB = makeVar("var-b", "X")

        eng.addVariable(varA)
        // Shared VariableManager enforces unique symbols
        expect(() => eng.addVariable(varB)).toThrowError(/already exists/)
    })

    it("evaluates an assignment and identifies inadmissible non-counterexamples", () => {
        const eng = new ArgumentEngine(ARG, aLib())
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
            operatorAssignments: {},
        })
        expect(result.ok).toBe(true)
        expect(result.isAdmissibleAssignment).toBe(false)
        expect(result.isCounterexample).toBe(false)
        expect(result.preservesTruthUnderAssignment).toBe(true)
        expect(result.constraintPremises).toHaveLength(1)
    })

    it("finds a counterexample for an invalid argument", () => {
        const eng = new ArgumentEngine(ARG, aLib())
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
        const eng = new ArgumentEngine(ARG, aLib())
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
            operatorAssignments: {},
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
            operatorAssignments: {},
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
        const eng = new ArgumentEngine(ARG, aLib())
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
        const eng = new ArgumentEngine(ARG, aLib())
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
        const eng = new ArgumentEngine(ARG, aLib())
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
        it("returns empty when premises match", () => {
            const before = {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 1,
                checksum: "x",
                descendantChecksum: null,
                combinedChecksum: "x",
                type: "freeform" as const,
            }
            const after = {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 1,
                checksum: "x",
                descendantChecksum: null,
                combinedChecksum: "x",
                type: "freeform" as const,
            }
            expect(defaultComparePremise(before, after)).toEqual([])
        })

        it("returns empty for premises differing only in extra fields", () => {
            const before = {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 1,
                checksum: "x",
                descendantChecksum: null,
                combinedChecksum: "x",
                type: "freeform" as const,
            }
            const after = {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 1,
                checksum: "y",
                descendantChecksum: null,
                combinedChecksum: "y",
                type: "freeform" as const,
            }
            expect(defaultComparePremise(before, after)).toEqual([])
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
    function buildSimpleEngine(arg: TOptionalChecksum<TCoreArgument>): {
        engine: ArgumentEngine
        premiseId: string
    } {
        const engine = new ArgumentEngine(arg, aLib())
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
            // Use a symbol-based variable matcher because auto-created
            // premise-bound variables have random IDs that differ between engines
            const diff = diffArguments(engineA, engineB, {
                variableMatcher: (a, b) => a.symbol === b.symbol,
            })

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
            const engineB = new ArgumentEngine(argB, aLib())
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
            const engineB = new ArgumentEngine(ARG, aLib())

            const diff = diffArguments(engineA, engineB)
            expect(diff.premises.removed).toHaveLength(1)
            expect(diff.premises.removed[0].id).toBe("premise-1")
        })

        it("detects modified premise via expression-level changes", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const engineB = new ArgumentEngine(ARG, aLib())
            engineB.addVariable(makeVar("var-p", "P"))
            engineB.addVariable(makeVar("var-q", "Q"))
            const { result: pm } = engineB.createPremiseWithId("premise-1", {
                title: "First premise",
            })
            // Different root expression ID to trigger expression-level diffs
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
            // No premise-level field changes (rootExpressionId is not a schema field)
            expect(diff.premises.modified[0].changes).toEqual([])
            // Expression-level changes: implies removed, iff added
            expect(diff.premises.modified[0].expressions.removed).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ id: "expr-implies" }),
                ])
            )
            expect(diff.premises.modified[0].expressions.added).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ id: "expr-iff" }),
                ])
            )
        })

        it("detects modified expressions within a premise", () => {
            // Build engineA with an 'and' root so removing one child doesn't collapse
            const engineA = new ArgumentEngine(ARG, aLib())
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
            const engineB = new ArgumentEngine(ARG, aLib())
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
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise()
        // Single variable expression as root
        pm.addExpression(makeVarExpr("e-p", "var-p"))

        const assignment: TCoreExpressionAssignment = {
            variables: { "var-p": null },
            operatorAssignments: {},
        }
        const result = pm.evaluate(assignment)
        expect(result.rootValue).toBeNull()
        expect(result.expressionValues["e-p"]).toBeNull()
    })

    it("missing variables default to null", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeVarExpr("e-p", "var-p"))

        const assignment: TCoreExpressionAssignment = {
            variables: {},
            operatorAssignments: {},
        }
        const result = pm.evaluate(assignment)
        expect(result.rootValue).toBeNull()
        expect(result.expressionValues["e-p"]).toBeNull()
    })

    it("propagates null through AND (Kleene)", () => {
        const eng = new ArgumentEngine(ARG, aLib())
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
            operatorAssignments: {},
        })
        expect(r1.rootValue).toBeNull()

        // false AND null = false
        const r2 = pm.evaluate({
            variables: { "var-p": false, "var-q": null },
            operatorAssignments: {},
        })
        expect(r2.rootValue).toBe(false)
    })

    it("propagates null through OR (Kleene)", () => {
        const eng = new ArgumentEngine(ARG, aLib())
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
            operatorAssignments: {},
        })
        expect(r1.rootValue).toBe(true)

        // false OR null = null
        const r2 = pm.evaluate({
            variables: { "var-p": false, "var-q": null },
            operatorAssignments: {},
        })
        expect(r2.rootValue).toBeNull()
    })

    it("propagates null through implies (Kleene)", () => {
        const eng = new ArgumentEngine(ARG, aLib())
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
            operatorAssignments: {},
        })
        expect(r1.rootValue).toBe(true)

        // null implies true = true
        const r2 = pm.evaluate({
            variables: { "var-p": null, "var-q": true },
            operatorAssignments: {},
        })
        expect(r2.rootValue).toBe(true)

        // true implies null = null
        const r3 = pm.evaluate({
            variables: { "var-p": true, "var-q": null },
            operatorAssignments: {},
        })
        expect(r3.rootValue).toBeNull()
    })

    it("rejected operator evaluates to false and skips children", () => {
        const eng = new ArgumentEngine(ARG, aLib())
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
            operatorAssignments: { "and-root": "rejected" },
        })
        expect(result.rootValue).toBe(false)
        // Children should NOT be in expressionValues because they were skipped
        expect(result.expressionValues["e-p"]).toBeUndefined()
        expect(result.expressionValues["e-q"]).toBeUndefined()
    })

    it("rejected formula evaluates to false", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise()
        // (P) as root formula wrapping variable
        pm.addExpression(makeFormulaExpr("f-root"))
        pm.addExpression(
            makeVarExpr("e-p", "var-p", { parentId: "f-root", position: 0 })
        )

        const result = pm.evaluate({
            variables: { "var-p": true },
            operatorAssignments: { "f-root": "rejected" },
        })
        expect(result.rootValue).toBe(false)
        // Child skipped
        expect(result.expressionValues["e-p"]).toBeUndefined()
    })

    it("rejected nested operator forces false while parent computes normally", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        eng.addVariable(VAR_R)
        const { result: pm } = eng.createPremise()
        // (P and Q) or R — with formula buffer between or and and
        pm.addExpression(makeOpExpr("or-root", "or"))
        pm.addExpression(
            makeFormulaExpr("formula-1", {
                parentId: "or-root",
                position: 0,
            })
        )
        pm.addExpression(
            makeOpExpr("and-child", "and", {
                parentId: "formula-1",
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
            operatorAssignments: { "and-child": "rejected" },
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
        const eng = new ArgumentEngine(ARG, aLib())
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
            operatorAssignments: { imp: "rejected" },
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
        const engine = new ArgumentEngine(ARG, aLib())
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
            operatorAssignments: {},
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
            operatorAssignments: {},
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
            operatorAssignments: { "c-imp": "rejected" },
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
            operatorAssignments: {},
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
            descendantChecksum: null,
            combinedChecksum: "abc123",
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
            claimId: "claim-default",
            claimVersion: 0,
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
            type: "freeform",
            claimId: "claim-default",
            claimVersion: 0,
            variables: [],
            expressions: [],
            checksum: "abc123",
            descendantChecksum: null,
            combinedChecksum: "abc123",
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
            ARG_WITH_EXTRAS as TOptionalChecksum<TCoreArgument>,
            aLib()
        )
        const result = engine.getArgument()
        expect((result as Record<string, unknown>).title).toBe("My Argument")
        expect((result as Record<string, unknown>).customField).toBe(42)
    })

    it("preserves unknown fields on the argument through snapshot()", () => {
        const engine = new ArgumentEngine(
            ARG_WITH_EXTRAS as TOptionalChecksum<TCoreArgument>,
            aLib()
        )
        const snap = engine.snapshot()
        expect((snap.argument as Record<string, unknown>).title).toBe(
            "My Argument"
        )
        expect((snap.argument as Record<string, unknown>).customField).toBe(42)
    })

    it("preserves extras on premises through toData()", () => {
        const engine = new ArgumentEngine({ id: "arg-1", version: 1 }, aLib())
        const { result: pm } = engine.createPremise({
            title: "My Premise",
            priority: "high",
        })
        const data = pm.toPremiseData()
        expect((data as Record<string, unknown>).title).toBe("My Premise")
        expect((data as Record<string, unknown>).priority).toBe("high")
    })

    it("preserves extras on premises through engine.snapshot()", () => {
        const engine = new ArgumentEngine({ id: "arg-1", version: 1 }, aLib())
        engine.createPremise({ title: "Premise One" })
        const snap = engine.snapshot()
        expect(
            (snap.premises[0].premise as Record<string, unknown>).title
        ).toBe("Premise One")
    })

    it("setExtras replaces all extras, not merges", () => {
        const engine = new ArgumentEngine({ id: "arg-1", version: 1 }, aLib())
        const { result: pm } = engine.createPremise({ a: "1", b: "2" })
        pm.setExtras({ c: "3" })
        expect(pm.getExtras()).toEqual({ c: "3" })
        expect(pm.getExtras()).not.toHaveProperty("a")
    })

    it("structural fields in toData() cannot be shadowed by extras", () => {
        const engine = new ArgumentEngine({ id: "arg-1", version: 1 }, aLib())
        const { result: pm } = engine.createPremise({
            id: "should-be-overridden",
            rootExpressionId: "fake",
        })
        const data = pm.toPremiseData()
        expect(data.id).not.toBe("should-be-overridden")
        expect(data.id).toBe(pm.getId())
        expect(pm.getRootExpressionId()).toBeUndefined()
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
        const eng = new ArgumentEngine(ARG, aLib())
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
        const eng = new ArgumentEngine(ARG, aLib())
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
        // ¬(¬A ∧ B) → C — with formula buffer between not and and
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_A)
        eng.addVariable(VAR_B)
        eng.addVariable(VAR_C)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeOpExpr("impl", "implies"))
        pm.addExpression(
            makeOpExpr("not-outer", "not", { parentId: "impl", position: 0 })
        )
        pm.addExpression(
            makeFormulaExpr("formula-not", {
                parentId: "not-outer",
                position: 0,
            })
        )
        pm.addExpression(
            makeOpExpr("and-1", "and", { parentId: "formula-not", position: 0 })
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
        // (A ∧ B) → (B ∧ C) — with formula buffers between implies and and
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_A)
        eng.addVariable(VAR_B)
        eng.addVariable(VAR_C)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeOpExpr("impl", "implies"))
        pm.addExpression(
            makeFormulaExpr("formula-l", { parentId: "impl", position: 0 })
        )
        pm.addExpression(
            makeOpExpr("and-l", "and", { parentId: "formula-l", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("ve-a", VAR_A.id, { parentId: "and-l", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("ve-b1", VAR_B.id, { parentId: "and-l", position: 1 })
        )
        pm.addExpression(
            makeFormulaExpr("formula-r", { parentId: "impl", position: 1 })
        )
        pm.addExpression(
            makeOpExpr("and-r", "and", { parentId: "formula-r", position: 0 })
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
        const eng = new ArgumentEngine(ARG, aLib())
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
        const eng = new ArgumentEngine(ARG, aLib())
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
        const eng = new ArgumentEngine(ARG, aLib())
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
        const eng = new ArgumentEngine(ARG, aLib())
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
        const eng = new ArgumentEngine(ARG, aLib())
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
        // P1: B → (B ∧ C), P2 (focused): B → D — with formula buffer
        const eng = new ArgumentEngine(ARG, aLib())
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
            makeFormulaExpr("p1-formula", {
                parentId: "p1-impl",
                position: 1,
            })
        )
        p1.addExpression(
            makeOpExpr("p1-and", "and", {
                parentId: "p1-formula",
                position: 0,
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
        const eng = new ArgumentEngine(ARG, aLib())
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
        const eng = new ArgumentEngine(ARG, aLib())
        buildImplies(eng, "p1", VAR_A, VAR_B)
        buildImplies(eng, "p2", VAR_B, VAR_C)

        const result = analyzePremiseRelationships(eng, "p1")
        const p2Result = result.premises.find((p) => p.premiseId === "p2")!
        expect(p2Result.relationship).toBe("downstream")
        expect(p2Result.transitive).toBe(false)
    })

    it("classifies a premise with no shared variables as unrelated", () => {
        // P1: A → B, P2 (focused): C → D
        const eng = new ArgumentEngine(ARG, aLib())
        buildImplies(eng, "p1", VAR_A, VAR_B)
        buildImplies(eng, "p2", VAR_C, VAR_D)

        const result = analyzePremiseRelationships(eng, "p2")
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("unrelated")
        expect(p1Result.variableDetails).toEqual([])
    })

    it("excludes the focused premise from results", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        buildImplies(eng, "p1", VAR_A, VAR_B)
        buildImplies(eng, "p2", VAR_B, VAR_C)

        const result = analyzePremiseRelationships(eng, "p2")
        expect(
            result.premises.find((p) => p.premiseId === "p2")
        ).toBeUndefined()
    })

    it("throws when focused premise does not exist", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        expect(() => analyzePremiseRelationships(eng, "nonexistent")).toThrow()
    })

    it("returns empty premises array when argument has only the focused premise", () => {
        const eng = new ArgumentEngine(ARG, aLib())
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
        const eng = new ArgumentEngine(ARG, aLib())
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
        const eng = new ArgumentEngine(ARG, aLib())
        buildImplies(eng, "p1", VAR_E, VAR_F)
        buildImplies(eng, "p2", VAR_B, VAR_C)
        buildImplies(eng, "p3", VAR_C, VAR_D)

        const result = analyzePremiseRelationships(eng, "p3")
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("unrelated")
    })

    it("classifies transitive downstream", () => {
        // P1 (focused): A → B, P2: B → C, P3: C → D
        const eng = new ArgumentEngine(ARG, aLib())
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
        const eng = new ArgumentEngine(ARG, aLib())
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
        const eng = new ArgumentEngine(ARG, aLib())
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
        const eng = new ArgumentEngine(ARG, aLib())
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
        // Precedence: contradicting wins — with formula buffers
        const eng = new ArgumentEngine(ARG, aLib())
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
            makeFormulaExpr("p1-formula", {
                parentId: "p1-impl",
                position: 1,
            })
        )
        p1.addExpression(
            makeOpExpr("p1-and", "and", {
                parentId: "p1-formula",
                position: 0,
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
            makeFormulaExpr("p2-formula", {
                parentId: "p2-impl",
                position: 0,
            })
        )
        p2.addExpression(
            makeOpExpr("p2-and", "and", {
                parentId: "p2-formula",
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
        // Precedence: restricting wins — with formula buffers
        const eng = new ArgumentEngine(ARG, aLib())
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
            makeFormulaExpr("p1-formula", {
                parentId: "p1-impl",
                position: 1,
            })
        )
        p1.addExpression(
            makeOpExpr("p1-and", "and", {
                parentId: "p1-formula",
                position: 0,
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
            makeFormulaExpr("p2-formula", {
                parentId: "p2-impl",
                position: 0,
            })
        )
        p2.addExpression(
            makeOpExpr("p2-and", "and", {
                parentId: "p2-formula",
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
        const eng = new ArgumentEngine(ARG, aLib())
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
        const eng = new ArgumentEngine(ARG, aLib())
        eng.createPremiseWithId("p1") // empty
        buildImplies(eng, "p2", VAR_A, VAR_B)

        const result = analyzePremiseRelationships(eng, "p2")
        const p1Result = result.premises.find((p) => p.premiseId === "p1")!
        expect(p1Result.relationship).toBe("unrelated")
    })

    it("handles graph cycles without hanging", () => {
        // P1: A → B, P2: B → A, P3 (focused): A → C
        const eng = new ArgumentEngine(ARG, aLib())
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
            claimId: "claim-default",
            claimVersion: 0,
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
            descendantChecksum: null,
            combinedChecksum: "x",
            type: "freeform" as const,
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
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        const v1 = {
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        }
        const v2 = {
            id: "v2",
            symbol: "Q",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
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
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        const v = {
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        }
        const { result, changes } = eng.addVariable(v)
        expect(result.id).toBe("v1")
        expect(result.symbol).toBe("P")
        expect(changes.variables?.added).toHaveLength(1)
        expect(changes.variables?.added[0].id).toBe("v1")
    })

    it("removeVariable returns removed variable in result and changes", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        const v = {
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        }
        eng.addVariable(v)
        const { result, changes } = eng.removeVariable("v1")
        expect(result?.id).toBe("v1")
        expect(changes.variables?.removed).toHaveLength(1)
        expect(changes.variables?.removed[0].id).toBe("v1")
    })

    it("removeVariable for non-existent variable returns undefined with empty changes", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        const { result, changes } = eng.removeVariable("nonexistent")
        expect(result).toBeUndefined()
        expect(changes).toEqual({})
    })

    it("setExtras returns new extras with changeset", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        const { result: pm } = eng.createPremise()
        const { result, changes } = pm.setExtras({ title: "Test" })
        expect(result).toEqual({ title: "Test" })
        expect(changes.premises?.modified).toHaveLength(1)
    })
})

// ---------------------------------------------------------------------------
// ArgumentEngine — mutation changesets
// ---------------------------------------------------------------------------

describe("ArgumentEngine — mutation changesets", () => {
    it("createPremise returns PremiseEngine and records added premise", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        const { result: pm, changes } = eng.createPremise()
        expect(pm).toBeInstanceOf(PremiseEngine)
        expect(changes.premises?.added).toHaveLength(1)
        expect(changes.premises?.added[0].id).toBe(pm.getId())
    })

    it("createPremiseWithId returns PremiseEngine with specified ID", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        const { result: pm, changes } = eng.createPremiseWithId("my-premise")
        expect(pm.getId()).toBe("my-premise")
        expect(changes.premises?.added).toHaveLength(1)
        expect(changes.premises?.added[0].id).toBe("my-premise")
    })

    it("removePremise returns premise data and records removal", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        eng.createPremise()
        const premiseId = eng.listPremiseIds()[0]
        const { result, changes } = eng.removePremise(premiseId)
        expect(result?.id).toBe(premiseId)
        expect(changes.premises?.removed).toHaveLength(1)
        expect(changes.premises?.removed[0].id).toBe(premiseId)
    })

    it("removePremise that was conclusion also records role change", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        const { result: pm } = eng.createPremise()
        eng.setConclusionPremise(pm.getId())
        const { changes } = eng.removePremise(pm.getId())
        expect(changes.roles).toBeDefined()
        expect(changes.roles?.conclusionPremiseId).toBeUndefined()
    })

    it("removePremise for non-existent ID returns undefined", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        const { result, changes } = eng.removePremise("nope")
        expect(result).toBeUndefined()
        expect(changes).toEqual({})
    })

    it("setConclusionPremise returns new role state", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        const { result: pm } = eng.createPremise()
        const { result, changes } = eng.setConclusionPremise(pm.getId())
        expect(result.conclusionPremiseId).toBe(pm.getId())
        expect(changes.roles?.conclusionPremiseId).toBe(pm.getId())
    })

    it("clearConclusionPremise returns empty role state", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
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
            const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
            const { result: pm } = eng.createPremise()
            const cs1 = pm.checksum()
            const cs2 = pm.checksum()
            expect(cs1).toBe(cs2)
        })

        it("combinedChecksum changes when an expression is added", () => {
            const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
            const v = {
                id: "v1",
                symbol: "P",
                argumentId: "arg1",
                argumentVersion: 0,
                claimId: "claim-default",
                claimVersion: 0,
            }
            eng.addVariable(v)
            const { result: pm } = eng.createPremise()
            const before = pm.combinedChecksum()
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
            const after = pm.combinedChecksum()
            expect(before).not.toBe(after)
        })

        it("premise checksum does not change when a variable is added (variables are argument-scoped)", () => {
            const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
            const { result: pm } = eng.createPremise()
            const before = pm.checksum()
            eng.addVariable({
                id: "v1",
                symbol: "P",
                argumentId: "arg1",
                argumentVersion: 0,
                claimId: "claim-default",
                claimVersion: 0,
            })
            const after = pm.checksum()
            expect(before).toBe(after)
        })

        it("identical premises built the same way produce same checksum", () => {
            const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
            const v1 = {
                id: "v1",
                symbol: "P",
                argumentId: "arg1",
                argumentVersion: 0,
                claimId: "claim-default",
                claimVersion: 0,
            }
            eng.addVariable(v1)
            const { result: pm1 } = eng.createPremiseWithId("p1")
            const { result: pm2 } = eng.createPremiseWithId("p2")
            // Different premise IDs do NOT change the checksum (id is excluded from default checksum config)
            expect(pm1.checksum()).toBe(pm2.checksum())
        })
    })

    describe("ArgumentEngine — checksum", () => {
        it("returns consistent checksum for same state", () => {
            const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
            expect(eng.checksum()).toBe(eng.checksum())
        })

        it("checksum changes when a premise is added", () => {
            const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
            const before = eng.checksum()
            eng.createPremise()
            const after = eng.checksum()
            expect(before).not.toBe(after)
        })

        it("checksum changes when conclusion is set", () => {
            const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
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
            const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
                checksumConfig: { argumentFields: new Set(["id"]) },
            })
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
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        const v = {
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
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
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        })
        eng.addVariable({
            id: "v2",
            symbol: "Q",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
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
        expect(vars).toHaveLength(2) // 1 claim-bound + 1 auto premise-bound
        for (const v of vars) {
            expect(v.checksum).toBeDefined()
            expect(typeof v.checksum).toBe("string")
            expect(v.checksum).toMatch(/^[0-9a-f]{8}$/)
        }
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
        const expressions = pm.getExpressions()
        expect(expressions).toHaveLength(1)
        expect(expressions[0].checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("changeset expressions from addExpression include checksums", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
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
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        const { changes } = eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        })
        expect(changes.variables?.added).toHaveLength(1)
        expect(changes.variables?.added[0].checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("changeset variables from removeVariable include checksums", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        })
        const { changes } = eng.removeVariable("v1")
        expect(changes.variables?.removed).toHaveLength(1)
        expect(changes.variables?.removed[0].checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("addExpression result includes checksum", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
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
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        const { result } = eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        })
        expect(result.checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("ArgumentEngine getArgument includes argument-level checksum", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        eng.createPremise()
        const arg = eng.getArgument()
        expect(arg.checksum).toBeDefined()
        expect(arg.checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("ArgumentEngine premise checksums via listPremises", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
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
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        })
        eng.addVariable({
            id: "v2",
            symbol: "Q",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
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
        // "id" is not in the default expressionFields, so it will not be present after merge
        expect(config.expressionFields!.has("id")).toBe(false)
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
        const eng = new ArgumentEngine(ARG, aLib())
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

        expect(pm1.getVariables()).toHaveLength(3) // 1 claim-bound + 2 auto premise-bound
        expect(pm2.getVariables()).toHaveLength(3)
    })

    it("addVariable throws for duplicate symbol", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_P)
        expect(() =>
            eng.addVariable({
                id: "var-other",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                claimId: "claim-default",
                claimVersion: 0,
                symbol: "P",
            })
        ).toThrow(/already exists/)
    })

    it("addVariable throws for duplicate id", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_P)
        expect(() => eng.addVariable(VAR_P)).toThrow(/already exists/)
    })

    it("addVariable throws for wrong argumentId", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        expect(() =>
            eng.addVariable({
                id: "var-x",
                argumentId: "other",
                argumentVersion: ARG.version,
                claimId: "claim-default",
                claimVersion: 0,
                symbol: "X",
            })
        ).toThrow(/does not match/)
    })

    it("addVariable throws for wrong argumentVersion", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        expect(() =>
            eng.addVariable({
                id: "var-x",
                argumentId: ARG.id,
                argumentVersion: 99,
                claimId: "claim-default",
                claimVersion: 0,
                symbol: "X",
            })
        ).toThrow(/does not match/)
    })

    it("addVariable returns mutation result with changeset", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const { result, changes } = eng.addVariable(VAR_P)
        expect(result.id).toBe(VAR_P.id)
        expect(result.checksum).toBeDefined()
        expect(changes.variables?.added).toHaveLength(1)
    })

    it("updateVariable renames a symbol", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_P)
        const { result } = eng.updateVariable(VAR_P.id, { symbol: "P_new" })
        expect(result?.symbol).toBe("P_new")

        const { result: pm } = eng.createPremise()
        const renamedVar = pm.getVariables().find((v) => v.id === VAR_P.id)
        expect(renamedVar?.symbol).toBe("P_new")
    })

    it("updateVariable returns undefined for non-existent variable", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const { result } = eng.updateVariable("nope", { symbol: "X" })
        expect(result).toBeUndefined()
    })

    it("updateVariable throws for conflicting symbol", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        expect(() => eng.updateVariable(VAR_P.id, { symbol: "Q" })).toThrow(
            /already in use/
        )
    })

    it("updateVariable returns changeset with modified variable", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_P)
        const { changes } = eng.updateVariable(VAR_P.id, { symbol: "X" })
        expect(changes.variables?.modified).toHaveLength(1)
        expect(changes.variables?.modified[0].symbol).toBe("X")
    })

    it("getVariables returns all variables with checksums", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const vars = eng.getVariables()
        expect(vars).toHaveLength(2)
        expect(vars[0].checksum).toBeDefined()
        expect(vars[1].checksum).toBeDefined()
    })

    it("removeVariable with no references removes cleanly", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_P)
        const { result, changes } = eng.removeVariable(VAR_P.id)
        expect(result?.id).toBe(VAR_P.id)
        expect(changes.variables?.removed).toHaveLength(1)
        expect(eng.getVariables()).toHaveLength(0)
    })

    it("removeVariable returns undefined for non-existent variable", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const { result, changes } = eng.removeVariable("nonexistent")
        expect(result).toBeUndefined()
        expect(changes).toEqual({})
    })

    it("removeVariable cascade-deletes referencing expressions in one premise", () => {
        const eng = new ArgumentEngine(ARG, aLib())
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
        const eng = new ArgumentEngine(ARG, aLib())
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
        const eng = new ArgumentEngine(ARG, aLib())
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
        const eng = new ArgumentEngine(ARG, aLib())
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
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise()

        const { result, changes } = pm.deleteExpressionsUsingVariable(VAR_P.id)
        expect(result).toHaveLength(0)
        expect(changes).toEqual({})
    })

    it("deletes a single variable expression", () => {
        const eng = new ArgumentEngine(ARG, aLib())
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
        const eng = new ArgumentEngine(ARG, aLib())
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
        const eng = new ArgumentEngine(ARG, aLib())
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
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        const { result: pm, changes } = eng.createPremise()
        expect(eng.getRoleState().conclusionPremiseId).toBe(pm.getId())
        expect(changes.roles?.conclusionPremiseId).toBe(pm.getId())
    })

    it("first createPremiseWithId auto-sets conclusion", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        const { changes } = eng.createPremiseWithId("my-premise")
        expect(eng.getRoleState().conclusionPremiseId).toBe("my-premise")
        expect(changes.roles?.conclusionPremiseId).toBe("my-premise")
    })

    it("second createPremise does not change conclusion", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        const { result: first } = eng.createPremise()
        const { changes } = eng.createPremise()
        expect(eng.getRoleState().conclusionPremiseId).toBe(first.getId())
        expect(changes.roles).toBeUndefined()
    })

    it("createPremise after clearConclusionPremise auto-sets again", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        eng.createPremise()
        eng.clearConclusionPremise()
        const { result: pm2, changes } = eng.createPremise()
        expect(eng.getRoleState().conclusionPremiseId).toBe(pm2.getId())
        expect(changes.roles?.conclusionPremiseId).toBe(pm2.getId())
    })

    it("createPremise after removing conclusion premise auto-sets again", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        const { result: first } = eng.createPremise()
        eng.removePremise(first.getId())
        const { result: second, changes } = eng.createPremise()
        expect(eng.getRoleState().conclusionPremiseId).toBe(second.getId())
        expect(changes.roles?.conclusionPremiseId).toBe(second.getId())
    })

    it("setConclusionPremise overrides auto-assignment", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
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
        const eng = new ArgumentEngine(ARG, aLib())
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
        // e-p is modified directly; op-and is also modified because its
        // descendantChecksum changed (child's combinedChecksum changed).
        const modifiedIds = (changes.expressions?.modified ?? []).map(
            (e) => e.id
        )
        expect(modifiedIds).toContain("e-p")
        expect(modifiedIds).toContain("op-and")
        const modifiedChild = changes.expressions!.modified.find(
            (e) => e.id === "e-p"
        )!
        expect(modifiedChild.position).toBe(2)
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

    it("marks premise combinedChecksum dirty after update", () => {
        const { pm } = setup()
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: null, position: 1 })
        )

        const before = pm.combinedChecksum()
        pm.updateExpression("e-p", { variableId: VAR_Q.id })
        const after = pm.combinedChecksum()

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
        const eng = new ArgumentEngine(
            { id: ARG.id, version: ARG.version },
            aLib()
        )
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

        expect(pm.getRootExpressionId()).toBe("expr-q")
        const expressions = pm.getExpressions()
        expect(expressions).toHaveLength(1)
        expect(expressions[0].id).toBe("expr-q")
        expect(expressions[0].parentId).toBeNull()
    })

    it("deleteSubtree: false — promotes single child (operator)", () => {
        const { pm } = setup()
        // Tree: formula(or(P, Q)) — formula buffers the operator nesting
        pm.addExpression(
            makeFormulaExpr("formula-1", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeOpExpr("op-or", "or", {
                parentId: "formula-1",
                position: 1,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-or", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-or", position: 2 })
        )

        // Remove formula with deleteSubtree: false — or promoted to root
        pm.removeExpression("formula-1", false)

        expect(pm.getRootExpressionId()).toBe("op-or")
        const expressions = pm.getExpressions()
        expect(expressions).toHaveLength(3)
        const orExpr = expressions.find((e) => e.id === "op-or")!
        expect(orExpr.parentId).toBeNull()
        // Children of or are intact
        const pExpr = expressions.find((e) => e.id === "expr-p")!
        const qExpr = expressions.find((e) => e.id === "expr-q")!
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

        expect(pm.getRootExpressionId()).toBe("expr-p")
        const expressions = pm.getExpressions()
        expect(expressions).toHaveLength(1)
        expect(expressions[0].id).toBe("expr-p")
        expect(expressions[0].parentId).toBeNull()
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
        expect(pm.getExpressions()).toHaveLength(3)
        expect(pm.getRootExpressionId()).toBe("op-and")
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

        expect(pm.getRootExpressionId()).toBe("expr-q")
        const expressions = pm.getExpressions()
        expect(expressions).toHaveLength(1)
        expect(expressions[0].id).toBe("expr-q")
        expect(expressions[0].parentId).toBeNull()
    })

    it("deleteSubtree: false — promotes child into non-root slot", () => {
        const { pm } = setup()
        // Tree: and(not(formula(or(P, Q))), P2)
        // Need two children for and so it doesn't collapse after not removal.
        pm.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeOpExpr("op-not", "not", { parentId: "op-and", position: 1 })
        )
        pm.addExpression(
            makeFormulaExpr("formula-1", {
                parentId: "op-not",
                position: 1,
            })
        )
        pm.addExpression(
            makeOpExpr("op-or", "or", {
                parentId: "formula-1",
                position: 1,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-or", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-or", position: 2 })
        )
        pm.addExpression(
            makeVarExpr("expr-p2", VAR_P.id, {
                parentId: "op-and",
                position: 2,
            })
        )

        // Remove not with deleteSubtree: false — formula promoted into not's slot under and
        pm.removeExpression("op-not", false)

        expect(pm.getRootExpressionId()).toBe("op-and")
        const expressions = pm.getExpressions()
        expect(expressions).toHaveLength(6) // and, formula, or, P, Q, P2
        const formulaExpr = expressions.find((e) => e.id === "formula-1")!
        expect(formulaExpr.parentId).toBe("op-and")
        const orExpr = expressions.find((e) => e.id === "op-or")!
        expect(orExpr.parentId).toBe("formula-1")
        const pExpr = expressions.find((e) => e.id === "expr-p")!
        expect(pExpr.parentId).toBe("op-or")
        const qExpr = expressions.find((e) => e.id === "expr-q")!
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

        expect(pm.getRootExpressionId()).toBe("op-not")
        const expressions = pm.getExpressions()
        expect(expressions).toHaveLength(2)
        const notExpr = expressions.find((e) => e.id === "op-not")!
        expect(notExpr.parentId).toBeNull()
        const pExpr = expressions.find((e) => e.id === "expr-p")!
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

        expect(pm.getRootExpressionId()).toBe("expr-p")
        expect(pm.getExpressions()).toHaveLength(1)

        // Verify variable cascade still works on P
        // (P should still be tracked in expressionsByVariableId)
        pm.deleteExpressionsUsingVariable(VAR_P.id)
        expect(pm.getExpressions()).toHaveLength(0)
        expect(pm.getRootExpressionId()).toBeUndefined()
    })
})

describe("VariableManager — generic type parameter", () => {
    it("accepts and returns an extended variable type", () => {
        type TExtendedVar = TCorePropositionalVariable & { color: string }
        const vm = new VariableManager<TExtendedVar>()
        const v: TExtendedVar = {
            id: "v1",
            argumentId: "a1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
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
        type TExtVar = TCorePropositionalVariable & { color: string }

        const changeset: TCoreChangeset<TCorePropositionalExpression, TExtVar> =
            {
                variables: {
                    added: [
                        {
                            id: "v1",
                            argumentId: "a1",
                            argumentVersion: 0,
                            claimId: "claim-default",
                            claimVersion: 0,
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
        type TExtExpr = TCorePropositionalExpression & { tag: string }
        const em = new ExpressionManager<TExtExpr>()

        const expr: TExpressionInput<TExtExpr> = {
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
        type TExtPremise = TCorePremise & { color: string }
        const arg: TCoreArgument = {
            id: "a1",
            version: 0,
            checksum: "x",
            descendantChecksum: null,
            combinedChecksum: "x",
        }
        const vm = new VariableManager()
        const pm = new PremiseEngine<TCoreArgument, TExtPremise>(
            {
                id: "p1",
                argumentId: arg.id,
                argumentVersion: arg.version,
                color: "blue",
            } as TExtPremise,
            { argument: arg, variables: vm }
        )
        const data = pm.toPremiseData()
        expect(data.color).toBe("blue")
    })
})

describe("ArgumentEngine — generic type parameters", () => {
    it("preserves extended argument type", () => {
        type TExtArg = TCoreArgument & { projectId: string }
        const arg: TOptionalChecksum<TExtArg> = {
            id: "a1",
            version: 0,
            projectId: "proj-1",
        }
        const engine = new ArgumentEngine<TExtArg>(arg, aLib())
        const retrieved = engine.getArgument()
        expect(retrieved.projectId).toBe("proj-1")
        expect(typeof retrieved.checksum).toBe("string")
    })

    it("preserves extended variable type through addVariable", () => {
        type TExtVar = TCorePropositionalVariable & { color: string }
        const engine = new ArgumentEngine<
            TCoreArgument,
            TCorePremise,
            TCorePropositionalExpression,
            TExtVar
        >({ id: "a1", version: 0 }, aLib())
        const { result } = engine.addVariable({
            id: "v1",
            argumentId: "a1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
            symbol: "P",
            color: "red",
        })
        expect(result.color).toBe("red")
        expect(typeof result.checksum).toBe("string")
    })
})

describe("diffArguments — generic type parameters", () => {
    it("accepts and returns extended types", () => {
        type TExtArg = TCoreArgument & { projectId: string }
        const argA: TOptionalChecksum<TExtArg> = {
            id: "a1",
            version: 0,
            projectId: "proj-1",
        }
        const argB: TOptionalChecksum<TExtArg> = {
            id: "a1",
            version: 1,
            projectId: "proj-1",
        }
        const engineA = new ArgumentEngine<TExtArg>(argA, aLib())
        const engineB = new ArgumentEngine<TExtArg>(argB, aLib())

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
            descendantChecksum: null,
            combinedChecksum: "x",
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
            claimId: "claim-default",
            claimVersion: 0,
            symbol: "P",
            checksum: "x",
        })
        const pm = new PremiseEngine(
            {
                id: "p1",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                type: "freeform" as const,
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
        const eng = new ArgumentEngine(ARG, aLib(), {
            positionConfig: config,
        })
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
        const eng = new ArgumentEngine(ARG, aLib())
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
            claimId: "claim-default",
            claimVersion: 0,
            symbol: "P",
            checksum: "x",
        })
        vm.addVariable({
            id: "v2",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
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
            claimId: "claim-default",
            claimVersion: 0,
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
                type: "freeform" as const,
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
        const eng = new ArgumentEngine(ARG as TCoreArgument, aLib())
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
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
            claimId: "claim-default",
            claimVersion: 0,
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
                type: "freeform" as const,
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
        const eng = new ArgumentEngine(ARG as TCoreArgument, aLib())
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
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
            claimId: "claim-default",
            claimVersion: 0,
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
        const eng = new ArgumentEngine(ARG as TCoreArgument, aLib())
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
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
            claimId: "claim-default",
            claimVersion: 0,
            checksum: "x",
        })
        const restored = PremiseEngine.fromSnapshot(
            snap,
            ARG as TCoreArgument,
            vm2
        )
        // The root expression ID should be preserved
        expect(restored.getRootExpressionId()).toBe("e1")
    })

    it("rebuilds expressionsByVariableId index on restore", () => {
        const eng = new ArgumentEngine(ARG as TCoreArgument, aLib())
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
        })
        eng.addVariable({
            id: "v2",
            symbol: "Q",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
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
            claimId: "claim-default",
            claimVersion: 0,
            checksum: "x",
        })
        vm2.addVariable({
            id: "v2",
            symbol: "Q",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
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
    ): TOptionalChecksum<TClaimBoundVariable> {
        return {
            id,
            symbol,
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
        }
    }

    it("round-trips an empty engine", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        const snap = engine.snapshot()
        const restored = ArgumentEngine.fromSnapshot(snap, aLib())
        expect(restored.getArgument().id).toBe("arg-1")
        expect(restored.listPremiseIds()).toEqual([])
        expect(restored.getVariables()).toEqual([])
        expect(restored.getRoleState()).toEqual({})
    })

    it("round-trips engine with premises and variables", () => {
        const engine = new ArgumentEngine(ARG, aLib())
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
        const restored = ArgumentEngine.fromSnapshot(snap, aLib())

        expect(restored.listPremiseIds()).toEqual(["p1"])
        expect(restored.getVariables()).toHaveLength(3) // 2 claim-bound + 1 auto premise-bound
        const restoredPm = restored.getPremise("p1")!
        expect(restoredPm.getExpressions()).toHaveLength(1)
        expect(restoredPm.getExpressions()[0].id).toBe("e1")
    })

    it("preserves conclusion role through round-trip", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.createPremiseWithId("p1")
        engine.createPremiseWithId("p2")
        engine.setConclusionPremise("p2")

        const snap = engine.snapshot()
        const restored = ArgumentEngine.fromSnapshot(snap, aLib())

        expect(restored.getRoleState().conclusionPremiseId).toBe("p2")
    })

    it("snapshot includes config", () => {
        const config = {
            checksumConfig: DEFAULT_CHECKSUM_CONFIG,
            positionConfig: DEFAULT_POSITION_CONFIG,
        }
        const engine = new ArgumentEngine(ARG, aLib(), config)
        const snap = engine.snapshot()
        expect(snap.config).toBeDefined()
        expect(snap.config!.positionConfig).toEqual(DEFAULT_POSITION_CONFIG)
    })

    it("fromSnapshot produces independent copy", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable(makeVariable("v1", "P"))
        engine.createPremiseWithId("p1")

        const snap = engine.snapshot()
        const restored = ArgumentEngine.fromSnapshot(snap, aLib())

        // Mutate restored, original should be unaffected
        restored.createPremiseWithId("p2")
        expect(engine.listPremiseIds()).toEqual(["p1"])
        expect(restored.listPremiseIds()).toEqual(["p1", "p2"])
    })

    it("rollback restores previous state", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable(makeVariable("v1", "P"))
        engine.createPremiseWithId("p1")

        const snap = engine.snapshot()

        // Mutate the engine
        engine.addVariable(makeVariable("v2", "Q"))
        engine.createPremiseWithId("p2")

        expect(engine.listPremiseIds()).toEqual(["p1", "p2"])
        expect(engine.getVariables()).toHaveLength(4) // v1 + v2 + 2 auto premise-bound

        // Rollback
        engine.rollback(snap)

        expect(engine.listPremiseIds()).toEqual(["p1"])
        expect(engine.getVariables()).toHaveLength(2) // v1 + 1 auto premise-bound
        expect(engine.getVariables().find((v) => v.id === "v1")?.symbol).toBe(
            "P"
        )
    })

    it("rollback after multiple mutations restores correct state", () => {
        const engine = new ArgumentEngine(ARG, aLib())
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
        expect(engine.getVariables()).toHaveLength(2) // v1 + 1 auto premise-bound
        expect(engine.getVariables().find((v) => v.id === "v1")).toBeDefined()
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
                claimId: "claim-default",
                claimVersion: 0,
            },
            {
                id: "v2",
                symbol: "Q",
                argumentId: "arg-1",
                argumentVersion: 1,
                claimId: "claim-default",
                claimVersion: 0,
            },
        ]
        const premises: TOptionalChecksum<TCorePremise>[] = [
            {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 1,
                type: "freeform" as const,
            },
            {
                id: "p2",
                argumentId: "arg-1",
                argumentVersion: 1,
                type: "freeform" as const,
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
            aLib(),
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
            aLib(),
            [],
            [
                {
                    id: "p1",
                    argumentId: "arg-1",
                    argumentVersion: 1,
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
                claimId: "claim-default",
                claimVersion: 0,
            },
        ]
        const premises: TOptionalChecksum<TCorePremise>[] = [
            {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 1,
                type: "freeform" as const,
            },
            {
                id: "p2",
                argumentId: "arg-1",
                argumentVersion: 1,
                type: "freeform" as const,
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
            aLib(),
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
                claimId: "claim-default",
                claimVersion: 0,
            },
            {
                id: "v2",
                symbol: "Q",
                argumentId: "arg-1",
                argumentVersion: 1,
                claimId: "claim-default",
                claimVersion: 0,
            },
        ]
        const premises: TOptionalChecksum<TCorePremise>[] = [
            {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 1,
                type: "freeform" as const,
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
            aLib(),
            variables,
            premises,
            expressions,
            {}
        )
        expect(engine.getPremise("p1")?.getExpressions().length).toBe(3)
    })

    it("infers generic types from parameters", () => {
        type TMyArg = TCoreArgument & { customField: string }
        const arg: TMyArg = {
            id: "arg-1",
            version: 1,
            checksum: "x",
            descendantChecksum: null,
            combinedChecksum: "x",
            customField: "hello",
        }
        const engine = ArgumentEngine.fromData<TMyArg>(
            arg,
            aLib(),
            [],
            [],
            [],
            {}
        )
        const result = engine.getArgument()
        expect(result.customField).toBe("hello")
    })
})

describe("ArgumentEngine — toDisplayString", () => {
    const ARG = { id: "arg-1", version: 1 }

    it("renders an empty argument", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const display = eng.toDisplayString()
        expect(display).toContain("Argument: arg-1 (v1)")
    })

    it("labels conclusion premise", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
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
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
        })
        eng.addVariable({
            id: "v2",
            symbol: "Q",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
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
        claimId: "claim-default",
        claimVersion: 0,
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
        claimId: "claim-default",
        claimVersion: 0,
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
                type: "freeform" as const,
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
                type: "freeform" as const,
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
                type: "freeform" as const,
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
                type: "freeform" as const,
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
                type: "freeform" as const,
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
                type: "freeform" as const,
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
                type: "freeform" as const,
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
                type: "freeform" as const,
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
        const engine = new ArgumentEngine(arg, aLib())
        engine.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        })
        engine.addVariable({
            id: "v2",
            symbol: "Q",
            argumentId: "arg-1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
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
            expect(bySymbol.size).toBe(4) // 2 claim-bound + 2 auto premise-bound
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
            const restored = ArgumentEngine.fromSnapshot(snap, aLib())
            expect(restored.getExpression("e1")?.id).toBe("e1")
            expect(restored.getExpressionPremiseId("e3")).toBe("p2")
        })

        it("survives fromData round-trip", () => {
            const { engine } = setupEngine()
            const vars = engine.getVariables()
            const premises = engine
                .listPremises()
                .map((pe) => pe.toPremiseData())
            const expressions = engine.getAllExpressions()
            const roles = engine.getRoleState()
            const restored = ArgumentEngine.fromData(
                engine.getArgument(),
                aLib(),
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

// ---------------------------------------------------------------------------
// PremiseEngine onMutate callback
// ---------------------------------------------------------------------------

describe("PremiseEngine onMutate callback", () => {
    it("fires onMutate when addExpression is called", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable(VAR_P)
        const { result: premise } = engine.createPremise()
        let callCount = 0
        premise.setOnMutate(() => {
            callCount++
        })
        premise.addExpression(
            makeOpExpr("op-1", "and", { premiseId: premise.getId() })
        )
        expect(callCount).toBe(1)
    })

    it("fires onMutate when removeExpression is called", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable(VAR_P)
        const { result: premise } = engine.createPremise()
        premise.addExpression(
            makeOpExpr("op-1", "and", { premiseId: premise.getId() })
        )
        let callCount = 0
        premise.setOnMutate(() => {
            callCount++
        })
        premise.removeExpression("op-1", true)
        expect(callCount).toBe(1)
    })

    it("fires onMutate when updateExpression is called", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable(VAR_P)
        const { result: premise } = engine.createPremise()
        premise.addExpression(
            makeOpExpr("op-1", "and", { premiseId: premise.getId() })
        )
        let callCount = 0
        premise.setOnMutate(() => {
            callCount++
        })
        premise.updateExpression("op-1", { operator: "or" })
        expect(callCount).toBe(1)
    })

    it("fires onMutate when appendExpression is called", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable(VAR_P)
        const { result: premise } = engine.createPremise()
        let callCount = 0
        premise.setOnMutate(() => {
            callCount++
        })
        premise.appendExpression(null, {
            id: "op-1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: premise.getId(),
            type: "operator",
            operator: "and",
        } as TExpressionWithoutPosition)
        expect(callCount).toBe(1)
    })

    it("fires onMutate when insertExpression is called", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable(VAR_P)
        engine.addVariable(VAR_Q)
        const { result: premise } = engine.createPremise()
        const pid = premise.getId()
        // Build: root "and" with two variable children
        premise.addExpression(makeOpExpr("op-root", "and", { premiseId: pid }))
        premise.appendExpression("op-root", {
            id: "var-p",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: pid,
            type: "variable",
            variableId: VAR_P.id,
        } as TExpressionWithoutPosition)
        premise.appendExpression("op-root", {
            id: "var-q",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: pid,
            type: "variable",
            variableId: VAR_Q.id,
        } as TExpressionWithoutPosition)
        let callCount = 0
        premise.setOnMutate(() => {
            callCount++
        })
        // Insert a "not" wrapping var-p — not is exempt from the nesting restriction
        premise.insertExpression(
            makeOpExpr("op-not", "not", { premiseId: pid }),
            "var-p"
        )
        expect(callCount).toBe(1)
    })

    it("does not fire onMutate when deleteExpressionsUsingVariable finds nothing", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable(VAR_P)
        const { result: premise } = engine.createPremise()
        let callCount = 0
        premise.setOnMutate(() => {
            callCount++
        })
        premise.deleteExpressionsUsingVariable("nonexistent")
        expect(callCount).toBe(0)
    })
})

describe("ArgumentEngine subscribe", () => {
    it("notifies subscriber when a premise is created", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        let notified = false
        engine.subscribe(() => {
            notified = true
        })
        engine.createPremise()
        expect(notified).toBe(true)
    })

    it("notifies subscriber when a premise is removed", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        const { result: premise } = engine.createPremise()
        let notified = false
        engine.subscribe(() => {
            notified = true
        })
        engine.removePremise(premise.getId())
        expect(notified).toBe(true)
    })

    it("notifies subscriber when a variable is added", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        let notified = false
        engine.subscribe(() => {
            notified = true
        })
        engine.addVariable({
            id: "v1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            claimId: "claim-default",
            claimVersion: 0,
            symbol: "P",
        })
        expect(notified).toBe(true)
    })

    it("notifies subscriber when a variable is updated", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable({
            id: "v1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            claimId: "claim-default",
            claimVersion: 0,
            symbol: "P",
        })
        let notified = false
        engine.subscribe(() => {
            notified = true
        })
        engine.updateVariable("v1", { symbol: "Q" })
        expect(notified).toBe(true)
    })

    it("notifies subscriber when a variable is removed", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable({
            id: "v1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            claimId: "claim-default",
            claimVersion: 0,
            symbol: "P",
        })
        let notified = false
        engine.subscribe(() => {
            notified = true
        })
        engine.removeVariable("v1")
        expect(notified).toBe(true)
    })

    it("notifies subscriber when conclusion is set", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        const { result: premise } = engine.createPremise()
        engine.clearConclusionPremise()
        let notified = false
        engine.subscribe(() => {
            notified = true
        })
        engine.setConclusionPremise(premise.getId())
        expect(notified).toBe(true)
    })

    it("notifies subscriber when conclusion is cleared", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.createPremise()
        let notified = false
        engine.subscribe(() => {
            notified = true
        })
        engine.clearConclusionPremise()
        expect(notified).toBe(true)
    })

    it("notifies subscriber on rollback", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        const snap = engine.snapshot()
        engine.createPremise()
        let notified = false
        engine.subscribe(() => {
            notified = true
        })
        engine.rollback(snap)
        expect(notified).toBe(true)
    })

    it("unsubscribe stops notifications", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        let count = 0
        const unsub = engine.subscribe(() => {
            count++
        })
        engine.createPremise()
        expect(count).toBe(1)
        unsub()
        engine.createPremise()
        expect(count).toBe(1)
    })

    it("notifies subscriber when expression is mutated through PremiseEngine", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        const { result: premise } = engine.createPremise()
        let count = 0
        engine.subscribe(() => {
            count++
        })

        premise.addExpression({
            id: "expr-1",
            type: "operator",
            operator: "and",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: premise.getId(),
            parentId: null,
            position: 0,
        })

        expect(count).toBeGreaterThanOrEqual(1)
    })

    it("does not notify when removePremise finds nothing", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        let notified = false
        engine.subscribe(() => {
            notified = true
        })
        engine.removePremise("nonexistent")
        expect(notified).toBe(false)
    })

    it("does not notify when removeVariable finds nothing", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        let notified = false
        engine.subscribe(() => {
            notified = true
        })
        engine.removeVariable("nonexistent")
        expect(notified).toBe(false)
    })
})

describe("ArgumentEngine getSnapshot", () => {
    it("returns a snapshot with argument, variables, premises, and roles", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable({
            id: "v1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            claimId: "claim-default",
            claimVersion: 0,
            symbol: "P",
        })
        const { result: premise } = engine.createPremise()
        premise.addExpression({
            id: "expr-1",
            type: "operator",
            operator: "and",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: premise.getId(),
            parentId: null,
            position: 0,
        })

        const snap = engine.getSnapshot()

        expect(snap.argument.id).toBe(ARG.id)
        expect(snap.variables.v1).toBeDefined()
        expect(snap.variables.v1.symbol).toBe("P")
        expect(snap.premises[premise.getId()]).toBeDefined()
        expect(
            snap.premises[premise.getId()].expressions["expr-1"]
        ).toBeDefined()
        expect(snap.premises[premise.getId()].rootExpressionId).toBe("expr-1")
        expect(snap.roles).toBeDefined()
    })

    it("returns the same reference when nothing has changed", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.createPremise()
        const snap1 = engine.getSnapshot()
        const snap2 = engine.getSnapshot()
        expect(snap1).toBe(snap2)
    })

    it("returns a new top-level reference after a mutation", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        const snap1 = engine.getSnapshot()
        engine.createPremise()
        const snap2 = engine.getSnapshot()
        expect(snap1).not.toBe(snap2)
    })

    it("preserves premise reference when a different premise is mutated", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        const { result: premiseA } = engine.createPremiseWithId("pA")
        engine.createPremiseWithId("pB")
        const snap1 = engine.getSnapshot()

        premiseA.addExpression({
            id: "expr-1",
            type: "operator",
            operator: "and",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "pA",
            parentId: null,
            position: 0,
        })

        const snap2 = engine.getSnapshot()
        expect(snap2.premises.pA).not.toBe(snap1.premises.pA)
        expect(snap2.premises.pB).toBe(snap1.premises.pB)
    })

    it("returns new variables reference when a variable is added", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        const snap1 = engine.getSnapshot()
        engine.addVariable({
            id: "v1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            claimId: "claim-default",
            claimVersion: 0,
            symbol: "P",
        })
        const snap2 = engine.getSnapshot()
        expect(snap2.variables).not.toBe(snap1.variables)
    })

    it("preserves variables reference when only a premise is mutated", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        const { result: premise } = engine.createPremise()
        const snap1 = engine.getSnapshot()

        premise.addExpression({
            id: "expr-1",
            type: "operator",
            operator: "and",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: premise.getId(),
            parentId: null,
            position: 0,
        })

        const snap2 = engine.getSnapshot()
        expect(snap2.variables).toBe(snap1.variables)
    })

    it("returns new roles reference when conclusion changes", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        const { result: premise } = engine.createPremise()
        engine.clearConclusionPremise()
        const snap1 = engine.getSnapshot()
        engine.setConclusionPremise(premise.getId())
        const snap2 = engine.getSnapshot()
        expect(snap2.roles).not.toBe(snap1.roles)
    })

    it("preserves roles reference when only a variable changes", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.createPremise()
        const snap1 = engine.getSnapshot()
        engine.addVariable({
            id: "v1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            claimId: "claim-default",
            claimVersion: 0,
            symbol: "P",
        })
        const snap2 = engine.getSnapshot()
        expect(snap2.roles).toBe(snap1.roles)
    })

    it("rebuilds fully after rollback", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.createPremise()
        const engineSnap = engine.snapshot()
        const reactiveSnap1 = engine.getSnapshot()

        engine.createPremise()
        engine.rollback(engineSnap)

        const reactiveSnap2 = engine.getSnapshot()
        expect(reactiveSnap2).not.toBe(reactiveSnap1)
        expect(Object.keys(reactiveSnap2.premises).length).toBe(1)
    })
})

describe("ArgumentEngine reactive store integration", () => {
    it("works as a useSyncExternalStore-compatible store", () => {
        const engine = new ArgumentEngine(ARG, aLib())

        // Simulate useSyncExternalStore contract:
        // 1. subscribe returns unsubscribe
        // 2. getSnapshot returns stable reference when unchanged
        // 3. getSnapshot returns new reference when changed

        const snapshots: TReactiveSnapshot[] = []
        const unsub = engine.subscribe(() => {
            snapshots.push(engine.getSnapshot())
        })

        engine.getSnapshot()

        // Mutation 1: add variable
        engine.addVariable({
            id: "v1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            claimId: "claim-default",
            claimVersion: 0,
            symbol: "P",
        })

        // Mutation 2: create premise and add expression
        const { result: premise } = engine.createPremise()
        premise.appendExpression(null, {
            id: "expr-root",
            type: "variable",
            variableId: "v1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: premise.getId(),
            parentId: null,
        })

        // Should have been notified for each mutation
        expect(snapshots.length).toBeGreaterThanOrEqual(3)

        // Each snapshot should be a different reference
        for (let i = 1; i < snapshots.length; i++) {
            expect(snapshots[i]).not.toBe(snapshots[i - 1])
        }

        // Final snapshot should reflect current state
        const final = engine.getSnapshot()
        expect(final.variables.v1).toBeDefined()
        expect(Object.keys(final.premises).length).toBe(1)
        expect(
            final.premises[premise.getId()].expressions["expr-root"]
        ).toBeDefined()

        unsub()
    })
})

// ---------------------------------------------------------------------------
// wrapExpression
// ---------------------------------------------------------------------------

describe("wrapExpression", () => {
    // Helper: create a TExpressionWithoutPosition operator
    function wrapOp(
        id: string,
        operator: "not" | "and" | "or" | "implies" | "iff"
    ): TExpressionWithoutPosition {
        return {
            id,
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "operator",
            operator,
            parentId: null,
        }
    }

    // Helper: create a TExpressionWithoutPosition variable
    function wrapVar(
        id: string,
        variableId: string
    ): TExpressionWithoutPosition {
        return {
            id,
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "variable",
            variableId,
            parentId: null,
        }
    }

    // Helper: create a TExpressionWithoutPosition formula
    function wrapFormula(id: string): TExpressionWithoutPosition {
        return {
            id,
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "formula",
            parentId: null,
        }
    }

    // --- Happy paths ---

    it("wraps root variable with 'and' operator, existing as left child", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        pm.wrapExpression(
            wrapOp("op-and", "and"),
            wrapVar("expr-q", VAR_Q.id),
            "expr-p" // existing goes to position 0 (left)
        )
        // op-and → [expr-p(0), expr-q(1)]
        expect(pm.toDisplayString()).toBe("(P ∧ Q)")
    })

    it("wraps root variable with 'or' operator, existing as right child", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        pm.wrapExpression(
            wrapOp("op-or", "or"),
            wrapVar("expr-q", VAR_Q.id),
            undefined,
            "expr-p" // existing goes to position 1 (right)
        )
        // op-or → [expr-q(0), expr-p(1)]
        expect(pm.toDisplayString()).toBe("(Q ∨ P)")
    })

    it("wraps root variable with 'implies', existing as right (consequent)", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        pm.wrapExpression(
            wrapOp("op-implies", "implies"),
            wrapVar("expr-f", VAR_Q.id),
            undefined,
            "expr-p" // P becomes consequent (position 1)
        )
        // op-implies → [expr-f(0), expr-p(1)] → "Q → P"
        expect(pm.toDisplayString()).toBe("(Q → P)")
    })

    it("wraps root variable with 'iff'", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        pm.wrapExpression(
            wrapOp("op-iff", "iff"),
            wrapVar("expr-q", VAR_Q.id),
            "expr-p" // existing as left
        )
        expect(pm.toDisplayString()).toBe("(P ↔ Q)")
    })

    it("wraps non-root node (child of a formula)", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeFormulaExpr("formula-1"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "formula-1",
                position: 0,
            })
        )
        // Wrap expr-p with an 'or' and a new sibling R
        pm.wrapExpression(
            wrapOp("op-or", "or"),
            wrapVar("expr-r", VAR_R.id),
            "expr-p" // P goes left under op-or
        )
        // formula-1 → op-or(0) → [expr-p(0), expr-r(1)]
        expect(pm.toDisplayString()).toBe("((P ∨ R))")
    })

    it("new sibling can be a not operator expression", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        // Wrap P with 'and', sibling is a 'not' operator (exempt from nesting restriction)
        pm.wrapExpression(
            wrapOp("op-and", "and"),
            wrapOp("op-not", "not"),
            "expr-p" // P is left
        )
        // Now add a variable inside the 'not' operator
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-not", position: 0 })
        )
        // op-and → [P(0), not(1) → [Q(0)]]
        expect(pm.toDisplayString()).toBe("(P ∧ ¬(Q))")
    })

    it("new sibling can be a formula expression", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        pm.wrapExpression(wrapOp("op-and", "and"), wrapFormula("f1"), "expr-p")
        // Add a variable inside the formula
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "f1", position: 0 })
        )
        // op-and → [expr-p(0), f1(1) → [expr-q(0)]]
        expect(pm.toDisplayString()).toBe("(P ∧ (Q))")
    })

    it("returns the stored operator as result", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        const { result } = pm.wrapExpression(
            wrapOp("op-and", "and"),
            wrapVar("expr-q", VAR_Q.id),
            "expr-p"
        )
        expect(result.id).toBe("op-and")
        expect(result.type).toBe("operator")
        expect(result.parentId).toBeNull()
        expect(result.position).toBe(POSITION_INITIAL)
    })

    it("updates rootExpressionId when wrapping a root node", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(pm.getRootExpressionId()).toBe("expr-p")
        pm.wrapExpression(
            wrapOp("op-and", "and"),
            wrapVar("expr-q", VAR_Q.id),
            "expr-p"
        )
        expect(pm.getRootExpressionId()).toBe("op-and")
    })

    // --- Changeset correctness ---

    it("changeset contains added operator, added sibling, and modified existing node", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        const { changes } = pm.wrapExpression(
            wrapOp("op-and", "and"),
            wrapVar("expr-q", VAR_Q.id),
            "expr-p"
        )
        const added = changes.expressions?.added ?? []
        const modified = changes.expressions?.modified ?? []
        expect(added.map((e) => e.id).sort()).toEqual(["expr-q", "op-and"])
        expect(modified.map((e) => e.id)).toEqual(["expr-p"])
    })

    // --- Validation errors ---

    it("throws when neither leftNodeId nor rightNodeId is provided", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            pm.wrapExpression(
                wrapOp("op-and", "and"),
                wrapVar("expr-q", VAR_Q.id)
            )
        ).toThrowError(/exactly one/)
    })

    it("throws when both leftNodeId and rightNodeId are provided", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-or", "or"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-or", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-or", position: 1 })
        )
        expect(() =>
            pm.wrapExpression(
                wrapOp("op-and", "and"),
                wrapVar("expr-r", VAR_R.id),
                "expr-p",
                "expr-q"
            )
        ).toThrowError(/exactly one.*not both/)
    })

    it("throws when operator expression ID already exists", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            pm.wrapExpression(
                wrapOp("expr-p", "and"), // same ID as existing
                wrapVar("expr-q", VAR_Q.id),
                "expr-p"
            )
        ).toThrowError(/already exists/)
    })

    it("throws when sibling expression ID already exists", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            pm.wrapExpression(
                wrapOp("op-and", "and"),
                wrapVar("expr-p", VAR_Q.id), // same ID as existing
                "expr-p"
            )
        ).toThrowError(/already exists/)
    })

    it("throws when operator and sibling IDs are the same", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            pm.wrapExpression(
                wrapOp("same-id", "and"),
                wrapVar("same-id", VAR_Q.id),
                "expr-p"
            )
        ).toThrowError(/must be different/)
    })

    it("throws when existing node does not exist", () => {
        const pm = premiseWithVars()
        expect(() =>
            pm.wrapExpression(
                wrapOp("op-and", "and"),
                wrapVar("expr-q", VAR_Q.id),
                "nonexistent"
            )
        ).toThrowError(/does not exist/)
    })

    it("throws when operator is 'not' (unary)", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            pm.wrapExpression(
                wrapOp("op-not", "not"),
                wrapVar("expr-q", VAR_Q.id),
                "expr-p"
            )
        ).toThrowError(/unary/)
    })

    it("throws when operator type is not 'operator' (variable passed as operator)", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            pm.wrapExpression(
                wrapVar("bad-op", VAR_Q.id),
                wrapVar("expr-q", VAR_R.id),
                "expr-p"
            )
        ).toThrowError(/must have type "operator"/)
    })

    it("throws when operator type is not 'operator' (formula passed as operator)", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            pm.wrapExpression(
                wrapFormula("bad-op"),
                wrapVar("expr-q", VAR_Q.id),
                "expr-p"
            )
        ).toThrowError(/must have type "operator"/)
    })

    it("throws when implies operator wraps a non-root node", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-and", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-and", position: 1 })
        )
        expect(() =>
            pm.wrapExpression(
                wrapOp("op-implies", "implies"),
                wrapVar("expr-r", VAR_R.id),
                "expr-p" // expr-p is not a root
            )
        ).toThrowError(/must be a root expression/)
    })

    it("throws when iff operator wraps a non-root node", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-and", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-and", position: 1 })
        )
        expect(() =>
            pm.wrapExpression(
                wrapOp("op-iff", "iff"),
                wrapVar("expr-r", VAR_R.id),
                "expr-p"
            )
        ).toThrowError(/must be a root expression/)
    })

    it("throws when existing node is an implies operator (cannot be subordinated)", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-implies", "implies"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-implies",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-implies",
                position: 1,
            })
        )
        expect(() =>
            pm.wrapExpression(
                wrapOp("op-and", "and"),
                wrapVar("expr-r", VAR_R.id),
                "op-implies"
            )
        ).toThrowError(/cannot be subordinated/)
    })

    it("throws when existing node is an iff operator (cannot be subordinated)", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-iff", "iff"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-iff",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-iff",
                position: 1,
            })
        )
        expect(() =>
            pm.wrapExpression(
                wrapOp("op-and", "and"),
                wrapVar("expr-r", VAR_R.id),
                "op-iff"
            )
        ).toThrowError(/cannot be subordinated/)
    })

    it("throws when new sibling is an implies operator (cannot be subordinated)", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            pm.wrapExpression(
                wrapOp("op-and", "and"),
                wrapOp("op-implies", "implies"),
                "expr-p"
            )
        ).toThrowError(/cannot be subordinated/)
    })

    it("throws when new sibling is an iff operator (cannot be subordinated)", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            pm.wrapExpression(
                wrapOp("op-and", "and"),
                wrapOp("op-iff", "iff"),
                "expr-p"
            )
        ).toThrowError(/cannot be subordinated/)
    })

    it("throws when new sibling references a non-existent variable", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            pm.wrapExpression(
                wrapOp("op-and", "and"),
                wrapVar("expr-x", "nonexistent-var"),
                "expr-p"
            )
        ).toThrowError(/non-existent variable/)
    })

    // --- Integration ---

    it("wrap then evaluate produces correct truth table", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        // P is root. Wrap to get "Q → P" (Q implies P)
        pm.wrapExpression(
            wrapOp("op-implies", "implies"),
            wrapVar("expr-q", VAR_Q.id),
            undefined,
            "expr-p" // P is right (consequent)
        )
        // Q=true, P=false → false (only false case for implies)
        const result = pm.evaluate({
            variables: { [VAR_Q.id]: true, [VAR_P.id]: false },
            operatorAssignments: {},
        })
        expect(result.rootValue).toBe(false)
        // Q=false, P=false → true
        const result2 = pm.evaluate({
            variables: { [VAR_Q.id]: false, [VAR_P.id]: false },
            operatorAssignments: {},
        })
        expect(result2.rootValue).toBe(true)
    })

    it("wrap then remove operator triggers collapse", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        pm.wrapExpression(
            wrapOp("op-and", "and"),
            wrapVar("expr-q", VAR_Q.id),
            "expr-p"
        )
        expect(pm.toDisplayString()).toBe("(P ∧ Q)")
        // Remove one child — collapse should reduce the 'and' to just the surviving child
        pm.removeExpression("expr-q", true)
        // After removing Q, and-operator has 1 child (P) → collapses, P promoted to root
        expect(pm.toDisplayString()).toBe("P")
        expect(pm.getRootExpressionId()).toBe("expr-p")
    })

    it("children get midpoint-spaced positions, not consecutive integers", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        pm.wrapExpression(
            wrapOp("op-and", "and"),
            wrapVar("expr-q", VAR_Q.id),
            "expr-p" // existing as left child
        )
        const children = pm.getChildExpressions("op-and")
        const left = children.find((c) => c.id === "expr-p")!
        const right = children.find((c) => c.id === "expr-q")!

        // Left should be POSITION_INITIAL (0), right should be midpoint(0, POSITION_MAX)
        expect(left.position).toBe(POSITION_INITIAL)
        expect(right.position).toBe(midpoint(POSITION_INITIAL, POSITION_MAX))

        // The gap must support midpoint bisection (not consecutive integers)
        const gap = right.position - left.position
        expect(gap).toBeGreaterThan(1)
    })

    it("midpoint-spaced positions work for existing as right child", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        pm.wrapExpression(
            wrapOp("op-or", "or"),
            wrapVar("expr-q", VAR_Q.id),
            undefined,
            "expr-p" // existing as right child
        )
        const children = pm.getChildExpressions("op-or")
        const left = children.find((c) => c.id === "expr-q")!
        const right = children.find((c) => c.id === "expr-p")!

        // When existing is right: sibling gets POSITION_INITIAL, existing gets midpoint
        expect(left.position).toBe(POSITION_INITIAL)
        expect(right.position).toBe(midpoint(POSITION_INITIAL, POSITION_MAX))
    })
})

// ---------------------------------------------------------------------------
// toggleNegation
// ---------------------------------------------------------------------------
describe("toggleNegation", () => {
    it("wraps a root variable expression with NOT", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeVarExpr("expr-p", VAR_P.id))

        const { result } = premise.toggleNegation("expr-p")

        expect(result).not.toBeNull()
        expect(result!.type).toBe("operator")
        if (result!.type === "operator") expect(result!.operator).toBe("not")
        expect(premise.getRootExpressionId()).toBe(result!.id)
        expect(premise.toDisplayString()).toBe("¬(P)")
    })

    it("unwraps a NOT around a variable expression, returning null", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeVarExpr("expr-p", VAR_P.id))
        premise.toggleNegation("expr-p")

        const { result } = premise.toggleNegation("expr-p")

        expect(result).toBeNull()
        expect(premise.getRootExpressionId()).toBe("expr-p")
        expect(premise.toDisplayString()).toBe("P")
    })

    it("wraps a non-root variable expression with NOT", () => {
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

        const { result } = premise.toggleNegation("expr-p")

        expect(result).not.toBeNull()
        if (result!.type === "operator") expect(result!.operator).toBe("not")
        expect(premise.getExpression(result!.id)!.parentId).toBe("op-and")
        expect(premise.getExpression("expr-p")!.parentId).toBe(result!.id)
        expect(premise.toDisplayString()).toBe("(¬(P) ∧ Q)")
    })

    it("unwraps NOT from a non-root expression", () => {
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
        premise.toggleNegation("expr-p")

        const { result } = premise.toggleNegation("expr-p")

        expect(result).toBeNull()
        expect(premise.getExpression("expr-p")!.parentId).toBe("op-and")
        expect(premise.toDisplayString()).toBe("(P ∧ Q)")
    })

    it("works on operator expressions", () => {
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

        const { result } = premise.toggleNegation("op-and")

        expect(result).not.toBeNull()
        if (result!.type === "operator") expect(result!.operator).toBe("not")
        // toggleNegation inserts not(formula(and(...))) for non-not operators
        expect(premise.toDisplayString()).toBe("¬(((P ∧ Q)))")
    })

    it("works on formula expressions", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeFormulaExpr("formula-1"))
        premise.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "formula-1" })
        )

        const { result } = premise.toggleNegation("formula-1")

        expect(result).not.toBeNull()
        if (result!.type === "operator") expect(result!.operator).toBe("not")
        expect(premise.toDisplayString()).toBe("¬((P))")
    })

    it("throws when expression does not exist", () => {
        const premise = premiseWithVars()

        expect(() => premise.toggleNegation("nonexistent")).toThrow(
            /Expression .* not found/
        )
    })

    it("toggle twice returns to original structure", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeVarExpr("expr-p", VAR_P.id))
        const originalDisplay = premise.toDisplayString()

        premise.toggleNegation("expr-p")
        premise.toggleNegation("expr-p")

        expect(premise.toDisplayString()).toBe(originalDisplay)
    })

    it("changeset includes created NOT expression when adding negation", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeVarExpr("expr-p", VAR_P.id))

        const { changes } = premise.toggleNegation("expr-p")

        expect(changes.expressions!.added).toHaveLength(1)
        const added = changes.expressions!.added[0]
        if (added.type === "operator") expect(added.operator).toBe("not")
        expect(added.type).toBe("operator")
        expect(changes.expressions!.modified.length).toBeGreaterThanOrEqual(1)
    })

    it("changeset includes removed NOT expression when removing negation", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeVarExpr("expr-p", VAR_P.id))
        premise.toggleNegation("expr-p")

        const { changes } = premise.toggleNegation("expr-p")

        expect(changes.expressions!.removed).toHaveLength(1)
        const removed = changes.expressions!.removed[0]
        if (removed.type === "operator") expect(removed.operator).toBe("not")
        expect(removed.type).toBe("operator")
    })

    it("marks checksum dirty after toggle", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeVarExpr("expr-p", VAR_P.id))
        const checksumBefore = premise.combinedChecksum()

        premise.toggleNegation("expr-p")

        expect(premise.combinedChecksum()).not.toBe(checksumBefore)
    })
})

// ---------------------------------------------------------------------------
// ClaimCitationLibrary
// ---------------------------------------------------------------------------
describe("ClaimCitationLibrary", () => {
    function makeFixtures() {
        const claimLib = new ClaimLibrary()
        const claim1 = claimLib.create({ id: "claim-1", type: "normal" })
        const claim2 = claimLib.create({ id: "claim-2", type: "normal" })
        const source1 = claimLib.create({ id: "source-1", type: "citation" })
        const source2 = claimLib.create({ id: "source-2", type: "citation" })
        const lib = new ClaimCitationLibrary(claimLib)
        return { claimLib, claim1, claim2, source1, source2, lib }
    }

    describe("add", () => {
        it("adds a citation and returns it with a checksum", () => {
            const { lib, claim1, source1 } = makeFixtures()
            const cit = lib.add({
                id: "cit-1",
                claimId: claim1.id,
                claimVersion: claim1.version,
                supportingClaimId: source1.id,
                supportingClaimVersion: source1.version,
            })
            expect(cit.id).toBe("cit-1")
            expect(cit.claimId).toBe("claim-1")
            expect(cit.supportingClaimId).toBe("source-1")
            expect(cit.checksum).toBeTruthy()
            expect(typeof cit.checksum).toBe("string")
        })

        it("throws on duplicate citation ID", () => {
            const { lib, claim1, source1 } = makeFixtures()
            lib.add({
                id: "cit-1",
                claimId: claim1.id,
                claimVersion: claim1.version,
                supportingClaimId: source1.id,
                supportingClaimVersion: source1.version,
            })
            expect(() =>
                lib.add({
                    id: "cit-1",
                    claimId: claim1.id,
                    claimVersion: claim1.version,
                    supportingClaimId: source1.id,
                    supportingClaimVersion: source1.version,
                })
            ).toThrow()
        })

        it("throws when citing claim does not exist in the claim lookup", () => {
            const { lib, source1 } = makeFixtures()
            expect(() =>
                lib.add({
                    id: "cit-1",
                    claimId: "nonexistent-claim",
                    claimVersion: 0,
                    supportingClaimId: source1.id,
                    supportingClaimVersion: source1.version,
                })
            ).toThrow()
        })

        it("throws when citing claim version does not exist", () => {
            const { lib, claim1, source1 } = makeFixtures()
            expect(() =>
                lib.add({
                    id: "cit-1",
                    claimId: claim1.id,
                    claimVersion: 999,
                    supportingClaimId: source1.id,
                    supportingClaimVersion: source1.version,
                })
            ).toThrow()
        })

        it("throws when source claim does not exist in the claim lookup", () => {
            const { lib, claim1 } = makeFixtures()
            expect(() =>
                lib.add({
                    id: "cit-1",
                    claimId: claim1.id,
                    claimVersion: claim1.version,
                    supportingClaimId: "nonexistent-source",
                    supportingClaimVersion: 0,
                })
            ).toThrow()
        })

        it("throws when source claim version does not exist", () => {
            const { lib, claim1, source1 } = makeFixtures()
            expect(() =>
                lib.add({
                    id: "cit-1",
                    claimId: claim1.id,
                    claimVersion: claim1.version,
                    supportingClaimId: source1.id,
                    supportingClaimVersion: 999,
                })
            ).toThrow()
        })
    })

    describe("remove", () => {
        it("removes a citation and returns it", () => {
            const { lib, claim1, source1 } = makeFixtures()
            const added = lib.add({
                id: "cit-1",
                claimId: claim1.id,
                claimVersion: claim1.version,
                supportingClaimId: source1.id,
                supportingClaimVersion: source1.version,
            })
            const removed = lib.remove("cit-1")
            expect(removed).toEqual(added)
            expect(lib.get("cit-1")).toBeUndefined()
        })

        it("throws when citation is not found", () => {
            const { lib } = makeFixtures()
            expect(() => lib.remove("nonexistent")).toThrow()
        })

        it("cleans up citing-claim index on remove", () => {
            const { lib, claim1, source1 } = makeFixtures()
            lib.add({
                id: "cit-1",
                claimId: claim1.id,
                claimVersion: claim1.version,
                supportingClaimId: source1.id,
                supportingClaimVersion: source1.version,
            })
            lib.remove("cit-1")
            expect(lib.getConnectionsForClaim(claim1.id)).toEqual([])
        })

        it("throws InvariantViolationError with code CITATION_NOT_FOUND when removing a missing id", () => {
            const { lib } = makeFixtures()
            let caught: unknown
            try {
                lib.remove("does-not-exist")
            } catch (e) {
                caught = e
            }
            expect(caught).toBeInstanceOf(InvariantViolationError)
            const err = caught as InvariantViolationError
            expect(err.violations[0].code).toBe(CITATION_NOT_FOUND)
        })
    })

    describe("getConnectionsForClaim", () => {
        it("returns all citations for a given citing-claim ID", () => {
            const { lib, claim1, claim2, source1, source2 } = makeFixtures()
            lib.add({
                id: "cit-1",
                claimId: claim1.id,
                claimVersion: claim1.version,
                supportingClaimId: source1.id,
                supportingClaimVersion: source1.version,
            })
            lib.add({
                id: "cit-2",
                claimId: claim1.id,
                claimVersion: claim1.version,
                supportingClaimId: source2.id,
                supportingClaimVersion: source2.version,
            })
            lib.add({
                id: "cit-3",
                claimId: claim2.id,
                claimVersion: claim2.version,
                supportingClaimId: source1.id,
                supportingClaimVersion: source1.version,
            })
            const result = lib.getConnectionsForClaim(claim1.id)
            expect(result).toHaveLength(2)
            expect(result.map((a) => a.id)).toContain("cit-1")
            expect(result.map((a) => a.id)).toContain("cit-2")
        })

        it("returns empty array when no citations exist for the citing claim", () => {
            const { lib, claim1 } = makeFixtures()
            expect(lib.getConnectionsForClaim(claim1.id)).toEqual([])
        })
    })

    describe("get", () => {
        it("returns the citation by ID", () => {
            const { lib, claim1, source1 } = makeFixtures()
            lib.add({
                id: "cit-1",
                claimId: claim1.id,
                claimVersion: claim1.version,
                supportingClaimId: source1.id,
                supportingClaimVersion: source1.version,
            })
            const result = lib.get("cit-1")
            expect(result).toBeDefined()
            expect(result!.id).toBe("cit-1")
        })

        it("returns undefined for unknown ID", () => {
            const { lib } = makeFixtures()
            expect(lib.get("nonexistent")).toBeUndefined()
        })
    })

    describe("getAll", () => {
        it("returns all citations", () => {
            const { lib, claim1, claim2, source1, source2 } = makeFixtures()
            lib.add({
                id: "cit-1",
                claimId: claim1.id,
                claimVersion: claim1.version,
                supportingClaimId: source1.id,
                supportingClaimVersion: source1.version,
            })
            lib.add({
                id: "cit-2",
                claimId: claim2.id,
                claimVersion: claim2.version,
                supportingClaimId: source2.id,
                supportingClaimVersion: source2.version,
            })
            expect(lib.getAll()).toHaveLength(2)
        })

        it("returns empty array when no citations exist", () => {
            const { lib } = makeFixtures()
            expect(lib.getAll()).toEqual([])
        })
    })

    describe("filter", () => {
        it("filters citations by predicate", () => {
            const { lib, claim1, claim2, source1, source2 } = makeFixtures()
            lib.add({
                id: "cit-1",
                claimId: claim1.id,
                claimVersion: claim1.version,
                supportingClaimId: source1.id,
                supportingClaimVersion: source1.version,
            })
            lib.add({
                id: "cit-2",
                claimId: claim2.id,
                claimVersion: claim2.version,
                supportingClaimId: source2.id,
                supportingClaimVersion: source2.version,
            })
            const result = lib.filter((a) => a.claimId === claim1.id)
            expect(result).toHaveLength(1)
            expect(result[0].id).toBe("cit-1")
        })

        it("returns empty array when predicate matches nothing", () => {
            const { lib, claim1, source1 } = makeFixtures()
            lib.add({
                id: "cit-1",
                claimId: claim1.id,
                claimVersion: claim1.version,
                supportingClaimId: source1.id,
                supportingClaimVersion: source1.version,
            })
            expect(lib.filter(() => false)).toEqual([])
        })
    })

    describe("snapshot / fromSnapshot", () => {
        it("round-trips through snapshot and fromSnapshot", () => {
            const { lib, claimLib, claim1, claim2, source1, source2 } =
                makeFixtures()
            lib.add({
                id: "cit-1",
                claimId: claim1.id,
                claimVersion: claim1.version,
                supportingClaimId: source1.id,
                supportingClaimVersion: source1.version,
            })
            lib.add({
                id: "cit-2",
                claimId: claim2.id,
                claimVersion: claim2.version,
                supportingClaimId: source2.id,
                supportingClaimVersion: source2.version,
            })
            const snap = lib.snapshot()
            expect(snap.connections).toHaveLength(2)

            const restored = ClaimCitationLibrary.fromSnapshot(snap, claimLib)
            expect(restored.getAll()).toHaveLength(2)
            expect(restored.get("cit-1")).toEqual(lib.get("cit-1"))
            expect(restored.get("cit-2")).toEqual(lib.get("cit-2"))
        })

        it("restores citing- and supporting-claim indexes correctly", () => {
            const { lib, claimLib, claim1, source1 } = makeFixtures()
            lib.add({
                id: "cit-1",
                claimId: claim1.id,
                claimVersion: claim1.version,
                supportingClaimId: source1.id,
                supportingClaimVersion: source1.version,
            })
            const snap = lib.snapshot()
            const restored = ClaimCitationLibrary.fromSnapshot(snap, claimLib)
            expect(restored.getConnectionsForClaim(claim1.id)).toHaveLength(1)
            expect(
                restored
                    .getAll()
                    .filter((c) => c.supportingClaimId === source1.id)
            ).toHaveLength(1)
        })

        it("snapshot of empty library returns empty array", () => {
            const { lib } = makeFixtures()
            expect(lib.snapshot()).toEqual({ connections: [] })
        })
    })

    describe("generic TCitation extension", () => {
        it("preserves extended fields through add, get, and snapshot", () => {
            const claimLib = new ClaimLibrary()
            const claim = claimLib.create({
                id: "claim-ext",
                type: "normal",
            })
            const source = claimLib.create({
                id: "source-ext",
                type: "citation",
            })

            type TExtCitation = {
                id: string
                claimId: string
                claimVersion: number
                supportingClaimId: string
                supportingClaimVersion: number
                checksum: string
                createdBy: string
            }

            const lib = new ClaimCitationLibrary<TExtCitation>(claimLib)
            const cit = lib.add({
                id: "cit-ext",
                claimId: claim.id,
                claimVersion: claim.version,
                supportingClaimId: source.id,
                supportingClaimVersion: source.version,
                createdBy: "user-1",
            })
            expect(cit.createdBy).toBe("user-1")

            const fetched = lib.get("cit-ext")
            expect(fetched?.createdBy).toBe("user-1")

            const snap = lib.snapshot()
            expect(snap.connections[0].createdBy).toBe("user-1")

            const restored = ClaimCitationLibrary.fromSnapshot<TExtCitation>(
                snap,
                claimLib
            )
            expect(restored.get("cit-ext")?.createdBy).toBe("user-1")
        })

        it("filter works on extended fields", () => {
            const claimLib = new ClaimLibrary()
            const claim = claimLib.create({
                id: "claim-ext2",
                type: "normal",
            })
            const source1 = claimLib.create({
                id: "source-ext2a",
                type: "citation",
            })
            const source2 = claimLib.create({
                id: "source-ext2b",
                type: "citation",
            })

            type TExtCitation = {
                id: string
                claimId: string
                claimVersion: number
                supportingClaimId: string
                supportingClaimVersion: number
                checksum: string
                tag: string
            }

            const lib = new ClaimCitationLibrary<TExtCitation>(claimLib)
            lib.add({
                id: "cit-ext-a",
                claimId: claim.id,
                claimVersion: claim.version,
                supportingClaimId: source1.id,
                supportingClaimVersion: source1.version,
                tag: "alpha",
            })
            lib.add({
                id: "cit-ext-b",
                claimId: claim.id,
                claimVersion: claim.version,
                supportingClaimId: source2.id,
                supportingClaimVersion: source2.version,
                tag: "beta",
            })
            const result = lib.filter((a) => a.tag === "alpha")
            expect(result).toHaveLength(1)
            expect(result[0].id).toBe("cit-ext-a")
        })
    })
})

// ---------------------------------------------------------------------------
// Premise-variable associations — type guards
// ---------------------------------------------------------------------------

describe("Premise-variable associations — type guards", () => {
    it("isClaimBound returns true for claim-bound variable", () => {
        const v: TCorePropositionalVariable = {
            id: "v1",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "P",
            claimId: "c1",
            claimVersion: 0,
            checksum: "",
        }
        expect(isClaimBound(v)).toBe(true)
        expect(isPremiseBound(v)).toBe(false)
    })
    it("isPremiseBound returns true for premise-bound variable", () => {
        const v: TCorePropositionalVariable = {
            id: "v2",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
            checksum: "",
        }
        expect(isPremiseBound(v)).toBe(true)
        expect(isClaimBound(v)).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// Premise-variable associations — VariableManager.updateVariable generalized
// ---------------------------------------------------------------------------

describe("Premise-variable associations — VariableManager.updateVariable generalized", () => {
    it("applies non-symbol fields via VariableManager directly", () => {
        const vm = new VariableManager<TCorePropositionalVariable>()
        vm.addVariable({
            id: "v1",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "P",
            claimId: "c1",
            claimVersion: 0,
            checksum: "",
        })
        const updated = vm.updateVariable("v1", {
            claimId: "c2",
        } as Partial<TCorePropositionalVariable>)
        expect(updated).toBeDefined()
        expect((updated as TClaimBoundVariable).claimId).toBe("c2")
    })
    it("applies non-symbol fields through ArgumentEngine", () => {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1", type: "normal" })
        claimLibrary.create({ id: "c2", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary
        )
        engine.addVariable({
            id: "v1",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "P",
            claimId: "c1",
            claimVersion: 0,
        })
        const result = engine.updateVariable("v1", {
            claimId: "c2",
            claimVersion: 0,
        })
        expect(result).toBeDefined()
        const updated = engine.getVariable("v1")! as TClaimBoundVariable
        expect(updated.claimId).toBe("c2")
    })
})

// ---------------------------------------------------------------------------
// Premise-variable associations — addVariable type guard
// ---------------------------------------------------------------------------

describe("Premise-variable associations — addVariable type guard", () => {
    it("rejects premise-bound variable passed to addVariable", () => {
        const claimLibrary = new ClaimLibrary()
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary
        )
        engine.createPremiseWithId("p1")
        expect(() =>
            engine.addVariable({
                id: "v1",
                argumentId: "a1",
                argumentVersion: 0,
                symbol: "Q",
                boundPremiseId: "p1",
                boundArgumentId: "a1",
                boundArgumentVersion: 0,
            } as unknown as TOptionalChecksum<TClaimBoundVariable>)
        ).toThrow(/claim-bound/)
    })
})

// ---------------------------------------------------------------------------
// Premise-variable associations — bindVariableToPremise
// ---------------------------------------------------------------------------

describe("Premise-variable associations — bindVariableToPremise", () => {
    function makeEngine() {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary
        )
        engine.createPremiseWithId("p1")
        engine.createPremiseWithId("p2")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        } as TClaimBoundVariable)
        return engine
    }

    it("creates a premise-bound variable", () => {
        const engine = makeEngine()
        const result = engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })
        expect(result).toBeDefined()
        const v = engine.getVariable("vQ")
        expect(v).toBeDefined()
        expect(isPremiseBound(v!)).toBe(true)
    })

    it("rejects binding to non-existent premise", () => {
        const engine = makeEngine()
        expect(() =>
            engine.bindVariableToPremise({
                id: "vQ",
                argumentId: "a1",
                argumentVersion: 0,
                symbol: "Q",
                boundPremiseId: "nonexistent",
                boundArgumentId: "a1",
                boundArgumentVersion: 0,
            })
        ).toThrow()
    })

    it("rejects duplicate symbol", () => {
        const engine = makeEngine()
        expect(() =>
            engine.bindVariableToPremise({
                id: "vQ",
                argumentId: "a1",
                argumentVersion: 0,
                symbol: "A",
                boundPremiseId: "p1",
                boundArgumentId: "a1",
                boundArgumentVersion: 0,
            })
        ).toThrow()
    })

    it("rejects cross-argument binding", () => {
        const engine = makeEngine()
        expect(() =>
            engine.bindVariableToPremise({
                id: "vQ",
                argumentId: "a1",
                argumentVersion: 0,
                symbol: "Q",
                boundPremiseId: "p1",
                boundArgumentId: "other-arg",
                boundArgumentVersion: 0,
            })
        ).toThrow()
    })

    it("allows multiple variables bound to same premise", () => {
        const engine = makeEngine()
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })
        engine.bindVariableToPremise({
            id: "vR",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "R",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })
        expect(engine.getVariable("vQ")).toBeDefined()
        expect(engine.getVariable("vR")).toBeDefined()
    })
})

// ---------------------------------------------------------------------------
// Premise-variable associations — getVariablesBoundToPremise
// ---------------------------------------------------------------------------

describe("Premise-variable associations — getVariablesBoundToPremise", () => {
    it("returns variables bound to a specific premise", () => {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary
        )
        engine.createPremiseWithId("p1")
        engine.createPremiseWithId("p2")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })
        engine.bindVariableToPremise({
            id: "vR",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "R",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })

        const bound = engine.getVariablesBoundToPremise("p1")
        expect(bound).toHaveLength(3) // auto-P0 + vQ + vR
        expect(bound.map((v) => v.id).sort()).toContain("vQ")
        expect(bound.map((v) => v.id).sort()).toContain("vR")
        expect(engine.getVariablesBoundToPremise("p2")).toHaveLength(1) // auto-P1
    })
})

// ---------------------------------------------------------------------------
// Premise-variable associations — removePremise cascade
// ---------------------------------------------------------------------------

describe("Premise-variable associations — removePremise cascade", () => {
    it("removes bound variables when their target premise is removed", () => {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary
        )
        engine.createPremiseWithId("p1")
        engine.createPremiseWithId("p2")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })

        // Add Q to premise 2's expression tree
        const p2 = engine.getPremise("p2")!
        p2.appendExpression(null, {
            id: "e1",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: null,
            type: "variable",
            variableId: "vQ",
        })

        // Remove p1 — should cascade: remove vQ, which cascades to remove e1 from p2
        engine.removePremise("p1")

        expect(engine.getVariable("vQ")).toBeUndefined()
        expect(p2.getExpressions()).toHaveLength(0)
        expect(engine.getVariable("vA")).toBeDefined()
    })
})

// ---------------------------------------------------------------------------
// Premise-variable associations — circularity prevention
// ---------------------------------------------------------------------------

describe("Premise-variable associations — circularity prevention", () => {
    function makeEngineWithBinding() {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary
        )
        engine.createPremiseWithId("p1")
        engine.createPremiseWithId("p2")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })
        return engine
    }

    it("rejects adding a variable expression to the premise it is bound to", () => {
        const engine = makeEngineWithBinding()
        const p1 = engine.getPremise("p1")!
        expect(() =>
            p1.appendExpression(null, {
                id: "e1",
                argumentId: "a1",
                argumentVersion: 0,
                premiseId: "p1",
                parentId: null,
                type: "variable",
                variableId: "vQ",
            })
        ).toThrow(/circular/i)
    })

    it("allows adding a variable expression to a different premise", () => {
        const engine = makeEngineWithBinding()
        const p2 = engine.getPremise("p2")!
        expect(() =>
            p2.appendExpression(null, {
                id: "e1",
                argumentId: "a1",
                argumentVersion: 0,
                premiseId: "p2",
                parentId: null,
                type: "variable",
                variableId: "vQ",
            })
        ).not.toThrow()
    })

    it("allows adding a claim-bound variable expression to any premise", () => {
        const engine = makeEngineWithBinding()
        const p1 = engine.getPremise("p1")!
        expect(() =>
            p1.appendExpression(null, {
                id: "e1",
                argumentId: "a1",
                argumentVersion: 0,
                premiseId: "p1",
                parentId: null,
                type: "variable",
                variableId: "vA",
            })
        ).not.toThrow()
    })
})

// ---------------------------------------------------------------------------
// Premise-variable associations — transitive circularity
// ---------------------------------------------------------------------------

describe("Premise-variable associations — transitive circularity", () => {
    it("rejects indirect cycles through binding chain", () => {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary
        )
        engine.createPremiseWithId("p1")
        engine.createPremiseWithId("p2")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        } as TClaimBoundVariable)

        // Q bound to p1, R bound to p2
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })
        engine.bindVariableToPremise({
            id: "vR",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "R",
            boundPremiseId: "p2",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })

        // Add R to p1's tree (R is bound to p2, this is fine)
        const p1 = engine.getPremise("p1")!
        p1.appendExpression(null, {
            id: "e1",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: null,
            type: "variable",
            variableId: "vR",
        })

        // Now try to add Q to p2 — Q bound to p1, which contains R, which is bound to p2
        // Transitive cycle: adding Q to p2 means p2 depends on Q → p1 → R → p2
        const p2 = engine.getPremise("p2")!
        expect(() =>
            p2.appendExpression(null, {
                id: "e2",
                argumentId: "a1",
                argumentVersion: 0,
                premiseId: "p2",
                parentId: null,
                type: "variable",
                variableId: "vQ",
            })
        ).toThrow(/circular/i)
    })
})

describe("Premise-variable associations — evaluation filtering", () => {
    it("excludes premise-bound variables from truth table columns", () => {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1", type: "normal" })
        claimLibrary.create({ id: "c2", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary
        )

        // Premise 1: A implies B (the sub-argument)
        engine.createPremiseWithId("p1")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.addVariable({
            id: "vB",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "B",
            claimId: "c2",
            claimVersion: 0,
        } as TClaimBoundVariable)
        const p1 = engine.getPremise("p1")!
        p1.addExpression({
            id: "op1",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: null,
            type: "operator",
            operator: "implies",
            position: 0,
        })
        p1.addExpression({
            id: "e1a",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: "op1",
            type: "variable",
            variableId: "vA",
            position: 0,
        })
        p1.addExpression({
            id: "e1b",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: "op1",
            type: "variable",
            variableId: "vB",
            position: 1,
        })

        // Premise 2: P implies Q, where Q is bound to p1
        engine.createPremiseWithId("p2")
        engine.addVariable({
            id: "vP",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "P",
            claimId: "c1",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })
        const p2 = engine.getPremise("p2")!
        p2.addExpression({
            id: "op2",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: null,
            type: "operator",
            operator: "implies",
            position: 0,
        })
        p2.addExpression({
            id: "e2a",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: "op2",
            type: "variable",
            variableId: "vP",
            position: 0,
        })
        p2.addExpression({
            id: "e2b",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: "op2",
            type: "variable",
            variableId: "vQ",
            position: 1,
        })

        engine.setConclusionPremise("p2")

        // checkValidity should only generate assignments for A, B, P (not Q)
        const result = engine.checkValidity()
        expect(result).toBeDefined()
        expect(result.ok).toBe(true)
        if (result.ok) {
            // 3 claim-bound variables → 2^3 = 8 assignments
            expect(result.numAssignmentsChecked).toBe(8)
        }
    })

    it("includes premise-bound variables in referencedVariableIds but not in assignment generation", () => {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary
        )

        engine.createPremiseWithId("p1")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        } as TClaimBoundVariable)
        const p1 = engine.getPremise("p1")!
        p1.appendExpression(null, {
            id: "e1",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: null,
            type: "variable",
            variableId: "vA",
        })

        engine.createPremiseWithId("p2")
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })
        const p2 = engine.getPremise("p2")!
        p2.appendExpression(null, {
            id: "e2",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: null,
            type: "variable",
            variableId: "vQ",
        })

        engine.setConclusionPremise("p2")

        // checkValidity should only assign A (not Q)
        const result = engine.checkValidity()
        expect(result.ok).toBe(true)
        if (result.ok) {
            // 1 claim-bound variable → 2^1 = 2 assignments
            expect(result.numAssignmentsChecked).toBe(2)
            // But both variables are referenced
            expect(result.checkedVariableIds).toContain("vA")
            // Q is not in checkedVariableIds since it's premise-bound
            expect(result.checkedVariableIds).not.toContain("vQ")
        }
    })
})

describe("Premise-variable associations — lazy evaluation", () => {
    function makeImplicationEngine() {
        // "P implies (A implies B)" via two premises:
        // Premise 1 (p1): A implies B
        // Premise 2 (p2): P implies Q, where Q bound to p1
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "cA", type: "normal" })
        claimLibrary.create({ id: "cB", type: "normal" })
        claimLibrary.create({ id: "cP", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary
        )

        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "cA",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.addVariable({
            id: "vB",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "B",
            claimId: "cB",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.addVariable({
            id: "vP",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "P",
            claimId: "cP",
            claimVersion: 0,
        } as TClaimBoundVariable)

        // Premise 1: A implies B
        engine.createPremiseWithId("p1")
        const p1 = engine.getPremise("p1")!
        p1.addExpression({
            id: "op1",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: null,
            type: "operator",
            operator: "implies",
            position: 0,
        })
        p1.addExpression({
            id: "e1a",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: "op1",
            type: "variable",
            variableId: "vA",
            position: 0,
        })
        p1.addExpression({
            id: "e1b",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: "op1",
            type: "variable",
            variableId: "vB",
            position: 1,
        })

        // Q bound to p1
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })

        // Premise 2: P implies Q (this is the conclusion)
        engine.createPremiseWithId("p2")
        const p2 = engine.getPremise("p2")!
        p2.addExpression({
            id: "op2",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: null,
            type: "operator",
            operator: "implies",
            position: 0,
        })
        p2.addExpression({
            id: "e2a",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: "op2",
            type: "variable",
            variableId: "vP",
            position: 0,
        })
        p2.addExpression({
            id: "e2b",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: "op2",
            type: "variable",
            variableId: "vQ",
            position: 1,
        })

        engine.setConclusionPremise("p2")
        return engine
    }

    it("evaluates premise-bound variable Q by resolving p1 tree", () => {
        const engine = makeImplicationEngine()
        // A=true, B=true, P=true → Q = (A implies B) = true → P implies Q = true
        const result = engine.evaluate({
            variables: { vA: true, vB: true, vP: true },
            operatorAssignments: {},
        })
        expect(result).toBeDefined()
        expect(result.ok).toBe(true)
        if (result.ok) {
            expect(result.conclusion!.rootValue).toBe(true)
        }
    })

    it("evaluates Q as false when A=true, B=false", () => {
        const engine = makeImplicationEngine()
        // A=true, B=false → Q = (A implies B) = false
        // P=true → P implies Q = true implies false = false
        const result = engine.evaluate({
            variables: { vA: true, vB: false, vP: true },
            operatorAssignments: {},
        })
        expect(result).toBeDefined()
        expect(result.ok).toBe(true)
        if (result.ok) {
            expect(result.conclusion!.rootValue).toBe(false)
        }
    })

    it("evaluates Q as true when A=false (vacuous truth)", () => {
        const engine = makeImplicationEngine()
        // A=false, B=false → Q = (A implies B) = true (vacuous)
        // P=true → P implies Q = true implies true = true
        const result = engine.evaluate({
            variables: { vA: false, vB: false, vP: true },
            operatorAssignments: {},
        })
        expect(result).toBeDefined()
        expect(result.ok).toBe(true)
        if (result.ok) {
            expect(result.conclusion!.rootValue).toBe(true)
        }
    })

    it("caches resolver results across multiple references in same evaluate call", () => {
        // Build: P and Q and Q, where Q is bound to p1 (A implies B)
        // Q appears twice — resolver should cache and return same value
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "cA", type: "normal" })
        claimLibrary.create({ id: "cB", type: "normal" })
        claimLibrary.create({ id: "cP", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary
        )

        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "cA",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.addVariable({
            id: "vB",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "B",
            claimId: "cB",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.addVariable({
            id: "vP",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "P",
            claimId: "cP",
            claimVersion: 0,
        } as TClaimBoundVariable)

        // Premise 1: A implies B
        engine.createPremiseWithId("p1")
        const p1 = engine.getPremise("p1")!
        p1.addExpression({
            id: "op1",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: null,
            type: "operator",
            operator: "implies",
            position: 0,
        })
        p1.addExpression({
            id: "e1a",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: "op1",
            type: "variable",
            variableId: "vA",
            position: 0,
        })
        p1.addExpression({
            id: "e1b",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: "op1",
            type: "variable",
            variableId: "vB",
            position: 1,
        })

        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })

        // Premise 2: P and Q and Q (conclusion) — Q appears twice
        engine.createPremiseWithId("p2")
        const p2 = engine.getPremise("p2")!
        p2.addExpression({
            id: "op2",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: null,
            type: "operator",
            operator: "and",
            position: 0,
        })
        p2.addExpression({
            id: "e2a",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: "op2",
            type: "variable",
            variableId: "vP",
            position: 0,
        })
        p2.addExpression({
            id: "e2b",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: "op2",
            type: "variable",
            variableId: "vQ",
            position: 1,
        })
        p2.addExpression({
            id: "e2c",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: "op2",
            type: "variable",
            variableId: "vQ",
            position: 2,
        })

        engine.setConclusionPremise("p2")

        // A=true, B=true → Q = true; P=true → P and Q and Q = true and true and true = true
        const result = engine.evaluate({
            variables: { vA: true, vB: true, vP: true },
            operatorAssignments: {},
        })
        expect(result.ok).toBe(true)
        if (result.ok) {
            expect(result.conclusion!.rootValue).toBe(true)
        }

        // A=true, B=false → Q = false; P=true → P and Q and Q = true and false and false = false
        const result2 = engine.evaluate({
            variables: { vA: true, vB: false, vP: true },
            operatorAssignments: {},
        })
        expect(result2.ok).toBe(true)
        if (result2.ok) {
            expect(result2.conclusion!.rootValue).toBe(false)
        }
    })

    it("checkValidity resolves premise-bound variables correctly", () => {
        const engine = makeImplicationEngine()
        // Structure: supporting premise p1 = (A implies B), conclusion p2 = (P implies Q)
        // where Q is bound to p1.
        // When the supporting premise (A implies B) is true, Q evaluates to true.
        // So the conclusion becomes (P implies true) = true for all P.
        // When the supporting premise is false (A=true, B=false), the assignment
        // is inadmissible, so no counterexample is possible.
        // Therefore the argument IS valid.
        const result = engine.checkValidity()
        expect(result.ok).toBe(true)
        if (result.ok) {
            // 3 claim-bound variables → 2^3 = 8 assignments
            expect(result.numAssignmentsChecked).toBe(8)
            expect(result.isValid).toBe(true)
            expect(result.counterexamples!.length).toBe(0)
        }
    })
})

// ---------------------------------------------------------------------------
// Premise-variable associations — updateVariable
// ---------------------------------------------------------------------------

describe("Premise-variable associations — updateVariable", () => {
    function makeEngine() {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1", type: "normal" })
        claimLibrary.create({ id: "c2", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary
        )
        engine.createPremiseWithId("p1")
        engine.createPremiseWithId("p2")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })
        return engine
    }

    it("updates symbol on premise-bound variable", () => {
        const engine = makeEngine()
        engine.updateVariable("vQ", { symbol: "R" })
        expect(engine.getVariable("vQ")!.symbol).toBe("R")
    })

    it("rebinds premise-bound variable to different premise", () => {
        const engine = makeEngine()
        engine.updateVariable("vQ", { boundPremiseId: "p2" })
        const v = engine.getVariable("vQ")!
        expect(isPremiseBound(v)).toBe(true)
        expect((v as TPremiseBoundVariable).boundPremiseId).toBe("p2")
    })

    it("rejects binding-type conversion on claim-bound variable", () => {
        const engine = makeEngine()
        expect(() =>
            engine.updateVariable("vA", { boundPremiseId: "p1" })
        ).toThrow()
    })

    it("rejects binding-type conversion on premise-bound variable", () => {
        const engine = makeEngine()
        expect(() => engine.updateVariable("vQ", { claimId: "c1" })).toThrow()
    })
})

// ---------------------------------------------------------------------------
// Premise-variable associations — diff
// ---------------------------------------------------------------------------

describe("Premise-variable associations — diff", () => {
    it("detects changes on premise-bound variable fields", () => {
        const before: TCorePropositionalVariable = {
            id: "v1",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
            checksum: "",
        }
        const after: TCorePropositionalVariable = {
            id: "v1",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p2",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
            checksum: "",
        }
        const changes = defaultCompareVariable(before, after)
        expect(changes).toHaveLength(1)
        expect(changes[0].field).toBe("boundPremiseId")
    })

    it("detects cross-variant change", () => {
        const before: TCorePropositionalVariable = {
            id: "v1",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            claimId: "c1",
            claimVersion: 0,
            checksum: "",
        }
        const after: TCorePropositionalVariable = {
            id: "v1",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
            checksum: "",
        }
        const changes = defaultCompareVariable<TCorePropositionalVariable>(
            before,
            after
        )
        const fields = changes.map((c) => c.field).sort()
        expect(fields).toEqual([
            "boundArgumentId",
            "boundArgumentVersion",
            "boundPremiseId",
            "claimId",
            "claimVersion",
        ])
    })
})

// ---------------------------------------------------------------------------
// Premise-variable associations — snapshot round-trip
// ---------------------------------------------------------------------------

describe("Premise-variable associations — snapshot round-trip", () => {
    it("restores premise-bound variables from snapshot", () => {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary
        )
        engine.createPremiseWithId("p1")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })

        const snapshot = engine.snapshot()
        const restored = ArgumentEngine.fromSnapshot(snapshot, claimLibrary)

        const vQ = restored.getVariable("vQ")
        expect(vQ).toBeDefined()
        expect(isPremiseBound(vQ!)).toBe(true)
        expect((vQ as TPremiseBoundVariable).boundPremiseId).toBe("p1")

        const vA = restored.getVariable("vA")
        expect(vA).toBeDefined()
        expect(isClaimBound(vA!)).toBe(true)
    })
})

describe("Premise-variable associations — validateEvaluability", () => {
    it("warns when premise-bound variable targets an empty premise", () => {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary
        )
        engine.createPremiseWithId("p1")
        engine.createPremiseWithId("p2")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })

        // Add Q to p2's tree so it gets validated
        const p2 = engine.getPremise("p2")!
        p2.appendExpression(null, {
            id: "e1",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: null,
            type: "variable",
            variableId: "vQ",
        })

        const validation = p2.validateEvaluability()
        expect(
            validation.issues.some((i) => i.code === "EXPR_BOUND_PREMISE_EMPTY")
        ).toBe(true)
    })

    it("does not warn when premise-bound variable targets a premise with expressions", () => {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary
        )
        engine.createPremiseWithId("p1")
        engine.createPremiseWithId("p2")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        } as TClaimBoundVariable)

        // Add expression to p1 so it is not empty
        const p1 = engine.getPremise("p1")!
        p1.appendExpression(null, {
            id: "e0",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: null,
            type: "variable",
            variableId: "vA",
        })

        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })

        // Add Q to p2's tree
        const p2 = engine.getPremise("p2")!
        p2.appendExpression(null, {
            id: "e1",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: null,
            type: "variable",
            variableId: "vQ",
        })

        const validation = p2.validateEvaluability()
        expect(
            validation.issues.some((i) => i.code === "EXPR_BOUND_PREMISE_EMPTY")
        ).toBe(false)
    })

    it("warning does not block evaluation (ok is still true)", () => {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary
        )
        engine.createPremiseWithId("p1")
        engine.createPremiseWithId("p2")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })

        const p2 = engine.getPremise("p2")!
        p2.appendExpression(null, {
            id: "e1",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: null,
            type: "variable",
            variableId: "vQ",
        })

        const validation = p2.validateEvaluability()
        // Warning severity does not set ok to false
        expect(validation.ok).toBe(true)
        expect(
            validation.issues.some(
                (i) =>
                    i.code === "EXPR_BOUND_PREMISE_EMPTY" &&
                    i.severity === "warning"
            )
        ).toBe(true)
    })
})

describe("Premise-variable associations — integration", () => {
    it("full round-trip: create, evaluate, snapshot, restore, re-evaluate", () => {
        // Build "P implies (A implies B)" argument
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "cA", type: "normal" })
        claimLibrary.create({ id: "cB", type: "normal" })
        claimLibrary.create({ id: "cP", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary
        )

        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "cA",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.addVariable({
            id: "vB",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "B",
            claimId: "cB",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.addVariable({
            id: "vP",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "P",
            claimId: "cP",
            claimVersion: 0,
        } as TClaimBoundVariable)

        // Premise 1: A implies B
        engine.createPremiseWithId("p1")
        const p1 = engine.getPremise("p1")!
        p1.addExpression({
            id: "op1",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: null,
            position: 0,
            type: "operator",
            operator: "implies",
        })
        p1.addExpression({
            id: "e1a",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: "op1",
            position: 0,
            type: "variable",
            variableId: "vA",
        })
        p1.addExpression({
            id: "e1b",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: "op1",
            position: 1,
            type: "variable",
            variableId: "vB",
        })

        // Q bound to p1
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })

        // Premise 2: P implies Q (conclusion)
        engine.createPremiseWithId("p2")
        const p2 = engine.getPremise("p2")!
        p2.addExpression({
            id: "op2",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: null,
            position: 0,
            type: "operator",
            operator: "implies",
        })
        p2.addExpression({
            id: "e2a",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: "op2",
            position: 0,
            type: "variable",
            variableId: "vP",
        })
        p2.addExpression({
            id: "e2b",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: "op2",
            position: 1,
            type: "variable",
            variableId: "vQ",
        })

        engine.setConclusionPremise("p2")

        // Evaluate: A=true, B=false => Q = (true implies false) = false
        // P=true, Q=false => (true implies false) = false
        const evalResult = engine.evaluate({
            variables: { vA: true, vB: false, vP: true },
            operatorAssignments: {},
        })
        expect(evalResult).toBeDefined()
        expect(evalResult.conclusion!.rootValue).toBe(false)

        // Snapshot
        const snapshot = engine.snapshot()

        // Restore
        const restored = ArgumentEngine.fromSnapshot(snapshot, claimLibrary)

        // Re-evaluate with same assignment
        const reEvalResult = restored.evaluate({
            variables: { vA: true, vB: false, vP: true },
            operatorAssignments: {},
        })
        expect(reEvalResult).toBeDefined()
        expect(reEvalResult.conclusion!.rootValue).toBe(false)

        // Remove target premise and verify cascade
        restored.removePremise("p1")
        expect(restored.getVariable("vQ")).toBeUndefined()
        expect(restored.getPremise("p2")!.getExpressions().length).toBeLessThan(
            3
        )
    })

    it("checkValidity produces correct result for nested implication", () => {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "cA", type: "normal" })
        claimLibrary.create({ id: "cB", type: "normal" })
        claimLibrary.create({ id: "cP", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary
        )

        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "cA",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.addVariable({
            id: "vB",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "B",
            claimId: "cB",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.addVariable({
            id: "vP",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "P",
            claimId: "cP",
            claimVersion: 0,
        } as TClaimBoundVariable)

        // p1: A implies B (supporting)
        engine.createPremiseWithId("p1")
        const p1 = engine.getPremise("p1")!
        p1.addExpression({
            id: "op1",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: null,
            position: 0,
            type: "operator",
            operator: "implies",
        })
        p1.addExpression({
            id: "e1a",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: "op1",
            position: 0,
            type: "variable",
            variableId: "vA",
        })
        p1.addExpression({
            id: "e1b",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: "op1",
            position: 1,
            type: "variable",
            variableId: "vB",
        })

        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })

        // p2: P implies Q (conclusion)
        engine.createPremiseWithId("p2")
        const p2 = engine.getPremise("p2")!
        p2.addExpression({
            id: "op2",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: null,
            position: 0,
            type: "operator",
            operator: "implies",
        })
        p2.addExpression({
            id: "e2a",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: "op2",
            position: 0,
            type: "variable",
            variableId: "vP",
        })
        p2.addExpression({
            id: "e2b",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: "op2",
            position: 1,
            type: "variable",
            variableId: "vQ",
        })

        engine.setConclusionPremise("p2")

        const result = engine.checkValidity()
        expect(result).toBeDefined()
        // 3 claim-bound variables -> 8 assignments
        expect(result.numAssignmentsChecked).toBe(8)
        // The argument "given (A implies B), therefore (P implies Q)" is valid
        expect(result.isValid).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// Parsing — response schemas
// ---------------------------------------------------------------------------
describe("Parsing — response schemas", () => {
    describe("ParsedClaimSchema", () => {
        it("accepts a valid claim", () => {
            const claim: TParsedClaim = {
                miniId: "c1",
                role: "premise",
                type: "normal",
            }
            expect(Value.Check(ParsedClaimSchema, claim)).toBe(true)
        })

        it("accepts additional properties", () => {
            const claim = {
                miniId: "c1",
                role: "conclusion",
                type: "normal",
                citationMiniIds: [],
                customField: "extra",
            }
            expect(Value.Check(ParsedClaimSchema, claim)).toBe(true)
        })

        it("rejects invalid role", () => {
            const claim = {
                miniId: "c1",
                role: "invalid",
                type: "normal",
                citationMiniIds: [],
            }
            expect(Value.Check(ParsedClaimSchema, claim)).toBe(false)
        })
    })

    describe("ParsedVariableSchema", () => {
        it("accepts a valid variable", () => {
            const variable: TParsedVariable = {
                miniId: "v1",
                symbol: "P",
                claimMiniId: "c1",
            }
            expect(Value.Check(ParsedVariableSchema, variable)).toBe(true)
        })
    })

    describe("ParsedPremiseSchema", () => {
        it("accepts a valid premise", () => {
            const premise: TParsedPremise = {
                miniId: "p1",
                formula: "P and Q",
            }
            expect(Value.Check(ParsedPremiseSchema, premise)).toBe(true)
        })
    })

    describe("ParsedArgumentResponseSchema", () => {
        it("accepts a valid response with argument", () => {
            const response: TParsedArgumentResponse = {
                argument: {
                    claims: [
                        {
                            miniId: "c1",
                            role: "premise",
                            type: "normal",
                        },
                        {
                            miniId: "s1",
                            role: "premise",
                            type: "citation",
                        },
                    ],
                    variables: [
                        { miniId: "v1", symbol: "P", claimMiniId: "c1" },
                    ],
                    premises: [{ miniId: "p1", formula: "P" }],
                    conclusionPremiseMiniId: "p1",
                },
                uncategorizedText: null,
                selectionRationale: "Clear argument structure",
                failureText: null,
            }
            expect(Value.Check(ParsedArgumentResponseSchema, response)).toBe(
                true
            )
        })

        it("accepts null argument with failureText", () => {
            const response: TParsedArgumentResponse = {
                argument: null,
                uncategorizedText: "Some text",
                selectionRationale: null,
                failureText: "Could not parse argument",
            }
            expect(Value.Check(ParsedArgumentResponseSchema, response)).toBe(
                true
            )
        })

        it("accepts additional properties on nested schemas", () => {
            const response = {
                argument: {
                    claims: [
                        {
                            miniId: "c1",
                            role: "conclusion",
                            type: "normal",
                            citationMiniIds: [],
                            customClaimField: true,
                        },
                    ],
                    variables: [
                        {
                            miniId: "v1",
                            symbol: "P",
                            claimMiniId: "c1",
                            customVarField: 42,
                        },
                    ],
                    premises: [
                        {
                            miniId: "p1",
                            formula: "P",
                            customPremField: "x",
                        },
                    ],
                    conclusionPremiseMiniId: "p1",
                    customArgField: "extra",
                },
                uncategorizedText: null,
                selectionRationale: null,
                failureText: null,
                customResponseField: "top-level-extra",
            }
            expect(Value.Check(ParsedArgumentResponseSchema, response)).toBe(
                true
            )
        })
    })

    describe("buildParsingResponseSchema", () => {
        it("returns core schema with no options", () => {
            const schema = buildParsingResponseSchema()
            const response = {
                argument: {
                    claims: [
                        {
                            miniId: "c1",
                            role: "premise",
                            type: "normal",
                            citationMiniIds: [],
                        },
                    ],
                    variables: [
                        { miniId: "v1", symbol: "P", claimMiniId: "c1" },
                    ],
                    premises: [{ miniId: "p1", formula: "P" }],
                    conclusionPremiseMiniId: "p1",
                },
                uncategorizedText: null,
                selectionRationale: null,
                failureText: null,
            }
            expect(Value.Check(schema, response)).toBe(true)
        })

        it("merges claim extension fields", () => {
            const schema = buildParsingResponseSchema({
                claimSchema: Type.Object({
                    confidence: Type.Number(),
                }),
            })
            const response = {
                argument: {
                    claims: [
                        {
                            miniId: "c1",
                            role: "premise",
                            type: "normal",
                            citationMiniIds: [],
                            confidence: 0.9,
                        },
                    ],
                    variables: [
                        { miniId: "v1", symbol: "P", claimMiniId: "c1" },
                    ],
                    premises: [{ miniId: "p1", formula: "P" }],
                    conclusionPremiseMiniId: "p1",
                },
                uncategorizedText: null,
                selectionRationale: null,
                failureText: null,
            }
            expect(Value.Check(schema, response)).toBe(true)

            // Should reject when required extension field is missing
            const invalid = {
                argument: {
                    claims: [
                        {
                            miniId: "c1",
                            role: "premise",
                            type: "normal",
                            citationMiniIds: [],
                            // confidence missing
                        },
                    ],
                    variables: [
                        { miniId: "v1", symbol: "P", claimMiniId: "c1" },
                    ],
                    premises: [{ miniId: "p1", formula: "P" }],
                    conclusionPremiseMiniId: "p1",
                },
                uncategorizedText: null,
                selectionRationale: null,
                failureText: null,
            }
            expect(Value.Check(schema, invalid)).toBe(false)
        })

        it("merges parsedArgumentSchema extension fields", () => {
            const schema = buildParsingResponseSchema({
                parsedArgumentSchema: Type.Object({
                    argumentTitle: Type.String(),
                }),
            })
            const response = {
                argument: {
                    claims: [
                        {
                            miniId: "c1",
                            role: "premise",
                            type: "normal",
                            citationMiniIds: [],
                        },
                    ],
                    variables: [
                        { miniId: "v1", symbol: "P", claimMiniId: "c1" },
                    ],
                    premises: [{ miniId: "p1", formula: "P" }],
                    conclusionPremiseMiniId: "p1",
                    argumentTitle: "My argument",
                },
                uncategorizedText: null,
                selectionRationale: null,
                failureText: null,
            }
            expect(Value.Check(schema, response)).toBe(true)
        })

        it("merges multiple extension schemas simultaneously", () => {
            const schema = buildParsingResponseSchema({
                claimSchema: Type.Object({
                    confidence: Type.Number(),
                }),
                premiseSchema: Type.Object({
                    label: Type.String(),
                }),
                variableSchema: Type.Object({
                    description: Type.String(),
                }),
            })
            const response = {
                argument: {
                    claims: [
                        {
                            miniId: "c1",
                            role: "premise",
                            type: "normal",
                            citationMiniIds: ["s1"],
                            confidence: 0.95,
                        },
                        {
                            miniId: "s1",
                            role: "premise",
                            type: "citation",
                            citationMiniIds: [],
                            confidence: 0.5,
                        },
                    ],
                    variables: [
                        {
                            miniId: "v1",
                            symbol: "P",
                            claimMiniId: "c1",
                            description: "Prop P",
                        },
                    ],
                    premises: [
                        {
                            miniId: "p1",
                            formula: "P",
                            label: "First premise",
                        },
                    ],
                    conclusionPremiseMiniId: "p1",
                },
                uncategorizedText: null,
                selectionRationale: null,
                failureText: null,
            }
            expect(Value.Check(schema, response)).toBe(true)
        })
    })

    describe("getParsingResponseSchema", () => {
        it("returns a valid JSON Schema object from core schema", () => {
            const jsonSchema = getParsingResponseSchema()
            expect(jsonSchema).toBeDefined()
            expect(jsonSchema.type).toBe("object")
            const props = jsonSchema.properties as Record<string, unknown>
            expect(props).toBeDefined()
            expect(props.argument).toBeDefined()
            expect(props.uncategorizedText).toBeDefined()
            expect(props.failureText).toBeDefined()
        })

        it("returns JSON Schema from an extended schema", () => {
            const extended = buildParsingResponseSchema({
                claimSchema: Type.Object({
                    confidence: Type.Number(),
                }),
            })
            const jsonSchema = getParsingResponseSchema(extended)
            expect(jsonSchema).toBeDefined()
            expect(jsonSchema.type).toBe("object")
            const props = jsonSchema.properties as Record<string, unknown>
            expect(props).toBeDefined()
            expect(props.argument).toBeDefined()
        })
    })

    describe("Parsing — prompt builder", () => {
        it("includes core instructions with default schema", () => {
            const prompt = buildParsingPrompt(ParsedArgumentResponseSchema)
            expect(prompt).toContain("expert argument analyst")
            expect(prompt).toContain("propositional argument")
            expect(prompt).toContain("uncategorizedText")
            expect(prompt).toContain("selectionRationale")
            expect(prompt).toContain("failureText")
            expect(prompt).toContain("implies")
            expect(prompt).toContain("third person")
        })

        it("includes formula syntax rules", () => {
            const prompt = buildParsingPrompt(ParsedArgumentResponseSchema)
            expect(prompt).toContain("and")
            expect(prompt).toContain("or")
            expect(prompt).toContain("not")
            expect(prompt).toContain("implies")
            expect(prompt).toContain("iff")
            expect(prompt).toContain("parentheses")
        })

        it("includes root-only constraint for implies and iff", () => {
            const prompt = buildParsingPrompt(ParsedArgumentResponseSchema)
            expect(prompt).toMatch(/implies.*root/i)
            expect(prompt).toMatch(/iff.*root/i)
        })

        it("discovers extension fields and generates constraint instructions", () => {
            const extended = buildParsingResponseSchema({
                claimSchema: Type.Object({
                    title: Type.String({
                        maxLength: 50,
                        description: "A short title for the claim",
                    }),
                    body: Type.String({ maxLength: 500 }),
                }),
            })
            const prompt = buildParsingPrompt(extended)
            expect(prompt).toContain("title")
            expect(prompt).toContain("50")
            expect(prompt).toContain("body")
            expect(prompt).toContain("500")
        })

        it("appends customInstructions", () => {
            const prompt = buildParsingPrompt(ParsedArgumentResponseSchema, {
                customInstructions: 'CMV means "change my view"',
            })
            expect(prompt).toContain('CMV means "change my view"')
        })

        it("does not include extension instructions for core-only schema", () => {
            const prompt = buildParsingPrompt(ParsedArgumentResponseSchema)
            expect(prompt).not.toContain("maxLength")
        })

        it("includes miniId prefix conventions", () => {
            const prompt = buildParsingPrompt(ParsedArgumentResponseSchema)
            expect(prompt).toContain("MiniId Conventions")
            expect(prompt).toContain("c1")
            expect(prompt).toContain("v1")
            expect(prompt).toContain("p1")
            // Unified claim prefix — no separate s/a prefixes.
            expect(prompt).not.toContain("s1")
            expect(prompt).not.toContain("a1")
        })

        it("explains support via formulas instead of a separate citation field", () => {
            const prompt = buildParsingPrompt(ParsedArgumentResponseSchema)
            // The old citationMiniIds field has been removed entirely.
            expect(prompt).not.toContain("citationMiniIds")
            // The replacement guidance is the Support via Formulas section.
            expect(prompt).toContain("Support via Formulas")
            expect(prompt).toMatch(
                /antecedent.*implies.*consequent|implies.*supported claim/i
            )
            expect(prompt).toContain("do not list supports as a separate field")
        })
    })

    // -----------------------------------------------------------------------
    // Parsing — ArgumentParser
    // -----------------------------------------------------------------------
    describe("Parsing — ArgumentParser", () => {
        function validResponse(): TParsedArgumentResponse {
            return {
                argument: {
                    claims: [
                        {
                            miniId: "C1",
                            role: "premise",
                            type: "normal",
                        },
                        {
                            miniId: "C2",
                            role: "conclusion",
                            type: "normal",
                        },
                        {
                            miniId: "S1",
                            role: "premise",
                            type: "citation",
                        },
                    ],
                    variables: [
                        { miniId: "V1", symbol: "P", claimMiniId: "C1" },
                        { miniId: "V2", symbol: "Q", claimMiniId: "C2" },
                        { miniId: "V3", symbol: "S", claimMiniId: "S1" },
                    ],
                    premises: [
                        { miniId: "P1", formula: "(P and S) implies Q" },
                        { miniId: "P2", formula: "P" },
                    ],
                    conclusionPremiseMiniId: "P1",
                },
                uncategorizedText: null,
                selectionRationale: null,
                failureText: null,
            }
        }

        describe("validate", () => {
            it("accepts a valid response", () => {
                const parser = new ArgumentParser()
                const result = parser.validate(validResponse())
                expect(result.argument).toBeDefined()
                expect(result.argument!.claims).toHaveLength(3)
            })

            it("accepts null argument with failureText", () => {
                const parser = new ArgumentParser()
                const result = parser.validate({
                    argument: null,
                    uncategorizedText: null,
                    selectionRationale: null,
                    failureText: "Could not parse",
                })
                expect(result.argument).toBeNull()
                expect(result.failureText).toBe("Could not parse")
            })

            it("throws on malformed input", () => {
                const parser = new ArgumentParser()
                expect(() => parser.validate("not an object")).toThrow()
            })

            it("throws on missing required fields", () => {
                const parser = new ArgumentParser()
                expect(() => parser.validate({ argument: {} })).toThrow()
            })
        })

        describe("build", () => {
            it("produces ArgumentEngine and libraries", () => {
                const parser = new ArgumentParser()
                const result = parser.build(validResponse())
                expect(result.engine).toBeDefined()
                expect(result.claimLibrary).toBeDefined()
                expect(result.claimCitationLibrary).toBeDefined()
            })

            it("creates claims in library", () => {
                const parser = new ArgumentParser()
                const result = parser.build(validResponse())
                const allClaims = result.claimLibrary.getAll()
                // 2 normal claims (C1, C2) + 1 citation claim (S1)
                expect(allClaims).toHaveLength(3)
            })

            it("creates variables bound to claims", () => {
                const parser = new ArgumentParser()
                const result = parser.build(validResponse())
                const snap = result.engine.snapshot()
                const vars = snap.variables.variables
                const claimBoundVars = vars.filter((v) => isClaimBound(v))
                const premiseBoundVars = vars.filter((v) => isPremiseBound(v))
                expect(claimBoundVars).toHaveLength(3)
                expect(premiseBoundVars).toHaveLength(2) // auto-created for each premise
                const claimSymbols = claimBoundVars.map((v) => v.symbol).sort()
                expect(claimSymbols).toEqual(["P", "Q", "S"])
            })

            it("creates premises with expression trees", () => {
                const parser = new ArgumentParser()
                const result = parser.build(validResponse())
                const snap = result.engine.snapshot()
                expect(snap.premises).toHaveLength(2)
                // One premise "(P and S) implies Q" has more than 1 expression
                const impliesPremise = snap.premises.find(
                    (p) => p.expressions.expressions.length > 1
                )!
                expect(impliesPremise).toBeDefined()
                // The other premise "P" has 1 expression (variable)
                const singlePremise = snap.premises.find(
                    (p) => p.expressions.expressions.length === 1
                )!
                expect(singlePremise).toBeDefined()
                expect(singlePremise.expressions.expressions[0].type).toBe(
                    "variable"
                )
            })

            it("sets conclusion role", () => {
                const parser = new ArgumentParser()
                const result = parser.build(validResponse())
                const snap = result.engine.snapshot()
                expect(snap.conclusionPremiseId).toBeDefined()
            })

            it("wires claim-source associations", () => {
                const parser = new ArgumentParser()
                const result = parser.build(validResponse())
                const assocs = result.claimCitationLibrary.getAll()
                // Premise "(P and S) implies Q" puts citation-bound S in the
                // antecedent and normal-bound Q in the consequent, yielding
                // a single Q → S citation edge.
                expect(assocs).toHaveLength(1)
            })

            it("shares variables across premises", () => {
                const parser = new ArgumentParser()
                // Both premises reference P: "P -> Q" and "P"
                const result = parser.build(validResponse())
                const snap = result.engine.snapshot()
                // Find variable P
                const varP = snap.variables.variables.find(
                    (v) => v.symbol === "P"
                )!
                // Both premises should reference variable P
                const premisesWithP = snap.premises.filter((p) =>
                    p.expressions.expressions.some(
                        (e) => e.type === "variable" && e.variableId === varP.id
                    )
                )
                expect(premisesWithP).toHaveLength(2)
            })

            it("throws on null argument", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                resp.argument = null
                expect(() => parser.build(resp)).toThrow(/argument is null/i)
            })

            it("throws on formula referencing undeclared variable miniId", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                // Add a premise that references an undeclared variable symbol
                resp.argument!.premises.push({
                    miniId: "P3",
                    formula: "V99",
                })
                expect(() => parser.build(resp)).toThrow(/V99/)
            })

            it("throws on nested implies", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                resp.argument!.premises = [
                    {
                        miniId: "P1",
                        formula: "(P implies Q) and P",
                    },
                ]
                expect(() => parser.build(resp)).toThrow(/implication/i)
            })

            it("auto-normalizes nested operators by inserting formula buffers", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                // "(P and Q) or P" creates or(and(P,Q), P) — and is child of or
                // autoNormalize should insert a formula buffer between or and and
                resp.argument!.premises = [
                    { miniId: "P1", formula: "(P and Q) or P" },
                ]
                resp.argument!.conclusionPremiseMiniId = "P1"
                const result = parser.build(resp)
                const snap = result.engine.snapshot()
                expect(snap.premises).toHaveLength(1)
                const exprs = snap.premises[0].expressions.expressions
                // Should have: or, formula(buffer), and, var(P), var(Q), var(P)
                // = 6 expressions total
                const formulaExprs = exprs.filter((e) => e.type === "formula")
                expect(formulaExprs.length).toBeGreaterThanOrEqual(1)
                const orExpr = exprs.find(
                    (e) => e.type === "operator" && e.operator === "or"
                )
                expect(orExpr).toBeDefined()
                const andExpr = exprs.find(
                    (e) => e.type === "operator" && e.operator === "and"
                )
                expect(andExpr).toBeDefined()
                // The and operator should NOT be a direct child of or
                // (a formula buffer should sit between them)
                expect(andExpr!.parentId).not.toBe(orExpr!.id)
            })

            it("throws on variable referencing undeclared claim miniId", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                resp.argument!.variables = [
                    { miniId: "V1", symbol: "P", claimMiniId: "C99" },
                ]
                resp.argument!.premises = [{ miniId: "P1", formula: "P" }]
                resp.argument!.conclusionPremiseMiniId = "P1"
                expect(() => parser.build(resp)).toThrow(/C99/)
            })

            it("throws on unresolvable conclusionPremiseMiniId", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                resp.argument!.conclusionPremiseMiniId = "P99"
                expect(() => parser.build(resp)).toThrow(/P99/)
            })

            it("throws on invalid formula syntax", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                resp.argument!.premises = [{ miniId: "P1", formula: "P &&& Q" }]
                // Error message should mention the premise miniId
                expect(() => parser.build(resp)).toThrow(/P1/)
            })

            it("includes empty warnings array on successful strict build", () => {
                const parser = new ArgumentParser()
                const result = parser.build(validResponse())
                expect(result.warnings).toEqual([])
            })

            it("ignores citationMiniIds (deprecated field; edges now come from formulas)", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                // The old citation-walking pass would have thrown here; the
                // new formula-inference pass ignores citationMiniIds entirely.
                // Cast since citationMiniIds is no longer in the schema, but
                // additionalProperties: true lets it through at runtime.
                ;(
                    resp.argument!.claims[0] as TParsedClaim & {
                        citationMiniIds: string[]
                    }
                ).citationMiniIds = ["BOGUS"]
                expect(() => parser.build(resp)).not.toThrow()
            })
        })

        describe("build lenient mode", () => {
            function validResponse(): TParsedArgumentResponse {
                return {
                    argument: {
                        claims: [
                            {
                                miniId: "C1",
                                role: "premise",
                                type: "normal",
                            },
                            {
                                miniId: "C2",
                                role: "conclusion",
                                type: "normal",
                            },
                        ],
                        variables: [
                            { miniId: "V1", symbol: "P", claimMiniId: "C1" },
                            { miniId: "V2", symbol: "Q", claimMiniId: "C2" },
                        ],
                        premises: [
                            { miniId: "P1", formula: "P implies Q" },
                            { miniId: "P2", formula: "P" },
                        ],
                        conclusionPremiseMiniId: "P1",
                    },
                    uncategorizedText: null,
                    selectionRationale: null,
                    failureText: null,
                }
            }

            it("skips premise with malformed formula and emits FORMULA_PARSE_ERROR", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                resp.argument!.premises.push({
                    miniId: "P3",
                    formula: "P &&& Q",
                })
                const result = parser.build(resp, { strict: false })
                // P1 and P2 survive, P3 skipped
                const snap = result.engine.snapshot()
                expect(snap.premises).toHaveLength(2)
                expect(result.warnings).toHaveLength(1)
                expect(result.warnings[0].code).toBe("FORMULA_PARSE_ERROR")
                expect(result.warnings[0].context.premiseMiniId).toBe("P3")
            })

            it("skips premise with nested implies and emits FORMULA_STRUCTURE_ERROR", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                resp.argument!.premises.push({
                    miniId: "P3",
                    formula: "(P implies Q) and P",
                })
                const result = parser.build(resp, { strict: false })
                const snap = result.engine.snapshot()
                expect(snap.premises).toHaveLength(2)
                expect(result.warnings).toHaveLength(1)
                expect(result.warnings[0].code).toBe("FORMULA_STRUCTURE_ERROR")
                expect(result.warnings[0].context.premiseMiniId).toBe("P3")
            })

            it("ignores citationMiniIds (no longer wired into the parser) even in lenient mode", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                // Add a citation-typed claim S1 and a variable bound to it,
                // then put S in the antecedent of an implies premise so the
                // new formula-inference pass produces a single edge.
                // Cast the claim literal: citationMiniIds is no longer in the
                // schema, but additionalProperties: true lets it through.
                resp.argument!.claims.push({
                    miniId: "S1",
                    role: "premise",
                    type: "citation",
                    citationMiniIds: [],
                } as TParsedClaim)
                resp.argument!.variables.push({
                    miniId: "V3",
                    symbol: "S",
                    claimMiniId: "S1",
                })
                resp.argument!.premises[0] = {
                    miniId: "P1",
                    formula: "(P and S) implies Q",
                }
                // citationMiniIds is now ignored — bogus values do not warn.
                ;(
                    resp.argument!.claims[0] as TParsedClaim & {
                        citationMiniIds: string[]
                    }
                ).citationMiniIds = ["S1", "BOGUS"]
                const result = parser.build(resp, { strict: false })
                // 2 normal claims + 1 citation claim; one citation edge from
                // the formula's antecedent.
                expect(result.claimLibrary.getAll()).toHaveLength(3)
                const cits = result.claimCitationLibrary.getAll()
                expect(cits).toHaveLength(1)
                expect(result.warnings).toEqual([])
            })

            it("skips variable with bad claim ref and emits UNRESOLVED_CLAIM_MINIID", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                // V2 references nonexistent claim C99
                resp.argument!.variables[1] = {
                    miniId: "V2",
                    symbol: "Q",
                    claimMiniId: "C99",
                }
                // Remove premise P1 that uses Q, keep P2 that uses only P
                resp.argument!.premises = [{ miniId: "P2", formula: "P" }]
                resp.argument!.conclusionPremiseMiniId = "P2"
                const result = parser.build(resp, { strict: false })
                const snap = result.engine.snapshot()
                // P survives as a claim-bound variable; 1 auto premise-bound var from 1 premise
                const claimBound = snap.variables.variables.filter((v) =>
                    isClaimBound(v)
                )
                expect(claimBound).toHaveLength(1)
                expect(claimBound[0].symbol).toBe("P")
                expect(snap.variables.variables).toHaveLength(2)
                expect(result.warnings).toHaveLength(1)
                expect(result.warnings[0].code).toBe("UNRESOLVED_CLAIM_MINIID")
                expect(result.warnings[0].context.variableMiniId).toBe("V2")
                expect(result.warnings[0].context.claimMiniId).toBe("C99")
            })

            it("skips premise with undeclared variable symbol and emits UNDECLARED_VARIABLE_SYMBOL", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                resp.argument!.premises.push({ miniId: "P3", formula: "X" })
                const result = parser.build(resp, { strict: false })
                const snap = result.engine.snapshot()
                expect(snap.premises).toHaveLength(2)
                expect(result.warnings).toHaveLength(1)
                expect(result.warnings[0].code).toBe(
                    "UNDECLARED_VARIABLE_SYMBOL"
                )
                expect(result.warnings[0].context.premiseMiniId).toBe("P3")
                expect(result.warnings[0].context.symbol).toBe("X")
            })

            it("skips conclusion assignment and emits UNRESOLVED_CONCLUSION_MINIID", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                resp.argument!.conclusionPremiseMiniId = "P99"
                const result = parser.build(resp, { strict: false })
                const snap = result.engine.snapshot()
                // Premises still created, but conclusion was auto-assigned to first premise
                expect(snap.premises).toHaveLength(2)
                expect(snap.conclusionPremiseId).toBeDefined() // auto-conclusion on first added premise
                expect(result.warnings).toHaveLength(1)
                expect(result.warnings[0].code).toBe(
                    "UNRESOLVED_CONCLUSION_MINIID"
                )
                expect(result.warnings[0].context.conclusionPremiseMiniId).toBe(
                    "P99"
                )
            })

            it("cascade: skipped variable causes premise skip with both warnings", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                // Make V2 (symbol Q) reference a bad claim
                resp.argument!.variables[1] = {
                    miniId: "V2",
                    symbol: "Q",
                    claimMiniId: "C99",
                }
                // P1 is "P implies Q" — Q is now undeclared, so P1 gets skipped
                // P2 is "P" — still valid; set it as conclusion so we don't also trigger UNRESOLVED_CONCLUSION_MINIID
                resp.argument!.conclusionPremiseMiniId = "P2"
                const result = parser.build(resp, { strict: false })
                const snap = result.engine.snapshot()
                expect(snap.premises).toHaveLength(1)
                const claimBound = snap.variables.variables.filter((v) =>
                    isClaimBound(v)
                )
                expect(claimBound).toHaveLength(1)
                expect(claimBound[0].symbol).toBe("P")
                expect(snap.variables.variables).toHaveLength(2) // 1 claim-bound + 1 auto
                expect(result.warnings).toHaveLength(2)
                const codes = result.warnings.map((w) => w.code)
                expect(codes).toContain("UNRESOLVED_CLAIM_MINIID")
                expect(codes).toContain("UNDECLARED_VARIABLE_SYMBOL")
            })

            it("returns identical result with empty warnings when lenient and no issues", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                const strictResult = parser.build(resp)
                const lenientResult = parser.build(resp, { strict: false })
                // Both should produce same structure (different UUIDs, so compare shape)
                const strictSnap = strictResult.engine.snapshot()
                const lenientSnap = lenientResult.engine.snapshot()
                expect(lenientSnap.premises).toHaveLength(
                    strictSnap.premises.length
                )
                expect(lenientSnap.variables.variables).toHaveLength(
                    strictSnap.variables.variables.length
                )
                expect(lenientResult.warnings).toEqual([])
            })

            it("strict mode still throws on all error types", () => {
                const parser = new ArgumentParser()

                // FORMULA_PARSE_ERROR
                const r1 = validResponse()
                r1.argument!.premises = [{ miniId: "P1", formula: "P &&& Q" }]
                expect(() => parser.build(r1)).toThrow(/P1/)

                // FORMULA_STRUCTURE_ERROR
                const r2 = validResponse()
                r2.argument!.premises = [
                    { miniId: "P1", formula: "(P implies Q) and P" },
                ]
                expect(() => parser.build(r2)).toThrow(/implication/i)

                // UNDECLARED_VARIABLE_SYMBOL
                const r3 = validResponse()
                r3.argument!.premises.push({ miniId: "P3", formula: "X" })
                expect(() => parser.build(r3)).toThrow(/X/)

                // UNRESOLVED_CLAIM_MINIID
                const r4 = validResponse()
                r4.argument!.variables = [
                    { miniId: "V1", symbol: "P", claimMiniId: "C99" },
                ]
                r4.argument!.premises = [{ miniId: "P1", formula: "P" }]
                r4.argument!.conclusionPremiseMiniId = "P1"
                expect(() => parser.build(r4)).toThrow(/C99/)

                // UNRESOLVED_CONCLUSION_MINIID
                const r6 = validResponse()
                r6.argument!.conclusionPremiseMiniId = "P99"
                expect(() => parser.build(r6)).toThrow(/P99/)
            })
        })

        describe("subclass hooks", () => {
            it("mapClaim reflects custom fields on built claims", () => {
                class Custom extends ArgumentParser {
                    protected override mapClaim(parsed: {
                        miniId: string
                    }): Record<string, unknown> {
                        return { title: `claim-${parsed.miniId}` }
                    }
                }
                const parser = new Custom()
                const result = parser.build(validResponse())
                const claims = result.claimLibrary.getAll()
                expect(
                    claims.every(
                        (c) =>
                            (c as Record<string, unknown>).title !== undefined
                    )
                ).toBe(true)
            })

            it("mapPremise reflects on premise snapshot", () => {
                class Custom extends ArgumentParser {
                    protected override mapPremise(parsed: {
                        miniId: string
                    }): Record<string, unknown> {
                        return { label: `p-${parsed.miniId}` }
                    }
                }
                const parser = new Custom()
                const result = parser.build(validResponse())
                const snap = result.engine.snapshot()
                for (const p of snap.premises) {
                    expect(
                        (p.premise as Record<string, unknown>).label
                    ).toBeDefined()
                }
            })

            it("mapVariable reflects on variable snapshot", () => {
                class Custom extends ArgumentParser {
                    protected override mapVariable(parsed: {
                        miniId: string
                    }): Record<string, unknown> {
                        return { tag: `var-${parsed.miniId}` }
                    }
                }
                const parser = new Custom()
                const result = parser.build(validResponse())
                const snap = result.engine.snapshot()
                // Only claim-bound variables go through mapVariable; auto-created premise-bound ones do not
                const claimBound = snap.variables.variables.filter((v) =>
                    isClaimBound(v)
                )
                for (const v of claimBound) {
                    expect((v as Record<string, unknown>).tag).toBeDefined()
                }
                expect(claimBound.length).toBeGreaterThan(0)
            })

            it("mapArgument reflects on argument snapshot", () => {
                class Custom extends ArgumentParser {
                    protected override mapArgument(): Record<string, unknown> {
                        return { title: "My argument" }
                    }
                }
                const parser = new Custom()
                const result = parser.build(validResponse())
                const snap = result.engine.snapshot()
                expect((snap.argument as Record<string, unknown>).title).toBe(
                    "My argument"
                )
            })

            it("mapClaimCitation reflects on citation entities", () => {
                class Custom extends ArgumentParser {
                    protected override mapClaimCitation(
                        dependentParsed: TParsedClaim,
                        _supportingParsed: TParsedClaim,
                        dependentClaimId: string,
                        _supportingClaimId: string
                    ): Record<string, unknown> {
                        return {
                            link: `${dependentParsed.miniId}-${dependentClaimId}`,
                        }
                    }
                }
                const parser = new Custom()
                const result = parser.build(validResponse())
                const cits = result.claimCitationLibrary.getAll()
                expect(cits).toHaveLength(1)
                const link = (cits[0] as Record<string, unknown>).link as string
                // Link format is "claimMiniId-realDependentClaimUUID". The
                // dependent claim is the consequent of the implies premise
                // — C2 in this fixture.
                expect(link).toMatch(/^C2-/)
            })
        })
    })
})

describe("LLM provider abstraction", () => {
    describe("resolveApiKey", () => {
        it("returns explicit key when provided", () => {
            const key = resolveApiKey("openai", "sk-explicit")
            expect(key).toBe("sk-explicit")
        })

        it("falls back to OPENAI_API_KEY env var", () => {
            const original = process.env.OPENAI_API_KEY
            try {
                process.env.OPENAI_API_KEY = "sk-from-env"
                const key = resolveApiKey("openai")
                expect(key).toBe("sk-from-env")
            } finally {
                if (original === undefined) {
                    delete process.env.OPENAI_API_KEY
                } else {
                    process.env.OPENAI_API_KEY = original
                }
            }
        })

        it("throws when no key is available", () => {
            const original = process.env.OPENAI_API_KEY
            try {
                delete process.env.OPENAI_API_KEY
                expect(() => resolveApiKey("openai")).toThrow(/OPENAI_API_KEY/)
            } finally {
                if (original !== undefined) {
                    process.env.OPENAI_API_KEY = original
                }
            }
        })

        it("throws for unknown provider with no explicit key", () => {
            expect(() => resolveApiKey("unknown")).toThrow(/unknown/)
        })

        it("returns explicit key even for unknown provider", () => {
            const key = resolveApiKey("unknown", "sk-explicit")
            expect(key).toBe("sk-explicit")
        })
    })

    describe("createLlmProvider", () => {
        it("creates an openai provider", () => {
            const provider = createLlmProvider("openai", {
                apiKey: "sk-test",
            })
            expect(provider).toBeDefined()
            expect(typeof provider.complete).toBe("function")
        })

        it("throws on unknown provider name", () => {
            expect(() =>
                createLlmProvider("unknown", { apiKey: "sk-test" })
            ).toThrow(/unknown/i)
        })
    })
})

describe("CliArgumentParser metadata injection", () => {
    class TestCliParser extends ArgumentParser {
        private readonly title: string
        private readonly description: string

        constructor(title: string, description: string) {
            super()
            this.title = title
            this.description = description
        }

        protected override mapArgument(): Record<string, unknown> {
            return {
                title: this.title,
                description: this.description,
                createdAt: new Date("2026-01-01T00:00:00Z"),
                published: false,
            }
        }
    }

    function validResponse(): TParsedArgumentResponse {
        return {
            argument: {
                claims: [
                    {
                        miniId: "C1",
                        role: "premise" as const,
                        type: "normal" as const,
                    },
                ],
                variables: [{ miniId: "V1", symbol: "A", claimMiniId: "C1" }],
                premises: [{ miniId: "P1", formula: "A" }],
                conclusionPremiseMiniId: "P1",
            },
            uncategorizedText: null,
            selectionRationale: null,
            failureText: null,
        }
    }

    it("injects title and description into the built argument", () => {
        const parser = new TestCliParser("My Title", "My Desc")
        const { engine } = parser.build(validResponse())
        const arg = engine.getArgument() as Record<string, unknown>
        expect(arg.title).toBe("My Title")
        expect(arg.description).toBe("My Desc")
        expect(arg.published).toBe(false)
        expect(arg.createdAt).toEqual(new Date("2026-01-01T00:00:00Z"))
    })

    it("uses default title when not specified", () => {
        const parser = new TestCliParser("Parsed argument", "")
        const { engine } = parser.build(validResponse())
        const arg = engine.getArgument() as Record<string, unknown>
        expect(arg.title).toBe("Parsed argument")
        expect(arg.description).toBe("")
    })
})

describe("Library persistence", () => {
    it("ClaimLibrary round-trips through snapshot", () => {
        const lib = new ClaimLibrary()
        lib.create({ id: "c1", type: "normal" })
        const snapshot = lib.snapshot()
        const restored = ClaimLibrary.fromSnapshot(snapshot)
        expect(restored.get("c1", 0)).toBeDefined()
        expect(restored.get("c1", 0)!.id).toBe("c1")
    })

    it("ClaimCitationLibrary round-trips through snapshot", () => {
        const claimLib = new ClaimLibrary()
        claimLib.create({ id: "c1", type: "normal" })
        claimLib.create({ id: "s1", type: "citation" })
        const ccLib = new ClaimCitationLibrary(claimLib)
        ccLib.add({
            id: "a1",
            claimId: "c1",
            claimVersion: 0,
            supportingClaimId: "s1",
            supportingClaimVersion: 0,
        })
        const snapshot = ccLib.snapshot()
        const restored = ClaimCitationLibrary.fromSnapshot(snapshot, claimLib)
        expect(restored.get("a1")).toBeDefined()
        expect(restored.getAll()).toHaveLength(1)
    })

    it("placeholder claims are injected for missing claim references", () => {
        const lib = new ClaimLibrary()
        const snapshot = lib.snapshot()
        snapshot.claims.push({
            id: "c-missing",
            version: 0,
            frozen: true,
            checksum: "",
            type: "normal",
        } as (typeof snapshot.claims)[number])
        const rebuilt = ClaimLibrary.fromSnapshot(snapshot)
        expect(rebuilt.get("c-missing", 0)).toBeDefined()
        expect(rebuilt.get("c-missing", 0)!.frozen).toBe(true)
    })
})



describe("ArgumentEngine — checksumConfig Set reconstruction after JSON round-trip", () => {
    const ARG = { id: "arg-1", version: 1 }

    /** Simulate JSON round-trip: Sets become arrays */
    function jsonRoundTrip<T>(value: T): T {
        return JSON.parse(
            JSON.stringify(value, (_key, val: unknown) =>
                val instanceof Set ? [...val] : val
            )
        ) as T
    }

    it("fromSnapshot reconstructs checksumConfig field Sets from arrays", () => {
        const customConfig = {
            checksumConfig: {
                premiseFields: new Set(["premiseId", "createdOn"]),
                argumentFields: new Set(["id", "version"]),
            },
        }
        const engine = new ArgumentEngine(ARG, aLib(), customConfig)
        const snap = engine.snapshot()
        const serialized = jsonRoundTrip(snap)

        // Verify serialization turned Sets into arrays
        expect(serialized.config!.checksumConfig!.premiseFields).toBeInstanceOf(
            Array
        )

        const restored = ArgumentEngine.fromSnapshot(serialized, aLib())

        // The restored engine's snapshot should serialize Sets as arrays
        const restoredSnap = restored.snapshot()
        expect(
            Array.isArray(restoredSnap.config!.checksumConfig!.premiseFields)
        ).toBe(true)
        expect(
            Array.isArray(restoredSnap.config!.checksumConfig!.argumentFields)
        ).toBe(true)
        expect(restoredSnap.config!.checksumConfig!.premiseFields).toEqual(
            expect.arrayContaining(["premiseId", "createdOn"])
        )
        expect(restoredSnap.config!.checksumConfig!.argumentFields).toEqual(
            expect.arrayContaining(["id", "version"])
        )
    })

    it("fromData reconstructs checksumConfig field Sets from arrays", () => {
        const customConfig = {
            checksumConfig: {
                expressionFields: new Set(["id", "type", "customField"]),
                variableFields: new Set(["id", "symbol"]),
            },
        }
        const serializedConfig = jsonRoundTrip(customConfig)

        // Verify serialization turned Sets into arrays
        expect(serializedConfig.checksumConfig.expressionFields).toBeInstanceOf(
            Array
        )

        const engine = ArgumentEngine.fromData(
            ARG,
            aLib(),
            [],
            [],
            [],
            {},
            serializedConfig
        )

        const snap = engine.snapshot()
        expect(
            Array.isArray(snap.config!.checksumConfig!.expressionFields)
        ).toBe(true)
        expect(Array.isArray(snap.config!.checksumConfig!.variableFields)).toBe(
            true
        )
        expect(snap.config!.checksumConfig!.expressionFields).toEqual(
            expect.arrayContaining(["id", "type", "customField"])
        )
    })

    it("rollback reconstructs checksumConfig field Sets from arrays", () => {
        const customConfig = {
            checksumConfig: {
                roleFields: new Set(["conclusionPremiseId", "customRole"]),
            },
        }
        const engine = new ArgumentEngine(ARG, aLib(), customConfig)
        const snap = engine.snapshot()
        const serialized = jsonRoundTrip(snap)

        // Create a fresh engine to rollback into
        const engine2 = new ArgumentEngine(ARG, aLib())
        engine2.rollback(serialized)

        const restoredSnap = engine2.snapshot()
        expect(
            Array.isArray(restoredSnap.config!.checksumConfig!.roleFields)
        ).toBe(true)
        expect(restoredSnap.config!.checksumConfig!.roleFields).toEqual(
            expect.arrayContaining(["conclusionPremiseId", "customRole"])
        )
    })

    it("handles native JSON round-trip where snapshot serializes Sets as arrays", () => {
        const customConfig = {
            checksumConfig: {
                premiseFields: new Set(["premiseId", "createdOn"]),
                argumentFields: new Set(["id", "version"]),
            },
        }
        const engine = new ArgumentEngine(ARG, aLib(), customConfig)
        const snap = engine.snapshot()

        // Native JSON round-trip: snapshot already has arrays, so they survive
        const serialized = JSON.parse(JSON.stringify(snap)) as typeof snap

        // Verify fields survived as arrays, not empty objects
        expect(
            Array.isArray(serialized.config!.checksumConfig!.premiseFields)
        ).toBe(true)
        expect(serialized.config!.checksumConfig!.premiseFields).toEqual(
            expect.arrayContaining(["premiseId", "createdOn"])
        )
        expect(
            Array.isArray(serialized.config!.checksumConfig!.argumentFields)
        ).toBe(true)
        expect(serialized.config!.checksumConfig!.argumentFields).toEqual(
            expect.arrayContaining(["id", "version"])
        )

        // fromSnapshot should reconstruct Sets from the arrays
        const restored = ArgumentEngine.fromSnapshot(serialized, aLib())
        const restoredSnap = restored.snapshot()
        // After restoration, internal state has Sets, but snapshot serializes them back to arrays
        expect(
            Array.isArray(restoredSnap.config!.checksumConfig!.premiseFields)
        ).toBe(true)
        expect(
            Array.isArray(restoredSnap.config!.checksumConfig!.argumentFields)
        ).toBe(true)
    })

    it("fromSnapshot normalizes nested premise/expression-level configs after native JSON round-trip", () => {
        const customConfig = {
            checksumConfig: {
                expressionFields: new Set(["id", "type", "parentId"]),
                premiseFields: new Set(["id", "argumentId"]),
            },
        }
        const engine = new ArgumentEngine(ARG, aLib(), customConfig)
        engine.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
        })
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
        // Native JSON round-trip: Sets → {}
        const serialized = JSON.parse(JSON.stringify(snap)) as typeof snap

        // This should not throw — nested configs must be normalized
        const restored = ArgumentEngine.fromSnapshot(serialized, aLib())
        expect(restored.listPremiseIds()).toEqual(["p1"])
        expect(restored.getPremise("p1")!.getExpressions()).toHaveLength(1)
    })

    it("snapshot() serializes checksumConfig Sets as arrays at all levels", () => {
        const customConfig = {
            checksumConfig: {
                expressionFields: new Set(["id", "type", "parentId"]),
                premiseFields: new Set(["id", "argumentId"]),
                variableFields: new Set(["id", "symbol"]),
            },
        }
        const engine = new ArgumentEngine(ARG, aLib(), customConfig)
        engine.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
        })
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

        // Top-level config: Sets should be arrays
        const topConfig = snap.config!.checksumConfig!
        expect(Array.isArray(topConfig.premiseFields)).toBe(true)
        expect(topConfig.premiseFields).toEqual(
            expect.arrayContaining(["id", "argumentId"])
        )
        expect(Array.isArray(topConfig.variableFields)).toBe(true)
        expect(topConfig.variableFields).toEqual(
            expect.arrayContaining(["id", "symbol"])
        )

        // Variable manager config
        const varConfig = snap.variables.config!.checksumConfig!
        expect(Array.isArray(varConfig.variableFields)).toBe(true)

        // Premise-level config
        const premiseSnap = snap.premises[0]
        const premConfig = premiseSnap.config!.checksumConfig!
        expect(Array.isArray(premConfig.premiseFields)).toBe(true)

        // Expression-level config
        const exprConfig = premiseSnap.expressions.config!.checksumConfig!
        expect(Array.isArray(exprConfig.expressionFields)).toBe(true)
        expect(exprConfig.expressionFields).toEqual(
            expect.arrayContaining(["id", "type", "parentId"])
        )

        // Native JSON round-trip should preserve field names (no {} collapse)
        const serialized = JSON.parse(JSON.stringify(snap)) as typeof snap
        expect(serialized.config!.checksumConfig!.premiseFields).toEqual(
            expect.arrayContaining(["id", "argumentId"])
        )
        expect(
            serialized.premises[0].config!.checksumConfig!.premiseFields
        ).toEqual(expect.arrayContaining(["id", "argumentId"]))
        expect(
            serialized.premises[0].expressions.config!.checksumConfig!
                .expressionFields
        ).toEqual(expect.arrayContaining(["id", "type", "parentId"]))
    })

    it("rollback normalizes nested premise/expression-level configs after native JSON round-trip", () => {
        const customConfig = {
            checksumConfig: {
                expressionFields: new Set(["id", "type", "parentId"]),
                premiseFields: new Set(["id", "argumentId"]),
            },
        }
        const engine = new ArgumentEngine(ARG, aLib(), customConfig)
        engine.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
        })
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
        // Native JSON round-trip: Sets → {}
        const serialized = JSON.parse(JSON.stringify(snap)) as typeof snap

        const engine2 = new ArgumentEngine(ARG, aLib())
        // This should not throw — nested configs must be normalized
        engine2.rollback(serialized)
        expect(engine2.listPremiseIds()).toEqual(["p1"])
        expect(engine2.getPremise("p1")!.getExpressions()).toHaveLength(1)
    })
})

describe("hierarchical checksum schema", () => {
    it("expression entity includes descendantChecksum and combinedChecksum", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable(makeVar("v1", "P"))
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeVarExpr("e1", "v1", { premiseId: pm.getId() }))

        const expr = pm.getExpression("e1")!
        expect(expr).toBeDefined()
        expect(expr).toHaveProperty("checksum")
        expect(expr).toHaveProperty("descendantChecksum")
        expect(expr).toHaveProperty("combinedChecksum")
        // Leaf expression: descendantChecksum should be null
        expect(expr.descendantChecksum).toBeNull()
        // combinedChecksum should be a non-empty string
        expect(typeof expr.combinedChecksum).toBe("string")
        expect(expr.combinedChecksum.length).toBeGreaterThan(0)
    })

    it("premise entity includes descendantChecksum and combinedChecksum", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable(makeVar("v1", "P"))
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeVarExpr("e1", "v1", { premiseId: pm.getId() }))

        const premiseData = pm.toPremiseData()
        expect(premiseData).toHaveProperty("checksum")
        expect(premiseData).toHaveProperty("descendantChecksum")
        expect(premiseData).toHaveProperty("combinedChecksum")
        // descendantChecksum equals root expression's combinedChecksum
        expect(typeof premiseData.descendantChecksum).toBe("string")
        expect(typeof premiseData.combinedChecksum).toBe("string")
        expect(premiseData.combinedChecksum.length).toBeGreaterThan(0)
    })

    it("argument entity includes descendantChecksum and combinedChecksum", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        const arg = engine.getArgument()
        expect(arg).toHaveProperty("checksum")
        expect(arg).toHaveProperty("descendantChecksum")
        expect(arg).toHaveProperty("combinedChecksum")
        expect(typeof arg.combinedChecksum).toBe("string")
    })
})

describe("expression hierarchical checksums", () => {
    it("leaf expression has null descendantChecksum and combinedChecksum equals checksum", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable(makeVar("v1", "P"))
        const { result: pm } = engine.createPremise()
        pm.addExpression(makeVarExpr("e1", "v1", { premiseId: pm.getId() }))

        pm.flushChecksums()

        const expr = pm.getExpression("e1")!
        expect(expr.descendantChecksum).toBeNull()
        expect(expr.combinedChecksum).toBe(expr.checksum)
    })

    it("parent expression descendantChecksum reflects children", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable(makeVar("v1", "P"))
        engine.addVariable(makeVar("v2", "Q"))
        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        pm.addExpression(makeOpExpr("op-and", "and", { premiseId }))
        pm.addExpression(
            makeVarExpr("e-p", "v1", {
                parentId: "op-and",
                position: 0,
                premiseId,
            })
        )
        pm.addExpression(
            makeVarExpr("e-q", "v2", {
                parentId: "op-and",
                position: 1,
                premiseId,
            })
        )

        pm.flushChecksums()

        const parent = pm.getExpression("op-and")!
        const childP = pm.getExpression("e-p")!
        const childQ = pm.getExpression("e-q")!

        // Leaves should still have null descendantChecksum
        expect(childP.descendantChecksum).toBeNull()
        expect(childQ.descendantChecksum).toBeNull()

        // Parent should have non-null descendantChecksum
        expect(parent.descendantChecksum).not.toBeNull()

        // Parent combinedChecksum should differ from its meta checksum
        expect(parent.combinedChecksum).not.toBe(parent.checksum)

        // Verify exact descendantChecksum computation
        const expectedDescendant = computeHash(
            canonicalSerialize({
                [childP.id]: childP.combinedChecksum,
                [childQ.id]: childQ.combinedChecksum,
            })
        )
        expect(parent.descendantChecksum).toBe(expectedDescendant)

        // Verify exact combinedChecksum computation
        const expectedCombined = computeHash(
            parent.checksum + expectedDescendant
        )
        expect(parent.combinedChecksum).toBe(expectedCombined)
    })

    it("adding a child changes parent descendantChecksum", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable(makeVar("v1", "P"))
        engine.addVariable(makeVar("v2", "Q"))
        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        pm.addExpression(makeOpExpr("op-and", "and", { premiseId }))
        pm.addExpression(
            makeVarExpr("e-p", "v1", {
                parentId: "op-and",
                position: 0,
                premiseId,
            })
        )

        pm.flushChecksums()

        const beforeDescendant = pm.getExpression("op-and")!.descendantChecksum
        const beforeCombined = pm.getExpression("op-and")!.combinedChecksum

        // Add a second child
        pm.addExpression(
            makeVarExpr("e-q", "v2", {
                parentId: "op-and",
                position: 1,
                premiseId,
            })
        )

        pm.flushChecksums()

        const afterDescendant = pm.getExpression("op-and")!.descendantChecksum
        const afterCombined = pm.getExpression("op-and")!.combinedChecksum

        expect(afterDescendant).not.toBe(beforeDescendant)
        expect(afterCombined).not.toBe(beforeCombined)
    })
})

describe("premise hierarchical checksums", () => {
    it("premise checksum is entity-only (meta)", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable(makeVar("v1", "P"))
        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        // Capture checksum before adding any expression
        const checksumBefore = pm.checksum()

        // Add an expression — this should NOT change the meta checksum
        pm.addExpression(makeVarExpr("e1", "v1", { premiseId, parentId: null }))
        const checksumAfter = pm.checksum()

        expect(checksumAfter).toBe(checksumBefore)
    })

    it("premise descendantChecksum is null when no expressions", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        const { result: pm } = engine.createPremise()

        expect(pm.descendantChecksum()).toBeNull()
    })

    it("premise descendantChecksum equals root expression combinedChecksum", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable(makeVar("v1", "P"))
        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        pm.addExpression(makeVarExpr("e1", "v1", { premiseId, parentId: null }))

        pm.flushChecksums()

        const rootExpr = pm.getExpression("e1")!
        expect(pm.descendantChecksum()).toBe(rootExpr.combinedChecksum)
    })

    it("premise getCollectionChecksum('expressions') equals descendantChecksum", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable(makeVar("v1", "P"))
        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        pm.addExpression(makeVarExpr("e1", "v1", { premiseId, parentId: null }))

        pm.flushChecksums()

        expect(pm.getCollectionChecksum("expressions")).toBe(
            pm.descendantChecksum()
        )
    })

    it("premise combinedChecksum changes when expression tree changes", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable(makeVar("v1", "P"))
        engine.addVariable(makeVar("v2", "Q"))
        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        // Build initial tree: and(P)
        pm.addExpression(makeOpExpr("op-and", "and", { premiseId }))
        pm.addExpression(
            makeVarExpr("e-p", "v1", {
                parentId: "op-and",
                position: 0,
                premiseId,
            })
        )

        pm.flushChecksums()

        const metaBefore = pm.checksum()
        const combinedBefore = pm.combinedChecksum()

        // Add another child — this changes the expression tree
        pm.addExpression(
            makeVarExpr("e-q", "v2", {
                parentId: "op-and",
                position: 1,
                premiseId,
            })
        )

        pm.flushChecksums()

        const metaAfter = pm.checksum()
        const combinedAfter = pm.combinedChecksum()

        // Meta (entity-only) checksum should be unchanged
        expect(metaAfter).toBe(metaBefore)

        // Combined checksum should have changed (descendants changed)
        expect(combinedAfter).not.toBe(combinedBefore)
    })
})

describe("argument hierarchical checksums", () => {
    it("argument checksum includes role state", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.createPremise()
        const { result: pm2 } = engine.createPremise()

        // First premise is auto-set as conclusion; capture current meta checksum
        const before = engine.checksum()

        // Switch conclusion to pm2 — meta checksum should change
        engine.setConclusionPremise(pm2.getId())
        const after = engine.checksum()

        expect(after).not.toBe(before)
    })

    it("argument descendantChecksum is null when no premises and no variables", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        expect(engine.descendantChecksum()).toBeNull()
    })

    it("argument getCollectionChecksum('premises') changes when premise expression changes", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable(makeVar("v1", "P"))
        engine.addVariable(makeVar("v2", "Q"))
        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        // Build initial tree: and(P)
        pm.addExpression(makeOpExpr("op-and", "and", { premiseId }))
        pm.addExpression(
            makeVarExpr("e-p", "v1", {
                parentId: "op-and",
                position: 0,
                premiseId,
            })
        )

        engine.flushChecksums()
        const premisesBefore = engine.getCollectionChecksum("premises")
        expect(premisesBefore).not.toBeNull()

        // Add a second child to the operator — and(P, Q)
        pm.addExpression(
            makeVarExpr("e-q", "v2", {
                parentId: "op-and",
                position: 1,
                premiseId,
            })
        )

        engine.flushChecksums()
        const premisesAfter = engine.getCollectionChecksum("premises")

        expect(premisesAfter).not.toBe(premisesBefore)
    })

    it("argument getCollectionChecksum('variables') changes when variable is added", () => {
        const engine = new ArgumentEngine(ARG, aLib())

        engine.flushChecksums()
        const varsBefore = engine.getCollectionChecksum("variables")
        expect(varsBefore).toBeNull()

        engine.addVariable(makeVar("v1", "P"))

        engine.flushChecksums()
        const varsAfter = engine.getCollectionChecksum("variables")
        expect(varsAfter).not.toBeNull()
        expect(varsAfter).not.toBe(varsBefore)
    })

    it("argument combinedChecksum changes when deep expression added but meta stays same", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable(makeVar("v1", "P"))
        engine.addVariable(makeVar("v2", "Q"))
        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        pm.addExpression(makeOpExpr("op-and", "and", { premiseId }))
        pm.addExpression(
            makeVarExpr("e-p", "v1", {
                parentId: "op-and",
                position: 0,
                premiseId,
            })
        )

        engine.flushChecksums()
        const metaBefore = engine.checksum()
        const combinedBefore = engine.combinedChecksum()

        // Add another expression to the premise (deep mutation)
        pm.addExpression(
            makeVarExpr("e-q", "v2", {
                parentId: "op-and",
                position: 1,
                premiseId,
            })
        )

        engine.flushChecksums()
        const metaAfter = engine.checksum()
        const combinedAfter = engine.combinedChecksum()

        // Meta (entity-only) should be unchanged — no argument entity or role change
        expect(metaAfter).toBe(metaBefore)

        // Combined should have changed — descendants changed
        expect(combinedAfter).not.toBe(combinedBefore)
    })

    it("snapshot includes all three checksum fields on argument", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable(makeVar("v1", "P"))
        const { result: pm } = engine.createPremise()
        pm.addExpression(
            makeVarExpr("e1", "v1", {
                premiseId: pm.getId(),
                parentId: null,
            })
        )

        const snap = engine.snapshot()
        expect(snap.argument.checksum).toMatch(/^[0-9a-f]{8}$/)
        expect(snap.argument.descendantChecksum).not.toBeNull()
        expect(snap.argument.combinedChecksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("getArgument includes all three checksum fields", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable(makeVar("v1", "P"))
        const { result: pm } = engine.createPremise()
        pm.addExpression(
            makeVarExpr("e1", "v1", {
                premiseId: pm.getId(),
                parentId: null,
            })
        )

        const arg = engine.getArgument()
        expect(arg.checksum).toMatch(/^[0-9a-f]{8}$/)
        expect(arg.descendantChecksum).not.toBeNull()
        expect(arg.combinedChecksum).toMatch(/^[0-9a-f]{8}$/)
        expect(arg.combinedChecksum).not.toBe(arg.checksum)
    })

    it("premise mutation propagates dirty to argument checksum", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable(makeVar("v1", "P"))
        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        engine.flushChecksums()
        const combinedBefore = engine.combinedChecksum()

        // Mutate expression within premise via PremiseEngine (triggers onMutate)
        pm.addExpression(makeVarExpr("e1", "v1", { premiseId, parentId: null }))

        // The argument's checksumDirty flag should now be set via onMutate
        const combinedAfter = engine.combinedChecksum()
        expect(combinedAfter).not.toBe(combinedBefore)
    })

    it("descendantChecksum is computed from non-null collection checksums only", () => {
        const engine = new ArgumentEngine(ARG, aLib())

        // No premises, no variables — descendant is null
        expect(engine.descendantChecksum()).toBeNull()
        expect(engine.combinedChecksum()).toBe(engine.checksum())

        // Add a premise — descendant becomes non-null (auto-creates a premise-bound variable too)
        engine.createPremise()
        engine.flushChecksums()
        expect(engine.descendantChecksum()).not.toBeNull()
        expect(engine.getCollectionChecksum("premises")).not.toBeNull()
        expect(engine.getCollectionChecksum("variables")).not.toBeNull() // auto-created variable

        // Verify descendant is based on both premises and variables collections
        const expectedDescendant = computeHash(
            canonicalSerialize({
                premises: engine.getCollectionChecksum("premises"),
                variables: engine.getCollectionChecksum("variables"),
            })
        )
        expect(engine.descendantChecksum()).toBe(expectedDescendant)
    })
})

describe("checksum verification on load", () => {
    const ARG = { id: "arg-1", version: 1 }

    function makeVariable(
        id: string,
        symbol: string
    ): TOptionalChecksum<TClaimBoundVariable> {
        return {
            id,
            symbol,
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
        }
    }

    it("fromSnapshot with 'strict' passes when checksums match", () => {
        const engine = new ArgumentEngine(ARG, aLib())
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

        engine.flushChecksums()
        const snap = engine.snapshot()

        expect(() =>
            ArgumentEngine.fromSnapshot(snap, aLib(), "strict")
        ).not.toThrow()
    })

    it("fromSnapshot with 'strict' throws when expression checksum is tampered", () => {
        const engine = new ArgumentEngine(ARG, aLib())
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

        engine.flushChecksums()
        const snap = engine.snapshot()

        // Tamper with expression checksum
        snap.premises[0].expressions.expressions[0].checksum = "tampered!"

        expect(() =>
            ArgumentEngine.fromSnapshot(snap, aLib(), "strict")
        ).toThrow(/checksum mismatch/i)
    })

    it("fromSnapshot with 'ignore' (default) does not throw on tampered checksums", () => {
        const engine = new ArgumentEngine(ARG, aLib())
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

        engine.flushChecksums()
        const snap = engine.snapshot()

        // Tamper with expression checksum
        snap.premises[0].expressions.expressions[0].checksum = "tampered!"

        // Default is "ignore" — should not throw
        expect(() => ArgumentEngine.fromSnapshot(snap, aLib())).not.toThrow()
    })

    it("fromSnapshot with 'strict' throws when premise checksum is tampered", () => {
        const engine = new ArgumentEngine(ARG, aLib())
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

        engine.flushChecksums()
        const snap = engine.snapshot()

        // Tamper with premise checksum
        ;(
            snap.premises[0].premise as Record<string, unknown>
        ).combinedChecksum = "tampered!"

        expect(() =>
            ArgumentEngine.fromSnapshot(snap, aLib(), "strict")
        ).toThrow(/checksum mismatch/i)
    })

    it("fromSnapshot with 'strict' throws when argument checksum is tampered", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable(makeVariable("v1", "P"))
        engine.createPremiseWithId("p1")

        engine.flushChecksums()
        const snap = engine.snapshot()

        // Tamper with argument checksum
        ;(snap.argument as Record<string, unknown>).combinedChecksum =
            "tampered!"

        expect(() =>
            ArgumentEngine.fromSnapshot(snap, aLib(), "strict")
        ).toThrow(/checksum mismatch/i)
    })

    it("fromSnapshot with 'strict' throws when variable checksum is tampered", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable(makeVariable("v1", "P"))
        engine.createPremiseWithId("p1")

        engine.flushChecksums()
        const snap = engine.snapshot()

        // Tamper with variable checksum
        ;(snap.variables.variables[0] as Record<string, unknown>).checksum =
            "tampered!"

        expect(() =>
            ArgumentEngine.fromSnapshot(snap, aLib(), "strict")
        ).toThrow(/checksum mismatch/i)
    })

    it("fromData with 'strict' passes when checksums match", () => {
        const engine = new ArgumentEngine(ARG, aLib())
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

        engine.flushChecksums()
        const snap = engine.snapshot()

        // Extract flat data from snapshot
        const argData = snap.argument
        const variables = snap.variables.variables
        const premises = [snap.premises[0].premise]
        const expressions = snap.premises[0].expressions.expressions

        expect(() =>
            ArgumentEngine.fromData(
                argData,
                aLib(),
                variables,
                premises,
                expressions,
                {},
                snap.config,
                "strict"
            )
        ).not.toThrow()
    })

    it("fromData with 'strict' throws when variable checksum is tampered", () => {
        const engine = new ArgumentEngine(ARG, aLib())
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

        engine.flushChecksums()
        const snap = engine.snapshot()

        // Extract flat data from snapshot
        const argData = snap.argument
        const variables = snap.variables.variables.map((v) => ({
            ...v,
            checksum: "tampered!",
        }))
        const premises = [snap.premises[0].premise]
        const expressions = snap.premises[0].expressions.expressions

        expect(() =>
            ArgumentEngine.fromData(
                argData,
                aLib(),
                variables,
                premises,
                expressions,
                {},
                snap.config,
                "strict"
            )
        ).toThrow(/checksum mismatch/i)
    })
})

// ---------------------------------------------------------------------------
// hierarchical checksum propagation (end-to-end)
// ---------------------------------------------------------------------------

describe("hierarchical checksum propagation", () => {
    it("deep expression change propagates to premise and argument", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable(makeVar("v1", "P"))
        engine.addVariable(makeVar("v2", "Q"))
        engine.addVariable(makeVar("v3", "R"))
        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        // Build: and(P, formula(or(Q, placeholder)))
        // We need `or` to have 2 children to avoid collapse later, so add Q and a dummy
        // Actually, we need: and(P, formula(or(Q)))
        // and is root with 2 children: P (pos 0), formula (pos 1)
        // formula has 1 child: or
        // or has 1 child: Q
        pm.addExpression(makeOpExpr("e-and", "and", { premiseId }))
        pm.addExpression(
            makeVarExpr("e-p", "v1", {
                parentId: "e-and",
                position: 0,
                premiseId,
            })
        )
        pm.addExpression(
            makeFormulaExpr("e-formula", {
                parentId: "e-and",
                position: 1,
                premiseId,
            })
        )
        pm.addExpression(
            makeOpExpr("e-or", "or", {
                parentId: "e-formula",
                position: 0,
                premiseId,
            })
        )
        pm.addExpression(
            makeVarExpr("e-q", "v2", {
                parentId: "e-or",
                position: 0,
                premiseId,
            })
        )

        // Flush and capture all combinedChecksums
        engine.flushChecksums()

        const orBefore = pm.getExpression("e-or")!.combinedChecksum
        const formulaBefore = pm.getExpression("e-formula")!.combinedChecksum
        const andBefore = pm.getExpression("e-and")!.combinedChecksum
        const premiseMetaBefore = pm.checksum()
        const premiseCombinedBefore = pm.combinedChecksum()
        const argMetaBefore = engine.checksum()
        const argCombinedBefore = engine.combinedChecksum()

        // Mutate: add R to the `or` node
        pm.addExpression(
            makeVarExpr("e-r", "v3", {
                parentId: "e-or",
                position: 1,
                premiseId,
            })
        )

        engine.flushChecksums()

        // `or` node's combinedChecksum changed (got a new child)
        expect(pm.getExpression("e-or")!.combinedChecksum).not.toBe(orBefore)
        // `formula` node's combinedChecksum changed (its child `or` changed)
        expect(pm.getExpression("e-formula")!.combinedChecksum).not.toBe(
            formulaBefore
        )
        // `and` root's combinedChecksum changed
        expect(pm.getExpression("e-and")!.combinedChecksum).not.toBe(andBefore)
        // Premise combinedChecksum changed
        expect(pm.combinedChecksum()).not.toBe(premiseCombinedBefore)
        // Argument combinedChecksum changed
        expect(engine.combinedChecksum()).not.toBe(argCombinedBefore)
        // But premise meta checksum is unchanged
        expect(pm.checksum()).toBe(premiseMetaBefore)
        // And argument meta checksum is unchanged
        expect(engine.checksum()).toBe(argMetaBefore)
    })

    it("operator collapse after removeExpression doesn't break flush", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable(makeVar("v1", "P"))
        engine.addVariable(makeVar("v2", "Q"))
        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        // Build: and(P, Q)
        pm.addExpression(makeOpExpr("e-and", "and", { premiseId }))
        pm.addExpression(
            makeVarExpr("e-p", "v1", {
                parentId: "e-and",
                position: 0,
                premiseId,
            })
        )
        pm.addExpression(
            makeVarExpr("e-q", "v2", {
                parentId: "e-and",
                position: 1,
                premiseId,
            })
        )

        engine.flushChecksums()

        const premiseCombinedBefore = pm.combinedChecksum()
        const argCombinedBefore = engine.combinedChecksum()

        // Remove Q — triggers operator collapse: `and` is deleted, P is promoted to root
        pm.removeExpression("e-q", true)

        // flushChecksums should not throw
        expect(() => engine.flushChecksums()).not.toThrow()

        // P is now root (parentId === null)
        const pExpr = pm.getExpression("e-p")!
        expect(pExpr.parentId).toBeNull()

        // P has descendantChecksum === null (still a leaf)
        expect(pExpr.descendantChecksum).toBeNull()

        // Premise and argument combinedChecksums changed from before removal
        expect(pm.combinedChecksum()).not.toBe(premiseCombinedBefore)
        expect(engine.combinedChecksum()).not.toBe(argCombinedBefore)
    })

    it("insertExpression propagates checksum changes", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable(makeVar("v1", "P"))
        engine.addVariable(makeVar("v2", "Q"))
        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        // Build: and(P, Q)
        pm.addExpression(makeOpExpr("e-and", "and", { premiseId }))
        pm.addExpression(
            makeVarExpr("e-p", "v1", {
                parentId: "e-and",
                position: 0,
                premiseId,
            })
        )
        pm.addExpression(
            makeVarExpr("e-q", "v2", {
                parentId: "e-and",
                position: 1,
                premiseId,
            })
        )

        engine.flushChecksums()
        const combinedBefore = engine.combinedChecksum()

        // Insert `not` wrapping variable P — `not` is exempt from the
        // operator-nesting restriction, so this is valid as a child of `and`.
        pm.insertExpression(makeOpExpr("e-not", "not", { premiseId }), "e-p")

        engine.flushChecksums()
        const combinedAfter = engine.combinedChecksum()

        expect(combinedAfter).not.toBe(combinedBefore)
    })

    it("variable mutation changes argument but not premise combinedChecksum", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable(makeVar("v1", "P"))
        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        pm.addExpression(
            makeVarExpr("e-p", "v1", { premiseId, parentId: null })
        )

        engine.flushChecksums()

        const argCombinedBefore = engine.combinedChecksum()
        const premiseCombinedBefore = pm.combinedChecksum()

        // Add a second variable (argument-scoped, not premise-scoped)
        engine.addVariable(makeVar("v2", "Q"))

        engine.flushChecksums()

        // Argument combinedChecksum changed (variables collection changed)
        expect(engine.combinedChecksum()).not.toBe(argCombinedBefore)
        // Premise combinedChecksum unchanged (variables are argument-scoped)
        expect(pm.combinedChecksum()).toBe(premiseCombinedBefore)
    })

    it("snapshot round-trip preserves all hierarchical checksums", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable(makeVar("v1", "P"))
        engine.addVariable(makeVar("v2", "Q"))
        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        pm.addExpression(makeOpExpr("e-and", "and", { premiseId }))
        pm.addExpression(
            makeVarExpr("e-p", "v1", {
                parentId: "e-and",
                position: 0,
                premiseId,
            })
        )
        pm.addExpression(
            makeVarExpr("e-q", "v2", {
                parentId: "e-and",
                position: 1,
                premiseId,
            })
        )

        engine.flushChecksums()

        // Capture all checksums from the original engine
        const origArgChecksum = engine.checksum()
        const origArgDescendant = engine.descendantChecksum()
        const origArgCombined = engine.combinedChecksum()
        const origPremiseChecksum = pm.checksum()
        const origPremiseDescendant = pm.descendantChecksum()
        const origPremiseCombined = pm.combinedChecksum()

        // Snapshot and restore
        const snap = engine.snapshot()
        const restored = ArgumentEngine.fromSnapshot(snap, aLib())

        restored.flushChecksums()

        // Verify all three checksum values match
        expect(restored.checksum()).toBe(origArgChecksum)
        expect(restored.descendantChecksum()).toBe(origArgDescendant)
        expect(restored.combinedChecksum()).toBe(origArgCombined)

        const restoredPm = restored.getPremise(premiseId)!
        expect(restoredPm.checksum()).toBe(origPremiseChecksum)
        expect(restoredPm.descendantChecksum()).toBe(origPremiseDescendant)
        expect(restoredPm.combinedChecksum()).toBe(origPremiseCombined)
    })

    it("removeVariable cascades through to checksums", () => {
        const engine = new ArgumentEngine(ARG, aLib())
        engine.addVariable(makeVar("v1", "P"))
        engine.addVariable(makeVar("v2", "Q"))
        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        // Build: and(P, Q)
        pm.addExpression(makeOpExpr("e-and", "and", { premiseId }))
        pm.addExpression(
            makeVarExpr("e-p", "v1", {
                parentId: "e-and",
                position: 0,
                premiseId,
            })
        )
        pm.addExpression(
            makeVarExpr("e-q", "v2", {
                parentId: "e-and",
                position: 1,
                premiseId,
            })
        )

        engine.flushChecksums()
        const argCombinedBefore = engine.combinedChecksum()

        // Remove variable Q — cascades: Q's variable expression is deleted,
        // `and` collapses (only P left), P is promoted to root
        engine.removeVariable("v2")

        // No errors during flush (deleted expressions properly pruned from dirty set)
        expect(() => engine.flushChecksums()).not.toThrow()

        // Argument combinedChecksum changed
        expect(engine.combinedChecksum()).not.toBe(argCombinedBefore)
    })
})

// ---------------------------------------------------------------------------
// changeset hierarchical checksums
// ---------------------------------------------------------------------------

describe("changeset hierarchical checksums", () => {
    it("wrapExpression changeset has correct hierarchical checksums", () => {
        const pm = premiseWithVars()
        const premiseId = pm.getId()

        // Single root variable expression — wrapping it with "and" creates an operator with 2 children
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))

        // Wrap expr-p with an "and" operator plus a new sibling expr-q
        const { changes } = pm.wrapExpression(
            {
                id: "op-and",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                premiseId,
                type: "operator",
                operator: "and",
            } as TExpressionWithoutPosition,
            {
                id: "expr-q",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                premiseId,
                type: "variable",
                variableId: VAR_Q.id,
            } as TExpressionWithoutPosition,
            "expr-p"
        )

        // The new "and" operator should have correct hierarchical checksums
        const addedAnd = changes.expressions!.added.find(
            (e) => e.id === "op-and"
        )!
        expect(addedAnd).toBeDefined()
        // Before fix: descendantChecksum is null because attachChecksum always sets it null
        // After fix: descendantChecksum should reflect children (expr-p, expr-q)
        expect(addedAnd.descendantChecksum).not.toBeNull()
        expect(addedAnd.combinedChecksum).not.toBe(addedAnd.checksum)

        // Cross-check: flushed engine state should agree with changeset
        const flushedAnd = pm.getExpression("op-and")!
        expect(addedAnd.combinedChecksum).toBe(flushedAnd.combinedChecksum)
        expect(addedAnd.descendantChecksum).toBe(flushedAnd.descendantChecksum)
    })

    it("toggleNegation changeset has correct hierarchical checksums", () => {
        const pm = premiseWithVars()

        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))

        const { result: notExpr, changes } = pm.toggleNegation("expr-p")

        // The new NOT operator should have correct hierarchical checksums
        expect(notExpr).not.toBeNull()
        const addedNot = changes.expressions!.added.find(
            (e) => e.id === notExpr!.id
        )!
        expect(addedNot).toBeDefined()
        expect(addedNot.descendantChecksum).not.toBeNull()
        expect(addedNot.combinedChecksum).not.toBe(addedNot.checksum)

        // Cross-check with flushed engine state
        const flushedNot = pm.getExpression(notExpr!.id)!
        expect(addedNot.combinedChecksum).toBe(flushedNot.combinedChecksum)
        expect(addedNot.descendantChecksum).toBe(flushedNot.descendantChecksum)
    })

    it("addExpression changeset has correct ancestor checksums", () => {
        const pm = premiseWithVars()

        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-and",
                position: 0,
            })
        )

        // Adding a second child should update the parent's checksums in the changeset
        const { changes } = pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-and",
                position: 1,
            })
        )

        // The parent operator should be in modified with updated descendantChecksum
        const modifiedAnd = changes.expressions?.modified?.find(
            (e) => e.id === "op-and"
        )
        if (modifiedAnd) {
            const flushedAnd = pm.getExpression("op-and")!
            expect(modifiedAnd.combinedChecksum).toBe(
                flushedAnd.combinedChecksum
            )
            expect(modifiedAnd.descendantChecksum).toBe(
                flushedAnd.descendantChecksum
            )
        }

        // The added expression itself should match flushed state
        const addedQ = changes.expressions!.added.find(
            (e) => e.id === "expr-q"
        )!
        const flushedQ = pm.getExpression("expr-q")!
        expect(addedQ.combinedChecksum).toBe(flushedQ.combinedChecksum)
    })

    it("insertExpression changeset has correct hierarchical checksums", () => {
        const pm = premiseWithVars()
        const premiseId = pm.getId()

        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))

        // Insert a NOT operator between root and expr-p
        const { changes } = pm.insertExpression(
            {
                id: "op-not",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                premiseId,
                type: "operator",
                operator: "not",
                parentId: null,
                position: POSITION_INITIAL,
            },
            "expr-p"
        )

        const addedNot = changes.expressions!.added.find(
            (e) => e.id === "op-not"
        )!
        expect(addedNot).toBeDefined()
        expect(addedNot.descendantChecksum).not.toBeNull()
        expect(addedNot.combinedChecksum).not.toBe(addedNot.checksum)

        // Cross-check with flushed engine state
        const flushedNot = pm.getExpression("op-not")!
        expect(addedNot.combinedChecksum).toBe(flushedNot.combinedChecksum)
        expect(addedNot.descendantChecksum).toBe(flushedNot.descendantChecksum)
    })

    it("removeExpression changeset has correct checksums after collapse", () => {
        const pm = premiseWithVars()

        // Build: and(P, Q)
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-and",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-and",
                position: 1,
            })
        )

        // Remove Q — and collapses, promoting P
        const { changes } = pm.removeExpression("expr-q", true)

        // P should be modified (promoted to root) — verify checksums match flushed state
        const modifiedP = changes.expressions?.modified?.find(
            (e) => e.id === "expr-p"
        )
        if (modifiedP) {
            const flushedP = pm.getExpression("expr-p")!
            expect(modifiedP.combinedChecksum).toBe(flushedP.combinedChecksum)
        }
    })

    it("updateExpression changeset has correct ancestor checksums", () => {
        const pm = premiseWithVars()

        // Build: and(P, Q)
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-and",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-and",
                position: 1,
            })
        )

        // Change "and" to "or" — this modifies the operator
        const { changes } = pm.updateExpression("op-and", { operator: "or" })

        const modifiedOr = changes.expressions?.modified?.find(
            (e) => e.id === "op-and"
        )
        if (modifiedOr) {
            const flushedOr = pm.getExpression("op-and")!
            expect(modifiedOr.combinedChecksum).toBe(flushedOr.combinedChecksum)
            expect(modifiedOr.descendantChecksum).toBe(
                flushedOr.descendantChecksum
            )
        }
    })
})

// ---------------------------------------------------------------------------
// premise checksum in changeset
// ---------------------------------------------------------------------------

describe("premise checksum in changeset", () => {
    it("addExpression changeset includes premise with updated checksum", () => {
        const pm = premiseWithVars()
        const premiseBefore = pm.toPremiseData()

        const { changes } = pm.addExpression(makeVarExpr("expr-p", VAR_P.id))

        expect(changes.premises?.modified).toHaveLength(1)
        const premiseInChangeset = changes.premises!.modified[0]
        expect(premiseInChangeset.id).toBe(pm.getId())
        // Premise checksum changed because it now has an expression
        expect(premiseInChangeset.combinedChecksum).not.toBe(
            premiseBefore.combinedChecksum
        )
        // The changeset premise matches the engine's current state
        expect(premiseInChangeset.combinedChecksum).toBe(pm.combinedChecksum())
        expect(premiseInChangeset.descendantChecksum).toBe(
            pm.descendantChecksum()
        )
    })

    it("removeExpression changeset includes premise update", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))

        const { changes } = pm.removeExpression("expr-p", true)

        expect(changes.premises?.modified).toHaveLength(1)
        expect(changes.premises!.modified[0].combinedChecksum).toBe(
            pm.combinedChecksum()
        )
    })

    it("wrapExpression changeset includes premise update", () => {
        const pm = premiseWithVars()
        const premiseId = pm.getId()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))

        const { changes } = pm.wrapExpression(
            {
                id: "op-and",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                premiseId,
                type: "operator",
                operator: "and",
            } as TExpressionWithoutPosition,
            {
                id: "expr-q",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                premiseId,
                type: "variable",
                variableId: VAR_Q.id,
            } as TExpressionWithoutPosition,
            "expr-p"
        )

        expect(changes.premises?.modified).toHaveLength(1)
    })

    it("toggleNegation changeset includes premise update", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))

        const { changes } = pm.toggleNegation("expr-p")

        expect(changes.premises?.modified).toHaveLength(1)
        const premiseData = changes.premises!.modified[0]
        expect(premiseData.checksum).toBe(pm.checksum())
        expect(premiseData.descendantChecksum).toBe(pm.descendantChecksum())
        expect(premiseData.combinedChecksum).toBe(pm.combinedChecksum())
    })

    it("insertExpression changeset includes premise update", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))

        const { changes } = pm.insertExpression(
            {
                id: "op-not",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                premiseId: pm.getId(),
                type: "operator",
                operator: "not",
                parentId: null,
                position: POSITION_INITIAL,
            },
            "expr-p"
        )

        expect(changes.premises?.modified).toHaveLength(1)
        expect(changes.premises!.modified[0].combinedChecksum).toBe(
            pm.combinedChecksum()
        )
    })

    it("updateExpression with no effective change omits premise", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-and",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-and",
                position: 1,
            })
        )
        // Flush checksums so the "before" snapshot is stable
        pm.flushChecksums()

        // updateExpression with no actual field changes
        const { changes } = pm.updateExpression("op-and", {})

        // If nothing changed, no premise entry
        expect(changes.premises?.modified ?? []).toHaveLength(0)
    })

    it("changeOperator changeset includes premise update", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-and",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-and",
                position: 1,
            })
        )

        const { changes } = pm.changeOperator("op-and", "or")

        expect(changes.premises?.modified).toHaveLength(1)
        expect(changes.premises!.modified[0].combinedChecksum).toBe(
            pm.combinedChecksum()
        )
    })
})

// ---------------------------------------------------------------------------
// changeOperator
// ---------------------------------------------------------------------------

describe("changeOperator", () => {
    // --- No-op ---

    it("no-op when operator already matches", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-and",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-and",
                position: 1,
            })
        )

        const { result, changes } = pm.changeOperator("op-and", "and")

        expect(result).not.toBeNull()
        expect(result!.id).toBe("op-and")
        expect(changes.expressions).toBeUndefined()
    })

    // --- Simple change ---

    it("simple change: AND(P, Q) → OR(P, Q)", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-and",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-and",
                position: 1,
            })
        )

        const { result, changes } = pm.changeOperator("op-and", "or")

        expect(result).not.toBeNull()
        expect(result!.type).toBe("operator")
        if (result!.type === "operator") {
            expect(result!.operator).toBe("or")
        }
        expect(changes.expressions!.modified.length).toBeGreaterThanOrEqual(1)
        expect(pm.toDisplayString()).toBe("(P ∨ Q)")
    })

    it("simple change: implies(P, Q) → iff(P, Q)", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-imp", "implies"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-imp",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-imp",
                position: 1,
            })
        )

        const { result } = pm.changeOperator("op-imp", "iff")

        expect(result).not.toBeNull()
        if (result!.type === "operator") {
            expect(result!.operator).toBe("iff")
        }
        expect(pm.toDisplayString()).toBe("(P ↔ Q)")
    })

    it("simple change preserves children and positions", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-and",
                position: -100,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-and",
                position: 100,
            })
        )

        pm.changeOperator("op-and", "or")

        const children = pm.getChildExpressions("op-and")
        expect(children).toHaveLength(2)
        expect(children[0].id).toBe("expr-p")
        expect(children[0].position).toBe(-100)
        expect(children[1].id).toBe("expr-q")
        expect(children[1].position).toBe(100)
    })

    it("simple change has correct hierarchical checksums", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-and",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-and",
                position: 1,
            })
        )

        const { changes } = pm.changeOperator("op-and", "or")

        const modifiedOr = changes.expressions!.modified.find(
            (e) => e.id === "op-and"
        )!
        expect(modifiedOr).toBeDefined()
        const flushedOr = pm.getExpression("op-and")!
        expect(modifiedOr.combinedChecksum).toBe(flushedOr.combinedChecksum)
        expect(modifiedOr.descendantChecksum).toBe(flushedOr.descendantChecksum)
    })

    // --- Merge (no longer triggers for 2-child operators) ---

    it("absorbs: OR(formula(AND(P, Q)), R) → change AND to OR yields OR(P, Q, R)", () => {
        const pm = premiseWithVars()
        // Build: OR( formula(AND(P, Q)), R )
        pm.addExpression(makeOpExpr("op-or", "or"))
        pm.addExpression(
            makeFormulaExpr("formula-1", {
                parentId: "op-or",
                position: 0,
            })
        )
        pm.addExpression(
            makeOpExpr("op-and", "and", {
                parentId: "formula-1",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-and",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-and",
                position: 1,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-r", VAR_R.id, {
                parentId: "op-or",
                position: 1,
            })
        )

        pm.changeOperator("op-and", "or")

        // Formula and inner operator dissolved — absorbed into outer OR
        expect(pm.getExpression("formula-1")).toBeUndefined()
        expect(pm.getExpression("op-and")).toBeUndefined()

        // Outer OR now has 3 children: P, Q, R
        const outerChildren = pm.getChildExpressions("op-or")
        expect(outerChildren).toHaveLength(3)
        const childIds = outerChildren.map((c) => c.id)
        expect(childIds).toContain("expr-p")
        expect(childIds).toContain("expr-q")
        expect(childIds).toContain("expr-r")
    })

    it("absorbs: formula dissolved when inner operator changes to match parent", () => {
        const pm = premiseWithVars()
        // Build: OR( formula(AND(P, Q)), R )
        pm.addExpression(makeOpExpr("op-or", "or"))
        pm.addExpression(
            makeFormulaExpr("formula-1", {
                parentId: "op-or",
                position: 0,
            })
        )
        pm.addExpression(
            makeOpExpr("op-and", "and", {
                parentId: "formula-1",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-and",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-and",
                position: 1,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-r", VAR_R.id, {
                parentId: "op-or",
                position: 1,
            })
        )

        pm.changeOperator("op-and", "or")

        // Formula dissolved — absorbed into outer OR
        expect(pm.getExpression("formula-1")).toBeUndefined()
    })

    // --- Split ---

    it("split: AND(P, Q, R) → AND(formula(OR(P, Q)), R)", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-and",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-and",
                position: 1,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-r", VAR_R.id, {
                parentId: "op-and",
                position: 2,
            })
        )

        const { result, changes } = pm.changeOperator(
            "op-and",
            "or",
            "expr-p",
            "expr-q"
        )

        // New sub-operator created
        expect(result).not.toBeNull()
        if (result!.type === "operator") {
            expect(result!.operator).toBe("or")
        }

        // Formula buffer inserted between AND and new OR
        const addedFormula = changes.expressions!.added.find(
            (e) => e.type === "formula"
        )
        expect(addedFormula).toBeDefined()
        expect(addedFormula!.parentId).toBe("op-and")

        const addedOr = changes.expressions!.added.find(
            (e) => e.type === "operator"
        )
        expect(addedOr).toBeDefined()
        expect(addedOr!.parentId).toBe(addedFormula!.id)

        // P and Q are children of new OR
        const orChildren = pm.getChildExpressions(result!.id)
        expect(orChildren).toHaveLength(2)

        // AND still has 2 children (formula(OR) + R)
        const andChildren = pm.getChildExpressions("op-and")
        expect(andChildren).toHaveLength(2)
    })

    it("split requires sourceChildId and targetChildId for >2 children", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-and",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-and",
                position: 1,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-r", VAR_R.id, {
                parentId: "op-and",
                position: 2,
            })
        )

        expect(() => pm.changeOperator("op-and", "or")).toThrow()
    })

    it("split rejects sourceChildId/targetChildId that are not children", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-and",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-and",
                position: 1,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-r", VAR_R.id, {
                parentId: "op-and",
                position: 2,
            })
        )

        expect(() =>
            pm.changeOperator("op-and", "or", "expr-p", "nonexistent")
        ).toThrow()
    })

    it("split changeset has correct hierarchical checksums", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-and",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-and",
                position: 1,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-r", VAR_R.id, {
                parentId: "op-and",
                position: 2,
            })
        )

        const { changes } = pm.changeOperator(
            "op-and",
            "or",
            "expr-p",
            "expr-q"
        )

        const newOp = changes.expressions!.added.find(
            (e) => e.type === "operator"
        )!
        expect(newOp.descendantChecksum).not.toBeNull()
        expect(newOp.combinedChecksum).not.toBe(newOp.checksum)

        // Cross-check with flushed engine state
        const flushedOp = pm.getExpression(newOp.id)!
        expect(newOp.combinedChecksum).toBe(flushedOp.combinedChecksum)
        expect(newOp.descendantChecksum).toBe(flushedOp.descendantChecksum)
    })

    it("split applies extraFields to created expressions", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-and",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-and",
                position: 1,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-r", VAR_R.id, {
                parentId: "op-and",
                position: 2,
            })
        )

        const { changes } = pm.changeOperator(
            "op-and",
            "or",
            "expr-p",
            "expr-q",
            { creatorId: "user-42" } as Partial<TCorePropositionalExpression>
        )

        for (const expr of changes.expressions!.added) {
            expect((expr as Record<string, unknown>).creatorId).toBe("user-42")
        }
    })

    // --- No-merge for 2-child operators ---

    it("absorbs: AND(formula(OR(P, Q)), R) → change OR to AND yields AND(P, Q, R)", () => {
        const pm = premiseWithVars()
        // Build: AND( formula(OR(P, Q)), R )
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeFormulaExpr("formula-1", {
                parentId: "op-and",
                position: 0,
            })
        )
        pm.addExpression(
            makeOpExpr("op-or", "or", {
                parentId: "formula-1",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-or",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-or",
                position: 1,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-r", VAR_R.id, {
                parentId: "op-and",
                position: 1,
            })
        )

        pm.changeOperator("op-or", "and")

        // Formula and inner operator dissolved — absorbed into outer AND
        expect(pm.getExpression("formula-1")).toBeUndefined()
        expect(pm.getExpression("op-or")).toBeUndefined()

        // Outer AND now has 3 children: P, Q, R
        const outerChildren = pm.getChildExpressions("op-and")
        expect(outerChildren).toHaveLength(3)
        const childIds = outerChildren.map((c) => c.id)
        expect(childIds).toContain("expr-p")
        expect(childIds).toContain("expr-q")
        expect(childIds).toContain("expr-r")

        // Positions are strictly increasing
        for (let i = 1; i < outerChildren.length; i++) {
            expect(outerChildren[i].position).toBeGreaterThan(
                outerChildren[i - 1].position
            )
        }
    })

    it("no merge: OR(formula(OR(P, Q)), R) → change inner OR to AND yields OR(formula(AND(P, Q)), R)", () => {
        const pm = premiseWithVars()
        // Build: OR( formula(OR(P, Q)), R )
        pm.addExpression(makeOpExpr("op-or-outer", "or"))
        pm.addExpression(
            makeFormulaExpr("formula-1", {
                parentId: "op-or-outer",
                position: 0,
            })
        )
        pm.addExpression(
            makeOpExpr("op-or-inner", "or", {
                parentId: "formula-1",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-or-inner",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-or-inner",
                position: 1,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-r", VAR_R.id, {
                parentId: "op-or-outer",
                position: 1,
            })
        )

        const { result } = pm.changeOperator("op-or-inner", "and")

        // Should be a simple change, not a merge
        expect(result).not.toBeNull()
        expect(result!.id).toBe("op-or-inner")
        if (result!.type === "operator") {
            expect(result!.operator).toBe("and")
        }

        // Structure preserved: outer OR still has 2 children
        const outerChildren = pm.getChildExpressions("op-or-outer")
        expect(outerChildren).toHaveLength(2)

        // Inner operator still has 2 children
        const innerChildren = pm.getChildExpressions("op-or-inner")
        expect(innerChildren).toHaveLength(2)
    })

    it("absorbs with tight positions: AND(P, formula(OR(Q, R)), S) at 0,1,2", () => {
        const pm = premiseWithVars()
        // Build: AND(P(0), formula(OR(Q, R))(1), S(2))
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-and",
                position: 0,
            })
        )
        pm.addExpression(
            makeFormulaExpr("formula-1", {
                parentId: "op-and",
                position: 1,
            })
        )
        pm.addExpression(
            makeOpExpr("op-or", "or", {
                parentId: "formula-1",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-or",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-r", VAR_R.id, {
                parentId: "op-or",
                position: 1,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-s", VAR_P.id, {
                parentId: "op-and",
                position: 2,
            })
        )

        pm.changeOperator("op-or", "and")

        // Should absorb — AND(P, Q, R, S)
        expect(pm.getExpression("formula-1")).toBeUndefined()
        expect(pm.getExpression("op-or")).toBeUndefined()

        const children = pm.getChildExpressions("op-and")
        expect(children).toHaveLength(4)

        // All positions strictly increasing (redistribution handled tight gap)
        for (let i = 1; i < children.length; i++) {
            expect(children[i].position).toBeGreaterThan(
                children[i - 1].position
            )
        }
    })

    // --- Error cases ---

    it("throws if expressionId not found", () => {
        const pm = premiseWithVars()
        expect(() => pm.changeOperator("nonexistent", "or")).toThrow()
    })

    it("throws if expression is not an operator", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() => pm.changeOperator("expr-p", "or")).toThrow()
    })
})

// ---------------------------------------------------------------------------
// toggleNegation extraFields
// ---------------------------------------------------------------------------

describe("toggleNegation extraFields", () => {
    it("merges extraFields into the NOT expression (variable target)", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))

        const { result: notExpr } = pm.toggleNegation("expr-p", {
            creatorId: "user-42",
        } as Partial<TCorePropositionalExpression>)

        expect(notExpr).not.toBeNull()
        expect((notExpr as Record<string, unknown>).creatorId).toBe("user-42")

        // Persisted in the store too
        const stored = pm.getExpression(notExpr!.id)!
        expect((stored as Record<string, unknown>).creatorId).toBe("user-42")
    })

    it("merges extraFields into the NOT expression (operator target with formula buffer)", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-and",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-and",
                position: 1,
            })
        )

        const { result: notExpr, changes } = pm.toggleNegation("op-and", {
            creatorId: "user-42",
        } as Partial<TCorePropositionalExpression>)

        expect(notExpr).not.toBeNull()
        expect((notExpr as Record<string, unknown>).creatorId).toBe("user-42")

        // The formula buffer should also get extraFields
        const formulaExpr = changes.expressions!.added.find(
            (e) => e.type === "formula"
        )
        expect(formulaExpr).toBeDefined()
        expect((formulaExpr as Record<string, unknown>).creatorId).toBe(
            "user-42"
        )
    })

    it("extraFields in changeset expressions have correct checksums", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))

        const { result: notExpr, changes } = pm.toggleNegation("expr-p", {
            creatorId: "user-42",
        } as Partial<TCorePropositionalExpression>)

        const addedNot = changes.expressions!.added.find(
            (e) => e.id === notExpr!.id
        )!
        // Extra fields should be in the changeset expression
        expect((addedNot as Record<string, unknown>).creatorId).toBe("user-42")

        // Checksums should still be correct (hierarchical flush works with extra fields)
        expect(addedNot.descendantChecksum).not.toBeNull()
        const flushedNot = pm.getExpression(notExpr!.id)!
        expect(addedNot.combinedChecksum).toBe(flushedNot.combinedChecksum)
    })

    it("does not merge extraFields when removing negation", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        pm.toggleNegation("expr-p")

        // Removing negation — extraFields should be accepted but not cause issues
        const { result } = pm.toggleNegation("expr-p", {
            creatorId: "user-42",
        } as Partial<TCorePropositionalExpression>)

        // Result is null (negation removed), no error thrown
        expect(result).toBeNull()
        expect(pm.toDisplayString()).toBe("P")
    })

    it("extraFields do not override structural fields (type, operator, parentId)", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))

        // Attempt to override type and operator — should be ignored
        const { result: notExpr } = pm.toggleNegation("expr-p", {
            type: "variable",
            operator: "and",
        } as Partial<TCorePropositionalExpression>)

        expect(notExpr).not.toBeNull()
        // Structural fields should not be overridden
        expect(notExpr!.type).toBe("operator")
        if (notExpr!.type === "operator") {
            expect(notExpr!.operator).toBe("not")
        }
    })

    it("omitting extraFields preserves existing behavior", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))

        const { result: notExpr } = pm.toggleNegation("expr-p")

        expect(notExpr).not.toBeNull()
        expect(notExpr!.type).toBe("operator")
        if (notExpr!.type === "operator") {
            expect(notExpr!.operator).toBe("not")
        }
    })
})

describe("forkArgument", () => {
    it("canFork rejects when overridden to return false", () => {
        class NoForkEngine extends ArgumentEngine {
            public override canFork(): boolean {
                return false
            }
        }
        const eng = new NoForkEngine(ARG, aLib())
        expect(eng.canFork()).toBe(false)
    })

    it("forks a simple argument with new IDs", () => {
        const claimLib = aLib()

        const eng = new ArgumentEngine(ARG, claimLib)
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise()
        const premiseId = pm.getId()

        // Add a root variable expression
        const exprInput = makeVarExpr("expr-1", "var-p", {
            premiseId,
        })
        pm.addExpression(exprInput)

        // Set conclusion
        eng.setConclusionPremise(premiseId)

        // Fork
        const forkClaimLib = aLib()

        let idCounter = 0
        const { engine: forked, remapTable } = forkArgumentEngine(
            eng,
            "forked-arg",
            {
                claimLibrary: forkClaimLib,
            },
            { generateId: () => `gen-${++idCounter}` }
        )

        // Verify argument identity
        const forkedArg = forked.getArgument()
        expect(forkedArg.id).toBe("forked-arg")
        expect(forkedArg.version).toBe(0)

        // Verify remap table
        expect(remapTable.argumentId).toEqual({
            from: ARG.id,
            to: "forked-arg",
        })
        expect(remapTable.premises.size).toBe(1)
        expect(remapTable.expressions.size).toBe(1)
        expect(remapTable.variables.size).toBe(2) // VAR_P + 1 auto premise-bound

        // Verify premise was remapped
        const forkedPremises = forked.listPremises()
        expect(forkedPremises).toHaveLength(1)
        const forkedPremise = forkedPremises[0]
        const forkedPremiseId = forkedPremise.getId()
        expect(forkedPremiseId).not.toBe(premiseId)
        expect(remapTable.premises.get(premiseId)).toBe(forkedPremiseId)

        // Verify expression was remapped
        const forkedExprs = forkedPremise.getExpressions()
        expect(forkedExprs).toHaveLength(1)
        const forkedExpr = forkedExprs[0]
        expect(forkedExpr.id).not.toBe("expr-1")
        expect(remapTable.expressions.get("expr-1")).toBe(forkedExpr.id)

        // Verify expression's variableId was remapped
        expect(forkedExpr.type).toBe("variable")
        if (forkedExpr.type === "variable") {
            expect(forkedExpr.variableId).not.toBe("var-p")
            expect(remapTable.variables.get("var-p")).toBe(
                forkedExpr.variableId
            )
        }

        // Verify variable was remapped
        const forkedVars = forked.getVariables()
        expect(forkedVars).toHaveLength(2) // VAR_P + 1 auto premise-bound
        const forkedVar = forkedVars.find(
            (v) => remapTable.variables.get("var-p") === v.id
        )!
        expect(forkedVar).toBeDefined()
        expect(forkedVar.id).not.toBe("var-p")
        expect(remapTable.variables.get("var-p")).toBe(forkedVar.id)

        // Verify conclusion role was remapped
        expect(forked.getConclusionPremise()?.getId()).toBe(forkedPremiseId)
    })

    // -----------------------------------------------------------------------
    // Task 9: Internal reference remapping
    // -----------------------------------------------------------------------

    it("remaps parentId chains, variableIds, boundPremiseId, rootExpressionId, and conclusion", () => {
        const claimLib = aLib()
        const eng = new ArgumentEngine({ id: "src-arg", version: 2 }, claimLib)

        // Add two claim-bound variables
        eng.addVariable({
            id: "var-p",
            argumentId: "src-arg",
            argumentVersion: 2,
            symbol: "P",
            claimId: "claim-default",
            claimVersion: 0,
        } as TClaimBoundVariable)
        eng.addVariable({
            id: "var-q",
            argumentId: "src-arg",
            argumentVersion: 2,
            symbol: "Q",
            claimId: "claim-default",
            claimVersion: 0,
        } as TClaimBoundVariable)

        // Premise 1: P and Q
        const { result: pm1 } = eng.createPremiseWithId("prem-1")
        pm1.addExpression({
            id: "op-and",
            argumentId: "src-arg",
            argumentVersion: 2,
            premiseId: "prem-1",
            type: "operator",
            operator: "and",
            parentId: null,
            position: POSITION_INITIAL,
        })
        pm1.addExpression({
            id: "expr-p",
            argumentId: "src-arg",
            argumentVersion: 2,
            premiseId: "prem-1",
            type: "variable",
            variableId: "var-p",
            parentId: "op-and",
            position: POSITION_INITIAL - 1,
        })
        pm1.addExpression({
            id: "expr-q",
            argumentId: "src-arg",
            argumentVersion: 2,
            premiseId: "prem-1",
            type: "variable",
            variableId: "var-q",
            parentId: "op-and",
            position: POSITION_INITIAL + 1,
        })

        // Premise 2: premise-bound variable referencing prem-1
        const { result: pm2 } = eng.createPremiseWithId("prem-2")
        eng.bindVariableToPremise({
            id: "var-r",
            argumentId: "src-arg",
            argumentVersion: 2,
            symbol: "R",
            boundPremiseId: "prem-1",
            boundArgumentId: "src-arg",
            boundArgumentVersion: 2,
        } as TPremiseBoundVariable)
        pm2.addExpression({
            id: "expr-r",
            argumentId: "src-arg",
            argumentVersion: 2,
            premiseId: "prem-2",
            type: "variable",
            variableId: "var-r",
            parentId: null,
            position: POSITION_INITIAL,
        })

        // Set premise 2 as conclusion
        eng.setConclusionPremise("prem-2")

        // Fork
        const forkClaimLib = aLib()
        let counter = 0
        const { engine: forked, remapTable } = forkArgumentEngine(
            eng,
            "fork-arg",
            {
                claimLibrary: forkClaimLib,
            },
            { generateId: () => `fk-${counter++}` }
        )

        // Resolve forked premise IDs from remap table
        const forkPrem1Id = remapTable.premises.get("prem-1")!
        const forkPrem2Id = remapTable.premises.get("prem-2")!
        expect(forkPrem1Id).toBeDefined()
        expect(forkPrem2Id).toBeDefined()

        // Verify forked premise 1 exists and getRootExpressionId is remapped
        const forkedPm1 = forked
            .listPremises()
            .find((p) => p.getId() === forkPrem1Id)!
        expect(forkedPm1).toBeDefined()
        const forkRootExprId = forkedPm1.getRootExpressionId()
        expect(forkRootExprId).not.toBeNull()
        expect(forkRootExprId).not.toBe("op-and")
        expect(remapTable.expressions.get("op-and")).toBe(forkRootExprId)

        // Verify parentId chains are remapped inside forked prem-1
        const forkExprs1 = forkedPm1.getExpressions()
        const forkOpExpr = forkExprs1.find((e) => e.type === "operator")!
        expect(forkOpExpr).toBeDefined()
        expect(forkOpExpr.parentId).toBeNull()
        const forkChildren = forkExprs1.filter(
            (e) => e.parentId === forkOpExpr.id
        )
        expect(forkChildren).toHaveLength(2)
        // Each child's parentId should point to the forked operator, not original
        for (const child of forkChildren) {
            expect(child.parentId).toBe(forkOpExpr.id)
            expect(child.parentId).not.toBe("op-and")
        }

        // Verify variableId references are remapped
        const forkVarPId = remapTable.variables.get("var-p")!
        const forkVarQId = remapTable.variables.get("var-q")!
        expect(forkVarPId).toBeDefined()
        expect(forkVarQId).toBeDefined()
        for (const child of forkChildren) {
            expect(child.type).toBe("variable")
            if (child.type === "variable") {
                expect([forkVarPId, forkVarQId]).toContain(child.variableId)
                expect(child.variableId).not.toBe("var-p")
                expect(child.variableId).not.toBe("var-q")
            }
        }

        // Verify premise-bound variable's boundPremiseId is remapped
        const forkVarR = forked.getVariables().find((v) => v.symbol === "R")!
        expect(forkVarR).toBeDefined()
        expect(isPremiseBound(forkVarR)).toBe(true)
        if (isPremiseBound(forkVarR)) {
            expect(forkVarR.boundPremiseId).toBe(forkPrem1Id)
            expect(forkVarR.boundPremiseId).not.toBe("prem-1")
        }

        // Verify conclusion is remapped to forked prem-2
        expect(forked.getConclusionPremise()?.getId()).toBe(forkPrem2Id)
        expect(forked.getConclusionPremise()?.getId()).not.toBe("prem-2")
    })

    // -----------------------------------------------------------------------
    // Task 10: Remap table accuracy and engine independence
    // -----------------------------------------------------------------------

    it("remap table covers all entities and all mapped IDs differ from originals", () => {
        const claimLib = aLib()
        const eng = new ArgumentEngine({ id: "src-arg", version: 0 }, claimLib)

        eng.addVariable({
            id: "v1",
            argumentId: "src-arg",
            argumentVersion: 0,
            symbol: "P",
            claimId: "claim-default",
            claimVersion: 0,
        } as TClaimBoundVariable)
        eng.addVariable({
            id: "v2",
            argumentId: "src-arg",
            argumentVersion: 0,
            symbol: "Q",
            claimId: "claim-default",
            claimVersion: 0,
        } as TClaimBoundVariable)

        const { result: pm1 } = eng.createPremiseWithId("pr1")
        pm1.addExpression({
            id: "e1",
            argumentId: "src-arg",
            argumentVersion: 0,
            premiseId: "pr1",
            type: "variable",
            variableId: "v1",
            parentId: null,
            position: POSITION_INITIAL,
        })

        const { result: pm2 } = eng.createPremiseWithId("pr2")
        pm2.addExpression({
            id: "e2",
            argumentId: "src-arg",
            argumentVersion: 0,
            premiseId: "pr2",
            type: "variable",
            variableId: "v2",
            parentId: null,
            position: POSITION_INITIAL,
        })

        const forkClaimLib = aLib()
        const { remapTable } = forkArgumentEngine(eng, "forked-arg", {
            claimLibrary: forkClaimLib,
        })

        // Remap table has correct counts
        expect(remapTable.variables.size).toBe(4) // 2 claim-bound + 2 auto premise-bound
        expect(remapTable.premises.size).toBe(2)
        expect(remapTable.expressions.size).toBe(2)

        // All mapped IDs differ from originals
        for (const [origId, newId] of remapTable.variables) {
            expect(newId).not.toBe(origId)
        }
        for (const [origId, newId] of remapTable.premises) {
            expect(newId).not.toBe(origId)
        }
        for (const [origId, newId] of remapTable.expressions) {
            expect(newId).not.toBe(origId)
        }
    })

    it("forked engine is independent from source engine", () => {
        const claimLib = aLib()
        const eng = new ArgumentEngine({ id: "src-arg", version: 0 }, claimLib)
        eng.createPremiseWithId("prem-only")

        const forkClaimLib = aLib()
        const { engine: forked } = forkArgumentEngine(eng, "forked-arg", {
            claimLibrary: forkClaimLib,
        })

        // Mutate the fork
        forked.createPremise()

        // Source is unaffected
        expect(eng.listPremises()).toHaveLength(1)
        expect(forked.listPremises()).toHaveLength(2)
    })

    // -----------------------------------------------------------------------
    // Task 11: Mutability and checksum divergence
    // -----------------------------------------------------------------------

    it("forked entities are fully mutable", () => {
        const claimLib = aLib()
        const eng = new ArgumentEngine({ id: "src-arg", version: 0 }, claimLib)

        eng.addVariable({
            id: "var-p",
            argumentId: "src-arg",
            argumentVersion: 0,
            symbol: "P",
            claimId: "claim-default",
            claimVersion: 0,
        } as TClaimBoundVariable)
        eng.addVariable({
            id: "var-q",
            argumentId: "src-arg",
            argumentVersion: 0,
            symbol: "Q",
            claimId: "claim-default",
            claimVersion: 0,
        } as TClaimBoundVariable)

        const { result: pm } = eng.createPremiseWithId("prem-src")
        pm.addExpression({
            id: "op-and",
            argumentId: "src-arg",
            argumentVersion: 0,
            premiseId: "prem-src",
            type: "operator",
            operator: "and",
            parentId: null,
            position: POSITION_INITIAL,
        })
        pm.addExpression({
            id: "expr-p",
            argumentId: "src-arg",
            argumentVersion: 0,
            premiseId: "prem-src",
            type: "variable",
            variableId: "var-p",
            parentId: "op-and",
            position: POSITION_INITIAL - 1,
        })
        pm.addExpression({
            id: "expr-q",
            argumentId: "src-arg",
            argumentVersion: 0,
            premiseId: "prem-src",
            type: "variable",
            variableId: "var-q",
            parentId: "op-and",
            position: POSITION_INITIAL + 1,
        })

        const forkClaimLib = aLib()
        const { engine: forked, remapTable } = forkArgumentEngine(
            eng,
            "forked-arg",
            {
                claimLibrary: forkClaimLib,
            }
        )

        const forkedPremise = forked.listPremises()[0]
        const forkedOpId = remapTable.expressions.get("op-and")!

        // Change and → or on the forked premise
        expect(() =>
            forkedPremise.changeOperator(forkedOpId, "or")
        ).not.toThrow()

        // Add a new premise to the fork
        expect(() => forked.createPremise()).not.toThrow()

        // Remove the original forked premise
        expect(() => forked.removePremise(forkedPremise.getId())).not.toThrow()

        // Fork ends up with just the newly added premise
        expect(forked.listPremises()).toHaveLength(1)
    })

    it("forked entity checksums diverge from source checksums", () => {
        const claimLib = aLib()
        const eng = new ArgumentEngine({ id: "src-arg", version: 0 }, claimLib)

        eng.addVariable({
            id: "var-p",
            argumentId: "src-arg",
            argumentVersion: 0,
            symbol: "P",
            claimId: "claim-default",
            claimVersion: 0,
        } as TClaimBoundVariable)

        const { result: pm } = eng.createPremiseWithId("prem-src")
        pm.addExpression({
            id: "expr-p",
            argumentId: "src-arg",
            argumentVersion: 0,
            premiseId: "prem-src",
            type: "variable",
            variableId: "var-p",
            parentId: null,
            position: POSITION_INITIAL,
        })

        const forkClaimLib = aLib()
        const { engine: forked } = forkArgumentEngine(eng, "forked-arg", {
            claimLibrary: forkClaimLib,
        })

        const srcSnapshot = eng.snapshot()
        const forkSnapshot = forked.snapshot()

        // Argument checksums differ (IDs differ)
        expect(forkSnapshot.argument.checksum).not.toBe(
            srcSnapshot.argument.checksum
        )
        expect(forkSnapshot.argument.combinedChecksum).not.toBe(
            srcSnapshot.argument.combinedChecksum
        )

        // Premise checksums differ
        const srcPremise = srcSnapshot.premises[0]
        const forkPremise = forkSnapshot.premises[0]
        expect(forkPremise).toBeDefined()
        expect(forkPremise.premise.checksum).not.toBe(
            srcPremise.premise.checksum
        )

        // Expression checksums differ
        const srcExprs = srcSnapshot.premises[0].expressions.expressions
        const forkExprs = forkSnapshot.premises[0].expressions.expressions
        expect(forkExprs[0]).toBeDefined()
        expect(forkExprs[0].checksum).not.toBe(srcExprs[0].checksum)
    })

    // -----------------------------------------------------------------------
    // Task 12: diffArguments with fork-aware matchers
    // -----------------------------------------------------------------------

    it("diffArguments without matchers sees forked entities as removed + added", () => {
        const claimLib = aLib()
        const eng = new ArgumentEngine(ARG, claimLib)
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise()
        pm.addExpression(
            makeVarExpr("expr-1", "var-p", { premiseId: pm.getId() })
        )

        const forkClaimLib = aLib()
        const { engine: forked } = forkArgumentEngine(eng, "forked-arg", {
            claimLibrary: forkClaimLib,
        })

        const diff = diffArguments(eng, forked)

        // Without matchers, IDs differ → removed + added
        expect(diff.premises.removed).toHaveLength(1)
        expect(diff.premises.added).toHaveLength(1)
        expect(diff.premises.modified).toHaveLength(0)
        expect(diff.variables.removed).toHaveLength(2) // VAR_P + 1 auto
        expect(diff.variables.added).toHaveLength(2)
    })
})

describe("cross-argument variable binding", () => {
    it("isExternallyBound returns true when boundArgumentId differs", () => {
        const variable: TPremiseBoundVariable = {
            id: "v-1",
            argumentId: "arg-1",
            argumentVersion: 0,
            symbol: "P",
            checksum: "",
            boundPremiseId: "p-1",
            boundArgumentId: "arg-other",
            boundArgumentVersion: 1,
        }
        expect(isExternallyBound(variable, "arg-1")).toBe(true)
    })

    it("isExternallyBound returns false when boundArgumentId matches", () => {
        const variable: TPremiseBoundVariable = {
            id: "v-1",
            argumentId: "arg-1",
            argumentVersion: 0,
            symbol: "P",
            checksum: "",
            boundPremiseId: "p-1",
            boundArgumentId: "arg-1",
            boundArgumentVersion: 0,
        }
        expect(isExternallyBound(variable, "arg-1")).toBe(false)
    })

    it("createPremise auto-creates a premise-bound variable", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const { result: pm, changes } = eng.createPremise()

        // Changeset includes a variable addition
        expect(changes.variables?.added).toBeDefined()
        expect(changes.variables!.added.length).toBeGreaterThanOrEqual(1)

        const autoVar = changes.variables!.added.find((v) => isPremiseBound(v))!
        expect(autoVar).toBeDefined()

        // Variable is bound to the new premise
        const pmVar = autoVar as unknown as TPremiseBoundVariable
        expect(pmVar.boundPremiseId).toBe(pm.getId())
        expect(pmVar.boundArgumentId).toBe(ARG.id)
        expect(pmVar.boundArgumentVersion).toBe(ARG.version)

        // Auto-generated symbol
        expect(pmVar.symbol).toBe("P0")
    })

    it("createPremise accepts a custom symbol for the auto-variable", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const { changes } = eng.createPremise(undefined, "MyPremise")
        const autoVar = changes.variables!.added.find((v) => isPremiseBound(v))!
        expect((autoVar as unknown as TPremiseBoundVariable).symbol).toBe(
            "MyPremise"
        )
    })

    it("createPremise auto-generates unique symbols on collision", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const { changes: c1 } = eng.createPremise()
        const { changes: c2 } = eng.createPremise()
        const sym1 = (
            c1.variables!.added.find((v) =>
                isPremiseBound(v)
            )! as unknown as TPremiseBoundVariable
        ).symbol
        const sym2 = (
            c2.variables!.added.find((v) =>
                isPremiseBound(v)
            )! as unknown as TPremiseBoundVariable
        ).symbol
        expect(sym1).not.toBe(sym2)
        expect(sym1).toBe("P0")
        expect(sym2).toBe("P1")
    })

    it("canBind rejects when overridden to return false", () => {
        class RestrictedEngine extends ArgumentEngine {
            protected override canBind(
                _boundArgumentId: string,
                _boundArgumentVersion: number
            ): boolean {
                return false
            }
        }
        const eng = new RestrictedEngine(ARG, aLib())
        expect(() =>
            eng.bindVariableToExternalPremise({
                id: "v-ext",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                symbol: "Ext",
                boundPremiseId: "p-other",
                boundArgumentId: "arg-other",
                boundArgumentVersion: 0,
            })
        ).toThrow()
    })

    it("bindVariableToExternalPremise registers an externally bound variable", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const { result: varResult } = eng.bindVariableToExternalPremise({
            id: "v-ext",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "ExtVar",
            boundPremiseId: "p-in-other-arg",
            boundArgumentId: "arg-other",
            boundArgumentVersion: 2,
        })

        expect(varResult.id).toBe("v-ext")
        expect(varResult.symbol).toBe("ExtVar")

        const retrieved = eng.getVariable("v-ext")
        expect(retrieved).toBeDefined()
        expect(isPremiseBound(retrieved!)).toBe(true)
        const pv = retrieved! as unknown as TPremiseBoundVariable
        expect(pv.boundArgumentId).toBe("arg-other")
        expect(pv.boundArgumentVersion).toBe(2)
        expect(pv.boundPremiseId).toBe("p-in-other-arg")
    })

    it("bindVariableToExternalPremise rejects internal binding", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        expect(() =>
            eng.bindVariableToExternalPremise({
                id: "v-int",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                symbol: "IntVar",
                boundPremiseId: "p1",
                boundArgumentId: ARG.id,
                boundArgumentVersion: ARG.version,
            })
        ).toThrow(/internal/)
    })

    it("bindVariableToArgument sets boundPremiseId to conclusionPremiseId", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.bindVariableToArgument(
            {
                id: "v-arg",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                symbol: "ArgRef",
                boundArgumentId: "arg-other",
                boundArgumentVersion: 3,
            },
            "conclusion-premise-in-other-arg"
        )

        const retrieved = eng.getVariable("v-arg")!
        const pv = retrieved as unknown as TPremiseBoundVariable
        expect(pv.boundPremiseId).toBe("conclusion-premise-in-other-arg")
        expect(pv.boundArgumentId).toBe("arg-other")
        expect(pv.boundArgumentVersion).toBe(3)
    })

    it("evaluation: internal binding is still lazily resolved", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(makeVar("v-p", "X"))
        const { result: pm1 } = eng.createPremiseWithId("p1")
        pm1.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v-p",
            parentId: null,
            position: 0,
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "p1",
        })

        // Find the auto-created variable for p1
        const autoVarId = eng
            .getVariables()
            .find(
                (v) =>
                    isPremiseBound(v) &&
                    (v as unknown as TPremiseBoundVariable).boundPremiseId ===
                        "p1"
            )!.id

        const { result: pm2 } = eng.createPremiseWithId("p2")
        pm2.addExpression({
            id: "e2",
            type: "variable",
            variableId: autoVarId,
            parentId: null,
            position: 0,
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "p2",
        })

        // Set p2 as conclusion so evaluate works
        eng.setConclusionPremise("p2")

        // X = true -> pm1 evaluates to true -> auto-variable resolves to true -> pm2 = true
        const result = eng.evaluate({
            variables: { "v-p": true },
            operatorAssignments: {},
        })
        expect(result.ok).toBe(true)
        // p2 uses the auto-variable bound to p1; p1 is a supporting premise
        // The conclusion (p2) should resolve to true via lazy internal binding
        expect(result.conclusionTrue).toBe(true)
    })

    it("evaluation: external binding is evaluator-assigned", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.bindVariableToExternalPremise({
            id: "v-ext",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "ExtVar",
            boundPremiseId: "p-other",
            boundArgumentId: "arg-other",
            boundArgumentVersion: 0,
        })

        const { result: pm } = eng.createPremiseWithId("p1")
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v-ext",
            parentId: null,
            position: 0,
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "p1",
        })

        // Set conclusion so evaluate works
        eng.setConclusionPremise("p1")

        const result = eng.evaluate({
            variables: { "v-ext": true },
            operatorAssignments: {},
        })
        expect(result.ok).toBe(true)
        expect(result.conclusionTrue).toBe(true)
    })

    it("truth table: external binding included in columns", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.bindVariableToExternalPremise({
            id: "v-ext",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "ExtVar",
            boundPremiseId: "p-other",
            boundArgumentId: "arg-other",
            boundArgumentVersion: 0,
        })

        const { result: pm } = eng.createPremiseWithId("p1")
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v-ext",
            parentId: null,
            position: 0,
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "p1",
        })
        eng.setConclusionPremise("p1")

        const validity = eng.checkValidity({ mode: "exhaustive" })
        expect(validity.ok).toBe(true)
        expect(validity.checkedVariableIds).toContain("v-ext")
        expect(validity.numAssignmentsChecked).toBeGreaterThan(0)
    })

    it("fromSnapshot restores both internal and external bound variables", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(makeVar("v-claim", "Claim"))
        eng.bindVariableToExternalPremise({
            id: "v-ext",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "ExtVar",
            boundPremiseId: "p-other",
            boundArgumentId: "arg-other",
            boundArgumentVersion: 2,
        })

        const { result: pm } = eng.createPremiseWithId("p1")
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v-ext",
            parentId: null,
            position: 0,
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "p1",
        })

        eng.setConclusionPremise("p1")

        const snap = eng.snapshot()
        const restored = ArgumentEngine.fromSnapshot(snap, aLib())

        const vars = restored.getVariables()
        const extVar = vars.find((v) => v.id === "v-ext")
        expect(extVar).toBeDefined()
        expect(isPremiseBound(extVar!)).toBe(true)
        const pv = extVar! as unknown as TPremiseBoundVariable
        expect(pv.boundArgumentId).toBe("arg-other")

        // Evaluation still works after restoration
        const result = restored.evaluate({
            variables: { "v-ext": true, "v-claim": false },
            operatorAssignments: {},
        })
        expect(result.ok).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// ExpressionManager — validate
// ---------------------------------------------------------------------------

describe("ExpressionManager — validate", () => {
    it("returns ok for a valid tree", () => {
        const em = new ExpressionManager()
        em.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 0 })
        )
        em.addExpression(
            makeVarExpr("v-p", "var-p", { parentId: "op-and", position: 0 })
        )
        em.addExpression(
            makeVarExpr("v-q", "var-q", { parentId: "op-and", position: 1 })
        )
        em.flushExpressionChecksums()

        const result = em.validate()
        expect(result.ok).toBe(true)
        expect(result.violations).toEqual([])
    })

    it("returns ok for an empty manager", () => {
        const em = new ExpressionManager()
        const result = em.validate()
        expect(result.ok).toBe(true)
        expect(result.violations).toEqual([])
    })

    it("detects schema violation", () => {
        // Build a valid manager, then directly corrupt an expression's type
        const em = new ExpressionManager({
            behavior: "permissive" as const,
        })
        em.addExpression(
            makeVarExpr("v-p", "var-p", { parentId: null, position: 0 })
        )
        em.flushExpressionChecksums()
        // Tamper: overwrite with invalid type via internal map
        const map = (
            em as unknown as {
                expressions: Map<string, Record<string, unknown>>
            }
        ).expressions
        const expr = map.get("v-p")!
        map.set("v-p", { ...expr, type: "INVALID_TYPE" })
        const result = em.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some((v) => v.code === EXPR_SCHEMA_INVALID)
        ).toBe(true)
    })

    it("detects self-referential parent", () => {
        const em = new ExpressionManager({
            behavior: "permissive" as const,
        })
        em.addExpression(
            makeVarExpr("v-p", "var-p", { parentId: null, position: 0 })
        )
        em.flushExpressionChecksums()
        // Tamper: set parentId to self via internal map
        const map = (
            em as unknown as {
                expressions: Map<string, Record<string, unknown>>
            }
        ).expressions
        const expr = map.get("v-p")!
        map.set("v-p", { ...expr, parentId: "v-p" })
        const result = em.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some(
                (v) => v.code === EXPR_SELF_REFERENTIAL_PARENT
            )
        ).toBe(true)
    })

    it("detects parent not found", () => {
        const em = new ExpressionManager({
            behavior: "permissive" as const,
        })
        em.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 0 })
        )
        em.addExpression(
            makeVarExpr("v-p", "var-p", { parentId: "op-and", position: 0 })
        )
        em.flushExpressionChecksums()
        // Tamper: change parentId to a nonexistent expression
        const map = (
            em as unknown as {
                expressions: Map<string, Record<string, unknown>>
            }
        ).expressions
        const expr = map.get("v-p")!
        map.set("v-p", { ...expr, parentId: "nonexistent" })
        const result = em.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some((v) => v.code === EXPR_PARENT_NOT_FOUND)
        ).toBe(true)
    })

    it("detects parent not a container", () => {
        const em = new ExpressionManager({
            behavior: "permissive" as const,
        })
        em.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 0 })
        )
        em.addExpression(
            makeVarExpr("v-p", "var-p", { parentId: "op-and", position: 0 })
        )
        em.addExpression(
            makeVarExpr("v-q", "var-q", { parentId: "op-and", position: 1 })
        )
        em.flushExpressionChecksums()
        // Tamper: set v-q's parentId to v-p (a variable, not operator/formula)
        const map = (
            em as unknown as {
                expressions: Map<string, Record<string, unknown>>
            }
        ).expressions
        const expr = map.get("v-q")!
        map.set("v-q", { ...expr, parentId: "v-p" })
        const result = em.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some((v) => v.code === EXPR_PARENT_NOT_CONTAINER)
        ).toBe(true)
    })

    it("detects root-only violation for implies with non-null parent", () => {
        // Inject implies under and via internal map — addExpression forbids this
        const em = new ExpressionManager({
            behavior: "permissive" as const,
        })
        em.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 0 })
        )
        em.flushExpressionChecksums()
        const map = (
            em as unknown as {
                expressions: Map<string, TCorePropositionalExpression>
            }
        ).expressions
        const childIndex = (
            em as unknown as {
                childExpressionIdsByParentId: Map<string | null, Set<string>>
            }
        ).childExpressionIdsByParentId
        map.set("op-implies", {
            id: "op-implies",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "operator",
            operator: "implies",
            parentId: "op-and",
            position: 0,
            checksum: "fake",
            descendantChecksum: null,
            combinedChecksum: "fake",
        } as TCorePropositionalExpression)
        const andChildren = childIndex.get("op-and")
        if (andChildren) {
            andChildren.add("op-implies")
        } else {
            childIndex.set("op-and", new Set(["op-implies"]))
        }
        const result = em.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some((v) => v.code === EXPR_ROOT_ONLY_VIOLATED)
        ).toBe(true)
    })


    it("detects child limit exceeded for not operator", () => {
        // not should have at most 1 child — inject second child via internal map
        const em = new ExpressionManager({
            behavior: "permissive" as const,
        })
        em.addExpression(
            makeOpExpr("op-not", "not", { parentId: null, position: 0 })
        )
        em.addExpression(
            makeVarExpr("v-p", "var-p", { parentId: "op-not", position: 0 })
        )
        em.flushExpressionChecksums()
        // Inject a second child directly
        const map = (
            em as unknown as {
                expressions: Map<string, TCorePropositionalExpression>
            }
        ).expressions
        const childIndex = (
            em as unknown as {
                childExpressionIdsByParentId: Map<string | null, Set<string>>
            }
        ).childExpressionIdsByParentId
        map.set("v-q", {
            id: "v-q",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "variable",
            variableId: "var-q",
            parentId: "op-not",
            position: 1,
            checksum: "fake",
            descendantChecksum: null,
            combinedChecksum: "fake",
        } as TCorePropositionalExpression)
        childIndex.get("op-not")!.add("v-q")
        const result = em.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some((v) => v.code === EXPR_CHILD_LIMIT_EXCEEDED)
        ).toBe(true)
    })

    it("detects child limit exceeded for formula node", () => {
        const em = new ExpressionManager({
            behavior: "permissive" as const,
        })
        em.addExpression(makeFormulaExpr("f1", { parentId: null, position: 0 }))
        em.addExpression(
            makeVarExpr("v-p", "var-p", { parentId: "f1", position: 0 })
        )
        em.flushExpressionChecksums()
        // Inject a second child directly
        const map = (
            em as unknown as {
                expressions: Map<string, TCorePropositionalExpression>
            }
        ).expressions
        const childIndex = (
            em as unknown as {
                childExpressionIdsByParentId: Map<string | null, Set<string>>
            }
        ).childExpressionIdsByParentId
        map.set("v-q", {
            id: "v-q",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "variable",
            variableId: "var-q",
            parentId: "f1",
            position: 1,
            checksum: "fake",
            descendantChecksum: null,
            combinedChecksum: "fake",
        } as TCorePropositionalExpression)
        childIndex.get("f1")!.add("v-q")
        const result = em.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some((v) => v.code === EXPR_CHILD_LIMIT_EXCEEDED)
        ).toBe(true)
    })

    it("detects position uniqueness violation", () => {
        const em = new ExpressionManager({
            behavior: "permissive" as const,
        })
        em.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 0 })
        )
        em.addExpression(
            makeVarExpr("v-p", "var-p", { parentId: "op-and", position: 0 })
        )
        em.flushExpressionChecksums()
        // Inject a second child with duplicate position directly
        const map = (
            em as unknown as {
                expressions: Map<string, TCorePropositionalExpression>
            }
        ).expressions
        const childIndex = (
            em as unknown as {
                childExpressionIdsByParentId: Map<string | null, Set<string>>
            }
        ).childExpressionIdsByParentId
        map.set("v-q", {
            id: "v-q",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "variable",
            variableId: "var-q",
            parentId: "op-and",
            position: 0, // duplicate!
            checksum: "fake",
            descendantChecksum: null,
            combinedChecksum: "fake",
        } as TCorePropositionalExpression)
        childIndex.get("op-and")!.add("v-q")
        const result = em.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some((v) => v.code === EXPR_POSITION_DUPLICATE)
        ).toBe(true)
    })

    it("detects checksum mismatch", () => {
        const em = new ExpressionManager()
        em.addExpression(
            makeVarExpr("v-p", "var-p", { parentId: null, position: 0 })
        )
        em.flushExpressionChecksums()
        // Tamper: corrupt the checksum directly in the internal map
        const map = (
            em as unknown as {
                expressions: Map<string, Record<string, unknown>>
            }
        ).expressions
        const expr = map.get("v-p")!
        map.set("v-p", {
            ...expr,
            checksum: "tampered-checksum",
            combinedChecksum: "tampered-checksum",
        })
        const result = em.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some((v) => v.code === EXPR_CHECKSUM_MISMATCH)
        ).toBe(true)
    })

    it("skips checksum comparison for null/empty checksums", () => {
        // A freshly-created manager before flush has valid checksums
        // (attachChecksum sets them), but let's verify validate doesn't
        // false-positive on a manager with null checksums loaded permissively
        const em = new ExpressionManager({
            behavior: "permissive" as const,
        })
        em.addExpression(
            makeVarExpr("v-p", "var-p", { parentId: null, position: 0 })
        )
        em.flushExpressionChecksums()
        const snap = em.snapshot()
        // Set checksums to null (simulating pre-flush entities)
        ;(snap.expressions[0] as Record<string, unknown>).checksum = null
        ;(snap.expressions[0] as Record<string, unknown>).descendantChecksum =
            null
        ;(snap.expressions[0] as Record<string, unknown>).combinedChecksum =
            null
        const restored = ExpressionManager.fromSnapshot(snap)
        const result = restored.validate()
        // Should not flag checksum mismatch for null checksums
        expect(
            result.violations.some((v) => v.code === EXPR_CHECKSUM_MISMATCH)
        ).toBe(false)
    })

    it("collects multiple violations in one pass", () => {
        // Build a tree with multiple problems via internal map injection
        const em = new ExpressionManager({
            behavior: "permissive" as const,
        })
        em.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 0 })
        )
        em.addExpression(
            makeOpExpr("op-not", "not", { parentId: "op-and", position: 1 })
        )
        em.addExpression(
            makeVarExpr("v-p", "var-p", { parentId: "op-not", position: 0 })
        )
        em.flushExpressionChecksums()
        // Inject implies under and (root-only violation) and second child to not (child limit violation)
        const map = (
            em as unknown as {
                expressions: Map<string, TCorePropositionalExpression>
            }
        ).expressions
        const childIndex = (
            em as unknown as {
                childExpressionIdsByParentId: Map<string | null, Set<string>>
            }
        ).childExpressionIdsByParentId
        map.set("op-implies", {
            id: "op-implies",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "operator",
            operator: "implies",
            parentId: "op-and",
            position: 0,
            checksum: "fake",
            descendantChecksum: null,
            combinedChecksum: "fake",
        } as TCorePropositionalExpression)
        childIndex.get("op-and")!.add("op-implies")
        map.set("v-q", {
            id: "v-q",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "premise-1",
            type: "variable",
            variableId: "var-q",
            parentId: "op-not",
            position: 1,
            checksum: "fake",
            descendantChecksum: null,
            combinedChecksum: "fake",
        } as TCorePropositionalExpression)
        childIndex.get("op-not")!.add("v-q")
        const result = em.validate()
        expect(result.ok).toBe(false)
        // Should have at least 2 violations (root-only + child limit)
        expect(result.violations.length).toBeGreaterThanOrEqual(2)
        expect(
            result.violations.some((v) => v.code === EXPR_ROOT_ONLY_VIOLATED)
        ).toBe(true)
        expect(
            result.violations.some((v) => v.code === EXPR_CHILD_LIMIT_EXCEEDED)
        ).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// VariableManager — validate
// ---------------------------------------------------------------------------

describe("VariableManager — validate", () => {
    it("returns ok for a valid set of variables", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(makeVar("var-p", "P"))
        eng.addVariable(makeVar("var-q", "Q"))
        const vm = (eng as unknown as { variables: VariableManager }).variables
        const result = vm.validate()
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
    })

    it("returns ok for an empty manager", () => {
        const vm = new VariableManager()
        const result = vm.validate()
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
    })

    it("detects checksum mismatch after snapshot tampering", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(makeVar("var-p", "P"))
        const snap = (
            eng as unknown as { variables: VariableManager }
        ).variables.snapshot()

        // Tamper the checksum of the variable in the snapshot
        snap.variables[0] = { ...snap.variables[0], checksum: "deadbeef" }

        const vm = VariableManager.fromSnapshot(snap)
        const result = vm.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some((v) => v.code === VAR_CHECKSUM_MISMATCH)
        ).toBe(true)
        expect(result.violations[0].entityId).toBe("var-p")
    })

    it("detects schema violation", () => {
        const vm = new VariableManager()
        // Bypass addVariable to inject a malformed variable directly
        const map = (vm as unknown as { variables: Map<string, unknown> })
            .variables
        const symbolIndex = (
            vm as unknown as { variablesBySymbol: Map<string, string> }
        ).variablesBySymbol
        const bad = {
            id: "var-bad",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "X",
            // Missing claimId/claimVersion and boundPremiseId/boundArgumentId/boundArgumentVersion
            // so it doesn't satisfy either union branch
            checksum: "",
        }
        map.set("var-bad", bad)
        symbolIndex.set("X", "var-bad")
        const result = vm.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some((v) => v.code === VAR_SCHEMA_INVALID)
        ).toBe(true)
    })

    it("detects duplicate ID injected after bypass", () => {
        // Maps cannot have duplicate keys, so we simulate a corrupt state by
        // temporarily overriding toArray() to return an array with repeated IDs.
        const dupVars: TClaimBoundVariable[] = [
            {
                id: "var-dup",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                symbol: "P",
                claimId: "claim-default",
                claimVersion: 0,
                checksum: "",
            },
            {
                id: "var-dup",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                symbol: "Q",
                claimId: "claim-default",
                claimVersion: 0,
                checksum: "",
            },
        ]
        const vm = new VariableManager()
        const origToArray = vm.toArray.bind(vm)
        ;(
            vm as unknown as {
                toArray: () => TCorePropositionalVariable[]
            }
        ).toArray = () => dupVars
        const result = vm.validate()
        ;(
            vm as unknown as {
                toArray: () => TCorePropositionalVariable[]
            }
        ).toArray = origToArray
        expect(result.ok).toBe(false)
        expect(result.violations.some((v) => v.code === VAR_DUPLICATE_ID)).toBe(
            true
        )
    })

    it("detects duplicate symbol injected after bypass", () => {
        const vm = new VariableManager()
        // Bypass addVariable to inject a malformed variable directly
        const map = (vm as unknown as { variables: Map<string, unknown> })
            .variables
        const symbolIndex = (
            vm as unknown as { variablesBySymbol: Map<string, string> }
        ).variablesBySymbol
        // Two variables with the same symbol "P" injected directly
        const v1: TClaimBoundVariable = {
            id: "var-1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "P",
            claimId: "claim-default",
            claimVersion: 0,
            checksum: "",
        }
        const v2: TClaimBoundVariable = {
            id: "var-2",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "P",
            claimId: "claim-default",
            claimVersion: 0,
            checksum: "",
        }
        map.set("var-1", v1)
        map.set("var-2", v2)
        symbolIndex.set("P", "var-2")
        const result = vm.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some((v) => v.code === VAR_DUPLICATE_SYMBOL)
        ).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// PremiseEngine — validate
// ---------------------------------------------------------------------------
describe("PremiseEngine — validate", () => {
    it("returns ok for a valid premise with expressions", () => {
        const vm = new VariableManager()
        vm.addVariable({
            id: "var-p",
            argumentId: "arg-1",
            argumentVersion: 1,
            symbol: "P",
            claimId: "claim-default",
            claimVersion: 0,
            checksum: "",
        } as TCorePropositionalVariable)
        const pe = new PremiseEngine(
            {
                id: "premise-1",
                argumentId: "arg-1",
                argumentVersion: 1,
                type: "freeform" as const,
            } as TOptionalChecksum<TCorePremise>,
            { argument: ARG, variables: vm },
            { behavior: "permissive" as const }
        )
        pe.addExpression(
            makeVarExpr("expr-1", "var-p", { premiseId: "premise-1" })
        )
        // Wire up the variable IDs callback
        pe.setVariableIdsCallback(() => new Set(["var-p"]))
        const result = pe.validate()
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
    })

    it("returns ok for an empty premise", () => {
        const vm = new VariableManager()
        const pe = new PremiseEngine(
            {
                id: "premise-1",
                argumentId: "arg-1",
                argumentVersion: 1,
                type: "freeform" as const,
            } as TOptionalChecksum<TCorePremise>,
            { argument: ARG, variables: vm },
            { behavior: "permissive" as const }
        )
        const result = pe.validate()
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
    })

    it("detects variable reference to non-existent variable", () => {
        const vm = new VariableManager()
        vm.addVariable({
            id: "var-p",
            argumentId: "arg-1",
            argumentVersion: 1,
            symbol: "P",
            claimId: "claim-default",
            claimVersion: 0,
            checksum: "",
        } as TCorePropositionalVariable)
        const pe = new PremiseEngine(
            {
                id: "premise-1",
                argumentId: "arg-1",
                argumentVersion: 1,
                type: "freeform" as const,
            } as TOptionalChecksum<TCorePremise>,
            { argument: ARG, variables: vm },
            { behavior: "permissive" as const }
        )
        pe.addExpression(
            makeVarExpr("expr-1", "var-p", { premiseId: "premise-1" })
        )
        // Set callback returning empty set — var-p won't be found
        pe.setVariableIdsCallback(() => new Set())
        const result = pe.validate()
        expect(result.ok).toBe(false)
        expect(
            result.violations.some(
                (v) => v.code === PREMISE_VARIABLE_REF_NOT_FOUND
            )
        ).toBe(true)
        // The violation should carry the premiseId
        const violation = result.violations.find(
            (v) => v.code === PREMISE_VARIABLE_REF_NOT_FOUND
        )!
        expect(violation.premiseId).toBe("premise-1")
        expect(violation.entityId).toBe("expr-1")
    })

})

describe("ArgumentEngine — validate", () => {
    const ARG = { id: "arg-1", version: 1 }

    it("valid argument with premises and variables → ok", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.createPremise()
        eng.addVariable(makeVar("v-extra", "X"))

        const result = eng.validate()
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
    })

    it("empty argument → ok", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        // Clear conclusion (constructor doesn't auto-assign without premises)
        const result = eng.validate()
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
    })

    it("detects claim reference to non-existent claim", () => {
        // Create engine with a claim-bound variable referencing claim-default
        const claimLib = aLib()
        const eng = new ArgumentEngine(ARG, claimLib)
        eng.addVariable(makeVar("v1", "A"))

        // Snapshot, then restore with an empty ClaimLibrary
        const snap = eng.snapshot()
        const emptyClaimLib = new ClaimLibrary()

        // Restore from snapshot, bypassing addVariable's runtime check
        // by directly building engine and injecting variables
        const engine2 = new ArgumentEngine(snap.argument, emptyClaimLib)
        // Inject variables directly into the VariableManager via snapshot restore
        const vm = VariableManager.fromSnapshot(snap.variables)
        ;(engine2 as unknown as { variables: VariableManager }).variables = vm

        const result = engine2.validate()
        expect(result.ok).toBe(false)
        const claimViolations = result.violations.filter(
            (v) => v.code === ARG_CLAIM_REF_NOT_FOUND
        )
        expect(claimViolations.length).toBeGreaterThan(0)
        expect(claimViolations[0].entityId).toBe("v1")
    })

    it("detects conclusion referencing non-existent premise", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.createPremise()

        const snap = eng.snapshot()
        // Tamper: set conclusionPremiseId to a non-existent ID
        snap.conclusionPremiseId = "non-existent-premise"

        // fromSnapshot now validates, so loading a tampered snapshot throws
        expect(() =>
            ArgumentEngine.fromSnapshot(snap, aLib(), "ignore")
        ).toThrow(/non-existent-premise/)
    })

    it("detects ownership mismatch on variable", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.createPremise()

        // Snapshot normally, then restore to get a clean engine
        const snap = eng.snapshot()
        const restored = ArgumentEngine.fromSnapshot(snap, aLib(), "ignore")

        // Tamper: directly mutate the variable in the VariableManager
        // to have a wrong argumentId (bypassing ArgumentEngine's guards)
        const vars = restored.getVariables()
        expect(vars.length).toBeGreaterThan(0)
        const vm = (restored as unknown as { variables: VariableManager })
            .variables
        const original = vars[0]
        vm.removeVariable(original.id)
        vm.addVariable({
            ...original,
            argumentId: "wrong-arg",
        } as typeof original)

        const result = restored.validate()
        expect(result.ok).toBe(false)
        const ownershipViolations = result.violations.filter(
            (v) => v.code === ARG_OWNERSHIP_MISMATCH
        )
        expect(ownershipViolations.length).toBeGreaterThan(0)
    })
})

// ---------------------------------------------------------------------------
// ClaimLibrary — validate
// ---------------------------------------------------------------------------

describe("ClaimLibrary — validate", () => {
    it("returns ok for a valid library", () => {
        const lib = aLib()
        const result = lib.validate()
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
    })

    it("returns ok for an empty library", () => {
        const lib = new ClaimLibrary()
        const result = lib.validate()
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
    })

    it("detects frozen claim without successor", () => {
        const lib = new ClaimLibrary()
        lib.create({ id: "claim-a", type: "normal" })
        // First freeze: version 0 (frozen) + version 1 (unfrozen)
        lib.freeze("claim-a")
        // Second freeze: version 1 (frozen) + version 2 (unfrozen)
        lib.freeze("claim-a")

        // Remove version 1 so version 0 is frozen but version 1 (its
        // direct successor) is missing, while version 2 still exists
        const snap = lib.snapshot()
        const tamperedClaims = snap.claims.filter(
            (c) => !(c.id === "claim-a" && c.version === 1)
        )
        const tamperedSnap = { claims: tamperedClaims }

        const restored = ClaimLibrary.fromSnapshot(tamperedSnap)
        const result = restored.validate()
        expect(result.ok).toBe(false)
        const violations = result.violations.filter(
            (v) => v.code === CLAIM_FROZEN_NO_SUCCESSOR
        )
        expect(violations.length).toBe(1)
        expect(violations[0].entityId).toBe("claim-a")
    })

    it("detects claim failing schema check", () => {
        const lib = new ClaimLibrary()
        lib.create({ id: "claim-b", type: "normal" })
        const snap = lib.snapshot()
        // Tamper: remove the checksum field to break schema
        const tampered = snap.claims.map((c) => {
            const { checksum: _omit, ...rest } = c
            return rest
        })
        const restored = ClaimLibrary.fromSnapshot({
            claims: tampered as Parameters<
                typeof ClaimLibrary.fromSnapshot
            >[0]["claims"],
        })
        const result = restored.validate()
        expect(result.ok).toBe(false)
        const violations = result.violations.filter(
            (v) => v.code === CLAIM_SCHEMA_INVALID
        )
        expect(violations.length).toBeGreaterThan(0)
    })
})

// ---------------------------------------------------------------------------
// ClaimCitationLibrary — validate
// ---------------------------------------------------------------------------

describe("ClaimCitationLibrary — validate", () => {
    it("returns ok for a library with valid citations", () => {
        const claimLib = new ClaimLibrary()
        claimLib.create({ id: "claim-x", type: "normal" })
        claimLib.create({ id: "source-x", type: "citation" })
        const ccLibrary = new ClaimCitationLibrary(claimLib)
        ccLibrary.add({
            id: "cit-1",
            claimId: "claim-x",
            claimVersion: 0,
            supportingClaimId: "source-x",
            supportingClaimVersion: 0,
        })
        const result = ccLibrary.validate()
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
    })

    it("returns ok for an empty library", () => {
        const ccLibrary = new ClaimCitationLibrary(aLib())
        const result = ccLibrary.validate()
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
    })

    it("detects citation referencing non-existent citing claim", () => {
        const claimLib = new ClaimLibrary()
        claimLib.create({ id: "claim-y", type: "normal" })
        claimLib.create({ id: "source-y", type: "citation" })
        const ccLibrary = new ClaimCitationLibrary(claimLib)
        ccLibrary.add({
            id: "cit-2",
            claimId: "claim-y",
            claimVersion: 0,
            supportingClaimId: "source-y",
            supportingClaimVersion: 0,
        })

        // Restore against an empty ClaimLibrary so neither ref is found
        const snap = ccLibrary.snapshot()
        const emptyClaimLib = new ClaimLibrary()
        const restored = ClaimCitationLibrary.fromSnapshot(snap, emptyClaimLib)
        const result = restored.validate()
        expect(result.ok).toBe(false)
        const violations = result.violations.filter(
            (v) => v.code === CITATION_CLAIM_REF_NOT_FOUND
        )
        expect(violations.length).toBe(1)
        expect(violations[0].entityId).toBe("cit-2")
    })

    it("detects citation referencing non-existent source claim", () => {
        const claimLib = new ClaimLibrary()
        claimLib.create({ id: "claim-z", type: "normal" })
        claimLib.create({ id: "source-z", type: "citation" })
        const ccLibrary = new ClaimCitationLibrary(claimLib)
        ccLibrary.add({
            id: "cit-3",
            claimId: "claim-z",
            claimVersion: 0,
            supportingClaimId: "source-z",
            supportingClaimVersion: 0,
        })

        // Restore against a ClaimLibrary that only has the citing claim, not the source
        const snap = ccLibrary.snapshot()
        const partialClaimLib = new ClaimLibrary()
        partialClaimLib.create({ id: "claim-z", type: "normal" })
        const restored = ClaimCitationLibrary.fromSnapshot(
            snap,
            partialClaimLib
        )
        const result = restored.validate()
        expect(result.ok).toBe(false)
        const violations = result.violations.filter(
            (v) => v.code === CITATION_SUPPORTING_REF_NOT_FOUND
        )
        expect(violations.length).toBe(1)
        expect(violations[0].entityId).toBe("cit-3")
    })
})

describe("ArgumentEngine — withValidation bracket", () => {
    it("valid operations still work after wrapping", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(makeVar("var-p", "P"))
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeVarExpr("v1", "var-p", { premiseId: pm.getId() }))
        expect(eng.validate().ok).toBe(true)
    })

    it("existing per-operation errors still throw with rollback", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        expect(() =>
            eng.addVariable({ ...makeVar("v1", "P"), argumentId: "wrong-arg" })
        ).toThrow()
        expect(eng.getVariables()).toHaveLength(0)
    })

    it("state is consistent after successful removePremise", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const { result: pm } = eng.createPremise()
        eng.removePremise(pm.getId())
        expect(eng.hasPremise(pm.getId())).toBe(false)
        expect(eng.validate().ok).toBe(true)
    })
})

describe("PremiseEngine — withValidation bracket", () => {
    it("triggers argument-level validation on expression mutation", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(makeVar("var-p", "P"))
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeVarExpr("v1", "var-p", { premiseId: pm.getId() }))
        expect(eng.validate().ok).toBe(true)
    })

    it("rolls back on failed expression mutation (nonexistent variable)", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const { result: pm } = eng.createPremise()
        expect(() =>
            pm.addExpression(
                makeVarExpr("v1", "nonexistent-var", {
                    premiseId: pm.getId(),
                })
            )
        ).toThrow()
        expect(pm.getExpressions()).toHaveLength(0)
    })

    it("rolls back appendExpression on failure", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const { result: pm } = eng.createPremise()
        expect(() =>
            pm.appendExpression(null, {
                id: "e1",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                premiseId: pm.getId(),
                type: "variable",
                variableId: "nonexistent-var",
            } as TExpressionWithoutPosition)
        ).toThrow()
        expect(pm.getExpressions()).toHaveLength(0)
    })

    it("valid operations through PremiseEngine produce correct state", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(makeVar("var-p", "P"))
        eng.addVariable(makeVar("var-q", "Q"))
        const { result: pm } = eng.createPremise()

        // Build: and(P, Q)
        pm.addExpression({
            id: "op1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: pm.getId(),
            type: "operator",
            operator: "and",
            parentId: null,
            position: POSITION_INITIAL,
        } as TExpressionInput)
        pm.addExpression(
            makeVarExpr("v1", "var-p", {
                premiseId: pm.getId(),
                parentId: "op1",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("v2", "var-q", {
                premiseId: pm.getId(),
                parentId: "op1",
                position: 100,
            })
        )

        expect(pm.getExpressions()).toHaveLength(3)
        expect(eng.validate().ok).toBe(true)
    })

    it("removeExpression rolls back on invariant violation", () => {
        // Build a valid premise with a single variable expression, then try
        // removing it — the premise itself stays valid (empty is fine) so
        // this should succeed and not roll back.
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(makeVar("var-p", "P"))
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeVarExpr("v1", "var-p", { premiseId: pm.getId() }))
        pm.removeExpression("v1", true)
        expect(pm.getExpressions()).toHaveLength(0)
        expect(eng.validate().ok).toBe(true)
    })

    it("setExtras succeeds under validation", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const { result: pm } = eng.createPremise()
        pm.setExtras({ label: "test" })
        expect(pm.getExtras()).toEqual({ label: "test" })
        expect(eng.validate().ok).toBe(true)
    })

    it("updateExpression rolls back on nonexistent variable reference", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(makeVar("var-p", "P"))
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeVarExpr("v1", "var-p", { premiseId: pm.getId() }))
        // Try updating to a nonexistent variable — should throw and roll back
        expect(() =>
            pm.updateExpression("v1", { variableId: "nonexistent" })
        ).toThrow()
        // Expression should still reference original variable
        const expr = pm.getExpression("v1")!
        expect(expr.type === "variable" && expr.variableId).toBe("var-p")
    })

    it("expression index is restored on rollback", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const { result: pm } = eng.createPremise()
        // Try adding an expression referencing a nonexistent variable
        expect(() =>
            pm.addExpression(
                makeVarExpr("v1", "nonexistent-var", {
                    premiseId: pm.getId(),
                })
            )
        ).toThrow()
        // Verify the expression is not in the engine's expression lookup
        expect(eng.getExpressionPremiseId("v1")).toBeUndefined()
    })
})

describe("Library — withValidation brackets", () => {
    it("ClaimLibrary validates after create", () => {
        const lib = new ClaimLibrary()
        lib.create({ id: "c1", type: "normal" })
        expect(lib.validate().ok).toBe(true)
    })

    it("ClaimLibrary validates after freeze", () => {
        const lib = new ClaimLibrary()
        lib.create({ id: "c1", type: "normal" })
        lib.freeze("c1")
        expect(lib.validate().ok).toBe(true)
    })

    it("ClaimLibrary rolls back on duplicate create", () => {
        const lib = new ClaimLibrary()
        lib.create({ id: "c1", type: "normal" })
        expect(() => lib.create({ id: "c1", type: "normal" })).toThrow()
        // Only one entry should exist after rollback
        expect(lib.getAll()).toHaveLength(1)
    })

    it("ClaimCitationLibrary validates after add", () => {
        const cl = aLib()
        cl.create({ id: "s1", type: "citation" })
        const ccl = new ClaimCitationLibrary(cl)
        ccl.add({
            id: "a1",
            claimId: "claim-default",
            claimVersion: 0,
            supportingClaimId: "s1",
            supportingClaimVersion: 0,
        })
        expect(ccl.validate().ok).toBe(true)
    })

    it("ClaimCitationLibrary validates after remove", () => {
        const cl = aLib()
        cl.create({ id: "s1", type: "citation" })
        const ccl = new ClaimCitationLibrary(cl)
        ccl.add({
            id: "a1",
            claimId: "claim-default",
            claimVersion: 0,
            supportingClaimId: "s1",
            supportingClaimVersion: 0,
        })
        ccl.remove("a1")
        expect(ccl.validate().ok).toBe(true)
        expect(ccl.getAll()).toHaveLength(0)
    })

    it("ClaimCitationLibrary rolls back on duplicate add", () => {
        const cl = aLib()
        cl.create({ id: "s1", type: "citation" })
        const ccl = new ClaimCitationLibrary(cl)
        ccl.add({
            id: "a1",
            claimId: "claim-default",
            claimVersion: 0,
            supportingClaimId: "s1",
            supportingClaimVersion: 0,
        })
        expect(() =>
            ccl.add({
                id: "a1",
                claimId: "claim-default",
                claimVersion: 0,
                supportingClaimId: "s1",
                supportingClaimVersion: 0,
            })
        ).toThrow()
        expect(ccl.getAll()).toHaveLength(1)
    })
})

describe("ArgumentEngine — bulk path validation", () => {
    // C7: load no longer enforces caller-supplied grammarConfig at load
    // time — the load runs Structural-only validation via PERMISSIVE
    // grammar config internally. Lower-tier violations surface post-load
    // via engine.validate(tier). Phase D removes these tests along with
    // the grammarConfig parameter on fromData/fromSnapshot.
    it("rollback validates and rejects invalid snapshot", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const { result: pm } = eng.createPremise()
        const premiseId = pm.getId()
        const goodSnap = eng.snapshot()
        // Tamper conclusionPremiseId
        const badSnap = { ...goodSnap, conclusionPremiseId: "nonexistent" }
        expect(() => eng.rollback(badSnap)).toThrow()
        // Engine should still hold the good state
        expect(eng.hasPremise(premiseId)).toBe(true)
        expect(eng.validate().ok).toBe(true)
    })
})


// ---------------------------------------------------------------------------
// Stale parent checksums in changeset (change-request 2026-03-27)
// ---------------------------------------------------------------------------

describe("Changeset includes ancestor checksum updates", () => {
    function setup() {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        const v1 = {
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        }
        const v2 = {
            id: "v2",
            symbol: "Q",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        }
        const v3 = {
            id: "v3",
            symbol: "R",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        }
        eng.addVariable(v1)
        eng.addVariable(v2)
        eng.addVariable(v3)
        const { result: pm } = eng.createPremise()
        return { eng, pm, v1, v2, v3 }
    }

    it("addExpression with parentId includes parent in modified", () => {
        const { pm } = setup()
        // Create root operator
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
        // Now add a second child — and1's descendantChecksum must change
        const { changes } = pm.addExpression({
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "and1",
            position: 2,
        })

        expect(changes.expressions?.added).toHaveLength(1)
        expect(changes.expressions?.added[0].id).toBe("e2")

        // and1 should appear in modified with updated checksums
        const modifiedIds = (changes.expressions?.modified ?? []).map(
            (e) => e.id
        )
        expect(modifiedIds).toContain("and1")

        const modifiedAnd = changes.expressions!.modified.find(
            (e) => e.id === "and1"
        )!
        // Verify the changeset checksum matches the in-memory state
        const inMemoryAnd = pm.getExpression("and1")!
        expect(modifiedAnd.descendantChecksum).toBe(
            inMemoryAnd.descendantChecksum
        )
        expect(modifiedAnd.combinedChecksum).toBe(inMemoryAnd.combinedChecksum)
    })

    it("addExpression includes all ancestors up to root in modified", () => {
        const { pm } = setup()
        // Build: implies(formula(and(v1)))
        pm.addExpression({
            id: "impl",
            type: "operator",
            operator: "implies",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: null,
            position: 1,
        })
        pm.addExpression({
            id: "f1",
            type: "formula",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "impl",
            position: 1,
        })
        pm.addExpression({
            id: "and1",
            type: "operator",
            operator: "and",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "f1",
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

        // Adding a new child to and1 should mark and1, f1, and impl as modified
        const { changes } = pm.addExpression({
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "and1",
            position: 2,
        })

        expect(changes.expressions?.added).toHaveLength(1)
        expect(changes.expressions?.added[0].id).toBe("e2")

        const modifiedIds = (changes.expressions?.modified ?? []).map(
            (e) => e.id
        )
        expect(modifiedIds).toContain("and1")
        expect(modifiedIds).toContain("f1")
        expect(modifiedIds).toContain("impl")
    })

    it("appendExpression includes parent in modified", () => {
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

        const { changes } = pm.appendExpression("and1", {
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "and1",
        })

        const modifiedIds = (changes.expressions?.modified ?? []).map(
            (e) => e.id
        )
        expect(modifiedIds).toContain("and1")
    })

    it("addExpressionRelative includes ancestors in modified", () => {
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

        const { changes } = pm.addExpressionRelative("e1", "after", {
            id: "e3",
            type: "variable",
            variableId: "v3",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "and1",
        })

        const modifiedIds = (changes.expressions?.modified ?? []).map(
            (e) => e.id
        )
        expect(modifiedIds).toContain("and1")
    })

    it("modified expressions have correct checksums (not stale pre-flush values)", () => {
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

        const { changes } = pm.addExpression({
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "and1",
            position: 2,
        })

        const modifiedAnd = (changes.expressions?.modified ?? []).find(
            (e) => e.id === "and1"
        )
        expect(modifiedAnd).toBeDefined()

        // The changeset's checksums should match the engine's in-memory state exactly
        const inMemory = pm.getExpression("and1")!
        expect(modifiedAnd!.checksum).toBe(inMemory.checksum)
        expect(modifiedAnd!.descendantChecksum).toBe(
            inMemory.descendantChecksum
        )
        expect(modifiedAnd!.combinedChecksum).toBe(inMemory.combinedChecksum)
    })

    it("added expressions are NOT duplicated in modified", () => {
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

        const { changes } = pm.addExpression({
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "and1",
            position: 2,
        })

        const addedIds = (changes.expressions?.added ?? []).map((e) => e.id)
        const modifiedIds = (changes.expressions?.modified ?? []).map(
            (e) => e.id
        )

        // e2 should only appear in added, not in modified
        expect(addedIds).toContain("e2")
        expect(modifiedIds).not.toContain("e2")
    })
})

describe("mergeChangesets", () => {
    it("merges two empty changesets", () => {
        const a: TCoreChangeset = {}
        const b: TCoreChangeset = {}
        const result = mergeChangesets(a, b)
        expect(result).toEqual({})
    })

    it("deduplicates by id with last-write-wins", () => {
        const a: TCoreChangeset = {
            expressions: {
                added: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "old",
                        descendantChecksum: null,
                        combinedChecksum: "old",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const b: TCoreChangeset = {
            expressions: {
                added: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "new",
                        descendantChecksum: null,
                        combinedChecksum: "new",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const result = mergeChangesets(a, b)
        expect(result.expressions?.added).toHaveLength(1)
        expect(result.expressions?.added[0].checksum).toBe("new")
    })

    it("merges different entity categories independently", () => {
        const a: TCoreChangeset = {
            expressions: {
                added: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const b: TCoreChangeset = {
            variables: {
                added: [
                    {
                        id: "var1",
                        symbol: "P",
                        argumentId: "a",
                        argumentVersion: 0,
                        claimId: "cl",
                        claimVersion: 0,
                        checksum: "c",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const result = mergeChangesets(a, b)
        expect(result.expressions?.added).toHaveLength(1)
        expect(result.variables?.added).toHaveLength(1)
    })

    it("throws when an entity appears in both added and removed", () => {
        const a: TCoreChangeset = {
            expressions: {
                added: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const b: TCoreChangeset = {
            expressions: {
                added: [],
                modified: [],
                removed: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
            },
        }
        expect(() => mergeChangesets(a, b)).toThrow(/added and removed/)
    })

    it("throws when an entity appears in both added and modified", () => {
        const a: TCoreChangeset = {
            expressions: {
                added: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const b: TCoreChangeset = {
            expressions: {
                added: [],
                modified: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c2",
                        descendantChecksum: null,
                        combinedChecksum: "c2",
                    },
                ],
                removed: [],
            },
        }
        expect(() => mergeChangesets(a, b)).toThrow(/added and modified/)
    })

    it("throws when an entity appears in both modified and removed", () => {
        const a: TCoreChangeset = {
            expressions: {
                added: [],
                modified: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
                removed: [],
            },
        }
        const b: TCoreChangeset = {
            expressions: {
                added: [],
                modified: [],
                removed: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
            },
        }
        expect(() => mergeChangesets(a, b)).toThrow(/modified and removed/)
    })

    it("throws when a variable appears in both added and removed", () => {
        const a: TCoreChangeset = {
            variables: {
                added: [
                    {
                        id: "v1",
                        symbol: "P",
                        argumentId: "a",
                        argumentVersion: 0,
                        claimId: "cl",
                        claimVersion: 0,
                        checksum: "c",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const b: TCoreChangeset = {
            variables: {
                added: [],
                modified: [],
                removed: [
                    {
                        id: "v1",
                        symbol: "P",
                        argumentId: "a",
                        argumentVersion: 0,
                        claimId: "cl",
                        claimVersion: 0,
                        checksum: "c",
                    },
                ],
            },
        }
        expect(() => mergeChangesets(a, b)).toThrow(/variables/)
    })

    it("takes roles from b when present", () => {
        const a: TCoreChangeset = { roles: { conclusionPremiseId: "p1" } }
        const b: TCoreChangeset = { roles: { conclusionPremiseId: "p2" } }
        const result = mergeChangesets(a, b)
        expect(result.roles?.conclusionPremiseId).toBe("p2")
    })

    it("keeps roles from a when b has none", () => {
        const a: TCoreChangeset = { roles: { conclusionPremiseId: "p1" } }
        const b: TCoreChangeset = {}
        const result = mergeChangesets(a, b)
        expect(result.roles?.conclusionPremiseId).toBe("p1")
    })

    it("takes argument from b when present", () => {
        const a: TCoreChangeset = {
            argument: { id: "a1", version: 0 } as TCoreArgument,
        }
        const b: TCoreChangeset = {
            argument: { id: "a1", version: 1 } as TCoreArgument,
        }
        const result = mergeChangesets(a, b)
        expect(result.argument?.version).toBe(1)
    })

    it("omits empty entity categories from result", () => {
        const a: TCoreChangeset = {}
        const b: TCoreChangeset = {
            expressions: { added: [], modified: [], removed: [] },
        }
        const result = mergeChangesets(a, b)
        expect(result.expressions).toBeUndefined()
    })
})

describe("orderChangeset", () => {
    // Helper: extract entity names from operation list in order
    const opSummary = (ops: TOrderedOperation[]) =>
        ops.map((op) => `${op.type}:${op.entity}`)

    it("returns empty array for empty changeset", () => {
        const result = orderChangeset({})
        expect(result).toEqual([])
    })

    it("orders deletes in reverse FK order: expressions → variables → premises", () => {
        const changeset: TCoreChangeset = {
            premises: {
                added: [],
                modified: [],
                removed: [
                    {
                        id: "p1",
                        argumentId: "a",
                        argumentVersion: 0,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                        type: "freeform" as const,
                    },
                ],
            },
            variables: {
                added: [],
                modified: [],
                removed: [
                    {
                        id: "v1",
                        symbol: "P",
                        argumentId: "a",
                        argumentVersion: 0,
                        claimId: "cl",
                        claimVersion: 0,
                        checksum: "c",
                    },
                ],
            },
            expressions: {
                added: [],
                modified: [],
                removed: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
            },
        }
        const ops = orderChangeset(changeset)
        const summary = opSummary(ops)
        const deleteExpr = summary.indexOf("delete:expression")
        const deleteVar = summary.indexOf("delete:variable")
        const deletePremise = summary.indexOf("delete:premise")
        expect(deleteExpr).toBeLessThan(deleteVar)
        expect(deleteVar).toBeLessThan(deletePremise)
    })

    it("orders inserts in FK-safe order: premises → variables → expressions", () => {
        const changeset: TCoreChangeset = {
            premises: {
                added: [
                    {
                        id: "p1",
                        argumentId: "a",
                        argumentVersion: 0,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                        type: "freeform" as const,
                    },
                ],
                modified: [],
                removed: [],
            },
            variables: {
                added: [
                    {
                        id: "v1",
                        symbol: "P",
                        argumentId: "a",
                        argumentVersion: 0,
                        claimId: "cl",
                        claimVersion: 0,
                        checksum: "c",
                    },
                ],
                modified: [],
                removed: [],
            },
            expressions: {
                added: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const ops = orderChangeset(changeset)
        const summary = opSummary(ops)
        const insertPremise = summary.indexOf("insert:premise")
        const insertVar = summary.indexOf("insert:variable")
        const insertExpr = summary.indexOf("insert:expression")
        expect(insertPremise).toBeLessThan(insertVar)
        expect(insertVar).toBeLessThan(insertExpr)
    })

    it("orders premise updates before deletes", () => {
        const changeset: TCoreChangeset = {
            premises: {
                added: [],
                modified: [
                    {
                        id: "p1",
                        argumentId: "a",
                        argumentVersion: 0,
                        checksum: "c2",
                        descendantChecksum: null,
                        combinedChecksum: "c2",
                        type: "freeform" as const,
                    },
                ],
                removed: [
                    {
                        id: "p2",
                        argumentId: "a",
                        argumentVersion: 0,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                        type: "freeform" as const,
                    },
                ],
            },
            expressions: {
                added: [],
                modified: [],
                removed: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p2",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
            },
        }
        const ops = orderChangeset(changeset)
        const summary = opSummary(ops)
        const updatePremise = summary.indexOf("update:premise")
        const deleteExpr = summary.indexOf("delete:expression")
        expect(updatePremise).toBeLessThan(deleteExpr)
    })

    it("topologically sorts inserted expressions so parents come before children", () => {
        const changeset: TCoreChangeset = {
            expressions: {
                added: [
                    {
                        id: "child",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: "parent",
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                    {
                        id: "parent",
                        type: "operator",
                        operator: "and",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: "d",
                        combinedChecksum: "cd",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const ops = orderChangeset(changeset)
        const insertOps = ops.filter(
            (op) => op.type === "insert" && op.entity === "expression"
        )
        expect(insertOps).toHaveLength(2)
        expect(insertOps[0].data.id).toBe("parent")
        expect(insertOps[1].data.id).toBe("child")
    })

    it("topologically sorts 3-level deep inserted expressions", () => {
        const changeset: TCoreChangeset = {
            expressions: {
                added: [
                    {
                        id: "grandchild",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: "child",
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                    {
                        id: "root",
                        type: "operator",
                        operator: "and",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: "d",
                        combinedChecksum: "cd",
                    },
                    {
                        id: "child",
                        type: "formula",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: "root",
                        position: 1,
                        checksum: "c",
                        descendantChecksum: "d",
                        combinedChecksum: "cd",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const ops = orderChangeset(changeset)
        const insertOps = ops.filter(
            (op) => op.type === "insert" && op.entity === "expression"
        )
        expect(insertOps.map((op) => op.data.id)).toEqual([
            "root",
            "child",
            "grandchild",
        ])
    })

    it("puts deletes before inserts", () => {
        const changeset: TCoreChangeset = {
            expressions: {
                added: [
                    {
                        id: "e2",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
                modified: [],
                removed: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
            },
        }
        const ops = orderChangeset(changeset)
        const summary = opSummary(ops)
        const deleteIdx = summary.indexOf("delete:expression")
        const insertIdx = summary.indexOf("insert:expression")
        expect(deleteIdx).toBeLessThan(insertIdx)
    })

    it("reverse-topologically sorts deleted expressions so children come before parents", () => {
        const changeset: TCoreChangeset = {
            expressions: {
                added: [],
                modified: [],
                removed: [
                    {
                        id: "parent",
                        type: "operator",
                        operator: "and",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: "d",
                        combinedChecksum: "cd",
                    },
                    {
                        id: "child",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: "parent",
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
            },
        }
        const ops = orderChangeset(changeset)
        const deleteOps = ops.filter(
            (op) => op.type === "delete" && op.entity === "expression"
        )
        expect(deleteOps).toHaveLength(2)
        expect(deleteOps[0].data.id).toBe("child")
        expect(deleteOps[1].data.id).toBe("parent")
    })

    it("emits reparent updates before deleting the old parent (cascade safety)", () => {
        // Scenario: absorbSameOperator reparents V3, V4 from OR to AND,
        // then deletes OR and F1. If the DB has ON DELETE CASCADE on
        // parentId, deleting OR before updating V3/V4's parentId destroys them.
        const changeset: TCoreChangeset = {
            expressions: {
                added: [],
                modified: [
                    {
                        // V3 — reparented from OR to AND
                        id: "v3",
                        type: "variable",
                        variableId: "var3",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: "and", // new parent
                        position: 3,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                    {
                        // V4 — reparented from OR to AND
                        id: "v4",
                        type: "variable",
                        variableId: "var4",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: "and", // new parent
                        position: 4,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                    {
                        // AND — checksum updated (not reparented)
                        id: "and",
                        type: "operator",
                        operator: "and",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c2",
                        descendantChecksum: "d2",
                        combinedChecksum: "cd2",
                    },
                ],
                removed: [
                    {
                        // OR — the old parent being deleted
                        id: "or",
                        type: "operator",
                        operator: "or",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: "f1",
                        position: 1,
                        checksum: "c",
                        descendantChecksum: "d",
                        combinedChecksum: "cd",
                    },
                    {
                        // F1 — formula wrapper also deleted
                        id: "f1",
                        type: "formula",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: "and",
                        position: 2,
                        checksum: "c",
                        descendantChecksum: "d",
                        combinedChecksum: "cd",
                    },
                ],
            },
        }
        const ops = orderChangeset(changeset)

        // Find the first update for a reparented child (v3 or v4)
        const firstReparentUpdate = ops.findIndex(
            (op) =>
                op.type === "update" &&
                op.entity === "expression" &&
                (op.data.id === "v3" || op.data.id === "v4")
        )
        // Find the first delete of the old parent
        const firstDelete = ops.findIndex(
            (op) =>
                op.type === "delete" &&
                op.entity === "expression" &&
                (op.data.id === "or" || op.data.id === "f1")
        )

        expect(firstReparentUpdate).not.toBe(-1)
        expect(firstDelete).not.toBe(-1)
        // The reparent update must come BEFORE the delete
        expect(firstReparentUpdate).toBeLessThan(firstDelete)
    })

    it("drops expressions from modified when also in removed (dedup)", () => {
        // Scenario: changeOperatorType records OR as modified (operator
        // field changed), then absorbSameOperator records it as removed.
        // The changeset should not contain OR in both buckets.
        const changeset: TCoreChangeset = {
            expressions: {
                added: [],
                modified: [
                    {
                        // OR — stale modified entry (also being deleted)
                        id: "or",
                        type: "operator",
                        operator: "and", // changed from or to and
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: "f1",
                        position: 1,
                        checksum: "c",
                        descendantChecksum: "d",
                        combinedChecksum: "cd",
                    },
                    {
                        // V3 — legitimately modified (reparented)
                        id: "v3",
                        type: "variable",
                        variableId: "var3",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: "and",
                        position: 3,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
                removed: [
                    {
                        id: "or",
                        type: "operator",
                        operator: "or",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: "f1",
                        position: 1,
                        checksum: "c",
                        descendantChecksum: "d",
                        combinedChecksum: "cd",
                    },
                ],
            },
        }
        const ops = orderChangeset(changeset)

        // OR should appear only as a delete, not as an update
        const orOps = ops.filter(
            (op) => op.entity === "expression" && op.data.id === "or"
        )
        expect(orOps).toHaveLength(1)
        expect(orOps[0].type).toBe("delete")

        // V3 should still appear as an update
        const v3Ops = ops.filter(
            (op) =>
                op.type === "update" &&
                op.entity === "expression" &&
                op.data.id === "v3"
        )
        expect(v3Ops).toHaveLength(1)
    })

    it("includes argument and roles updates at the end", () => {
        const changeset: TCoreChangeset = {
            roles: { conclusionPremiseId: "p1" },
            argument: { id: "a1", version: 1 } as TCoreArgument,
            variables: {
                added: [
                    {
                        id: "v1",
                        symbol: "P",
                        argumentId: "a",
                        argumentVersion: 0,
                        claimId: "cl",
                        claimVersion: 0,
                        checksum: "c",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const ops = orderChangeset(changeset)
        const summary = opSummary(ops)
        const insertVar = summary.indexOf("insert:variable")
        const updateArg = summary.indexOf("update:argument")
        const updateRoles = summary.indexOf("update:roles")
        expect(insertVar).toBeLessThan(updateArg)
        expect(insertVar).toBeLessThan(updateRoles)
    })
})

describe("createLookup", () => {
    it("builds a lookup from an array", () => {
        const items = [
            { id: "c1", version: 0, frozen: false, checksum: "" },
            { id: "c1", version: 1, frozen: true, checksum: "abc" },
            { id: "c2", version: 0, frozen: false, checksum: "" },
        ]
        const lookup = createLookup(items, (c) => `${c.id}:${c.version}`)
        expect(lookup.get("c1", 0)).toEqual(items[0])
        expect(lookup.get("c1", 1)).toEqual(items[1])
        expect(lookup.get("c2", 0)).toEqual(items[2])
    })

    it("returns undefined for missing keys", () => {
        const lookup = createLookup(
            [] as { id: string; version: number }[],
            (c) => `${c.id}:${c.version}`
        )
        expect(lookup.get("missing", 0)).toBeUndefined()
    })

    it("last item wins when keys collide", () => {
        const items = [
            { id: "c1", version: 0, frozen: false, checksum: "first" },
            { id: "c1", version: 0, frozen: false, checksum: "second" },
        ]
        const lookup = createLookup(items, (c) => `${c.id}:${c.version}`)
        expect(lookup.get("c1", 0)?.checksum).toBe("second")
    })
})

describe("empty lookup constants", () => {
    it("EMPTY_CLAIM_LOOKUP.get returns undefined", () => {
        expect(EMPTY_CLAIM_LOOKUP.get("any", 0)).toBeUndefined()
    })

    it("emptyClaimConnectionLookup().get returns undefined", () => {
        expect(
            emptyClaimConnectionLookup<TCoreClaimConnection>().get("any")
        ).toBeUndefined()
    })

    it("emptyClaimConnectionLookup().getConnectionsForClaim returns empty array", () => {
        expect(
            emptyClaimConnectionLookup<TCoreClaimConnection>().getConnectionsForClaim(
                "any"
            )
        ).toEqual([])
    })
})

describe("forkArgumentEngine", () => {
    it("produces identical results to the engine method", () => {
        const claimLib = aLib()

        const eng = new ArgumentEngine({ id: "src-arg", version: 2 }, claimLib)

        eng.addVariable({
            id: "var-p",
            argumentId: "src-arg",
            argumentVersion: 2,
            symbol: "P",
            claimId: "claim-default",
            claimVersion: 0,
        } as TClaimBoundVariable)

        const { result: pm } = eng.createPremiseWithId("prem-1")
        pm.addExpression({
            id: "expr-1",
            argumentId: "src-arg",
            argumentVersion: 2,
            premiseId: "prem-1",
            type: "variable",
            variableId: "var-p",
            parentId: null,
            position: POSITION_INITIAL,
        })

        eng.setConclusionPremise("prem-1")

        const forkClaimLib = aLib()

        let counter = 0
        const { engine: forked, remapTable } = forkArgumentEngine(
            eng,
            "fork-arg",
            {
                claimLibrary: forkClaimLib,
            },
            { generateId: () => `fk-${counter++}` }
        )

        // Verify argument identity
        const forkedArg = forked.getArgument()
        expect(forkedArg.id).toBe("fork-arg")
        expect(forkedArg.version).toBe(0)

        // Verify remap table
        expect(remapTable.argumentId).toEqual({
            from: "src-arg",
            to: "fork-arg",
        })
        expect(remapTable.premises.size).toBe(1)
        expect(remapTable.expressions.size).toBe(1)
        expect(remapTable.variables.size).toBe(2) // var-p + auto premise-bound

        // Verify premise was remapped
        const forkedPremise = forked.listPremises()[0]
        expect(forkedPremise.getId()).toBe(remapTable.premises.get("prem-1"))

        // Verify expression was remapped
        const forkedExpr = forkedPremise.getExpressions()[0]
        expect(forkedExpr.id).toBe(remapTable.expressions.get("expr-1"))

        // Verify variable was remapped
        const forkedVar = forked
            .getVariables()
            .find((v) => v.id === remapTable.variables.get("var-p"))!
        expect(forkedVar).toBeDefined()

        // Verify conclusion remapped
        expect(forked.getConclusionPremise()?.getId()).toBe(
            remapTable.premises.get("prem-1")
        )

        // Verify independence
        forked.createPremise()
        expect(eng.listPremises()).toHaveLength(1)
        expect(forked.listPremises()).toHaveLength(2)
    })

    it("does not call canFork()", () => {
        class NoForkEngine extends ArgumentEngine {
            public override canFork(): boolean {
                return false
            }
        }
        const eng = new NoForkEngine(ARG, aLib())
        // Standalone function should NOT check canFork
        expect(() =>
            forkArgumentEngine(eng, "new-arg", {
                claimLibrary: aLib(),
            })
        ).not.toThrow()
    })
})

describe("ForkRecordSchemas", () => {
    describe("CoreEntityForkRecordSchema", () => {
        it("should accept a valid entity fork record", () => {
            const record = {
                entityId: crypto.randomUUID(),
                forkedFromEntityId: crypto.randomUUID(),
                forkedFromArgumentId: crypto.randomUUID(),
                forkedFromArgumentVersion: 3,
                forkId: crypto.randomUUID(),
            }
            expect(Value.Check(CoreEntityForkRecordSchema, record)).toBe(true)
        })

        it("should reject a record missing required fields", () => {
            const record = {
                entityId: crypto.randomUUID(),
            }
            expect(Value.Check(CoreEntityForkRecordSchema, record)).toBe(false)
        })

        it("should accept additional properties", () => {
            const record = {
                entityId: crypto.randomUUID(),
                forkedFromEntityId: crypto.randomUUID(),
                forkedFromArgumentId: crypto.randomUUID(),
                forkedFromArgumentVersion: 0,
                forkId: crypto.randomUUID(),
                customField: "hello",
            }
            expect(Value.Check(CoreEntityForkRecordSchema, record)).toBe(true)
        })
    })

    describe("CoreExpressionForkRecordSchema", () => {
        it("should require forkedFromPremiseId", () => {
            const base = {
                entityId: crypto.randomUUID(),
                forkedFromEntityId: crypto.randomUUID(),
                forkedFromArgumentId: crypto.randomUUID(),
                forkedFromArgumentVersion: 0,
                forkId: crypto.randomUUID(),
            }
            expect(Value.Check(CoreExpressionForkRecordSchema, base)).toBe(
                false
            )

            const withPremise = {
                ...base,
                forkedFromPremiseId: crypto.randomUUID(),
            }
            expect(
                Value.Check(CoreExpressionForkRecordSchema, withPremise)
            ).toBe(true)
        })
    })

    describe("CoreClaimForkRecordSchema", () => {
        it("should require forkedFromEntityVersion", () => {
            const base = {
                entityId: crypto.randomUUID(),
                forkedFromEntityId: crypto.randomUUID(),
                forkedFromArgumentId: crypto.randomUUID(),
                forkedFromArgumentVersion: 0,
                forkId: crypto.randomUUID(),
            }
            expect(Value.Check(CoreClaimForkRecordSchema, base)).toBe(false)

            const withVersion = { ...base, forkedFromEntityVersion: 2 }
            expect(Value.Check(CoreClaimForkRecordSchema, withVersion)).toBe(
                true
            )
        })
    })
})

describe("ForkNamespace", () => {
    const makeRecord = (
        overrides: Partial<TCoreEntityForkRecord> = {}
    ): TCoreEntityForkRecord => ({
        entityId: crypto.randomUUID(),
        forkedFromEntityId: crypto.randomUUID(),
        forkedFromArgumentId: crypto.randomUUID(),
        forkedFromArgumentVersion: 0,
        forkId: crypto.randomUUID(),
        ...overrides,
    })

    describe("create", () => {
        it("should store and return the record", () => {
            const ns = new ForkNamespace()
            const record = makeRecord()
            const result = ns.create(record)
            expect(result).toEqual(record)
            expect(ns.get(record.entityId)).toEqual(record)
        })

        it("should throw on duplicate entityId", () => {
            const ns = new ForkNamespace()
            const record = makeRecord()
            ns.create(record)
            expect(() => ns.create(record)).toThrow(/already exists/)
        })
    })

    describe("get", () => {
        it("should return undefined for missing entityId", () => {
            const ns = new ForkNamespace()
            expect(ns.get("nonexistent")).toBeUndefined()
        })
    })

    describe("getAll", () => {
        it("should return all records", () => {
            const ns = new ForkNamespace()
            const r1 = ns.create(makeRecord())
            const r2 = ns.create(makeRecord())
            expect(ns.getAll()).toEqual(expect.arrayContaining([r1, r2]))
            expect(ns.getAll()).toHaveLength(2)
        })
    })

    describe("getByForkId", () => {
        it("should return records matching the forkId", () => {
            const ns = new ForkNamespace()
            const forkId = crypto.randomUUID()
            const r1 = ns.create(makeRecord({ forkId }))
            const r2 = ns.create(makeRecord({ forkId }))
            ns.create(makeRecord({ forkId: crypto.randomUUID() }))

            const results = ns.getByForkId(forkId)
            expect(results).toHaveLength(2)
            expect(results).toEqual(expect.arrayContaining([r1, r2]))
        })

        it("should return empty array for unknown forkId", () => {
            const ns = new ForkNamespace()
            expect(ns.getByForkId("nonexistent")).toEqual([])
        })
    })

    describe("remove", () => {
        it("should remove and return the record", () => {
            const ns = new ForkNamespace()
            const record = ns.create(makeRecord())
            const removed = ns.remove(record.entityId)
            expect(removed).toEqual(record)
            expect(ns.get(record.entityId)).toBeUndefined()
        })

        it("should throw if entityId not found", () => {
            const ns = new ForkNamespace()
            expect(() => ns.remove("nonexistent")).toThrow(/not found/)
        })
    })

    describe("snapshot / fromSnapshot", () => {
        it("should round-trip all records", () => {
            const ns = new ForkNamespace()
            const r1 = ns.create(makeRecord())
            const r2 = ns.create(makeRecord())

            const snap = ns.snapshot()
            const restored = ForkNamespace.fromSnapshot(snap)

            expect(restored.getAll()).toEqual(expect.arrayContaining([r1, r2]))
            expect(restored.getAll()).toHaveLength(2)
        })
    })

    describe("validate", () => {
        it("should return ok for valid records", () => {
            const ns = new ForkNamespace()
            ns.create(makeRecord())
            const result = ns.validate()
            expect(result.ok).toBe(true)
        })
    })
})

describe("ForkLibrary", () => {
    const makeBaseRecord = (
        overrides: Partial<TCoreEntityForkRecord> = {}
    ): TCoreEntityForkRecord => ({
        entityId: crypto.randomUUID(),
        forkedFromEntityId: crypto.randomUUID(),
        forkedFromArgumentId: crypto.randomUUID(),
        forkedFromArgumentVersion: 0,
        forkId: crypto.randomUUID(),
        ...overrides,
    })

    it("should expose five namespaces", () => {
        const lib = new ForkLibrary()
        expect(lib.arguments).toBeInstanceOf(ForkNamespace)
        expect(lib.premises).toBeInstanceOf(ForkNamespace)
        expect(lib.expressions).toBeInstanceOf(ForkNamespace)
        expect(lib.variables).toBeInstanceOf(ForkNamespace)
        expect(lib.claims).toBeInstanceOf(ForkNamespace)
    })

    it("should round-trip all namespaces via snapshot/fromSnapshot", () => {
        const lib = new ForkLibrary()
        const forkId = crypto.randomUUID()
        const argRecord = lib.arguments.create(makeBaseRecord({ forkId }))
        const premRecord = lib.premises.create(makeBaseRecord({ forkId }))
        const exprRecord = lib.expressions.create({
            ...makeBaseRecord({ forkId }),
            forkedFromPremiseId: crypto.randomUUID(),
        } as TCoreExpressionForkRecord)
        const varRecord = lib.variables.create(makeBaseRecord({ forkId }))
        const claimRecord = lib.claims.create({
            ...makeBaseRecord({ forkId }),
            forkedFromEntityVersion: 2,
        } as TCoreClaimForkRecord)

        const snap = lib.snapshot()
        const restored = ForkLibrary.fromSnapshot(snap)

        expect(restored.arguments.get(argRecord.entityId)).toEqual(argRecord)
        expect(restored.premises.get(premRecord.entityId)).toEqual(premRecord)
        expect(restored.expressions.get(exprRecord.entityId)).toEqual(
            exprRecord
        )
        expect(restored.variables.get(varRecord.entityId)).toEqual(varRecord)
        expect(restored.claims.get(claimRecord.entityId)).toEqual(claimRecord)
    })

    it("should merge validation results from all namespaces", () => {
        const lib = new ForkLibrary()
        lib.arguments.create(makeBaseRecord())
        const result = lib.validate()
        expect(result.ok).toBe(true)
    })
})

describe("ArgumentLibrary", () => {
    const makeArgument = (): TOptionalChecksum<TCoreArgument> => ({
        id: crypto.randomUUID(),
        version: 0,
    })

    const makeLibraries = () => {
        const claimLibrary = new ClaimLibrary()
        return { claimLibrary }
    }

    it("should create and retrieve an engine", () => {
        const libs = makeLibraries()
        const argLib = new ArgumentLibrary(libs)
        const arg = makeArgument()
        const engine = argLib.create(arg)

        expect(engine).toBeInstanceOf(ArgumentEngine)
        expect(engine.getArgument().id).toBe(arg.id)
        expect(argLib.get(arg.id)).toBe(engine)
    })

    it("should throw on duplicate argument ID", () => {
        const libs = makeLibraries()
        const argLib = new ArgumentLibrary(libs)
        const arg = makeArgument()
        argLib.create(arg)
        expect(() => argLib.create(arg)).toThrow(/already exists/)
    })

    it("should list all engines", () => {
        const libs = makeLibraries()
        const argLib = new ArgumentLibrary(libs)
        argLib.create(makeArgument())
        argLib.create(makeArgument())
        expect(argLib.getAll()).toHaveLength(2)
    })

    it("should remove and return an engine", () => {
        const libs = makeLibraries()
        const argLib = new ArgumentLibrary(libs)
        const arg = makeArgument()
        const engine = argLib.create(arg)
        const removed = argLib.remove(arg.id)

        expect(removed).toBe(engine)
        expect(argLib.get(arg.id)).toBeUndefined()
    })

    it("should throw when removing nonexistent ID", () => {
        const libs = makeLibraries()
        const argLib = new ArgumentLibrary(libs)
        expect(() => argLib.remove("nonexistent")).toThrow(/not found/)
    })

    it("should round-trip via snapshot/fromSnapshot", () => {
        const libs = makeLibraries()
        const argLib = new ArgumentLibrary(libs)
        const arg = makeArgument()
        argLib.create(arg)

        const snap = argLib.snapshot()
        const restored = ArgumentLibrary.fromSnapshot(snap, libs)

        expect(restored.get(arg.id)).toBeDefined()
        expect(restored.get(arg.id)!.getArgument().id).toBe(arg.id)
    })

    it("should register a pre-built engine", () => {
        const libs = makeLibraries()
        const argLib = new ArgumentLibrary(libs)
        const arg = makeArgument()
        const engine = new ArgumentEngine(arg, libs.claimLibrary)
        argLib.register(engine)
        expect(argLib.get(arg.id)).toBe(engine)
    })

    it("should throw when registering duplicate ID", () => {
        const libs = makeLibraries()
        const argLib = new ArgumentLibrary(libs)
        const arg = makeArgument()
        argLib.create(arg)
        const engine = new ArgumentEngine(arg, libs.claimLibrary)
        expect(() => argLib.register(engine)).toThrow(/already exists/)
    })
})

describe("PropositCore", () => {
    it("should construct with default libraries", () => {
        const core = new PropositCore()
        expect(core.arguments).toBeInstanceOf(ArgumentLibrary)
        expect(core.claims).toBeInstanceOf(ClaimLibrary)
        expect(core.citations).toBeInstanceOf(ClaimCitationLibrary)
        expect(core.forks).toBeInstanceOf(ForkLibrary)
    })

    it("should accept pre-constructed libraries", () => {
        const claimLibrary = new ClaimLibrary()
        const claimCitationLibrary = new ClaimCitationLibrary(claimLibrary)
        const core = new PropositCore({
            claimLibrary,
            claimCitationLibrary,
        })
        expect(core.claims).toBe(claimLibrary)
        expect(core.citations).toBe(claimCitationLibrary)
    })

    it("should accept a pre-constructed fork library", () => {
        const forkLibrary = new ForkLibrary()
        const core = new PropositCore({ forkLibrary })
        expect(core.forks).toBe(forkLibrary)
    })

    it("should accept a pre-constructed argument library", () => {
        const claimLibrary = new ClaimLibrary()
        const claimCitationLibrary = new ClaimCitationLibrary(claimLibrary)
        const argumentLibrary = new ArgumentLibrary({
            claimLibrary,
        })
        const core = new PropositCore({
            claimLibrary,
            claimCitationLibrary,
            argumentLibrary,
        })
        expect(core.arguments).toBe(argumentLibrary)
    })

    it("should round-trip via snapshot/fromSnapshot with claims", () => {
        const core = new PropositCore()
        const claim = core.claims.create({
            id: crypto.randomUUID(),
            type: "normal",
        })

        const snap = core.snapshot()
        const restored = PropositCore.fromSnapshot(snap)

        expect(restored.claims.get(claim.id, claim.version)).toBeDefined()
        expect(restored.claims.get(claim.id, claim.version)!.id).toBe(claim.id)
    })

    it("should round-trip via snapshot/fromSnapshot with arguments", () => {
        const core = new PropositCore()
        const argId = crypto.randomUUID()
        core.arguments.create({ id: argId, version: 0 })

        const snap = core.snapshot()
        const restored = PropositCore.fromSnapshot(snap)

        expect(restored.arguments.get(argId)).toBeDefined()
    })

    it("should round-trip via snapshot/fromSnapshot with claim citations", () => {
        const core = new PropositCore()
        const claim = core.claims.create({
            id: crypto.randomUUID(),
            type: "normal",
        })
        core.claims.freeze(claim.id)
        const source = core.claims.create({
            id: crypto.randomUUID(),
            type: "citation",
        })
        core.claims.freeze(source.id)
        const cit = core.citations.add({
            id: crypto.randomUUID(),
            claimId: claim.id,
            claimVersion: 0,
            supportingClaimId: source.id,
            supportingClaimVersion: 0,
        })

        const snap = core.snapshot()
        const restored = PropositCore.fromSnapshot(snap)

        expect(restored.citations.get(cit.id)).toBeDefined()
        expect(restored.citations.get(cit.id)!.claimId).toBe(claim.id)
    })

    it("should round-trip via snapshot/fromSnapshot with fork records", () => {
        const core = new PropositCore()
        const forkId = crypto.randomUUID()
        core.forks.arguments.create({
            entityId: crypto.randomUUID(),
            forkedFromEntityId: crypto.randomUUID(),
            forkedFromArgumentId: crypto.randomUUID(),
            forkedFromArgumentVersion: 0,
            forkId,
        })

        const snap = core.snapshot()
        const restored = PropositCore.fromSnapshot(snap)

        expect(restored.forks.arguments.getAll()).toHaveLength(1)
        expect(restored.forks.arguments.getAll()[0].forkId).toBe(forkId)
    })

    it("should round-trip a full snapshot with all library types", () => {
        const core = new PropositCore()

        // Populate claims (one normal, one citation)
        const claim = core.claims.create({
            id: crypto.randomUUID(),
            type: "normal",
        })
        core.claims.freeze(claim.id)
        const source = core.claims.create({
            id: crypto.randomUUID(),
            type: "citation",
        })
        core.claims.freeze(source.id)

        // Populate citations
        core.citations.add({
            id: crypto.randomUUID(),
            claimId: claim.id,
            claimVersion: 0,
            supportingClaimId: source.id,
            supportingClaimVersion: 0,
        })

        // Populate arguments
        core.arguments.create({ id: crypto.randomUUID(), version: 0 })

        // Populate forks
        core.forks.arguments.create({
            entityId: crypto.randomUUID(),
            forkedFromEntityId: crypto.randomUUID(),
            forkedFromArgumentId: crypto.randomUUID(),
            forkedFromArgumentVersion: 0,
            forkId: crypto.randomUUID(),
        })

        const snap = core.snapshot()
        const restored = PropositCore.fromSnapshot(snap)

        expect(restored.claims.getAll()).toHaveLength(4) // 2× (frozen + successor)
        expect(restored.citations.getAll()).toHaveLength(1)
        expect(restored.arguments.getAll()).toHaveLength(1)
        expect(restored.forks.arguments.getAll()).toHaveLength(1)
    })

    it("should return ok validation for empty core", () => {
        const core = new PropositCore()
        const result = core.validate()
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
    })

    it("should merge validation results from all libraries", () => {
        const core = new PropositCore()

        // Populate with valid data
        const claim = core.claims.create({
            id: crypto.randomUUID(),
            type: "normal",
        })
        core.claims.freeze(claim.id)
        const source = core.claims.create({
            id: crypto.randomUUID(),
            type: "citation",
        })
        core.claims.freeze(source.id)
        core.arguments.create({ id: crypto.randomUUID(), version: 0 })

        const result = core.validate()
        expect(result.ok).toBe(true)
    })

    it("should propagate config to internally constructed libraries", () => {
        // The config should thread through to ArgumentLibrary engine options.
        // We verify this indirectly by creating an argument engine and checking
        // it works properly with default config.
        const core = new PropositCore({
            checksumConfig: {
                argumentFields: new Set(["id", "version"]),
            },
        })
        const argId = crypto.randomUUID()
        const engine = core.arguments.create({ id: argId, version: 0 })
        expect(engine).toBeDefined()
        expect(engine.getArgument().id).toBe(argId)
    })

    describe("forkArgument", () => {
        const setupForFork = () => {
            const core = new PropositCore()

            // Create a normal claim and freeze it
            const claim = core.claims.create({
                id: crypto.randomUUID(),
                type: "normal",
            })
            const frozenResult = core.claims.freeze(claim.id)

            // Create a citation-typed claim (the source-side endpoint) and freeze it
            const source = core.claims.create({
                id: crypto.randomUUID(),
                type: "citation",
            })
            const frozenSource = core.claims.freeze(source.id)

            // Create a citation linking citing claim → source claim
            const cit = core.citations.add({
                id: crypto.randomUUID(),
                claimId: frozenResult.frozen.id,
                claimVersion: frozenResult.frozen.version,
                supportingClaimId: frozenSource.frozen.id,
                supportingClaimVersion: frozenSource.frozen.version,
            })

            // Create an argument with a variable referencing the frozen claim
            const arg = { id: crypto.randomUUID(), version: 0 }
            const engine = core.arguments.create(arg)
            const { result: premiseEngine } = engine.createPremise()
            const premiseId = premiseEngine.toPremiseData().id
            const { result: variable } = engine.addVariable({
                id: crypto.randomUUID(),
                symbol: "P",
                argumentId: arg.id,
                argumentVersion: 0,
                claimId: frozenResult.frozen.id,
                claimVersion: frozenResult.frozen.version,
            })
            premiseEngine.addExpression({
                id: crypto.randomUUID(),
                argumentId: arg.id,
                argumentVersion: 0,
                premiseId,
                type: "variable",
                variableId: variable.id,
                parentId: null,
                position: POSITION_INITIAL,
            })

            return {
                core,
                arg,
                engine,
                claim: frozenResult.frozen,
                source: frozenSource.frozen,
                cit,
                variable,
                premiseId,
            }
        }

        it("should fork an argument with cloned claims and citations", () => {
            const { core, arg, premiseId } = setupForFork()
            const newArgId = crypto.randomUUID()
            const result = core.forkArgument(arg.id, newArgId)

            expect(core.arguments.get(newArgId)).toBeDefined()
            expect(result.engine.getArgument().id).toBe(newArgId)
            // claimRemap covers the claim-bound variable's claim plus the
            // citation-typed source claim transitively pulled in.
            expect(result.claimRemap.size).toBe(2)
            expect(result.argumentFork).toBeDefined()
            expect(core.forks.arguments.getAll()).toHaveLength(1)
            expect(core.forks.premises.getAll().length).toBeGreaterThan(0)
            expect(core.forks.variables.getAll().length).toBeGreaterThan(0)
            expect(core.forks.claims.getAll()).toHaveLength(2)
            expect(core.forks.expressions.getAll().length).toBeGreaterThan(0)
            const exprFork = core.forks.expressions.getAll()[0]
            expect(exprFork.forkedFromPremiseId).toBe(premiseId)
        })

        it("should update forked variables to reference cloned claims", () => {
            const { core, arg, claim } = setupForFork()
            const newArgId = crypto.randomUUID()
            const result = core.forkArgument(arg.id, newArgId)

            const forkedVars = result.engine.getVariables()
            // createPremise auto-creates a premise-bound variable, so we have 2
            const claimBoundVars = forkedVars.filter(isClaimBound)
            expect(claimBoundVars).toHaveLength(1)
            const forkedVar = claimBoundVars[0]
            expect(forkedVar.claimId).not.toBe(claim.id)
            expect(result.claimRemap.get(claim.id)).toBe(forkedVar.claimId)
        })

        it("should throw when canFork returns false", () => {
            const core = new PropositCore()
            const arg = { id: crypto.randomUUID(), version: 0 }
            core.arguments.create(arg)

            // Replace with a no-fork engine
            const engine = core.arguments.remove(arg.id)
            class NoForkEngine extends ArgumentEngine {
                public override canFork(): boolean {
                    return false
                }
            }
            const noFork = new NoForkEngine(engine.getArgument(), core.claims)
            core.arguments.register(noFork)

            expect(() =>
                core.forkArgument(arg.id, crypto.randomUUID())
            ).toThrow(/not allowed/)
        })

        it("should throw when argument not found", () => {
            const core = new PropositCore()
            expect(() =>
                core.forkArgument("nonexistent", crypto.randomUUID())
            ).toThrow(/not found/)
        })

        it("should create cloned claim citations", () => {
            const { core, arg } = setupForFork()
            const citsBefore = core.citations.getAll().length
            core.forkArgument(arg.id, crypto.randomUUID())
            expect(core.citations.getAll().length).toBe(citsBefore + 1)
        })

        it("should dedup claims when multiple variables reference the same claim", () => {
            const core = new PropositCore()
            const claim = core.claims.create({
                id: crypto.randomUUID(),
                type: "normal",
            })

            const arg = { id: crypto.randomUUID(), version: 0 }
            const engine = core.arguments.create(arg)
            engine.createPremise()
            engine.addVariable({
                id: crypto.randomUUID(),
                symbol: "P",
                argumentId: arg.id,
                argumentVersion: 0,
                claimId: claim.id,
                claimVersion: claim.version,
            })
            engine.addVariable({
                id: crypto.randomUUID(),
                symbol: "Q",
                argumentId: arg.id,
                argumentVersion: 0,
                claimId: claim.id,
                claimVersion: claim.version,
            })

            const result = core.forkArgument(arg.id, crypto.randomUUID())
            expect(result.claimRemap.size).toBe(1)
            const forkedVars = result.engine.getVariables()
            const claimBoundVars = forkedVars.filter(isClaimBound)
            const claimIds = new Set(claimBoundVars.map((v) => v.claimId))
            expect(claimIds.size).toBe(1)
        })

        it("should merge extras into fork records", () => {
            const { core, arg } = setupForFork()
            const result = core.forkArgument(arg.id, crypto.randomUUID(), {
                argumentForkExtras: {
                    customTag: "test",
                } as Record<string, unknown>,
            })
            expect(
                (result.argumentFork as Record<string, unknown>).customTag
            ).toBe("test")
        })

        it("should be overridable by subclasses", () => {
            let hookCalled = false
            class CustomCore extends PropositCore {
                public override forkArgument(
                    ...args: Parameters<PropositCore["forkArgument"]>
                ) {
                    hookCalled = true
                    return super.forkArgument(...args)
                }
            }
            const core = new CustomCore()
            const claim = core.claims.create({
                id: crypto.randomUUID(),
                type: "normal",
            })
            const arg = { id: crypto.randomUUID(), version: 0 }
            const engine = core.arguments.create(arg)
            engine.createPremise()
            engine.addVariable({
                id: crypto.randomUUID(),
                symbol: "P",
                argumentId: arg.id,
                argumentVersion: 0,
                claimId: claim.id,
                claimVersion: claim.version,
            })

            core.forkArgument(arg.id, crypto.randomUUID())
            expect(hookCalled).toBe(true)
        })

        it("should record forkedFromEntityVersion on claim fork records", () => {
            const { core, arg, claim } = setupForFork()
            const currentClaimVersion = core.claims.getCurrent(
                claim.id
            )!.version
            core.forkArgument(arg.id, crypto.randomUUID())

            const claimForks = core.forks.claims.getAll()
            const matching = claimForks.find(
                (cf) => cf.forkedFromEntityId === claim.id
            )
            expect(matching).toBeDefined()
            expect(matching!.forkedFromEntityVersion).toBe(currentClaimVersion)
        })

        it("should propagate a custom forkId to all five fork record namespaces", () => {
            const { core, arg } = setupForFork()
            const customForkId = "custom-fork-id"
            core.forkArgument(arg.id, crypto.randomUUID(), {
                forkId: customForkId,
            })

            expect(
                core.forks.arguments
                    .getAll()
                    .every((r) => r.forkId === customForkId)
            ).toBe(true)
            expect(
                core.forks.premises
                    .getAll()
                    .every((r) => r.forkId === customForkId)
            ).toBe(true)
            expect(
                core.forks.expressions
                    .getAll()
                    .every((r) => r.forkId === customForkId)
            ).toBe(true)
            expect(
                core.forks.variables
                    .getAll()
                    .every((r) => r.forkId === customForkId)
            ).toBe(true)
            expect(
                core.forks.claims
                    .getAll()
                    .every((r) => r.forkId === customForkId)
            ).toBe(true)
        })
    })

    describe("diffArguments", () => {
        it("should diff two arguments", () => {
            const core = new PropositCore()
            const arg1 = { id: crypto.randomUUID(), version: 0 }
            const arg2 = { id: crypto.randomUUID(), version: 0 }
            core.arguments.create(arg1)
            core.arguments.create(arg2)

            const diff = core.diffArguments(arg1.id, arg2.id)
            expect(diff).toBeDefined()
            expect(diff.argument).toBeDefined()
        })

        it("should automatically pair forked entities via fork records", () => {
            const core = new PropositCore()
            const claim = core.claims.create({
                id: crypto.randomUUID(),
                type: "normal",
            })
            const arg = { id: crypto.randomUUID(), version: 0 }
            const engine = core.arguments.create(arg)
            engine.createPremise()
            engine.addVariable({
                id: crypto.randomUUID(),
                symbol: "P",
                argumentId: arg.id,
                argumentVersion: 0,
                claimId: claim.id,
                claimVersion: claim.version,
            })

            const newArgId = crypto.randomUUID()
            core.forkArgument(arg.id, newArgId)

            const diff = core.diffArguments(arg.id, newArgId)
            // Forked premises should be paired (not added/removed)
            expect(diff.premises.added).toHaveLength(0)
            expect(diff.premises.removed).toHaveLength(0)
        })

        it("should allow caller-provided matchers to override", () => {
            const core = new PropositCore()
            const arg1 = { id: crypto.randomUUID(), version: 0 }
            const arg2 = { id: crypto.randomUUID(), version: 0 }
            core.arguments.create(arg1)
            core.arguments.create(arg2)

            const neverMatch = () => false
            const diff = core.diffArguments(arg1.id, arg2.id, {
                premiseMatcher: neverMatch,
            })
            expect(diff).toBeDefined()
        })

        it("should throw when argument not found", () => {
            const core = new PropositCore()
            expect(() => core.diffArguments("a", "b")).toThrow(/not found/)
        })
    })

    // ---------------------------------------------------------------------------
    // generateId injection — ExpressionManager
    // ---------------------------------------------------------------------------


    // ---------------------------------------------------------------------------
    // generateId injection — PremiseEngine
    // ---------------------------------------------------------------------------

    describe("generateId injection — PremiseEngine", () => {
        it("uses injected generateId for toggleNegation wrapper IDs", () => {
            let counter = 0
            const generateId = () => `pe-id-${++counter}`

            const vm = new VariableManager()
            vm.addVariable(VAR_P as TCorePropositionalVariable)

            const pe = new PremiseEngine(
                {
                    id: "premise-1",
                    argumentId: ARG.id,
                    argumentVersion: ARG.version,
                    type: "freeform" as const,
                } as TCorePremise,
                { argument: ARG, variables: vm },
                { generateId }
            )

            // Add a single variable expression
            pe.addExpression(
                makeVarExpr("v-p", "var-p", { parentId: null, position: 0 })
            )

            // Toggle negation wraps it with a NOT — the NOT's ID should use generateId
            pe.toggleNegation("v-p")

            const allExprs = pe.getExpressions()
            const notExpr = allExprs.find(
                (e) => e.type === "operator" && e.operator === "not"
            )
            expect(notExpr).toBeDefined()
            expect(notExpr!.id).toMatch(/^pe-id-/)
        })

    })

    // ---------------------------------------------------------------------------
    // generateId injection — ArgumentEngine
    // ---------------------------------------------------------------------------

    describe("generateId injection — ArgumentEngine", () => {
        it("uses injected generateId for createPremise and auto-variable IDs", () => {
            let counter = 0
            const generateId = () => `ae-id-${++counter}`

            const engine = new ArgumentEngine(ARG, aLib(), {
                generateId,
            })

            const { result: pm } = engine.createPremise()

            // Premise ID should come from generateId
            expect(pm.getId()).toBe("ae-id-1")

            // Auto-created premise-bound variable should also use generateId
            const vars = engine.getVariables()
            expect(vars.length).toBe(1)
            expect(vars[0].id).toBe("ae-id-2")
        })


        it("falls back to default generateId when none provided", () => {
            const engine = new ArgumentEngine(ARG, aLib())
            const { result: pm } = engine.createPremise()

            // Default generates valid UUIDs
            expect(pm.getId()).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
            )
        })
    })
})

// ---------------------------------------------------------------------------
// generateId injection — ArgumentLibrary
// ---------------------------------------------------------------------------

describe("generateId injection — ArgumentLibrary", () => {
    it("threads generateId to engines created via create()", () => {
        let counter = 0
        const generateId = () => `al-id-${++counter}`

        const lib = new ArgumentLibrary(
            {
                claimLibrary: aLib(),
            },
            { generateId }
        )

        const engine = lib.create({ id: "arg-1", version: 0 })
        const { result: pm } = engine.createPremise()

        expect(pm.getId()).toBe("al-id-1")
    })

    it("threads generateId through fromSnapshot restoration", () => {
        let counter = 0
        const generateId = () => `al-id-${++counter}`

        // Create library with one engine + one premise
        const lib = new ArgumentLibrary(
            {
                claimLibrary: aLib(),
            },
            { generateId }
        )
        const engine = lib.create({ id: "arg-1", version: 0 })
        engine.createPremise()

        // Snapshot, then restore with a NEW generateId
        const snap = lib.snapshot()
        let restoreCounter = 0
        const restoreGenerateId = () => `restored-id-${++restoreCounter}`

        const restoredLib = ArgumentLibrary.fromSnapshot(
            snap,
            {
                claimLibrary: aLib(),
            },
            { generateId: restoreGenerateId }
        )

        // New mutations on the restored engine should use the new generateId
        const restoredEngine = restoredLib.get("arg-1")!
        const { result: newPm } = restoredEngine.createPremise()
        expect(newPm.getId()).toBe("restored-id-1")
    })

    it("threads generateId to restored PremiseEngines for post-restoration mutations", () => {
        let counter = 0
        const generateId = () => `orig-id-${++counter}`

        const claimLib = aLib()
        const lib = new ArgumentLibrary(
            {
                claimLibrary: claimLib,
            },
            { generateId }
        )
        const engine = lib.create({ id: "arg-1", version: 0 })
        engine.addVariable({
            id: "var-p",
            argumentId: "arg-1",
            argumentVersion: 0,
            symbol: "P",
            claimId: "claim-default",
            claimVersion: 0,
        })
        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        // Add a variable expression so toggleNegation has something to wrap
        pm.addExpression({
            id: "v-p",
            argumentId: "arg-1",
            argumentVersion: 0,
            premiseId,
            type: "variable",
            variableId: "var-p",
            parentId: null,
            position: 0,
        })

        // Snapshot, restore with a new generateId
        const snap = lib.snapshot()
        let restoreCounter = 0
        const restoreGenerateId = () => `snap-id-${++restoreCounter}`

        const restoredLib = ArgumentLibrary.fromSnapshot(
            snap,
            {
                claimLibrary: claimLib,
            },
            { generateId: restoreGenerateId }
        )

        // toggleNegation on a restored PremiseEngine should use the new generateId
        const restoredEngine = restoredLib.get("arg-1")!
        const restoredPm = restoredEngine.getPremise(premiseId)!
        restoredPm.toggleNegation("v-p")

        const allExprs = restoredPm.getExpressions()
        const notExpr = allExprs.find(
            (e) => e.type === "operator" && e.operator === "not"
        )
        expect(notExpr).toBeDefined()
        expect(notExpr!.id).toMatch(/^snap-id-/)
    })
})

// ---------------------------------------------------------------------------
// generateId injection — PropositCore
// ---------------------------------------------------------------------------

describe("generateId injection — PropositCore", () => {
    it("threads generateId to ArgumentLibrary for engine creation", () => {
        let counter = 0
        const generateId = () => `pc-id-${++counter}`

        const core = new PropositCore({ generateId })
        const engine = core.arguments.create({ id: "arg-1", version: 0 })
        const { result: pm } = engine.createPremise()

        expect(pm.getId()).toBe("pc-id-1")
    })

    it("uses generateId in forkArgument for library-level entities", () => {
        let counter = 0
        const generateId = () => `pc-id-${++counter}`

        const core = new PropositCore({ generateId })
        const engine = core.arguments.create({
            id: "pc-id-1",
            version: 0,
        })

        // Add a claim-bound variable and a premise
        const claim = core.claims.create({ id: "pc-id-2", type: "normal" })
        engine.addVariable({
            id: "pc-id-3",
            argumentId: "pc-id-1",
            argumentVersion: 0,
            symbol: "P",
            claimId: claim.id,
            claimVersion: claim.version,
        })
        engine.createPremise()

        // Fork — should use generateId for new claim, source, and fork IDs
        const result = core.forkArgument("pc-id-1")

        // All generated IDs should match our pattern
        expect(result.engine.getArgument().id).toMatch(/^pc-id-/)
        expect(result.claimRemap.size).toBeGreaterThanOrEqual(1)
        for (const newClaimId of result.claimRemap.values()) {
            expect(newClaimId).toMatch(/^pc-id-/)
        }
    })

    it("falls back to default generateId", () => {
        const core = new PropositCore()
        const engine = core.arguments.create({
            id: crypto.randomUUID(),
            version: 0,
        })
        const { result: pm } = engine.createPremise()

        expect(pm.getId()).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        )
    })
})

// ---------------------------------------------------------------------------
// generateId injection — ArgumentParser
// ---------------------------------------------------------------------------

describe("generateId injection — ArgumentParser", () => {
    it("uses injected generateId for all entity IDs", () => {
        let counter = 0
        const generateId = () => `parser-id-${++counter}`

        const parser = new ArgumentParser()

        const response: TParsedArgumentResponse = {
            argument: {
                claims: [
                    {
                        miniId: "C1",
                        role: "premise",
                        type: "normal",
                    },
                ],
                variables: [
                    {
                        miniId: "V1",
                        symbol: "P",
                        claimMiniId: "C1",
                    },
                ],
                premises: [
                    {
                        miniId: "P1",
                        formula: "P",
                    },
                ],
                conclusionPremiseMiniId: "P1",
            },
            uncategorizedText: null,
            selectionRationale: null,
            failureText: null,
        }

        const result = parser.build(response, { generateId })

        // Argument ID
        expect(result.engine.getArgument().id).toMatch(/^parser-id-/)

        // Variable IDs (claim-bound)
        const vars = result.engine.getVariables()
        expect(vars.length).toBeGreaterThanOrEqual(1)
        const claimBoundVars = vars.filter((v) => "claimId" in v)
        expect(claimBoundVars.length).toBe(1)
        expect(claimBoundVars[0].id).toMatch(/^parser-id-/)

        // Claim IDs
        const claims = result.claimLibrary.getAll()
        expect(claims.length).toBe(1)
        expect(claims[0].id).toMatch(/^parser-id-/)

        // Expression IDs
        const premises = result.engine.listPremises()
        expect(premises.length).toBe(1)
        const exprs = premises[0].getExpressions()
        for (const expr of exprs) {
            expect(expr.id).toMatch(/^parser-id-/)
        }
    })
})

describe("DEFAULT_CHECKSUM_CONFIG excludes entity id", () => {
    it("expression checksum does not change when id differs", () => {
        const eng1 = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        eng1.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        })
        const { result: pm1 } = eng1.createPremiseWithId("prem-shared")
        pm1.addExpression({
            id: "expr-AAA",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "prem-shared",
            parentId: null,
            position: 1,
        })

        const eng2 = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        eng2.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        })
        const { result: pm2 } = eng2.createPremiseWithId("prem-shared")
        pm2.addExpression({
            id: "expr-BBB",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "prem-shared",
            parentId: null,
            position: 1,
        })

        eng1.flushChecksums()
        eng2.flushChecksums()

        const e1 = pm1.getExpression("expr-AAA")!
        const e2 = pm2.getExpression("expr-BBB")!
        expect(e1.checksum).toBe(e2.checksum)
    })

    it("variable checksum does not change when id differs", () => {
        const eng1 = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        eng1.addVariable({
            id: "var-AAA",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        })

        const eng2 = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        eng2.addVariable({
            id: "var-BBB",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        })

        eng1.flushChecksums()
        eng2.flushChecksums()

        const v1 = eng1.getVariable("var-AAA")!
        const v2 = eng2.getVariable("var-BBB")!
        expect(v1.checksum).toBe(v2.checksum)
    })

    it("premise checksum does not change when id differs", () => {
        const eng1 = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        const { result: pm1 } = eng1.createPremiseWithId("prem-AAA")

        const eng2 = new ArgumentEngine({ id: "arg1", version: 0 }, aLib())
        const { result: pm2 } = eng2.createPremiseWithId("prem-BBB")

        eng1.flushChecksums()
        eng2.flushChecksums()

        expect(pm1.checksum()).toBe(pm2.checksum())
    })

    it("argument checksum does not change when id differs", () => {
        const eng1 = new ArgumentEngine({ id: "arg-AAA", version: 0 }, aLib())
        const eng2 = new ArgumentEngine({ id: "arg-BBB", version: 0 }, aLib())

        eng1.flushChecksums()
        eng2.flushChecksums()

        expect(eng1.checksum()).toBe(eng2.checksum())
    })

    it("DEFAULT_CHECKSUM_CONFIG field sets do not contain 'id'", () => {
        expect(DEFAULT_CHECKSUM_CONFIG.expressionFields!.has("id")).toBe(false)
        expect(DEFAULT_CHECKSUM_CONFIG.variableFields!.has("id")).toBe(false)
        expect(DEFAULT_CHECKSUM_CONFIG.premiseFields!.has("id")).toBe(false)
        expect(DEFAULT_CHECKSUM_CONFIG.argumentFields!.has("id")).toBe(false)
        expect(DEFAULT_CHECKSUM_CONFIG.claimFields!.has("id")).toBe(false)
        expect(DEFAULT_CHECKSUM_CONFIG.claimCitationFields!.has("id")).toBe(
            false
        )
    })
})

// ---------------------------------------------------------------------------
// Operator constraint propagation
// ---------------------------------------------------------------------------

describe("operator constraint propagation", () => {
    it("implies accepted, antecedent true -> consequent derived true", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const vA = makeVar("vA", "A")
        const vB = makeVar("vB", "B")
        eng.addVariable(vA)
        eng.addVariable(vB)

        // Single premise: A -> B (conclusion)
        const { result: pm } = eng.createPremiseWithId("p1")
        pm.addExpression(makeOpExpr("impl", "implies", { premiseId: "p1" }))
        pm.addExpression(
            makeVarExpr("e-a", "vA", {
                parentId: "impl",
                position: 0,
                premiseId: "p1",
            })
        )
        pm.addExpression(
            makeVarExpr("e-b", "vB", {
                parentId: "impl",
                position: 1,
                premiseId: "p1",
            })
        )
        eng.setConclusionPremise("p1")

        const result = eng.evaluate({
            variables: { vA: true, vB: null },
            operatorAssignments: { impl: "accepted" },
        })
        expect(result.ok).toBe(true)
        // Propagation: implies accepted + A=true => B must be true
        expect(result.assignment!.variables.vB).toBe(true)
        expect(result.conclusionTrue).toBe(true)
    })

    it("implies accepted, consequent false -> antecedent derived false", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const vA = makeVar("vA", "A")
        const vB = makeVar("vB", "B")
        eng.addVariable(vA)
        eng.addVariable(vB)

        const { result: pm } = eng.createPremiseWithId("p1")
        pm.addExpression(makeOpExpr("impl", "implies", { premiseId: "p1" }))
        pm.addExpression(
            makeVarExpr("e-a", "vA", {
                parentId: "impl",
                position: 0,
                premiseId: "p1",
            })
        )
        pm.addExpression(
            makeVarExpr("e-b", "vB", {
                parentId: "impl",
                position: 1,
                premiseId: "p1",
            })
        )
        eng.setConclusionPremise("p1")

        const result = eng.evaluate({
            variables: { vA: null, vB: false },
            operatorAssignments: { impl: "accepted" },
        })
        expect(result.ok).toBe(true)
        // Propagation: implies accepted + B=false => A must be false (modus tollens)
        expect(result.assignment!.variables.vA).toBe(false)
    })

    it("and accepted -> both children derived true", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const vA = makeVar("vA", "A")
        const vB = makeVar("vB", "B")
        eng.addVariable(vA)
        eng.addVariable(vB)

        const { result: pm } = eng.createPremiseWithId("p1")
        pm.addExpression(makeOpExpr("conj", "and", { premiseId: "p1" }))
        pm.addExpression(
            makeVarExpr("e-a", "vA", {
                parentId: "conj",
                position: 0,
                premiseId: "p1",
            })
        )
        pm.addExpression(
            makeVarExpr("e-b", "vB", {
                parentId: "conj",
                position: 1,
                premiseId: "p1",
            })
        )
        eng.setConclusionPremise("p1")

        const result = eng.evaluate({
            variables: { vA: null, vB: null },
            operatorAssignments: { conj: "accepted" },
        })
        expect(result.ok).toBe(true)
        // Propagation: and accepted => both children must be true
        expect(result.assignment!.variables.vA).toBe(true)
        expect(result.assignment!.variables.vB).toBe(true)
    })

    it("or accepted, one child false -> other derived true", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const vA = makeVar("vA", "A")
        const vB = makeVar("vB", "B")
        eng.addVariable(vA)
        eng.addVariable(vB)

        const { result: pm } = eng.createPremiseWithId("p1")
        pm.addExpression(makeOpExpr("disj", "or", { premiseId: "p1" }))
        pm.addExpression(
            makeVarExpr("e-a", "vA", {
                parentId: "disj",
                position: 0,
                premiseId: "p1",
            })
        )
        pm.addExpression(
            makeVarExpr("e-b", "vB", {
                parentId: "disj",
                position: 1,
                premiseId: "p1",
            })
        )
        eng.setConclusionPremise("p1")

        const result = eng.evaluate({
            variables: { vA: false, vB: null },
            operatorAssignments: { disj: "accepted" },
        })
        expect(result.ok).toBe(true)
        // Propagation: or accepted + A=false => B must be true
        expect(result.assignment!.variables.vB).toBe(true)
    })

    it("not accepted -> child derived false", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const vA = makeVar("vA", "A")
        eng.addVariable(vA)

        const { result: pm } = eng.createPremiseWithId("p1")
        pm.addExpression(makeOpExpr("neg", "not", { premiseId: "p1" }))
        pm.addExpression(
            makeVarExpr("e-a", "vA", {
                parentId: "neg",
                position: 0,
                premiseId: "p1",
            })
        )
        eng.setConclusionPremise("p1")

        const result = eng.evaluate({
            variables: { vA: null },
            operatorAssignments: { neg: "accepted" },
        })
        expect(result.ok).toBe(true)
        // Propagation: not accepted (= true) => child must be false
        expect(result.assignment!.variables.vA).toBe(false)
    })

    it("iff accepted -> bidirectional propagation", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const vA = makeVar("vA", "A")
        const vB = makeVar("vB", "B")
        eng.addVariable(vA)
        eng.addVariable(vB)

        const { result: pm } = eng.createPremiseWithId("p1")
        pm.addExpression(makeOpExpr("bic", "iff", { premiseId: "p1" }))
        pm.addExpression(
            makeVarExpr("e-a", "vA", {
                parentId: "bic",
                position: 0,
                premiseId: "p1",
            })
        )
        pm.addExpression(
            makeVarExpr("e-b", "vB", {
                parentId: "bic",
                position: 1,
                premiseId: "p1",
            })
        )
        eng.setConclusionPremise("p1")

        const result = eng.evaluate({
            variables: { vA: true, vB: null },
            operatorAssignments: { bic: "accepted" },
        })
        expect(result.ok).toBe(true)
        // Propagation: iff accepted + A=true => B must be true
        expect(result.assignment!.variables.vB).toBe(true)
    })

    it("cross-premise fixed-point propagation", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const vA = makeVar("vA", "A")
        const vB = makeVar("vB", "B")
        const vC = makeVar("vC", "C")
        eng.addVariable(vA)
        eng.addVariable(vB)
        eng.addVariable(vC)

        // Premise 1 (supporting): A -> B
        const { result: pm1 } = eng.createPremiseWithId("p1")
        pm1.addExpression(makeOpExpr("impl1", "implies", { premiseId: "p1" }))
        pm1.addExpression(
            makeVarExpr("e1-a", "vA", {
                parentId: "impl1",
                position: 0,
                premiseId: "p1",
            })
        )
        pm1.addExpression(
            makeVarExpr("e1-b", "vB", {
                parentId: "impl1",
                position: 1,
                premiseId: "p1",
            })
        )

        // Premise 2 (conclusion): B -> C
        const { result: pm2 } = eng.createPremiseWithId("p2")
        pm2.addExpression(makeOpExpr("impl2", "implies", { premiseId: "p2" }))
        pm2.addExpression(
            makeVarExpr("e2-b", "vB", {
                parentId: "impl2",
                position: 0,
                premiseId: "p2",
            })
        )
        pm2.addExpression(
            makeVarExpr("e2-c", "vC", {
                parentId: "impl2",
                position: 1,
                premiseId: "p2",
            })
        )

        eng.setConclusionPremise("p2")

        const result = eng.evaluate({
            variables: { vA: true, vB: null, vC: null },
            operatorAssignments: { impl1: "accepted", impl2: "accepted" },
        })
        expect(result.ok).toBe(true)
        // Propagation across premises:
        //   impl1 accepted + A=true => B=true
        //   impl2 accepted + B=true => C=true
        expect(result.assignment!.variables.vB).toBe(true)
        expect(result.assignment!.variables.vC).toBe(true)
        expect(result.conclusionTrue).toBe(true)
    })

    it("user assignment wins over propagation", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const vA = makeVar("vA", "A")
        const vB = makeVar("vB", "B")
        eng.addVariable(vA)
        eng.addVariable(vB)

        const { result: pm } = eng.createPremiseWithId("p1")
        pm.addExpression(makeOpExpr("conj", "and", { premiseId: "p1" }))
        pm.addExpression(
            makeVarExpr("e-a", "vA", {
                parentId: "conj",
                position: 0,
                premiseId: "p1",
            })
        )
        pm.addExpression(
            makeVarExpr("e-b", "vB", {
                parentId: "conj",
                position: 1,
                premiseId: "p1",
            })
        )
        eng.setConclusionPremise("p1")

        // User explicitly sets A=false; and is accepted, so B propagated to true
        const result = eng.evaluate({
            variables: { vA: false, vB: null },
            operatorAssignments: { conj: "accepted" },
        })
        expect(result.ok).toBe(true)
        // User's explicit A=false must not be overridden
        expect(result.assignment!.variables.vA).toBe(false)
        // B is propagated to true from and-accepted
        expect(result.assignment!.variables.vB).toBe(true)
        // But the conjunction is false (false AND true = false)
        expect(result.conclusionTrue).toBe(false)
    })

    it("no propagation for unset operators", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const vA = makeVar("vA", "A")
        const vB = makeVar("vB", "B")
        eng.addVariable(vA)
        eng.addVariable(vB)

        const { result: pm } = eng.createPremiseWithId("p1")
        pm.addExpression(makeOpExpr("impl", "implies", { premiseId: "p1" }))
        pm.addExpression(
            makeVarExpr("e-a", "vA", {
                parentId: "impl",
                position: 0,
                premiseId: "p1",
            })
        )
        pm.addExpression(
            makeVarExpr("e-b", "vB", {
                parentId: "impl",
                position: 1,
                premiseId: "p1",
            })
        )
        eng.setConclusionPremise("p1")

        // No operator assignment — no propagation should occur
        const result = eng.evaluate({
            variables: { vA: true, vB: null },
            operatorAssignments: {},
        })
        expect(result.ok).toBe(true)
        // B should remain null — no propagation without operator assignment
        expect(result.assignment!.variables.vB).toBeNull()
        expect(result.conclusionTrue).toBeNull()
    })

    it("or accepted, both unknown -> no propagation", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const vA = makeVar("vA", "A")
        const vB = makeVar("vB", "B")
        eng.addVariable(vA)
        eng.addVariable(vB)

        const { result: pm } = eng.createPremiseWithId("p1")
        pm.addExpression(makeOpExpr("disj", "or", { premiseId: "p1" }))
        pm.addExpression(
            makeVarExpr("e-a", "vA", {
                parentId: "disj",
                position: 0,
                premiseId: "p1",
            })
        )
        pm.addExpression(
            makeVarExpr("e-b", "vB", {
                parentId: "disj",
                position: 1,
                premiseId: "p1",
            })
        )
        eng.setConclusionPremise("p1")

        // Or accepted but both children unknown — insufficient info to derive either
        const result = eng.evaluate({
            variables: { vA: null, vB: null },
            operatorAssignments: { disj: "accepted" },
        })
        expect(result.ok).toBe(true)
        // Cannot determine which disjunct is true — both remain null
        expect(result.assignment!.variables.vA).toBeNull()
        expect(result.assignment!.variables.vB).toBeNull()
    })
})

describe("evaluateArgument (standalone)", () => {
    it("is exported from the library", async () => {
        const mod = await import("../src/lib/index.js")
        expect(typeof mod.evaluateArgument).toBe("function")
        expect(typeof mod.checkArgumentValidity).toBe("function")
        expect(typeof mod.propagateOperatorConstraints).toBe("function")
    })

    /** Build an engine with P, Q variables and a P->Q supporting premise plus a Q conclusion. */
    function buildModusPonensEngine() {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: support } = eng.createPremise({ title: "P->Q" })
        const { result: pPremise } = eng.createPremise({ title: "P" })
        const { result: conclusion } = eng.createPremise({ title: "Q" })

        // Build P->Q
        const implId = `${support.getId()}-impl`
        support.addExpression(makeOpExpr(implId, "implies"))
        support.addExpression(
            makeVarExpr(`${implId}-p`, VAR_P.id, {
                parentId: implId,
                position: 0,
            })
        )
        support.addExpression(
            makeVarExpr(`${implId}-q`, VAR_Q.id, {
                parentId: implId,
                position: 1,
            })
        )

        // Build P (constraint)
        pPremise.addExpression(makeVarExpr(`${pPremise.getId()}-p`, VAR_P.id))

        // Build Q (conclusion)
        conclusion.addExpression(
            makeVarExpr(`${conclusion.getId()}-q`, VAR_Q.id)
        )

        eng.setConclusionPremise(conclusion.getId())
        return eng
    }

    function ctxFrom(eng: ArgumentEngine): TArgumentEvaluationContext {
        return {
            argumentId: eng.getArgument().id,
            conclusionPremiseId: eng.getRoleState().conclusionPremiseId,
            getConclusionPremise: () =>
                eng.getConclusionPremise() as TEvaluablePremise | undefined,
            listSupportingPremises: () =>
                eng.listSupportingPremises() as TEvaluablePremise[],
            listPremises: () => eng.listPremises() as TEvaluablePremise[],
            getVariable: (id) => eng.getVariable(id),
            getPremise: (id) =>
                eng.getPremise(id) as TEvaluablePremise | undefined,
            validateEvaluability: () => eng.validateEvaluability(),
        }
    }

    describe("propagateOperatorConstraints", () => {
        it("propagates accepted AND: all children become true", () => {
            const eng = new ArgumentEngine(ARG, aLib())
            eng.addVariable(VAR_P)
            eng.addVariable(VAR_Q)
            const { result: pm } = eng.createPremise({ title: "P and Q" })
            const andId = `${pm.getId()}-and`
            pm.addExpression(makeOpExpr(andId, "and"))
            pm.addExpression(
                makeVarExpr(`${andId}-p`, VAR_P.id, {
                    parentId: andId,
                    position: 0,
                })
            )
            pm.addExpression(
                makeVarExpr(`${andId}-q`, VAR_Q.id, {
                    parentId: andId,
                    position: 1,
                })
            )
            const ctx = ctxFrom(eng)
            const result = propagateOperatorConstraints(ctx, {
                variables: {},
                operatorAssignments: { [andId]: "accepted" },
            })
            expect(result[VAR_P.id]).toBe(true)
            expect(result[VAR_Q.id]).toBe(true)
        })

        it("propagates rejected OR: all children become false", () => {
            const eng = new ArgumentEngine(ARG, aLib())
            eng.addVariable(VAR_P)
            eng.addVariable(VAR_Q)
            const { result: pm } = eng.createPremise({ title: "P or Q" })
            const orId = `${pm.getId()}-or`
            pm.addExpression(makeOpExpr(orId, "or"))
            pm.addExpression(
                makeVarExpr(`${orId}-p`, VAR_P.id, {
                    parentId: orId,
                    position: 0,
                })
            )
            pm.addExpression(
                makeVarExpr(`${orId}-q`, VAR_Q.id, {
                    parentId: orId,
                    position: 1,
                })
            )
            const ctx = ctxFrom(eng)
            const result = propagateOperatorConstraints(ctx, {
                variables: {},
                operatorAssignments: { [orId]: "rejected" },
            })
            expect(result[VAR_P.id]).toBe(false)
            expect(result[VAR_Q.id]).toBe(false)
        })

        it("never overwrites user-assigned values", () => {
            const eng = new ArgumentEngine(ARG, aLib())
            eng.addVariable(VAR_P)
            eng.addVariable(VAR_Q)
            const { result: pm } = eng.createPremise({ title: "P and Q" })
            const andId = `${pm.getId()}-and`
            pm.addExpression(makeOpExpr(andId, "and"))
            pm.addExpression(
                makeVarExpr(`${andId}-p`, VAR_P.id, {
                    parentId: andId,
                    position: 0,
                })
            )
            pm.addExpression(
                makeVarExpr(`${andId}-q`, VAR_Q.id, {
                    parentId: andId,
                    position: 1,
                })
            )
            const ctx = ctxFrom(eng)
            // User says P=false, accepted AND would want P=true but must not override
            const result = propagateOperatorConstraints(ctx, {
                variables: { [VAR_P.id]: false },
                operatorAssignments: { [andId]: "accepted" },
            })
            expect(result[VAR_P.id]).toBe(false)
            expect(result[VAR_Q.id]).toBe(true)
        })

        it("returns unchanged variables when no operator assignments given", () => {
            const eng = new ArgumentEngine(ARG, aLib())
            eng.addVariable(VAR_P)
            const { result: pm } = eng.createPremise({ title: "P" })
            pm.addExpression(makeVarExpr(`${pm.getId()}-p`, VAR_P.id))
            const ctx = ctxFrom(eng)
            const result = propagateOperatorConstraints(ctx, {
                variables: { [VAR_P.id]: true },
                operatorAssignments: {},
            })
            expect(result[VAR_P.id]).toBe(true)
        })
    })

    describe("evaluateArgument", () => {
        it("evaluates modus ponens with P=true, Q=true as non-counterexample", () => {
            const eng = buildModusPonensEngine()
            const ctx = ctxFrom(eng)
            const result = evaluateArgument(ctx, {
                variables: { [VAR_P.id]: true, [VAR_Q.id]: true },
                operatorAssignments: {},
            })
            expect(result.ok).toBe(true)
            expect(result.isCounterexample).toBe(false)
            expect(result.preservesTruthUnderAssignment).toBe(true)
        })

        it("returns validation failure when no conclusion is set", () => {
            // Build context manually with no conclusion premise
            const ctx: TArgumentEvaluationContext = {
                argumentId: "arg-1",
                conclusionPremiseId: undefined,
                getConclusionPremise: () => undefined,
                listSupportingPremises: () => [],
                listPremises: () => [],
                getVariable: () => undefined,
                getPremise: () => undefined,
                validateEvaluability: () => ({ ok: true, issues: [] }),
            }
            const result = evaluateArgument(ctx, {
                variables: {},
                operatorAssignments: {},
            })
            expect(result.ok).toBe(false)
            expect(result.validation!.issues[0].code).toBe(
                "ARGUMENT_NO_CONCLUSION"
            )
        })

        it("matches engine.evaluate() output exactly", () => {
            const eng = buildModusPonensEngine()
            const assignment = {
                variables: { [VAR_P.id]: true, [VAR_Q.id]: false },
                operatorAssignments: {},
            }
            const engineResult = eng.evaluate(assignment)
            const ctx = ctxFrom(eng)
            const standaloneResult = evaluateArgument(ctx, assignment)
            expect(standaloneResult.ok).toBe(engineResult.ok)
            expect(standaloneResult.isCounterexample).toBe(
                engineResult.isCounterexample
            )
            expect(standaloneResult.conclusionTrue).toBe(
                engineResult.conclusionTrue
            )
            expect(standaloneResult.allSupportingPremisesTrue).toBe(
                engineResult.allSupportingPremisesTrue
            )
            expect(standaloneResult.preservesTruthUnderAssignment).toBe(
                engineResult.preservesTruthUnderAssignment
            )
        })

        it("runs validateEvaluability when validateFirst is true (default)", () => {
            const eng = new ArgumentEngine(ARG, aLib())
            // Empty engine with no premises — validateEvaluability will fail
            const ctx = ctxFrom(eng)
            const result = evaluateArgument(ctx, {
                variables: {},
                operatorAssignments: {},
            })
            expect(result.ok).toBe(false)
        })
    })

    describe("checkArgumentValidity", () => {
        it("proves modus ponens valid", () => {
            const eng = buildModusPonensEngine()
            const ctx = ctxFrom(eng)
            const result = checkArgumentValidity(ctx, {
                mode: "exhaustive",
            })
            expect(result.ok).toBe(true)
            expect(result.isValid).toBe(true)
            expect(result.counterexamples).toEqual([])
            expect(result.numAssignmentsChecked).toBe(4) // 2^2 = 4
        })

        it("finds a counterexample for an invalid argument", () => {
            const eng = new ArgumentEngine(ARG, aLib())
            eng.addVariable(VAR_P)
            eng.addVariable(VAR_Q)
            const { result: support } = eng.createPremise({ title: "P->Q" })
            const { result: conclusion } = eng.createPremise({ title: "Q" })
            const implId = `${support.getId()}-impl`
            support.addExpression(makeOpExpr(implId, "implies"))
            support.addExpression(
                makeVarExpr(`${implId}-p`, VAR_P.id, {
                    parentId: implId,
                    position: 0,
                })
            )
            support.addExpression(
                makeVarExpr(`${implId}-q`, VAR_Q.id, {
                    parentId: implId,
                    position: 1,
                })
            )
            conclusion.addExpression(
                makeVarExpr(`${conclusion.getId()}-q`, VAR_Q.id)
            )
            eng.setConclusionPremise(conclusion.getId())
            // Missing P constraint premise — affirming the consequent is invalid
            const ctx = ctxFrom(eng)
            const result = checkArgumentValidity(ctx, {
                mode: "firstCounterexample",
            })
            expect(result.ok).toBe(true)
            expect(result.isValid).toBe(false)
            expect(result.counterexamples!.length).toBeGreaterThan(0)
        })

        it("matches engine.checkValidity() output", () => {
            const eng = buildModusPonensEngine()
            const engineResult = eng.checkValidity({ mode: "exhaustive" })
            const ctx = ctxFrom(eng)
            const standaloneResult = checkArgumentValidity(ctx, {
                mode: "exhaustive",
            })
            expect(standaloneResult.ok).toBe(engineResult.ok)
            expect(standaloneResult.isValid).toBe(engineResult.isValid)
            expect(standaloneResult.numAssignmentsChecked).toBe(
                engineResult.numAssignmentsChecked
            )
            expect(standaloneResult.numAdmissibleAssignments).toBe(
                engineResult.numAdmissibleAssignments
            )
        })

        it("respects maxVariables limit", () => {
            const eng = buildModusPonensEngine()
            const ctx = ctxFrom(eng)
            const result = checkArgumentValidity(ctx, {
                maxVariables: 1,
            })
            expect(result.ok).toBe(false)
            expect(result.validation!.issues[0].code).toBe(
                "ASSIGNMENT_UNKNOWN_VARIABLE"
            )
        })

        it("respects maxAssignmentsChecked truncation", () => {
            const eng = buildModusPonensEngine()
            const ctx = ctxFrom(eng)
            const result = checkArgumentValidity(ctx, {
                mode: "exhaustive",
                maxAssignmentsChecked: 2,
            })
            expect(result.ok).toBe(true)
            expect(result.numAssignmentsChecked).toBe(2)
            expect(result.truncated).toBe(true)
        })
    })
})

describe("validateArgument (standalone)", () => {
    it("is exported from the library", async () => {
        const mod = await import("../src/lib/index.js")
        expect(typeof mod.validateArgument).toBe("function")
        expect(typeof mod.validateArgumentAfterPremiseMutation).toBe("function")
        expect(typeof mod.validateArgumentEvaluability).toBe("function")
        expect(typeof mod.collectArgumentReferencedVariables).toBe("function")
    })

    /** Helper to build a validation context from an ArgumentEngine. */
    function validationCtxFrom(
        eng: ArgumentEngine
    ): TArgumentValidationContext {
        return {
            argumentId: eng.getArgument().id,
            argumentVersion: eng.getArgument().version,
            conclusionPremiseId: eng.getRoleState().conclusionPremiseId,
            getArgument: () => eng.getArgument(),
            getVariables: () => eng.getVariables(),
            listPremises: () =>
                eng.listPremises() as unknown as TValidatablePremise[],
            hasPremise: (premiseId) => eng.getPremise(premiseId) !== undefined,
            lookupClaim: (claimId, claimVersion) => {
                // Access the claim library used by the engine — for tests
                // we just use the engine's own validate() as the reference.
                // But for rigged tests we override this.
                void claimId
                void claimVersion
                return undefined
            },
            flushAndGetChecksumDeltas: () => {
                // Force a flush by calling getArgument(), which calls
                // flushChecksums() internally.
                eng.getArgument()
                return {
                    savedMeta: undefined,
                    savedDescendant: undefined,
                    savedCombined: undefined,
                    currentMeta: undefined,
                    currentDescendant: undefined,
                    currentCombined: undefined,
                }
            },
            validateVariables: () => ({ ok: true, violations: [] }),
            wouldCreateCycle: () => false,
        }
    }

    describe("collectArgumentReferencedVariables", () => {
        it("indexes variables by ID and symbol across premises", () => {
            const eng = new ArgumentEngine(ARG, aLib())
            eng.addVariable(VAR_P)
            eng.addVariable(VAR_Q)
            const { result: pm1 } = eng.createPremise({ title: "pm1" })
            const { result: pm2 } = eng.createPremise({ title: "pm2" })
            pm1.addExpression(
                makeVarExpr(`${pm1.getId()}-p`, VAR_P.id, {
                    premiseId: pm1.getId(),
                })
            )
            // pm2 gets an AND with P and Q as children
            const andId = `${pm2.getId()}-and`
            pm2.addExpression(
                makeOpExpr(andId, "and", { premiseId: pm2.getId() })
            )
            pm2.addExpression(
                makeVarExpr(`${pm2.getId()}-p`, VAR_P.id, {
                    premiseId: pm2.getId(),
                    parentId: andId,
                    position: 0,
                })
            )
            pm2.addExpression(
                makeVarExpr(`${pm2.getId()}-q`, VAR_Q.id, {
                    premiseId: pm2.getId(),
                    parentId: andId,
                    position: 1,
                })
            )

            const ctx = validationCtxFrom(eng)
            const result = collectArgumentReferencedVariables(ctx)

            expect(result.variableIds).toEqual([VAR_P.id, VAR_Q.id].sort())
            expect(result.byId[VAR_P.id].symbol).toBe("P")
            expect(result.byId[VAR_P.id].premiseIds).toHaveLength(2)
            expect(result.byId[VAR_Q.id].symbol).toBe("Q")
            expect(result.byId[VAR_Q.id].premiseIds).toHaveLength(1)
            expect(result.bySymbol.P.variableIds).toEqual([VAR_P.id])
            expect(result.bySymbol.Q.variableIds).toEqual([VAR_Q.id])
        })
    })

    describe("validateArgument", () => {
        it("detects ownership mismatch via a rigged context", () => {
            const ctx: TArgumentValidationContext = {
                argumentId: "arg-A",
                argumentVersion: 1,
                conclusionPremiseId: undefined,
                getArgument: () => ({
                    id: "arg-A",
                    version: 1,
                    checksum: "x",
                    descendantChecksum: null,
                    combinedChecksum: "x",
                }),
                getVariables: () => [
                    {
                        id: "var-1",
                        argumentId: "arg-WRONG",
                        argumentVersion: 99,
                        symbol: "X",
                        claimId: "c",
                        claimVersion: 0,
                    } as TCorePropositionalVariable,
                ],
                listPremises: () => [],
                hasPremise: () => false,
                lookupClaim: () => ({ id: "c" }),
                flushAndGetChecksumDeltas: () => ({
                    savedMeta: undefined,
                    savedDescendant: undefined,
                    savedCombined: undefined,
                    currentMeta: undefined,
                    currentDescendant: undefined,
                    currentCombined: undefined,
                }),
                validateVariables: () => ({ ok: true, violations: [] }),
                wouldCreateCycle: () => false,
            }

            const result = validateArgument(ctx)
            expect(result.ok).toBe(false)
            expect(
                result.violations.some((v) => v.code === ARG_OWNERSHIP_MISMATCH)
            ).toBe(true)
        })
    })

    describe("validateArgumentEvaluability", () => {
        it("reports missing conclusion via a rigged context", () => {
            const ctx: TArgumentValidationContext = {
                argumentId: "arg-A",
                argumentVersion: 1,
                conclusionPremiseId: undefined,
                getArgument: () => ({
                    id: "arg-A",
                    version: 1,
                    checksum: "x",
                    descendantChecksum: null,
                    combinedChecksum: "x",
                }),
                getVariables: () => [],
                listPremises: () => [],
                hasPremise: () => false,
                lookupClaim: () => undefined,
                flushAndGetChecksumDeltas: () => ({
                    savedMeta: undefined,
                    savedDescendant: undefined,
                    savedCombined: undefined,
                    currentMeta: undefined,
                    currentDescendant: undefined,
                    currentCombined: undefined,
                }),
                validateVariables: () => ({ ok: true, violations: [] }),
                wouldCreateCycle: () => false,
            }

            const result = validateArgumentEvaluability(ctx)
            expect(result.ok).toBe(false)
            expect(
                result.issues.some((i) => i.code === "ARGUMENT_NO_CONCLUSION")
            ).toBe(true)
        })
    })

    describe("validateArgumentAfterPremiseMutation", () => {
        it("reports missing conclusion premise via context", () => {
            const ctx: TArgumentValidationContext = {
                argumentId: "arg-A",
                argumentVersion: 1,
                conclusionPremiseId: "missing-premise",
                getArgument: () => ({
                    id: "arg-A",
                    version: 1,
                    checksum: "x",
                    descendantChecksum: null,
                    combinedChecksum: "x",
                }),
                getVariables: () => [],
                listPremises: () => [],
                hasPremise: () => false,
                lookupClaim: () => undefined,
                flushAndGetChecksumDeltas: () => ({
                    savedMeta: undefined,
                    savedDescendant: undefined,
                    savedCombined: undefined,
                    currentMeta: undefined,
                    currentDescendant: undefined,
                    currentCombined: undefined,
                }),
                validateVariables: () => ({ ok: true, violations: [] }),
                wouldCreateCycle: () => false,
            }

            const result = validateArgumentAfterPremiseMutation(ctx)
            expect(result.ok).toBe(false)
            expect(
                result.violations.some(
                    (v) => v.code === "ARG_CONCLUSION_NOT_FOUND"
                )
            ).toBe(true)
        })
    })

})



describe("review helper errors", () => {
    it("InvalidArgumentStructureError carries a message and name", () => {
        const err = new InvalidArgumentStructureError("bad structure")
        expect(err).toBeInstanceOf(Error)
        expect(err.name).toBe("InvalidArgumentStructureError")
        expect(err.message).toBe("bad structure")
    })

    it("UnknownExpressionError carries the bad id", () => {
        const err = new UnknownExpressionError("expr-xyz")
        expect(err).toBeInstanceOf(Error)
        expect(err.name).toBe("UnknownExpressionError")
        expect(err.expressionId).toBe("expr-xyz")
        expect(err.message).toContain("expr-xyz")
    })

    it("NotOperatorNotDecidableError on a NOT operator carries reason and id", () => {
        const err = new NotOperatorNotDecidableError(
            "expr-not",
            "is-not-operator"
        )
        expect(err).toBeInstanceOf(Error)
        expect(err.name).toBe("NotOperatorNotDecidableError")
        expect(err.expressionId).toBe("expr-not")
        expect(err.reason).toBe("is-not-operator")
        expect(err.message).toContain("expr-not")
    })

    it("NotOperatorNotDecidableError on a non-operator expression carries reason", () => {
        const err = new NotOperatorNotDecidableError(
            "expr-var",
            "not-an-operator-type"
        )
        expect(err.reason).toBe("not-an-operator-type")
        expect(err.message).toContain("expr-var")
    })
})

describe("PremiseEngine — getDecidableOperatorExpressions", () => {
    it("returns [or] for a single or(a,b)", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise({ title: "P or Q" })
        const orId = `${pm.getId()}-or`
        pm.addExpression(makeOpExpr(orId, "or"))
        pm.addExpression(
            makeVarExpr(`${orId}-p`, VAR_P.id, { parentId: orId, position: 0 })
        )
        pm.addExpression(
            makeVarExpr(`${orId}-q`, VAR_Q.id, { parentId: orId, position: 1 })
        )
        const result = pm.getDecidableOperatorExpressions()
        expect(result.map((e) => e.id)).toEqual([orId])
    })

    it("returns [and, or] in pre-order for and(or(a,b), c)", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        eng.addVariable(makeVar("var-r", "R"))
        const { result: pm } = eng.createPremise({ title: "(P or Q) and R" })
        const andId = `${pm.getId()}-and`
        const orId = `${pm.getId()}-or`
        const formulaId = `${pm.getId()}-formula`
        pm.addExpression(makeOpExpr(andId, "and"))
        pm.addExpression(
            makeFormulaExpr(formulaId, { parentId: andId, position: 0 })
        )
        pm.addExpression(
            makeOpExpr(orId, "or", { parentId: formulaId, position: 0 })
        )
        pm.addExpression(
            makeVarExpr(`${orId}-p`, VAR_P.id, { parentId: orId, position: 0 })
        )
        pm.addExpression(
            makeVarExpr(`${orId}-q`, VAR_Q.id, { parentId: orId, position: 1 })
        )
        pm.addExpression(
            makeVarExpr(`${andId}-r`, "var-r", { parentId: andId, position: 1 })
        )
        const result = pm.getDecidableOperatorExpressions()
        expect(result.map((e) => e.id)).toEqual([andId, orId])
    })

    it("excludes NOT inside a premise: and(not(a), b) returns [and]", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise({ title: "not(P) and Q" })
        const andId = `${pm.getId()}-and`
        const notId = `${pm.getId()}-not`
        pm.addExpression(makeOpExpr(andId, "and"))
        pm.addExpression(
            makeOpExpr(notId, "not", { parentId: andId, position: 0 })
        )
        pm.addExpression(
            makeVarExpr(`${notId}-p`, VAR_P.id, {
                parentId: notId,
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr(`${andId}-q`, VAR_Q.id, {
                parentId: andId,
                position: 1,
            })
        )
        const result = pm.getDecidableOperatorExpressions()
        expect(result.map((e) => e.id)).toEqual([andId])
    })

    it("excludes wrapping NOT but keeps inner AND: not(and(a,b)) returns [and]", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise({ title: "not(P and Q)" })
        const notId = `${pm.getId()}-not`
        const formulaId = `${pm.getId()}-formula`
        const andId = `${pm.getId()}-and`
        pm.addExpression(makeOpExpr(notId, "not"))
        pm.addExpression(
            makeFormulaExpr(formulaId, { parentId: notId, position: 0 })
        )
        pm.addExpression(
            makeOpExpr(andId, "and", { parentId: formulaId, position: 0 })
        )
        pm.addExpression(
            makeVarExpr(`${andId}-p`, VAR_P.id, {
                parentId: andId,
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr(`${andId}-q`, VAR_Q.id, {
                parentId: andId,
                position: 1,
            })
        )
        const result = pm.getDecidableOperatorExpressions()
        expect(result.map((e) => e.id)).toEqual([andId])
    })

    it("returns [] for a single-variable premise with no operators", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise({ title: "P" })
        pm.addExpression(makeVarExpr(`${pm.getId()}-p`, VAR_P.id))
        expect(pm.getDecidableOperatorExpressions()).toEqual([])
    })

    it("returns [] for an empty premise", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const { result: pm } = eng.createPremise({ title: "empty" })
        expect(pm.getDecidableOperatorExpressions()).toEqual([])
    })
})

describe("collectArgumentReferencedClaims", () => {
    function evalCtxFrom(eng: ArgumentEngine): TArgumentEvaluationContext {
        return {
            argumentId: eng.getArgument().id,
            conclusionPremiseId: eng.getRoleState().conclusionPremiseId,
            getConclusionPremise: () =>
                eng.getConclusionPremise() as TEvaluablePremise | undefined,
            listSupportingPremises: () =>
                eng.listSupportingPremises() as TEvaluablePremise[],
            listPremises: () => eng.listPremises() as TEvaluablePremise[],
            getVariable: (id) => eng.getVariable(id),
            getPremise: (id) =>
                eng.getPremise(id) as TEvaluablePremise | undefined,
            validateEvaluability: () => eng.validateEvaluability(),
        }
    }

    it("returns only the conclusion's claims when there are no supporting premises", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise({ title: "P" })
        pm.addExpression(makeVarExpr(`${pm.getId()}-p`, VAR_P.id))
        eng.setConclusionPremise(pm.getId())

        const r = collectArgumentReferencedClaims(evalCtxFrom(eng))
        expect(r.claimIds).toEqual(["claim-default"])
        expect(r.byId["claim-default"].variableIds).toEqual([VAR_P.id])
        expect(r.byId["claim-default"].premiseIds).toEqual([pm.getId()])
        expect(r.byId["claim-default"].claimVersion).toBe(0)
    })

    it("emits a claim once at its first occurrence when shared across premises", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_P)
        const { result: support } = eng.createPremise({ title: "P (support)" })
        const { result: conclusion } = eng.createPremise({ title: "P (conc)" })
        support.addExpression(makeVarExpr(`${support.getId()}-p`, VAR_P.id))
        conclusion.addExpression(
            makeVarExpr(`${conclusion.getId()}-p`, VAR_P.id)
        )
        eng.setConclusionPremise(conclusion.getId())

        const r = collectArgumentReferencedClaims(evalCtxFrom(eng))
        expect(r.claimIds).toEqual(["claim-default"])
        expect(r.byId["claim-default"].premiseIds).toHaveLength(2)
        expect(r.byId["claim-default"].variableIds).toEqual([VAR_P.id])
    })

    it("skips premise-bound variables (no bound claim)", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_P)
        const { result: inner } = eng.createPremise({ title: "inner: P" })
        inner.addExpression(makeVarExpr(`${inner.getId()}-p`, VAR_P.id))
        const { result: outer } = eng.createPremise({ title: "outer" })
        const varsBound = eng.getVariables().filter((v) => isPremiseBound(v))
        expect(varsBound.length).toBeGreaterThan(0)
        void outer

        const r = collectArgumentReferencedClaims(evalCtxFrom(eng))
        expect(r.claimIds).toEqual(["claim-default"])
    })

    it("throws InvalidArgumentStructureError when two variables bind the same claim with different versions", () => {
        const lib = new ClaimLibrary()
        lib.create({ id: "claim-shared", type: "normal" })
        // freeze() leaves v0 (frozen) AND v1 (new mutable copy) both reachable.
        lib.freeze("claim-shared")

        const eng = new ArgumentEngine(ARG, lib)
        eng.addVariable({
            id: "var-v0",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "X",
            claimId: "claim-shared",
            claimVersion: 0,
        })
        eng.addVariable({
            id: "var-v1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "Y",
            claimId: "claim-shared",
            claimVersion: 1,
        })
        const { result: pm } = eng.createPremise({ title: "pm" })
        const andId = `${pm.getId()}-and`
        pm.addExpression(makeOpExpr(andId, "and"))
        pm.addExpression(
            makeVarExpr(`${andId}-x`, "var-v0", {
                parentId: andId,
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr(`${andId}-y`, "var-v1", {
                parentId: andId,
                position: 1,
            })
        )
        eng.setConclusionPremise(pm.getId())

        expect(() => collectArgumentReferencedClaims(evalCtxFrom(eng))).toThrow(
            InvalidArgumentStructureError
        )
    })

    it("orders claims by supporting → conclusion → constraint, then by first tree-order reference", () => {
        const lib = new ClaimLibrary()
        lib.create({ id: "claim-a", type: "normal" })
        lib.create({ id: "claim-b", type: "normal" })
        const eng = new ArgumentEngine(ARG, lib)
        eng.addVariable({
            id: "var-a",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "A",
            claimId: "claim-a",
            claimVersion: 0,
        })
        eng.addVariable({
            id: "var-b",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "B",
            claimId: "claim-b",
            claimVersion: 0,
        })
        const { result: support } = eng.createPremise({ title: "B -> A" })
        const implId = `${support.getId()}-impl`
        support.addExpression(makeOpExpr(implId, "implies"))
        support.addExpression(
            makeVarExpr(`${implId}-b`, "var-b", {
                parentId: implId,
                position: 0,
            })
        )
        support.addExpression(
            makeVarExpr(`${implId}-a`, "var-a", {
                parentId: implId,
                position: 1,
            })
        )
        const { result: conclusion } = eng.createPremise({ title: "A" })
        conclusion.addExpression(
            makeVarExpr(`${conclusion.getId()}-a`, "var-a")
        )
        eng.setConclusionPremise(conclusion.getId())

        const r = collectArgumentReferencedClaims(evalCtxFrom(eng))
        expect(r.claimIds).toEqual(["claim-b", "claim-a"])
    })
})

describe("canonicalizeOperatorAssignments", () => {
    function evalCtxFrom(eng: ArgumentEngine): TArgumentEvaluationContext {
        return {
            argumentId: eng.getArgument().id,
            conclusionPremiseId: eng.getRoleState().conclusionPremiseId,
            getConclusionPremise: () =>
                eng.getConclusionPremise() as TEvaluablePremise | undefined,
            listSupportingPremises: () =>
                eng.listSupportingPremises() as TEvaluablePremise[],
            listPremises: () => eng.listPremises() as TEvaluablePremise[],
            getVariable: (id) => eng.getVariable(id),
            getPremise: (id) =>
                eng.getPremise(id) as TEvaluablePremise | undefined,
            validateEvaluability: () => eng.validateEvaluability(),
        }
    }

    /** Builds eng with one premise containing AND(OR(p,q), r). Returns ids. */
    function buildNested(): {
        eng: ArgumentEngine
        premiseId: string
        andId: string
        orId: string
    } {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        eng.addVariable(makeVar("var-r", "R"))
        const { result: pm } = eng.createPremise({ title: "(P or Q) and R" })
        const andId = `${pm.getId()}-and`
        const orId = `${pm.getId()}-or`
        const formulaId = `${pm.getId()}-formula`
        pm.addExpression(makeOpExpr(andId, "and"))
        pm.addExpression(
            makeFormulaExpr(formulaId, { parentId: andId, position: 0 })
        )
        pm.addExpression(
            makeOpExpr(orId, "or", { parentId: formulaId, position: 0 })
        )
        pm.addExpression(
            makeVarExpr(`${orId}-p`, VAR_P.id, { parentId: orId, position: 0 })
        )
        pm.addExpression(
            makeVarExpr(`${orId}-q`, VAR_Q.id, { parentId: orId, position: 1 })
        )
        pm.addExpression(
            makeVarExpr(`${andId}-r`, "var-r", { parentId: andId, position: 1 })
        )
        eng.setConclusionPremise(pm.getId())
        return { eng, premiseId: pm.getId(), andId, orId }
    }

    it("empty input returns {}", () => {
        const { eng } = buildNested()
        const r = canonicalizeOperatorAssignments(evalCtxFrom(eng), {
            premiseScope: {},
        })
        expect(r).toEqual({})
    })

    it("premiseScope fans out to every non-NOT operator in the premise", () => {
        const { eng, premiseId, andId, orId } = buildNested()
        const r = canonicalizeOperatorAssignments(evalCtxFrom(eng), {
            premiseScope: { [premiseId]: "accepted" },
        })
        expect(r).toEqual({
            [andId]: "accepted",
            [orId]: "accepted",
        })
    })

    it("expressionOverrides win over premiseScope fan-out", () => {
        const { eng, premiseId, andId, orId } = buildNested()
        const r = canonicalizeOperatorAssignments(evalCtxFrom(eng), {
            premiseScope: { [premiseId]: "accepted" },
            expressionOverrides: { [orId]: "rejected" },
        })
        expect(r).toEqual({
            [andId]: "accepted",
            [orId]: "rejected",
        })
    })

    it("expressionOverrides alone produce assignments even when parent premise is not in premiseScope", () => {
        const { eng, orId } = buildNested()
        const r = canonicalizeOperatorAssignments(evalCtxFrom(eng), {
            premiseScope: {},
            expressionOverrides: { [orId]: "rejected" },
        })
        expect(r).toEqual({ [orId]: "rejected" })
    })

    it("unknown expression id throws UnknownExpressionError", () => {
        const { eng } = buildNested()
        expect(() =>
            canonicalizeOperatorAssignments(evalCtxFrom(eng), {
                premiseScope: {},
                expressionOverrides: { "not-a-real-id": "accepted" },
            })
        ).toThrow(UnknownExpressionError)
    })

    it("NOT override throws NotOperatorNotDecidableError with reason=is-not-operator", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise({ title: "not P" })
        const notId = `${pm.getId()}-not`
        pm.addExpression(makeOpExpr(notId, "not"))
        pm.addExpression(
            makeVarExpr(`${notId}-p`, VAR_P.id, {
                parentId: notId,
                position: 0,
            })
        )
        eng.setConclusionPremise(pm.getId())

        expect(() =>
            canonicalizeOperatorAssignments(evalCtxFrom(eng), {
                premiseScope: {},
                expressionOverrides: { [notId]: "accepted" },
            })
        ).toThrow(NotOperatorNotDecidableError)
        try {
            canonicalizeOperatorAssignments(evalCtxFrom(eng), {
                premiseScope: {},
                expressionOverrides: { [notId]: "accepted" },
            })
            expect.fail("expected throw")
        } catch (e) {
            expect(e).toBeInstanceOf(NotOperatorNotDecidableError)
            expect((e as NotOperatorNotDecidableError).reason).toBe(
                "is-not-operator"
            )
        }
    })

    it("override on a non-operator expression throws NotOperatorNotDecidableError with reason=not-an-operator-type", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise({ title: "P" })
        const varExprId = `${pm.getId()}-p`
        pm.addExpression(makeVarExpr(varExprId, VAR_P.id))
        eng.setConclusionPremise(pm.getId())

        try {
            canonicalizeOperatorAssignments(evalCtxFrom(eng), {
                premiseScope: {},
                expressionOverrides: { [varExprId]: "accepted" },
            })
            expect.fail("expected throw")
        } catch (e) {
            expect(e).toBeInstanceOf(NotOperatorNotDecidableError)
            expect((e as NotOperatorNotDecidableError).reason).toBe(
                "not-an-operator-type"
            )
        }
    })
})

describe("evaluateArgument — propagatedVariableValues", () => {
    function evalCtxFrom(eng: ArgumentEngine): TArgumentEvaluationContext {
        return {
            argumentId: eng.getArgument().id,
            conclusionPremiseId: eng.getRoleState().conclusionPremiseId,
            getConclusionPremise: () =>
                eng.getConclusionPremise() as TEvaluablePremise | undefined,
            listSupportingPremises: () =>
                eng.listSupportingPremises() as TEvaluablePremise[],
            listPremises: () => eng.listPremises() as TEvaluablePremise[],
            getVariable: (id) => eng.getVariable(id),
            getPremise: (id) =>
                eng.getPremise(id) as TEvaluablePremise | undefined,
            validateEvaluability: () => eng.validateEvaluability(),
        }
    }

    function buildModusPonensEng() {
        const eng = new ArgumentEngine(ARG, aLib())
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: support } = eng.createPremise({ title: "P->Q" })
        const { result: pPremise } = eng.createPremise({ title: "P" })
        const { result: conclusion } = eng.createPremise({ title: "Q" })
        const implId = `${support.getId()}-impl`
        support.addExpression(makeOpExpr(implId, "implies"))
        support.addExpression(
            makeVarExpr(`${implId}-p`, VAR_P.id, {
                parentId: implId,
                position: 0,
            })
        )
        support.addExpression(
            makeVarExpr(`${implId}-q`, VAR_Q.id, {
                parentId: implId,
                position: 1,
            })
        )
        pPremise.addExpression(makeVarExpr(`${pPremise.getId()}-p`, VAR_P.id))
        conclusion.addExpression(
            makeVarExpr(`${conclusion.getId()}-q`, VAR_Q.id)
        )
        eng.setConclusionPremise(conclusion.getId())
        return { eng, implId }
    }

    it("pins unknown Q to true under accepted implies + P=true", () => {
        const { eng, implId } = buildModusPonensEng()
        const ctx = evalCtxFrom(eng)
        const result = evaluateArgument(
            ctx,
            {
                variables: { [VAR_P.id]: true, [VAR_Q.id]: null },
                operatorAssignments: { [implId]: "accepted" },
            },
            { includeDiagnostics: true }
        )
        expect(result.ok).toBe(true)
        expect(result.propagatedVariableValues).toBeDefined()
        expect(result.propagatedVariableValues![VAR_P.id]).toBe(true)
        expect(result.propagatedVariableValues![VAR_Q.id]).toBe(true)
    })

    it("is undefined when includeDiagnostics is false", () => {
        const { eng, implId } = buildModusPonensEng()
        const ctx = evalCtxFrom(eng)
        const result = evaluateArgument(
            ctx,
            {
                variables: { [VAR_P.id]: true, [VAR_Q.id]: null },
                operatorAssignments: { [implId]: "accepted" },
            },
            { includeDiagnostics: false }
        )
        expect(result.ok).toBe(true)
        expect(result.propagatedVariableValues).toBeUndefined()
    })

    it("represents still-unresolved variables as null (present in map)", () => {
        const { eng } = buildModusPonensEng()
        const ctx = evalCtxFrom(eng)
        const result = evaluateArgument(
            ctx,
            { variables: {}, operatorAssignments: {} },
            { includeDiagnostics: true }
        )
        expect(result.ok).toBe(true)
        expect(result.propagatedVariableValues).toBeDefined()
        expect(VAR_P.id in result.propagatedVariableValues!).toBe(true)
        expect(VAR_Q.id in result.propagatedVariableValues!).toBe(true)
        expect(result.propagatedVariableValues![VAR_P.id]).toBeNull()
        expect(result.propagatedVariableValues![VAR_Q.id]).toBeNull()
    })

    it("map key set equals referencedVariableIds", () => {
        const { eng, implId } = buildModusPonensEng()
        const ctx = evalCtxFrom(eng)
        const result = evaluateArgument(
            ctx,
            {
                variables: { [VAR_P.id]: true },
                operatorAssignments: { [implId]: "accepted" },
            },
            { includeDiagnostics: true }
        )
        expect(result.ok).toBe(true)
        const keys = Object.keys(result.propagatedVariableValues!).sort()
        expect(keys).toEqual([...result.referencedVariableIds!].sort())
    })
})

describe("CoreClaimSchema type field", () => {
    it("rejects a claim without a type field", () => {
        const claim = {
            id: "00000000-0000-0000-0000-000000000001",
            version: 0,
            frozen: false,
            checksum: "abc",
        }
        expect(Value.Check(CoreClaimSchema, claim)).toBe(false)
    })
    it("accepts a claim with type: 'normal'", () => {
        const claim = {
            id: "00000000-0000-0000-0000-000000000001",
            version: 0,
            frozen: false,
            checksum: "abc",
            type: "normal" as const,
        }
        expect(Value.Check(CoreClaimSchema, claim)).toBe(true)
    })
    it("accepts a claim with type: 'citation'", () => {
        const claim = {
            id: "00000000-0000-0000-0000-000000000001",
            version: 0,
            frozen: false,
            checksum: "abc",
            type: "citation" as const,
        }
        expect(Value.Check(CoreClaimSchema, claim)).toBe(true)
    })
    it("rejects a claim with an unknown type", () => {
        const claim = {
            id: "00000000-0000-0000-0000-000000000001",
            version: 0,
            frozen: false,
            checksum: "abc",
            type: "axiom",
        }
        expect(Value.Check(CoreClaimSchema, claim)).toBe(false)
    })
})

describe("ClaimCitationLibrary strict source-side type", () => {
    it("rejects a citation where supportingClaimId references a normal claim", () => {
        const claimLib = new ClaimLibrary()
        const normalClaim = claimLib.create({ type: "normal" })
        const anotherNormalClaim = claimLib.create({ type: "normal" })
        const citationLib = new ClaimCitationLibrary({
            get: (id, version) => claimLib.get(id, version),
            getCurrent: (id) => claimLib.getCurrent(id),
        })
        expect(() =>
            citationLib.add({
                id: "00000000-0000-0000-0000-000000000010",
                claimId: normalClaim.id,
                claimVersion: normalClaim.version,
                supportingClaimId: anotherNormalClaim.id,
                supportingClaimVersion: anotherNormalClaim.version,
            })
        ).toThrow(/only 'citation' is permitted/)
    })
    it("accepts a citation where supportingClaimId references a citation claim", () => {
        const claimLib = new ClaimLibrary()
        const normalClaim = claimLib.create({ type: "normal" })
        const citationClaim = claimLib.create({ type: "citation" })
        const citationLib = new ClaimCitationLibrary({
            get: (id, version) => claimLib.get(id, version),
            getCurrent: (id) => claimLib.getCurrent(id),
        })
        expect(() =>
            citationLib.add({
                id: "00000000-0000-0000-0000-000000000011",
                claimId: normalClaim.id,
                claimVersion: normalClaim.version,
                supportingClaimId: citationClaim.id,
                supportingClaimVersion: citationClaim.version,
            })
        ).not.toThrow()
    })
})

describe("ClaimCitationLibrary acyclicity", () => {
    function makeLibs() {
        const claimLib = new ClaimLibrary()
        const claimLookup = {
            get: (id: string, version: number) => claimLib.get(id, version),
            getCurrent: (id: string) => claimLib.getCurrent(id),
        }
        const citationLib = new ClaimCitationLibrary(claimLookup)
        return { claimLib, citationLib }
    }
    it("rejects a direct A↔B cycle", () => {
        const { claimLib, citationLib } = makeLibs()
        const a = claimLib.create({ type: "citation" })
        const b = claimLib.create({ type: "citation" })
        citationLib.add({
            id: "00000000-0000-0000-0000-000000000001",
            claimId: a.id,
            claimVersion: a.version,
            supportingClaimId: b.id,
            supportingClaimVersion: b.version,
        })
        expect(() =>
            citationLib.add({
                id: "00000000-0000-0000-0000-000000000002",
                claimId: b.id,
                claimVersion: b.version,
                supportingClaimId: a.id,
                supportingClaimVersion: a.version,
            })
        ).toThrow(/cycle/i)
    })
    it("rejects a transitive A→B→C→A cycle", () => {
        const { claimLib, citationLib } = makeLibs()
        const a = claimLib.create({ type: "citation" })
        const b = claimLib.create({ type: "citation" })
        const c = claimLib.create({ type: "citation" })
        citationLib.add({
            id: "00000000-0000-0000-0000-000000000010",
            claimId: a.id,
            claimVersion: a.version,
            supportingClaimId: b.id,
            supportingClaimVersion: b.version,
        })
        citationLib.add({
            id: "00000000-0000-0000-0000-000000000011",
            claimId: b.id,
            claimVersion: b.version,
            supportingClaimId: c.id,
            supportingClaimVersion: c.version,
        })
        expect(() =>
            citationLib.add({
                id: "00000000-0000-0000-0000-000000000012",
                claimId: c.id,
                claimVersion: c.version,
                supportingClaimId: a.id,
                supportingClaimVersion: a.version,
            })
        ).toThrow(/cycle/i)
    })
    it("treats version-different edges as projecting to the same ID-only graph", () => {
        const { claimLib, citationLib } = makeLibs()
        const a = claimLib.create({ type: "citation" })
        const b = claimLib.create({ type: "citation" })
        // First edge: A@v0 → B@v0
        citationLib.add({
            id: "00000000-0000-0000-0000-000000000020",
            claimId: a.id,
            claimVersion: 0,
            supportingClaimId: b.id,
            supportingClaimVersion: 0,
        })
        // Freeze A to bump it to a new version (v1)
        claimLib.freeze(a.id)
        // Try B@v0 → A@v1 — same ID-only cycle as the first edge's reverse
        expect(() =>
            citationLib.add({
                id: "00000000-0000-0000-0000-000000000021",
                claimId: b.id,
                claimVersion: 0,
                supportingClaimId: a.id,
                supportingClaimVersion: 1,
            })
        ).toThrow(/cycle/i)
    })
})

describe("ClaimLibrary type immutability", () => {
    it("rejects an update that changes the type field", () => {
        const claimLib = new ClaimLibrary()
        const c = claimLib.create({ type: "normal" })
        expect(() =>
            claimLib.update(c.id, { type: "citation" } as never)
        ).toThrow(/type is immutable/)
    })
    it("allows an update that does not change the type field", () => {
        const claimLib = new ClaimLibrary()
        const c = claimLib.create({ type: "normal" })
        // Update some other field via additionalProperties
        expect(() =>
            claimLib.update(c.id, { customField: "new value" } as never)
        ).not.toThrow()
    })
    it("allows an update that re-asserts the same type", () => {
        const claimLib = new ClaimLibrary()
        const c = claimLib.create({ type: "normal" })
        expect(() =>
            claimLib.update(c.id, { type: "normal" } as never)
        ).not.toThrow()
    })
})

describe("ClaimLibrary legacy snapshot detection", () => {
    it("emits LEGACY_CLAIM_MISSING_TYPE when restoring a snapshot with a typeless claim", () => {
        const legacySnapshot = {
            claims: [
                {
                    id: "00000000-0000-0000-0000-000000000001",
                    version: 0,
                    frozen: false,
                    checksum: "abc",
                    // type field intentionally missing
                },
            ],
        }
        expect(() =>
            ClaimLibrary.fromSnapshot(
                legacySnapshot as Parameters<
                    typeof ClaimLibrary.fromSnapshot
                >[0]
            )
        ).toThrow(/missing the 'type' field|pre-v0\.10\.0/)
    })
    it("accepts a snapshot where every claim has a type field", () => {
        const validSnapshot = {
            claims: [
                {
                    id: "00000000-0000-0000-0000-000000000001",
                    version: 0,
                    frozen: false,
                    checksum: "abc",
                    type: "normal" as const,
                },
            ],
        }
        expect(() =>
            ClaimLibrary.fromSnapshot(
                validSnapshot as Parameters<typeof ClaimLibrary.fromSnapshot>[0]
            )
        ).not.toThrow()
    })
})

describe("ForkLibrary 5-namespace shape", () => {
    it("snapshot contains exactly 5 namespaces", () => {
        const lib = new ForkLibrary()
        const snapshot = lib.snapshot()
        expect(Object.keys(snapshot).sort()).toEqual([
            "arguments",
            "claims",
            "expressions",
            "premises",
            "variables",
        ])
    })
})

describe("Fork record schema equality across namespaces", () => {
    it("claim fork records validate via CoreClaimForkRecordSchema", () => {
        const claimForkRecord = {
            entityId: "00000000-0000-0000-0000-000000000002",
            forkedFromEntityId: "00000000-0000-0000-0000-000000000003",
            forkedFromArgumentId: "00000000-0000-0000-0000-000000000004",
            forkedFromArgumentVersion: 0,
            forkedFromEntityVersion: 0,
            forkId: "00000000-0000-0000-0000-000000000005",
        }
        expect(Value.Check(CoreClaimForkRecordSchema, claimForkRecord)).toBe(
            true
        )
    })
})

describe("Premise type discriminator", () => {
    it("accepts a freeform premise via Value.Check", () => {
        const premise = {
            id: "00000000-0000-0000-0000-000000000001",
            argumentId: "00000000-0000-0000-0000-000000000002",
            argumentVersion: 1,
            type: "freeform",
            checksum: "abcd",
            descendantChecksum: null,
            combinedChecksum: "abcd",
        }
        expect(Value.Check(CorePremiseSchema, premise)).toBe(true)
    })

    it("accepts a derivation premise with derivedClaimId", () => {
        const premise = {
            id: "00000000-0000-0000-0000-000000000001",
            argumentId: "00000000-0000-0000-0000-000000000002",
            argumentVersion: 1,
            type: "derivation",
            derivedClaimId: "00000000-0000-0000-0000-000000000003",
            checksum: "abcd",
            descendantChecksum: null,
            combinedChecksum: "abcd",
        }
        expect(Value.Check(CorePremiseSchema, premise)).toBe(true)
    })

    it("rejects a derivation premise without derivedClaimId", () => {
        const premise = {
            id: "00000000-0000-0000-0000-000000000001",
            argumentId: "00000000-0000-0000-0000-000000000002",
            argumentVersion: 1,
            type: "derivation",
            checksum: "abcd",
            descendantChecksum: null,
            combinedChecksum: "abcd",
        }
        expect(Value.Check(CorePremiseSchema, premise)).toBe(false)
    })

    it("rejects an unknown type literal", () => {
        const premise = {
            id: "00000000-0000-0000-0000-000000000001",
            argumentId: "00000000-0000-0000-0000-000000000002",
            argumentVersion: 1,
            type: "axiomatic",
            checksum: "abcd",
            descendantChecksum: null,
            combinedChecksum: "abcd",
        }
        expect(Value.Check(CorePremiseSchema, premise)).toBe(false)
    })
})

describe("validateDerivationStructure", () => {
    const argumentId = "00000000-0000-0000-0000-000000000001"
    const claimId = "00000000-0000-0000-0000-00000000c0a1"
    const variableId = "00000000-0000-0000-0000-00000000a000"
    const exprId = "00000000-0000-0000-0000-00000000e000"
    const premiseId = "00000000-0000-0000-0000-00000000d001"

    function makeNakedQ(): {
        premise: TCoreDerivationPremise
        expressions: TCorePropositionalExpression[]
        variables: TCorePropositionalVariable[]
    } {
        const premise: TCoreDerivationPremise = {
            id: premiseId,
            argumentId,
            argumentVersion: 1,
            type: "derivation",
            derivedClaimId: claimId,
            checksum: "x",
            descendantChecksum: null,
            combinedChecksum: "x",
        }
        const variables: TCorePropositionalVariable[] = [
            {
                id: variableId,
                argumentId,
                argumentVersion: 1,
                symbol: "Q",
                claimId,
                claimVersion: 1,
                checksum: "x",
            },
        ]
        const expressions: TCorePropositionalExpression[] = [
            {
                id: exprId,
                argumentId,
                argumentVersion: 1,
                premiseId: premise.id,
                parentId: null,
                position: POSITION_INITIAL,
                type: "variable",
                variableId,
                checksum: "x",
                descendantChecksum: null,
                combinedChecksum: "x",
            },
        ]
        return { premise, expressions, variables }
    }

    it("accepts naked-Q form (root = variable expression for derivedClaimId)", () => {
        const { premise, expressions, variables } = makeNakedQ()
        const result = validateDerivationStructure(
            premise,
            expressions,
            variables
        )
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
    })

    it("accepts IMPLIES(antecedent, Q) form", () => {
        const { premise, variables } = makeNakedQ()
        const rootId = "00000000-0000-0000-0000-000000000010"
        const antecedentVarId = "00000000-0000-0000-0000-00000000a001"
        const antecedentExprId = "00000000-0000-0000-0000-000000000011"
        const consequentExprId = "00000000-0000-0000-0000-000000000012"
        const allVariables: TCorePropositionalVariable[] = [
            ...variables,
            {
                id: antecedentVarId,
                argumentId,
                argumentVersion: 1,
                symbol: "P",
                claimId: "00000000-0000-0000-0000-00000000c0b1",
                claimVersion: 1,
                checksum: "x",
            },
        ]
        const expressions: TCorePropositionalExpression[] = [
            {
                id: rootId,
                argumentId,
                argumentVersion: 1,
                premiseId,
                parentId: null,
                position: POSITION_INITIAL,
                type: "operator",
                operator: "implies",
                checksum: "x",
                descendantChecksum: "x",
                combinedChecksum: "x",
            },
            {
                id: antecedentExprId,
                argumentId,
                argumentVersion: 1,
                premiseId,
                parentId: rootId,
                position: 0,
                type: "variable",
                variableId: antecedentVarId,
                checksum: "x",
                descendantChecksum: null,
                combinedChecksum: "x",
            },
            {
                id: consequentExprId,
                argumentId,
                argumentVersion: 1,
                premiseId,
                parentId: rootId,
                position: 1,
                type: "variable",
                variableId,
                checksum: "x",
                descendantChecksum: null,
                combinedChecksum: "x",
            },
        ]
        const result = validateDerivationStructure(
            premise,
            expressions,
            allVariables
        )
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
    })

    it("accepts IFF(antecedent, Q) form", () => {
        const { premise, variables } = makeNakedQ()
        const rootId = "00000000-0000-0000-0000-000000000020"
        const antecedentVarId = "00000000-0000-0000-0000-00000000a002"
        const antecedentExprId = "00000000-0000-0000-0000-000000000021"
        const consequentExprId = "00000000-0000-0000-0000-000000000022"
        const allVariables: TCorePropositionalVariable[] = [
            ...variables,
            {
                id: antecedentVarId,
                argumentId,
                argumentVersion: 1,
                symbol: "R",
                claimId: "00000000-0000-0000-0000-00000000c0c1",
                claimVersion: 1,
                checksum: "x",
            },
        ]
        const expressions: TCorePropositionalExpression[] = [
            {
                id: rootId,
                argumentId,
                argumentVersion: 1,
                premiseId,
                parentId: null,
                position: POSITION_INITIAL,
                type: "operator",
                operator: "iff",
                checksum: "x",
                descendantChecksum: "x",
                combinedChecksum: "x",
            },
            {
                id: antecedentExprId,
                argumentId,
                argumentVersion: 1,
                premiseId,
                parentId: rootId,
                position: 0,
                type: "variable",
                variableId: antecedentVarId,
                checksum: "x",
                descendantChecksum: null,
                combinedChecksum: "x",
            },
            {
                id: consequentExprId,
                argumentId,
                argumentVersion: 1,
                premiseId,
                parentId: rootId,
                position: 1,
                type: "variable",
                variableId,
                checksum: "x",
                descendantChecksum: null,
                combinedChecksum: "x",
            },
        ]
        const result = validateDerivationStructure(
            premise,
            expressions,
            allVariables
        )
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
    })

    it("rejects missing root expression", () => {
        const { premise, variables } = makeNakedQ()
        const result = validateDerivationStructure(premise, [], variables)
        expect(result.ok).toBe(false)
        expect(result.violations).toHaveLength(1)
        expect(result.violations[0].code).toBe(DERIVATION_STRUCTURE_INVALID)
    })

    it("rejects multiple root expressions", () => {
        const { premise, expressions, variables } = makeNakedQ()
        const secondRoot: TCorePropositionalExpression = {
            id: "00000000-0000-0000-0000-000000000030",
            argumentId,
            argumentVersion: 1,
            premiseId,
            parentId: null,
            position: POSITION_INITIAL + 1,
            type: "variable",
            variableId,
            checksum: "x",
            descendantChecksum: null,
            combinedChecksum: "x",
        }
        const result = validateDerivationStructure(
            premise,
            [...expressions, secondRoot],
            variables
        )
        expect(result.ok).toBe(false)
        expect(result.violations).toHaveLength(1)
        expect(result.violations[0].code).toBe(DERIVATION_STRUCTURE_INVALID)
    })

    it("rejects root operator that is not implies/iff/variable (e.g., AND root)", () => {
        const { premise, variables } = makeNakedQ()
        const andRoot: TCorePropositionalExpression = {
            id: "00000000-0000-0000-0000-000000000040",
            argumentId,
            argumentVersion: 1,
            premiseId,
            parentId: null,
            position: POSITION_INITIAL,
            type: "operator",
            operator: "and",
            checksum: "x",
            descendantChecksum: null,
            combinedChecksum: "x",
        }
        const result = validateDerivationStructure(
            premise,
            [andRoot],
            variables
        )
        expect(result.ok).toBe(false)
        expect(result.violations).toHaveLength(1)
        expect(result.violations[0].code).toBe(DERIVATION_STRUCTURE_INVALID)
    })

    it("rejects implies arity != 2", () => {
        const { premise, variables } = makeNakedQ()
        const rootId = "00000000-0000-0000-0000-000000000050"
        const onlyChildExprId = "00000000-0000-0000-0000-000000000051"
        // implies with only 1 child (consequent slot missing antecedent)
        const expressions: TCorePropositionalExpression[] = [
            {
                id: rootId,
                argumentId,
                argumentVersion: 1,
                premiseId,
                parentId: null,
                position: POSITION_INITIAL,
                type: "operator",
                operator: "implies",
                checksum: "x",
                descendantChecksum: "x",
                combinedChecksum: "x",
            },
            {
                id: onlyChildExprId,
                argumentId,
                argumentVersion: 1,
                premiseId,
                parentId: rootId,
                position: 1,
                type: "variable",
                variableId,
                checksum: "x",
                descendantChecksum: null,
                combinedChecksum: "x",
            },
        ]
        const result = validateDerivationStructure(
            premise,
            expressions,
            variables
        )
        expect(result.ok).toBe(false)
        expect(result.violations).toHaveLength(1)
        expect(result.violations[0].code).toBe(DERIVATION_STRUCTURE_INVALID)
    })

    it("rejects consequent slot containing non-variable expression (e.g., AND subtree)", () => {
        const { premise, variables } = makeNakedQ()
        const rootId = "00000000-0000-0000-0000-000000000060"
        const antecedentVarId = "00000000-0000-0000-0000-00000000a003"
        const antecedentExprId = "00000000-0000-0000-0000-000000000061"
        const badConsequentId = "00000000-0000-0000-0000-000000000062"
        const allVariables: TCorePropositionalVariable[] = [
            ...variables,
            {
                id: antecedentVarId,
                argumentId,
                argumentVersion: 1,
                symbol: "S",
                claimId: "00000000-0000-0000-0000-00000000c0d1",
                claimVersion: 1,
                checksum: "x",
            },
        ]
        const expressions: TCorePropositionalExpression[] = [
            {
                id: rootId,
                argumentId,
                argumentVersion: 1,
                premiseId,
                parentId: null,
                position: POSITION_INITIAL,
                type: "operator",
                operator: "implies",
                checksum: "x",
                descendantChecksum: "x",
                combinedChecksum: "x",
            },
            {
                id: antecedentExprId,
                argumentId,
                argumentVersion: 1,
                premiseId,
                parentId: rootId,
                position: 0,
                type: "variable",
                variableId: antecedentVarId,
                checksum: "x",
                descendantChecksum: null,
                combinedChecksum: "x",
            },
            {
                // consequent slot is an AND operator, not a variable
                id: badConsequentId,
                argumentId,
                argumentVersion: 1,
                premiseId,
                parentId: rootId,
                position: 1,
                type: "operator",
                operator: "and",
                checksum: "x",
                descendantChecksum: null,
                combinedChecksum: "x",
            },
        ]
        const result = validateDerivationStructure(
            premise,
            expressions,
            allVariables
        )
        expect(result.ok).toBe(false)
        expect(result.violations).toHaveLength(1)
        expect(result.violations[0].code).toBe(DERIVATION_STRUCTURE_INVALID)
    })

    it("rejects consequent slot containing different variable (not Q)", () => {
        const { premise, variables } = makeNakedQ()
        const rootId = "00000000-0000-0000-0000-000000000070"
        const antecedentVarId = "00000000-0000-0000-0000-00000000a004"
        const wrongConsequentVarId = "00000000-0000-0000-0000-00000000a005"
        const antecedentExprId = "00000000-0000-0000-0000-000000000071"
        const wrongConsequentExprId = "00000000-0000-0000-0000-000000000072"
        const allVariables: TCorePropositionalVariable[] = [
            ...variables,
            {
                id: antecedentVarId,
                argumentId,
                argumentVersion: 1,
                symbol: "T",
                claimId: "00000000-0000-0000-0000-00000000c0e1",
                claimVersion: 1,
                checksum: "x",
            },
            {
                id: wrongConsequentVarId,
                argumentId,
                argumentVersion: 1,
                symbol: "U",
                claimId: "00000000-0000-0000-0000-00000000c0f1",
                claimVersion: 1,
                checksum: "x",
            },
        ]
        const expressions: TCorePropositionalExpression[] = [
            {
                id: rootId,
                argumentId,
                argumentVersion: 1,
                premiseId,
                parentId: null,
                position: POSITION_INITIAL,
                type: "operator",
                operator: "implies",
                checksum: "x",
                descendantChecksum: "x",
                combinedChecksum: "x",
            },
            {
                id: antecedentExprId,
                argumentId,
                argumentVersion: 1,
                premiseId,
                parentId: rootId,
                position: 0,
                type: "variable",
                variableId: antecedentVarId,
                checksum: "x",
                descendantChecksum: null,
                combinedChecksum: "x",
            },
            {
                // consequent slot references a variable that is NOT Q (not derivedClaimId's var)
                id: wrongConsequentExprId,
                argumentId,
                argumentVersion: 1,
                premiseId,
                parentId: rootId,
                position: 1,
                type: "variable",
                variableId: wrongConsequentVarId,
                checksum: "x",
                descendantChecksum: null,
                combinedChecksum: "x",
            },
        ]
        const result = validateDerivationStructure(
            premise,
            expressions,
            allVariables
        )
        expect(result.ok).toBe(false)
        expect(result.violations).toHaveLength(1)
        expect(result.violations[0].code).toBe(DERIVATION_STRUCTURE_INVALID)
    })

    it("rejects naked variable that does not reference derivedClaimId", () => {
        const { premise, variables } = makeNakedQ()
        const wrongVarId = "00000000-0000-0000-0000-00000000a006"
        const allVariables: TCorePropositionalVariable[] = [
            ...variables,
            {
                id: wrongVarId,
                argumentId,
                argumentVersion: 1,
                symbol: "V",
                claimId: "00000000-0000-0000-0000-00000000c0a2",
                claimVersion: 1,
                checksum: "x",
            },
        ]
        // Root variable references wrongVarId, not variableId (Q)
        const expressions: TCorePropositionalExpression[] = [
            {
                id: exprId,
                argumentId,
                argumentVersion: 1,
                premiseId,
                parentId: null,
                position: POSITION_INITIAL,
                type: "variable",
                variableId: wrongVarId,
                checksum: "x",
                descendantChecksum: null,
                combinedChecksum: "x",
            },
        ]
        const result = validateDerivationStructure(
            premise,
            expressions,
            allVariables
        )
        expect(result.ok).toBe(false)
        expect(result.violations).toHaveLength(1)
        expect(result.violations[0].code).toBe(DERIVATION_STRUCTURE_INVALID)
    })

    it("rejects when no claim-bound variable for derivedClaimId exists in `variables`", () => {
        const { premise, expressions } = makeNakedQ()
        // Pass empty variables — no claim-bound variable for claimId
        const result = validateDerivationStructure(premise, expressions, [])
        expect(result.ok).toBe(false)
        expect(result.violations).toHaveLength(1)
        expect(result.violations[0].code).toBe(DERIVATION_STRUCTURE_INVALID)
    })

    it("rejects formula as root (formula is not allowed as root)", () => {
        const { premise, variables } = makeNakedQ()
        const formulaRoot: TCorePropositionalExpression = {
            id: "00000000-0000-0000-0000-000000000080",
            argumentId,
            argumentVersion: 1,
            premiseId,
            parentId: null,
            position: POSITION_INITIAL,
            type: "formula",
            checksum: "x",
            descendantChecksum: null,
            combinedChecksum: "x",
        }
        const result = validateDerivationStructure(
            premise,
            [formulaRoot],
            variables
        )
        expect(result.ok).toBe(false)
        expect(result.violations).toHaveLength(1)
        expect(result.violations[0].code).toBe(DERIVATION_STRUCTURE_INVALID)
    })
})

describe("ensureClaimBoundVariable", () => {
    function setupArgumentWithClaim() {
        const claimLib = new ClaimLibrary()
        const claim = claimLib.create({ type: "normal" })
        const claimId = claim.id
        const argumentEngine = new ArgumentEngine(ARG, claimLib)
        return { argumentEngine, claimLib, claimId }
    }

    it("creates a new claim-bound variable when none exists", () => {
        const { argumentEngine, claimId } = setupArgumentWithClaim()
        const variable = argumentEngine.ensureClaimBoundVariable(claimId)
        expect(variable.claimId).toBe(claimId)
        expect(variable.symbol).toMatch(/^[A-Z]/)
        expect(
            argumentEngine.getVariables().find((v) => v.id === variable.id)
        ).toBeDefined()
    })

    it("returns the existing variable when one is already bound to the claim", () => {
        const { argumentEngine, claimId } = setupArgumentWithClaim()
        const first = argumentEngine.ensureClaimBoundVariable(claimId)
        const second = argumentEngine.ensureClaimBoundVariable(claimId)
        expect(second.id).toBe(first.id)
    })

    it("pins to the current claim version from the library", () => {
        const { argumentEngine, claimLib, claimId } = setupArgumentWithClaim()
        // freeze() bumps the version to 1 (the new current)
        claimLib.freeze(claimId)
        const variable = argumentEngine.ensureClaimBoundVariable(claimId)
        expect(variable.claimVersion).toBe(1)
    })

    it("throws CLAIM_NOT_FOUND when the claim is not in the library", () => {
        const { argumentEngine } = setupArgumentWithClaim()
        expect(() =>
            argumentEngine.ensureClaimBoundVariable(
                "00000000-0000-0000-0000-000000000999"
            )
        ).toThrow(/CLAIM_NOT_FOUND/)
    })
})

// ---------------------------------------------------------------------------
// createPremise typed-bag overload + derivation init flow (Task 9)
// ---------------------------------------------------------------------------

describe("createPremise with type and derivedClaimId", () => {
    function setupArgumentWithClaim() {
        const claimLib = new ClaimLibrary()
        const claim = claimLib.create({ type: "normal" })
        const claimId = claim.id
        const argumentEngine = new ArgumentEngine(ARG, claimLib)
        return { argumentEngine, claimLib, claimId }
    }

    it("creates a freeform premise when type is omitted (default)", () => {
        const { argumentEngine } = setupArgumentWithClaim()
        const { result: pm } = argumentEngine.createPremise()
        expect(pm.toPremiseData().type).toBe("freeform")
    })

    it("creates a freeform premise via explicit type: 'freeform'", () => {
        const { argumentEngine } = setupArgumentWithClaim()
        const { result: pm } = argumentEngine.createPremise({
            type: "freeform",
        })
        expect(pm.toPremiseData().type).toBe("freeform")
    })

    it("creates a derivation premise with naked-Q expression tree", () => {
        const { argumentEngine, claimId } = setupArgumentWithClaim()
        const { result: pm } = argumentEngine.createPremise({
            type: "derivation",
            derivedClaimId: claimId,
        })
        const premiseData = pm.toPremiseData()
        expect(premiseData.type).toBe("derivation")
        expect((premiseData as TCoreDerivationPremise).derivedClaimId).toBe(
            claimId
        )
        // Verify the premise's expression tree is a single naked-Q variable expression.
        const expressions = pm.getExpressions()
        expect(expressions).toHaveLength(1)
        const root = expressions.find((e) => e.parentId === null)
        expect(root?.type).toBe("variable")
    })

    it("ensures a claim-bound variable for the derivedClaimId", () => {
        const { argumentEngine, claimId } = setupArgumentWithClaim()
        const variablesBefore = argumentEngine.getVariables().length
        argumentEngine.createPremise({
            type: "derivation",
            derivedClaimId: claimId,
        })
        const variablesAfter = argumentEngine.getVariables().length
        // Two variables created: one premise-bound (auto) + one claim-bound (for derivedClaimId)
        expect(variablesAfter).toBeGreaterThan(variablesBefore)
        const claimBoundVar = argumentEngine
            .getVariables()
            .find(
                (v) =>
                    isClaimBound(
                        v as unknown as import("../src/lib/schemata").TCorePropositionalVariable
                    ) &&
                    (v as unknown as TClaimBoundVariable).claimId === claimId
            )
        expect(claimBoundVar).toBeDefined()
    })

    it("is idempotent: calling ensureClaimBoundVariable twice reuses the variable", () => {
        const { argumentEngine, claimId } = setupArgumentWithClaim()
        // Ensure the variable once first.
        argumentEngine.ensureClaimBoundVariable(claimId)
        const variablesBefore = argumentEngine.getVariables().length
        // Creating a derivation premise with the same claimId should NOT add another claim-bound variable.
        argumentEngine.createPremise({
            type: "derivation",
            derivedClaimId: claimId,
        })
        const variablesAfter = argumentEngine.getVariables().length
        // Only the premise-bound variable (auto) should be new.
        expect(variablesAfter).toBe(variablesBefore + 1)
    })

    it("throws CREATE_DERIVATION_REQUIRES_DERIVED_CLAIM_ID when type=derivation has no derivedClaimId", () => {
        const { argumentEngine } = setupArgumentWithClaim()
        expect(() =>
            argumentEngine.createPremise({ type: "derivation" })
        ).toThrow(/CREATE_DERIVATION_REQUIRES_DERIVED_CLAIM_ID/)
    })

    it("throws CREATE_DERIVATION_CLAIM_NOT_FOUND when claim is missing", () => {
        const { argumentEngine } = setupArgumentWithClaim()
        expect(() =>
            argumentEngine.createPremise({
                type: "derivation",
                derivedClaimId: "00000000-0000-0000-0000-000000000999",
            })
        ).toThrow(/CREATE_DERIVATION_CLAIM_NOT_FOUND/)
    })
})

describe("createPremise legacy positional signature (backward compat)", () => {
    it("accepts no arguments", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const { result: pm } = eng.createPremise()
        expect(pm.toPremiseData().type).toBe("freeform")
    })

    it("accepts (extras) positional", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const { result: pm } = eng.createPremise({ title: "hello" })
        const data = pm.toPremiseData()
        expect(data.type).toBe("freeform")
        expect((data as Record<string, unknown>).title).toBe("hello")
    })

    it("accepts (extras, symbol) positional", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const { result: pm } = eng.createPremise({ title: "hello" }, "MySymbol")
        const data = pm.toPremiseData()
        expect(data.type).toBe("freeform")
        expect((data as Record<string, unknown>).title).toBe("hello")
        const vars = eng.getVariables()
        const premiseBound = vars.find(
            (v) =>
                isPremiseBound(
                    v as unknown as import("../src/lib/schemata").TCorePropositionalVariable
                ) &&
                (v as unknown as TPremiseBoundVariable).symbol === "MySymbol"
        )
        expect(premiseBound).toBeDefined()
    })

    it("accepts (undefined, symbol) positional", () => {
        const eng = new ArgumentEngine(ARG, aLib())
        const { result: _pm } = eng.createPremise(undefined, "XSym")
        const vars = eng.getVariables()
        const premiseBound = vars.find(
            (v) =>
                isPremiseBound(
                    v as unknown as import("../src/lib/schemata").TCorePropositionalVariable
                ) && (v as unknown as TPremiseBoundVariable).symbol === "XSym"
        )
        expect(premiseBound).toBeDefined()
    })
})

describe("createPremiseWithId with derivation type", () => {
    function setupArgumentWithClaim() {
        const claimLib = new ClaimLibrary()
        const claim = claimLib.create({ type: "normal" })
        const claimId = claim.id
        const argumentEngine = new ArgumentEngine(ARG, claimLib)
        return { argumentEngine, claimLib, claimId }
    }

    it("creates a derivation premise with given id", () => {
        const { argumentEngine, claimId } = setupArgumentWithClaim()
        const customId = "00000000-0000-0000-0000-000000000111"
        const { result: pm } = argumentEngine.createPremiseWithId(customId, {
            type: "derivation",
            derivedClaimId: claimId,
        })
        expect(pm.getId()).toBe(customId)
        expect(pm.toPremiseData().type).toBe("derivation")
        expect(
            (pm.toPremiseData() as TCoreDerivationPremise).derivedClaimId
        ).toBe(claimId)
    })

    it("creates naked-Q expression tree via createPremiseWithId", () => {
        const { argumentEngine, claimId } = setupArgumentWithClaim()
        const { result: pm } = argumentEngine.createPremiseWithId(
            "00000000-0000-0000-0000-000000000222",
            { type: "derivation", derivedClaimId: claimId }
        )
        const expressions = pm.getExpressions()
        expect(expressions).toHaveLength(1)
        expect(expressions[0].type).toBe("variable")
    })

    it("legacy positional still works via createPremiseWithId", () => {
        const { argumentEngine } = setupArgumentWithClaim()
        const { result: pm } = argumentEngine.createPremiseWithId(
            "00000000-0000-0000-0000-000000000333",
            { title: "legacy" }
        )
        const data = pm.toPremiseData()
        expect(data.type).toBe("freeform")
        expect((data as Record<string, unknown>).title).toBe("legacy")
    })

    it("throws CREATE_DERIVATION_REQUIRES_DERIVED_CLAIM_ID from createPremiseWithId", () => {
        const { argumentEngine } = setupArgumentWithClaim()
        expect(() =>
            argumentEngine.createPremiseWithId(
                "00000000-0000-0000-0000-000000000444",
                {
                    type: "derivation",
                }
            )
        ).toThrow(/CREATE_DERIVATION_REQUIRES_DERIVED_CLAIM_ID/)
    })

    it("throws CREATE_DERIVATION_CLAIM_NOT_FOUND from createPremiseWithId", () => {
        const { argumentEngine } = setupArgumentWithClaim()
        expect(() =>
            argumentEngine.createPremiseWithId(
                "00000000-0000-0000-0000-000000000555",
                {
                    type: "derivation",
                    derivedClaimId: "00000000-0000-0000-0000-000000000999",
                }
            )
        ).toThrow(/CREATE_DERIVATION_CLAIM_NOT_FOUND/)
    })
})

// ---------------------------------------------------------------------------
// Derivation premise extras handling (Task 9 regression)
// ---------------------------------------------------------------------------

describe("derivation premise extras handling", () => {
    function setupArgumentWithClaim() {
        const claimLib = new ClaimLibrary()
        const claim = claimLib.create({ type: "normal" })
        const claimId = claim.id
        const argumentEngine = new ArgumentEngine(ARG, claimLib)
        return { argumentEngine, claimId }
    }

    it("getExtras() does not include type or derivedClaimId on a derivation premise", () => {
        const { argumentEngine, claimId } = setupArgumentWithClaim()
        const { result: pm } = argumentEngine.createPremise({
            type: "derivation",
            derivedClaimId: claimId,
            extras: { foo: "bar" },
        })
        const extras = pm.getExtras()
        expect(extras).not.toHaveProperty("type")
        expect(extras).not.toHaveProperty("derivedClaimId")
        expect(extras).toMatchObject({ foo: "bar" })
    })

    it("setExtras() preserves type and derivedClaimId after replacement", () => {
        const { argumentEngine, claimId } = setupArgumentWithClaim()
        const { result: pm } = argumentEngine.createPremise({
            type: "derivation",
            derivedClaimId: claimId,
        })
        pm.setExtras({ note: "replacement" })
        const premise = pm.toPremiseData()
        expect(premise.type).toBe("derivation")
        expect((premise as TCoreDerivationPremise).derivedClaimId).toBe(claimId)
        expect(pm.getExtras()).toMatchObject({ note: "replacement" })
    })
})

// ---------------------------------------------------------------------------
// Fork integration with derivation premises (Task 10)
// ---------------------------------------------------------------------------

describe("Fork integration with derivation premises", () => {
    /**
     * Sets up a PropositCore with one argument containing one derivation
     * premise. The derivation premise is bound to a single "normal" claim.
     * Returns the core, the argument ID, and the original claim ID.
     */
    function setupArgumentWithDerivationPremise() {
        const propositCore = new PropositCore()

        // Create the claim that the derivation premise will reference.
        const claim = propositCore.claims.create({ type: "normal" })
        const claimId = claim.id

        // Create the argument and its derivation premise.
        const argId = crypto.randomUUID()
        const engine = propositCore.arguments.create({
            id: argId,
            version: 0,
        })
        engine.createPremise({ type: "derivation", derivedClaimId: claimId })

        return { propositCore, argumentId: argId, claimId }
    }

    it("propagates type and derivedClaimId through forkArgument", () => {
        const { propositCore, argumentId, claimId } =
            setupArgumentWithDerivationPremise()
        const { engine: forkedEngine, claimRemap } =
            propositCore.forkArgument(argumentId)

        const forkedPremises = forkedEngine.listPremises()
        const forkedDerivation = forkedPremises.find(
            (p) => p.toPremiseData().type === "derivation"
        )
        expect(forkedDerivation).toBeDefined()
        expect(
            (forkedDerivation!.toPremiseData() as TCoreDerivationPremise)
                .derivedClaimId
        ).toBe(claimRemap.get(claimId))
    })

    it("forks a derivation premise's expression tree with the consequent referencing the cloned variable", () => {
        const { propositCore, argumentId } =
            setupArgumentWithDerivationPremise()
        const { engine: forkedEngine } = propositCore.forkArgument(argumentId)

        const derivationPremise = forkedEngine
            .listPremises()
            .find((p) => p.toPremiseData().type === "derivation")!
        expect(derivationPremise).toBeDefined()

        // Verifies the forked derivation premise's tree is well-formed
        // by checking it parses as a valid naked-Q (D-1) or fully
        // populated state via the v1.0 validate('derivable') API.
        // Pre-v1.0 this test reloaded the snapshot via
        // ManagedDerivationPremiseEngine.fromSnapshot, which threw on
        // structural derivation violations; v1.0 routes the equivalent
        // checks through the Derivable validators.
        const violations = forkedEngine.validate("derivable")
        const d1ForThisPremise = violations.filter(
            (v) =>
                v.code === "D-1" &&
                "premiseId" in v &&
                v.premiseId === derivationPremise.getId()
        )
        expect(d1ForThisPremise).toEqual([])

        // The snapshot is still produceable (the snapshot API is part
        // of the public surface independent of MDPE).
        const snap = derivationPremise.snapshot()
        expect(snap.expressions.expressions.length).toBeGreaterThan(0)
    })
})

// ---------------------------------------------------------------------------
// validateEvaluability derivation pre-flight + validateDerivationStructures (Task 11)
// ---------------------------------------------------------------------------

describe("ArgumentEngine validateEvaluability with derivation pre-flight", () => {
    /**
     * Builds an ArgumentEngine whose single derivation premise has an empty
     * expression tree (no root expression → structure violation).
     */
    function setupArgumentWithBrokenDerivation() {
        const claimLib = new ClaimLibrary()
        const claim = claimLib.create({ type: "normal" })

        const engine = new ArgumentEngine(
            { id: "arg-broken", version: 1 },
            claimLib
        )
        engine.createPremise({ type: "derivation", derivedClaimId: claim.id })

        // Take snapshot and strip all expressions from the derivation premise.
        const snap = engine.snapshot()
        const derivPremSnap = snap.premises.find(
            (p) => (p.premise as Record<string, unknown>).type === "derivation"
        )!
        derivPremSnap.expressions = { expressions: [] }
        derivPremSnap.rootExpressionId = undefined

        // Restore via ArgumentEngine.fromSnapshot — uses PremiseEngine (no
        // derivation structure check), so the broken tree loads without error.
        const argumentEngine = ArgumentEngine.fromSnapshot(snap, claimLib)
        return { argumentEngine }
    }

    /**
     * Builds an ArgumentEngine with a well-formed derivation premise
     * (naked-Q form created by createPremise).
     */
    function setupArgumentWithGoodDerivation() {
        const claimLib = new ClaimLibrary()
        const claim = claimLib.create({ type: "normal" })

        const engine = new ArgumentEngine(
            { id: "arg-good", version: 1 },
            claimLib
        )
        engine.createPremise({ type: "derivation", derivedClaimId: claim.id })
        return { argumentEngine: engine }
    }

    it("flags a structurally-broken derivation premise with DERIVATION_STRUCTURE_INVALID_AT_EVALUATION", () => {
        const { argumentEngine } = setupArgumentWithBrokenDerivation()
        const result = argumentEngine.validateEvaluability()
        expect(
            result.issues.some(
                (v) => v.code === "DERIVATION_STRUCTURE_INVALID_AT_EVALUATION"
            )
        ).toBe(true)
    })

    it("evaluate returns {ok: false} when derivation premise is broken", () => {
        const { argumentEngine } = setupArgumentWithBrokenDerivation()
        const result = argumentEngine.evaluate({
            variables: {},
            operatorAssignments: {},
        })
        expect(result.ok).toBe(false)
        expect(
            result.validation?.issues.some(
                (v) => v.code === "DERIVATION_STRUCTURE_INVALID_AT_EVALUATION"
            )
        ).toBe(true)
    })

    it("checkValidity flags broken derivation premises (parity with evaluate)", () => {
        const { argumentEngine } = setupArgumentWithBrokenDerivation()
        const result = argumentEngine.checkValidity()
        expect(
            result.validation?.issues.some(
                (v) => v.code === "DERIVATION_STRUCTURE_INVALID_AT_EVALUATION"
            )
        ).toBe(true)
    })

    it("does not flag well-formed derivation premises", () => {
        const { argumentEngine } = setupArgumentWithGoodDerivation()
        const result = argumentEngine.validateEvaluability()
        const derivationIssues = result.issues.filter(
            (v) => v.code === "DERIVATION_STRUCTURE_INVALID_AT_EVALUATION"
        )
        expect(derivationIssues).toEqual([])
    })
})

describe("ArgumentEngine.validateDerivationStructures", () => {
    function setupArgumentWithBrokenDerivation() {
        const claimLib = new ClaimLibrary()
        const claim = claimLib.create({ type: "normal" })

        const engine = new ArgumentEngine(
            { id: "arg-broken2", version: 1 },
            claimLib
        )
        engine.createPremise({ type: "derivation", derivedClaimId: claim.id })

        const snap = engine.snapshot()
        const derivPremSnap = snap.premises.find(
            (p) => (p.premise as Record<string, unknown>).type === "derivation"
        )!
        derivPremSnap.expressions = { expressions: [] }
        derivPremSnap.rootExpressionId = undefined

        const argumentEngine = ArgumentEngine.fromSnapshot(snap, claimLib)
        return { argumentEngine }
    }

    it("returns the derivation-specific subset of validateEvaluability checks", () => {
        const { argumentEngine } = setupArgumentWithBrokenDerivation()
        const result = argumentEngine.validateDerivationStructures()
        expect(result.violations.length).toBeGreaterThan(0)
        for (const v of result.violations) {
            expect(v.code).toBe("DERIVATION_STRUCTURE_INVALID_AT_EVALUATION")
        }
    })
})

// ---------------------------------------------------------------------------
// fromData premise-extras preservation (CR 2026-05-07)
//
// Regression coverage for the typed-bag misinterpretation: when a DB row
// carries `type: "freeform"` (or `"derivation"`) plus sibling extras, the
// restore path used to send the row through parsePremiseArgsInternal, which
// classified it as a typed-bag and silently dropped every property other than
// type/derivedClaimId/extras/symbol. The restore path must instead preserve
// all sibling properties on the premise as extras.
// ---------------------------------------------------------------------------

describe("ArgumentEngine.fromData — premise extras preservation", () => {
    it("preserves DB-shape sibling properties as extras", () => {
        const arg = { id: "arg-1", version: 1 }
        const createdOn = new Date("2026-01-01T00:00:00Z")
        const premises = [
            {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 1,
                type: "freeform" as const,
                title: "Some premise title",
                role: "supporting",
                createdOn,
                creatorId: "u1",
            },
        ] as unknown as TOptionalChecksum<TCorePremise>[]
        const engine = ArgumentEngine.fromData(
            arg,
            aLib(),
            [],
            premises,
            [],
            {}
        )
        const restored = engine.getPremise("p1")!.toPremiseData() as Record<
            string,
            unknown
        >
        expect(restored.title).toBe("Some premise title")
        expect(restored.role).toBe("supporting")
        expect(restored.createdOn).toEqual(createdOn)
        expect(restored.creatorId).toBe("u1")
        expect(restored.type).toBe("freeform")
    })

    it("round-trips extras through createPremise → snapshot → fromData", () => {
        const claimLib = aLib()
        const engine = new ArgumentEngine(ARG, claimLib)
        const { result: pm } = engine.createPremise({
            type: "freeform",
            extras: { title: "X", role: "supporting" },
        })
        const premiseId = pm.toPremiseData().id

        const snapshot = engine.snapshot()
        const variables = snapshot.variables.variables
        const premises = snapshot.premises.map((ps) => ps.premise)
        const expressions: TExpressionInput<TCorePropositionalExpression>[] = []
        for (const ps of snapshot.premises) {
            for (const e of ps.expressions.expressions) {
                expressions.push({
                    ...(e as unknown as Record<string, unknown>),
                    premiseId: ps.premise.id,
                } as unknown as TExpressionInput<TCorePropositionalExpression>)
            }
        }

        const restoredEngine = ArgumentEngine.fromData(
            snapshot.argument,
            claimLib,
            variables,
            premises,
            expressions,
            { conclusionPremiseId: snapshot.conclusionPremiseId }
        )
        const restoredData = restoredEngine
            .getPremise(premiseId)!
            .toPremiseData() as Record<string, unknown>
        expect(restoredData.title).toBe("X")
        expect(restoredData.role).toBe("supporting")
    })

    it("createPremise typed-bag still treats `extras` as the extras source (no regression)", () => {
        const claimLib = new ClaimLibrary()
        const claim = claimLib.create({ id: "c1", type: "normal" })
        const engine = new ArgumentEngine(ARG, claimLib)
        const { result: pm } = engine.createPremise({
            type: "derivation",
            derivedClaimId: claim.id,
            extras: { title: "Y" },
        })
        const data = pm.toPremiseData() as Record<string, unknown>
        expect(data.title).toBe("Y")
        expect(data.type).toBe("derivation")
        expect(data.derivedClaimId).toBe(claim.id)
    })

    it("premise checksum is identical with or without sibling extras (extras excluded from hash)", () => {
        const arg = { id: "arg-1", version: 1 }
        const bare = ArgumentEngine.fromData(
            arg,
            aLib(),
            [],
            [
                {
                    id: "p1",
                    argumentId: "arg-1",
                    argumentVersion: 1,
                    type: "freeform" as const,
                },
            ] as TOptionalChecksum<TCorePremise>[],
            [],
            {}
        )
        const withExtras = ArgumentEngine.fromData(
            arg,
            aLib(),
            [],
            [
                {
                    id: "p1",
                    argumentId: "arg-1",
                    argumentVersion: 1,
                    type: "freeform" as const,
                    title: "X",
                    role: "supporting",
                    createdOn: new Date("2026-01-01T00:00:00Z"),
                    creatorId: "u1",
                },
            ] as unknown as TOptionalChecksum<TCorePremise>[],
            [],
            {}
        )
        expect(bare.getPremise("p1")!.checksum()).toBe(
            withExtras.getPremise("p1")!.checksum()
        )
    })
})

describe("ClaimLibrary axiomatic claim type (v0.12)", () => {
    it("creates a claim with type 'axiomatic'", () => {
        const lib = new ClaimLibrary()
        const claim = lib.create({ type: "axiomatic" })
        expect(claim.type).toBe("axiomatic")
        expect(claim.version).toBe(0)
        expect(claim.frozen).toBe(false)
    })

    it("rejects an update that changes type to or from 'axiomatic'", () => {
        const lib = new ClaimLibrary()
        const normal = lib.create({ type: "normal" })
        const axiomatic = lib.create({ type: "axiomatic" })
        expect(() =>
            lib.update(normal.id, { type: "axiomatic" } as never)
        ).toThrow(/type is immutable/)
        expect(() =>
            lib.update(axiomatic.id, { type: "normal" } as never)
        ).toThrow(/type is immutable/)
    })
})

describe("ClaimAxiomLibrary (v0.12)", () => {
    function setup() {
        const claims = new ClaimLibrary()
        const normalClaim = claims.create({ type: "normal" })
        const axiomClaim = claims.create({ type: "axiomatic" })
        const citationClaim = claims.create({ type: "citation" })
        const axioms = new ClaimAxiomLibrary(claims)
        return { claims, normalClaim, axiomClaim, citationClaim, axioms }
    }

    it("creates an axiom connection between a normal claim and an axiomatic claim", () => {
        const { normalClaim, axiomClaim, axioms } = setup()
        const conn = axioms.add({
            id: "ax-1",
            claimId: normalClaim.id,
            claimVersion: 0,
            supportingClaimId: axiomClaim.id,
            supportingClaimVersion: 0,
        })
        expect(conn.id).toBe("ax-1")
        expect(conn.checksum).not.toBe("")
        expect(axioms.getAll()).toHaveLength(1)
        expect(axioms.getConnectionsForClaim(normalClaim.id)).toHaveLength(1)
    })

    it("rejects a connection whose supporting claim is not axiomatic", () => {
        const { normalClaim, citationClaim, axioms } = setup()
        expect(() =>
            axioms.add({
                id: "ax-2",
                claimId: normalClaim.id,
                claimVersion: 0,
                supportingClaimId: citationClaim.id,
                supportingClaimVersion: 0,
            })
        ).toThrow(/AXIOM_SUPPORTING_NOT_AXIOMATIC_TYPE/)
    })

    it("rejects a connection whose supported claim is not normal", () => {
        const { citationClaim, axiomClaim, axioms } = setup()
        expect(() =>
            axioms.add({
                id: "ax-3",
                claimId: citationClaim.id,
                claimVersion: 0,
                supportingClaimId: axiomClaim.id,
                supportingClaimVersion: 0,
            })
        ).toThrow(/AXIOM_CLAIM_NOT_NORMAL_TYPE/)
    })

    it("rejects a connection with unknown claim refs", () => {
        const { axiomClaim, axioms } = setup()
        expect(() =>
            axioms.add({
                id: "ax-4",
                claimId: "missing-id",
                claimVersion: 0,
                supportingClaimId: axiomClaim.id,
                supportingClaimVersion: 0,
            })
        ).toThrow(/AXIOM_CLAIM_REF_NOT_FOUND/)
    })

    it("rejects duplicate IDs", () => {
        const { normalClaim, axiomClaim, axioms } = setup()
        axioms.add({
            id: "dup",
            claimId: normalClaim.id,
            claimVersion: 0,
            supportingClaimId: axiomClaim.id,
            supportingClaimVersion: 0,
        })
        expect(() =>
            axioms.add({
                id: "dup",
                claimId: normalClaim.id,
                claimVersion: 0,
                supportingClaimId: axiomClaim.id,
                supportingClaimVersion: 0,
            })
        ).toThrow(/AXIOM_DUPLICATE_ID/)
    })

    it("snapshot and fromSnapshot round-trip", () => {
        const { claims, normalClaim, axiomClaim, axioms } = setup()
        axioms.add({
            id: "ax-rt",
            claimId: normalClaim.id,
            claimVersion: 0,
            supportingClaimId: axiomClaim.id,
            supportingClaimVersion: 0,
        })
        const snap = axioms.snapshot()
        const restored = ClaimAxiomLibrary.fromSnapshot(snap, claims)
        expect(restored.getAll()).toHaveLength(1)
        expect(restored.get("ax-rt")?.id).toBe("ax-rt")
    })

    it("axioms cannot form cycles by structural impossibility", () => {
        // Axiomatic claims can never appear on the dependent side, so cycles
        // cannot be constructed. This test documents the invariant.
        const { axiomClaim, normalClaim, axioms } = setup()
        // Try to make an axiom point AT another axiom (depend on it).
        expect(() =>
            axioms.add({
                id: "ax-cycle",
                claimId: axiomClaim.id,
                claimVersion: 0,
                supportingClaimId: axiomClaim.id,
                supportingClaimVersion: 0,
            })
        ).toThrow(/AXIOM_CLAIM_NOT_NORMAL_TYPE/)
        expect(normalClaim).toBeDefined() // suppress unused
    })

    describe("remove", () => {
        it("throws InvariantViolationError with code AXIOM_NOT_FOUND when removing a missing id", () => {
            const claimLib = new ClaimLibrary()
            const lib = new ClaimAxiomLibrary(claimLib)
            let caught: unknown
            try {
                lib.remove("does-not-exist")
            } catch (e) {
                caught = e
            }
            expect(caught).toBeInstanceOf(InvariantViolationError)
            const err = caught as InvariantViolationError
            expect(err.violations[0].code).toBe(AXIOM_NOT_FOUND)
        })
    })
})

describe("PropositCore axioms field (v0.12)", () => {
    it("exposes axioms as a public field", () => {
        const core = new PropositCore()
        expect(core.axioms).toBeInstanceOf(ClaimAxiomLibrary)
    })

    it("citations field is named 'citations' (renamed from claimCitations)", () => {
        const core = new PropositCore()
        expect(core.citations).toBeInstanceOf(ClaimCitationLibrary)
        expect("claimCitations" in core).toBe(false)
    })

    it("snapshot includes citations and axioms slots", () => {
        const core = new PropositCore()
        const snap = core.snapshot()
        expect(snap).toHaveProperty("citations")
        expect(snap).toHaveProperty("axioms")
        expect(snap.citations).toEqual({ connections: [] })
        expect(snap.axioms).toEqual({ connections: [] })
    })

    it("fromSnapshot throws LEGACY_MISSING_AXIOM_SLOT when 'axioms' is absent", () => {
        const legacy = {
            arguments: { arguments: [] },
            claims: { claims: [] },
            citations: { connections: [] },
            forks: {
                arguments: [],
                premises: [],
                expressions: [],
                variables: [],
                claims: [],
            },
        } as unknown
        expect(() => PropositCore.fromSnapshot(legacy as never)).toThrow(
            /LEGACY_MISSING_AXIOM_SLOT/
        )
    })

    it("fromSnapshot throws LEGACY_CLAIM_CITATION_SHAPE when 'claimCitations' slot present", () => {
        const legacy = {
            arguments: { arguments: [] },
            claims: { claims: [] },
            claimCitations: { claimCitations: [] }, // pre-v0.12 shape
            axioms: { connections: [] },
            forks: {
                arguments: [],
                premises: [],
                expressions: [],
                variables: [],
                claims: [],
            },
        } as unknown
        expect(() => PropositCore.fromSnapshot(legacy as never)).toThrow(
            /LEGACY_CLAIM_CITATION_SHAPE/
        )
    })
})

describe("PropositCore.forkArgument transitive closure across axioms (v0.12)", () => {
    it("clones a normal claim, its cited citation, and its supporting axiom", () => {
        const core = new PropositCore()
        const normalClaim = core.claims.create({ type: "normal" })
        const cited = core.claims.create({ type: "citation" })
        const axiom = core.claims.create({ type: "axiomatic" })
        core.citations.add({
            id: crypto.randomUUID(),
            claimId: normalClaim.id,
            claimVersion: normalClaim.version,
            supportingClaimId: cited.id,
            supportingClaimVersion: cited.version,
        })
        core.axioms.add({
            id: crypto.randomUUID(),
            claimId: normalClaim.id,
            claimVersion: normalClaim.version,
            supportingClaimId: axiom.id,
            supportingClaimVersion: axiom.version,
        })

        const arg = { id: crypto.randomUUID(), version: 0 }
        core.arguments.create(arg)
        // Add a claim-bound variable for normalClaim so the seed walk picks it up.
        const engine = core.arguments.get(arg.id)!
        engine.ensureClaimBoundVariable(normalClaim.id)

        const { claimRemap } = core.forkArgument(arg.id, crypto.randomUUID())

        // All three claims should be cloned.
        expect(claimRemap.size).toBe(3)
        expect(claimRemap.get(normalClaim.id)).toBeDefined()
        expect(claimRemap.get(cited.id)).toBeDefined()
        expect(claimRemap.get(axiom.id)).toBeDefined()

        // Cloned citation/axiom connections live in the same PropositCore's libraries,
        // pointing at the cloned claims.
        const newNormalId = claimRemap.get(normalClaim.id)!
        expect(core.citations.getConnectionsForClaim(newNormalId)).toHaveLength(
            1
        )
        expect(core.axioms.getConnectionsForClaim(newNormalId)).toHaveLength(1)
        const citationConn =
            core.citations.getConnectionsForClaim(newNormalId)[0]
        const axiomConn = core.axioms.getConnectionsForClaim(newNormalId)[0]
        expect(citationConn.claimVersion).toBe(0)
        expect(citationConn.supportingClaimVersion).toBe(0)
        expect(axiomConn.claimVersion).toBe(0)
        expect(axiomConn.supportingClaimVersion).toBe(0)
    })

    it("walks multi-hop closure: normal claim A supported by both citation B and axiom X", () => {
        const core = new PropositCore()
        const a = core.claims.create({ type: "normal" })
        const b = core.claims.create({ type: "citation" })
        const axiomForA = core.claims.create({ type: "axiomatic" })
        core.citations.add({
            id: crypto.randomUUID(),
            claimId: a.id,
            claimVersion: a.version,
            supportingClaimId: b.id,
            supportingClaimVersion: b.version,
        })
        core.axioms.add({
            id: crypto.randomUUID(),
            claimId: a.id,
            claimVersion: a.version,
            supportingClaimId: axiomForA.id,
            supportingClaimVersion: axiomForA.version,
        })

        const arg = { id: crypto.randomUUID(), version: 0 }
        core.arguments.create(arg)
        const engine = core.arguments.get(arg.id)!
        engine.ensureClaimBoundVariable(a.id)

        const { claimRemap } = core.forkArgument(arg.id, crypto.randomUUID())
        expect(claimRemap.get(a.id)).toBeDefined()
        expect(claimRemap.get(b.id)).toBeDefined()
        expect(claimRemap.get(axiomForA.id)).toBeDefined()
    })
})

// ---------------------------------------------------------------------------
// Task 17: ArgumentEngine.evaluate / checkValidity axiom force-true semantics
// (v0.12) — failing tests, to be made green by Tasks 18-20.
// ---------------------------------------------------------------------------

describe("ArgumentEngine.evaluate axiom force-true (v0.12)", () => {
    it("forces axiomatic-bound variables to true with no caller assignment", () => {
        const core = new PropositCore()
        const claim = core.claims.create({ type: "axiomatic" })
        const argId = crypto.randomUUID()
        core.arguments.create({ id: argId, version: 0 })
        const engine = core.arguments.get(argId)!
        const variable = engine.ensureClaimBoundVariable(claim.id)
        // Build a trivial premise with the variable as its expression. With
        // a single variable expression at the root, it is a constraint
        // premise; because it is the first premise added, it is also
        // auto-designated as the conclusion.
        const { result: pm } = engine.createPremise({ type: "freeform" })
        const premiseId = pm.toPremiseData().id
        pm.addExpression({
            id: crypto.randomUUID(),
            argumentId: argId,
            argumentVersion: 0,
            premiseId,
            parentId: null,
            position: POSITION_INITIAL,
            type: "variable",
            variableId: variable.id,
        })
        const result = engine.evaluate({
            variables: {},
            operatorAssignments: {},
        })
        // The premise's expression should evaluate to true because the
        // axiomatic-bound variable is force-true.
        expect(result.ok).toBe(true)
        expect(result.conclusion?.rootValue).toBe(true)
    })

    it("rejects an explicit assignment of an axiomatic-bound variable", () => {
        const core = new PropositCore()
        const claim = core.claims.create({ type: "axiomatic" })
        const argId = crypto.randomUUID()
        core.arguments.create({ id: argId, version: 0 })
        const engine = core.arguments.get(argId)!
        const variable = engine.ensureClaimBoundVariable(claim.id)
        expect(() =>
            engine.evaluate({
                variables: { [variable.id]: true },
                operatorAssignments: {},
            })
        ).toThrow(/AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN/)
        expect(() =>
            engine.evaluate({
                variables: { [variable.id]: false },
                operatorAssignments: {},
            })
        ).toThrow(/AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN/)
        expect(() =>
            engine.evaluate({
                variables: { [variable.id]: null },
                operatorAssignments: {},
            })
        ).toThrow(/AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN/)
    })

    it("rejects an explicit `undefined` assignment of an axiomatic-bound variable", () => {
        // Regression: a caller passing { [varId]: undefined } previously slipped
        // past the `!== undefined` guard and was silently overwritten to true.
        // Per Change 2 in v0.12.1, ANY explicit key on the assignment map for
        // an axiomatic-bound variable must throw, including an explicit undefined.
        const core = new PropositCore()
        const claim = core.claims.create({ type: "axiomatic" })
        const argId = crypto.randomUUID()
        core.arguments.create({ id: argId, version: 0 })
        const engine = core.arguments.get(argId)!
        const variable = engine.ensureClaimBoundVariable(claim.id)
        expect(() =>
            engine.evaluate({
                variables: { [variable.id]: undefined as unknown as boolean },
                operatorAssignments: {},
            })
        ).toThrow(/AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN/)
    })

    // The forward direction relies on `populateFromSupports` (Task 22) to build
    // an `IMPLIES(axiomVar, Q)` antecedent and then swap the root to `iff`. The
    // helper does not yet exist; the test is skipped here and will be revisited
    // alongside Task 22.
    it.skip("iff-rooted derivation backed by an axiom forces consequent Q to true (blocked by Task 22 populateFromSupports)", () => {
        // An axiom-backed derivation whose root operator is iff propagates
        // bidirectionally: axiom forces antecedent true → Q true; and
        // a known-true Q would force the antecedent true. Verify the forward
        // direction lands Q at true.
        const core = new PropositCore()
        const derivedClaim = core.claims.create({ type: "normal" })
        const axiomClaim = core.claims.create({ type: "axiomatic" })
        core.axioms.add({
            id: "iff-a",
            claimId: derivedClaim.id,
            claimVersion: 0,
            supportingClaimId: axiomClaim.id,
            supportingClaimVersion: 0,
        })
        const argId = crypto.randomUUID()
        core.arguments.create({ id: argId, version: 0 })
        const engine = core.arguments.get(argId)!
        const { result: premEngine } = engine.createPremise({
            type: "derivation",
            derivedClaimId: derivedClaim.id,
        })
        // Populate the antecedent via supports, then swap root operator
        // implies → iff. `populateFromSupports` is Task 22; until it exists
        // this test is skipped.
        ;(
            premEngine as unknown as {
                populateFromSupports: (
                    c: typeof core.citations,
                    a: typeof core.axioms,
                    e: typeof engine
                ) => void
            }
        ).populateFromSupports(core.citations, core.axioms, engine)
        const root = (premEngine as unknown as { rootExpressionId: string })
            .rootExpressionId
        ;(
            premEngine as unknown as {
                changeOperator: (id: string, op: string) => void
            }
        ).changeOperator(root, "iff")
        engine.setConclusionPremise(premEngine.toPremiseData().id)
        const result = engine.evaluate({
            variables: {},
            operatorAssignments: {},
        })
        const consequentVar = engine
            .getVariables()
            .find(
                (v) =>
                    isClaimBound(v as unknown as TCorePropositionalVariable) &&
                    (v as unknown as TClaimBoundVariable).claimId ===
                        derivedClaim.id
            )
        expect(consequentVar).toBeDefined()
        // Inspect the conclusion premise's variable values map (no
        // propagatedVariableValues without includeDiagnostics).
        expect(result.conclusion?.variableValues?.[consequentVar!.id]).toBe(
            true
        )
    })

    it("checkValidity excludes axiomatic-bound variables from enumeration", () => {
        const core = new PropositCore()
        const normalClaim = core.claims.create({ type: "normal" })
        const axiomClaim = core.claims.create({ type: "axiomatic" })
        const argId = crypto.randomUUID()
        core.arguments.create({ id: argId, version: 0 })
        const engine = core.arguments.get(argId)!
        const normalVar = engine.ensureClaimBoundVariable(normalClaim.id)
        const axiomVar = engine.ensureClaimBoundVariable(axiomClaim.id)
        // Conclusion premise: P ∧ axiom — counts admissible assignments over
        // the free vars (just P; axiom is forced true).
        const { result: pm } = engine.createPremise({ type: "freeform" })
        const premiseId = pm.toPremiseData().id
        const andId = crypto.randomUUID()
        pm.addExpression({
            id: andId,
            argumentId: argId,
            argumentVersion: 0,
            premiseId,
            parentId: null,
            position: POSITION_INITIAL,
            type: "operator",
            operator: "and",
        })
        pm.appendExpression(andId, {
            id: crypto.randomUUID(),
            argumentId: argId,
            argumentVersion: 0,
            premiseId,
            parentId: andId,
            type: "variable",
            variableId: normalVar.id,
        })
        pm.appendExpression(andId, {
            id: crypto.randomUUID(),
            argumentId: argId,
            argumentVersion: 0,
            premiseId,
            parentId: andId,
            type: "variable",
            variableId: axiomVar.id,
        })
        engine.setConclusionPremise(premiseId)
        const result = engine.checkValidity({ mode: "exhaustive" })
        expect(result.ok).toBe(true)
        // 2^1 = 2 enumerated assignments (normalVar true/false), not 2^2 = 4.
        // The axiomatic variable is forced-true and excluded from enumeration.
        expect(result.numAssignmentsChecked).toBe(2)
        // No constraint premises, so every enumerated row is admissible
        // (admissibility is over constraints, not the conclusion).
        expect(result.numAdmissibleAssignments).toBe(2)
    })
})

// ---------------------------------------------------------------------------
// Task 20: Propagator interaction with axiomatic variables (v0.12)
// ---------------------------------------------------------------------------

describe("Propagator interaction with axiomatic variables (v0.12)", () => {
    it("rejecting an operator whose only unknown child is axiom-bound does not flip the axiom", () => {
        const core = new PropositCore()
        const axiomClaim = core.claims.create({ type: "axiomatic" })
        const normalClaim = core.claims.create({ type: "normal" })
        const argId = crypto.randomUUID()
        core.arguments.create({ id: argId, version: 0 })
        const engine = core.arguments.get(argId)!
        const normalVar = engine.ensureClaimBoundVariable(normalClaim.id)
        const axiomVar = engine.ensureClaimBoundVariable(axiomClaim.id)
        const { result: pm } = engine.createPremise({ type: "freeform" })
        const premiseId = pm.toPremiseData().id
        const andId = crypto.randomUUID()
        pm.addExpression({
            id: andId,
            argumentId: argId,
            argumentVersion: 0,
            premiseId,
            parentId: null,
            position: POSITION_INITIAL,
            type: "operator",
            operator: "and",
        })
        pm.appendExpression(andId, {
            id: crypto.randomUUID(),
            argumentId: argId,
            argumentVersion: 0,
            premiseId,
            parentId: andId,
            type: "variable",
            variableId: normalVar.id,
        })
        pm.appendExpression(andId, {
            id: crypto.randomUUID(),
            argumentId: argId,
            argumentVersion: 0,
            premiseId,
            parentId: andId,
            type: "variable",
            variableId: axiomVar.id,
        })
        // Evaluate with the AND operator REJECTED. The propagator wants to
        // flip one child to false; the axiomatic-bound variable is
        // force-true and lives in the propagator's `userAssigned` set, so
        // it is immune to overwrite.
        const rejectedResult = engine.evaluate({
            variables: {},
            operatorAssignments: { [andId]: "rejected" },
        })
        // The axiomatic variable stays true (forced); the rejection's
        // downstream propagation halts gracefully — the premise still
        // evaluates without throwing.
        expect(rejectedResult.ok).toBe(true)
        expect(rejectedResult.conclusion).toBeDefined()
        expect(rejectedResult.conclusion?.variableValues?.[axiomVar.id]).toBe(
            true
        )
        // Re-evaluate without rejection — baseline sanity.
        const baseline = engine.evaluate({
            variables: {},
            operatorAssignments: {},
        })
        expect(baseline.ok).toBe(true)
        expect(baseline.conclusion).toBeDefined()
        expect(baseline.conclusion?.variableValues?.[axiomVar.id]).toBe(true)
    })
})

describe("PremiseEngine.reparentExpression (D0e)", () => {
    // Public bundled-composite mutation per spec §8. Atomically moves an
    // existing expression onto a new parent at a given position with no
    // externally observable transient orphan state. Used by native AN-1
    // (formula-buffer insertion) and native AN-4 (multi-child
    // same-operator absorption) in `src/lib/grammar/an-rules.ts`.
    //
    // Throws only on Structural rules + entity-not-found per the
    // briefing §10 "throws stay" list: S-1 (FK soundness), S-4
    // (no-cycles), S-9 (sibling-position uniqueness — only when a
    // sibling other than the moved expression already occupies the
    // target slot; same-position no-op is tolerated).

    function permissivePremise(): PremiseEngine {
        // Use permissive behavior so we can construct multi-level shapes
        // (e.g. OR with operator children for the reparent target setup)
        // without the assistive AN post-hook re-normalizing between
        // setup calls.
        const eng = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        eng.addVariable(VAR_R)
        const { result: pe } = eng.createPremise()
        return pe
    }

    it("reparents an expression onto a new parent at the given position (happy path)", () => {
        // OR(formula(P), formula(Q)) → move expr-p to be a direct child of
        // OR at position 2.
        const pe = permissivePremise()
        pe.addExpression(makeOpExpr("or-root", "or"))
        pe.addExpression(
            makeFormulaExpr("f1", { parentId: "or-root", position: 0 })
        )
        pe.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "f1",
                position: 0,
            })
        )
        pe.addExpression(
            makeFormulaExpr("f2", { parentId: "or-root", position: 1 })
        )
        pe.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "f2",
                position: 0,
            })
        )

        const { result } = pe.reparentExpression("expr-p", "or-root", 2)
        expect(result.parentId).toBe("or-root")
        expect(result.position).toBe(2)
        const orChildren = pe.getChildExpressions("or-root")
        expect(orChildren.map((c) => c.id).sort()).toEqual([
            "expr-p",
            "f1",
            "f2",
        ])
        // f1 now has no children — expr-p moved out.
        expect(pe.getChildExpressions("f1")).toHaveLength(0)
    })

    it("supports newPosition: 0 cleanly (used by native AN-1)", () => {
        // Setup: F → OR (the formula has the OR at some non-zero
        // position). Reparent OR to position 0 under F.
        const pe = permissivePremise()
        pe.addExpression(makeFormulaExpr("f", { parentId: null }))
        pe.addExpression(
            makeOpExpr("or-1", "or", { parentId: "f", position: 5 })
        )

        const { result } = pe.reparentExpression("or-1", "f", 0)
        expect(result.position).toBe(0)
        expect(result.parentId).toBe("f")
        const children = pe.getChildExpressions("f")
        expect(children).toHaveLength(1)
        expect(children[0].id).toBe("or-1")
        expect(children[0].position).toBe(0)
    })

    it("throws when expressionId does not exist (entity-not-found)", () => {
        const pe = permissivePremise()
        pe.addExpression(makeOpExpr("and-root", "and"))
        expect(() =>
            pe.reparentExpression("does-not-exist", "and-root", 0)
        ).toThrowError(/not found in premise/)
    })

    it("throws when newParentId does not exist (S-1 FK soundness)", () => {
        const pe = permissivePremise()
        pe.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            pe.reparentExpression("expr-p", "ghost-parent", 0)
        ).toThrowError(/not found in premise/)
    })

    it("throws S-4 when newParentId === expressionId (self-parent cycle)", () => {
        const pe = permissivePremise()
        pe.addExpression(makeOpExpr("or-root", "or"))
        pe.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "or-root",
                position: 0,
            })
        )
        expect(() =>
            pe.reparentExpression("or-root", "or-root", 0)
        ).toThrowError(/S-4.*under itself/)
    })

    it("throws S-4 when newParentId is a descendant of expressionId (would create a cycle)", () => {
        // OR_outer → formula → OR_inner. Try to reparent OR_outer under
        // OR_inner — a cycle.
        const pe = permissivePremise()
        pe.addExpression(makeOpExpr("or-outer", "or"))
        pe.addExpression(
            makeFormulaExpr("f", { parentId: "or-outer", position: 0 })
        )
        pe.addExpression(
            makeOpExpr("or-inner", "or", { parentId: "f", position: 0 })
        )
        pe.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "or-inner",
                position: 0,
            })
        )
        expect(() =>
            pe.reparentExpression("or-outer", "or-inner", 1)
        ).toThrowError(/S-4.*cycle/)
    })

    it("throws S-9 when newPosition is already occupied by a different sibling", () => {
        // OR(P at 0, Q at 1). Try to reparent P to position 1 — Q
        // already there.
        const pe = permissivePremise()
        pe.addExpression(makeOpExpr("or-root", "or"))
        pe.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "or-root",
                position: 0,
            })
        )
        pe.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "or-root",
                position: 1,
            })
        )
        expect(() =>
            pe.reparentExpression("expr-p", "or-root", 1)
        ).toThrowError(/S-9.*already occupied/)
    })

    it("tolerates same-parent, same-position no-op (does not throw S-9 on its own slot)", () => {
        // expr-p is already at (or-root, 0). Reparenting it to the same
        // slot should be a no-op, not an S-9 throw. (The expression's
        // own position is not a "colliding sibling" against itself.)
        const pe = permissivePremise()
        pe.addExpression(makeOpExpr("or-root", "or"))
        pe.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "or-root",
                position: 0,
            })
        )
        const { result } = pe.reparentExpression("expr-p", "or-root", 0)
        expect(result.parentId).toBe("or-root")
        expect(result.position).toBe(0)
    })

    // D0f — P1 fix: parent-type validation gap. The D0e review surfaced
    // that `reparentExpression` did not enforce that `newParent` is an
    // `operator` or `formula` — a caller could reparent under a
    // variable (or any other non-container) and produce a malformed AST
    // that no validator catches. `addExpression` enforces this at
    // em.ts:418-422 and `reparentExpression` must reach parity. Same
    // applies to the arity guards: reparenting under a unary `not`
    // that already has its one child, or under a binary
    // `implies`/`iff` that already has its two children, must throw
    // (the move crosses parents — the new parent's child count
    // increases by one).

    it("throws when newParent is a variable expression (S-1 parent-type)", () => {
        // Setup: AND(P_var, Q_var). Try to reparent Q_var under P_var.
        // P_var is a variable — invalid parent. Pre-D0f the call
        // silently produced a malformed AST.
        const pe = permissivePremise()
        pe.addExpression(makeOpExpr("and-root", "and"))
        pe.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "and-root",
                position: 0,
            })
        )
        pe.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "and-root",
                position: 1,
            })
        )
        expect(() => pe.reparentExpression("expr-q", "expr-p", 0)).toThrowError(
            /S-1.*non-operator\/formula parent.*type=variable/
        )
    })

    it("throws S-1 arity when reparenting under a unary `not` that already has its child", () => {
        // Setup: OR(NOT(P_var), Q_var). Try to reparent Q_var under
        // NOT. NOT is unary; it already holds P_var. Reparent would
        // make NOT a binary node — must throw.
        const pe = permissivePremise()
        pe.addExpression(makeOpExpr("or-root", "or"))
        pe.addExpression(
            makeOpExpr("not-1", "not", { parentId: "or-root", position: 0 })
        )
        pe.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "not-1",
                position: 0,
            })
        )
        pe.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "or-root",
                position: 1,
            })
        )
        expect(() => pe.reparentExpression("expr-q", "not-1", 1)).toThrowError(
            /"not" can only have one child/
        )
    })

    // Note: the implies/iff arity case (2-children cap) is not
    // separately covered here because S-5 (implies/iff root-only) is
    // enforced by `addExpression` so a realistic premise cannot host
    // an implies node with siblings available to reparent into it.
    // The arity guard is shared with `addExpression`'s
    // `assertChildLimit` helper, which is independently tested via
    // the existing addExpression test suite.

    it("tolerates same-parent reparent under a full binary operator (no net count change)", () => {
        // Setup: IMPLIES(P_var at 0, Q_var at 1). Reparent Q_var to
        // position 1 under the same implies — same-parent move,
        // count unchanged. Must NOT trip the arity guard.
        const pe = permissivePremise()
        pe.addExpression(makeOpExpr("implies-root", "implies"))
        pe.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "implies-root",
                position: 0,
            })
        )
        pe.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "implies-root",
                position: 1,
            })
        )
        const { result } = pe.reparentExpression("expr-q", "implies-root", 1)
        expect(result.parentId).toBe("implies-root")
        expect(result.position).toBe(1)
    })
})

describe("PremiseEngine.wrapInFormula (D0f)", () => {
    // D0f — P2 #2 fix: S-10 enforcement gap.
    //
    // `wrapInFormula` previously routed through `registerFormulaBuffer`
    // which calls `this.expressions.set(formulaId, ...)` without a
    // `has()` check — a caller passing an already-existing id would
    // silently overwrite the prior expression, violating S-10 (entity
    // ID uniqueness). The D0e review surfaced this as a public-API
    // surface promise gap.

    function permissivePremise(): PremiseEngine {
        const eng = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pe } = eng.createPremise()
        return pe
    }

    it("throws S-10 when formulaId already exists in this premise", () => {
        // Setup: OR(P) with an existing "f-existing" formula sibling.
        // Try to wrapInFormula(P, "f-existing") — should throw S-10.
        const pe = permissivePremise()
        pe.addExpression(makeOpExpr("or-root", "or"))
        pe.addExpression(
            makeFormulaExpr("f-existing", {
                parentId: "or-root",
                position: 0,
            })
        )
        pe.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "or-root",
                position: 1,
            })
        )
        expect(() => pe.wrapInFormula("expr-p", "f-existing")).toThrowError(
            /S-10.*already exists/
        )
    })
})
