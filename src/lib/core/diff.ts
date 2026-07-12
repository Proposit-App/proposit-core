import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../schemata/index.js"
import type {
    TCoreArgumentDiff,
    TCoreDiffOptions,
    TCoreEntityFieldDiff,
    TCoreEntitySetDiff,
    TCoreFieldChange,
    TCoreFieldComparator,
    TCorePremiseDiff,
    TCorePremiseSetDiff,
    TCoreRoleDiff,
} from "../types/diff.js"
import type { ArgumentEngine } from "./argument-engine.js"

/** Compares two argument objects. Core argument only has identity fields (id, version), so no diffable fields. */
export function defaultCompareArgument(
    _before: TCoreArgument,
    _after: TCoreArgument
): TCoreFieldChange[] {
    return []
}

/** Compares two variables and returns field-level changes for `symbol` and binding-specific fields. */
export function defaultCompareVariable<
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
>(before: TVar, after: TVar): TCoreFieldChange[] {
    const changes: TCoreFieldChange[] = []

    if (before.symbol !== after.symbol) {
        changes.push({
            field: "symbol",
            before: before.symbol,
            after: after.symbol,
        })
    }

    const bindingFields = [
        "claimId",
        "claimVersion",
        "boundPremiseId",
        "boundArgumentId",
        "boundArgumentVersion",
    ] as const

    for (const field of bindingFields) {
        const bVal = (before as Record<string, unknown>)[field]
        const aVal = (after as Record<string, unknown>)[field]
        if (bVal !== aVal) {
            changes.push({ field, before: bVal, after: aVal })
        }
    }

    return changes
}

/** Compares two premises and returns field-level changes. Base premise has no diffable fields beyond identity. */
export function defaultComparePremise(
    _before: TCorePremise,
    _after: TCorePremise
): TCoreFieldChange[] {
    return []
}

/** Compares two expressions and returns field-level changes for structural fields (`type`, `parentId`, `position`, `variableId`, `operator`). */
export function defaultCompareExpression(
    before: TCorePropositionalExpression,
    after: TCorePropositionalExpression
): TCoreFieldChange[] {
    const changes: TCoreFieldChange[] = []
    if (before.type !== after.type) {
        changes.push({
            field: "type",
            before: before.type,
            after: after.type,
        })
    }
    if (before.parentId !== after.parentId) {
        changes.push({
            field: "parentId",
            before: before.parentId,
            after: after.parentId,
        })
    }
    if (before.position !== after.position) {
        changes.push({
            field: "position",
            before: before.position,
            after: after.position,
        })
    }
    if (before.type === "variable" && after.type === "variable") {
        if (before.variableId !== after.variableId) {
            changes.push({
                field: "variableId",
                before: before.variableId,
                after: after.variableId,
            })
        }
    }
    if (before.type === "operator" && after.type === "operator") {
        if (before.operator !== after.operator) {
            changes.push({
                field: "operator",
                before: before.operator,
                after: after.operator,
            })
        }
    }
    return changes
}

// ---------------------------------------------------------------------------
// Entity set diffing helpers
// ---------------------------------------------------------------------------

