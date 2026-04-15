/**
 * Thrown when an argument's structural invariants (beyond what
 * `validateArgument` surfaces) preclude a review-helper operation —
 * for example, two variables binding to the same claim with different
 * versions.
 */
export class InvalidArgumentStructureError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "InvalidArgumentStructureError"
    }
}

/**
 * Thrown by `canonicalizeOperatorAssignments` when an expression override
 * references an expression id that does not exist in any premise of the
 * argument.
 */
export class UnknownExpressionError extends Error {
    public readonly expressionId: string

    constructor(expressionId: string) {
        super(`Unknown expression id: "${expressionId}".`)
        this.name = "UnknownExpressionError"
        this.expressionId = expressionId
    }
}

/**
 * Reason an expression cannot be voted on:
 * - `"is-not-operator"` — the expression is the `"not"` operator (flipped
 *   by render-time negation, not voted on).
 * - `"not-an-operator-type"` — the expression exists but is a variable or
 *   formula node; only operator expressions carry accept/reject state.
 */
export type TNotOperatorNotDecidableReason =
    | "is-not-operator"
    | "not-an-operator-type"

/**
 * Thrown by `canonicalizeOperatorAssignments` when an override targets an
 * expression that cannot carry an accept/reject assignment.
 */
export class NotOperatorNotDecidableError extends Error {
    public readonly expressionId: string
    public readonly reason: TNotOperatorNotDecidableReason

    constructor(expressionId: string, reason: TNotOperatorNotDecidableReason) {
        const why =
            reason === "is-not-operator"
                ? `is a "not" operator`
                : `is not an operator expression`
        super(`Expression "${expressionId}" ${why} and is not decidable.`)
        this.name = "NotOperatorNotDecidableError"
        this.expressionId = expressionId
        this.reason = reason
    }
}
