# CLI PropositCore Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the CLI to use PropositCore as its in-memory orchestrator, add missing expression/fork/validate commands, and fix premises create/delete to go through the engine.

**Architecture:** The hydration layer (`src/cli/engine.ts`) is refactored to construct a `PropositCore` instance that manages all libraries. `hydrateEngine` builds a `TArgumentEngineSnapshot` from disk data and uses `ArgumentEngine.fromSnapshot()` (which suppresses auto-variable creation via the `restoringFromSnapshot` flag). Engines are NOT auto-registered in `PropositCore.arguments` — callers that need registration (fork, cross-argument diff) do it explicitly. New commands are added for fork, toggle-negation, change-operator, and validate.

**Tech Stack:** TypeScript, Commander.js, proposit-core engine library

**Spec:** `docs/superpowers/specs/2026-03-29-cli-proposit-core-update-design.md`

---

### Task 1: Add ForkLibrary storage I/O

**Files:**
- Modify: `src/cli/storage/libraries.ts`

- [ ] **Step 1: Add readForkLibrary and writeForkLibrary functions**

Add to the bottom of `src/cli/storage/libraries.ts`:

```typescript
import { ForkLibrary } from "../../lib/core/fork-library.js"

function forksPath(): string {
    return path.join(getStateDir(), "forks.json")
}

export async function readForkLibrary(): Promise<ForkLibrary> {
    try {
        const content = await fs.readFile(forksPath(), "utf-8")
        const snapshot = JSON.parse(content) as ReturnType<
            ForkLibrary["snapshot"]
        >
        return ForkLibrary.fromSnapshot(snapshot)
    } catch {
        return new ForkLibrary()
    }
}

export async function writeForkLibrary(library: ForkLibrary): Promise<void> {
    const filePath = forksPath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(library.snapshot(), null, 2))
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm run typecheck`
Expected: PASS (no type errors)

- [ ] **Step 3: Commit**

```bash
git add src/cli/storage/libraries.ts
git commit -m "feat(cli): add ForkLibrary read/write storage"
```

---

### Task 2: Refactor engine.ts to use PropositCore

**Files:**
- Modify: `src/cli/engine.ts`

- [ ] **Step 1: Replace hydrateLibraries with hydratePropositCore**

Replace the entire contents of `src/cli/engine.ts` with:

