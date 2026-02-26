# CLI Diff Command Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a top-level `diff` command to the CLI that compares two argument versions and prints their differences in human-readable or JSON format.

**Architecture:** Two new files — `src/cli/commands/diff.ts` for command registration and arg parsing, `src/cli/output/diffRenderer.ts` for human-readable formatting. The command hydrates two `ArgumentEngine` instances and calls the existing `diffArguments` library function. Routing changes add `"diff"` to `NAMED_COMMANDS` and register it as a top-level command.

**Tech Stack:** Commander.js, existing `diffArguments`/`hydrateEngine`/`resolveVersion` functions, Vitest for tests.

---

### Task 1: Create the diff renderer module

**Files:**
- Create: `src/cli/output/diffRenderer.ts`

**Step 1: Write the failing test**

Create `test/diffRenderer.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { TCoreArgumentDiff } from "../src/lib/types/diff.js"

// We capture printLine calls to verify output
const printedLines: string[] = []
vi.mock("../src/cli/output.js", () => ({
    printLine: (text: string) => {
        printedLines.push(text)
    },
}))

// Import after mock setup
const { renderDiff, isDiffEmpty } = await import(
    "../src/cli/output/diffRenderer.js"
)

beforeEach(() => {
    printedLines.length = 0
})

describe("isDiffEmpty", () => {
    it("returns true for an empty diff", () => {
        const diff: TCoreArgumentDiff = {
            argument: {
                before: { id: "a", title: "T", description: "D", version: 0, createdAt: 0, published: false },
                after: { id: "a", title: "T", description: "D", version: 1, createdAt: 1, published: false },
                changes: [],
            },
            variables: { added: [], removed: [], modified: [] },
            premises: { added: [], removed: [], modified: [] },
            roles: {
                conclusion: { before: undefined, after: undefined },
                supportingAdded: [],
                supportingRemoved: [],
            },
        }
        expect(isDiffEmpty(diff)).toBe(true)
    })

    it("returns false when argument has changes", () => {
        const diff: TCoreArgumentDiff = {
            argument: {
                before: { id: "a", title: "Old", description: "D", version: 0, createdAt: 0, published: false },
                after: { id: "a", title: "New", description: "D", version: 1, createdAt: 1, published: false },
                changes: [{ field: "title", before: "Old", after: "New" }],
            },
            variables: { added: [], removed: [], modified: [] },
            premises: { added: [], removed: [], modified: [] },
            roles: {
                conclusion: { before: undefined, after: undefined },
                supportingAdded: [],
                supportingRemoved: [],
            },
        }
        expect(isDiffEmpty(diff)).toBe(false)
    })

    it("returns false when variables have additions", () => {
        const diff: TCoreArgumentDiff = {
            argument: {
                before: { id: "a", title: "T", description: "D", version: 0, createdAt: 0, published: false },
                after: { id: "a", title: "T", description: "D", version: 1, createdAt: 1, published: false },
                changes: [],
            },
            variables: {
                added: [{ id: "v1", symbol: "p" }],
                removed: [],
                modified: [],
            },
            premises: { added: [], removed: [], modified: [] },
            roles: {
                conclusion: { before: undefined, after: undefined },
                supportingAdded: [],
                supportingRemoved: [],
            },
        }
        expect(isDiffEmpty(diff)).toBe(false)
    })

    it("returns false when conclusion changed", () => {
        const diff: TCoreArgumentDiff = {
            argument: {
                before: { id: "a", title: "T", description: "D", version: 0, createdAt: 0, published: false },
                after: { id: "a", title: "T", description: "D", version: 1, createdAt: 1, published: false },
                changes: [],
            },
            variables: { added: [], removed: [], modified: [] },
            premises: { added: [], removed: [], modified: [] },
            roles: {
                conclusion: { before: "p1", after: "p2" },
                supportingAdded: [],
                supportingRemoved: [],
            },
        }
        expect(isDiffEmpty(diff)).toBe(false)
    })
})

describe("renderDiff", () => {
    it("prints 'No differences.' for an empty diff", () => {
        const diff: TCoreArgumentDiff = {
            argument: {
                before: { id: "a", title: "T", description: "D", version: 0, createdAt: 0, published: false },
                after: { id: "a", title: "T", description: "D", version: 1, createdAt: 1, published: false },
                changes: [],
            },
            variables: { added: [], removed: [], modified: [] },
            premises: { added: [], removed: [], modified: [] },
            roles: {
                conclusion: { before: undefined, after: undefined },
                supportingAdded: [],
                supportingRemoved: [],
            },
        }
        renderDiff(diff)
        expect(printedLines).toEqual(["No differences."])
    })

    it("renders argument field changes", () => {
        const diff: TCoreArgumentDiff = {
            argument: {
                before: { id: "a", title: "Old Title", description: "D", version: 0, createdAt: 0, published: false },
                after: { id: "a", title: "New Title", description: "D", version: 1, createdAt: 1, published: false },
                changes: [{ field: "title", before: "Old Title", after: "New Title" }],
            },
            variables: { added: [], removed: [], modified: [] },
            premises: { added: [], removed: [], modified: [] },
            roles: {
                conclusion: { before: undefined, after: undefined },
                supportingAdded: [],
                supportingRemoved: [],
            },
        }
        renderDiff(diff)
        expect(printedLines).toContain("Argument:")
        expect(printedLines).toContain('  title: "Old Title" → "New Title"')
    })

    it("renders added, removed, and modified variables", () => {
        const diff: TCoreArgumentDiff = {
            argument: {
                before: { id: "a", title: "T", description: "D", version: 0, createdAt: 0, published: false },
                after: { id: "a", title: "T", description: "D", version: 1, createdAt: 1, published: false },
                changes: [],
            },
            variables: {
                added: [{ id: "v3", symbol: "r" }],
                removed: [{ id: "v1", symbol: "p" }],
                modified: [
                    {
                        before: { id: "v2", symbol: "q" },
                        after: { id: "v2", symbol: "Q" },
                        changes: [{ field: "symbol", before: "q", after: "Q" }],
                    },
                ],
            },
            premises: { added: [], removed: [], modified: [] },
            roles: {
                conclusion: { before: undefined, after: undefined },
                supportingAdded: [],
                supportingRemoved: [],
            },
        }
        renderDiff(diff)
        expect(printedLines).toContain("Variables:")
        expect(printedLines).toContain("  + v3 (added)")
        expect(printedLines).toContain("  - v1 (removed)")
        expect(printedLines).toContain("  ~ v2:")
        expect(printedLines).toContain('    symbol: "q" → "Q"')
    })

    it("renders added, removed, and modified premises with nested expressions", () => {
        const diff: TCoreArgumentDiff = {
            argument: {
                before: { id: "a", title: "T", description: "D", version: 0, createdAt: 0, published: false },
                after: { id: "a", title: "T", description: "D", version: 1, createdAt: 1, published: false },
                changes: [],
            },
            variables: { added: [], removed: [], modified: [] },
            premises: {
                added: [
                    {
                        id: "p2",
                        title: "New Premise",
                        rootExpressionId: null,
                        variables: [],
                        expressions: [],
                    },
                ],
                removed: [
                    {
                        id: "p3",
                        title: "Old Premise",
                        rootExpressionId: null,
                        variables: [],
                        expressions: [],
                    },
                ],
                modified: [
                    {
                        before: {
                            id: "p1",
                            title: "Before",
                            rootExpressionId: null,
                            variables: [],
                            expressions: [],
                        },
                        after: {
                            id: "p1",
                            title: "After",
                            rootExpressionId: null,
                            variables: [],
                            expressions: [],
                        },
                        changes: [{ field: "title", before: "Before", after: "After" }],
                        expressions: {
                            added: [
                                {
                                    id: "e1",
                                    type: "variable",
                                    parentId: null,
                                    position: 0,
                                    variableId: "v1",
                                },
                            ],
                            removed: [],
                            modified: [],
                        },
                    },
                ],
            },
            roles: {
                conclusion: { before: undefined, after: undefined },
                supportingAdded: [],
                supportingRemoved: [],
            },
        }
        renderDiff(diff)
        expect(printedLines).toContain("Premises:")
        expect(printedLines).toContain("  + p2 (added)")
        expect(printedLines).toContain("  - p3 (removed)")
        expect(printedLines).toContain("  ~ p1:")
        expect(printedLines).toContain('    title: "Before" → "After"')
        expect(printedLines).toContain("    Expressions:")
        expect(printedLines).toContain("      + e1 (added)")
    })

    it("renders role changes", () => {
        const diff: TCoreArgumentDiff = {
            argument: {
                before: { id: "a", title: "T", description: "D", version: 0, createdAt: 0, published: false },
                after: { id: "a", title: "T", description: "D", version: 1, createdAt: 1, published: false },
                changes: [],
            },
            variables: { added: [], removed: [], modified: [] },
            premises: { added: [], removed: [], modified: [] },
            roles: {
                conclusion: { before: "p1", after: "p2" },
                supportingAdded: ["p3"],
                supportingRemoved: ["p4"],
            },
        }
        renderDiff(diff)
        expect(printedLines).toContain("Roles:")
        expect(printedLines).toContain('  conclusion: "p1" → "p2"')
        expect(printedLines).toContain("  + support: p3 (added)")
        expect(printedLines).toContain("  - support: p4 (removed)")
    })

    it("omits sections with no changes", () => {
        const diff: TCoreArgumentDiff = {
            argument: {
                before: { id: "a", title: "T", description: "D", version: 0, createdAt: 0, published: false },
                after: { id: "a", title: "T", description: "D", version: 1, createdAt: 1, published: false },
                changes: [{ field: "title", before: "Old", after: "New" }],
            },
            variables: { added: [], removed: [], modified: [] },
            premises: { added: [], removed: [], modified: [] },
            roles: {
                conclusion: { before: undefined, after: undefined },
                supportingAdded: [],
                supportingRemoved: [],
            },
        }
        renderDiff(diff)
        expect(printedLines).toContain("Argument:")
        expect(printedLines).not.toContain("Variables:")
        expect(printedLines).not.toContain("Premises:")
        expect(printedLines).not.toContain("Roles:")
    })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/diffRenderer.test.ts`
