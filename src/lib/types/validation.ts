export type TInvariantViolationEntityType =
    | "expression"
    | "variable"
    | "premise"
    | "argument"
    | "claim"
    | "source"
    | "association"

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
export const EXPR_FORMULA_BETWEEN_OPERATORS_VIOLATED =
    "EXPR_FORMULA_BETWEEN_OPERATORS_VIOLATED"
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

// -- SourceLibrary codes --
export const SOURCE_SCHEMA_INVALID = "SOURCE_SCHEMA_INVALID"
export const SOURCE_FROZEN_NO_SUCCESSOR = "SOURCE_FROZEN_NO_SUCCESSOR"

// -- ClaimSourceLibrary codes --
export const ASSOC_SCHEMA_INVALID = "ASSOC_SCHEMA_INVALID"
export const ASSOC_DUPLICATE_ID = "ASSOC_DUPLICATE_ID"
export const ASSOC_CLAIM_REF_NOT_FOUND = "ASSOC_CLAIM_REF_NOT_FOUND"
export const ASSOC_SOURCE_REF_NOT_FOUND = "ASSOC_SOURCE_REF_NOT_FOUND"