```typescript
import fs from "node:fs/promises"
import {
    ArgumentEngine,
    type TArgumentEngineSnapshot,
} from "../lib/core/argument-engine.js"
import type { TPremiseEngineSnapshot } from "../lib/core/premise-engine.js"
import { ClaimLibrary } from "../lib/core/claim-library.js"
import { PropositCore } from "../lib/core/proposit-core.js"
import type {
    TCoreArgument,
    TCorePropositionalExpression,
    TOptionalChecksum,
} from "../lib/schemata/index.js"
import { isClaimBound } from "../lib/schemata/index.js"
import type { TCliArgumentMeta, TCliArgumentVersionMeta } from "./schemata.js"
import { getPremisesDir } from "./config.js"
import {
    readArgumentMeta,
    readVersionMeta,
    writeArgumentMeta,
    writeVersionMeta,
} from "./storage/arguments.js"
import {
    readClaimLibrary,
    readSourceLibrary,
    readClaimSourceLibrary,
    readForkLibrary,
    writeClaimLibrary,
    writeSourceLibrary,
    writeClaimSourceLibrary,
    writeForkLibrary,
} from "./storage/libraries.js"
import {
    listPremiseIds,
    readPremiseData,
    readPremiseMeta,
    writePremiseData,
    writePremiseMeta,
} from "./storage/premises.js"
import { readRoles, writeRoles } from "./storage/roles.js"
import { readVariables, writeVariables } from "./storage/variables.js"

export async function hydratePropositCore(): Promise<PropositCore> {
    const [claimLibrary, sourceLibrary, forkLibrary] = await Promise.all([
        readClaimLibrary(),
        readSourceLibrary(),
        readForkLibrary(),
    ])
    const claimSourceLibrary = await readClaimSourceLibrary(
        claimLibrary,
        sourceLibrary
    )
    return new PropositCore({
        claimLibrary,
        sourceLibrary,
        claimSourceLibrary,
        forkLibrary,
    })
}

export async function persistCore(core: PropositCore): Promise<void> {
    await Promise.all([
        writeClaimLibrary(core.claims),
        writeSourceLibrary(core.sources),
        writeClaimSourceLibrary(core.claimSources),
        writeForkLibrary(core.forks),
    ])
}

/**
 * Builds a fully-hydrated ArgumentEngine from the on-disk state for the
 * given argument ID and version number.
 *
 * Uses `ArgumentEngine.fromSnapshot()` to restore the engine, which
 * correctly suppresses auto-variable creation during premise restoration.
 */
export async function hydrateEngine(
    argumentId: string,
    version: number,
    core?: PropositCore
): Promise<ArgumentEngine> {
    const [argMeta, versionMeta, allVariables, roles, premiseIds] =
        await Promise.all([
            readArgumentMeta(argumentId),
            readVersionMeta(argumentId, version),
            readVariables(argumentId, version),
            readRoles(argumentId, version),
            listPremiseIds(argumentId, version),
        ])

    const argument: TOptionalChecksum<TCoreArgument> = {
        ...argMeta,
        ...versionMeta,
    }

    const resolvedCore = core ?? (await hydratePropositCore())

    // Placeholder claim generation for backward compatibility.
    // Arguments created before library persistence was implemented have
    // variables referencing claims that don't exist in the library.
    let claimLibrary = resolvedCore.claims
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

    // Build premise snapshots from disk data
    const premiseSnapshots: TPremiseEngineSnapshot[] = []
    for (const premiseId of premiseIds) {
        const [meta, data] = await Promise.all([
            readPremiseMeta(argumentId, version, premiseId),
            readPremiseData(argumentId, version, premiseId),
        ])

        const { id: _id, ...premiseExtras } = meta
        premiseSnapshots.push({
            premise: {
                id: premiseId,
                argumentId,
                argumentVersion: version,
                ...premiseExtras,
            },
            rootExpressionId: data.rootExpressionId,
            expressions: {
                expressions: data.expressions.map((e) => ({
                    ...e,
                    premiseId,
                    argumentVersion: version,
                })) as TCorePropositionalExpression[],
            },
        })
    }

    // Build full engine snapshot
    const engineSnapshot: TArgumentEngineSnapshot = {
        argument,
        variables: {
            variables: allVariables.map((v) => ({
                ...v,
                argumentVersion: version,
            })),
        },
        premises: premiseSnapshots,
        conclusionPremiseId: roles.conclusionPremiseId,
    }

    // Use fromSnapshot which correctly handles restoringFromSnapshot flag,
    // preventing auto-variable creation during premise restoration.
    const engine = ArgumentEngine.fromSnapshot(
        engineSnapshot,
        claimLibrary,
        resolvedCore.sources,
        resolvedCore.claimSources,
        undefined,
        "ignore"
    )

    return engine
}

/**
 * Persists a fully-hydrated ArgumentEngine to disk, writing all metadata,
 * variables, roles, and premise data. This is the logical inverse of
 * `hydrateEngine()`.
 */
export async function persistEngine(engine: ArgumentEngine): Promise<void> {
    const arg = engine.getArgument()
    const { id } = arg

    const argRecord = arg as Record<string, unknown>
    await writeArgumentMeta({
        id,
        title: argRecord.title,
        description: argRecord.description,
    } as TCliArgumentMeta)
    await writeVersionMeta(id, {
        version: arg.version,
        createdAt: argRecord.createdAt,
        published: argRecord.published,
    } as TCliArgumentVersionMeta)

    const variables = engine.getVariables()
    await writeVariables(id, arg.version, variables)

    await writeRoles(id, arg.version, engine.getRoleState())

    await fs.mkdir(getPremisesDir(id, arg.version), { recursive: true })
    for (const pm of engine.listPremises()) {
        const data = pm.toPremiseData()
        const {
            id: premiseId,
            argumentId: _a,
            argumentVersion: _av,
            checksum: _c,
            ...premiseMeta
        } = data as Record<string, unknown>
        await writePremiseMeta(id, arg.version, {
            id: data.id,
            ...premiseMeta,
        } as import("./schemata.js").TCliPremiseMeta)
        await writePremiseData(id, arg.version, data.id, {
            rootExpressionId: pm.getRootExpressionId(),
            variables: [...pm.getReferencedVariableIds()].sort(),
            expressions: pm.getExpressions(),
        })
    }
}
```

