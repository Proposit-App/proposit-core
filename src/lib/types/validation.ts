export type TInvariantViolationEntityType =
    | "expression"
    | "variable"
    | "premise"
    | "argument"
    | "claim"
    | "citation"
    | "axiom"
    | "fork"
    | "forkRecord"
    | "originDocument"
    | "originLink"
    | "originAnchor"

export type TInvariantViolation = {
    code: string
    message: string
    entityType: TInvariantViolationEntityType
    entityId: string
    premiseId?: string
}

export type TInvariantValidationResult = {
    ok: boolean
    violations: TInvariantViolation[]
}

// -- Expression-level codes --
export const EXPR_SCHEMA_INVALID = "EXPR_SCHEMA_INVALID"
export const EXPR_DUPLICATE_ID = "EXPR_DUPLICATE_ID"
export const EXPR_SELF_REFERENTIAL_PARENT = "EXPR_SELF_REFERENTIAL_PARENT"
export const EXPR_PARENT_NOT_FOUND = "EXPR_PARENT_NOT_FOUND"
export const EXPR_PARENT_NOT_CONTAINER = "EXPR_PARENT_NOT_CONTAINER"
export const EXPR_ROOT_ONLY_VIOLATED = "EXPR_ROOT_ONLY_VIOLATED"
// `EXPR_FORMULA_BETWEEN_OPERATORS_VIOLATED` has been removed. P-1
// enforcement moved out of the legacy validate() invariant sweep and
// into the grammar-tier validators in
// `src/lib/grammar/validators/presentable.ts` (queryable via
// `engine.validate('presentable')`).
export const EXPR_CHILD_LIMIT_EXCEEDED = "EXPR_CHILD_LIMIT_EXCEEDED"
export const EXPR_POSITION_DUPLICATE = "EXPR_POSITION_DUPLICATE"
export const EXPR_CHECKSUM_MISMATCH = "EXPR_CHECKSUM_MISMATCH"

// -- Premise-level codes --
export const PREMISE_SCHEMA_INVALID = "PREMISE_SCHEMA_INVALID"
export const PREMISE_ROOT_EXPRESSION_INVALID = "PREMISE_ROOT_EXPRESSION_INVALID"
export const PREMISE_VARIABLE_REF_NOT_FOUND = "PREMISE_VARIABLE_REF_NOT_FOUND"
export const PREMISE_CHECKSUM_MISMATCH = "PREMISE_CHECKSUM_MISMATCH"

// -- Variable-level codes --
export const VAR_SCHEMA_INVALID = "VAR_SCHEMA_INVALID"
export const VAR_DUPLICATE_ID = "VAR_DUPLICATE_ID"
export const VAR_DUPLICATE_SYMBOL = "VAR_DUPLICATE_SYMBOL"
export const VAR_CHECKSUM_MISMATCH = "VAR_CHECKSUM_MISMATCH"

// -- Argument-level codes --
export const ARG_SCHEMA_INVALID = "ARG_SCHEMA_INVALID"
export const ARG_OWNERSHIP_MISMATCH = "ARG_OWNERSHIP_MISMATCH"
export const ARG_CLAIM_REF_NOT_FOUND = "ARG_CLAIM_REF_NOT_FOUND"
export const ARG_PREMISE_REF_NOT_FOUND = "ARG_PREMISE_REF_NOT_FOUND"
export const ARG_CIRCULARITY_DETECTED = "ARG_CIRCULARITY_DETECTED"
export const ARG_CONCLUSION_NOT_FOUND = "ARG_CONCLUSION_NOT_FOUND"
export const ARG_CHECKSUM_MISMATCH = "ARG_CHECKSUM_MISMATCH"

// -- ClaimLibrary codes --
export const CLAIM_SCHEMA_INVALID = "CLAIM_SCHEMA_INVALID"
export const CLAIM_FROZEN_NO_SUCCESSOR = "CLAIM_FROZEN_NO_SUCCESSOR"

// -- ClaimLibrary type-immutability and legacy codes --
export const CLAIM_TYPE_IMMUTABLE = "CLAIM_TYPE_IMMUTABLE"
export const LEGACY_CLAIM_MISSING_TYPE = "LEGACY_CLAIM_MISSING_TYPE"

// -- ClaimCitationLibrary codes --
export const CITATION_SCHEMA_INVALID = "CITATION_SCHEMA_INVALID"
export const CITATION_DUPLICATE_ID = "CITATION_DUPLICATE_ID"
export const CITATION_CLAIM_REF_NOT_FOUND = "CITATION_CLAIM_REF_NOT_FOUND"
export const CITATION_SUPPORTING_REF_NOT_FOUND =
    "CITATION_SUPPORTING_REF_NOT_FOUND"
export const CITATION_SUPPORTING_NOT_CITATION_TYPE =
    "CITATION_SUPPORTING_NOT_CITATION_TYPE"
export const CITATION_CYCLE_DETECTED = "CITATION_CYCLE_DETECTED"
export const CITATION_NOT_FOUND = "CITATION_NOT_FOUND"

// -- ClaimCitationLibrary legacy codes --
export const LEGACY_CLAIM_CITATION_SHAPE = "LEGACY_CLAIM_CITATION_SHAPE"

