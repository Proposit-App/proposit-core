# Library Persistence and CLI Commands

Adds disk persistence for claim, source, and claim-source association libraries. Fixes hydration to restore libraries from disk. Un-stubs source commands and adds claim commands.

## Storage Layer

### Directory Structure

Global library files at the top level of the state directory, alongside the existing `arguments/` directory:

```
~/.proposit-core/
  claims.json
  sources.json
  claim-source-associations.json
  arguments/
    ...existing structure unchanged...
```

Each file stores the library's snapshot (the output of `library.snapshot()`).

### Storage Module: `src/cli/storage/libraries.ts`

Replaces the existing `src/cli/storage/sources.ts` stub.

**Read functions** return a restored library instance. If the file does not exist, they return a fresh empty library (no error).

- `readClaimLibrary(): Promise<ClaimLibrary>`
- `readSourceLibrary(): Promise<SourceLibrary>`
- `readClaimSourceLibrary(claimLibrary: TClaimLookup, sourceLibrary: TSourceLookup): Promise<ClaimSourceLibrary>`

**Write functions** serialize `library.snapshot()` as JSON.

- `writeClaimLibrary(library: ClaimLibrary): Promise<void>`
- `writeSourceLibrary(library: SourceLibrary): Promise<void>`
- `writeClaimSourceLibrary(library: ClaimSourceLibrary): Promise<void>`

Restoration uses the existing static `fromSnapshot()` methods on each library class.

### Engine Integration: `src/cli/engine.ts`

Two new standalone functions:

```typescript
async function hydrateLibraries(): Promise<{
    claimLibrary: ClaimLibrary
    sourceLibrary: SourceLibrary
    claimSourceLibrary: ClaimSourceLibrary
}>
```

Reads all three libraries from disk via the storage module.

```typescript
async function persistLibraries(
    claimLibrary: ClaimLibrary,
    sourceLibrary: SourceLibrary,
    claimSourceLibrary: ClaimSourceLibrary
): Promise<void>
```

Writes all three libraries to disk via the storage module.

### `hydrateEngine` Signature Change

Current:

```typescript
async function hydrateEngine(
    argumentId: string,
    version: number
): Promise<ArgumentEngine>
```

New:

```typescript
async function hydrateEngine(
    argumentId: string,
    version: number,
    libraries?: {
        claimLibrary: ClaimLibrary
        sourceLibrary: SourceLibrary
        claimSourceLibrary: ClaimSourceLibrary
    }
): Promise<ArgumentEngine>
```

When `libraries` is provided, the function uses those libraries. When omitted, it auto-loads from disk via `hydrateLibraries()`. This means existing callers (render, roles, variables, expressions, analysis, diff) require zero changes — they automatically get library restoration.

### Placeholder Claim Generation

Before calling `engine.addVariable()` during hydration, `hydrateEngine` checks each claim-bound variable (via `isClaimBound(variable)`) for whether its `claimId`/`claimVersion` exists in the claim library. Premise-bound variables (which have no `claimId`) are skipped.

If the referenced claim is missing, a placeholder is injected directly into the claim library's internal state via `ClaimLibrary.fromSnapshot()`. Specifically: build a temporary snapshot containing just the missing claim entries, then merge them into the existing library by reconstructing it. Alternatively, since `fromSnapshot` populates internal Maps directly, the simplest approach is to construct the library from a combined snapshot (existing claims + placeholders) before creating the engine.

**Implementation approach:** Before the variable-registration loop, scan all stored variables, collect any missing `claimId`/`claimVersion` pairs, create placeholder `TCoreClaim` objects for them, and rebuild the claim library from a combined snapshot (original claims + placeholders). This happens once, before the engine is constructed.

Placeholder claims are minimal: `{ id, version, frozen: true }` (plus checksum). They are part of the in-memory library and will be persisted if the caller writes libraries back to disk.

## Caller Updates

Existing version-scoped commands that call `hydrateEngine` (render, roles, variables, expressions, analysis, diff) require **no changes** — they omit the `libraries` parameter, so `hydrateEngine` auto-loads from disk.

