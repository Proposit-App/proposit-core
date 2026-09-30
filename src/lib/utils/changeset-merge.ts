import type {
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TCorePremise,
} from "../schemata/propositional.js"
import type { TCoreArgument } from "../schemata/argument.js"
import type { TCoreEntityChanges, TCoreChangeset } from "../types/mutation.js"

/**
 * Replaces each added and modified expression and premise with its current
 * value, as the lookups return it (a copy); entries a lookup does not find,
 * and every removed entry, are kept as they are. A changeset built over
 * several steps can hold an entry whose checksums a later step changed.
 */
export function withCurrentEntries<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TPremise extends TCorePremise = TCorePremise,
    TArg extends TCoreArgument = TCoreArgument,
>(
    changes: TCoreChangeset<TExpr, TVar, TPremise, TArg>,
    currentExpression: (id: string) => TExpr | undefined,
    currentPremise: (id: string) => TPremise | undefined
): TCoreChangeset<TExpr, TVar, TPremise, TArg> {
    const out = { ...changes }
    if (out.expressions) {
        const current = (expr: TExpr): TExpr => {
            const found = currentExpression(expr.id)
            return found ? { ...found } : expr
        }
        out.expressions = {
            added: out.expressions.added.map(current),
            modified: out.expressions.modified.map(current),
            removed: out.expressions.removed,
        }
    }
    if (out.premises) {
        const current = (premise: TPremise): TPremise =>
            currentPremise(premise.id) ?? premise
        out.premises = {
            added: out.premises.added.map(current),
            modified: out.premises.modified.map(current),
            removed: out.premises.removed,
        }
    }
    return out
}

/**
 * Merges two changesets into one, deduplicating entities by `id` within each
 * bucket (added/modified/removed) with last-write-wins semantics.
 *
 * Use this for changesets that never change one entity in different ways.
 * For the changesets of successive calls on one engine, where a later call
 * can modify or remove what an earlier one added or modified, use
 * {@link composeChangesets}: this function throws in that case.
 *
 * @param a - The first changeset.
 * @param b - The second changeset. Its entries take precedence when both
 *   changesets contain the same entity ID in the same bucket.
 * @returns A merged changeset. Entity categories that are empty after merge
 *   are omitted from the result.
 * @throws {Error} If any entity ID appears in more than one bucket
 *   (added/modified/removed) within the same category after merge. This
 *   indicates a logic error in the caller.
 */
export function mergeChangesets<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TPremise extends TCorePremise = TCorePremise,
    TArg extends TCoreArgument = TCoreArgument,
>(
    a: TCoreChangeset<TExpr, TVar, TPremise, TArg>,
    b: TCoreChangeset<TExpr, TVar, TPremise, TArg>
): TCoreChangeset<TExpr, TVar, TPremise, TArg> {
    const result: TCoreChangeset<TExpr, TVar, TPremise, TArg> = {}

    const mergedExpressions = mergeEntityChanges(
        a.expressions,
        b.expressions,
        "expressions"
    )
    if (mergedExpressions) result.expressions = mergedExpressions

    const mergedVariables = mergeEntityChanges(
        a.variables,
        b.variables,
        "variables"
    )
    if (mergedVariables) result.variables = mergedVariables

    const mergedPremises = mergeEntityChanges(
        a.premises,
        b.premises,
        "premises"
    )
    if (mergedPremises) result.premises = mergedPremises

    if (b.roles !== undefined) {
        result.roles = b.roles
    } else if (a.roles !== undefined) {
        result.roles = a.roles
    }

    if (b.argument !== undefined) {
        result.argument = b.argument
    } else if (a.argument !== undefined) {
        result.argument = a.argument
    }

    return result
}

/**
 * Combines two changesets made one after the other into the one changeset
 * that describes both, entity by entity: added then modified stays added
 * (with the later value), added then removed disappears, modified then
 * removed becomes removed, removed then added becomes modified, and
 * otherwise the later entry wins. `roles` and `argument` take the later
 * value when it is present.
 *
 * Unlike {@link mergeChangesets}, which combines independent changesets and
 * rejects an id in two buckets, this is for a sequence, where the same
 * entity legitimately changes more than once.
 *
 * @example
 * ```ts
 * const { changes: createChanges } = engine.createPremiseWithId(premiseId, data)
 * const { changes: roleChanges } = engine.setConclusionPremise(premiseId)
 * const combined = composeChangesets(createChanges, roleChanges)
 * await persistChangeset(db, combined)
 * ```
 */
export function composeChangesets<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TPremise extends TCorePremise = TCorePremise,
    TArg extends TCoreArgument = TCoreArgument,
