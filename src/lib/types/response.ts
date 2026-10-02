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
    /** The snapshot is not the argument and version the response answers. */
    | "LINK_TARGET_MISMATCH"
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

/**
 * One column of the search a check runs: one thing that is true or false on
 * its own. Two occurrences of one claim, in the argument answered or across
 * links, are one column.
 */
export type TColumnReference =
    | { kind: "claim"; claimId: string }
    /** An expression of another argument that is not expanded: an inference, or a binding further back. */
    | {
          kind: "expression"
          argumentId: string
          expressionId: string
          aspect: TBoundAspect
      }
    /** A premise of another argument, bound from outside it. */
    | {
          kind: "premise"
          argumentId: string
          argumentVersion: number
          premiseId: string
      }

export interface TColumnValue {
    column: TColumnReference
    value: boolean
}

/** Why a check could not decide. */
export type TUndeterminedReason =
    /** A group of interacting columns is larger than the search's ceiling. */
    "too-many-variables"

/**
 * Whether one link of a response is supported by the response's other
 * premises.
 *
 * - `follows`: it follows from them. `supportPremiseIds` is a minimal set it
 *   follows from — no premise can be removed — not necessarily the smallest.
 *   `restsOnlyOnLinks` is true when it follows only through links that are
 *   themselves unsupported; it is absent when any link of the response is
 *   undetermined.
 * - `asserted`: the other premises can hold with it false. `counterexample`
 *   is such an assignment; `attemptedSupport` is true when another premise has
 *   the link's content on its consequent side.
 * - `incoherent`: the response's premises cannot all hold, so nothing about
 *   the link is reported.
 * - `undetermined`: the search could not decide.
 * - `invalid`: the response's bindings do not fit the snapshot supplied.
 */
export type TLinkCheckResult =
    | {
          status: "follows"
          supportPremiseIds: string[]
          restsOnlyOnLinks?: boolean
      }
    | {
          status: "asserted"
          attemptedSupport: boolean
          counterexample: TColumnValue[]
      }
    | { status: "incoherent" }
    | { status: "undetermined"; reason: TUndeterminedReason }
    | { status: "invalid"; problems: TLinkViolation[] }

/**
 * Whether all of a response's premises can hold at once. When they cannot,
 * `unsatisfiablePremiseIds` is a minimal set that cannot: removing any one of
 * them lets the rest hold.
 */
export type TResponseCoherenceResult =
    | { status: "checked"; coherent: true }
    | {
          status: "checked"
          coherent: false
          unsatisfiablePremiseIds: string[]
      }
    | { status: "checked"; coherent: null; reason: TUndeterminedReason }
    | { status: "invalid"; problems: TLinkViolation[] }
