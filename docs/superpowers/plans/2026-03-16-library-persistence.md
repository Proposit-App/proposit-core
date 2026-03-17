# Library Persistence Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist claim, source, and claim-source libraries to disk so that hydrated engines restore them correctly. Add CLI commands for managing claims and sources.

**Architecture:** A new storage module (`src/cli/storage/libraries.ts`) handles read/write of library snapshots as global JSON files. `hydrateEngine` gains optional library parameters — when omitted, it auto-loads from disk. New top-level `claims` and `sources` commands operate on global libraries. Import and parse flows merge new libraries into the global state.

**Tech Stack:** TypeScript, Commander.js, existing ClaimLibrary/SourceLibrary/ClaimSourceLibrary APIs (snapshot/fromSnapshot)

**Spec:** `docs/superpowers/specs/2026-03-16-library-persistence-design.md`

---

## Chunk 1: Storage Layer and Engine

### Task 1: Library Storage Module

**Files:**

- Create: `src/cli/storage/libraries.ts`

- [ ] **Step 1: Create the storage module**

```typescript
import fs from "node:fs/promises"
import path from "node:path"
import { ClaimLibrary } from "../../lib/core/claim-library.js"
import { SourceLibrary } from "../../lib/core/source-library.js"
import { ClaimSourceLibrary } from "../../lib/core/claim-source-library.js"
import type {
    TClaimLookup,
    TSourceLookup,
} from "../../lib/core/interfaces/library.interfaces.js"
import { getStateDir } from "../config.js"

function claimsPath(): string {
    return path.join(getStateDir(), "claims.json")
}

function sourcesPath(): string {
    return path.join(getStateDir(), "sources.json")
}

function claimSourceAssociationsPath(): string {
    return path.join(getStateDir(), "claim-source-associations.json")
}

export async function readClaimLibrary(): Promise<ClaimLibrary> {
    try {
        const content = await fs.readFile(claimsPath(), "utf-8")
        const snapshot = JSON.parse(content)
        return ClaimLibrary.fromSnapshot(snapshot)
    } catch {
        return new ClaimLibrary()
    }
}

export async function readSourceLibrary(): Promise<SourceLibrary> {
    try {
        const content = await fs.readFile(sourcesPath(), "utf-8")
        const snapshot = JSON.parse(content)
        return SourceLibrary.fromSnapshot(snapshot)
    } catch {
        return new SourceLibrary()
    }
}

export async function readClaimSourceLibrary(
    claimLookup: TClaimLookup,
    sourceLookup: TSourceLookup
): Promise<ClaimSourceLibrary> {
    try {
        const content = await fs.readFile(
            claimSourceAssociationsPath(),
            "utf-8"
        )
        const snapshot = JSON.parse(content)
        return ClaimSourceLibrary.fromSnapshot(
            snapshot,
            claimLookup,
            sourceLookup
        )
    } catch {
        return new ClaimSourceLibrary(claimLookup, sourceLookup)
    }
}

export async function writeClaimLibrary(library: ClaimLibrary): Promise<void> {
    const filePath = claimsPath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(library.snapshot(), null, 2))
}

export async function writeSourceLibrary(
    library: SourceLibrary
): Promise<void> {
    const filePath = sourcesPath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(library.snapshot(), null, 2))
}

export async function writeClaimSourceLibrary(
    library: ClaimSourceLibrary
): Promise<void> {
    const filePath = claimSourceAssociationsPath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(library.snapshot(), null, 2))
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/cli/storage/libraries.ts
git commit -m "feat(cli): add library storage module for claims, sources, and associations"
```

### Task 2: Engine — hydrateLibraries, persistLibraries, and Updated hydrateEngine

**Files:**

- Modify: `src/cli/engine.ts`
- Delete: `src/cli/storage/sources.ts`

The key design choice: `hydrateEngine` gains optional library parameters. When omitted, it auto-loads libraries from disk via `hydrateLibraries()`. This means **all existing callers continue working with zero changes** — they automatically get library restoration.

- [ ] **Step 1: Add hydrateLibraries and persistLibraries to engine.ts**

