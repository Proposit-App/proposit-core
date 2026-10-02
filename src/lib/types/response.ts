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

/**
 * Where an expression sits in its argument, as far as moving a response to a
 * newer version of that argument is concerned.
 *
 * - `freeformRoot`: the root of a premise that is neither the conclusion nor
 *   a derivation premise.
 * - `conclusionRoot`: the root of the conclusion premise.
 * - `nested`: below the root of a premise that is not a derivation premise.
 * - `inDerivation`: anywhere in a derivation premise.
 */
export type TPositionClass =
    | "freeformRoot"
    | "conclusionRoot"
    | "nested"
    | "inDerivation"

/**
 * Why an expression binding is classified as changed.
 *
 * - `content`: the bound expression's structure differs, or something it
 *   references in another argument differs between the two versions it is
 *   pinned to.
 * - `position`: the bound expression's position class differs.
 * - `outsideReferenceRepinned`: something the bound expression references in
 *   another argument is pinned to a different version, and the snapshots
 *   needed to compare the two versions were not supplied.
 */
export type TBindingChangeReason =
    | "content"
    | "position"
    | "outsideReferenceRepinned"

/** One premise of a response that dropping a variable would remove. */
export interface TBindingPremiseUse {
    premiseId: string
    /** Whether the premise is a link. */
    isLink: boolean
    /**
     * False when the premise uses the variable itself. True when it is
     * reached only because it uses a variable bound to another premise that
     * dropping removes: removing a premise removes the variables bound to it,
     * and with them every expression that uses them.
     */
    cascaded: boolean
}

interface TBindingClassificationBase {
    variableId: string
    /** The bound expression, as the variable names it before any rebase. */
    boundExpressionId: string
    boundAspect: TBoundAspect
    /** The version of the answered argument the variable is bound to now. */
    boundArgumentVersion: number
    /** Every premise dropping the variable would remove. */
    premises: TBindingPremiseUse[]
}

/**
 * What happened to one expression-bound variable's expression between two
 * versions of the argument a response answers.
 *
 * - `unchanged`: re-pointed by a rebase with no decision.
 * - `changed`: still present, but differs as `reasons` says; needs a
 *   decision.
 * - `removed`: absent from the newer version; needs a decision.
 * - `alreadyRebased`: already bound to the newer version, and its expression
 *   is present there.
 */
export type TBindingClassification = TBindingClassificationBase &
    (
        | { status: "unchanged" }
        | { status: "changed"; reasons: TBindingChangeReason[] }
        | { status: "removed" }
        | { status: "alreadyRebased" }
    )

/**
 * A claim-bound variable of a response for a claim the newer version of the
 * answered argument uses and the older one did not. A response affirms such
 * a claim through a link, so the variable needs a decision.
 */
export interface TClaimBindingConflict {
    variableId: string
    claimId: string
    /** Every premise dropping the variable would remove. */
    premises: TBindingPremiseUse[]
}

/** The result of classifying a response's bindings against a newer target. */
export interface TBindingClassificationResult {
    /** One entry per expression-bound variable, in variable order. */
    bindings: TBindingClassification[]
    claimBindingConflicts: TClaimBindingConflict[]
}

/**
 * The decision for one changed or removed expression binding.
 *
 * - `keep`: re-point the variable to the same expression of the newer
 *   version, accepting its new content. Not available for a removed one.
 * - `retarget`: bind the variable, in the same aspect, to another expression
 *   of the newer version.
 * - `drop`: remove the variable and every premise listed for it.
 */
export type TBindingDecision =
    | { action: "keep" }
    | { action: "retarget"; expressionId: string }
    | { action: "drop" }

/**
 * The decision for one claim-binding conflict.
 *
 * - `convertToLink`: replace the claim-bound variable, wherever it is used,
 *   with a statement binding to `expressionId`, a variable expression of the
 *   same claim in the newer version, and add an affirm link for it if the
 *   response has none.
 * - `drop`: remove the variable and every premise listed for it.
 */
export type TClaimConflictDecision =
    | { action: "convertToLink"; expressionId: string }
    | { action: "drop" }

/** The caller's decisions for a rebase, keyed by variable id. */
export interface TRebaseDecisions {
    bindings?: Record<string, TBindingDecision>
    claimBindingConflicts?: Record<string, TClaimConflictDecision>
}
