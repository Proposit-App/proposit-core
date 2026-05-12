# Upcoming release notes

A small schema-surface cleanup. No wire-format change; no migration.

## Public schema rename

`CoreClaimTypesSchema` is now `CoreClaimTypeSchema` (singular). A new
`TCoreClaimType` static type alias accompanies it. The export name was
plural without reason — the field describes one type per claim.

## New per-variant claim-type schemas

The single-literal type schemas used by the claim discriminator are now
exported individually, alongside the existing union:

- `CoreClaimNormalTypeSchema` / `TCoreClaimNormalType`
- `CoreClaimCitationTypeSchema` / `TCoreClaimCitationType`
- `CoreClaimAxiomaticTypeSchema` / `TCoreClaimAxiomaticType`

These let downstream extensions build per-type schema branches without
re-declaring the literal in every consumer.

## Connection schemas unified

`CoreClaimCitationSchema` and `CoreClaimAxiomSchema` (and the matching
`TCoreClaimCitation` / `TCoreClaimAxiom` types) have been removed. Both were
empty wrappers around `CoreClaimConnectionSchema` with no added fields.
Use `CoreClaimConnectionSchema` and `TCoreClaimConnection` directly —
`ClaimCitationLibrary` and `ClaimAxiomLibrary` continue to enforce
citation- vs axiom-specific invariants at the library level.

If you parameterize either library or `PropositCore` with a custom
extension type, the default and constraint are now `TCoreClaimConnection`
instead of the per-variant types. App-level shapes that extend the core
connection schema continue to work unchanged.

## Parser-builder accepts union extensions

`buildParsingResponseSchema` (via the new internal `mergeBaseWithExtension`)
now accepts a `Type.Union` of `Type.Object`s for its `claimSchema`,
`variableSchema`, and `premiseSchema` options. Each non-null branch is
intersected with the corresponding base parsed-entity schema, producing a
discriminated-union response schema that LLMs can satisfy with per-variant
required fields. Plain `Type.Object` extensions continue to work as before.

`clampMaxLengths` now recurses into every non-null branch of an `anyOf`
schema, not just the first one, so `maxLength` clamping applies correctly
to every variant of a discriminated union.

## Basics extension now models claim variants

`BasicsClaimSchema` and its parsing-schema extension are now a
discriminated union over claim `type`:

- `normal` → `{ title, body }`
- `citation` → `{ title, url }`
- `axiomatic` → `{ axiom }`

`BasicsNormalClaimSchema`, `BasicsCitationClaimSchema`, and
`BasicsAxiomaticClaimSchema` are exported individually so callers can
narrow to a specific variant when needed.
