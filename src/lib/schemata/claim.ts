import Type, { type Static } from "typebox"
import { UUID } from "./shared.js"

export const CoreClaimNormalTypeSchema = Type.Literal("normal", {
    description:
        "Primary reasoning claim type. Can have premises and be cited as evidence for other claims.",
})
export type TCoreClaimNormalType = Static<typeof CoreClaimNormalTypeSchema>

export const CoreClaimCitationTypeSchema = Type.Literal("citation", {
    description:
        "Cited content claim type. Cannot have premises or be cited as evidence for other claims, but can serve as a supporting claim in a citation relationship.",
})
export type TCoreClaimCitationType = Static<typeof CoreClaimCitationTypeSchema>

export const CoreClaimAxiomaticTypeSchema = Type.Literal("axiomatic", {
    description:
        "Self-evident invoked claim type. Cannot have premises or be cited as evidence for other claims, but can serve as a supporting claim in an invocation relationship.",
})
export type TCoreClaimAxiomaticType = Static<
    typeof CoreClaimAxiomaticTypeSchema
>

export const CoreClaimTypeSchema = Type.Union(
    [
        CoreClaimNormalTypeSchema,
        CoreClaimCitationTypeSchema,
        CoreClaimAxiomaticTypeSchema,
    ],
    {
        description:
            "Distinguishes claim roles: 'normal' = primary-reasoning, 'citation' = external cited content, 'axiomatic' = self-evident invoked claim. Immutable post-creation.",
    }
)
export type TCoreClaimType = Static<typeof CoreClaimTypeSchema>

export const CoreClaimSchema = Type.Object(
    {
        id: UUID,
        version: Type.Number({
            description: "Claim version number. Starts at 0.",
        }),
        frozen: Type.Boolean({
            description:
                "Whether this version is frozen (immutable). Frozen versions cannot be updated.",
        }),
        checksum: Type.String({
            description: "Entity-level checksum for sync detection.",
        }),
        type: CoreClaimTypeSchema,
    },
    {
        additionalProperties: true,
        description:
            "A global claim representing propositional content. Variables reference claims by ID and version.",
    }
)
export type TCoreClaim = Static<typeof CoreClaimSchema>