Key changes:
- `hydrateLibraries()` replaced by `hydratePropositCore()` returning a `PropositCore`
- `persistLibraries()` replaced by `persistCore()` writing all 4 libraries (claims, sources, claimSources, forks)
- `hydrateEngine()` third parameter changed from loose libraries to `PropositCore?`
- `hydrateEngine()` now builds a `TArgumentEngineSnapshot` from disk data and uses `ArgumentEngine.fromSnapshot()` — this correctly suppresses auto-variable creation during restoration
- `hydrateEngine()` does NOT auto-register the engine in `core.arguments` — callers that need registration (fork, cross-argument diff) do it explicitly

- [ ] **Step 2: Verify build**

Run: `pnpm run typecheck`
Expected: FAIL — callers still reference old function names. That's expected; we'll fix them in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add src/cli/engine.ts
git commit -m "refactor(cli): replace hydrateLibraries with hydratePropositCore"
```

---

### Task 3: Update all callers of hydrateLibraries/persistLibraries

**Files:**
- Modify: `src/cli/commands/arguments.ts`
- Modify: `src/cli/commands/claims.ts`
- Modify: `src/cli/commands/sources.ts`
- Modify: `src/cli/commands/render.ts`
- Modify: `src/cli/commands/diff.ts`
- Modify: `src/cli/commands/variables.ts`
- Modify: `src/cli/commands/analysis.ts`
- Modify: `src/cli/commands/roles.ts`

- [ ] **Step 1: Update arguments.ts**

In `src/cli/commands/arguments.ts`:

Replace the import:
```typescript
import { hydrateLibraries, persistEngine, persistLibraries } from "../engine.js"
```
with:
```typescript
import { hydratePropositCore, persistEngine, persistCore } from "../engine.js"
```

In the `import` action (around line 77), replace:
```typescript
const existing = await hydrateLibraries()
```
with:
```typescript
const existing = await hydratePropositCore()
```

Replace library merge section. Replace:
```typescript
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
            ...existing.claimSourceLibrary.snapshot()
                .claimSourceAssociations,
            ...result.claimSourceLibrary.snapshot()
                .claimSourceAssociations,
        ],
    },
    mergedClaims,
    mergedSources
)

await persistEngine(result.engine)
await persistLibraries(mergedClaims, mergedSources, mergedAssocs)
```
with:
```typescript
const mergedClaims = ClaimLibrary.fromSnapshot({
    claims: [
        ...existing.claims.snapshot().claims,
        ...result.claimLibrary.snapshot().claims,
    ],
})
const mergedSources = SourceLibrary.fromSnapshot({
    sources: [
        ...existing.sources.snapshot().sources,
        ...result.sourceLibrary.snapshot().sources,
    ],
})
const mergedAssocs = ClaimSourceLibrary.fromSnapshot(
    {
        claimSourceAssociations: [
            ...existing.claimSources.snapshot()
                .claimSourceAssociations,
            ...result.claimSourceLibrary.snapshot()
                .claimSourceAssociations,
        ],
    },
    mergedClaims,
    mergedSources
)

