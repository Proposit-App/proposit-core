import { describe, expect, it } from "vitest"
import { mergeChangesets } from "../../src/lib/index"
import { type TCoreArgument } from "../../src/lib/schemata"
import type { TCoreChangeset } from "../../src/lib/types/mutation"

describe("mergeChangesets", () => {
    it("merges two empty changesets", () => {
        const a: TCoreChangeset = {}
        const b: TCoreChangeset = {}
        const result = mergeChangesets(a, b)
        expect(result).toEqual({})
    })

    it("deduplicates by id with last-write-wins", () => {
        const a: TCoreChangeset = {
            expressions: {
                added: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "old",
                        descendantChecksum: null,
                        combinedChecksum: "old",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const b: TCoreChangeset = {
            expressions: {
                added: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "new",
                        descendantChecksum: null,
                        combinedChecksum: "new",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const result = mergeChangesets(a, b)
        expect(result.expressions?.added).toHaveLength(1)
        expect(result.expressions?.added[0].checksum).toBe("new")
    })

    it("merges different entity categories independently", () => {
        const a: TCoreChangeset = {
            expressions: {
                added: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const b: TCoreChangeset = {
            variables: {
                added: [
                    {
                        id: "var1",
                        symbol: "P",
                        argumentId: "a",
                        argumentVersion: 0,
                        claimId: "cl",
                        claimVersion: 0,
                        checksum: "c",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const result = mergeChangesets(a, b)
        expect(result.expressions?.added).toHaveLength(1)
        expect(result.variables?.added).toHaveLength(1)
    })

    it("throws when an entity appears in both added and removed", () => {
        const a: TCoreChangeset = {
            expressions: {
                added: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const b: TCoreChangeset = {
            expressions: {
                added: [],
                modified: [],
                removed: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
            },
        }
        expect(() => mergeChangesets(a, b)).toThrow(/added and removed/)
    })

    it("throws when an entity appears in both added and modified", () => {
        const a: TCoreChangeset = {
            expressions: {
                added: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const b: TCoreChangeset = {
            expressions: {
                added: [],
                modified: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c2",
                        descendantChecksum: null,
                        combinedChecksum: "c2",
                    },
                ],
                removed: [],
            },
        }
        expect(() => mergeChangesets(a, b)).toThrow(/added and modified/)
    })

    it("throws when an entity appears in both modified and removed", () => {
        const a: TCoreChangeset = {
            expressions: {
                added: [],
                modified: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
                removed: [],
            },
        }
        const b: TCoreChangeset = {
            expressions: {
                added: [],
                modified: [],
                removed: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
            },
        }
        expect(() => mergeChangesets(a, b)).toThrow(/modified and removed/)
    })

    it("throws when a variable appears in both added and removed", () => {
        const a: TCoreChangeset = {
            variables: {
                added: [
                    {
                        id: "v1",
                        symbol: "P",
                        argumentId: "a",
                        argumentVersion: 0,
                        claimId: "cl",
                        claimVersion: 0,
                        checksum: "c",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const b: TCoreChangeset = {
            variables: {
                added: [],
                modified: [],
                removed: [
                    {
                        id: "v1",
                        symbol: "P",
                        argumentId: "a",
                        argumentVersion: 0,
                        claimId: "cl",
                        claimVersion: 0,
                        checksum: "c",
                    },
                ],
            },
        }
        expect(() => mergeChangesets(a, b)).toThrow(/variables/)
    })

    it("takes roles from b when present", () => {
        const a: TCoreChangeset = { roles: { conclusionPremiseId: "p1" } }
        const b: TCoreChangeset = { roles: { conclusionPremiseId: "p2" } }
        const result = mergeChangesets(a, b)
        expect(result.roles?.conclusionPremiseId).toBe("p2")
    })

    it("keeps roles from a when b has none", () => {
        const a: TCoreChangeset = { roles: { conclusionPremiseId: "p1" } }
        const b: TCoreChangeset = {}
        const result = mergeChangesets(a, b)
        expect(result.roles?.conclusionPremiseId).toBe("p1")
    })

    it("takes argument from b when present", () => {
        const a: TCoreChangeset = {
            argument: { id: "a1", version: 0 } as TCoreArgument,
        }
        const b: TCoreChangeset = {
            argument: { id: "a1", version: 1 } as TCoreArgument,
        }
        const result = mergeChangesets(a, b)
        expect(result.argument?.version).toBe(1)
    })

    it("omits empty entity categories from result", () => {
        const a: TCoreChangeset = {}
        const b: TCoreChangeset = {
            expressions: { added: [], modified: [], removed: [] },
        }
        const result = mergeChangesets(a, b)
        expect(result.expressions).toBeUndefined()
    })
})
