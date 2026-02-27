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
import type { ArgumentEngine } from "./ArgumentEngine.js"

/** Compares two argument metadata objects and returns field-level changes for `metadata.title` and `metadata.description`. */
export function defaultCompareArgument(
    before: TCoreArgument,
    after: TCoreArgument
): TCoreFieldChange[] {
    const changes: TCoreFieldChange[] = []
    if (before.metadata.title !== after.metadata.title) {
        changes.push({
            field: "metadata.title",
            before: before.metadata.title,
            after: after.metadata.title,
        })
    }
    if (before.metadata.description !== after.metadata.description) {
        changes.push({
            field: "metadata.description",
            before: before.metadata.description,
            after: after.metadata.description,
        })
    }
    return changes
}

/** Compares two variables and returns field-level changes for `symbol` and `metadata`. */
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
    if (JSON.stringify(before.metadata) !== JSON.stringify(after.metadata)) {
        changes.push({
            field: "metadata",
            before: before.metadata,
            after: after.metadata,
        })
    }
    return changes
}

/** Compares two premises and returns field-level changes for `metadata.title` and `rootExpressionId`. */
export function defaultComparePremise(
    before: TCorePremise,
    after: TCorePremise
): TCoreFieldChange[] {
    const changes: TCoreFieldChange[] = []
    if (before.metadata.title !== after.metadata.title) {
        changes.push({
            field: "metadata.title",
            before: before.metadata.title,
            after: after.metadata.title,
        })
    }
    if (before.rootExpressionId !== after.rootExpressionId) {
        changes.push({
            field: "rootExpressionId",
            before: before.rootExpressionId,
            after: after.rootExpressionId,
        })
    }
    return changes
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

function diffPremiseSet(
    beforePremises: TCorePremise[],
    afterPremises: TCorePremise[],
    comparePremise: TCoreFieldComparator<TCorePremise>,
    compareExpression: TCoreFieldComparator<TCorePropositionalExpression>
): TCorePremiseSetDiff {
    const beforeById = new Map(beforePremises.map((p) => [p.id, p]))
    const afterById = new Map(afterPremises.map((p) => [p.id, p]))

    const added: TCorePremise[] = []
    const removed: TCorePremise[] = []
    const modified: TCorePremiseDiff[] = []

    for (const [id, beforePremise] of beforeById) {
        const afterPremise = afterById.get(id)
        if (!afterPremise) {
            removed.push(beforePremise)
            continue
        }
        const premiseChanges = comparePremise(beforePremise, afterPremise)
        const expressionsDiff = diffEntitySet(
            beforePremise.expressions,
            afterPremise.expressions,
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
    afterConclusion: string | undefined,
    beforeSupporting: string[],
    afterSupporting: string[]
): TCoreRoleDiff {
    const beforeSet = new Set(beforeSupporting)
    const afterSet = new Set(afterSupporting)
    return {
        conclusion: { before: beforeConclusion, after: afterConclusion },
        supportingAdded: afterSupporting.filter((id) => !beforeSet.has(id)),
        supportingRemoved: beforeSupporting.filter((id) => !afterSet.has(id)),
    }
}

function collectVariables(
    engine: ArgumentEngine
): TCorePropositionalVariable[] {
    const seen = new Set<string>()
    const vars: TCorePropositionalVariable[] = []
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
export function diffArguments(
    engineA: ArgumentEngine,
    engineB: ArgumentEngine,
    options?: TCoreDiffOptions
): TCoreArgumentDiff {
    const dataA = engineA.toData()
    const dataB = engineB.toData()

    const compareArg = options?.compareArgument ?? defaultCompareArgument
    const compareVar = options?.compareVariable ?? defaultCompareVariable
    const comparePrem = options?.comparePremise ?? defaultComparePremise
    const compareExpr = options?.compareExpression ?? defaultCompareExpression

    const argumentChanges = compareArg(dataA.argument, dataB.argument)

    return {
        argument: {
            before: dataA.argument,
            after: dataB.argument,
            changes: argumentChanges,
        },
        variables: diffEntitySet(
            collectVariables(engineA),
            collectVariables(engineB),
            compareVar
        ),
        premises: diffPremiseSet(
            dataA.premises,
            dataB.premises,
            comparePrem,
            compareExpr
        ),
        roles: diffRoles(
            dataA.roles.conclusionPremiseId,
            dataB.roles.conclusionPremiseId,
            dataA.roles.supportingPremiseIds,
            dataB.roles.supportingPremiseIds
        ),
    }
}
