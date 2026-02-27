import Type, { type Static } from "typebox"

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
    formula: Type.String(),
})

export type TCoreYamlPremise = Static<typeof CoreYamlPremiseSchema>

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
    premises: Type.Array(CoreYamlPremiseSchema, { minItems: 1 }),
})

export type TCoreYamlArgument = Static<typeof CoreYamlArgumentSchema>