Add these imports at the top of `src/cli/engine.ts`:

```typescript
import {
    readClaimLibrary,
    readSourceLibrary,
    readClaimSourceLibrary,
    writeClaimLibrary,
    writeSourceLibrary,
    writeClaimSourceLibrary,
} from "./storage/libraries.js"
import { isClaimBound } from "../lib/schemata/index.js"
```

Add these two new exported functions after the existing imports (before `hydrateEngine`):

```typescript
export async function hydrateLibraries(): Promise<{
    claimLibrary: ClaimLibrary
    sourceLibrary: SourceLibrary
    claimSourceLibrary: ClaimSourceLibrary
}> {
    const claimLibrary = await readClaimLibrary()
    const sourceLibrary = await readSourceLibrary()
    const claimSourceLibrary = await readClaimSourceLibrary(
        claimLibrary,
        sourceLibrary
    )
    return { claimLibrary, sourceLibrary, claimSourceLibrary }
}

export async function persistLibraries(
    claimLibrary: ClaimLibrary,
    sourceLibrary: SourceLibrary,
    claimSourceLibrary: ClaimSourceLibrary
): Promise<void> {
    await Promise.all([
        writeClaimLibrary(claimLibrary),
        writeSourceLibrary(sourceLibrary),
        writeClaimSourceLibrary(claimSourceLibrary),
    ])
}
```

- [ ] **Step 2: Update hydrateEngine signature and implementation**

Change the `hydrateEngine` function signature to accept optional library parameters. Add placeholder claim generation for backward compatibility.

New signature:

```typescript
export async function hydrateEngine(
    argumentId: string,
    version: number,
    libraries?: {
        claimLibrary: ClaimLibrary
        sourceLibrary: SourceLibrary
        claimSourceLibrary: ClaimSourceLibrary
    }
): Promise<ArgumentEngine>
```

Inside the function body, replace the library construction block:

Old (around line 56-61):

```typescript
const engine = new ArgumentEngine(
    argument,
    new ClaimLibrary(),
    new SourceLibrary(),
    new ClaimSourceLibrary(new ClaimLibrary(), new SourceLibrary())
)
```

New:

```typescript
const libs = libraries ?? (await hydrateLibraries())
const { claimLibrary, sourceLibrary, claimSourceLibrary } = libs

// Placeholder claim generation: ensure all claim-bound variables
// reference claims that exist in the library. This handles arguments
// created before library persistence was implemented.
for (const variable of allVariables) {
    if (
        isClaimBound(variable) &&
        !claimLibrary.get(variable.claimId, variable.claimVersion)
    ) {
        // Rebuild library with placeholder claim injected
        const snapshot = claimLibrary.snapshot()
        snapshot.claims.push({
            id: variable.claimId,
            version: variable.claimVersion,
            frozen: true,
            checksum: "",
        } as (typeof snapshot.claims)[number])
        const rebuilt = ClaimLibrary.fromSnapshot(snapshot)
        // Replace the library reference — we need to reconstruct libs
        libs.claimLibrary = rebuilt
    }
}

const engine = new ArgumentEngine(
    argument,
    libs.claimLibrary,
    sourceLibrary,
    claimSourceLibrary
)
```

Note: The `libs` variable must be `let` (not `const`) or we use a mutable wrapper. Simplest approach: collect all missing claims first, then rebuild once:

```typescript
const libs = libraries ?? (await hydrateLibraries())
let { claimLibrary } = libs
const { sourceLibrary, claimSourceLibrary } = libs

// Placeholder claim generation for backward compatibility
const missingClaims: { id: string; version: number }[] = []
for (const variable of allVariables) {
    if (
        isClaimBound(variable) &&
        !claimLibrary.get(variable.claimId, variable.claimVersion)
    ) {
        missingClaims.push({
            id: variable.claimId,
            version: variable.claimVersion,
        })
    }
}
if (missingClaims.length > 0) {
    const snapshot = claimLibrary.snapshot()
    for (const missing of missingClaims) {
        snapshot.claims.push({
            id: missing.id,
            version: missing.version,
            frozen: true,
            checksum: "",
        } as (typeof snapshot.claims)[number])
    }
    claimLibrary = ClaimLibrary.fromSnapshot(snapshot)
}

const engine = new ArgumentEngine(
    argument,
    claimLibrary,
    sourceLibrary,
    claimSourceLibrary
)
```

