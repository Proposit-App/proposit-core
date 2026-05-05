# Source-as-Claim Unification (v0.10.0)

## Motivation

`proposit-core` currently maintains parallel `Source` and `Claim` libraries with nearly identical schemas, plus a separate `ClaimSourceLibrary` recording associations between them. This duplication is conceptually unsound: a "source" is a proposition authored by an external party, and its truth value is whether the source's content is propositionally accurate. A source is a claim with external provenance.

This spec unifies sources into claims under a single library, with a `type: "normal" | "citation"` discriminator on `TCoreClaim` distinguishing the two roles. The existing claim-source association table is renamed to a citation graph between claims, with new strictness and acyclicity invariants.

This is the first of two related releases. **v0.11.0** will introduce a `derivation` premise type and a `ManagedDerivationPremiseEngine` that surfaces a claim's evidentiary support as a structurally-constrained argumentative step inside an argument. The two were originally bundled as a single design, but the engineering risk of a 500-site PR led to splitting them. The conceptual coherence is recoverable in release notes.

The v0.11.0 spec lives at `docs/superpowers/specs/2026-05-05-derivation-premises-design.md` and is a separate brainstorm/design cycle that builds on this one.

## Goals

- Eliminate the source/claim duplication. One entity type, one library, one ID space.
- Add a citation graph as a first-class library with strict and acyclic invariants.
- Maintain proposit-core's existing minimalism — no application metadata, no UX assumptions, no live propagation.

## Non-goals

- **Migration utilities or coercion at the core library layer.** Core does not handle persisted data; data persistence is the application's responsibility. Any code path that loads serialized data (e.g., `restoreFromSnapshot`, `fromData`) requires the data to already be in the v0.10.0 shape — except for one carve-out: a new `LEGACY_CLAIM_MISSING_TYPE` validation code is emitted when core detects a pre-v0.10 claim record (one without `type`), so apps can detect "I'm loading old data" and route to their own migration. Apps that persist data (notably `proposit-core`'s own CLI, plus `proposit-server` and `proposit-mobile`) handle their own migration.
- **Derivation premises and `ManagedDerivationPremiseEngine`.** Deferred to v0.11.0; separate spec.
- **Cross-repo coordination of `proposit-server` and `proposit-mobile`.** Each downstream consumer migrates independently.

## Data model

### Claim type discriminator

`CoreClaimSchema` gains a required field:

```ts
type: "normal" | "citation"
```

- `"normal"`: a claim authored as part of an argument's primary reasoning.
- `"citation"`: a claim representing external content (article, report, transcript, etc.) cited as evidence.

The field is **immutable post-creation**. `ClaimLibrary.update()` rejects any change to it (`CLAIM_TYPE_IMMUTABLE`). Direct snapshot tampering is caught at validation time during the existing `withValidation` wrapper.

A claim's truth-value semantics are interpretive: for citation claims, "true" means the source's content is propositionally accurate; for normal claims, "true" means the asserted proposition holds. The library does not enforce or distinguish these.

**Naming collision warning for downstream apps**: `TCoreClaim` allows `additionalProperties: true`, and some apps may already use a `type` extra of their own. After this release, the top-level `type` field is reserved. Downstream apps that used `type` as an extra must rename their extra (e.g., to `kind` or a domain-specific name) before adopting v0.10.0. The collision will manifest at validation time: TypeBox enforces explicit field constraints over `additionalProperties`, so an app passing `type: "research-paper"` to a v0.10.0 claim will fail `Value.Check`.

### Source schema deletion

The following are deleted:

- `TCoreSource`, `CoreSourceSchema` (`src/lib/schemata/source.ts`) — entire file deleted.
- `TSourceLookup`, `TSourceLibraryManagement`, `TSourceLibrarySnapshot` (`src/lib/core/interfaces/library.interfaces.ts`).
- `SourceLibrary` class (`src/lib/core/source-library.ts`) — entire file deleted.
- `CoreSourceForkRecordSchema`, `TCoreSourceForkRecord` (`src/lib/schemata/fork.ts`).
- `TCoreChecksumConfig.sourceFields?` field (`src/lib/types/checksum.ts`).
- `DEFAULT_CHECKSUM_CONFIG.sourceFields` entry and related serializer/normalizer/createChecksumConfig logic (`src/lib/consts.ts`).
- Error codes `SOURCE_SCHEMA_INVALID`, `SOURCE_FROZEN_NO_SUCCESSOR` (`src/lib/types/validation.ts`).
- `EMPTY_SOURCE_LOOKUP` constant (`src/lib/utils/lookup.ts`).
- `ParsedSourceSchema`, `TParsedSource` (`src/lib/parsing/schemata.ts`); barrel re-exports in `src/lib/parsing/index.ts:5,15`.
- `IEEESourceSchema`, `TIEEESource` from `src/extensions/ieee/source.ts` — replaced by an analogous `IEEECitationSchema` derived from a `type: "citation"`-narrowed `CoreClaimSchema` intersect (see Extensions section).