function diffEntitySet<T extends { id: string }>(
    beforeItems: T[],
    afterItems: T[],
    compare: TCoreFieldComparator<T>,
    matcher?: (a: T, b: T) => boolean
): TCoreEntitySetDiff<T> {
    if (!matcher) {
        const beforeById = new Map(beforeItems.map((item) => [item.id, item]))
        const afterById = new Map(afterItems.map((item) => [item.id, item]))

        const added: T[] = []
        const removed: T[] = []
        const modified: TCoreEntityFieldDiff<T>[] = []

        for (const [id, beforeItem] of beforeById) {
            const afterItem = afterById.get(id)
            if (!afterItem) {
                removed.push(beforeItem)
                continue
            }
            const changes = compare(beforeItem, afterItem)
            if (changes.length > 0) {
                modified.push({
                    before: beforeItem,
                    after: afterItem,
                    changes,
                    state: "modified-own",
                })
            }
        }

        for (const [id, afterItem] of afterById) {
            if (!beforeById.has(id)) {
                added.push(afterItem)
            }
        }

        return { added, removed, modified }
    }

    // Custom matcher-based pairing
    const added: T[] = []
    const removed: T[] = []
    const modified: TCoreEntityFieldDiff<T>[] = []
    const matchedAfterIndices = new Set<number>()

    for (const beforeItem of beforeItems) {
        const afterIndex = afterItems.findIndex(
            (afterItem, i) =>
                !matchedAfterIndices.has(i) && matcher(beforeItem, afterItem)
        )
        if (afterIndex === -1) {
            removed.push(beforeItem)
            continue
        }
        matchedAfterIndices.add(afterIndex)
        const afterItem = afterItems[afterIndex]
        const changes = compare(beforeItem, afterItem)
        if (changes.length > 0) {
            modified.push({
                before: beforeItem,
                after: afterItem,
                changes,
                state: changes.length > 0 ? "modified-own" : "modified-within",
            })
        }
    }

    for (let i = 0; i < afterItems.length; i++) {
        if (!matchedAfterIndices.has(i)) {
            added.push(afterItems[i])
        }
    }

    return { added, removed, modified }
}

function diffPremiseSet<
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
>(
    beforePremises: TPremise[],
    afterPremises: TPremise[],
    beforeExpressions: Map<string, TExpr[]>,
    afterExpressions: Map<string, TExpr[]>,
    comparePremise: TCoreFieldComparator<TPremise>,
    compareExpression: TCoreFieldComparator<TExpr>,
    premiseMatcher?: (a: TPremise, b: TPremise) => boolean,
    expressionMatcher?: (a: TExpr, b: TExpr) => boolean
): TCorePremiseSetDiff<TPremise, TExpr> {
    if (!premiseMatcher) {
        const beforeById = new Map(beforePremises.map((p) => [p.id, p]))
        const afterById = new Map(afterPremises.map((p) => [p.id, p]))

        const added: TPremise[] = []
        const removed: TPremise[] = []
        const modified: TCorePremiseDiff<TPremise, TExpr>[] = []

        for (const [id, beforePremise] of beforeById) {
            const afterPremise = afterById.get(id)
            if (!afterPremise) {
                removed.push(beforePremise)
                continue
            }
            const premiseChanges = comparePremise(beforePremise, afterPremise)
            const expressionsDiff = diffEntitySet(
                beforeExpressions.get(id) ?? [],
                afterExpressions.get(id) ?? [],
                compareExpression,
                expressionMatcher
            )
            const hasExpressionChanges =
                expressionsDiff.added.length > 0 ||
                expressionsDiff.removed.length > 0 ||
                expressionsDiff.modified.length > 0
            if (premiseChanges.length > 0 || hasExpressionChanges) {
                modified.push({
                    before: beforePremise,
                    after: afterPremise,
                    changes: premiseChanges,
                    expressions: expressionsDiff,
                    state:
                        premiseChanges.length > 0
                            ? "modified-own"
                            : "modified-within",
                })
            }
        }

        for (const [id, afterPremise] of afterById) {
            if (!beforeById.has(id)) {
                added.push(afterPremise)
            }
        }

        return { added, removed, modified }
    }

    // Custom matcher-based pairing for premises
    const added: TPremise[] = []
    const removed: TPremise[] = []
    const modified: TCorePremiseDiff<TPremise, TExpr>[] = []
    const matchedAfterIndices = new Set<number>()

    for (const beforePremise of beforePremises) {
        const afterIndex = afterPremises.findIndex(
            (afterPremise, i) =>
                !matchedAfterIndices.has(i) &&
                premiseMatcher(beforePremise, afterPremise)
        )
        if (afterIndex === -1) {
            removed.push(beforePremise)
            continue
        }
        matchedAfterIndices.add(afterIndex)
        const afterPremise = afterPremises[afterIndex]
        const premiseChanges = comparePremise(beforePremise, afterPremise)
        const expressionsDiff = diffEntitySet(
            beforeExpressions.get(beforePremise.id) ?? [],
            afterExpressions.get(afterPremise.id) ?? [],
            compareExpression,
            expressionMatcher
        )
        const hasExpressionChanges =
            expressionsDiff.added.length > 0 ||
            expressionsDiff.removed.length > 0 ||
            expressionsDiff.modified.length > 0
        if (premiseChanges.length > 0 || hasExpressionChanges) {
            modified.push({
                before: beforePremise,
                after: afterPremise,
                changes: premiseChanges,
                expressions: expressionsDiff,
                state:
                    premiseChanges.length > 0
                        ? "modified-own"
                        : "modified-within",
            })
        }
    }

    for (let i = 0; i < afterPremises.length; i++) {
        if (!matchedAfterIndices.has(i)) {
            added.push(afterPremises[i])
        }
    }

    return { added, removed, modified }
}

