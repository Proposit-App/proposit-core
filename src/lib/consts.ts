import type { TCoreChecksumConfig } from "./types/checksum.js"

export const DEFAULT_CHECKSUM_CONFIG: Readonly<TCoreChecksumConfig> = {
    expressionFields: new Set([
        "id",
        "type",
        "parentId",
        "position",
        "argumentId",
        "argumentVersion",
        "premiseId",
        "variableId",
        "operator",
    ]),
    variableFields: new Set(["id", "symbol", "argumentId", "argumentVersion"]),
    premiseFields: new Set([
        "id",
        "argumentId",
        "argumentVersion",
        "rootExpressionId",
    ]),
    argumentFields: new Set(["id", "version"]),
    roleFields: new Set(["conclusionPremiseId"]),
}

/**
 * Creates a checksum config by merging additional fields into the defaults.
 * Omitted fields in `additional` inherit defaults. Fields are unioned, not replaced.
 */
export function createChecksumConfig(
    additional: TCoreChecksumConfig
): TCoreChecksumConfig {
    const keys = [
        "expressionFields",
        "variableFields",
        "premiseFields",
        "argumentFields",
        "roleFields",
    ] as const
    const result: TCoreChecksumConfig = {}
    for (const key of keys) {
        const base = DEFAULT_CHECKSUM_CONFIG[key]!
        const extra = additional[key]
        result[key] = extra ? new Set([...base, ...extra]) : new Set(base)
    }
    return result
}
