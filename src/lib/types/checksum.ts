/** Configuration for which fields to include in entity checksums. */
export interface TCoreChecksumConfig {
    /** Fields to hash for expression entities. Defaults to all base expression fields. */
    expressionFields?: Set<string>
    /** Fields to hash for variable entities. Defaults to all variable fields. */
    variableFields?: Set<string>
    /** Fields to hash for premise metadata. Defaults to ["id", "argumentId", "argumentVersion"]. */
    premiseFields?: Set<string>
    /** Fields to hash for argument metadata. Defaults to ["id", "version"]. */
    argumentFields?: Set<string>
    /** Fields to hash for role state. Defaults to ["conclusionPremiseId"]. */
    roleFields?: Set<string>
}
