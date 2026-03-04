/** Configuration for which fields to include in entity checksums. */
export interface TCoreChecksumConfig {
    /** Fields to hash for expression entities. Defaults to all base expression fields. */
    expressionFields?: string[]
    /** Fields to hash for variable entities. Defaults to all variable fields. */
    variableFields?: string[]
    /** Fields to hash for premise metadata. Defaults to ["id", "rootExpressionId"]. */
    premiseFields?: string[]
    /** Fields to hash for argument metadata. Defaults to ["id", "version"]. */
    argumentFields?: string[]
    /** Fields to hash for role state. Defaults to ["conclusionPremiseId"]. */
    roleFields?: string[]
}
