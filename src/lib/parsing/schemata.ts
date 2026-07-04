import Type, { type Static, type TObject, type TSchema } from "typebox"
import { Nullable } from "../schemata/shared.js"
import type { TParsingSchemaOptions } from "./types.js"
import { CoreClaimTypeSchema } from "../schemata/claim.js"

export const ParsedClaimRoleType = Type.Union([
    Type.Literal("premise"),
    Type.Literal("conclusion"),
    Type.Literal("intermediate"),
])

export const ParsedClaimTypeType = CoreClaimTypeSchema

export const ParsedClaimSchema = Type.Object(
    {
        miniId: Type.String(),
        role: ParsedClaimRoleType,
        type: ParsedClaimTypeType,
    },
    { additionalProperties: true }
)
export type TParsedClaim = Static<typeof ParsedClaimSchema>

export const ParsedVariableSchema = Type.Object(
    {
        miniId: Type.String(),
        symbol: Type.String(),
        claimMiniId: Type.String(),
    },
    { additionalProperties: true }
)
export type TParsedVariable = Static<typeof ParsedVariableSchema>

export const ParsedPremiseSchema = Type.Object(
    {
        miniId: Type.String(),
        formula: Type.String(),
    },
    { additionalProperties: true }
)
export type TParsedPremise = Static<typeof ParsedPremiseSchema>

// Citation/axiomatic backing extracted from inference antecedents during
// formula compilation: each entry grounds `derivedClaimMiniId` with the
// listed citation/axiomatic supporting claims. The parser materializes
// these into derivation edges (claim-citation / claim-axiom links).
export const ParsedDerivationBackingSchema = Type.Object({
    derivedClaimMiniId: Type.String(),
    supportingClaimMiniIds: Type.Array(Type.String()),
})
export type TParsedDerivationBacking = Static<
    typeof ParsedDerivationBackingSchema
>

export const ParsedArgumentSchema = Type.Object(
    {
        claims: Type.Array(ParsedClaimSchema, { minItems: 1 }),
        variables: Type.Array(ParsedVariableSchema, { minItems: 1 }),
        premises: Type.Array(ParsedPremiseSchema, { minItems: 1 }),
        conclusionPremiseMiniId: Type.String(),
        derivationBacking: Type.Optional(
            Type.Array(ParsedDerivationBackingSchema)
        ),
    },
    { additionalProperties: true }
)
export type TParsedArgument = Static<typeof ParsedArgumentSchema>

export const ParsedArgumentResponseSchema = Type.Object(
    {
        argument: Nullable(ParsedArgumentSchema),
        uncategorizedText: Nullable(Type.String()),
        selectionRationale: Nullable(Type.String()),
        failureText: Nullable(Type.String()),
    },
    { additionalProperties: true }
)
export type TParsedArgumentResponse = Static<
    typeof ParsedArgumentResponseSchema
>

function mergeBaseWithExtension(base: TObject, extension: TSchema): TSchema {
    const ext = extension as Record<string, unknown>
    const anyOf = ext.anyOf as TSchema[] | undefined
    if (Array.isArray(anyOf)) {
        const branches = anyOf.map((branch) => {
            const branchProps = (branch as Record<string, unknown>)
                .properties as Record<string, TSchema> | undefined
            if (!branchProps) {
                throw new Error(
                    "buildParsingResponseSchema: union extension branches must be object schemas."
                )
            }
            return Type.Object(
                { ...base.properties, ...branchProps },
                { additionalProperties: true }
            )
        })
        const description =
            typeof ext.description === "string" ? ext.description : undefined
        return Type.Union(branches, description ? { description } : undefined)
    }
    const objProps = ext.properties as Record<string, TSchema> | undefined
    if (!objProps) {
        throw new Error(
            "buildParsingResponseSchema: extension must be a Type.Object or a Type.Union of Type.Objects."
        )
    }
    return Type.Object(
        { ...base.properties, ...objProps },
        { additionalProperties: true }
    )
}

/** Builds a composite response schema by merging optional per-entity schema extensions into the base parsing schemata. */
export function buildParsingResponseSchema(
    options?: TParsingSchemaOptions
): TSchema {
    if (!options) return ParsedArgumentResponseSchema

    const claimSch = options.claimSchema
        ? mergeBaseWithExtension(ParsedClaimSchema, options.claimSchema)
        : ParsedClaimSchema

    const variableSch = options.variableSchema
        ? mergeBaseWithExtension(ParsedVariableSchema, options.variableSchema)
        : ParsedVariableSchema

    const premiseSch = options.premiseSchema
        ? mergeBaseWithExtension(ParsedPremiseSchema, options.premiseSchema)
        : ParsedPremiseSchema

    const baseArgProps = {
        claims: Type.Array(claimSch, { minItems: 1 }),
        variables: Type.Array(variableSch, { minItems: 1 }),
        premises: Type.Array(premiseSch, { minItems: 1 }),
        conclusionPremiseMiniId: Type.String(),
        derivationBacking: Type.Optional(
            Type.Array(ParsedDerivationBackingSchema)
        ),
    }

    const argSch = options.parsedArgumentSchema
        ? Type.Object(
              {
                  ...baseArgProps,
                  ...(options.parsedArgumentSchema as TObject).properties,
              },
              { additionalProperties: true }
          )
        : Type.Object(baseArgProps, { additionalProperties: true })

    const baseResponseProps = {
        argument: Nullable(argSch),
        uncategorizedText: Nullable(Type.String()),
        selectionRationale: Nullable(Type.String()),
        failureText: Nullable(Type.String()),
    }

    const responseSch = options.responseSchema
        ? Type.Object(
              {
                  ...baseResponseProps,
                  ...(options.responseSchema as TObject).properties,
              },
              { additionalProperties: true }
          )
        : Type.Object(baseResponseProps, { additionalProperties: true })

    return responseSch
}

/** Returns a plain JSON-serializable copy of the given schema (defaults to {@link ParsedArgumentResponseSchema}). */
export function getParsingResponseSchema(
    schema?: TSchema
): Record<string, unknown> {
    const target = schema ?? ParsedArgumentResponseSchema
    return structuredClone(target) as Record<string, unknown>
}