Also remove the old imports that are no longer needed (the inline `new ClaimLibrary()` etc. were the only uses):

- If `ClaimLibrary`, `SourceLibrary`, `ClaimSourceLibrary` are still imported at the top, keep them (they're now used in the function signatures).

- [ ] **Step 3: Delete the old sources storage stub**

Delete `src/cli/storage/sources.ts`. It is fully replaced by `src/cli/storage/libraries.ts`.

Check that nothing else imports from it:

```bash
grep -r "storage/sources" src/
```

If anything imports from it, update those imports. (The current codebase: only `sources.ts` commands imported from it, and those are stubbed — they'll be rewritten in Task 7.)

- [ ] **Step 4: Verify typecheck and tests**

Run: `pnpm run typecheck && pnpm run test`
Expected: PASS (all existing callers of `hydrateEngine(argId, version)` still work — the third param is optional)

- [ ] **Step 5: Commit**

```bash
git add src/cli/engine.ts
git rm src/cli/storage/sources.ts
git commit -m "feat(cli): add library hydration/persistence with placeholder claim generation"
```

## Chunk 2: Import and Parse Updates

### Task 3: Update YAML Import to Return Libraries

**Files:**

- Modify: `src/cli/import.ts`

`importArgumentFromYaml` currently returns `ArgumentEngine`. Change it to return an object with the engine and all three libraries, matching the shape of `ArgumentParser.build()`.

- [ ] **Step 1: Change the return type, capture library variables, and return them**

Change the function signature from:

```typescript
export function importArgumentFromYaml(yamlString: string): ArgumentEngine {
```

To:

```typescript
export function importArgumentFromYaml(yamlString: string): {
    engine: ArgumentEngine
    claimLibrary: ClaimLibrary
    sourceLibrary: SourceLibrary
    claimSourceLibrary: ClaimSourceLibrary
} {
```

The existing code creates two separate `new SourceLibrary()` instances inline. Fix this by capturing into shared variables. Replace:

```typescript
const engine = new ArgumentEngine(
    argument,
    claimLibrary,
    new SourceLibrary(),
    new ClaimSourceLibrary(claimLibrary, new SourceLibrary())
)
```

With:

```typescript
const sourceLibrary = new SourceLibrary()
const claimSourceLibrary = new ClaimSourceLibrary(claimLibrary, sourceLibrary)
const engine = new ArgumentEngine(
    argument,
    claimLibrary,
    sourceLibrary,
    claimSourceLibrary
)
```

At the end of the function, change `return engine` to:

```typescript
return { engine, claimLibrary, sourceLibrary, claimSourceLibrary }
```

- [ ] **Step 2: Update the `arguments import` caller**

In `src/cli/commands/arguments.ts`, the `import` subcommand currently does:

```typescript
let engine: ReturnType<typeof importArgumentFromYaml>
try {
    engine = importArgumentFromYaml(content)
} catch (error) { ... }
await persistEngine(engine)
printLine(engine.getArgument().id)
```

Update to:

```typescript
import { hydrateLibraries, persistEngine, persistLibraries } from "../engine.js"
```

And the action body:

```typescript
let result: ReturnType<typeof importArgumentFromYaml>
try {
    result = importArgumentFromYaml(content)
} catch (error) { ... }

// Merge new libraries into existing global libraries
const existing = await hydrateLibraries()
const mergedClaims = ClaimLibrary.fromSnapshot({
    claims: [
        ...existing.claimLibrary.snapshot().claims,
        ...result.claimLibrary.snapshot().claims,
    ],
})
const mergedSources = SourceLibrary.fromSnapshot({
    sources: [
        ...existing.sourceLibrary.snapshot().sources,
        ...result.sourceLibrary.snapshot().sources,
    ],
})
const mergedAssocs = ClaimSourceLibrary.fromSnapshot(
    {
        claimSourceAssociations: [
            ...existing.claimSourceLibrary.snapshot().claimSourceAssociations,
            ...result.claimSourceLibrary.snapshot().claimSourceAssociations,
        ],
    },
    mergedClaims,
    mergedSources
)

await persistEngine(result.engine)
await persistLibraries(mergedClaims, mergedSources, mergedAssocs)
printLine(result.engine.getArgument().id)
```

Add the necessary imports at the top of `arguments.ts`:

```typescript
import { ClaimLibrary } from "../../lib/core/claim-library.js"
import { SourceLibrary } from "../../lib/core/source-library.js"
import { ClaimSourceLibrary } from "../../lib/core/claim-source-library.js"
import { hydrateLibraries, persistLibraries } from "../engine.js"
```

- [ ] **Step 3: Verify typecheck and tests**

Run: `pnpm run typecheck && pnpm run test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/cli/import.ts src/cli/commands/arguments.ts
git commit -m "feat(cli): persist libraries from YAML import"
```

### Task 4: Update Parse Command to Merge and Persist Libraries

**Files:**

- Modify: `src/cli/commands/parse.ts`

- [ ] **Step 1: Update parse command to merge and persist libraries**

Add imports at the top of `parse.ts`:

```typescript
import { ClaimLibrary } from "../../lib/core/claim-library.js"
import { SourceLibrary } from "../../lib/core/source-library.js"
import { ClaimSourceLibrary } from "../../lib/core/claim-source-library.js"
import { hydrateLibraries, persistLibraries } from "../engine.js"
```

Update the import of `persistEngine`:

```typescript
import { persistEngine } from "../engine.js"
```

to:

```typescript
import { hydrateLibraries, persistEngine, persistLibraries } from "../engine.js"
```

In the action body, replace the build + persist section (after validation and null check). Currently:

```typescript
// 8. Build engine
let engine
try {
    const built = parser.build(response)
    engine = built.engine
} catch (error) { ... }

// 9. Persist and output
await persistEngine(engine)
printLine(engine.getArgument().id)
```

New:

```typescript
// 8. Build engine
let built
try {
    built = parser.build(response)
} catch (error) {
    errorExit(
        `Build failed: ${error instanceof Error ? error.message : String(error)}`
    )
}

// 9. Merge libraries with existing global state
const existing = await hydrateLibraries()
const mergedClaims = ClaimLibrary.fromSnapshot({
    claims: [
        ...existing.claimLibrary.snapshot().claims,
        ...built.claimLibrary.snapshot().claims,
    ],
})
const mergedSources = SourceLibrary.fromSnapshot({
    sources: [
        ...existing.sourceLibrary.snapshot().sources,
        ...built.sourceLibrary.snapshot().sources,
    ],
})
const mergedAssocs = ClaimSourceLibrary.fromSnapshot(
    {
        claimSourceAssociations: [
            ...existing.claimSourceLibrary.snapshot().claimSourceAssociations,
            ...built.claimSourceLibrary.snapshot().claimSourceAssociations,
        ],
    },
    mergedClaims,
    mergedSources
)

// 10. Persist and output
await persistEngine(built.engine)
await persistLibraries(mergedClaims, mergedSources, mergedAssocs)
printLine(built.engine.getArgument().id)
```

- [ ] **Step 2: Verify typecheck and tests**

Run: `pnpm run typecheck && pnpm run test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/parse.ts
git commit -m "feat(cli): merge and persist libraries from parse command"
```

## Chunk 3: Global Library Commands

### Task 5: Rewrite Source Commands as Top-Level

**Files:**

- Modify: `src/cli/commands/sources.ts` (full rewrite)

The source commands become top-level (no `argumentId`/`version` params). They load global libraries, mutate, and persist.

- [ ] **Step 1: Rewrite sources.ts**

```typescript
import { randomUUID } from "node:crypto"
import { Command } from "commander"
import { hydrateLibraries, persistLibraries } from "../engine.js"
import { errorExit, printJson, printLine } from "../output.js"

export function registerSourceCommands(program: Command): void {
    const sources = program
        .command("sources")
        .description("Manage global source library")

    sources
        .command("list")
        .description("List all sources")
        .option("--json", "Output as JSON")
        .action(async (opts: { json?: boolean }) => {
            const { sourceLibrary } = await hydrateLibraries()
            const all = sourceLibrary.getAll()
            if (opts.json) {
                printJson(all)
            } else {
                for (const source of all) {
                    const extras = source as Record<string, unknown>
                    const text = extras.text ? ` | ${extras.text}` : ""
                    printLine(`${source.id}@${source.version}${text}`)
                }
            }
        })

    sources
        .command("show <source_id>")
        .description("Show all versions of a source")
        .option("--json", "Output as JSON")
        .action(async (sourceId: string, opts: { json?: boolean }) => {
            const { sourceLibrary } = await hydrateLibraries()
            const versions = sourceLibrary.getVersions(sourceId)
            if (versions.length === 0) {
                errorExit(`Source "${sourceId}" not found.`)
            }
            if (opts.json) {
                printJson(versions)
            } else {
                for (const v of versions) {
                    const extras = v as Record<string, unknown>
                    const frozen = v.frozen ? " [frozen]" : ""
                    const text = extras.text ? ` | ${extras.text}` : ""
                    printLine(`v${v.version}${frozen}${text}`)
                }
            }
        })

    sources
        .command("add")
        .description("Create a new source")
        .requiredOption("--text <text>", "Source text")
        .action(async (opts: { text: string }) => {
            const libs = await hydrateLibraries()
            const source = libs.sourceLibrary.create({
                id: randomUUID(),
                text: opts.text,
            } as Parameters<typeof libs.sourceLibrary.create>[0])
            await persistLibraries(
                libs.claimLibrary,
                libs.sourceLibrary,
                libs.claimSourceLibrary
            )
            printLine(source.id)
        })

    sources
        .command("link-claim <source_id> <claim_id>")
        .description("Link a source to a claim via a new association")
        .action(async (sourceId: string, claimId: string) => {
            const libs = await hydrateLibraries()
            const source = libs.sourceLibrary.getCurrent(sourceId)
            if (!source) {
                errorExit(`Source "${sourceId}" not found.`)
            }
            const claim = libs.claimLibrary.getCurrent(claimId)
            if (!claim) {
                errorExit(`Claim "${claimId}" not found.`)
            }
            const assoc = libs.claimSourceLibrary.add({
                id: randomUUID(),
                claimId: claim.id,
                claimVersion: claim.version,
                sourceId: source.id,
                sourceVersion: source.version,
            })
            await persistLibraries(
                libs.claimLibrary,
                libs.sourceLibrary,
                libs.claimSourceLibrary
            )
            printLine(assoc.id)
        })

    sources
        .command("unlink <association_id>")
        .description("Remove a claim-source association")
        .action(async (associationId: string) => {
            const libs = await hydrateLibraries()
            const assoc = libs.claimSourceLibrary.get(associationId)
            if (!assoc) {
                errorExit(`Association "${associationId}" not found.`)
            }
            libs.claimSourceLibrary.remove(associationId)
            await persistLibraries(
                libs.claimLibrary,
                libs.sourceLibrary,
                libs.claimSourceLibrary
            )
            printLine("success")
        })
}
```

Note: The registration signature changes from `(versionedCmd, argumentId, version)` to `(program)` — this is handled in Task 7 when we update `cli.ts`.

- [ ] **Step 2: Verify typecheck**

Run: `pnpm run typecheck`
Expected: May fail because `cli.ts` still registers sources as version-scoped. That's fixed in Task 7.

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/sources.ts
git commit -m "feat(cli): rewrite source commands as top-level global library commands"
```

### Task 6: Create Claim Commands

**Files:**

- Create: `src/cli/commands/claims.ts`

- [ ] **Step 1: Create claims.ts**

```typescript
import { randomUUID } from "node:crypto"
import { Command } from "commander"
import { hydrateLibraries, persistLibraries } from "../engine.js"
import { errorExit, printJson, printLine } from "../output.js"

export function registerClaimCommands(program: Command): void {
    const claims = program
        .command("claims")
        .description("Manage global claim library")

    claims
        .command("list")
        .description("List all claims")
        .option("--json", "Output as JSON")
        .action(async (opts: { json?: boolean }) => {
            const { claimLibrary } = await hydrateLibraries()
            const all = claimLibrary.getAll()
            if (opts.json) {
                printJson(all)
            } else {
                for (const claim of all) {
                    const frozen = claim.frozen ? " [frozen]" : ""
                    printLine(`${claim.id}@${claim.version}${frozen}`)
                }
            }
        })

    claims
        .command("show <claim_id>")
        .description("Show all versions of a claim")
        .option("--json", "Output as JSON")
        .action(async (claimId: string, opts: { json?: boolean }) => {
            const { claimLibrary } = await hydrateLibraries()
            const versions = claimLibrary.getVersions(claimId)
            if (versions.length === 0) {
                errorExit(`Claim "${claimId}" not found.`)
            }
            if (opts.json) {
                printJson(versions)
            } else {
                for (const v of versions) {
                    const frozen = v.frozen ? " [frozen]" : ""
                    printLine(`v${v.version}${frozen}`)
                }
            }
        })

    claims
        .command("add")
        .description("Create a new claim")
        .action(async () => {
            const libs = await hydrateLibraries()
            const claim = libs.claimLibrary.create({
                id: randomUUID(),
            } as Parameters<typeof libs.claimLibrary.create>[0])
            await persistLibraries(
                libs.claimLibrary,
                libs.sourceLibrary,
                libs.claimSourceLibrary
            )
            printLine(claim.id)
        })

    claims
        .command("freeze <claim_id>")
        .description(
            "Freeze the current version and create a new mutable version"
        )
        .action(async (claimId: string) => {
            const libs = await hydrateLibraries()
            const current = libs.claimLibrary.getCurrent(claimId)
            if (!current) {
                errorExit(`Claim "${claimId}" not found.`)
            }
            let frozen, newVersion
            try {
                const result = libs.claimLibrary.freeze(claimId)
                frozen = result.frozen
                newVersion = result.current
            } catch (error) {
                errorExit(
                    error instanceof Error ? error.message : String(error)
                )
            }
            await persistLibraries(
                libs.claimLibrary,
                libs.sourceLibrary,
                libs.claimSourceLibrary
            )
            printLine(
                `Frozen v${frozen.version}, new mutable v${newVersion.version}`
            )
        })
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm run typecheck`
Expected: PASS (or may need Task 7 for full wiring)

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/claims.ts
git commit -m "feat(cli): add claim management commands"
```

### Task 7: Update CLI Entry Point and Router

**Files:**

- Modify: `src/cli.ts`
- Modify: `src/cli/router.ts`

- [ ] **Step 1: Update router.ts**

Add `"claims"` and `"sources"` to `NAMED_COMMANDS`:

```typescript
const NAMED_COMMANDS = new Set([
    "help",
    "--help",
    "-h",
    "version",
    "--version",
    "-V",
    "arguments",
    "claims",
    "diff",
    "sources",
])
```

- [ ] **Step 2: Update cli.ts**

Add imports:

```typescript
import { registerClaimCommands } from "./cli/commands/claims.js"
import { registerSourceCommands } from "./cli/commands/sources.js"
```

Register as top-level commands (in the "Named top-level commands" section, after `registerDiffCommand(program)`):

```typescript
registerClaimCommands(program)
registerSourceCommands(program)
```

Remove the version-scoped source registration. In the version-scoped section, delete:

```typescript
registerSourceCommands(sub, argumentId, version)
```

And remove the import:

```typescript
import { registerSourceCommands } from "./cli/commands/sources.js"
```

Since `registerSourceCommands` is now imported for top-level use, move the import to the top-level section if it isn't already there. Make sure there's only one import of `registerSourceCommands`.

- [ ] **Step 3: Verify typecheck and tests**

Run: `pnpm run typecheck && pnpm run test`
Expected: PASS

- [ ] **Step 4: Verify CLI commands register correctly**

Run:

```bash
pnpm run build && pnpm cli claims --help && pnpm cli sources --help
```

Expected: Both show their subcommands.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/cli/router.ts
git commit -m "feat(cli): register claims and sources as top-level commands"
```

## Chunk 4: Tests and Final Checks

### Task 8: Tests

**Files:**

- Modify: `test/core.test.ts`

- [ ] **Step 1: Add tests for library storage round-trip**

Add at the bottom of `test/core.test.ts`:

```typescript
describe("Library persistence", () => {
    it("ClaimLibrary round-trips through snapshot", () => {
        const lib = new ClaimLibrary()
        const claim = lib.create({ id: "c1" } as Parameters<
            typeof lib.create
        >[0])
        const snapshot = lib.snapshot()
        const restored = ClaimLibrary.fromSnapshot(snapshot)
        expect(restored.get("c1", 0)).toBeDefined()
        expect(restored.get("c1", 0)!.id).toBe("c1")
    })

    it("SourceLibrary round-trips through snapshot", () => {
        const lib = new SourceLibrary()
        const source = lib.create({ id: "s1" } as Parameters<
            typeof lib.create
        >[0])
        const snapshot = lib.snapshot()
        const restored = SourceLibrary.fromSnapshot(snapshot)
        expect(restored.get("s1", 0)).toBeDefined()
    })

    it("ClaimSourceLibrary round-trips through snapshot", () => {
        const claimLib = new ClaimLibrary()
        claimLib.create({ id: "c1" } as Parameters<typeof claimLib.create>[0])
        const sourceLib = new SourceLibrary()
        sourceLib.create({ id: "s1" } as Parameters<typeof sourceLib.create>[0])
        const csLib = new ClaimSourceLibrary(claimLib, sourceLib)
        csLib.add({
            id: "a1",
            claimId: "c1",
            claimVersion: 0,
            sourceId: "s1",
            sourceVersion: 0,
        })
        const snapshot = csLib.snapshot()
        const restored = ClaimSourceLibrary.fromSnapshot(
            snapshot,
            claimLib,
            sourceLib
        )
        expect(restored.get("a1")).toBeDefined()
        expect(restored.getAll()).toHaveLength(1)
    })

    it("placeholder claims are injected for missing claim references", () => {
        // Simulate: a variable references claim "c-missing" v0 which is not in the library
        const lib = new ClaimLibrary()
        const snapshot = lib.snapshot()
        snapshot.claims.push({
            id: "c-missing",
            version: 0,
            frozen: true,
            checksum: "",
        } as (typeof snapshot.claims)[number])
        const rebuilt = ClaimLibrary.fromSnapshot(snapshot)
        expect(rebuilt.get("c-missing", 0)).toBeDefined()
        expect(rebuilt.get("c-missing", 0)!.frozen).toBe(true)
    })
})
```

- [ ] **Step 2: Run tests**

Run: `pnpm run test`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add test/core.test.ts
git commit -m "test: add library persistence round-trip and placeholder tests"
```

### Task 9: Full Check Suite

- [ ] **Step 1: Run prettify and lint fix**

Run: `pnpm run prettify && pnpm eslint . --fix`

- [ ] **Step 2: Run the full check suite**

Run: `pnpm run check`
Expected: typecheck, lint, test, and build all PASS

- [ ] **Step 3: Verify end-to-end with parse command**

```bash
source .env.development && export OPENAI_API_KEY
pnpm cli arguments parse "If it rains, the ground gets wet. It is raining. Therefore, the ground is wet."
```

Expected: Prints an argument ID.

Then verify libraries were persisted:

```bash
cat ~/.proposit-core/claims.json | head -20
cat ~/.proposit-core/sources.json | head -20
```

Expected: Both files exist with populated content.

Then verify the argument can be re-hydrated and rendered:

```bash
pnpm cli <argument_id> latest render
```

Expected: Shows the rendered premises without errors.

- [ ] **Step 4: Verify claim and source commands**

```bash
pnpm cli claims list
pnpm cli sources list
```

Expected: Both show the claims/sources from the parsed argument.

- [ ] **Step 5: Commit any formatting fixes**

```bash
git add -u
git commit -m "style: format library persistence files"
```
