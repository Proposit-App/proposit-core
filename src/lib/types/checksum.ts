/** Configuration for which fields to include in entity checksums. */
export interface TCoreChecksumConfig {
    /** Fields to hash for expression entities. Defaults to all base expression fields except `id`. */
    expressionFields?: Set<string>
    /** Fields to hash for variable entities. Defaults to all variable fields except `id`. */
    variableFields?: Set<string>
    /** Fields to hash for premise metadata. Defaults to ["argumentId", "argumentVersion"]. */
    premiseFields?: Set<string>
    /** Fields to hash for argument metadata. Defaults to ["version"]. */
    argumentFields?: Set<string>
    /** Fields to hash for role state. Defaults to ["conclusionPremiseId"]. */
    roleFields?: Set<string>
    /** Fields to hash for claim entities. Defaults to ["version", "type"]. */
    claimFields?: Set<string>
    /** Fields to hash for claim citations. Defaults to ["claimId", "claimVersion", "supportingClaimId", "supportingClaimVersion"]. */
    claimCitationFields?: Set<string>
    /** Fields to hash for claim axioms. Defaults to ["claimId", "claimVersion", "supportingClaimId", "supportingClaimVersion"]. */
    claimAxiomFields?: Set<string>
}
