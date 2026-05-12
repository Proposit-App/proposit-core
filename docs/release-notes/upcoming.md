# Upcoming release notes

Documentation and internal cleanups following the v0.12.2 parser overhaul.
No behavior changes; no API changes; safe drop-in.

## Documentation

The `ArgumentParser` class and its surrounding types are now documented in
`docs/api-reference.md`. Coverage includes the seven generic type
parameters, the `validate()` / `build()` methods, all six protected
mapping hooks (`mapArgument`, `mapClaim`, `mapVariable`, `mapPremise`,
`mapClaimCitation`, `mapClaimAxiom`), the formula-inferred citation and
axiom edge derivation behavior, and every `TParserWarningCode` entry with
its consequence. This fills a pre-existing gap — the parser API had been
publicly exported since the LLM-parser feature landed but never appeared
in the reference.

The LLM system prompt's guidance about extending axiomatic claims with a
`reasonCode` field has been consolidated into a single bullet for
clarity. No semantic change to what the LLM is told.

## Internals

The shared logic between citation-edge and axiom-edge routing in
`ArgumentParser.build()` is now factored into a single internal helper.
Behavior is identical; this is a maintenance-driven cleanup.