function diffRoles(
    beforeConclusion: string | undefined,
    afterConclusion: string | undefined
): TCoreRoleDiff {
    return {
        conclusion: { before: beforeConclusion, after: afterConclusion },
    }
}

function collectVariables<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
>(engine: ArgumentEngine<TArg, TPremise, TExpr, TVar>): TVar[] {
    const seen = new Set<string>()
    const vars: TVar[] = []
    for (const pm of engine.listPremises()) {
        for (const v of pm.getVariables()) {
            if (!seen.has(v.id)) {
                seen.add(v.id)
                vars.push(v)
            }
        }
    }
    return vars
}

// ---------------------------------------------------------------------------
// Main diff function
// ---------------------------------------------------------------------------

/**
 * Computes a structural diff between two argument engines.
 *
 * Compares argument metadata, variables, premises (with nested expression
 * diffs), and role assignments. Uses pluggable comparators that default to
 * the `defaultCompare*` functions.
 *
 * **Four-state enrichment:** Each modified entity carries a `state` field
 * discriminating `modified-own` (the entity itself changed) from
 * `modified-within` (only contained children or references changed). The
 * `modified-within` state also marks premises whose claim-bound variables
 * changed outside the premise — reference-edge propagation that surfaces
 * downstream impacts of a claim edit.
 *
 * **Id-stability contract:** The id-stability contract matters because the
 * `modified-own`/`modified-within` states are only expressible when an
 * entity's id survives a content edit; if ids churn, the diff can only
 * report add+remove. Every version-producing path must preserve the id of
 * any entity that logically persists across a version bump; mint a new id
 * only for something genuinely new; drop an id only for something genuinely
 * gone.
 */