All callers that previously created or referenced sources must use `TCoreClaim` with `type: "citation"`.

### Claim citation graph

`ClaimSourceLibrary` is renamed to **`ClaimCitationLibrary`** and holds `TCoreClaimCitation` records:

```ts
type TCoreClaimCitation = {
    id: UUID
    citingClaimId: UUID         // the claim being supported (was: claimId)
    citingClaimVersion: number
    sourceClaimId: UUID         // the supporting claim (was: sourceId)
    sourceClaimVersion: number
    checksum: string
}
```

Field renames: `claimId` → `citingClaimId`, `sourceId` → `sourceClaimId`. The names "citing" and "source" are deliberately chosen to be visually dissimilar (avoiding the citing/cited near-homograph trap).

**Constructor signature change**: `ClaimSourceLibrary` currently takes two lookups (`claimLookup, sourceLookup`). After unification, `ClaimCitationLibrary` takes a single `claimLookup: TClaimLookup` — both endpoints reference the same library. This is a breaking change to the constructor signature.

The library exposes the same management surface as today (`add`, `remove`, query methods, snapshot/restore) under the renamed class. Existing methods on `ClaimSourceLibrary` are renamed for consistency:

- `getForClaim(claimId)` → `getCitationsForCitingClaim(citingClaimId)` (returns citations where this claim is on the citing side)
- `getForSource(sourceId)` → `getCitationsForSourceClaim(sourceClaimId)` (returns citations where this claim is on the source side)

### Variable schema unchanged

Sources-as-claims means citation references are just claim-bound variables. No change to `TClaimBoundVariable` or `TPremiseBoundVariable`. A variable referencing a citation-type claim works exactly like a variable referencing a normal claim.

### Fork records — namespace fold

`ForkLibrary` currently has six namespaces: `arguments`, `premises`, `expressions`, `variables`, `claims`, `sources`. `TCoreSourceForkRecord` and `TCoreClaimForkRecord` schemas are structurally identical (same fields: `id`, `entityId`, `forkedFromEntityId`, `forkedFromEntityVersion`, `checksum`).

After this change:

- `ForkLibrary.sources` is deleted.
- Existing source fork records are reinterpreted as claim fork records. Schemas are identical, so no field-level migration is needed at the schema layer.
- `forkArgumentEngine` (`src/lib/core/fork.ts`) drops the `sourceLibrary` parameter from its signature.
- `PropositCore.forkArgument()` no longer routes through the sources namespace. The entire "Step 5: Clone associations" block currently at lines ~528–544 in `proposit-core.ts` is rewritten to a single citation-cloning loop. The `claimVersion: 0` / `sourceVersion: 0` literals at lines 538/540 are obsolete in the rewrite.
- `canFork()` (overridable public method on `ArgumentEngine`) is unaffected — it does not interact with sources today, and continues to operate purely on argument state.

**Provenance loss acknowledged**: a fork record after this release does not carry information about whether the original entity was authored as a source-shaped fork or a claim-shaped fork. This is acceptable because the type discriminator on `TCoreClaim` itself preserves the role distinction — but apps that need fork-level "this was originally a source" provenance must encode that into their own metadata extras on the fork record (`additionalProperties: true` is preserved on the fork record schemas).

### Checksum impact

Adding `type` to the claim's checksum-relevant fields means every existing claim's checksum changes after migration. **However, the cascade is narrower than initially feared.** Variables and expressions reference claims by `(claimId, claimVersion)` only, NOT by claim checksum value. So claim checksum changes do NOT propagate into expression `descendantChecksum`/`combinedChecksum` values. The only collection-level checksum that shifts is `getCollectionChecksum("claims")`.

Apps that have persisted state must:
- Recompute all claim checksums after migration.
- Recompute `getCollectionChecksum("claims")` and `getCollectionChecksum("claimCitations")` (the renamed citation collection).
- Treat the post-migration collection-level checksums as a reset baseline.
- **No expression-level recomputation is required** — variable references are version-keyed, not checksum-keyed.

Apps that fingerprint sync state via `getCollectionChecksum("claims")` will see a baseline shift on day-of-upgrade. Release notes should call this out.

The `claimFields` and `claimCitationFields` in `DEFAULT_CHECKSUM_CONFIG` (`src/lib/consts.ts`) are updated:

- `claimFields` adds `"type"` to the default set.
- `claimSourceAssociationFields` is renamed to `claimCitationFields` and the field reference list is updated for the new field names (`citingClaimId`, `citingClaimVersion`, `sourceClaimId`, `sourceClaimVersion`).
- `sourceFields` is deleted.

## Citation library invariants

### Strict source-side type

