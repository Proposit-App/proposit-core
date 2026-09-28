import {
    isClaimBound,
    type TCoreArgument,
    type TCoreClaim,
    type TCoreDerivationPremise,
    type TCorePremise,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
    type TClaimBoundVariable,
} from "../../schemata/index.js"
import { AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN } from "../../types/validation.js"
import { evaluateSubtree } from "../evaluation/argument-evaluation.js"
import { InvariantViolationError } from "../invariant-violation-error.js"
import type { TCoreVariableAssignment } from "../../types/evaluation.js"
import type { TClaimLookup } from "../interfaces/index.js"
import type { PremiseEngine } from "../premise-engine.js"
import type { VariableManager } from "../variable-manager.js"

// How an argument's variables relate to the claims they are bound to, and
// the truth values that follow from each claim's type. Two sets are kept
// apart on purpose: "grounded" (citation or axiomatic) and "axiomatic" only;
// the comments on the functions below say which caller needs which.

/**
 * What these functions read from an `ArgumentEngine`, built by the engine
 * for each call.
 */
export type TClaimVariableContext<
    TVar extends TCorePropositionalVariable,
    TClaim extends TCoreClaim,
> = {
    variables: VariableManager<TVar>
    claimLibrary: TClaimLookup<TClaim>
}

/**
 * Walks `ctx.variables.toArray()` once and returns every claim-bound
 * variable whose bound claim has type `"axiomatic"`. Shared between
 * `applyAxiomaticForcedAssignments` (the evaluate-time pre-pass) and
 * `getAxiomaticBoundVariableIds` (the checkValidity carve-out).
 */
export function collectAxiomaticBoundVariables<
    TVar extends TCorePropositionalVariable,
    TClaim extends TCoreClaim,
>(ctx: TClaimVariableContext<TVar, TClaim>): TClaimBoundVariable[] {
    const out: TClaimBoundVariable[] = []
    for (const variable of ctx.variables.toArray()) {
        const v = variable as unknown as TCorePropositionalVariable
        if (!isClaimBound(v)) continue
        const claimBound = v as unknown as TClaimBoundVariable
        const claim = ctx.claimLibrary.get(
            claimBound.claimId,
            claimBound.claimVersion
        )
        if (claim?.type === "axiomatic") out.push(claimBound)
    }
    return out
}

/**
 * For each claim-bound variable in this argument, look up the bound claim's
 * type. If the type is "axiomatic":
 *   - Reject any caller-provided assignment for the variable
 *     (AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN). Key presence is checked via
 *     `Object.hasOwn` so an explicit `undefined` value is also rejected.
 *   - Force the variable's effective assignment to `true`.
 * Returns the rewritten assignment map; non-axiomatic variables pass through.
 */
export function applyAxiomaticForcedAssignments<
    TVar extends TCorePropositionalVariable,
    TClaim extends TCoreClaim,
>(
    ctx: TClaimVariableContext<TVar, TClaim>,
    callerVariables: TCoreVariableAssignment
): TCoreVariableAssignment {
    const effective: TCoreVariableAssignment = { ...callerVariables }
    for (const claimBound of collectAxiomaticBoundVariables(ctx)) {
        if (Object.hasOwn(callerVariables, claimBound.id)) {
            throw new InvariantViolationError([
                {
                    code: AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN,
                    message: `${AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN}: Cannot assign axiomatic-bound variable "${claimBound.id}" (claim "${claimBound.claimId}"). Axiomatic variables are always true. To reject an axiom's contribution to a specific derivation, negate its variable expression in the antecedent.`,
                    entityType: "variable",
                    entityId: claimBound.id,
                },
            ])
        }
        effective[claimBound.id] = true
    }
    return effective
}

/**
 * Returns IDs of claim-bound variables whose bound claim has type
 * `"axiomatic"` — these are forced-true at evaluation time.
 */
export function getAxiomaticBoundVariableIds<
    TVar extends TCorePropositionalVariable,
    TClaim extends TCoreClaim,
>(ctx: TClaimVariableContext<TVar, TClaim>): Set<string> {
    return new Set(collectAxiomaticBoundVariables(ctx).map((v) => v.id))
}

/**
 * Returns IDs of every grounded claim-bound variable — axiomatic *and*
 * citation — for `checkValidity`'s carve-out.
 *
 * Deliberately wider than `getAxiomaticBoundVariableIds`, and the two must
 * stay separate. Validity asks a structural question about the argument and
 * generates its own rows, so a cited claim is what its source says: it gets
 * no free column and is pinned true. Evaluation asks the *reader's*
 * question, where a citation is merely seeded true by the default
 * assignment and the reader may assign it either way — so
 * `applyAxiomaticForcedAssignments` keeps the narrow set. Widening that
 * pre-pass to this one would make a reader's assignment on any
 * citation-backed claim throw `AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN`.
 */
export function getGroundedBoundVariableIds<
    TVar extends TCorePropositionalVariable,
    TClaim extends TCoreClaim,
>(ctx: TClaimVariableContext<TVar, TClaim>): Set<string> {
    const out = new Set<string>()
    for (const variable of ctx.variables.toArray()) {
        const base = variable as unknown as TCorePropositionalVariable
        if (isGroundedVariable(ctx, base)) out.add(variable.id)
    }
    return out
}

