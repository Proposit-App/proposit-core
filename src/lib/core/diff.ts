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

/** Compares two variables and returns field-level changes for `symbol`. */
export function defaultCompareVariable(
    before: TCorePropositionalVariable,
    after: TCorePropositionalVariable
): TCoreFieldChange[] {
    const changes: TCoreFieldChange[] = []
    if (before.symbol !== after.symbol) {
        changes.push({
            field: "symbol",
            before: before.symbol,
            after: after.symbol,
        })
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
    compare: TCoreFieldComparator<T>
): TCoreEntitySetDiff<T> {
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
            modified.push({ before: beforeItem, after: afterItem, changes })
        }
    }

    for (const [id, afterItem] of afterById) {
        if (!beforeById.has(id)) {
            added.push(afterItem)
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
    compareExpression: TCoreFieldComparator<TExpr>
): TCorePremiseSetDiff<TPremise, TExpr> {
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
            compareExpression
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

    return {
        argument: {
            before: argA,
            after: argB,
            changes: argumentChanges,
        },
        variables: diffEntitySet(
            collectVariables(engineA),
            collectVariables(engineB),
            compareVar
        ),
        premises: diffPremiseSet(
            premisesA,
            premisesB,
            expressionsA,
            expressionsB,
            comparePrem,
            compareExpr
        ),
        roles: diffRoles(
            rolesA.conclusionPremiseId,
            rolesB.conclusionPremiseId
        ),
        sources: { added: [], removed: [], modified: [] },
        variableSourceAssociations: { added: [], removed: [], modified: [] },
        expressionSourceAssociations: { added: [], removed: [], modified: [] },
    }
}