`ClaimCitationLibrary.add()` rejects edges where `sourceClaimId` references a non-citation claim:

- New error: `CITATION_SOURCE_NOT_CITATION_TYPE`.

Citing-side accepts any claim type. Citation claims may themselves cite other citation claims (chained evidence). Normal claims are pure sinks: they can be cited (appear on the citing side) but never serve as evidence for anything (never appear on the source side).

### Acyclicity

`ClaimCitationLibrary.add()` rejects edges that would close a cycle:

- New error: `CITATION_CYCLE_DETECTED`.
- **Cycle detection is by `claimId` only, not by `(claimId, claimVersion)`.** Versions are value snapshots of the same logical claim; treating different versions as distinct nodes in the graph would let users "wash" cycles by bumping versions, which is confusing and unsafe. This convention matches existing graph-traversal code: `forkArgument` (`proposit-core.ts:469-493`) uses ID-only sets for unique-claim tracking, and `getForClaim`-style lookups operate on ID-only matchers.
- **Algorithm**: if `citingClaimId`'s claim has `type: "normal"`, skip (normal claims cannot appear on the source side). Otherwise (citing-side is a citation claim), perform a DFS from `sourceClaimId` following outgoing citation edges (entries where `citingClaimId === current`, ignoring versions). If `citingClaimId` is reached, the new edge would close a cycle.
- **Worked example**: an association `(citingClaimId=A@v3, sourceClaimId=B@v1)` and another `(B@v2, A@v0)` both project to edges `A→B` and `B→A` regardless of version values. The cycle check fires on the second `add()` because the projected `A` already reaches `B` and the new edge would reach `A` from `B`.
- **Performance**: DFS runs on every `add()`. For the size of citation graphs realistic in this domain (hundreds to low thousands of edges), O(V+E) per add is acceptable. The library is already O(V) per operation in several places.

Validation runs inside the existing `withValidation` wrapper, so violations roll back the operation and throw `InvariantViolationError`. Snapshot restore re-runs the same validation, catching tampered or migrated snapshots that contain cycles.

### No update path

Citations remain create-or-delete-only. `ClaimCitationLibrary` does not expose `update()`. To "change" a citation, delete and re-add. This matches the existing `ClaimSourceLibrary` semantics and avoids questions about cycle re-checks under in-place edits.

### Versioning

Both endpoints pin to specific claim versions (`citingClaimVersion`, `sourceClaimVersion`), unchanged from current behavior. Bumping a claim's version does not migrate existing citations; they continue referencing the previous version. Apps create new citations against the new version as needed.

The acyclicity check operates on `claimId` only (per above). Version pinning is purely for value snapshot; it does not factor into graph topology.

### Error code renames

| Existing | New |
|---|---|
| `ASSOC_SCHEMA_INVALID` | `CITATION_SCHEMA_INVALID` |
| `ASSOC_CLAIM_REF_NOT_FOUND` | `CITATION_CITING_REF_NOT_FOUND` |
| `ASSOC_SOURCE_REF_NOT_FOUND` | `CITATION_SOURCE_REF_NOT_FOUND` |

### New error codes

- `CLAIM_TYPE_IMMUTABLE`
- `CITATION_SOURCE_NOT_CITATION_TYPE`
- `CITATION_CYCLE_DETECTED`
- `LEGACY_CLAIM_MISSING_TYPE` — emitted by validation when a claim record is encountered without a `type` field (only fires during snapshot restore from pre-v0.10 data; does not fire in normal operation).

## Affected code (full inventory)

### Schemata (`src/lib/schemata/`)

- `source.ts` — DELETED entirely.
- `claim.ts` — add required `type: "normal" | "citation"` field with `Type.Union([Type.Literal("normal"), Type.Literal("citation")])`.
- `fork.ts` — delete `CoreSourceForkRecordSchema` and `TCoreSourceForkRecord`.
- `index.ts` — drop `source.js` re-exports; verify all `claim` re-exports include the new `type` field type.

### Core libraries (`src/lib/core/`)

