import type { TSchema } from "typebox"

export type TPromptOptions = {
    customInstructions?: string
}

export type TParsingSchemaOptions = {
    claimSchema?: TSchema
    sourceSchema?: TSchema
    variableSchema?: TSchema
    premiseSchema?: TSchema
    parsedArgumentSchema?: TSchema
    responseSchema?: TSchema
}

export type TParserWarningCode =
    | "UNRESOLVED_SOURCE_MINIID"
    | "UNRESOLVED_CLAIM_MINIID"
    | "UNRESOLVED_CONCLUSION_MINIID"
    | "UNDECLARED_VARIABLE_SYMBOL"
    | "FORMULA_PARSE_ERROR"
    | "FORMULA_STRUCTURE_ERROR"

export type TParserWarning = {
    code: TParserWarningCode
    message: string
    context: Record<string, string>
}

export type TParserBuildOptions = {
    strict?: boolean
    /** UUID generator for new entity IDs. Defaults to `globalThis.crypto.randomUUID()`. */
    generateId?: () => string
}
