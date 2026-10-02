import type { TBoundAspect } from "../schemata/propositional.js"

/**
 * What a link does to the expression it binds.
 *
 * - `contradict`: `NOT(x)` on a statement — the expression is false.
 * - `affirm`: `x` on a statement — the expression is true.
 * - `undercut`: `NOT(s)` on an inference — the operator's step does not hold.
 * - `reinforce`: `s` on an inference — the operator's step holds.
 */
export type TLinkMove = "contradict" | "affirm" | "undercut" | "reinforce"

/** One link of a response: a premise whose whole content is `x` or `NOT(x)`. */
export interface TResponseLink {
    premiseId: string
    variableId: string
    /** The bound expression, in the argument the response answers. */
    boundExpressionId: string
    boundAspect: TBoundAspect
    move: TLinkMove
}

/** Machine-readable codes for what `validateLinks` reports. */
export type TLinkViolationCode =
    /** The bound expression is not in the target snapshot. */
    | "LINK_EXPRESSION_MISSING"
    /** An inference-aspect binding names an expression that is not an operator. */
    | "LINK_INFERENCE_ON_NON_OPERATOR"
    /**
     * The response holds a claim-bound variable for a claim the target uses.
     * The response affirms such a claim through a link instead.
     */
    | "LINK_CLAIM_USED_BY_TARGET"
    /** A binding names another version of the argument answered (rule E-10). */
    | "LINK_VERSION_MISMATCH"
    /**
     * Two links bind different occurrences of one claim in the same aspect.
     * Reported as information: it is legal, and the checks treat the two as
     * one thing.
     */
    | "LINK_SAME_CLAIM"

export interface TLinkViolation {
    code: TLinkViolationCode
    /** `"info"` never makes the result fail. */
    severity: "error" | "info"
    message: string
    variableId?: string
    premiseIds?: string[]
    expressionId?: string
    claimId?: string
}

export interface TLinkValidationResult {
    /** True when nothing of severity `"error"` was reported. */
    ok: boolean
    violations: TLinkViolation[]
}

/** Every expression id and claim id found in one premise of a snapshot. */
export interface TPremiseElements {
    expressionIds: string[]
    claimIds: string[]
}