export function diffArguments<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
>(
    engineA: ArgumentEngine<TArg, TPremise, TExpr, TVar>,
    engineB: ArgumentEngine<TArg, TPremise, TExpr, TVar>,
    options?: TCoreDiffOptions<TArg, TVar, TPremise, TExpr>
): TCoreArgumentDiff<TArg, TVar, TPremise, TExpr> {
    const argA = engineA.getArgument()
    const argB = engineB.getArgument()
    const premiseEnginesA = engineA.listPremises()
    const premiseEnginesB = engineB.listPremises()
    const premisesA = premiseEnginesA.map((pe) => pe.toPremiseData())
    const premisesB = premiseEnginesB.map((pe) => pe.toPremiseData())
    const expressionsA = new Map(
        premiseEnginesA.map((pe) => [pe.getId(), pe.getExpressions()])
    )
    const expressionsB = new Map(
        premiseEnginesB.map((pe) => [pe.getId(), pe.getExpressions()])
    )
    const rolesA = engineA.getRoleState()
    const rolesB = engineB.getRoleState()

    const compareArg =
        options?.compareArgument ??
        (defaultCompareArgument as TCoreFieldComparator<TArg>)
    const compareVar =
        options?.compareVariable ??
        (defaultCompareVariable as TCoreFieldComparator<TVar>)
    const comparePrem =
        options?.comparePremise ??
        (defaultComparePremise as TCoreFieldComparator<TPremise>)
    const compareExpr =
        options?.compareExpression ??
        (defaultCompareExpression as TCoreFieldComparator<TExpr>)

    const argumentChanges = compareArg(argA, argB)

    // Reassigning the conclusion premise is argument own-content: the
    // conclusion role is a property of the (argument, premise) pairing, not of
    // the premise. So a conclusion change makes the argument `modified-own`
    // even though `defaultCompareArgument` reports no intrinsic field changes.
    const conclusionChanged =
        rolesA.conclusionPremiseId !== rolesB.conclusionPremiseId

    const variables = diffEntitySet(
        collectVariables(engineA),
        collectVariables(engineB),
        compareVar,
        options?.variableMatcher
    )
    const premises = diffPremiseSet(
        premisesA,
        premisesB,
        expressionsA,
        expressionsB,
        comparePrem,
        compareExpr,
        options?.premiseMatcher,
        options?.expressionMatcher
    )

    propagateReferenceWithin(
        variables,
        premises,
        premisesA,
        premisesB,
        expressionsB,
        options?.premiseMatcher
    )

    return {
        argument: {
            before: argA,
            after: argB,
            changes: argumentChanges,
            // The argument node is always present, so `modified-within` is its
            // structural default when only children (or nothing) changed.
            // Emptiness is decided by the `isDiffEmpty` predicate, not by this
            // field.
            state:
                argumentChanges.length > 0 || conclusionChanged
                    ? "modified-own"
                    : "modified-within",
        },
        variables,
        premises,
        roles: diffRoles(
            rolesA.conclusionPremiseId,
            rolesB.conclusionPremiseId
        ),
    }
}

/**
 * Marks premises that reference a `modified-own` variable as
 * `modified-within`, following the reference edge
 * (variable → variable-expression → premise). A claim edit surfaces as its
 * claim-bound variable's own change; every premise whose expression tree
 * points at that variable is then a container the change reaches.
 *
 * Premises already in `premises.modified` (for their own or containment
 * reasons) are left untouched — own/containment state wins over
 * reference-within. Only matched premises get a reference-within entry; a
 * newly-added premise stays in `premises.added`.
 */
function propagateReferenceWithin<
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
>(
    variables: TCoreEntitySetDiff<TVar>,
    premises: TCorePremiseSetDiff<TPremise, TExpr>,
    premisesA: TPremise[],
    premisesB: TPremise[],
    expressionsB: Map<string, TExpr[]>,
    premiseMatcher?: (a: TPremise, b: TPremise) => boolean
): void {
    const modifiedOwnVarIds = new Set(
        variables.modified
            .filter((m) => m.state === "modified-own")
            .map((m) => m.after.id)
    )
    if (modifiedOwnVarIds.size === 0) {
        return
    }

    const beforeById = new Map(premisesA.map((p) => [p.id, p]))

    for (const afterPremise of premisesB) {
        const alreadyPresent = premises.modified.some(
            (m) => m.after.id === afterPremise.id
        )
        if (alreadyPresent) {
            continue
        }

        const referencesChangedVar = (
            expressionsB.get(afterPremise.id) ?? []
        ).some(
            (expr) =>
                expr.type === "variable" &&
                modifiedOwnVarIds.has(expr.variableId)
        )
        if (!referencesChangedVar) {
            continue
        }

        // A reference-within premise is structurally unchanged, but its diff
        // object must still carry the genuine before entity for downstream
        // rendering — pair it with the matched before-side premise.
        const beforePremise = premiseMatcher
            ? premisesA.find((a) => premiseMatcher(a, afterPremise))
            : beforeById.get(afterPremise.id)
        if (!beforePremise) {
            continue
        }

        premises.modified.push({
            before: beforePremise,
            after: afterPremise,
            changes: [],
            expressions: { added: [], removed: [], modified: [] },
            state: "modified-within",
        })
    }
}
