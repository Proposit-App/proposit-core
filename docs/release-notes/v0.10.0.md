# Release Notes — v0.10.0

This release unifies sources and claims into a single entity model. Sources no longer exist as a separate type; they are now claims with `type: "citation"`. The change simplifies the data model, removes a class of duplicated machinery, and lays the groundwork for citation graphs that follow the same versioning and forking rules as ordinary claims.

## What's changed

### One claim, two types

Every claim now carries an immutable `type` field, either `"normal"` or `"citation"`. Citation claims play the role that the old `Source` entity used to play — they are the things you cite when you record a claim's provenance. Normal claims are everything else.

The type is decided at creation time and cannot be changed afterward. If you need to change a claim's type, delete it and create a new one.

### CLI changes

- `proposit claims add` now accepts `--type` (defaults to `"normal"`). Pass `--type=citation` to create a citation claim.
- `proposit sources …` is gone. The replacement is `proposit citations …`, with the subcommands `list`, `show`, `add`, and `unlink`. The behavior is the same — only citation-typed claims may appear on the source side of a citation edge.

### Citation graph invariants

The citation graph (which claims cite which other claims) now enforces two rules:

- **Citation-typed only.** Only claims with `type: "citation"` can appear on the source side of a citation edge. Trying to cite a normal claim raises a validation error.
- **No cycles.** The citation graph must be acyclic. Adding an edge that would create a cycle is rejected.

These rules are enforced at the library level, so any code that builds citation graphs will surface violations immediately.

## Migration

### CLI users

Migration is automatic. The first time you run any v0.10 CLI command against an existing state directory, the CLI rewrites the on-disk format in place: source records are converted into citation-typed claims, association files are renamed, and a `.proposit-v0.10` marker is written so the migration runs only once.

There is one thing to check before upgrading: if you ever stored a custom extra named `type` on a source record, rename it (for example to `kind`) before running v0.10. The new schema reserves `type` for the discriminator and will reject conflicting extras.

### Library consumers

If you embed `@proposit/proposit-core` in another application (for example `proposit-server`, `proposit-mobile`, or your own integration), the upgrade is not automatic — you need to migrate your persisted data and update your code. See `docs/migrations/0.9.0-0.10.0.md` for a step-by-step guide.

When core encounters pre-v0.10 data during snapshot restore, it raises a validation error with code `LEGACY_CLAIM_MISSING_TYPE`. Use that signal to drive your migration logic.

## Wire-format changes

Snapshots crossing process boundaries (HTTP, IPC, file storage) have a new shape:

- `TPropositCoreSnapshot` no longer has a `sources` field. All claims live in `claims`, regardless of type.
- `claimSources` is now `claimCitations`. Apps that round-trip snapshots over the wire need to accept the new field name. There is no compatibility shim — the rename is hard.

Collection-level checksums for claims and citations also shift on the day of upgrade because the underlying entity shape changed. Expression-level and argument-level checksums are unaffected — variables reference claims by `(id, version)`, not by checksum, so existing argument data continues to validate against migrated claim data.
