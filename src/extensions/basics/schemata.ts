import Type, { type Static } from "typebox"
import { CoreArgumentSchema } from "../../lib/schemata/argument.js"
import {
    CoreClaimAxiomaticTypeSchema,
    CoreClaimCitationTypeSchema,
    CoreClaimNormalTypeSchema,
    CoreClaimSchema,
} from "../../lib/schemata/claim.js"
import { CorePremiseSchema } from "../../lib/schemata/propositional.js"
import { buildParsingResponseSchema } from "../../lib/parsing/schemata.js"

// Parsing response extensions.
//
// These per-entity extension shapes are exported so downstream
// consumers (e.g. `src/extensions/argument-ingestion/shared/
// basics-extension.ts`) can compose against the same definitions
// without duplication. The composite `BasicsParsingSchema` at the
// bottom of the file is the canonical response schema; the per-entity
// `Basics*Extension` consts are the building blocks.
export const BasicsNormalClaimExtension = Type.Object({
    title: Type.String({
        maxLength: 50,
        description: "A short title summarizing the claim",
    }),
    body: Type.String({
        maxLength: 500,
        description: "A detailed description of the claim",
    }),
    type: CoreClaimNormalTypeSchema,
})

export const BasicsCitationClaimExtension = Type.Object({
    title: Type.String({
        maxLength: 50,
        description: "A short title summarizing the claim",
    }),
    url: Type.String({
        maxLength: 500,
        // No `format` here on purpose. This node is serialized straight
        // into the OpenAI strict-mode response schema (the parse
        // executor uses a raw `JSON.parse(JSON.stringify(...))`, not the
        // converter), and OpenAI strict mode rejects any string `format`
        // outside its fixed set — `uri` is not in it, so a declared
        // `format: "uri"` here 400s the parse request. The field is
        // treated as free text: the length steering may project a budget
        // hint, and the post-hoc clamp still allows the full 500 chars.
        description: "The URL of the citation supporting the claim",
    }),
    type: CoreClaimCitationTypeSchema,
})

export const BasicsAxiomaticClaimExtension = Type.Object({
    axiom: Type.String({
        maxLength: 50,
        description: "The axiom supporting the claim",
    }),
    type: CoreClaimAxiomaticTypeSchema,
})

export const BasicsClaimExtension = Type.Union(
    [
        BasicsNormalClaimExtension,
        BasicsCitationClaimExtension,
        BasicsAxiomaticClaimExtension,
    ],
    {
        description:
            "Field extensions for all claim types. Each claim must conform to exactly one of the three extensions below, depending on its type.",
    }
)

/**
 * Variable extension under the basics schema is empty — the core
 * `ParsedVariableSchema` already carries everything the basics
 * pipeline needs. Exported so the ingestion extension descriptor
 * can compose against a single source of truth.
 */
export const BasicsVariableExtension = Type.Object({})

export const BasicsPremiseExtension = Type.Object({
    title: Type.String({
        maxLength: 50,
        description: "A short title for this premise",
    }),
})

export const BasicsArgumentExtension = Type.Object({
    title: Type.String({
        maxLength: 50,
        description: "A short title for the argument",
    }),
})

// Core entity extensions
export const BasicsArgumentSchema = Type.Intersect([
    CoreArgumentSchema,
    BasicsArgumentExtension,
])
export type TBasicsArgument = Static<typeof BasicsArgumentSchema>

export const BasicsNormalClaimSchema = Type.Intersect([
    CoreClaimSchema,
    BasicsNormalClaimExtension,
])
export type TBasicsNormalClaim = Static<typeof BasicsNormalClaimSchema>

export const BasicsCitationClaimSchema = Type.Intersect([
    CoreClaimSchema,
    BasicsCitationClaimExtension,
])
export type TBasicsCitationClaim = Static<typeof BasicsCitationClaimSchema>

export const BasicsAxiomaticClaimSchema = Type.Intersect([
    CoreClaimSchema,
    BasicsAxiomaticClaimExtension,
])
export type TBasicsAxiomaticClaim = Static<typeof BasicsAxiomaticClaimSchema>

export const BasicsClaimSchema = Type.Union([
    BasicsNormalClaimSchema,
    BasicsCitationClaimSchema,
    BasicsAxiomaticClaimSchema,
])
export type TBasicsClaim = Static<typeof BasicsClaimSchema>

export const BasicsPremiseSchema = Type.Intersect([
    CorePremiseSchema,
    BasicsPremiseExtension,
])
export type TBasicsPremise = Static<typeof BasicsPremiseSchema>

export const BasicsParsingSchema = buildParsingResponseSchema({
    claimSchema: BasicsClaimExtension,
    premiseSchema: BasicsPremiseExtension,
    parsedArgumentSchema: BasicsArgumentExtension,
})
