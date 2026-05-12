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

// Parsing response extensions
const BasicsNormalClaimExtension = Type.Object({
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

const BasicsCitationClaimExtension = Type.Object({
    title: Type.String({
        maxLength: 50,
        description: "A short title summarizing the claim",
    }),
    url: Type.String({
        maxLength: 500,
        description: "The URL of the citation supporting the claim",
    }),
    type: CoreClaimCitationTypeSchema,
})

const BasicsAxiomaticClaimExtension = Type.Object({
    axiom: Type.String({
        maxLength: 50,
        description: "The axiom supporting the claim",
    }),
    type: CoreClaimAxiomaticTypeSchema,
})

const BasicsClaimExtension = Type.Union(
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

const BasicsPremiseExtension = Type.Object({
    title: Type.String({
        maxLength: 50,
        description: "A short title for this premise",
    }),
})

const BasicsArgumentExtension = Type.Object({
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
