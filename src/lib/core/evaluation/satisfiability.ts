import { isPremiseBound } from "../../schemata/index.js"
import type {
    TCoreExpressionAssignment,
    TCoreTrivalentValue,
    TCoreVariableAssignment,
} from "../../types/evaluation.js"
import type {
    TArgumentEvaluationContext,
    TEvaluablePremise,
} from "./argument-evaluation.js"
import { createPremiseBoundResolver } from "./premise-resolver.js"

/**
 * Free-variable ceiling for the satisfiability walk, applied to each group of
 * interacting variables rather than to their total. Beyond it that group's
 * answer is reported as "not determined" rather than paid for.
 */
export const SATISFIABILITY_VARIABLE_CEILING = 16

export interface TPremiseSetSatisfiabilityInput {
    /** The premises that must come out true together. */
    premises: TEvaluablePremise[]
    /**
     * Variable IDs available to enumerate over — the same claim-bound and
     * externally-bound set evaluation uses. Internally premise-bound
     * variables resolve lazily and get no column. Passing more than the
     * premises reach is harmless: an id no premise can reach gets no column.
     */
    freeVariableIds: string[]
    /** Variable IDs pinned `true` in every row, and given no column. */
    forcedTrueVariableIds?: ReadonlySet<string>
}

/**
 * The free variables each premise can reach, keyed by premise id.
 *
 * Reaching is not the same as naming. A premise names the variables in its own
 * expressions, but an internally premise-bound variable resolves by evaluating
 * its bound premise's whole tree under the same assignment
 * (`createPremiseBoundResolver`), so a premise depends on every variable that
 * premise reaches while naming none of them. The relation has to be that
 * transitive closure, or two premises coupled only through a bound variable
 * look independent — and anything that partitions on this relation would then
 * combine two separately-satisfying assignments into one that satisfies
 * neither.
 *
 * Only ids in `freeVariableIds` are collected; a bound variable is a link to
 * follow, never a member.
 *
 * A binding cycle terminates here by marking premises in progress. That is this
 * function's own guard rather than a mirror of the resolver's: the resolver
 * seeds its cache only after the recursive evaluation returns, so a re-entrant
 * lookup misses and recurses again. `validateArgument` rejects such a cycle,
 * but this runs wherever a caller skipped validation.
 */
function collectReachableVariables(
    ctx: TArgumentEvaluationContext,
    premises: TEvaluablePremise[],
    freeVariableIds: ReadonlySet<string>
): Map<string, Set<string>> {
    const byPremiseId = new Map<string, Set<string>>()
    const inProgress = new Set<string>()
    // The caller's premise list wins over the context's lookup: it may be a
    // filtered set (struck premises removed), and a bound premise is then
    // still resolved through the context, exactly as the resolver does.
    const supplied = new Map(premises.map((pm) => [pm.getId(), pm]))

    const reach = (premiseId: string): Set<string> => {
        const settled = byPremiseId.get(premiseId)
        if (settled) return settled
        if (inProgress.has(premiseId)) return new Set()

        const premise = supplied.get(premiseId) ?? ctx.getPremise(premiseId)
        if (!premise) return new Set()

        inProgress.add(premiseId)
        const reached = new Set<string>()
        for (const expression of premise.getExpressions()) {
            if (expression.type !== "variable") continue
            const variableId = expression.variableId
            if (freeVariableIds.has(variableId)) {
                reached.add(variableId)
                continue
            }
            const variable = ctx.getVariable(variableId)
            if (
                variable &&
                isPremiseBound(variable) &&
                variable.boundArgumentId === ctx.argumentId
            ) {
                for (const id of reach(variable.boundPremiseId)) reached.add(id)
            }
        }
        inProgress.delete(premiseId)
        byPremiseId.set(premiseId, reached)
        return reached
    }

    for (const premise of premises) reach(premise.getId())
    return byPremiseId
}

/**
 * Classical satisfiability of a premise set: is there some total assignment
 * under which every one of these premises is true?
 *
 * Asked of the premise set alone — the reader's own assignment and their
 * operator decisions play no part, which is what distinguishes it from the
 * strong-Kleene partial evaluation the rest of the pipeline does. The two
 * answer different questions: this one asks whether the premises can hold at
 * all, so a `false` answer means the premises contradict each other and
 * nothing may be derived through them.
 *
 * Returns `null` for "not determined" rather than `false` in two cases: a group
 * of interacting variables exceeds the ceiling, or some row could not be
 * settled — a premise that came back neither `true` nor `false` leaves that
 * row's answer unestablished, and `false` here suppresses derivation
 * argument-wide, so it must be a claim the search actually made. A `false` from
 * any one group still settles the whole set, even beside a group too large to
 * have been walked.
 *
 * The premises are split into groups sharing no variable and each group is
 * walked over its own columns, so the cost is the sum of the groups' tables
 * rather than their product. Every reduction here is answer-preserving: the
 * result matches a single flat walk over all the variables at once.
 *
 * ponytail: still a truth-table walk, not a SAT solver — grouping shrinks the
 * input rather than replacing the method. Real arguments carry single-digit
 * variable counts per group; the ceiling bounds the worst case. Reach for a
 * solver only if `null` answers start showing up in practice.
 */
