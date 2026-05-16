// Evaluable-tier validators (E-1, E-3..E-7). Code 'E-2' is reserved — see
// spec §4.2 (formula non-emptiness was promoted to Structural as S-13).
//
// E-1  variadic operator arity floor (and/or have ≥ 2 children)
// E-3  variable binding resolves
// E-4  axiomatic-binding constraint (runtime guard; AST-level no-op,
//      documented in JSDoc)
// E-5  derivation premise consequent present
// E-6  claim-derivation pairing (≤ 1 derivation premise per normal claim)
// E-7  argument has conclusion premise

import type { TViolation } from "../types.js"
import type { TValidatorContext } from "./context.js"
import { isClaimBound, isPremiseBound } from "../../schemata/propositional.js"

/**
 * Build a Map<parentId, child-count> view of the expression tree.
 * Used by the variadic-arity validator E-1.
 */
function childCounts(
    expressions: readonly TValidatorContext["expressions"][number][]
): Map<string, number> {
    const out = new Map<string, number>()
    for (const e of expressions) {
        if (e.parentId === null) continue
        out.set(e.parentId, (out.get(e.parentId) ?? 0) + 1)
    }
    return out
}

/**
 * E-1 — Variadic operator arity floor. `and` and `or` each have at least
 * two children. (Unary `not`/`formula` are constrained Structurally per
 * S-12/S-13; binary `implies`/`iff` per S-8.)
 */
export function validateE1(ctx: TValidatorContext): readonly TViolation[] {
    const violations: TViolation[] = []
    const counts = childCounts(ctx.expressions)
    for (const e of ctx.expressions) {
        if (e.type !== "operator") continue
        if (e.operator !== "and" && e.operator !== "or") continue
        const count = counts.get(e.id) ?? 0
        if (count < 2) {
            violations.push({
                tier: "evaluable",
                code: "E-1",
                message: `${e.operator} expression ${e.id} has ${count} children (variadic operator requires ≥ 2)`,
                argumentId: ctx.argument.id,
                premiseId: e.premiseId,
                expressionId: e.id,
            })
        }
    }
    return violations
}

// 'E-2' reserved — not used.

/**
 * E-3 — Variable binding resolves. Every variable's claim or premise
 * reference points at an existing target. External premise bindings
 * (`boundArgumentId !== argument.id`) resolve in a different argument
 * and are out of scope here — those targets aren't in this context.
 */
export function validateE3(ctx: TValidatorContext): readonly TViolation[] {
    const violations: TViolation[] = []
    const premiseIds = new Set(ctx.premises.map((p) => p.id))
    const claimIds = new Set(ctx.claims.map((c) => c.id))
    for (const v of ctx.variables) {
        const variableId = v.id
        if (isClaimBound(v)) {
            if (!claimIds.has(v.claimId)) {
                violations.push({
                    tier: "evaluable",
                    code: "E-3",
                    message: `variable ${variableId} claim binding ${v.claimId} does not resolve`,
                    argumentId: ctx.argument.id,
                    variableId,
                    claimId: v.claimId,
                })
            }
        } else if (isPremiseBound(v)) {
            if (
                v.boundArgumentId === ctx.argument.id &&
                !premiseIds.has(v.boundPremiseId)
            ) {
                violations.push({
                    tier: "evaluable",
                    code: "E-3",
                    message: `variable ${variableId} premise binding ${v.boundPremiseId} does not resolve`,
                    argumentId: ctx.argument.id,
                    variableId,
                    premiseId: v.boundPremiseId,
                })
            }
        }
    }
    return violations
}

/**
 * E-4 — Axiomatic-binding constraint. Axiomatic-bound variables must not
 * be assigned in the caller's evaluation input. This is a **runtime
 * guard** on caller-supplied input, not an AST invariant — the check
 * runs inside `ArgumentEngine.evaluate` / `.checkValidity` and rejects
 * pre-flight with the engine-error code `AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN`.
 * The AST-level validator cannot detect E-4 from the argument tree alone
 * and intentionally returns an empty array.
 */
export function validateE4(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}

/**
 * E-5 — Derivation premise consequent present. Every `type='derivation'`
 * premise's expression tree includes a variable bound to its
 * `derivedClaimId`. Naked-Q satisfies this (the lone variable at the
 * root *is* the consequent).
 */
