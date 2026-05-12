# Upcoming changelog

Cleanups and documentation following the v0.12.2 parser overhaul. No
behavior changes; no API changes.

## Refactors

- **`ArgumentParser.build()`** — citation and axiom edge routing now share
  a single internal helper (`tryAddSupportEdge`). Behavior preserved
  exactly: dedup-by-`(claimId, supportingClaimId)`, strict-mode rethrow,
  non-strict warning wrapping with `context.libraryErrorCode`. The two
  branches in the formula-inference loop are now small and symmetric.

## Documentation

- **LLM system prompt** — consolidated the two adjacent paragraphs about
  axiomatic `reasonCode` extension fields into a single bullet under
  "Claim Types". The "closed enum of allowed values" detail is preserved.
- **`docs/api-reference.md`** — added a new `## ArgumentParser` section
  covering the class signature, constructor, `validate()`, `build()`, all
  six mapping hooks, and the formula-inferred edge derivation behavior.
  Added parser-related types (`TArgumentParserResult`,
  `TParserBuildOptions`, `TParserWarning`, `TParserWarningCode`, plus the
  `TParsed*` schema-static types) under the existing `## Types` section.

## Hash range

`5f832b0..HEAD`
