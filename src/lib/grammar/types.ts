// PHASE A STUB. In Phase B0 the body of this file is replaced with a
// re-export from `@proposit/shared/schemas/grammar`. The exported names
// (`TGrammarTier`, `TGrammarRuleCode`, `TViolation`) remain unchanged, so
// internal callers do not need to rewrite imports across the swap.
//
// Definitions kept identical to the spec at
// proposit-orchestration/docs/superpowers/specs/2026-05-13-grammar-tiers-design.md
// §7.1 so the swap is structurally transparent.

export type TGrammarTier =
    | "structural"
    | "evaluable"
    | "derivable"
    | "presentable"

// Codes 'E-2' and 'D-7' are intentionally absent — those rules were
// promoted/restated in the spec and their codes are reserved (not reused)
// to keep historical references unambiguous.
export type TGrammarRuleCode =
    | "S-1"
    | "S-2"
    | "S-3"
    | "S-4"
    | "S-5"
    | "S-6"
    | "S-7"
    | "S-8"
    | "S-9"
    | "S-10"
    | "S-11"
    | "S-12"
    | "S-13"
    | "S-14"
    | "E-1"
    | "E-3"
    | "E-4"
    | "E-5"
    | "E-6"
    | "E-7"
    | "D-1"
    | "D-2"
    | "D-3"
    | "D-4"
    | "D-5"
    | "D-6"
    | "P-1"
    | "P-2"
    | "P-3"
    | "P-4"
    | "P-5"

export type TViolation = {
    tier: TGrammarTier
    code: TGrammarRuleCode
    message: string
    argumentId?: string
    premiseId?: string
    expressionId?: string
    variableId?: string
    claimId?: string
}