await persistEngine(result.engine)
await persistCore(existing)
```

Remove unused imports: `ClaimSourceLibrary` is still used. Remove `SourceLibrary` import if only used for merge (it's still needed). Remove `ClaimSourceLibrary` import — actually check what's still needed. The `ClaimLibrary`, `SourceLibrary`, `ClaimSourceLibrary` imports are still used for fromSnapshot in the merge logic, so keep them.

- [ ] **Step 2: Update claims.ts**

In `src/cli/commands/claims.ts`:

Replace:
```typescript
import { hydrateLibraries, persistLibraries } from "../engine.js"
```
with:
```typescript
import { hydratePropositCore, persistCore } from "../engine.js"
```

Replace every `await hydrateLibraries()` with `await hydratePropositCore()`. The returned object has `.claims` instead of `.claimLibrary`, `.sources` instead of `.sourceLibrary`, `.claimSources` instead of `.claimSourceLibrary`.

In each action handler, replace the destructuring pattern. For example, change:
```typescript
const { claimLibrary } = await hydrateLibraries()
```
to:
```typescript
const core = await hydratePropositCore()
const claimLibrary = core.claims
```

For `persistLibraries(libs.claimLibrary, libs.sourceLibrary, libs.claimSourceLibrary)`, replace with `persistCore(core)`.

Apply the same pattern to all 5 action handlers in claims.ts: list, show, add, update, freeze.

- [ ] **Step 3: Update sources.ts**

Same pattern as claims.ts. In `src/cli/commands/sources.ts`:

Replace import, replace `hydrateLibraries()` calls with `hydratePropositCore()`, access libraries via `.claims`, `.sources`, `.claimSources`. Replace `persistLibraries(...)` with `persistCore(core)`.

- [ ] **Step 4: Update render.ts**

In `src/cli/commands/render.ts`:

Replace:
```typescript
import { hydrateEngine, hydrateLibraries } from "../engine.js"
```
with:
```typescript
import { hydrateEngine, hydratePropositCore } from "../engine.js"
```

Replace:
```typescript
const libs = await hydrateLibraries()
const engine = await hydrateEngine(argumentId, version, libs)
```
with:
```typescript
const core = await hydratePropositCore()
const engine = await hydrateEngine(argumentId, version, core)
```

Replace `libs.claimLibrary` with `core.claims`, `libs.sourceLibrary` with `core.sources`. Replace `libs` with `core` throughout.

- [ ] **Step 5: Update diff.ts**

In `src/cli/commands/diff.ts`:

Replace:
```typescript
import { diffArguments } from "../../lib/core/diff.js"
import { hydrateEngine } from "../engine.js"
```
with:
```typescript
import { diffArguments } from "../../lib/core/diff.js"
import { hydrateEngine, hydratePropositCore } from "../engine.js"
```

Note: keep the standalone `diffArguments` import — it's needed for same-argument diffs.

Replace the action body:
```typescript
const [versionA, versionB] = await Promise.all([
    resolveVersion(idA, verArgA),
    resolveVersion(idB, verArgB),
])

const [engineA, engineB] = await Promise.all([
    hydrateEngine(idA, versionA),
    hydrateEngine(idB, versionB),
])

const diff = diffArguments(engineA, engineB)
```
with:
```typescript
const [versionA, versionB] = await Promise.all([
    resolveVersion(idA, verArgA),
    resolveVersion(idB, verArgB),
])

const core = await hydratePropositCore()

const [engineA, engineB] = await Promise.all([
    hydrateEngine(idA, versionA, core),
    hydrateEngine(idB, versionB, core),
])

// For cross-argument diffs, use PropositCore.diffArguments() which
// automatically applies fork-aware entity matching from ForkLibrary.
// For same-argument diffs (two versions of the same argument),
// ArgumentLibrary can't hold two engines with the same ID, so fall
// back to the standalone diffArguments().
const isCrossArgument = idA !== idB
let diff
if (isCrossArgument) {
    core.arguments.register(engineA)
    core.arguments.register(engineB)
    diff = core.diffArguments(
        engineA.getArgument().id,
        engineB.getArgument().id
    )
} else {
    diff = diffArguments(engineA, engineB)
}
```

- [ ] **Step 6: Update remaining callers**

In `src/cli/commands/variables.ts`, `analysis.ts`, `roles.ts`: these only use `hydrateEngine` and `persistEngine`, which are unchanged in signature (the third param is now `PropositCore?` instead of loose libs, and defaults internally). No changes needed for these files.

- [ ] **Step 7: Verify build**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 8: Run tests**

Run: `pnpm run test`
Expected: All 1044 tests pass (CLI changes don't affect core tests)

- [ ] **Step 9: Commit**

```bash
git add src/cli/commands/arguments.ts src/cli/commands/claims.ts src/cli/commands/sources.ts src/cli/commands/render.ts src/cli/commands/diff.ts
git commit -m "refactor(cli): update all callers to use hydratePropositCore/persistCore"
```

---

### Task 4: Rewrite premises create to go through the engine

**Files:**
- Modify: `src/cli/commands/premises.ts`

- [ ] **Step 1: Rewrite the create action**

In `src/cli/commands/premises.ts`, add the engine imports at the top:

```typescript
import { hydrateEngine, persistEngine } from "../engine.js"
```

Replace the `premises create` command registration (the `.command("create")` block) with:

```typescript
    premises
        .command("create")
        .description("Create a new premise")
        .option("--title <title>", "Optional title for the premise")
        .option(
            "--symbol <symbol>",
            "Symbol for the auto-created premise-bound variable"
        )
        .action(async (opts: { title?: string; symbol?: string }) => {
            await assertNotPublished(argumentId, version)
            const engine = await hydrateEngine(argumentId, version)

            const id = randomUUID()
            const extras: Record<string, unknown> = {}
            if (opts.title) extras.title = opts.title

            try {
                engine.createPremiseWithId(id, extras, opts.symbol)
            } catch (err) {
                errorExit(err instanceof Error ? err.message : String(err))
            }

            await persistEngine(engine)
            printLine(id)
        })