- `source-library.ts` — DELETED entirely.
- `claim-source-library.ts` — RENAME to `claim-citation-library.ts`. Class rename: `ClaimSourceLibrary` → `ClaimCitationLibrary`. Field renames in all internal indices and method signatures. Constructor takes a single `claimLookup: TClaimLookup` (was: two lookups). Add strict source-side type check (must look up via `claimLookup` and verify `type === "citation"`). Add acyclicity check. Rename methods `getForClaim` → `getCitationsForCitingClaim` and `getForSource` → `getCitationsForSourceClaim`.
- `claim-library.ts` — extend `update()` to reject changes to the `type` field; throw `CLAIM_TYPE_IMMUTABLE`. Note: `update()` is inherited from `VersionedLibrary` (`versioned-library.ts:97-128`); the override goes in `ClaimLibrary` directly so the inheritance chain stays clean.
- `argument-library.ts` — drop the `TSource` and `TAssoc` generic parameters from `ArgumentLibrary` class declaration (currently 7 generics: `TArg, TPremise, TExpr, TVar, TSource, TClaim, TAssoc` reduce to 5: `TArg, TPremise, TExpr, TVar, TClaim`). Drop `sourceLibrary: SourceLibrary<TSource>` field from `TArgumentLibraryLibraries`. Rename `claimSourceLibrary` field to `claimCitationLibrary`. Update `create()` (line ~211) and `fromSnapshot()` (line ~37) signatures. Update internal `register()` and helper methods that wire the libraries through.
- `fork-library.ts` — drop `sources` namespace; reduce to 5 namespaces. Update internal type signatures.
- `fork-namespace.ts` — no changes (generic over fork record schema).
- `fork.ts` — `forkArgumentEngine` signature: drop `sourceLibrary` parameter. Update fork copy logic to fold former-source-records into the claims namespace.
- `proposit-core.ts` — constructor: drop `sourceLibrary` parameter; rename `claimSourceLibrary` field to `claimCitationLibrary`. Rewrite `forkArgument()`'s "Step 5: Clone associations" block (lines ~528–544) to a single citation-cloning loop, dropping the obsolete `claimVersion: 0`/`sourceVersion: 0` literals.
- `argument-engine.ts` — constructor: drop `sourceLibrary` parameter. Static factories `fromSnapshot` and `fromData` (lines ~1257, 1394): drop `sourceLibrary`/`claimSourceLibrary` parameters; accept `claimCitationLibrary` instead. Update `claimSourceLibrary` references to `claimCitationLibrary`. **These are public API touch sites** — downstream apps that construct engines via static factories need updating.
- All other files: scan for `Source`/`SourceLibrary`/`TCoreSource`/`claimSourceLibrary`/`sourceLibrary`/`ClaimSourceAssociation`/`sourceId`/`sourceVersion` references; rename consistently.

### Interfaces (`src/lib/core/interfaces/library.interfaces.ts`)

- DELETE: `TSourceLookup`, `TSourceLibraryManagement`, `TSourceLibrarySnapshot`.
- RENAME: `TClaimSourceLookup` → `TClaimCitationLookup`, `TClaimSourceLibraryManagement` → `TClaimCitationLibraryManagement`, `TClaimSourceLibrarySnapshot` → `TClaimCitationLibrarySnapshot`. Field renames inside (`getForClaim` → `getCitationsForCitingClaim`, `getForSource` → `getCitationsForSourceClaim`).
- UPDATE: `TForkLibrarySnapshot` — drop `sources` field; retain only 5 namespaces.
- UPDATE: `TPropositCoreSnapshot` — drop `sources` field; rename `claimSources` field to `claimCitations`. **This is a wire-format breaking change** — apps that round-trip snapshots over HTTP must accept the new field name (no compat shim).

Also update `argument-engine.interfaces.ts` and `premise-engine.interfaces.ts` JSDoc to remove any source library references in method signatures or descriptions.

### Types (`src/lib/types/`)

- `checksum.ts` — drop `sourceFields?: Set<string>` from `TCoreChecksumConfig`. Rename `claimSourceAssociationFields?` to `claimCitationFields?`.
- `validation.ts` — drop error codes `SOURCE_SCHEMA_INVALID`, `SOURCE_FROZEN_NO_SUCCESSOR`. Rename `ASSOC_*` → `CITATION_*`. Add new codes: `CLAIM_TYPE_IMMUTABLE`, `CITATION_SOURCE_NOT_CITATION_TYPE`, `CITATION_CYCLE_DETECTED`, `LEGACY_CLAIM_MISSING_TYPE`.

### Utilities (`src/lib/utils/`)

- `lookup.ts` — DELETE `EMPTY_SOURCE_LOOKUP`. RENAME `EMPTY_CLAIM_SOURCE_LOOKUP` → `EMPTY_CLAIM_CITATION_LOOKUP`. Rename its method `getForClaim` → `getCitationsForCitingClaim` and `getForSource` → `getCitationsForSourceClaim`. Update JSDoc examples (line 28 references `sourceLookup`; rename or remove).

### Constants (`src/lib/consts.ts`)

- `DEFAULT_CHECKSUM_CONFIG`: drop `sourceFields`. Rename `claimSourceAssociationFields` → `claimCitationFields`. Add `"type"` to `claimFields`. Update field name references in `claimCitationFields` to use `citingClaimId`, `citingClaimVersion`, `sourceClaimId`, `sourceClaimVersion`.
- `normalizeChecksumConfig`, `serializeChecksumConfig`, `createChecksumConfig` helpers: drop `sourceFields` references and rename `claimSourceAssociationFields` references.

### Public exports (`src/lib/index.ts`)

