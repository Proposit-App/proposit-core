import Type, { type Static } from "typebox"
import { UUID } from "./shared.js"
import { CoreClaimTypeSchema } from "./claim.js"

export const CoreYamlPremiseMetadataSchema = Type.Object(
    {
        title: Type.Optional(Type.String()),
    },
    { additionalProperties: Type.String() }
)
export type TCoreYamlPremiseMetadata = Static<
    typeof CoreYamlPremiseMetadataSchema
>

export const CoreYamlPremiseSchema = Type.Object({
    metadata: Type.Optional(CoreYamlPremiseMetadataSchema),
    role: Type.Optional(
        Type.Union([Type.Literal("conclusion"), Type.Literal("supporting")])
    ),
    /** Required for freeform premises; omit for derivation premises. */
    formula: Type.Optional(Type.String()),
    /**
     * Premise type. Defaults to `"freeform"` when omitted.
     * Use `"derivation"` together with `derivedClaimId` to declare a
     * derivation premise; `formula` must be omitted in that case.
     */
    type: Type.Optional(
        Type.Union([Type.Literal("freeform"), Type.Literal("derivation")])
    ),
    /**
     * Required when `type` is `"derivation"`. Must match the `id` of a claim
     * declared in the top-level `claims` array.
     */
    derivedClaimId: Type.Optional(UUID),
})

export type TCoreYamlPremise = Static<typeof CoreYamlPremiseSchema>

/** A claim declared inline at the top level of a YAML argument file. */
export const CoreYamlClaimSchema = Type.Object(
    {
        id: UUID,
        type: CoreClaimTypeSchema,
        title: Type.Optional(Type.String()),
    },
    { additionalProperties: true }
)
export type TCoreYamlClaim = Static<typeof CoreYamlClaimSchema>

export const CoreYamlArgumentMetadataSchema = Type.Object(
    {
        title: Type.String(),
        description: Type.Optional(Type.String({ default: "" })),
    },
    { additionalProperties: Type.String() }
)
export type TCoreYamlArgumentMetadata = Static<
    typeof CoreYamlArgumentMetadataSchema
>

export const CoreYamlArgumentSchema = Type.Object({
    metadata: CoreYamlArgumentMetadataSchema,
    /** Optional inline claim declarations. Required when any premise uses `type: "derivation"`. */
    claims: Type.Optional(Type.Array(CoreYamlClaimSchema)),
    premises: Type.Array(CoreYamlPremiseSchema, { minItems: 1 }),
})

export type TCoreYamlArgument = Static<typeof CoreYamlArgumentSchema>