```

- [ ] **Step 2: Verify build**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/premises.ts
git commit -m "feat(cli): premises create goes through engine for auto-variable creation"
```

---

### Task 5: Rewrite premises delete to go through the engine

**Files:**
- Modify: `src/cli/commands/premises.ts`

- [ ] **Step 1: Rewrite the delete action**

In `src/cli/commands/premises.ts`, add `deletePremiseDir` to the imports from `../storage/premises.js` (it should already be imported).

Replace the `premises delete` command registration with:

```typescript
    premises
        .command("delete <premise_id>")
        .description("Delete a premise")
        .option("--confirm", "Skip confirmation prompt")
        .action(async (premiseId: string, opts: { confirm?: boolean }) => {
            await assertNotPublished(argumentId, version)
            if (!(await premiseExists(argumentId, version, premiseId))) {
                errorExit(`Premise "${premiseId}" not found.`)
            }
            if (!opts.confirm) {
                await requireConfirmation(`Delete premise "${premiseId}"?`)
            }

            const engine = await hydrateEngine(argumentId, version)
            try {
                engine.removePremise(premiseId)
            } catch (err) {
                errorExit(err instanceof Error ? err.message : String(err))
            }

            await persistEngine(engine)
            await deletePremiseDir(argumentId, version, premiseId)
            printLine("success")
        })
```

- [ ] **Step 2: Remove unused imports**

In `src/cli/commands/premises.ts`, remove imports that are no longer needed now that create and delete go through the engine. The `PremiseEngine`, `VariableManager`, `TCoreArgument`, `TCorePremise`, `TOptionalChecksum` imports are still needed by `list`, `show`, and `render`. Review and keep only what's needed.

`readRoles`, `writeRoles` — no longer needed (engine handles role cleanup on premise removal).
`readVariables` — still needed by `list` and `render`.

- [ ] **Step 3: Verify build**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/premises.ts
git commit -m "feat(cli): premises delete goes through engine for cascade behavior"
```

---

### Task 6: Add expressions toggle-negation command

**Files:**
- Modify: `src/cli/commands/expressions.ts`

- [ ] **Step 1: Add the toggle-negation command**

In `src/cli/commands/expressions.ts`, after the `show` command registration (at the end of `registerExpressionCommands`), add:

```typescript
    exprs
        .command("toggle-negation <premise_id> <expression_id>")
        .description(
            "Toggle negation on an expression (wrap in NOT or unwrap)"
        )
        .action(async (premiseId: string, expressionId: string) => {
            await assertNotPublished(argumentId, version)
            if (!(await premiseExists(argumentId, version, premiseId))) {
                errorExit(`Premise "${premiseId}" not found.`)
            }

            const engine = await hydrateEngine(argumentId, version)
            const pm = engine.getPremise(premiseId)
            if (!pm) errorExit(`Premise "${premiseId}" not found in engine.`)

            try {
                pm.toggleNegation(expressionId)
            } catch (e) {
                errorExit(
                    e instanceof Error
                        ? e.message
                        : "Failed to toggle negation."
                )
            }

            await writePremiseData(argumentId, version, premiseId, {
                rootExpressionId: pm.getRootExpressionId(),
                variables: [...pm.getReferencedVariableIds()].sort(),
                expressions: pm.getExpressions(),
            })
            printLine("success")
        })
```

- [ ] **Step 2: Verify build**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/expressions.ts
git commit -m "feat(cli): add expressions toggle-negation command"
```

---

### Task 7: Add expressions change-operator command

**Files:**
- Modify: `src/cli/commands/expressions.ts`

- [ ] **Step 1: Add the change-operator command**

In `src/cli/commands/expressions.ts`, after the `toggle-negation` command, add:

