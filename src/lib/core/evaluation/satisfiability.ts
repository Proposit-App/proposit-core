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
 * Free-variable ceiling for the satisfiability walk. Beyond it the answer is
 * reported as "not determined" rather than paid for.
 */
export const SATISFIABILITY_VARIABLE_CEILING = 16

export interface TPremiseSetSatisfiabilityInput {
    /** The premises that must come out true together. */
    premises: TEvaluablePremise[]
    /**
     * Variable IDs enumerated over — the same claim-bound and
     * externally-bound set evaluation uses. Internally premise-bound
     * variables resolve lazily and get no column.
     */
    freeVariableIds: string[]
    /** Variable IDs pinned `true` in every row, and given no column. */
    forcedTrueVariableIds?: ReadonlySet<string>
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
 * Returns `null` for "not determined" rather than `false` in two cases: the
 * free-variable count exceeds the ceiling, or some row could not be settled —
 * a premise that came back neither `true` nor `false` leaves that row's answer
 * unestablished, and `false` here suppresses derivation argument-wide, so it
 * must be a claim the search actually made.
 *
 * ponytail: a truth-table walk, not a SAT solver. Real arguments carry
 * single-digit variable counts; the ceiling bounds the worst case. Reach for a
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
    if (freeVariableIds.length > SATISFIABILITY_VARIABLE_CEILING) return null

    const totalAssignments = 2 ** freeVariableIds.length
    let sawIndeterminateRow = false
    for (let mask = 0; mask < totalAssignments; mask++) {
        const variables: TCoreVariableAssignment = {}
        for (let index = 0; index < freeVariableIds.length; index++) {
            variables[freeVariableIds[index]] = Boolean(mask & (1 << index))
        }
        for (const variableId of forcedTrueVariableIds ?? []) {
            variables[variableId] = true
        }
        const assignment: TCoreExpressionAssignment = {
            variables,
            operatorAssignments: {},
        }
        const resolver = createPremiseBoundResolver(ctx, assignment)
        const rootValues = input.premises.map(
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