export function validateE5(ctx: TValidatorContext): readonly TViolation[] {
    const violations: TViolation[] = []
    // Build variable lookup: variableId → claimId (for claim-bound only).
    const varToClaim = new Map<string, string>()
    for (const v of ctx.variables) {
        if (isClaimBound(v)) varToClaim.set(v.id, v.claimId)
    }
    // Group expressions by premise.
    const exprsByPremise = new Map<string, (typeof ctx.expressions)[number][]>()
    for (const e of ctx.expressions) {
        const list = exprsByPremise.get(e.premiseId) ?? []
        list.push(e)
        exprsByPremise.set(e.premiseId, list)
    }
    for (const p of ctx.premises) {
        if (p.type !== "derivation") continue
        const exprs = exprsByPremise.get(p.id) ?? []
        const hasConsequent = exprs.some(
            (e) =>
                e.type === "variable" &&
                varToClaim.get(e.variableId) === p.derivedClaimId
        )
        if (!hasConsequent) {
            violations.push({
                tier: "evaluable",
                code: "E-5",
                message: `derivation premise ${p.id} has no variable bound to derivedClaimId ${p.derivedClaimId}`,
                argumentId: ctx.argument.id,
                premiseId: p.id,
                claimId: p.derivedClaimId,
            })
        }
    }
    return violations
}

/**
 * E-6 — Claim-derivation pairing. For every `type='normal'` claim
 * referenced in the argument, at most one `type='derivation'` premise
 * exists with `derivedClaimId` matching that claim. Zero is valid (the
 * post-publish-pruning state); two or more is the violation.
 */
export function validateE6(ctx: TValidatorContext): readonly TViolation[] {
    const violations: TViolation[] = []
    const byDerivedClaim = new Map<string, string[]>()
    for (const p of ctx.premises) {
        if (p.type !== "derivation") continue
        const list = byDerivedClaim.get(p.derivedClaimId) ?? []
        list.push(p.id)
        byDerivedClaim.set(p.derivedClaimId, list)
    }
    for (const [claimId, premiseIds] of byDerivedClaim) {
        if (premiseIds.length > 1) {
            // Every premise in a >1-group is in violation — "at most one"
            // has no canonical "first" that's correct and the rest wrong.
            // Consumers wanting first-wins can dedupe by claimId at the UI
            // layer. Matches the parallel decision in S-5 (root-only
            // IMPLIES/IFF) from the B1 review polish.
            for (const offendingId of premiseIds) {
                violations.push({
                    tier: "evaluable",
                    code: "E-6",
                    message: `claim ${claimId} has ${premiseIds.length} derivation premises (expected ≤ 1; offender: ${offendingId})`,
                    argumentId: ctx.argument.id,
                    premiseId: offendingId,
                    claimId,
                })
            }
        }
    }
    return violations
}

/**
 * E-7 — Argument has conclusion premise. An argument that has at least
 * one premise has exactly one premise designated as the conclusion via
 * `roleState.conclusionPremiseId`. A brand-new argument with zero
 * premises is exempt.
 *
 * As of 1.0.2 the engine itself guards the "non-empty argument always
 * has a conclusion" invariant at the mutation surface: the public
 * paths that previously let callers clear or remove the conclusion
 * out from under a non-empty argument (`clearConclusionPremise`,
 * `removePremise` on the current conclusion when others remain) now
 * no-op or auto-promote rather than break the invariant. E-7 stays
 * as the validate-time safety net for snapshot loads and direct
 * data-shape construction — paths the engine cannot guard at
 * mutation time.
 */
export function validateE7(ctx: TValidatorContext): readonly TViolation[] {
    if (ctx.premises.length === 0) return []
    const conclusionId = ctx.roleState.conclusionPremiseId
    if (conclusionId === undefined) {
        return [
            {
                tier: "evaluable",
                code: "E-7",
                message: "argument has premises but no conclusion designated",
                argumentId: ctx.argument.id,
            },
        ]
    }
    const found = ctx.premises.some((p) => p.id === conclusionId)
    if (!found) {
        return [
            {
                tier: "evaluable",
                code: "E-7",
                message: `conclusionPremiseId ${conclusionId} does not match any premise`,
                argumentId: ctx.argument.id,
                premiseId: conclusionId,
            },
        ]
    }
    return []
}

export function validateEvaluable(
    ctx: TValidatorContext
): readonly TViolation[] {
    return [
        ...validateE1(ctx),
        ...validateE3(ctx),
        ...validateE4(ctx),
        ...validateE5(ctx),
        ...validateE6(ctx),
        ...validateE7(ctx),
    ]
}