```typescript
    exprs
        .command("change-operator <premise_id> <expression_id> <new_operator>")
        .description("Change the operator type of an operator expression")
        .option(
            "--source-child-id <id>",
            "Source child ID for split behavior"
        )
        .option(
            "--target-child-id <id>",
            "Target child ID for split behavior"
        )
        .action(
            async (
                premiseId: string,
                expressionId: string,
                newOperator: string,
                opts: {
                    sourceChildId?: string
                    targetChildId?: string
                }
            ) => {
                await assertNotPublished(argumentId, version)
                if (!(await premiseExists(argumentId, version, premiseId))) {
                    errorExit(`Premise "${premiseId}" not found.`)
                }

                const engine = await hydrateEngine(argumentId, version)
                const pm = engine.getPremise(premiseId)
                if (!pm)
                    errorExit(`Premise "${premiseId}" not found in engine.`)

                try {
                    pm.changeOperator(
                        expressionId,
                        newOperator as TCoreLogicalOperatorType,
                        opts.sourceChildId,
                        opts.targetChildId
                    )
                } catch (e) {
                    errorExit(
                        e instanceof Error
                            ? e.message
                            : "Failed to change operator."
                    )
                }

                await writePremiseData(argumentId, version, premiseId, {
                    rootExpressionId: pm.getRootExpressionId(),
                    variables: [...pm.getReferencedVariableIds()].sort(),
                    expressions: pm.getExpressions(),
                })
                printLine("success")
            }
        )
```

- [ ] **Step 2: Verify build**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/expressions.ts
git commit -m "feat(cli): add expressions change-operator command"
```

---

### Task 8: Add validate command

**Files:**
- Create: `src/cli/commands/validate.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Create the validate command file**

Create `src/cli/commands/validate.ts`:

```typescript
import { Command } from "commander"
import { hydrateEngine } from "../engine.js"
import { printJson, printLine } from "../output.js"

export function registerValidateCommand(
    versionedCmd: Command,
    argumentId: string,
    version: number
): void {
    versionedCmd
        .command("validate")
        .description("Run invariant validation on the argument structure")
        .option("--json", "Output as JSON")
        .action(async (opts: { json?: boolean }) => {
            const engine = await hydrateEngine(argumentId, version)
            const result = engine.validate()

            if (opts.json) {
                printJson(result)
                return
            }

            if (result.ok) {
                printLine("ok")
            } else {
                printLine("invalid")
                for (const v of result.violations) {
                    printLine(
                        `${v.entityType} ${v.entityId}: ${v.code} — ${v.message}`
                    )
                }
            }
        })
}
```

- [ ] **Step 2: Register in cli.ts**

In `src/cli.ts`, add the import:

```typescript
import { registerValidateCommand } from "./cli/commands/validate.js"
```

Add the registration call in the version-scoped section, after `registerAnalysisCommands`:

```typescript
    registerValidateCommand(sub, argumentId, version)
```

- [ ] **Step 3: Verify build**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/validate.ts src/cli.ts
git commit -m "feat(cli): add validate command for invariant checking"
```

---

### Task 9: Add arguments fork command

**Files:**
- Modify: `src/cli/commands/arguments.ts`

- [ ] **Step 1: Add the fork command**

In `src/cli/commands/arguments.ts`, add imports:

```typescript
import { hydratePropositCore, hydrateEngine, persistEngine, persistCore } from "../engine.js"
```

(Adjust the existing import line to include `hydrateEngine`.)

Before the `registerParseCommand(args)` line at the end of `registerArgumentCommands`, add:

```typescript
    args.command("fork <argument_id>")
        .description("Fork an argument (creates an independent copy)")
        .action(async (argumentId: string) => {
            const core = await hydratePropositCore()
            const engine = await hydrateEngine(argumentId, (await latestVersionNumber(argumentId)), core)
            core.arguments.register(engine)

            const newArgumentId = randomUUID()
            let result
            try {
                result = core.forkArgument(argumentId, newArgumentId)
            } catch (err) {
                errorExit(err instanceof Error ? err.message : String(err))
            }

            await persistEngine(result.engine)
            await persistCore(core)
            printLine(newArgumentId)
        })
```

- [ ] **Step 2: Verify build**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/arguments.ts
git commit -m "feat(cli): add arguments fork command"
```

---

### Task 10: Update smoke test

**Files:**
- Modify: `scripts/smoke-test.sh`

- [ ] **Step 1: Account for auto-variables from premises create**

Throughout the smoke test, `premises create` now auto-creates premise-bound variables. The `variables create` commands still work (they create claim-bound variables). The key changes:

