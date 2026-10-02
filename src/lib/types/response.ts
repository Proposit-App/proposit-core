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

/** A link, named from outside the response that holds it. */
export interface TLinkReference {
    /** The response. */
    argumentId: string
    argumentVersion: number
    /** The link premise within it. */
    premiseId: string
}

/** Something in the argument answered that a link may be about. */
export type TLinkElement =
    | { kind: "claim"; claimId: string }
    | { kind: "expression"; expressionId: string }

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
 * versions of the argument a response answers, read from `targetFrom` to
 * `targetTo`. Nothing compares the two version numbers, so `targetTo` may be
 * the older one; each label then reads in that direction.
 *
 * - `unchanged`: re-pointed by a rebase with no decision.
 * - `changed`: still present, but differs as `reasons` says; needs a
 *   decision.
 * - `removed`: absent from `targetTo`; needs a decision. Read from a newer
 *   version back to an older one, it means the expression was added in the
 *   newer version.
 * - `alreadyRebased`: already bound to `targetTo`, and its expression is
 *   present there.
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
