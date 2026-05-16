// Targeted repair primitives per spec §7.
//
// Each primitive is a **user-initiated** destructive fix for a specific
// Evaluable or Derivable violation that `normalize()` cannot resolve
// (because resolution would change argument meaning — deleting a
// variable, dropping a claim reference, removing a duplicate premise).
//
// All primitives:
//  - Discover violations via `engine.validate(tier)` filtered by code.
//  - Apply the repair via the engine's structural mutation primitives.
//  - **Respect `engine.behavior`** — AN runs after each mutation in
//    `'assistive'` mode (via the mutation's own post-hook), doesn't run
//    in `'permissive'` mode.
//  - Return the violations they resolved (for UX confirmation / undo
//    messaging / "we made these N changes" feedback).
//
// Primitives never auto-run. The UI invokes them only after the user
// has explicitly accepted the destructive fix.

import type { ArgumentEngine } from "../core/argument-engine.js"
import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TCoreClaim,
} from "../schemata/index.js"
import { isClaimBound } from "../schemata/index.js"
import type { TViolation } from "./types.js"

/**
 * Resolve E-3 (variable binding doesn't resolve) by deleting each
 * offending variable. `engine.removeVariable()` cascades: it removes
 * the variable record AND every variable-expression referencing it
 * across all premises, collapsing operator parents as necessary.
 *
 * In `'assistive'` mode, the per-mutation AN post-hook fires after
 * each removeVariable call. In `'permissive'`, no AN runs.
 *
 * @since 1.0.0
 */
export function removeUnresolvableVariables<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TClaim extends TCoreClaim = TCoreClaim,
>(
    engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TClaim>
): readonly TViolation[] {
    const violations = engine
        .validate("evaluable")
        .filter((v) => v.code === "E-3")
    const seen = new Set<string>()
    for (const v of violations) {
        const variableId = v.variableId
        if (typeof variableId !== "string") continue
        if (seen.has(variableId)) continue
        seen.add(variableId)
        engine.removeVariable(variableId)
    }
    return violations
}

/**
 * Resolve E-1 (and/or with < 2 children) by cleaning up the orphan
 * operators. Delegates to `engine.normalize()`'s AN-3 pass, which
 * deletes empty operators and promotes single-child operators in a
 * non-meaning-changing way. The primitive exists alongside normalize()
 * so the UI can present a focused "Remove N orphan operators" action
 * with a precise return value (which violations it resolved).
 *
 * `engine.normalize()` bypasses `behavior` — even in permissive mode
 * the cleanup runs. This matches the UI flow: the user has already
 * accepted the deletion when they clicked the repair button.
 *
 * @since 1.0.0
 */
export function removeOrphanOperators<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TClaim extends TCoreClaim = TCoreClaim,
>(
    engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TClaim>
): readonly TViolation[] {
    const violations = engine
        .validate("evaluable")
        .filter((v) => v.code === "E-1")
    if (violations.length === 0) return violations
    engine.normalize()
    return violations
}

/**
 * Resolve E-6 (claim has > 1 derivation premise) by keeping one
 * premise per `derivedClaimId` and deleting the others. Strategy
 * controls which premise is kept:
 *
 *  - `'keep-first'` (default): keep the premise with the lexicographically
 *    smallest id; delete the rest. Deterministic and snapshot-stable.
 *  - `'keep-largest-antecedent'`: keep the premise whose antecedent
 *    subtree has the most claim-bound variable expressions. Ties are
 *    broken by lexicographic id. Useful when the user wants the more
 *    informative derivation retained.
 *
 * `engine.removePremise()` cascades: it deletes the premise, its
 * expressions, and any premise-bound variables that reference it.
 *
 * @since 1.0.0
 */
export function removeDuplicateDerivationPremises<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TClaim extends TCoreClaim = TCoreClaim,
>(
    engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TClaim>,
    strategy: "keep-first" | "keep-largest-antecedent" = "keep-first"
): readonly TViolation[] {
    const violations = engine
        .validate("evaluable")
        .filter((v) => v.code === "E-6")
    if (violations.length === 0) return violations

    // E-6 reports every member of a >1-group; collect distinct premise
    // ids per claimId.
    const byClaim = new Map<string, Set<string>>()
    for (const v of violations) {
        const claimId = v.claimId
        const premiseId = v.premiseId
        if (typeof claimId !== "string" || typeof premiseId !== "string") {
            continue
        }
        const set = byClaim.get(claimId) ?? new Set<string>()
        set.add(premiseId)
        byClaim.set(claimId, set)
    }

    for (const [, premiseIdSet] of byClaim) {
        const premiseIds = [...premiseIdSet]
        let keep: string
        if (strategy === "keep-largest-antecedent") {
            keep = pickLargestAntecedent(engine, premiseIds)
        } else {
            keep = [...premiseIds].sort()[0]
        }
        for (const id of premiseIds) {
            if (id === keep) continue
            engine.removePremise(id)
        }
    }
    return violations
}

/**
 * Resolve D-3 (mixed-grounding antecedent: axioms + citations in one
 * derivation premise) by deleting every axiom-bound variable expression
 * from the antecedent subtree, leaving citations behind. Mirrors the
 * v1.0 migration repair (spec §9.2) for runtime use when an
 * advanced-mode user reaches a mixed state in a permissive engine.
 *
 * In `'assistive'` mode, the per-mutation AN post-hook runs after each
 * expression removal, which may collapse the resulting OR (AN-3) if
 * fewer than two siblings remain after the deletes. In `'permissive'`
 * the OR may end up with a single child (an E-1 / D-2 violation —
 * follow up with `removeOrphanOperators()` if desired).
 *
 * @since 1.0.0
 */