>(
    first: TCoreChangeset<TExpr, TVar, TPremise, TArg>,
    then: TCoreChangeset<TExpr, TVar, TPremise, TArg>
): TCoreChangeset<TExpr, TVar, TPremise, TArg> {
    const result: TCoreChangeset<TExpr, TVar, TPremise, TArg> = {}
    const expressions = composeEntityChanges(
        first.expressions,
        then.expressions
    )
    if (expressions) result.expressions = expressions
    const variables = composeEntityChanges(first.variables, then.variables)
    if (variables) result.variables = variables
    const premises = composeEntityChanges(first.premises, then.premises)
    if (premises) result.premises = premises
    const roles = then.roles ?? first.roles
    if (roles !== undefined) result.roles = roles
    const argument = then.argument ?? first.argument
    if (argument !== undefined) result.argument = argument
    return result
}

function composeEntityChanges<T extends { id: string }>(
    first: TCoreEntityChanges<T> | undefined,
    then: TCoreEntityChanges<T> | undefined
): TCoreEntityChanges<T> | undefined {
    if (!first && !then) return undefined
    const state: TEntityChangeState<T> = new Map()
    for (const changes of [first, then]) {
        for (const bucket of ["added", "modified", "removed"] as const) {
            for (const entity of changes?.[bucket] ?? []) {
                recordEntityChange(state, bucket, entity)
            }
        }
    }
    return entityChangesFrom(state)
}

/** Each entity's single bucket and latest value, by id. */
export type TEntityChangeState<T extends { id: string }> = Map<
    string,
    { bucket: "added" | "modified" | "removed"; entity: T }
>

/**
 * Records one change to an entity on top of what `state` already holds for
 * it, keeping one bucket per entity: added then modified stays added (with
 * the later value), added then removed disappears, removed then added
 * becomes modified, and otherwise the later change replaces the earlier.
 */
export function recordEntityChange<T extends { id: string }>(
    state: TEntityChangeState<T>,
    bucket: "added" | "modified" | "removed",
    entity: T
): void {
    const earlier = state.get(entity.id)?.bucket
    if (bucket === "removed" && earlier === "added") {
        state.delete(entity.id)
        return
    }
    const next =
        bucket === "added" && earlier === "removed"
            ? "modified"
            : bucket === "modified" && earlier === "added"
              ? "added"
              : bucket
    state.set(entity.id, { bucket: next, entity })
}

/** The buckets `state` describes, or undefined when it holds nothing. */
export function entityChangesFrom<T extends { id: string }>(
    state: TEntityChangeState<T>
): TCoreEntityChanges<T> | undefined {
    if (state.size === 0) return undefined
    const out: TCoreEntityChanges<T> = { added: [], modified: [], removed: [] }
    for (const { bucket, entity } of state.values()) out[bucket].push(entity)
    return out
}

function mergeEntityChanges<T extends { id: string }>(
    a: TCoreEntityChanges<T> | undefined,
    b: TCoreEntityChanges<T> | undefined,
    categoryName: string
): TCoreEntityChanges<T> | undefined {
    if (!a && !b) return undefined

    const dedup = (aList: T[], bList: T[]): T[] => {
        const map = new Map<string, T>()
        for (const item of aList) map.set(item.id, item)
        for (const item of bList) map.set(item.id, item)
        return [...map.values()]
    }

    const added = dedup(a?.added ?? [], b?.added ?? [])
    const modified = dedup(a?.modified ?? [], b?.modified ?? [])
    const removed = dedup(a?.removed ?? [], b?.removed ?? [])

    // Enforce invariant: no entity ID may appear in more than one bucket.
    const addedIds = new Set(added.map((e) => e.id))
    const modifiedIds = new Set(modified.map((e) => e.id))
    const removedIds = new Set(removed.map((e) => e.id))

    for (const id of addedIds) {
        if (modifiedIds.has(id)) {
            throw new Error(
                `mergeChangesets: entity "${id}" appears in both added and modified in ${categoryName}`
            )
        }
        if (removedIds.has(id)) {
            throw new Error(
                `mergeChangesets: entity "${id}" appears in both added and removed in ${categoryName}`
            )
        }
    }
    for (const id of modifiedIds) {
        if (removedIds.has(id)) {
            throw new Error(
                `mergeChangesets: entity "${id}" appears in both modified and removed in ${categoryName}`
            )
        }
    }

    if (added.length === 0 && modified.length === 0 && removed.length === 0) {
        return undefined
    }

    return { added, modified, removed }
}