/**
 * Returns `true` iff the variable is claim-bound to a citation or
 * axiomatic claim — the "grounded" claim types that a default assignment
 * seeds `true`.
 *
 * Two callers, and they are not interchangeable with the narrower
 * axiomatic-only collector: the default assignment seeds every grounded
 * variable `true`, and `checkValidity` excludes every grounded variable
 * from its enumeration. Evaluation's forced-assignment pre-pass uses the
 * *narrow* set on purpose — grounded is not the same as unassignable.
 */
export function isGroundedVariable<
    TVar extends TCorePropositionalVariable,
    TClaim extends TCoreClaim,
>(
    ctx: TClaimVariableContext<TVar, TClaim>,
    variable: TCorePropositionalVariable
): boolean {
    if (!isClaimBound(variable)) return false
    const cb = variable as unknown as TClaimBoundVariable
    const claim = ctx.claimLibrary.get(cb.claimId, cb.claimVersion)
    return claim?.type === "citation" || claim?.type === "axiomatic"
}

/** Every claim-bound variable bound to `claimId`, in variable order. */
export function getVariableIdsForClaim<
    TVar extends TCorePropositionalVariable,
    TClaim extends TCoreClaim,
>(ctx: TClaimVariableContext<TVar, TClaim>, claimId: string): string[] {
    const ids: string[] = []
    for (const variable of ctx.variables.toArray()) {
        const base = variable as unknown as TCorePropositionalVariable
        if (
            isClaimBound(base) &&
            (base as unknown as TClaimBoundVariable).claimId === claimId
        ) {
            ids.push(variable.id)
        }
    }
    return ids
}

/** The claim a claim-bound variable is bound to, if it is one. */
export function getClaimIdForVariable<
    TVar extends TCorePropositionalVariable,
    TClaim extends TCoreClaim,
>(
    ctx: TClaimVariableContext<TVar, TClaim>,
    variableId: string
): string | undefined {
    const variable = ctx.variables.getVariable(variableId)
    if (variable === undefined) return undefined
    const base = variable as unknown as TCorePropositionalVariable
    if (!isClaimBound(base)) return undefined
    return (base as unknown as TClaimBoundVariable).claimId
}

/**
 * The default assignment `ArgumentEngine.deriveDefaultAssignment` documents,
 * over `premises` (the engine's premise list, read by the caller).
 */
export function deriveDefaultAssignment<
    TArg extends TCoreArgument,
    TPremise extends TCorePremise,
    TExpr extends TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable,
    TClaim extends TCoreClaim,
>(
    ctx: TClaimVariableContext<TVar, TClaim>,
    premises: PremiseEngine<TArg, TPremise, TExpr, TVar>[]
): TCoreVariableAssignment {
    // Index each derivation premise by the claim it derives, so a normal
    // claim's immediate support is a one-pass lookup.
    const derivationByClaimId = new Map<
        string,
        PremiseEngine<TArg, TPremise, TExpr, TVar>
    >()
    for (const pm of premises) {
        const data = pm.toPremiseData() as unknown as TCorePremise
        if (data.type === "derivation") {
            derivationByClaimId.set(
                (data as unknown as TCoreDerivationPremise).derivedClaimId,
                pm
            )
        }
    }

    // One global seed evaluates every antecedent: grounded variables are
    // `true`, everything else `null`. Because non-grounded (incl. normal)
    // variables stay `null` here, evaluating an antecedent inspects only
    // its immediate claims' types — never their own supports.
    const seed: TCoreVariableAssignment = {}
    for (const variable of ctx.variables.toArray()) {
        const base = variable as unknown as TCorePropositionalVariable
        seed[variable.id] = isGroundedVariable(ctx, base) ? true : null
    }

    const result: TCoreVariableAssignment = {}
    for (const variable of ctx.variables.toArray()) {
        const base = variable as unknown as TCorePropositionalVariable
        if (isGroundedVariable(ctx, base)) {
            result[variable.id] = true
            continue
        }
        // Default to unknown; upgrade to `true` only for a normal claim
        // whose derivation antecedent is grounded.
        result[variable.id] = null
        if (!isClaimBound(base)) continue
        const claimId = (base as unknown as TClaimBoundVariable).claimId
        const pm = derivationByClaimId.get(claimId)
        if (pm === undefined) continue
        const root = pm.getRootExpression()
        if (root?.type !== "operator") continue
        const operator = (
            root as unknown as TCorePropositionalExpression<"operator">
        ).operator
        if (operator !== "implies" && operator !== "iff") continue
        // `getChildExpressions` returns children sorted by position, so the
        // first is the antecedent slot and the last is the consequent
        // (matching `validateDerivationStructure`). A well-formed
        // derivation root has arity 2; anything short of that is malformed
        // mid-edit and grounds nothing.
        const children = pm.getChildExpressions(root.id)
        if (children.length < 2) continue
        const antecedent = children[0]
        const antecedentValue = evaluateSubtree(
            antecedent.id,
            (id) => pm.getExpression(id),
            (parentId) => pm.getChildExpressions(parentId),
            seed
        )
        if (antecedentValue === true) result[variable.id] = true
    }
    return result
}
