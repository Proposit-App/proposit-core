# Upcoming

Axiomatic claim type, parallel `ClaimAxiomLibrary`, and a coordinated rename of the citation library to a generic claim-connection vocabulary. Commit range: `5190587..HEAD` (on `feature/v0.12.0-axiomatic-claim-type`).

## Schema and library refactors

- `e093f14` refactor(types): group LEGACY codes with their conceptual owners.
- `5f253cb` feat(schemata): add `'axiomatic'` to the claim type union; description text updated.
- `3583c86` feat(schemata): add generic `CoreClaimConnectionSchema` with neutral field names (`claimId`, `claimVersion`, `supportingClaimId`, `supportingClaimVersion`).
- `fcde59e` docs(schemata): document `additionalProperties` usage on claim-connection.
- `2681169` refactor(schemata): citation schema becomes a `CoreClaimConnection` alias.
- `81ddaaf` feat(schemata): add `CoreClaimAxiomSchema` parallel to citation schema.
- `43f5705` chore(schemata): re-export connection and axiom schemas from `src/lib/schemata/index.ts`.
- `2455d3b` refactor(interfaces): generalize `TClaimCitationLookup` / `TClaimCitationLibraryManagement` / `TClaimCitationLibrarySnapshot` to `TClaimConnectionLookup<TConn>` / `TClaimConnectionLibraryManagement<TConn>` / `TClaimConnectionLibrarySnapshot<TConn>`.
- `aa243da` refactor(claim-citation-library): rename to connection vocabulary; drop the reverse `getCitationsForSourceClaim` index; add `LEGACY_CLAIM_CITATION_SHAPE` guard on `fromSnapshot`. Method `getCitationsForCitingClaim` renamed to `getConnectionsForClaim`. Error codes renamed: `CITATION_CITING_REF_NOT_FOUND` → `CITATION_CLAIM_REF_NOT_FOUND`, `CITATION_SOURCE_REF_NOT_FOUND` → `CITATION_SUPPORTING_REF_NOT_FOUND`, `CITATION_SOURCE_NOT_CITATION_TYPE` → `CITATION_SUPPORTING_NOT_CITATION_TYPE`.
- `d32477c` feat(checksum): rename citation field set members to the new vocabulary; add `claimAxiomFields` (with normalize/serialize/createChecksum registry threading).
- `9f53d6f` refactor(utils): replace `EMPTY_CLAIM_CITATION_LOOKUP` constant with `emptyClaimConnectionLookup<TConn>()` factory so each callsite gets a properly narrowed empty.
- `db5406f` test(claim-axiom-library): add failing tests for `ClaimAxiomLibrary`.
- `4c7dc31` feat(claim-axiom-library): add `ClaimAxiomLibrary` parallel to `ClaimCitationLibrary`. Implements `TClaimConnectionLibraryManagement<TAxiom>`. Validates supporting-side `type === 'axiomatic'` (`AXIOM_SUPPORTING_NOT_AXIOMATIC_TYPE`), dependent-side `type === 'normal'` (`AXIOM_CLAIM_NOT_NORMAL_TYPE`), both endpoints resolve, and uniqueness of `id`. No cycle detection (structurally impossible).

## PropositCore + forking

- `258321e` test(proposit-core): add failing tests for citations rename and axioms field.
- `ec2f9bd` refactor(proposit-core): rename `claimCitations` to `citations`; add `axioms` field; new `TAxiom` generic; `LEGACY_CLAIM_CITATION_SHAPE` and `LEGACY_MISSING_AXIOM_SLOT` legacy-shape guards on `fromSnapshot`. Snapshot slot renames (`claimCitations` → `citations`; new `axioms` slot).
- `490c5b9` docs(proposit-core): refresh JSDoc comments for v0.12 field renames.
- `c079fee` test(proposit-core): add failing tests for unified-BFS axiom-aware forking.
- `3b0cad6` feat(proposit-core): `forkArgument` unified BFS over citation and axiom connections — single closure walk that reaches axioms via multi-hop citation paths and vice versa. Cloned axiom connections pin `claimVersion: 0` / `supportingClaimVersion: 0` (matches existing citation-clone behavior).

## Engine evaluation semantics

- `bbb8dfb` test(argument-engine): add failing tests for axiom force-true and `checkValidity` carve-out.
- `ac02236` feat(argument-engine): pre-pass in `evaluate()` forces axiomatic claim-bound variables to `true`; rejects caller-supplied assignments for axiomatic-bound variables with `AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN`. Standalone evaluator stays claim-type-agnostic.
- `daebdf8` feat(argument-engine): `checkValidity` carve-out excludes axiomatic-bound variables from the enumeration set; counts (`numAdmissibleAssignments`, counterexample search space) computed against the reduced set.
- `4c77b76` test(checkValidity): correct admissibility expectation for axiom carve-out test.
- `4e33a83` docs(propagator): note axiom force-true interaction with `trySetChild` (rejecting an operator whose only unknown child is axiom-bound is a propagation no-op); add regression test.

## Managed derivation premise engine