- DROP: `SourceLibrary` re-export.
- DROP: `EMPTY_SOURCE_LOOKUP` re-export (if present).
- RENAME: `ClaimSourceLibrary` re-export → `ClaimCitationLibrary`.
- RENAME: `EMPTY_CLAIM_SOURCE_LOOKUP` → `EMPTY_CLAIM_CITATION_LOOKUP`.
- Verify schemata barrel exports reflect new claim shape and dropped source shape.

### Parsing (`src/lib/parsing/`)

- `argument-parser.ts` — `ArgumentParser` class generic params: drop `TSource extends TCoreSource` and `TAssoc extends TCoreClaimSourceAssociation`. Constructor: drop `SourceLibrary` parameter; replace `ClaimSourceLibrary` with `ClaimCitationLibrary`. Drop `mapSource` protected hook. Rename `mapClaimSourceAssociation` → `mapClaimCitation`. Update internal mapping logic to handle citation-type claims.
- `schemata.ts` — DELETE `ParsedSourceSchema` and `TParsedSource`. Rename `sourceMiniIds` field on parsed claim → `citationMiniIds` (these refer to other claims with `type: "citation"`). Update parsed-argument schema's `sources` field → drop (citation-typed claims live in the unified `claims` field).
- `types.ts` (line 9) — DROP `sourceSchema?: TSchema` config option. Citations share `claimSchema`.
- `index.ts` (lines 5, 15) — DROP `ParsedSourceSchema` and `TParsedSource` from barrel re-exports.
- `prompt-builder.ts` — **separate prompt-rewrite workstream** within this release. Rename `CORE_SOURCE_KEYS` to `CORE_CITATION_KEYS`; update `CORE_CLAIM_KEYS` to use `citationMiniIds` instead of `sourceMiniIds`. Rewrite the user-facing prompt copy (lines ~104–129): "Sources (External Citations)" → "Citation claims"; `sourceMiniIds` → `citationMiniIds`; example IDs `s1, s2` → keep as the citation prefix or migrate to a different convention (decided in implementation plan); the "Never put claim miniIds in sourceMiniIds" rule rewrites as "citation miniIds reference only `type: "citation"` claims". This is user-facing LLM-prompt content — quality of the rewrite affects parse output.
- Other parser implementation files: update any lingering `Source` references.

### Extensions (`src/extensions/`)

- `basics/argument-parser.ts` — `BasicsArgumentParser` extends `ArgumentParser`; drop `TCoreSource` and `TCoreClaimSourceAssociation` from its generic parameter list. Update any `mapSource` overrides.
- `ieee/source.ts` — RENAME (or replace contents). Currently defines:
  ```ts
  IEEESourceSchema = Type.Intersect([CoreSourceSchema, Type.Object({url, citation})])
  ```
  After unification: produces a citation-typed claim schema instead. Two options (decide in implementation plan): (a) replace with `IEEECitationClaimSchema = Type.Intersect([CoreClaimSchema, Type.Object({url, citation})])` — same intersect shape, just with the unified claim — and document that consumers use it for `type: "citation"` claims; (b) drop the dedicated schema and let consumers compose intersects ad hoc. **Option (a) is recommended** — preserves IEEE extension API surface for downstream apps. Either way: `TIEEESource` type alias renames to `TIEEECitationClaim`.
- `ieee/index.ts` (line 3) — update barrel re-export to reflect rename.
- `ieee/argument-parser.ts` (if it exists / wherever IEEE parser construction happens) — drop source-typed generics, rename to citation.

### CLI (`src/cli/`) — substantial work

The CLI persists arguments to disk and exposes user-facing commands. This is where the biggest CLI-level changes happen, plus the one-and-only data migration in this release.

- `commands/sources.ts` — REWRITE / RENAME to `commands/citations.ts`. The 5 user-facing subcommands (`list`, `show`, `add`, `link-claim`, `unlink`) remain conceptually but address citation claims and citations rather than sources and associations:
  - `claims add --type=citation ...` (a citation claim is just a claim with `type: "citation"`)
  - `citations list` — replaces `sources list`
  - `citations show <id>` — replaces `sources show <id>`
  - `citations add <citing-claim-id> <source-claim-id>` — replaces `sources link-claim`
  - `citations unlink <citation-id>` — replaces `sources unlink`
- `router.ts` — replace `"sources"` registered command with `"citations"`. Update help text.
- `storage/libraries.ts` — file path constants and helpers:
  - DELETE `sourcesPath()`, `readSourceLibrary`, `writeSourceLibrary`.
  - RENAME `claimSourceAssociationsPath()` → `claimCitationsPath()`. File names on disk: `sources.json` is removed; `claim-source-associations.json` is renamed to `claim-citations.json`.
  - RENAME `readClaimSourceLibrary` → `readClaimCitationLibrary`. New signature takes a single `claimLookup` parameter (was: two lookups).
  - RENAME `writeClaimSourceLibrary` → `writeClaimCitationLibrary`.
  - Drop `TSourceLookup` import from `library.interfaces.js`.
  - `forks.json` is unchanged in path but its content shape changes (sources namespace is dropped).
