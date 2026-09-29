import type {
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TCorePremise,
} from "../schemata/propositional.js"
import type {
    TCoreArgument,
    TCoreArgumentRoleState,
} from "../schemata/argument.js"
import type { TCoreEntityChanges, TCoreChangeset } from "../types/mutation.js"
import { isPremiseBound } from "../schemata/propositional.js"
import { POSITION_INITIAL } from "./position.js"

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

/**
 * A single persistence operation extracted from a changeset, tagged with
 * its operation type (`insert`, `update`, or `delete`) and entity kind.
 *
 * Used as the element type for the ordered operation list returned by
 * {@link orderChangeset}.
 */
export type TOrderedOperation<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TPremise extends TCorePremise = TCorePremise,
    TArg extends TCoreArgument = TCoreArgument,
> =
    | { type: "delete"; entity: "expression"; data: TExpr }
    | { type: "delete"; entity: "variable"; data: TVar }
    | { type: "delete"; entity: "premise"; data: TPremise }
    | { type: "insert"; entity: "premise"; data: TPremise }
    | { type: "insert"; entity: "variable"; data: TVar }
    | { type: "insert"; entity: "expression"; data: TExpr }
    | { type: "update"; entity: "expression"; data: TExpr }
    | {
          type: "update"
          entity: "expression"
          /**
           * A detach: only these fields change, and every other stored
           * field keeps its value. Write only the fields given.
           */
          data: Pick<TExpr, "id"> & {
              parentId: null
              position: typeof POSITION_INITIAL
          }
      }
    | { type: "update"; entity: "variable"; data: TVar }
    | { type: "update"; entity: "premise"; data: TPremise }
    | { type: "update"; entity: "argument"; data: TArg }
    | { type: "update"; entity: "roles"; data: TCoreArgumentRoleState }

/**
 * Converts a changeset into a flat, ordered array of persistence operations
 * that is safe to execute sequentially against a relational store with
 * foreign-key constraints.
 *
 * The FK dependency chain is:
 * - `expression.premiseId` → `premise.id`
 * - `expression.variableId` → `variable.id` (for variable-type expressions)
 * - `expression.parentId` → `expression.id` (self-FK for tree structure)
 * - `variable.boundPremiseId` → `premise.id` (for premise-bound variables)
 * - `variable.argumentId` → `argument.id`
 * - `premise.argumentId` → `argument.id`
 *
 * The resulting order guarantees that every referenced row exists before any
 * row that depends on it is inserted, and that every dependent row is removed
 * before the row it references is deleted.
 *
 * It does so without knowing what the store holds. A removed expression's
 * entry carries its parent at removal time, and a change in the same
 * changeset may have moved it first, so the stored row can still point at a
 * different parent. Every removed expression is therefore detached before
 * any expression is deleted, by an update that carries only its `id`,
 * `parentId: null` and `position` {@link POSITION_INITIAL}. Two conditions
 * follow for the store:
 * - Write only the fields an update carries. A detach is not a whole row;
 *   the rest of the removed entry may be stale, and can name a variable this
 *   changeset has not inserted yet.
 * - Until the deletes run, a premise can briefly have more than one root, so
 *   a rule allowing one root per premise must be checked at the end of the
 *   transaction, not per statement.
 *
 * An expression updated to point at a parent, a variable or a premise that
 * the same changeset inserts is moved to the root in phase 2 and updated in
 * full after the inserts. In phase 2, one late only for its new parent is
 * written whole with the parent cleared, since its variable and premise are
 * not new ones, so it leaves its old variable before that can be deleted.
 * One that names a new variable or premise can only be detached (`id`,
 * `parentId`, `position`), so the variable and premise deletes (phases 4
 * and 5) wait until after its full update: the stored row still names its
 * old variable and premise, which may be among them, and a store whose keys
 * cascade would otherwise delete the row.
 *
 * Variable updates run between the variable and premise deletes, so a
 * rebound variable leaves its old premise before that premise is deleted,
 * and a rename can take a symbol a removed variable frees. One bound to a
 * premise the same changeset inserts runs after that insert instead, and
 * the premise deletes wait for it. A changeset with no variable update and
 * no expression update that needs an insert first keeps its previous order
 * exactly: the phase list below with every step for those two left out.
 *
 * Known exceptions, only when deletes wait, for a store that checks the rule
 * per statement. The inserts then run while the removed rows still exist, so:
 * - a variable inserted with the symbol of one being removed breaks a rule
 *   that symbols are unique per argument, and so does one inserted with the
 *   symbol a variable is being renamed off (both only when the variable
 *   deletes wait, for an expression update: the renames then run after the
 *   inserts);
 * - a premise inserted as the conclusion while the removed conclusion
 *   premise still exists breaks a rule of one conclusion per argument.
 *
 * Ordering phases:
 * 1. Update premises — ensure premise rows have correct metadata before
 *    dependent deletes run.
 * 2. Reparent expressions — update expressions whose IDs are NOT in the
 *    removed set. This detaches reparented children from doomed parents
 *    before ON DELETE CASCADE runs. Expressions that appear in both
 *    modified and removed are skipped (the row is about to be deleted).
 *    Then detach every removed expression (see above), so no stored row
 *    points at an expression about to be deleted. A detach carries only
 *    `id`, `parentId` and `position`. An update that needs an insert first
 *    is written early here too (see above).
 * 3. Delete expressions — expression rows hold FKs to variables and premises,
 *    so they must be removed first. Every one is detached by now, so their
 *    order does not matter; children still come before parents.
 * 4. Delete variables — safe after expression deletes (no remaining FK
 *    references from expressions). Then update variables, except one bound
 *    to a new premise; one that is also removed is skipped, as an
 *    expression is in phase 2. Held until after phase 8 when an expression update
 *    names a new variable or premise (see above).
 * 5. Delete premises — safe after all child rows are removed. Held with
 *    phase 4, or until after phase 6 for a variable bound to a new premise.
 * 6. Insert premises — new premises must exist before their expressions and
 *    variables can be inserted. Then update the variables bound to them,
 *    and delete premises if phase 5 waited for those.
 * 7. Insert variables — new variables must exist before variable-type
 *    expressions can reference them.
 * 8. Insert expressions — topologically sorted so parent expressions are
 *    inserted before their children (satisfies the parentId self-FK). Then
 *    the updates held back in phase 2, then phases 4 and 5 if held.
 * 9. (No-op — variable updates are emitted with phase 4 or 6, or after
 *    phase 8 when the deletes are held.)
 * 10. (No-op — expression updates are emitted in phase 2 or after phase 8.)
 * 11. Update argument metadata — if present.
 * 12. Update role state — if present.
 *
 * @param changeset - The changeset to convert into ordered operations.
 * @returns A flat array of {@link TOrderedOperation} entries in FK-safe
 *   execution order. Returns an empty array if the changeset is empty.
 */