Only commands that explicitly construct or merge libraries need to call `hydrateLibraries()` and `persistLibraries()` themselves: `arguments parse`, `arguments import`, and the new `claims`/`sources` commands.

### `arguments parse` (modified)

After `parser.build(response)` returns `{ engine, claimLibrary, sourceLibrary, claimSourceLibrary }`:

1. Read existing global libraries via `hydrateLibraries()`.
2. Merge: combine the existing library snapshots with the new library snapshots. Concatenate the claim arrays, source arrays, and association arrays from both snapshots, then reconstruct each library via `fromSnapshot()` on the combined data. Duplicate entries (same `id` + `version`) from the new libraries overwrite existing ones since they share the same identity.
3. Pass the merged libraries to the engine (the engine was already built with the new libraries, but the merged libraries are used for persistence).
4. `persistEngine(engine)`
5. `persistLibraries(mergedClaimLibrary, mergedSourceLibrary, mergedClaimSourceLibrary)`

### `arguments import` (modified)

`importArgumentFromYaml` currently returns only an `ArgumentEngine` and discards the libraries it creates internally. Change it to return `{ engine, claimLibrary, sourceLibrary, claimSourceLibrary }` (same result shape as `ArgumentParser.build()`). The `arguments import` command then calls `persistLibraries` with the same merge strategy as `arguments parse`.

## Source Commands (un-stub)

Source commands become **top-level** (not version-scoped) since libraries are global. Move registration from the version-scoped sub-program to the main program in `src/cli.ts`.

Replace stubs in `src/cli/commands/sources.ts`:

| Command                                     | Behavior                                                     |
| ------------------------------------------- | ------------------------------------------------------------ |
| `sources list [--json]`                     | List all sources from the global source library              |
| `sources show <source_id> [--json]`         | Show a specific source                                       |
| `sources add --text <text>`                 | Create a new source in the global library, persist, print ID |
| `sources link-claim <source_id> <claim_id>` | Create a claim-source association, persist                   |
| `sources unlink <association_id>`           | Remove a claim-source association, persist                   |

These commands load global libraries via `hydrateLibraries()`, mutate them, and call `persistLibraries()`. They do not need `hydrateEngine` since they operate on libraries only.

Note: `sources remove` is **not included**. `SourceLibrary` follows the "no deletion" design rule (freeze semantics only). Sources are append-only versioned entities.

## Claim Commands (new)

New file: `src/cli/commands/claims.ts`, registered as a top-level command group in `src/cli.ts`.

| Command                           | Behavior                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `claims list [--json]`            | List all claims from the global claim library. Each claim displays `id` and `version`. With `--json`, outputs the full claim objects. |
| `claims show <claim_id> [--json]` | Show all versions of a specific claim                                                                                                 |
| `claims add`                      | Create a new claim (version 0), persist, print ID                                                                                     |
| `claims freeze <claim_id>`        | Freeze the current version and create a new mutable version, persist                                                                  |

Note: `claims remove` is **not included**. `ClaimLibrary` follows the "no deletion" design rule (freeze semantics only). Claims are append-only versioned entities. The `freeze` command exposes the library's freeze semantics to CLI users.

## Router Update

`src/cli/router.ts` must add `"claims"` and `"sources"` to the `NAMED_COMMANDS` set so they are recognized as top-level commands rather than being interpreted as argument IDs.

## Files

### Created

- `src/cli/storage/libraries.ts`
- `src/cli/commands/claims.ts`

### Modified

- `src/cli/engine.ts` — `hydrateLibraries`, `persistLibraries`, `hydrateEngine` optional libraries + placeholder logic
- `src/cli/commands/sources.ts` — replace stubs with working implementations, change to top-level registration
- `src/cli/commands/parse.ts` — merge + persist libraries
- `src/cli/commands/arguments.ts` — update `arguments import` to persist libraries
- `src/cli/import.ts` — return libraries alongside engine
- `src/cli.ts` — register `claims` and `sources` as top-level commands, remove version-scoped source registration
- `src/cli/router.ts` — add `"claims"` and `"sources"` to `NAMED_COMMANDS`

### Deleted

- `src/cli/storage/sources.ts` — replaced by `libraries.ts`
