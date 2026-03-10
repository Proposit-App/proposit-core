import { describe, it, expect, vi, beforeEach } from "vitest"
import type { TCoreArgumentDiff } from "../src/lib/types/diff.js"
import type { TCorePremise } from "../src/lib/schemata/propositional.js"

// We capture printLine calls to verify output
const printedLines: string[] = []
vi.mock("../src/cli/output.js", () => ({
    printLine: (text: string) => {
        printedLines.push(text)
    },
}))

// Import after mock setup
const { renderDiff, isDiffEmpty } =
    await import("../src/cli/output/diff-renderer.js")

beforeEach(() => {
    printedLines.length = 0
})

// Helper to reduce boilerplate in argument before/after fields
function makeArg(
    overrides: Partial<{
        id: string
        version: number
    }> = {}
) {
    return {
        id: "a",
        version: 0,
        checksum: "x",
        ...overrides,
    }
}

function emptyDiff(
    overrides: Partial<TCoreArgumentDiff> = {}
): TCoreArgumentDiff {
    return {
        argument: {
            before: makeArg(),
            after: makeArg({ version: 1 }),
            changes: [],
        },
        variables: { added: [], removed: [], modified: [] },
        premises: { added: [], removed: [], modified: [] },
        roles: {
            conclusion: { before: undefined, after: undefined },
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
                before: makeArg(),
                after: makeArg({ version: 1 }),
                changes: [{ field: "title", before: "Old", after: "New" }],
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
                        checksum: "x",
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
                before: makeArg(),
                after: makeArg({ version: 1 }),
                changes: [
                    {
                        field: "title",
                        before: "Old Title",
                        after: "New Title",
                    },
                ],
            },
        })
        renderDiff(diff)
        expect(printedLines).toContain("Argument:")
        expect(printedLines).toContain('  title: "Old Title" → "New Title"')
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
                        checksum: "x",
                    },
                ],
                removed: [
                    {
                        id: "v1",
                        symbol: "p",
                        argumentId: "a",
                        argumentVersion: 0,
                        checksum: "x",
                    },
                ],
                modified: [
                    {
                        before: {
                            id: "v2",
                            symbol: "q",
                            argumentId: "a",
                            argumentVersion: 0,
                            checksum: "x",
                        },
                        after: {
                            id: "v2",
                            symbol: "Q",
                            argumentId: "a",
                            argumentVersion: 1,
                            checksum: "x",
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
                        argumentId: "a",
                        argumentVersion: 0,
                        title: "New Premise",
                        variables: [],
                        expressions: [],
                        checksum: "x",
                    } as TCorePremise,
                ],
                removed: [
                    {
                        id: "p3",
                        argumentId: "a",
                        argumentVersion: 0,
                        title: "Old Premise",
                        variables: [],
                        expressions: [],
                        checksum: "x",
                    } as TCorePremise,
                ],
                modified: [
                    {
                        before: {
                            id: "p1",
                            argumentId: "a",
                            argumentVersion: 0,
                            title: "Before",
                            variables: [],
                            expressions: [],
                            checksum: "x",
                        } as TCorePremise,
                        after: {
                            id: "p1",
                            argumentId: "a",
                            argumentVersion: 1,
                            title: "After",
                            variables: [],
                            expressions: [],
                            checksum: "x",
                        } as TCorePremise,
                        changes: [
                            {
                                field: "title",
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
                                    premiseId: "p1",
                                    parentId: null,
                                    position: 0,
                                    variableId: "v1",
                                    checksum: "x",
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
        expect(printedLines).toContain('    title: "Before" → "After"')
        expect(printedLines).toContain("    Expressions:")
        expect(printedLines).toContain("      + e1 (added)")
    })

    it("renders role changes", () => {
        const diff = emptyDiff({
            roles: {
                conclusion: { before: "p1", after: "p2" },
            },
        })
        renderDiff(diff)
        expect(printedLines).toContain("Roles:")
        expect(printedLines).toContain('  conclusion: "p1" → "p2"')
    })

    it("omits sections with no changes", () => {
        const diff = emptyDiff({
            argument: {
                before: makeArg(),
                after: makeArg({ version: 1 }),
                changes: [{ field: "title", before: "Old", after: "New" }],
            },
        })
        renderDiff(diff)
        expect(printedLines).toContain("Argument:")
        expect(printedLines).not.toContain("Variables:")
        expect(printedLines).not.toContain("Premises:")
        expect(printedLines).not.toContain("Roles:")
    })
})