export function dropAxiomsFromMixedAntecedent<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TClaim extends TCoreClaim = TCoreClaim,
>(
    engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TClaim>
): readonly TViolation[] {
    const violations = engine
        .validate("derivable")
        .filter((v) => v.code === "D-3")
    if (violations.length === 0) return violations

    // For each D-3 violation, walk the offending antecedent subtree
    // and delete every variable expression whose backing claim is
    // axiomatic. Claim type is resolved via the engine's claim library
    // through `engine.getClaim(id, version)`.
    for (const v of violations) {
        const premiseId = v.premiseId
        const antecedentExprId = v.expressionId
        if (
            typeof premiseId !== "string" ||
            typeof antecedentExprId !== "string"
        ) {
            continue
        }
        const pe = engine.listPremises().find((p) => p.getId() === premiseId)
        if (pe === undefined) continue
        const exprs = pe.getExpressions()
        const childMap = new Map<string, TCorePropositionalExpression[]>()
        for (const e of exprs) {
            if (e.parentId === null) continue
            const list = childMap.get(e.parentId) ?? []
            list.push(e as unknown as TCorePropositionalExpression)
            childMap.set(e.parentId, list)
        }
        // DFS the antecedent subtree; collect variable expressions whose
        // backing claim resolves to type === 'axiomatic'.
        const toRemove: string[] = []
        const stack: string[] = [antecedentExprId]
        while (stack.length > 0) {
            const cursor = stack.pop()!
            const cursorExpr = exprs.find((e) => e.id === cursor)
            if (cursorExpr?.type === "variable") {
                const variable = engine.getVariable(cursorExpr.variableId)
                if (variable !== undefined && isClaimBound(variable)) {
                    const claim = lookupClaim(
                        engine,
                        variable.claimId,
                        variable.claimVersion
                    )
                    if (claim?.type === "axiomatic") {
                        toRemove.push(cursorExpr.id)
                    }
                }
            }
            const kids = childMap.get(cursor) ?? []
            for (const k of kids) stack.push(k.id)
        }
        // Delete the axiom-bound variable expressions. Use deleteSubtree
        // = false because a variable expression is a leaf.
        for (const exprId of toRemove) {
            pe.removeExpression(exprId, false)
        }
    }

    return violations
}

/**
 * Pick the premise (from `premiseIds`) whose antecedent subtree
 * contains the most claim-bound variable expressions. Ties broken
 * lexicographically by id for determinism.
 */
function pickLargestAntecedent<
    TArg extends TCoreArgument,
    TPremise extends TCorePremise,
    TExpr extends TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable,
    TClaim extends TCoreClaim,
>(
    engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TClaim>,
    premiseIds: readonly string[]
): string {
    let best: string | undefined
    let bestSize = -1
    const sortedIds = [...premiseIds].sort()
    for (const id of sortedIds) {
        const pe = engine.listPremises().find((p) => p.getId() === id)
        if (pe === undefined) continue
        const exprs = pe.getExpressions()
        const root = exprs.find((e) => e.parentId === null)
        let antecedentSize = 0
        if (
            root?.type === "operator" &&
            (root.operator === "implies" || root.operator === "iff")
        ) {
            // Count variable expressions whose ancestor chain reaches the
            // position-0 child of the implies/iff root.
            //
            // Note (1.0.2): S-8 relaxed to arity-only — binary children
            // may now sit at any `[a, b]` with `a < b` (e.g.,
            // midpoint-spaced `[0, 1073741823]`). This `position === 0`
            // lookup is therefore brittle in principle: a producer that
            // wrote non-zero positions would cause this to miss the
            // antecedent. In practice this function is reached only
            // from `removeDuplicateDerivationPremises` with
            // `strategy: 'keep-largest-antecedent'`, and the antecedent
            // subtree under inspection was built by
            // `populateFromCitations` / `populateFromAxioms`
            // (`populate-from.ts`), which writes literal `position: 0`
            // for the implies antecedent. The dependency on that
            // writer's choice is intentional; if the populated-form
            // writer ever switches to midpoint spacing, replace this
            // with the position-sorted `kids[0]` pattern used by
            // `validateD1` (`validators/derivable.ts`).
            const antecedent = exprs.find(
                (e) => e.parentId === root.id && e.position === 0
            )
            if (antecedent !== undefined) {
                const stack: string[] = [antecedent.id]
                while (stack.length > 0) {
                    const cursor = stack.pop()!
                    const cursorExpr = exprs.find((e) => e.id === cursor)
                    if (cursorExpr?.type === "variable") {
                        antecedentSize++
                    }
                    for (const c of exprs) {
                        if (c.parentId === cursor) stack.push(c.id)
                    }
                }
            }
        }
        if (antecedentSize > bestSize) {
            bestSize = antecedentSize
            best = id
        }
    }
    return best ?? sortedIds[0]
}

/**
 * Resolve a claim record by `(id, version)` from the engine's claim
 * library. We piggyback on `engine.validate('evaluable')`'s context
 * construction — which already does this lookup — by walking variables
 * to find one bound to `claimId/claimVersion` and reaching for the
 * resolved claim via the validator-context shape.
 *
 * Simpler approach: a future `engine.getClaim(id, version)` accessor
 * would clean this up. For v1.0 we route through the public surface.
 */
function lookupClaim<
    TArg extends TCoreArgument,
    TPremise extends TCorePremise,
    TExpr extends TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable,
    TClaim extends TCoreClaim,
>(
    engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TClaim>,
    claimId: string,
    claimVersion: number
): TCoreClaim | undefined {
    return engine.getClaim(claimId, claimVersion) as TCoreClaim | undefined
}