1. After creating premises P1-P4, there are already 4 auto-variables. The manual `variables create R W S T` still works — these are claim-bound, separate from the premise-bound ones.

2. The `variables list` output will show both premise-bound and claim-bound variables.

3. `variables list-unused` behavior changes: premise-bound auto-variables are not "unused" in the same way since they're bound to premises. The claim-bound T variable is still unused.

4. `variables delete-unused` will delete unused claim-bound variables. The premise-bound variables created for P4 will be cascade-deleted when P4 is deleted through the engine.

Update the smoke test to reflect these changes. The auto-variables don't interfere with expression building since expressions reference specific variable IDs (R, W, S, T are claim-bound).

- [ ] **Step 2: Add fork section**

After section 11b (diff cross-argument), add:

```bash
# ─────────────────────────────────────────────────────────────────────────────
# 11c. FORK — fork an argument and diff
# ─────────────────────────────────────────────────────────────────────────────
section "11c. fork and fork-aware diff"

FORKED=$($CLI arguments fork "$ARG")
echo "FORKED=$FORKED"

$CLI "$FORKED" latest show
$CLI "$FORKED" latest render

# Modify the fork: rename variable R → Rain
FORKED_R=$(echo "$($CLI "$FORKED" latest variables list --json)" | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const v = d.find(v => v.symbol === 'R');
if (v) process.stdout.write(v.id);
")
if [ -n "$FORKED_R" ]; then
    $CLI "$FORKED" latest variables update "$FORKED_R" --symbol Rain
fi

# Diff original vs fork (fork-aware matching)
$CLI diff "$ARG" latest "$FORKED" latest
$CLI diff "$ARG" latest "$FORKED" latest --json
```

- [ ] **Step 3: Add toggle-negation section**

After section 5c, add:

```bash
section "5c2. expressions — toggle negation on P3"

echo "P3 before toggle:"
$CLI "$ARG" latest premises render "$P3"

$CLI "$ARG" latest expressions toggle-negation "$P3" "$EXPR_R3"
echo "P3 after negating R:"
$CLI "$ARG" latest premises render "$P3"

# Toggle back to remove the negation
$CLI "$ARG" latest expressions toggle-negation "$P3" "$EXPR_R3"
echo "P3 after un-negating R:"
$CLI "$ARG" latest premises render "$P3"
```

- [ ] **Step 4: Add change-operator section**

After the toggle-negation section, add:

```bash
section "5c3. expressions — change operator on P3"

echo "P3 before change-operator:"
$CLI "$ARG" latest premises render "$P3"

$CLI "$ARG" latest expressions change-operator "$P3" "$ROOT3" iff
echo "P3 after changing implies to iff:"
$CLI "$ARG" latest premises render "$P3"

# Change back
$CLI "$ARG" latest expressions change-operator "$P3" "$ROOT3" implies
echo "P3 restored:"
$CLI "$ARG" latest premises render "$P3"
```

- [ ] **Step 5: Add validate section**

After section 8, add:

```bash
section "8b. validate (invariant check)"
$CLI "$ARG" latest validate
$CLI "$ARG" latest validate --json
```

- [ ] **Step 6: Update cleanup to delete forked argument**

In section 14 (cleanup), add before the existing deletes:

```bash
if [ -n "${FORKED:-}" ]; then
    $CLI arguments delete "$FORKED" --all --confirm
fi
```

- [ ] **Step 7: Build and run smoke test**

Run: `pnpm run build && bash scripts/smoke-test.sh`
Expected: "SMOKE TEST PASSED"

If there are failures, fix the smoke test expectations and re-run.

- [ ] **Step 8: Commit**

```bash
git add scripts/smoke-test.sh
git commit -m "test(cli): update smoke test for PropositCore, fork, toggle-negation, change-operator, validate"
```

---

### Task 11: Lint and final verification

**Files:**
- All modified files

- [ ] **Step 1: Run full check suite**

Run: `pnpm run check`
Expected: typecheck, lint, test, build all pass

- [ ] **Step 2: Fix any lint issues**

Run: `pnpm run prettify && pnpm eslint . --fix`
Then re-run: `pnpm run check`

- [ ] **Step 3: Run smoke test one final time**

Run: `pnpm run build && bash scripts/smoke-test.sh`
Expected: "SMOKE TEST PASSED"

- [ ] **Step 4: Commit any lint fixes**

```bash
git add -A
git commit -m "style: fix lint and formatting"
```