Expected: FAIL — module `../src/cli/output/diffRenderer.js` not found.

**Step 3: Write minimal implementation**

Create `src/cli/output/diffRenderer.ts`:

```typescript
import type {
    TCoreArgumentDiff,
    TCoreEntityFieldDiff,
    TCoreEntitySetDiff,
    TCoreFieldChange,
    TCorePremiseDiff,
} from "../../lib/types/diff.js"
import { printLine } from "../output.js"

export function isDiffEmpty(diff: TCoreArgumentDiff): boolean {
    return (
        diff.argument.changes.length === 0 &&
        diff.variables.added.length === 0 &&
        diff.variables.removed.length === 0 &&
        diff.variables.modified.length === 0 &&
        diff.premises.added.length === 0 &&
        diff.premises.removed.length === 0 &&
        diff.premises.modified.length === 0 &&
        diff.roles.conclusion.before === diff.roles.conclusion.after &&
        diff.roles.supportingAdded.length === 0 &&
        diff.roles.supportingRemoved.length === 0
    )
}

function formatValue(value: unknown): string {
    if (value === undefined) return "undefined"
    if (value === null) return "null"
    return JSON.stringify(value)
}

function renderFieldChanges(changes: TCoreFieldChange[], indent: string): void {
    for (const change of changes) {
        printLine(
            `${indent}${change.field}: ${formatValue(change.before)} → ${formatValue(change.after)}`
        )
    }
}

function renderEntitySetDiff<T extends { id: string }>(
    diff: TCoreEntitySetDiff<T>,
    indent: string
): void {
    for (const item of diff.added) {
        printLine(`${indent}+ ${item.id} (added)`)
    }
    for (const item of diff.removed) {
        printLine(`${indent}- ${item.id} (removed)`)
    }
    for (const mod of diff.modified) {
        printLine(`${indent}~ ${mod.before.id}:`)
        renderFieldChanges(mod.changes, indent + "  ")
    }
}

function renderPremiseModified(mod: TCorePremiseDiff, indent: string): void {
    printLine(`${indent}~ ${mod.before.id}:`)
    renderFieldChanges(mod.changes, indent + "  ")
    const exprDiff = mod.expressions
    const hasExprChanges =
        exprDiff.added.length > 0 ||
        exprDiff.removed.length > 0 ||
        exprDiff.modified.length > 0
    if (hasExprChanges) {
        printLine(`${indent}  Expressions:`)
        renderEntitySetDiff(exprDiff, indent + "    ")
    }
}

export function renderDiff(diff: TCoreArgumentDiff): void {
    if (isDiffEmpty(diff)) {
        printLine("No differences.")
        return
    }

    // Argument section
    if (diff.argument.changes.length > 0) {
        printLine("Argument:")
        renderFieldChanges(diff.argument.changes, "  ")
    }

    // Variables section
    const hasVarChanges =
        diff.variables.added.length > 0 ||
        diff.variables.removed.length > 0 ||
        diff.variables.modified.length > 0
    if (hasVarChanges) {
        printLine("Variables:")
        renderEntitySetDiff(diff.variables, "  ")
    }

    // Premises section
    const hasPremiseChanges =
        diff.premises.added.length > 0 ||
        diff.premises.removed.length > 0 ||
        diff.premises.modified.length > 0
    if (hasPremiseChanges) {
        printLine("Premises:")
        for (const item of diff.premises.added) {
            printLine(`  + ${item.id} (added)`)
        }
        for (const item of diff.premises.removed) {
            printLine(`  - ${item.id} (removed)`)
        }
        for (const mod of diff.premises.modified) {
            renderPremiseModified(mod, "  ")
        }
    }

    // Roles section
    const conclusionChanged =
        diff.roles.conclusion.before !== diff.roles.conclusion.after
    const hasRoleChanges =
        conclusionChanged ||
        diff.roles.supportingAdded.length > 0 ||
        diff.roles.supportingRemoved.length > 0
    if (hasRoleChanges) {
        printLine("Roles:")
        if (conclusionChanged) {
            printLine(
                `  conclusion: ${formatValue(diff.roles.conclusion.before)} → ${formatValue(diff.roles.conclusion.after)}`
            )
        }
        for (const id of diff.roles.supportingAdded) {
            printLine(`  + support: ${id} (added)`)
        }
        for (const id of diff.roles.supportingRemoved) {
            printLine(`  - support: ${id} (removed)`)
        }
    }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/diffRenderer.test.ts`
