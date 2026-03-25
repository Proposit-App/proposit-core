import Type, { type Static, type TObject, type TSchema } from "typebox"
import { Nullable } from "../schemata/shared.js"
import type { TParsingSchemaOptions } from "./types.js"

export const ParsedClaimRoleType = Type.Union([
    Type.Literal("premise"),
    Type.Literal("conclusion"),
    Type.Literal("intermediate"),
])

export const ParsedClaimSchema = Type.Object(
    {
        miniId: Type.String(),
        role: ParsedClaimRoleType,
        sourceMiniIds: Type.Array(Type.String(), {
            description:
                "MiniIds of external sources (citations/references from the sources array, e.g. s1, s2). Must NOT contain claim miniIds — logical dependencies between claims are expressed through premises and formulas, not here.",
        }),
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

export const ParsedSourceSchema = Type.Object(
    {
        miniId: Type.String(),
        text: Type.String(),
    },
    { additionalProperties: true }
)
export type TParsedSource = Static<typeof ParsedSourceSchema>

export const ParsedPremiseSchema = Type.Object(
    {
        miniId: Type.String(),
        formula: Type.String(),
    },
    { additionalProperties: true }
)
export type TParsedPremise = Static<typeof ParsedPremiseSchema>

export const ParsedArgumentSchema = Type.Object(
    {
        claims: Type.Array(ParsedClaimSchema, { minItems: 1 }),
        variables: Type.Array(ParsedVariableSchema, { minItems: 1 }),
        sources: Type.Array(ParsedSourceSchema),
        premises: Type.Array(ParsedPremiseSchema, { minItems: 1 }),
        conclusionPremiseMiniId: Type.String(),
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

function mergeObjectSchemas(base: TObject, extension: TObject): TObject {
    return Type.Object(
        { ...base.properties, ...extension.properties },
        { additionalProperties: true }
    )
}

export function buildParsingResponseSchema(
    options?: TParsingSchemaOptions
): TSchema {
    if (!options) return ParsedArgumentResponseSchema

    const claimSch = options.claimSchema
        ? mergeObjectSchemas(ParsedClaimSchema, options.claimSchema as TObject)
        : ParsedClaimSchema

    const variableSch = options.variableSchema
        ? mergeObjectSchemas(
              ParsedVariableSchema,
              options.variableSchema as TObject
          )
        : ParsedVariableSchema

    const sourceSch = options.sourceSchema
        ? mergeObjectSchemas(
              ParsedSourceSchema,
              options.sourceSchema as TObject
          )
        : ParsedSourceSchema

    const premiseSch = options.premiseSchema
        ? mergeObjectSchemas(
              ParsedPremiseSchema,
              options.premiseSchema as TObject
          )
        : ParsedPremiseSchema

    const baseArgProps = {
        claims: Type.Array(claimSch, { minItems: 1 }),
        variables: Type.Array(variableSch, { minItems: 1 }),
        sources: Type.Array(sourceSch),
        premises: Type.Array(premiseSch, { minItems: 1 }),
        conclusionPremiseMiniId: Type.String(),
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

export function getParsingResponseSchema(
    schema?: TSchema
): Record<string, unknown> {
    const target = schema ?? ParsedArgumentResponseSchema
    return JSON.parse(JSON.stringify(target)) as Record<string, unknown>
}
