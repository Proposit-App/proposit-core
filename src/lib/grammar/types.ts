// Grammar wire format — TypeBox schemas + derived TypeScript types.
//
// proposit-core owns these types. proposit-shared re-exports them from
// `@proposit/shared/schemas/grammar` for consumer ergonomics; server and
// mobile may import from either repo. The 422 response envelope that
// composes ViolationSchema lives in shared (`@proposit/shared/schemas/api/grammar-violations`).
//
// The four grammar tiers form a strict subset chain
// (Structural ⊇ Evaluable ⊇ Derivable ⊇ Presentable). See
// docs/Proposit_Grammar.md §2 for the model and §3 for the per-rule
// inventory.
//
// Codes 'E-2' and 'D-7' are intentionally absent — those rules were
// promoted/restated in the spec (E-2 → S-13 per §4.2; D-7 → E-6 per
// §4.3) and their codes are reserved (not reused) so historical
// references remain unambiguous. Adding or renaming a rule code is a
// single-repo coordinated change (TypeScript catches drift between
// rule-identifier strings and validator implementations at build time).

import Type, { type Static } from "typebox"

// -- Tier --

export const GrammarTierSchema = Type.Union([
    Type.Literal("structural"),
    Type.Literal("evaluable"),
    Type.Literal("derivable"),
    Type.Literal("presentable"),
])

export type TGrammarTier = Static<typeof GrammarTierSchema>

// -- Rule code --

export const GrammarRuleCodeSchema = Type.Union([
    // Structural (S-1..S-14)
    Type.Literal("S-1"),
    Type.Literal("S-2"),
    Type.Literal("S-3"),
    Type.Literal("S-4"),
    Type.Literal("S-5"),
    Type.Literal("S-6"),
    Type.Literal("S-7"),
    Type.Literal("S-8"),
    Type.Literal("S-9"),
    Type.Literal("S-10"),
    Type.Literal("S-11"),
    Type.Literal("S-12"),
    Type.Literal("S-13"),
    Type.Literal("S-14"),
    // Evaluable (E-1, E-3..E-7 — 'E-2' reserved)
    Type.Literal("E-1"),
    Type.Literal("E-3"),
    Type.Literal("E-4"),
    Type.Literal("E-5"),
    Type.Literal("E-6"),
    Type.Literal("E-7"),
    // Derivable (D-1..D-6 — 'D-7' reserved)
    Type.Literal("D-1"),
    Type.Literal("D-2"),
    Type.Literal("D-3"),
    Type.Literal("D-4"),
    Type.Literal("D-5"),
    Type.Literal("D-6"),
    // Presentable (P-1..P-6)
    Type.Literal("P-1"),
    Type.Literal("P-2"),
    Type.Literal("P-3"),
    Type.Literal("P-4"),
    Type.Literal("P-5"),
    Type.Literal("P-6"),
])

export type TGrammarRuleCode = Static<typeof GrammarRuleCodeSchema>

// -- Violation --

// `tier` and `code` are constrained unions. `message` is a human-readable
// string the UI may localize/replace. The locator fields are all optional
// because some rules apply argument-wide and have no per-entity locator.
// `additionalProperties: true` reserves an extension slot for rule-specific
// context fields the validator may attach (e.g., D-3 might attach
// `mixedCitationCount`/`mixedAxiomCount` for UI rendering — see spec §7.1).
export const ViolationSchema = Type.Object(
    {
        tier: GrammarTierSchema,
        code: GrammarRuleCodeSchema,
        message: Type.String(),
        argumentId: Type.Optional(Type.String()),
        premiseId: Type.Optional(Type.String()),
        expressionId: Type.Optional(Type.String()),
        variableId: Type.Optional(Type.String()),
        claimId: Type.Optional(Type.String()),
    },
    { additionalProperties: true }
)

export type TViolation = Static<typeof ViolationSchema>