Expected: PASS (all tests green).

**Step 5: Commit**

```bash
git add test/diffRenderer.test.ts src/cli/output/diffRenderer.ts
git commit -m "Add diff renderer with tests"
```

---

### Task 2: Create the diff command module

**Files:**
- Create: `src/cli/commands/diff.ts`

**Step 1: Write the failing test**

Create `test/diffCommand.test.ts`. Since the diff command is a CLI command that calls `hydrateEngine` and `resolveVersion` (which require disk state), we test the argument-parsing logic and the integration by mocking the dependencies:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

const printedLines: string[] = []
let printedJson: unknown = undefined
let exitMessage: string | undefined = undefined

vi.mock("../src/cli/output.js", () => ({
    printLine: (text: string) => {
        printedLines.push(text)
    },
    printJson: (value: unknown) => {
        printedJson = value
    },
    errorExit: (message: string) => {
        exitMessage = message
        throw new Error(`errorExit: ${message}`)
    },
}))

// Mock hydrateEngine to return minimal ArgumentEngine stubs
const mockHydrateEngine = vi.fn()
vi.mock("../src/cli/engine.js", () => ({
    hydrateEngine: (...args: unknown[]) => mockHydrateEngine(...args),
}))

// Mock resolveVersion to return the version number as-is
const mockResolveVersion = vi.fn()
vi.mock("../src/cli/router.js", () => ({
    resolveVersion: (...args: unknown[]) => mockResolveVersion(...args),
}))