- `engine.ts` — `hydratePropositCore` / `persistCore`: drop sources persistence; update claim-citation persistence with new file paths and types. **Static factory call site change**: `ArgumentEngine.fromSnapshot(...)` invocation (around line 194) drops the source-library and claim-source-library positional params; pass `claimCitationLibrary` only.
- `import.ts` (line 316), `commands/parse.ts`, `commands/arguments.ts` — drop `new SourceLibrary()` constructions; update `new ClaimSourceLibrary(claimLookup, sourceLookup)` to `new ClaimCitationLibrary(claimLookup)`.
- `commands/render.ts` (lines ~111-134) — the "Sources:" section in argument render output is renamed to "Citations:". The render logic looks up citation-type claims via the unified claim library and pulls citations from `core.claimCitations.getAll()`. **Render UX policy** (decided here so the implementation has direction): citation-type claims appear inline alongside normal claims in the unified "Claims:" section with a `[citation]` badge; the dedicated "Citations:" section lists the citation edges (which claim cites which). Apps wanting different render UX implement their own.

### CLI persistence migration

The CLI is the only piece that persists data and therefore the only piece that owns a migration. On startup, the CLI detects legacy data and performs a one-time migration to the new format. Migration logic lives in a new `src/cli/storage/migrate-v0.10.ts` module and runs before any library hydration:

1. **Detection**: check for the v0.10.0 marker file (`.proposit-v0.10`) in the state directory. If present, skip migration. Otherwise:
2. **Source extras collision check**: read `sources.json` (if it exists). For each source record, check whether `additionalProperties` contain a `type` key. If any do, abort migration with a clear error pointing to the conflicting source ID(s) and instruct the user to rename the extra (e.g., `kind`) before retrying. Migration is idempotent — re-running after the user fixes the data resumes normally.
3. **Sources → claims conversion**: read each source record from `sources.json`; emit a corresponding claim record into `claims.json` with `type: "citation"` (preserving id, version, frozen, additionalProperties extras except `type` which is now reserved). Delete `sources.json` after successful conversion.
4. **Existing claim type backfill**: for each existing claim record in `claims.json`, add `type: "normal"` if not already present.
5. **Associations → citations conversion**: read `claim-source-associations.json` (if it exists). For each association, emit a citation record with field renames (`claimId` → `citingClaimId`, `sourceId` → `sourceClaimId`) into `claim-citations.json`. Delete `claim-source-associations.json`.
6. **Forks fold**: read `forks.json`. The file contains a single `ForkLibrary` snapshot with all six namespaces. Fold `snapshot.sources[*]` records into `snapshot.claims[*]` (schemas are structurally identical). Delete the `sources` key from the snapshot. Rewrite `forks.json` with the 5-namespace shape.
7. **Checksum recompute**: recompute every claim's checksum (since `type` is now in the checksum), every citation's checksum (since field names changed), and the collection-level checksums for claims and citations. **No expression-level recompute is required** — variable references are version-keyed, not checksum-keyed.
8. **Acyclicity validation**: run `ClaimCitationLibrary.validate()` post-migration. If the library detects a cycle (which is possible because legacy data had no acyclicity invariant), abort migration with an error that lists the offending citation IDs so the user can edit `claim-citations.json` directly to break the cycle, then re-run migration.
9. **Marker write**: write `.proposit-v0.10` to the state directory. Migration is now complete; subsequent CLI invocations skip migration.

The CLI logs each step to stderr for observability.

**No-source case**: a state directory that has only `claims.json` (no `sources.json`, no `claim-source-associations.json`) still goes through steps 1, 4, 7 (claim type backfill, claim checksum recompute), and 9 (marker). Steps 2, 3, 5, 6, 8 are no-ops.

**New CLI state file**: `.proposit-v0.10` is a new file in the state directory. Other commands that interact with the state directory (e.g., `proposit reset`, if it exists) must be aware of the marker to avoid breaking idempotency.

### Tests — ~480 source-related occurrences across the test surface

The test suite requires a substantial rewrite. Distribution:

- **`test/core.test.ts`** — ~480 occurrences. Major `describe` blocks to update or replace:
  - `describe("ClaimSourceLibrary", ...)` (around L10325) → rename to `describe("ClaimCitationLibrary", ...)`. Update fixtures, method calls, field names.
  - `describe("getForSource", ...)` (around L10510) → rename to `describe("getCitationsForSourceClaim", ...)`.
  - `describe("ParsedSourceSchema", ...)` (around L12501) → DELETE.
  - `describe("SourceLibrary — validate", ...)` (around L20258) → DELETE.
  - `describe("ClaimSourceLibrary — validate", ...)` (around L20300) → rename and add tests for strict source-side type and acyclicity.
  - `describe("CoreSourceForkRecordSchema", ...)` (around L22247) → DELETE.
  - ADD: `describe("Claim type immutability", ...)` — verify `update()` rejects type changes.
  - ADD: `describe("ClaimCitationLibrary strict source-side type", ...)` — verify `add()` rejects edges where source-side is normal.
  - ADD: `describe("ClaimCitationLibrary acyclicity", ...)` — verify cycle detection across various graph shapes (direct A↔B, transitive A→B→C→A, cross-version edges that project to the same ID-only graph).
  - ADD: `describe("ForkLibrary 5-namespace shape", ...)` — verify the namespace fold.
  - ADD: `describe("Fork record schema equality", ...)` — round-trip a v0.9.x-shaped source fork through migration and assert structural equality with claim fork.
  - ADD: `describe("Legacy snapshot validation", ...)` — verify pre-v0.10 snapshots produce `LEGACY_CLAIM_MISSING_TYPE` validation codes.
- **`test/integration/parse-api.test.ts`** — ~11 source-shaped assertions (`arg.sources`, `built.sourceLibrary.getAll()`, `source.url`, `source.miniId`, etc.). Rewrite to use citation claims and `claimCitationLibrary`.
- **`test/extensions/basics.test.ts`** (lines 19, 26, 35) — uses `sourceMiniIds: []` and `sources: []` in fixtures. Update field name to `citationMiniIds`; drop `sources` array.
- **`test/extensions/ieee.test.ts`** (lines 829-830) — references `url`/`text` source fields. Update to use the renamed IEEE citation claim schema.

Beyond renames, every test case that constructs sources, links claims to sources, or asserts on source library behavior must be updated to use the unified claim model with `type: "citation"`.

### Smoke test (`scripts/smoke-test.sh`)

Section 9n (around L431-445) exercises the source CLI commands. Rewrite to exercise citation commands. Add coverage for the type discriminator and the acyclicity check at CLI level. Add coverage for the migration step itself: write a legacy-shaped state directory, invoke the CLI, verify migration runs and the post-migration state validates.

### Examples (`examples/arguments/`)

YAML files referenced by `test/examples.test.ts` likely reference sources via their schemata. Update to use the new shape: claims with `type: "citation"` in the unified claims list, citations under a renamed top-level YAML key.

## Implementation order

Single-PR strategy with staged commits to keep each commit reviewable:

1. **Schema-layer changes** (`src/lib/schemata/`):
   - Add `type` field to `CoreClaimSchema`.
   - Delete `source.ts`.
   - Delete `CoreSourceForkRecordSchema` from `fork.ts`.
2. **Constants and types** (`src/lib/consts.ts`, `src/lib/types/`):
   - Update `DEFAULT_CHECKSUM_CONFIG` (drop `sourceFields`, rename `claimSourceAssociationFields` → `claimCitationFields`, add `"type"` to `claimFields`).
   - Update `TCoreChecksumConfig`.
   - Update validation error codes (delete, rename, add).
3. **Core libraries** (`src/lib/core/`):
   - Delete `SourceLibrary` (`source-library.ts` deleted).
   - Rename `ClaimSourceLibrary` → `ClaimCitationLibrary` (file renamed). Single-lookup constructor. Add strict source-side type check and acyclicity check.
   - Update `ClaimLibrary` to enforce type immutability on `update()`.
   - Update `ArgumentLibrary` (drop `TSource`/`TAssoc` generics, rename library field).
   - Update `ForkLibrary` (drop sources namespace).
   - Update `forkArgumentEngine` and `PropositCore.forkArgument()` signatures and internals.
   - Update `ArgumentEngine` constructor + static factories (`fromSnapshot`, `fromData`).
   - Update `PropositCore` constructor.
4. **Interfaces** (`src/lib/core/interfaces/`):
   - Update `library.interfaces.ts` (delete source types, rename association types, update fork and core snapshots).
   - Update `argument-engine.interfaces.ts` and `premise-engine.interfaces.ts` JSDoc.
5. **Utilities** (`src/lib/utils/lookup.ts`):
   - Delete `EMPTY_SOURCE_LOOKUP`. Rename `EMPTY_CLAIM_SOURCE_LOOKUP` → `EMPTY_CLAIM_CITATION_LOOKUP` with renamed methods.
6. **Public exports** (`src/lib/index.ts`):
   - Drop `SourceLibrary` re-export, rename `ClaimSourceLibrary` re-export. Update lookup re-exports.
7. **Parsing layer** (`src/lib/parsing/`):
   - Update `ArgumentParser` generics and constructor signature.
   - Update `schemata.ts` (delete `ParsedSourceSchema`, rename mini-id field, update parsed-argument schema).
   - Update `types.ts` (drop `sourceSchema?` config option).
   - Update `index.ts` barrel.
   - Rewrite `prompt-builder.ts` user-facing copy.