// -- AxiomLibrary codes --
export const AXIOM_SCHEMA_INVALID = "AXIOM_SCHEMA_INVALID"
export const AXIOM_DUPLICATE_ID = "AXIOM_DUPLICATE_ID"
export const AXIOM_CLAIM_REF_NOT_FOUND = "AXIOM_CLAIM_REF_NOT_FOUND"
export const AXIOM_SUPPORTING_REF_NOT_FOUND = "AXIOM_SUPPORTING_REF_NOT_FOUND"
export const AXIOM_SUPPORTING_NOT_AXIOMATIC_TYPE =
    "AXIOM_SUPPORTING_NOT_AXIOMATIC_TYPE"
export const AXIOM_CLAIM_NOT_NORMAL_TYPE = "AXIOM_CLAIM_NOT_NORMAL_TYPE"
export const AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN =
    "AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN"
export const AXIOM_NOT_FOUND = "AXIOM_NOT_FOUND"

// -- AxiomLibrary legacy codes --
export const LEGACY_MISSING_AXIOM_SLOT = "LEGACY_MISSING_AXIOM_SLOT"

// -- OriginLibrary codes --
export const ORIGIN_DOCUMENT_SCHEMA_INVALID = "ORIGIN_DOCUMENT_SCHEMA_INVALID"
export const ORIGIN_LINK_SCHEMA_INVALID = "ORIGIN_LINK_SCHEMA_INVALID"
export const ORIGIN_ANCHOR_SCHEMA_INVALID = "ORIGIN_ANCHOR_SCHEMA_INVALID"
export const ORIGIN_DOCUMENT_DUPLICATE_ID = "ORIGIN_DOCUMENT_DUPLICATE_ID"
export const ORIGIN_LINK_DUPLICATE_ID = "ORIGIN_LINK_DUPLICATE_ID"
export const ORIGIN_ANCHOR_DUPLICATE_ID = "ORIGIN_ANCHOR_DUPLICATE_ID"
export const ORIGIN_DOCUMENT_REF_NOT_FOUND = "ORIGIN_DOCUMENT_REF_NOT_FOUND"
export const ORIGIN_DOCUMENT_DIGEST_MISMATCH = "ORIGIN_DOCUMENT_DIGEST_MISMATCH"
export const ORIGIN_DOCUMENT_TEXT_NOT_NORMALIZED =
    "ORIGIN_DOCUMENT_TEXT_NOT_NORMALIZED"
export const ORIGIN_ANCHOR_SPAN_OUT_OF_RANGE = "ORIGIN_ANCHOR_SPAN_OUT_OF_RANGE"
/** The anchor's span does not slice out its own quote — an anchor at an unverified offset. */
export const ORIGIN_ANCHOR_QUOTE_MISMATCH = "ORIGIN_ANCHOR_QUOTE_MISMATCH"
export const ORIGIN_DOCUMENT_NOT_FOUND = "ORIGIN_DOCUMENT_NOT_FOUND"
export const ORIGIN_LINK_NOT_FOUND = "ORIGIN_LINK_NOT_FOUND"
export const ORIGIN_ANCHOR_NOT_FOUND = "ORIGIN_ANCHOR_NOT_FOUND"
export const ORIGIN_DOCUMENT_IN_USE = "ORIGIN_DOCUMENT_IN_USE"

// -- Derivation premise errors --
// `DERIVATION_TYPE_MISMATCH`, `DERIVATION_CONSEQUENT_LOCKED`,
// `DERIVATION_ROOT_OPERATOR_INVALID`, and `DERIVATION_ANTECEDENT_NON_EMPTY`
// have been removed as part of the v1.0 cleanup — they were
// engine-error code constants that became orphaned when the managed
// derivation-premise engine was removed. The four behaviors they
// powered are now surfaced via the Derivable-tier validators
// (D-1..D-6) reachable through `engine.validate('derivable')`.
// `DERIVATION_STRUCTURE_INVALID_AT_EVALUATION` has also been removed,
// alongside the legacy `engine.validate()` no-arg overload — the
// pre-1.0 evaluation throw on naked-Q is replaced by the
// asEvaluationContext-level skip in `ArgumentEngine` (per spec §4.2);
// the wrapper validators (`validateEvaluability` +
// `validateDerivationStructures`) that overrode the code now pass
// through `DERIVATION_STRUCTURE_INVALID` unchanged from the underlying
// derivation-validation utility.
// `DERIVATION_STRUCTURE_INVALID` stays — actively used by the
// derivation-validation utility and surfaced through
// `validateEvaluability` / `validateDerivationStructures`.
export const DERIVATION_STRUCTURE_INVALID = "DERIVATION_STRUCTURE_INVALID"
export const CREATE_DERIVATION_REQUIRES_DERIVED_CLAIM_ID =
    "CREATE_DERIVATION_REQUIRES_DERIVED_CLAIM_ID"
export const CREATE_DERIVATION_CLAIM_NOT_FOUND =
    "CREATE_DERIVATION_CLAIM_NOT_FOUND"
export const CLAIM_NOT_FOUND = "CLAIM_NOT_FOUND"
export const LEGACY_PREMISE_MISSING_TYPE = "LEGACY_PREMISE_MISSING_TYPE"

// -- ForkNamespace codes --
export const FORK_RECORD_SCHEMA_INVALID = "FORK_RECORD_SCHEMA_INVALID"