// Mock diffArguments to return a controllable diff
const mockDiffArguments = vi.fn()
vi.mock("../src/lib/core/diff.js", () => ({
    diffArguments: (...args: unknown[]) => mockDiffArguments(...args),
}))

// Mock renderDiff and isDiffEmpty
const mockRenderDiff = vi.fn()
const mockIsDiffEmpty = vi.fn()
vi.mock("../src/cli/output/diffRenderer.js", () => ({
    renderDiff: (...args: unknown[]) => mockRenderDiff(...args),
    isDiffEmpty: (...args: unknown[]) => mockIsDiffEmpty(...args),
}))

const { registerDiffCommand } = await import("../src/cli/commands/diff.js")

import { Command } from "commander"

beforeEach(() => {
    printedLines.length = 0
    printedJson = undefined
    exitMessage = undefined
    vi.clearAllMocks()
})

describe("registerDiffCommand", () => {
    function makeProgram(): Command {
        const program = new Command()
        program.exitOverride()
        registerDiffCommand(program)
        return program
    }

    const emptyDiff = {
        argument: { before: {}, after: {}, changes: [] },
        variables: { added: [], removed: [], modified: [] },
        premises: { added: [], removed: [], modified: [] },
        roles: {
            conclusion: { before: undefined, after: undefined },
            supportingAdded: [],
            supportingRemoved: [],
        },
    }

    it("parses 3-arg shorthand (same argument, two versions)", async () => {
        mockResolveVersion.mockResolvedValue(1)
        mockHydrateEngine.mockResolvedValue({})
        mockDiffArguments.mockReturnValue(emptyDiff)
        mockIsDiffEmpty.mockReturnValue(true)

        const program = makeProgram()
        await program.parseAsync([
            "node",
            "proposit-core",
            "diff",
            "myarg",
            "0",
            "1",
        ])

        expect(mockResolveVersion).toHaveBeenCalledWith("myarg", "0")
        expect(mockResolveVersion).toHaveBeenCalledWith("myarg", "1")
        expect(mockHydrateEngine).toHaveBeenCalledTimes(2)
    })

    it("parses 4-arg full form (cross-argument)", async () => {
        mockResolveVersion.mockResolvedValue(0)
        mockHydrateEngine.mockResolvedValue({})
        mockDiffArguments.mockReturnValue(emptyDiff)
        mockIsDiffEmpty.mockReturnValue(true)

        const program = makeProgram()
        await program.parseAsync([
            "node",
            "proposit-core",
            "diff",
            "argA",
            "0",
            "argB",
            "1",
        ])

        expect(mockResolveVersion).toHaveBeenCalledWith("argA", "0")
        expect(mockResolveVersion).toHaveBeenCalledWith("argB", "1")
    })

    it("outputs JSON when --json is passed", async () => {
        mockResolveVersion.mockResolvedValue(0)
        mockHydrateEngine.mockResolvedValue({})
        mockDiffArguments.mockReturnValue(emptyDiff)

        const program = makeProgram()
        await program.parseAsync([
            "node",
            "proposit-core",
            "diff",
            "myarg",
            "0",
            "1",
            "--json",
        ])

        expect(printedJson).toEqual(emptyDiff)
        expect(mockRenderDiff).not.toHaveBeenCalled()
    })

    it("calls renderDiff for human-readable output", async () => {
        mockResolveVersion.mockResolvedValue(0)
        mockHydrateEngine.mockResolvedValue({})
        mockDiffArguments.mockReturnValue(emptyDiff)
        mockIsDiffEmpty.mockReturnValue(false)

        const program = makeProgram()
        await program.parseAsync([
            "node",
            "proposit-core",
            "diff",
            "myarg",
            "0",
            "1",
        ])

        expect(mockRenderDiff).toHaveBeenCalledWith(emptyDiff)
    })

    it("exits with error for fewer than 3 positional args", async () => {
        const program = makeProgram()
        await expect(
            program.parseAsync(["node", "proposit-core", "diff", "myarg", "0"])
        ).rejects.toThrow()
    })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/diffCommand.test.ts`
Expected: FAIL — module `../src/cli/commands/diff.js` not found.

**Step 3: Write minimal implementation**

Create `src/cli/commands/diff.ts`:

```typescript
import { Command } from "commander"
import { diffArguments } from "../../lib/core/diff.js"
import { hydrateEngine } from "../engine.js"
import { errorExit, printJson } from "../output.js"
import { renderDiff } from "../output/diffRenderer.js"
import { resolveVersion } from "../router.js"

/**
 * Parses diff positional args into two (argumentId, versionArg) pairs.
 *
 * 3 args: <id> <verA> <verB>       → same argument, two versions
 * 4 args: <idA> <verA> <idB> <verB> → cross-argument
 */
function parseDiffArgs(
    args: string[]
): [idA: string, verA: string, idB: string, verB: string] {
    if (args.length === 3) {
        return [args[0], args[1], args[0], args[2]]
    }
    if (args.length === 4) {
        return [args[0], args[1], args[2], args[3]]
    }
    errorExit(
        "Usage: proposit-core diff <id> <verA> <verB>\n       proposit-core diff <idA> <verA> <idB> <verB>"
    )
}

export function registerDiffCommand(program: Command): void {
    program
        .command("diff <args...>")
        .description(
            "Compare two argument versions and show their differences"
        )
        .option("--json", "Output as JSON")
        .action(async (args: string[], opts: { json?: boolean }) => {
            const [idA, verArgA, idB, verArgB] = parseDiffArgs(args)

            const [versionA, versionB] = await Promise.all([
                resolveVersion(idA, verArgA),
                resolveVersion(idB, verArgB),
            ])

            const [engineA, engineB] = await Promise.all([
                hydrateEngine(idA, versionA),
                hydrateEngine(idB, versionB),
            ])

            const diff = diffArguments(engineA, engineB)

            if (opts.json) {
                printJson(diff)
            } else {
                renderDiff(diff)
            }
        })
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/diffCommand.test.ts`
Expected: PASS (all tests green).

**Step 5: Commit**

```bash
git add test/diffCommand.test.ts src/cli/commands/diff.ts
git commit -m "Add diff command module with tests"
```

---

### Task 3: Wire the diff command into CLI routing

**Files:**
- Modify: `src/cli/router.ts:4-12` (add `"diff"` to `NAMED_COMMANDS`)
- Modify: `src/cli.ts:1-58` (import and register `registerDiffCommand`)

**Step 1: Add `"diff"` to `NAMED_COMMANDS` in `src/cli/router.ts`**

Add `"diff"` to the set on line 11 (before the closing `]`):

```typescript
const NAMED_COMMANDS = new Set([
    "help",
    "--help",
    "-h",
    "version",
    "--version",
    "-V",
    "arguments",
    "diff",
])
```

**Step 2: Import and register in `src/cli.ts`**

Add import after line 11:

```typescript
import { registerDiffCommand } from "./cli/commands/diff.js"
```

Add registration after line 24 (after `registerArgumentCommands(program)`):

```typescript
registerDiffCommand(program)
```

**Step 3: Run all tests**

Run: `pnpm vitest run`
Expected: All tests pass.

**Step 4: Run typecheck and lint**

Run: `pnpm run typecheck && pnpm run lint`
Expected: No errors. If lint errors, fix with `pnpm eslint . --fix && pnpm run prettify`.

**Step 5: Commit**

```bash
git add src/cli/router.ts src/cli.ts
git commit -m "Wire diff command into CLI routing"
```

---

### Task 4: Build and manually verify

**Step 1: Build the project**

Run: `pnpm run build`
Expected: Clean build with no errors.

**Step 2: Run the full check suite**

Run: `pnpm run check`
Expected: typecheck, lint, test, and build all pass.

**Step 3: Verify CLI help includes diff**

Run: `pnpm cli -- --help`
Expected: `diff` appears in the command list.

**Step 4: Verify diff help text**

Run: `pnpm cli -- diff --help`
Expected: Shows usage with `<args...>` and `--json` option.

**Step 5: Commit (if any fixes were needed)**

Only if fixes were required in previous steps.
