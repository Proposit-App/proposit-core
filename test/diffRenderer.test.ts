import { describe, it, expect, vi, beforeEach } from "vitest"
import type { TCoreArgumentDiff } from "../src/lib/types/diff.js"

// We capture printLine calls to verify output
const printedLines: string[] = []
vi.mock("../src/cli/output.js", () => ({
    printLine: (text: string) => {
        printedLines.push(text)
    },
}))

// Import after mock setup
const { renderDiff, isDiffEmpty } =
    await import("../src/cli/output/diffRenderer.js")

beforeEach(() => {
    printedLines.length = 0
})

// Helper to reduce boilerplate in argument before/after fields
function makeArg(
    overrides: Partial<{
        id: string
        metadata: { title: string; description?: string }
        version: number
        createdAt: number
        published: boolean
    }> = {}
) {
    return {
        id: "a",
        metadata: { title: "T", description: "D" },
        version: 0,
        createdAt: 0,
        published: false,
        ...overrides,
    }
}

function emptyDiff(
    overrides: Partial<TCoreArgumentDiff> = {}
): TCoreArgumentDiff {
    return {
        argument: {
            before: makeArg(),
            after: makeArg({ version: 1, createdAt: 1 }),
            changes: [],
        },
        variables: { added: [], removed: [], modified: [] },
        premises: { added: [], removed: [], modified: [] },
        roles: {
            conclusion: { before: undefined, after: undefined },
            supportingAdded: [],
            supportingRemoved: [],
        },
        ...overrides,
    }
}

describe("isDiffEmpty", () => {
    it("returns true for an empty diff", () => {
        expect(isDiffEmpty(emptyDiff())).toBe(true)
    })

    it("returns false when argument has changes", () => {
        const diff = emptyDiff({
            argument: {
                before: makeArg({ metadata: { title: "Old" } }),
                after: makeArg({ metadata: { title: "New" }, version: 1, createdAt: 1 }),
                changes: [{ field: "metadata.title", before: "Old", after: "New" }],
            },
        })
        expect(isDiffEmpty(diff)).toBe(false)
    })

    it("returns false when variables have additions", () => {
        const diff = emptyDiff({
            variables: {
                added: [
                    {
                        id: "v1",
                        symbol: "p",
                        argumentId: "a",
                        argumentVersion: 1,
                        metadata: {},
                    },
                ],
                removed: [],
                modified: [],
            },
        })
        expect(isDiffEmpty(diff)).toBe(false)
    })

    it("returns false when conclusion changed", () => {
        const diff = emptyDiff({
            roles: {
                conclusion: { before: "p1", after: "p2" },
                supportingAdded: [],
                supportingRemoved: [],
            },
        })
        expect(isDiffEmpty(diff)).toBe(false)
    })
})

describe("renderDiff", () => {
    it("prints 'No differences.' for an empty diff", () => {
        renderDiff(emptyDiff())
        expect(printedLines).toEqual(["No differences."])
    })

    it("renders argument field changes", () => {
        const diff = emptyDiff({
            argument: {
                before: makeArg({ metadata: { title: "Old Title" } }),
                after: makeArg({
                    metadata: { title: "New Title" },
                    version: 1,
                    createdAt: 1,
                }),
                changes: [
                    { field: "metadata.title", before: "Old Title", after: "New Title" },
                ],
            },
        })
        renderDiff(diff)
        expect(printedLines).toContain("Argument:")
        expect(printedLines).toContain('  metadata.title: "Old Title" → "New Title"')
    })

    it("renders added, removed, and modified variables", () => {
        const diff = emptyDiff({
            variables: {
                added: [
                    {
                        id: "v3",
                        symbol: "r",
                        argumentId: "a",
                        argumentVersion: 1,
                        metadata: {},
                    },
                ],
                removed: [
                    {
                        id: "v1",
                        symbol: "p",
                        argumentId: "a",
                        argumentVersion: 0,
                        metadata: {},
                    },
                ],
                modified: [
                    {
                        before: {
                            id: "v2",
                            symbol: "q",
                            argumentId: "a",
                            argumentVersion: 0,
                            metadata: {},
                        },
                        after: {
                            id: "v2",
                            symbol: "Q",
                            argumentId: "a",
                            argumentVersion: 1,
                            metadata: {},
                        },
                        changes: [{ field: "symbol", before: "q", after: "Q" }],
                    },
                ],
            },
        })
        renderDiff(diff)
        expect(printedLines).toContain("Variables:")
        expect(printedLines).toContain("  + v3 (added)")
        expect(printedLines).toContain("  - v1 (removed)")
        expect(printedLines).toContain("  ~ v2:")
        expect(printedLines).toContain('    symbol: "q" → "Q"')
    })

    it("renders added, removed, and modified premises with nested expressions", () => {
        const diff = emptyDiff({
            premises: {
                added: [
                    {
                        id: "p2",
                        metadata: { title: "New Premise" },
                        variables: [],
                        expressions: [],
                    },
                ],
                removed: [
                    {
                        id: "p3",
                        metadata: { title: "Old Premise" },
                        variables: [],
                        expressions: [],
                    },
                ],
                modified: [
                    {
                        before: {
                            id: "p1",
                            metadata: { title: "Before" },
                            variables: [],
                            expressions: [],
                        },
                        after: {
                            id: "p1",
                            metadata: { title: "After" },
                            variables: [],
                            expressions: [],
                        },
                        changes: [
                            {
                                field: "metadata.title",
                                before: "Before",
                                after: "After",
                            },
                        ],
                        expressions: {
                            added: [
                                {
                                    id: "e1",
                                    type: "variable",
                                    argumentId: "a",
                                    argumentVersion: 1,
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
        })
        renderDiff(diff)
        expect(printedLines).toContain("Premises:")
        expect(printedLines).toContain("  + p2 (added)")
        expect(printedLines).toContain("  - p3 (removed)")
        expect(printedLines).toContain("  ~ p1:")
        expect(printedLines).toContain('    metadata.title: "Before" → "After"')
        expect(printedLines).toContain("    Expressions:")
        expect(printedLines).toContain("      + e1 (added)")
    })

    it("renders role changes", () => {
        const diff = emptyDiff({
            roles: {
                conclusion: { before: "p1", after: "p2" },
                supportingAdded: ["p3"],
                supportingRemoved: ["p4"],
            },
        })
        renderDiff(diff)
        expect(printedLines).toContain("Roles:")
        expect(printedLines).toContain('  conclusion: "p1" → "p2"')
        expect(printedLines).toContain("  + support: p3 (added)")
        expect(printedLines).toContain("  - support: p4 (removed)")
    })

    it("omits sections with no changes", () => {
        const diff = emptyDiff({
            argument: {
                before: makeArg(),
                after: makeArg({ version: 1, createdAt: 1 }),
                changes: [{ field: "metadata.title", before: "Old", after: "New" }],
            },
        })
        renderDiff(diff)
        expect(printedLines).toContain("Argument:")
        expect(printedLines).not.toContain("Variables:")
        expect(printedLines).not.toContain("Premises:")
        expect(printedLines).not.toContain("Roles:")
    })
})