8. **Extensions** (`src/extensions/`):
   - Update `basics/argument-parser.ts` (drop generics).
   - Replace `ieee/source.ts` with `ieee/citation-claim.ts` (or in-place rewrite). Update `ieee/index.ts` barrel.
9. **CLI** (`src/cli/`):
   - Update storage paths and read/write helpers.
   - Replace `commands/sources.ts` with `commands/citations.ts`.
   - Update `engine.ts`, `import.ts`, `commands/parse.ts`, `commands/arguments.ts`, `commands/render.ts`.
   - Update `router.ts`.
   - Add `storage/migrate-v0.10.ts` for one-time data migration on startup.
10. **Tests**:
    - Rewrite all source-referencing tests in `test/core.test.ts`; rename describe blocks; add new tests for type immutability, citation strictness, acyclicity, namespace fold, fork-record schema equality, legacy snapshot validation.
    - Rewrite `test/integration/parse-api.test.ts`.
    - Update `test/extensions/basics.test.ts` and `test/extensions/ieee.test.ts`.
11. **Smoke test** (`scripts/smoke-test.sh`):
    - Rewrite section 9n.
    - Add migration-coverage test.
12. **Examples** (`examples/arguments/`):
    - Update YAML fixtures.
13. **Documentation**:
    - Update all files listed in the "Documentation updates" section below.
14. **Version bump and tag**:
    - `pnpm version minor` to v0.10.0.
    - Rename `docs/release-notes/upcoming.md` → `v0.10.0.md`; rename `docs/changelogs/upcoming.md` → `v0.10.0.md`. Start fresh `upcoming.md` files.
    - Tag `v0.10.0`.

Total estimated touch sites: ~800-900 across ~25-30 files. Single PR with staged commits is feasible. The largest risk-of-slippage commits are (3) core libraries and (10) tests; consider subagent dispatch for the test rewrite if it grows unwieldy.

## Documentation updates

Per the `Documentation Sync` section of `CLAUDE.md`:

- `README.md` — update Concepts (claim type discrimination), usage examples, "Invalid Constructions" section.
- `docs/api-reference.md` — full API reference: claim type field, citation library renames, new error codes.
- `CLAUDE.md` — design rules: claim type immutability, citation acyclicity, citation source-side type strictness, removal of sourceLibrary, ForkLibrary 5 namespaces, single-lookup `ClaimCitationLibrary` constructor.
- `CLI_EXAMPLES.md` — update walkthroughs that reference sources commands.
- `scripts/smoke-test.sh` — section 9n rewrite and migration coverage (also a code change).
- `src/lib/core/interfaces/argument-engine.interfaces.ts` — JSDoc updates.
- `src/lib/core/interfaces/premise-engine.interfaces.ts` — JSDoc updates.
- `src/lib/core/interfaces/library.interfaces.ts` — JSDoc updates.
- `src/lib/core/proposit-core.ts` — JSDoc.
- `src/lib/core/claim-library.ts` — JSDoc.
- `src/lib/core/fork-library.ts` — JSDoc (5 namespaces).
- `src/lib/core/argument-library.ts` — JSDoc (5 generics).
- `examples/arguments/*.yaml` — update fixtures.
- `docs/release-notes/upcoming.md` — user-facing release notes for v0.10.0; explain the unification, the type field, the rename, and the breaking changes including the wire-format change to `TPropositCoreSnapshot.claimCitations` and the collection-checksum reset.
- `docs/changelogs/upcoming.md` — developer changelog with commit hash ranges.

## Decisions deferred to the implementation plan

- Exact public method names on `ClaimCitationLibrary` (e.g., `getCitationsForCitingClaim` vs. `getCitationsByCitingClaim` vs. shorter alternatives). The spec uses indicative names; final naming is a plan-level concern aligned with proposit-core's existing conventions.
- Whether the type field's literal union (`"normal" | "citation"`) lives at `src/lib/schemata/claim.ts` or at a shared location like `src/lib/schemata/shared.ts`.
- Whether the unified `claims.json` file in CLI persistence keeps a flat list or splits by type for human readability.
- IEEE extension schema preservation: keep dedicated `IEEECitationClaimSchema` (recommended) or drop and let consumers compose intersects ad hoc.
- Prompt-builder example-ID convention: keep `s1, s2` for citation miniIds (preserving downstream parser behavior) or migrate to a different convention.

## Pointer to v0.11.0

After v0.10.0 ships, work continues on v0.11.0 (derivation premises). That spec lives at `docs/superpowers/specs/2026-05-05-derivation-premises-design.md` and depends on this release's renamed `ClaimCitationLibrary` and `type: "citation"` claim. The two were originally bundled but split for engineering risk reasons; the design intent is preserved across both releases.
