# Upcoming changelog

Schema-surface cleanup around the claim-type discriminator and the
citation/axiom connection schemata. No state-shape change.

## Schema changes

- **Rename** `CoreClaimTypesSchema` → `CoreClaimTypeSchema`. Added matching
  `TCoreClaimType` static type alias. All in-tree consumers
  (`src/lib/parsing/schemata.ts`, `src/lib/schemata/import.ts`) updated.
- **New exports** in `src/lib/schemata/claim.ts`: `CoreClaimNormalTypeSchema`,
  `CoreClaimCitationTypeSchema`, `CoreClaimAxiomaticTypeSchema`, plus their
  `T`-prefixed static types. The combined `CoreClaimTypeSchema` is now
  composed from these.
- **Deleted** `src/lib/schemata/claim-citation.ts` and
  `src/lib/schemata/claim-axiom.ts`. They were empty wrappers around
  `CoreClaimConnectionSchema`. The barrel `src/lib/schemata/index.ts` no
  longer re-exports them.

## Consumers migrated to `TCoreClaimConnection` / `CoreClaimConnectionSchema`

- `src/lib/core/claim-citation-library.ts` — generic default and
  `Value.Check` target.
- `src/lib/core/claim-axiom-library.ts` — generic default and `Value.Check`
  target.
- `src/lib/core/proposit-core.ts` — `TPropositCoreOptions`, `PropositCore`,
  and the static `fromSnapshot` generic defaults.
- `src/lib/core/interfaces/library.interfaces.ts` — `TPropositCoreSnapshot`
  generic defaults; dropped the now-unused imports.
- `src/lib/parsing/argument-parser.ts` — `TArgumentParserResult` and
  `ArgumentParser` generic defaults.
- `src/lib/utils/lookup.ts` — JSDoc `@example` switched to
  `TCoreClaimConnection`.
- `test/core.test.ts` — `emptyClaimConnectionLookup<TCoreClaimConnection>()`.

## Parser-builder + clamp generalized

- `src/lib/parsing/schemata.ts` — replaces `mergeObjectSchemas` with
  `mergeBaseWithExtension(base: TObject, extension: TSchema): TSchema`. The
  new helper detects `anyOf` extensions and distributes the base over each
  branch, returning `Type.Union(branches)`; plain `Type.Object` extensions
  still produce a single merged object. `buildParsingResponseSchema` now
  calls the new helper for `claimSchema`/`variableSchema`/`premiseSchema`.
- `src/lib/parsing/clamp-max-lengths.ts` — iterates every non-null branch of
  an `anyOf` schema instead of bailing on the first non-null branch.
  Idempotent clamping behavior; Nullable<T> behavior preserved.

## Basics extension (`src/extensions/basics/schemata.ts`)

- Variant-aware claim extension: `BasicsNormalClaimExtension` (title, body,
  `type: "normal"`), `BasicsCitationClaimExtension` (title, url,
  `type: "citation"`), `BasicsAxiomaticClaimExtension` (axiom,
  `type: "axiomatic"`). `BasicsClaimExtension` unions the three.
- Per-variant entity schemas exported: `BasicsNormalClaimSchema`,
  `BasicsCitationClaimSchema`, `BasicsAxiomaticClaimSchema`. The umbrella
  `BasicsClaimSchema` is now a `Type.Union` over the three.
- `BasicsParsingSchema` now produces a discriminated-union response schema
  with per-variant `maxLength` constraints preserved end-to-end.

## Parser changes

- parsing: drop `citationMiniIds` from `ParsedClaimSchema`; the parser now
  derives citation and axiom support edges from premise formulas. Any
  `implies`/`iff` premise's right-hand operand identifies the supported
  claim, and any citation- or axiomatic-typed claim referenced in the
  left-hand subtree becomes a support edge in the corresponding library.
- parsing: `ArgumentParser` and `TArgumentParserResult` gain a
  `TAxiom extends TCoreClaimConnection` type parameter; result objects now
  expose `claimAxiomLibrary` alongside `claimCitationLibrary`.
- parsing: new protected `mapClaimAxiom` hook (mirror of `mapClaimCitation`);
  both hooks' signatures expand to expose the supporting parsed claim
  alongside the dependent.
- parsing: warning codes — added `CITATION_EDGE_REJECTED` and
  `AXIOM_EDGE_REJECTED` for non-strict wrapping of library `add()` throws;
  removed `UNRESOLVED_CITATION_MINIID` (no longer reachable).
- parsing: LLM system prompt rewritten — unified miniId convention (all
  claims use the `c` prefix; `type` field discriminates kind);
  `## Citation Links` section replaced by `## Support via Formulas`.

## Hash range

eecddfd..HEAD
