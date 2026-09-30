// Shared builders for the engine tests in this folder: an argument, a claim
// library, variables, expressions and premises with fixed ids.

import {
    ArgumentEngine,
    PremiseEngine,
    ClaimLibrary,
} from "../../src/lib/index"
import type {
    TClaimBoundVariable,
    TCoreArgument,
    TCorePremise,
} from "../../src/lib/schemata"
import { VariableManager } from "../../src/lib/core/variable-manager"
import type { TExpressionInput } from "../../src/lib/core/expression-manager"
import type { TOptionalChecksum } from "../../src/lib/schemata/shared"
import { POSITION_INITIAL } from "../../src/lib/utils/position"

export type TVariableInput = TOptionalChecksum<TClaimBoundVariable>

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const ARG: TOptionalChecksum<TCoreArgument> = {
    id: "arg-1",
    version: 1,
}

export function aLib() {
    const lib = new ClaimLibrary()
    lib.create({ id: "claim-default", type: "normal" })
    return lib
}

export function makeVar(
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

export function makeVarExpr(
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

export function makeOpExpr(
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

export function makeFormulaExpr(
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

export const VAR_P = makeVar("var-p", "P")
export const VAR_Q = makeVar("var-q", "Q")
export const VAR_R = makeVar("var-r", "R")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a premise (via ArgumentEngine) with P, Q, R pre-loaded.
 *
 * **Permissive build.** Under the AN post-mutation hook,
 * assistive mode collapses 0-child operators eagerly (AN-3)
 * between consecutive `addExpression` calls. The test suite below
 * builds expression trees incrementally (`addExpression(op)` then
 * `addExpression(child, parentId=op)`) and asserts the resulting
 * shape; under assistive AN the parent op would be deleted before
 * the child is attached. The fixture switches the engine to
 * `permissive` so AN does not fire during the build — tests that
 * specifically want to assert AN behavior call `engine.normalize()`
 * (or `runAssistiveNormalization(engine)` after `setBehavior('assistive')`)
 * explicitly at the end of their setup. The AN rule-set contract
 * itself is covered by `test/grammar/an-rules.test.ts` and
 * `test/grammar/auto-normalize.test.ts`.
 */
export function premiseWithVars(): PremiseEngine {
    const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
    eng.addVariable(VAR_P)
    eng.addVariable(VAR_Q)
    eng.addVariable(VAR_R)
    const { result: pm } = eng.createPremise()
    return pm
}

/** Create a PremiseEngine directly with a deterministic ID (for toData tests). */
export function makePremise(extras?: Record<string, unknown>): PremiseEngine {
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