export function orderChangeset<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TPremise extends TCorePremise = TCorePremise,
    TArg extends TCoreArgument = TCoreArgument,
>(
    changeset: TCoreChangeset<TExpr, TVar, TPremise, TArg>
): TOrderedOperation<TExpr, TVar, TPremise, TArg>[] {
    const ops: TOrderedOperation<TExpr, TVar, TPremise, TArg>[] = []

    // Build a set of removed expression IDs so we can skip them in modified
    // phases. An expression that appears in both modified and removed is a
    // no-op update — the row is about to be deleted.
    const removedExprIds = new Set(
        (changeset.expressions?.removed ?? []).map((e) => e.id)
    )

    // Phase 1: Update premises — ensure premise rows have correct metadata
    // before dependent deletes run.
    for (const p of changeset.premises?.modified ?? []) {
        ops.push({ type: "update", entity: "premise", data: p })
    }

    // Phase 2: Reparent expressions — update expressions whose IDs are NOT
    // in the removed set. This detaches reparented children from doomed
    // parents before ON DELETE CASCADE runs in Phase 3.
    //
    // An update that points at a parent or a variable this changeset
    // inserts cannot run yet. It is moved to the root here instead, so its
    // old parent can be deleted, and applied in full after the inserts.
    const addedExprIds = new Set(
        (changeset.expressions?.added ?? []).map((e) => e.id)
    )
    const addedVarIds = new Set(
        (changeset.variables?.added ?? []).map((v) => v.id)
    )
    const addedPremiseIds = new Set(
        (changeset.premises?.added ?? []).map((p) => p.id)
    )
    const namesNewRow = (e: TExpr) =>
        addedPremiseIds.has(e.premiseId) ||
        (e.type === "variable" && addedVarIds.has(e.variableId))
    const late: TExpr[] = []
    for (const e of changeset.expressions?.modified ?? []) {
        if (removedExprIds.has(e.id)) continue
        if (
            (e.parentId !== null && addedExprIds.has(e.parentId)) ||
            namesNewRow(e)
        ) {
            late.push(e)
            // An update naming a new premise or variable can only detach
            // now. One late for its parent alone names rows that exist, so
            // it moves off its old variable here too, before that can be
            // deleted.
            ops.push({
                type: "update",
                entity: "expression",
                data: namesNewRow(e)
                    ? { id: e.id, parentId: null, position: POSITION_INITIAL }
                    : { ...e, parentId: null, position: POSITION_INITIAL },
            })
        } else {
            ops.push({ type: "update", entity: "expression", data: e })
        }
    }

    // Still Phase 2: detach every removed expression. Its entry's parent is
    // the one at removal time, which the stored row may not share, so the
    // delete order below cannot be computed from it; detached rows need no
    // order at all. The detach carries only the parent and a root's
    // position: the rest of the entry may be stale too, and may name a
    // variable this changeset has not inserted yet.
    for (const e of changeset.expressions?.removed ?? []) {
        ops.push({
            type: "update",
            entity: "expression",
            data: { id: e.id, parentId: null, position: POSITION_INITIAL },
        })
    }

    // Phase 3: Delete expressions — reverse-topologically sorted so children
    // are deleted before parents (satisfies the parentId self-FK).
    const removedExprs = changeset.expressions?.removed ?? []
    const sortedRemoved = topologicalSortExpressions(removedExprs).reverse()
    for (const e of sortedRemoved) {
        ops.push({ type: "delete", entity: "expression", data: e })
    }

    // Phases 4 and 5: Delete variables, then premises — safe after
    // expression deletes (no remaining FK references from expressions), and
    // premises after their bound variables. When a late update moves an
    // expression onto a new variable or premise, the stored row still names
    // its old ones, which may be among these; the entry does not say which,
    // so all of them wait until the late updates have run.
    //
    // Variable updates run between the two deletes: after the variable
    // deletes, so a rename can take a symbol a removed variable frees, and
    // before the premise deletes, so a rebound variable leaves its old
    // premise first. One bound to a premise this changeset inserts runs
    // after that insert instead, and the premise deletes wait for it: the
    // stored row may still name one of them.
    const boundToNewPremise = (v: TVar) =>
        isPremiseBound(v) && addedPremiseIds.has(v.boundPremiseId)
    // A variable that is also removed gets its delete alone: an update
    // after the delete would find no row.
    const removedVarIds = new Set(
        (changeset.variables?.removed ?? []).map((v) => v.id)
    )
    const modifiedVars = (changeset.variables?.modified ?? []).filter(
        (v) => !removedVarIds.has(v.id)
    )
    const earlyVars = modifiedVars.filter((v) => !boundToNewPremise(v))
    const lateVars = modifiedVars.filter(boundToNewPremise)
    const updateVariables = (vars: TVar[]) => {
        for (const v of vars) {
            ops.push({ type: "update", entity: "variable", data: v })
        }
    }
    const deletePremises = () => {
        for (const p of changeset.premises?.removed ?? []) {
            ops.push({ type: "delete", entity: "premise", data: p })
        }
    }
    const holdDeletes = late.some(namesNewRow)
    if (!holdDeletes) {
        for (const v of changeset.variables?.removed ?? []) {
            ops.push({ type: "delete", entity: "variable", data: v })
        }
        updateVariables(earlyVars)
        if (lateVars.length === 0) deletePremises()
    }

    // Phase 6: Insert premises — new premises must exist before their
    // expressions and variables can be inserted. Then the variable updates
    // bound to them, and the premise deletes that waited for those.
    for (const p of changeset.premises?.added ?? []) {
        ops.push({ type: "insert", entity: "premise", data: p })
    }
    if (!holdDeletes && lateVars.length > 0) {
        updateVariables(lateVars)
        deletePremises()
    }

    // Phase 7: Insert variables — new variables must exist before
    // variable-type expressions can reference them.
    for (const v of changeset.variables?.added ?? []) {
        ops.push({ type: "insert", entity: "variable", data: v })
    }

    // Phase 8: Insert expressions — topologically sorted so parent
    // expressions are inserted before their children (satisfies the
    // parentId self-FK).
    const sortedInsertExprs = topologicalSortExpressions(
        changeset.expressions?.added ?? []
    )
    for (const e of sortedInsertExprs) {
        ops.push({ type: "insert", entity: "expression", data: e })
    }

    // Phase 8, late: the updates Phase 2 held back, now that what they point
    // at exists. Then the deletes held back for them, if any.
    for (const e of late) {
        ops.push({ type: "update", entity: "expression", data: e })
    }
    if (holdDeletes) {
        for (const v of changeset.variables?.removed ?? []) {
            ops.push({ type: "delete", entity: "variable", data: v })
        }
        updateVariables(modifiedVars)
        deletePremises()
    }

    // Phase 9: Update variables — no-op. Every modified variable was emitted
    // with the deletes above. Retained to keep the phase numbering stable.

    // Phase 10: Update expressions — no-op. Every non-removed modified
    // expression was emitted in Phase 2 or after Phase 8. This phase is
    // retained as a logical placeholder to keep the phase numbering stable.

    // Phase 11: Update argument metadata — if present.
    if (changeset.argument !== undefined) {
        ops.push({
            type: "update",
            entity: "argument",
            data: changeset.argument,
        })
    }

    // Phase 12: Update role state — if present.
    if (changeset.roles !== undefined) {
        ops.push({ type: "update", entity: "roles", data: changeset.roles })
    }

    return ops
}

/**
 * Topologically sorts expressions so that parents appear before children,
 * using the `parentId` field. Expressions with `parentId: null` (roots)
 * come first, followed by their children in dependency order.
 */
function topologicalSortExpressions<TExpr extends TCorePropositionalExpression>(
    expressions: TExpr[]
): TExpr[] {
    if (expressions.length <= 1) return expressions

    const byId = new Map<string, TExpr>()
    for (const expr of expressions) {
        byId.set(expr.id, expr)
    }

    const sorted: TExpr[] = []
    const visited = new Set<string>()

    function visit(expr: TExpr): void {
        if (visited.has(expr.id)) return
        // If this expression has a parent that is also in the insertion set,
        // ensure the parent is emitted first.
        if (expr.parentId !== null && byId.has(expr.parentId)) {
            visit(byId.get(expr.parentId)!)
        }
        visited.add(expr.id)
        sorted.push(expr)
    }

    for (const expr of expressions) {
        visit(expr)
    }

    return sorted
}