- `ecbea0a` test(managed-derivation-premise-engine): add failing tests for `populateFromSupports`.
- `d2b96c6` feat(managed-derivation-premise-engine): `populateFromSupports(citationLib, axiomLib, argumentEngine)` replaces `populateFromCitations`. Combined support set in stable order (citations first, axioms second; source order preserved within each). Same naked-Q precondition (`DERIVATION_ANTECEDENT_NON_EMPTY`) applies; append-mode deferred.
- `41923ec` test(populateFromSupports): use `ManagedDerivationPremiseEngine.fromSnapshot` construction for v0.12 tests.

## Parser + remaining callers

- `a0edfb0` test: rename citation field references throughout the test suite for v0.12 connection vocabulary.
- `f376dd3` refactor(parser+cli): update remaining v0.12 connection vocabulary callers (`src/cli/commands/parse.ts`, `src/cli/commands/arguments.ts`, `src/cli/commands/render.ts` — including extending the render walk to also call `core.axioms.getConnectionsForClaim`).
- `7df7b27` feat(schemata): widen import claim type union for axiomatic.
- `01dd8c3` feat(parsing): widen claim-type union and document axiomatic in `prompt-builder.ts`.

## CLI

- `4f3a099` feat(cli): add `CliAxiomReasonCode` (`true-by-definition`, `historically-established`, `logically-required`) and a `CliClaimSchema` discriminated union; `reasonCode` required only on the axiomatic variant.
- `1048edf` feat(cli): support `--type axiomatic --reason <code>` in `claims add`. `claims update` does not declare `--reason`, so commander rejects it as unknown — reason codes are immutable.
- `eedbe66` refactor(cli): citations command uses flags (`--claim-id`, `--supporting-claim-id`) and `remove` verb for v0.12 symmetry. Breaking change for scripts pinned against the old positional `add` / `unlink` form.
- `5fa030b` feat(cli): add `axioms` command group (`list`, `show`, `add --claim-id <id> --axiom-id <id>`, `remove`).
- `461962c` feat(cli): validate axiomatic `reasonCode` on YAML import — post-parse step rejects axiomatic claims missing or with invalid `reasonCode`.
- `e787d0c` refactor(cli/storage): rename citation storage helpers (`claimCitationsPath` → `citationsPath`, etc.); add parallel axiom storage helpers (`axiomsPath`, `readAxiomLibrary`, `writeAxiomLibrary`).
- `dc87480` feat(cli/storage): v0.12 migration script (rename `claim-citations.json` → `citations.json`, rewrite wrapper field and per-entity edge fields, recompute checksums, init `axioms.json`). Idempotent — each step probes its own completion state. Marker file `.proposit-v0.12`.
- `d1151c5` fix(cli/import): pass `reasonCode` through to claim creation for axiomatic claims.
- refactor(cli): rename `premises populate-citations` subcommand to `premises populate-supports` for v0.12 API consistency with `populateFromSupports`. Description updated to mention both citations and axioms; smoke test, CLI walkthrough, and release notes updated to match.

## Tests + examples

- `83eb7ce` test(examples): add axiom-backed derivation YAML fixture under `examples/arguments/`.
- `08438d8` test(smoke): add axiom claim type, axiom connections, and v0.12 migration coverage to `scripts/smoke-test.sh`.

## Documentation

- `9a904e5` docs(readme): cover axiomatic claim type, `axioms` commands, citations CLI rewrite, evaluation semantics by claim type. Invalid Constructions table extended.
- `27cf2e7` docs(api-reference): full surface for `ClaimAxiomLibrary`, generic connection interfaces (`TClaimConnectionLookup`, `TClaimConnectionLibraryManagement`, `TClaimConnectionLibrarySnapshot`), `populateFromSupports`, and claim-type-aware evaluation. Error code table updated.
- `a02da65` docs(claude): update design-rule bullets for v0.12 axiomatic claim type — claim type discriminator, claim library, citation acyclicity, axiom library, `populateFromSupports`, argument forking, ForkLibrary, evaluation defaults by claim type, PropositCore field names.
- `26c865c` docs(cli-examples): refresh citations walkthrough to flag-style + `remove`; add axioms walkthrough; rewrite Derivation Premises walkthrough to use the new citation flag form and call out the combined-support behavior of `populate-supports` (renamed from `populate-citations`).

## Engine signature cleanup

- refactor(argument-engine): drop the vestigial `claimCitationLibrary` constructor parameter / `fromSnapshot` parameter / `fromData` parameter, the `TCitation` generic, and the `TClaimConnectionLookup` import. The field was set but never read — Phase 7 cleanup planned in earlier `// TODO Phase 7` markers. Cascading: drops `claimCitationLibrary` from the `ArgumentLibrary` constructor's libraries object, `ArgumentLibrary.fromSnapshot`'s libraries object, the standalone `forkArgumentEngine` libraries object, and the `TArgumentLibraryLibraries` type. `PropositCore` is unchanged: it still owns `core.citations` and accepts `claimCitationLibrary` as a constructor option. Direct callers of `ArgumentEngine` / `ArgumentLibrary` / `forkArgumentEngine` need to drop the citation-library argument from each call site (test fixtures and CLI files updated in this commit).
