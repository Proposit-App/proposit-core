# Changelog — v0.10.0

Source-as-claim unification. Commit range: `ed06a50..2bc587d` (on `feature/v0.10.0-source-as-claim-unification`).

## Schema and library refactors

- `aa34b8e` feat(claim): add `type` discriminator (`"normal" | "citation"`) to `TCoreClaim`; delete `TCoreSource` schema.
- `b77030f` chore(checksum): retire source/association entries from `TCoreChecksumConfig`; introduce `claimCitation` config and per-claim citation field surface.
- `b2fa9cb` refactor(library): rename `ClaimSourceLibrary` → `ClaimCitationLibrary`; constructor takes a single `claimLookup`; reject non-citation-typed sources; reject cycles on `add()` via DFS.
- `7d092a1` fixup(library): tighten citation-library invariants and validation symmetry between `add` and `restore` paths.
- `313f38d` feat(claim-library): require `type` at creation; reject post-creation `type` changes with `CLAIM_TYPE_IMMUTABLE`.
- `361d5f5` fixup(claim-library): override `create()` for narrower input shape.
- `7bcf523` revert: restore `TClaimCreateInput` union form to preserve subclass override compatibility.

## Engine + core wiring

- `f5590eb` refactor(argument-library): drop `TSource` / `TAssoc` generics; rename library field.
- `073da89` refactor(fork): fold `sources` namespace into `claims`; drop `sourceLibrary` parameter from `forkArgument` orchestration. `ForkLibrary` now exposes 5 namespaces.
- `aebc38d` fixup(fork): correct DFS terminology; remove redundant `visited` set.
- `7e7270c` refactor(argument-engine): drop `sourceLibrary` constructor arg (4 args total); rename `claimSourceLibrary` parameter to `claimCitationLibrary`.
- `5b26902` chore(interfaces): JSDoc updates for the unified claim+citation model on engine and library interfaces.
- `9c14cb7` refactor(utils): rename source lookup helpers to citation lookup.
- `87cdf00` chore(exports): drop `SourceLibrary` from public exports; export `ClaimCitationLibrary`.

## Parsing and extensions

- `be4d746` refactor(parsing): unify source/claim parsing surface; rewrite the LLM prompt around the type discriminator.
- `ea4c021` fixup(parsing): restore citation metadata guidance in the prompt; rename a loop variable for clarity.
- `1465196` refactor(extensions): drop source generics; replace `IEEESourceSchema` with `IEEECitationClaimSchema`.

## CLI

- `40536a4` feat(cli): replace `proposit sources` subcommand tree with `proposit citations` (`list`, `show`, `add`, `unlink`); rename storage paths.
- `550a8c5` fixup(cli): handle citation-add library errors via `errorExit` for consistent exit codes.
- `4656bf2` feat(cli): one-time `migrate-v0.10` step for legacy state directories. Rewrites source records as citation-typed claims, renames association files, and writes a `.proposit-v0.10` marker so the migration runs at most once per state directory.
- `4552fb5` fixup(cli): recompute checksums during the v0.10 migration so post-migration snapshots verify cleanly under `checksumVerification: "strict"`.

## Tests

- `f50f937` test(core): rewrite source-related tests for the unified claim model. Type-immutability, citation-graph acyclicity, citation-source-must-be-citation-type, and `LEGACY_CLAIM_MISSING_TYPE` legacy-detection cases land here.
- `620d14d` test(integration,extensions): update integration suites and extension tests for the new citation surface.
- `2bc587d` test(smoke,examples): exercise the citation surface in `scripts/smoke-test.sh`; regenerate YAML fixtures under `examples/arguments/`.

## Documentation

- `ed06a50` docs(specs,plan): v0.10.0 source-as-claim unification spec and per-phase plan; v0.11.0 derivation-premises spec stub.
- `f739d33` docs(api): refresh JSDoc across engine, library, and snapshot interfaces for the source-as-claim model.
