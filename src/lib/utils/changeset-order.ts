import type {
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TCorePremise,
} from "../schemata/propositional.js"
import type {
    TCoreArgument,
    TCoreArgumentRoleState,
} from "../schemata/argument.js"
import type { TCoreChangeset } from "../types/mutation.js"
import { isPremiseBound } from "../schemata/propositional.js"
import { POSITION_INITIAL } from "./position.js"

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

    // Phase 9: Update variables — no-op. Every modified variable not also
    // removed was emitted with the deletes above. Retained to keep the phase
    // numbering stable.

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