export function isPremiseSetSatisfiable(
    ctx: TArgumentEvaluationContext,
    input: TPremiseSetSatisfiabilityInput
): TCoreTrivalentValue {
    if (input.premises.length === 0) return true

    const forcedTrueVariableIds = input.forcedTrueVariableIds
    const freeVariableIds = input.freeVariableIds.filter(
        (variableId) => forcedTrueVariableIds?.has(variableId) !== true
    )

    let sawUndeterminedGroup = false
    for (const group of partitionIntoGroups(
        ctx,
        input.premises,
        new Set(freeVariableIds)
    )) {
        const answer = walkGroup(
            ctx,
            group.premises,
            group.columns,
            forcedTrueVariableIds
        )
        // A group that cannot hold makes the whole set unable to hold, whatever
        // the others do — including a group too large to have been walked.
        if (answer === false) return false
        if (answer === null) sawUndeterminedGroup = true
    }
    return sawUndeterminedGroup ? null : true
}

/**
 * Split the premises into groups that share no variable, and give each group
 * only the columns its own premises reach.
 *
 * Two premises belong together when some variable is reachable from both, so
 * every premise's reachable set is a clique and the groups are that graph's
 * connected components. Premises reaching no free variable at all share one
 * group with no columns, walked in a single row: they cannot interact with
 * anything, including each other. A free variable no premise reaches appears in
 * no group and so gets no column anywhere.
 */
function partitionIntoGroups(
    ctx: TArgumentEvaluationContext,
    premises: TEvaluablePremise[],
    freeVariableIds: ReadonlySet<string>
): { premises: TEvaluablePremise[]; columns: string[] }[] {
    const reachable = collectReachableVariables(ctx, premises, freeVariableIds)

    const parent = new Map<string, string>()
    const find = (id: string): string => {
        let root = parent.get(id) ?? id
        while (root !== (parent.get(root) ?? root)) {
            root = parent.get(root) ?? root
        }
        parent.set(id, root)
        return root
    }
    const union = (left: string, right: string): void => {
        const leftRoot = find(left)
        const rightRoot = find(right)
        if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot)
    }

    for (const reached of reachable.values()) {
        let anchor: string | undefined
        for (const variableId of reached) {
            if (anchor === undefined) anchor = variableId
            else union(anchor, variableId)
        }
    }

    const UNGROUPED = Symbol("no reachable variable")
    const byRoot = new Map<
        string | symbol,
        { premises: TEvaluablePremise[]; columns: Set<string> }
    >()
    for (const premise of premises) {
        const reached = reachable.get(premise.getId()) ?? new Set<string>()
        const [first] = reached
        const key = first === undefined ? UNGROUPED : find(first)
        const group = byRoot.get(key) ?? { premises: [], columns: new Set() }
        group.premises.push(premise)
        for (const variableId of reached) group.columns.add(variableId)
        byRoot.set(key, group)
    }

    return [...byRoot.values()].map((group) => ({
        premises: group.premises,
        columns: [...group.columns],
    }))
}

/**
 * The truth-table walk over one group: is there an assignment of `columns`
 * under which all of `premises` come out true?
 *
 * `forcedTrueVariableIds` are written into every row of every group, including
 * a group with no columns at all. They are not columns, but a premise that
 * reads one still has to see it — left out, it resolves `null` and the group
 * reports "not determined" where it should have reported a value.
 */
function walkGroup(
    ctx: TArgumentEvaluationContext,
    premises: TEvaluablePremise[],
    columns: string[],
    forcedTrueVariableIds: ReadonlySet<string> | undefined
): TCoreTrivalentValue {
    if (columns.length > SATISFIABILITY_VARIABLE_CEILING) return null

    const totalAssignments = 2 ** columns.length
    let sawIndeterminateRow = false
    for (let mask = 0; mask < totalAssignments; mask++) {
        const variables: TCoreVariableAssignment = {}
        for (let index = 0; index < columns.length; index++) {
            variables[columns[index]] = Boolean(mask & (1 << index))
        }
        for (const variableId of forcedTrueVariableIds ?? []) {
            variables[variableId] = true
        }
        const assignment: TCoreExpressionAssignment = {
            variables,
            operatorAssignments: {},
        }
        const resolver = createPremiseBoundResolver(ctx, assignment)
        const rootValues = premises.map(
            (premise) =>
                premise.evaluate(assignment, { resolver }).rootValue ?? null
        )
        if (rootValues.every((value) => value === true)) return true
        // A row is settled either because one premise is outright false or
        // because every premise resolved to something.
        if (
            !rootValues.includes(false) &&
            rootValues.some((value) => value === null)
        ) {
            sawIndeterminateRow = true
        }
    }
    return sawIndeterminateRow ? null : false
}
