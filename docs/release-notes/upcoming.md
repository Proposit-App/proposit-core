# Upcoming release notes

This release introduces a third claim type — **axiomatic** — for self-evident propositions invoked as the bottom-level support for a derived claim. It also lands a coordinated rename across the citation library so that both kinds of support — citations and axioms — share a single, symmetric vocabulary throughout the API, the snapshot format, and the CLI.

## What's new

### Axiomatic claims

Every claim now carries an immutable `type` of `"normal"`, `"citation"`, or `"axiomatic"`. Axiomatic claims represent propositions that hold by definition, by historical convention, or by logical necessity — the cases where you want to say "this is true because it's true," without further justification.

The CLI ships three preset reasons for axiomatic claims:

- `true-by-definition`
- `historically-established`
- `logically-required`

```bash
proposit-core claims add --type axiomatic --reason true-by-definition \
    --title "All bachelors are unmarried"
```

Listings tag axiomatic claims with `[axiom: <reasonCode>]`. The `reasonCode` is set at creation and is immutable — `claims update` rejects `--reason` as an unknown option.

### `axioms` command group

A new `axioms` command group manages connections from a normal claim to an axiomatic claim, parallel to the existing `citations` group:

```bash
proposit-core axioms list
proposit-core axioms show <connection-id>
proposit-core axioms add --claim-id <normal-claim-id> --axiom-id <axiomatic-claim-id>
proposit-core axioms remove <connection-id>
```

The supporting endpoint must be a `type=axiomatic` claim and the dependent endpoint must be a `type=normal` claim. There is no acyclicity check — axiomatic claims cannot appear on the dependent side, so cycles are structurally impossible.

### New evaluation semantics for axioms

Axiomatic claim-bound variables are forced to `true` at evaluation time and cannot be assigned by the caller. Citations and normal claims continue to behave exactly as today — the caller is responsible for assigning truth values, and unassigned claim-bound variables evaluate to `null`.

If you want to express "this derivation should not be supported by this axiom," wrap the axiom's variable expression in the antecedent with `not`. Because the axiom's value is fixed at `true`, the negated reference contributes `false` to its parent operator.

For truth-table validity checks, axiomatic-bound variables are excluded from the enumeration set. An argument with `k` claim-bound variables of which `a` are axiomatic enumerates `2^(k - a)` assignments rather than `2^k`.

## Breaking changes

### `citations` CLI rewrite

The `citations` command group switched from positional arguments + `unlink` to flag arguments + `remove`, matching the new `axioms` group and the renamed schema fields. **Scripts pinned against the old form will break.** Update them as follows:

| Before                                              | After                                                      |
| --------------------------------------------------- | ---------------------------------------------------------- |
| `citations add <citing_claim_id> <source_claim_id>` | `citations add --claim-id <id> --supporting-claim-id <id>` |
| `citations unlink <citation_id>`                    | `citations remove <citation_id>`                           |

`citations list` and `citations show` are unchanged.

### Edge vocabulary rename across the API

The citation library, snapshot, and CLI all switched from "citing/source" terminology to "claim/supporting" terminology. The new field names are shared with the axiom library:

- `citingClaimId` / `citingClaimVersion` → `claimId` / `claimVersion`
- `sourceClaimId` / `sourceClaimVersion` → `supportingClaimId` / `supportingClaimVersion`
- Snapshot wrapper field `claimCitations` → `connections`

Three citation error codes were also renamed:

- `CITATION_CITING_REF_NOT_FOUND` → `CITATION_CLAIM_REF_NOT_FOUND`
- `CITATION_SOURCE_REF_NOT_FOUND` → `CITATION_SUPPORTING_REF_NOT_FOUND`
- `CITATION_SOURCE_NOT_CITATION_TYPE` → `CITATION_SUPPORTING_NOT_CITATION_TYPE`

The `getCitationsForCitingClaim` lookup method is now `getConnectionsForClaim`. The reverse-lookup `getCitationsForSourceClaim` was removed (no production callers).

### `populateFromCitations` → `populateFromSupports`

`ManagedDerivationPremiseEngine.populateFromCitations(citationLib, argumentEngine)` is gone. The replacement, `populateFromSupports(citationLib, axiomLib, argumentEngine)`, takes both connection libraries and builds the antecedent from the combined support set — citations first, axioms second. The CLI command `premises populate-citations` keeps its name for backward compatibility, but its behavior now covers axioms too.

### `core.claimCitations` → `core.citations`

`PropositCore` library fields are now all single-word nouns: `claims`, `citations`, `axioms`, `forks`, `arguments`. The previous `claimCitations` field was renamed to `citations` for symmetry with the new `axioms` field.

### `ArgumentEngine` and `ArgumentLibrary` no longer take a citation library

The vestigial `claimCitationLibrary` parameter was dropped from `ArgumentEngine`'s constructor, `ArgumentEngine.fromSnapshot`, `ArgumentEngine.fromData`, the standalone `forkArgumentEngine` function, and the `ArgumentLibrary` constructor + `ArgumentLibrary.fromSnapshot` libraries object. The engine never read the citation library — it was threaded through for prospective future use that never materialized — so removal is purely a signature cleanup. `PropositCore` (the recommended entry point) is unchanged: it still accepts a `claimCitationLibrary` option and owns the live `ClaimCitationLibrary` instance via `core.citations`. Direct callers of `ArgumentEngine` / `ArgumentLibrary` / `forkArgumentEngine` need to drop the citation-library argument from each call site.

## Migration

### CLI users

Migration is automatic. The first time you run any v0.12 CLI command against an existing state directory, the CLI:

1. Renames `claim-citations.json` to `citations.json`.
2. Rewrites the wrapper field (`claimCitations` → `connections`).
3. Renames the four edge fields on each citation entity (`citingClaimId` → `claimId`, etc.) and recomputes checksums.
4. Initializes a new `axioms.json` file with `{ connections: [] }`.
5. Writes a `.proposit-v0.12` marker so the migration runs only once.

Each step is independently idempotent — a partial-failure rerun lands on the same end state.

### Library consumers

If you embed `@proposit/proposit-core` in another application (for example `proposit-server`, `proposit-mobile`, or your own integration), the upgrade is **not** automatic. When core encounters pre-v0.12 data during snapshot restore it raises one of two validation errors:

- `LEGACY_CLAIM_CITATION_SHAPE` — the snapshot still uses the `claimCitations` wrapper key or per-entity field names like `citingClaimId`.
- `LEGACY_MISSING_AXIOM_SLOT` — the `PropositCore` snapshot lacks an `axioms` slot (pre-v0.12 data).

Both signals indicate that you need to migrate your persisted data before loading the snapshot. The CLI's `migrate-v0.12.ts` is a reference implementation of the rewrite logic.

## Wire-format changes

Snapshots crossing process boundaries have a new shape:

- `TPropositCoreSnapshot.claimCitations` → `TPropositCoreSnapshot.citations`. New `axioms` slot added.
- The wrapper field on both connection-library snapshots is `connections` (was `claimCitations` on the citation snapshot).
- Each connection entity uses the new field names (`claimId` / `supportingClaimId`).
- Per-citation checksums shift on the day of upgrade because the entity field set changed.
