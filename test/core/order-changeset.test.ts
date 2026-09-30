import { describe, expect, it } from "vitest"
import { orderChangeset } from "../../src/lib/index"
import type { TOrderedOperation } from "../../src/lib/index"
import { type TCoreArgument } from "../../src/lib/schemata"
import type { TCoreChangeset } from "../../src/lib/types/mutation"

describe("orderChangeset", () => {
    // Helper: extract entity names from operation list in order
    const opSummary = (ops: TOrderedOperation[]) =>
        ops.map((op) => `${op.type}:${op.entity}`)

    it("returns empty array for empty changeset", () => {
        const result = orderChangeset({})
        expect(result).toEqual([])
    })

    it("orders deletes in reverse FK order: expressions → variables → premises", () => {
        const changeset: TCoreChangeset = {
            premises: {
                added: [],
                modified: [],
                removed: [
                    {
                        id: "p1",
                        argumentId: "a",
                        argumentVersion: 0,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                        type: "freeform" as const,
                    },
                ],
            },
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
        const ops = orderChangeset(changeset)
        const summary = opSummary(ops)
        const deleteExpr = summary.indexOf("delete:expression")
        const deleteVar = summary.indexOf("delete:variable")
        const deletePremise = summary.indexOf("delete:premise")
        expect(deleteExpr).toBeLessThan(deleteVar)
        expect(deleteVar).toBeLessThan(deletePremise)
    })

    it("orders inserts in FK-safe order: premises → variables → expressions", () => {
        const changeset: TCoreChangeset = {
            premises: {
                added: [
                    {
                        id: "p1",
                        argumentId: "a",
                        argumentVersion: 0,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                        type: "freeform" as const,
                    },
                ],
                modified: [],
                removed: [],
            },
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
        const ops = orderChangeset(changeset)
        const summary = opSummary(ops)
        const insertPremise = summary.indexOf("insert:premise")
        const insertVar = summary.indexOf("insert:variable")
        const insertExpr = summary.indexOf("insert:expression")
        expect(insertPremise).toBeLessThan(insertVar)
        expect(insertVar).toBeLessThan(insertExpr)
    })

    it("orders premise updates before deletes", () => {
        const changeset: TCoreChangeset = {
            premises: {
                added: [],
                modified: [
                    {
                        id: "p1",
                        argumentId: "a",
                        argumentVersion: 0,
                        checksum: "c2",
                        descendantChecksum: null,
                        combinedChecksum: "c2",
                        type: "freeform" as const,
                    },
                ],
                removed: [
                    {
                        id: "p2",
                        argumentId: "a",
                        argumentVersion: 0,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                        type: "freeform" as const,
                    },
                ],
            },
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
                        premiseId: "p2",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
            },
        }
        const ops = orderChangeset(changeset)
        const summary = opSummary(ops)
        const updatePremise = summary.indexOf("update:premise")
        const deleteExpr = summary.indexOf("delete:expression")
        expect(updatePremise).toBeLessThan(deleteExpr)
    })

    it("topologically sorts inserted expressions so parents come before children", () => {
        const changeset: TCoreChangeset = {
            expressions: {
                added: [
                    {
                        id: "child",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: "parent",
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                    {
                        id: "parent",
                        type: "operator",
                        operator: "and",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: "d",
                        combinedChecksum: "cd",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const ops = orderChangeset(changeset)
        const insertOps = ops.filter(
            (op) => op.type === "insert" && op.entity === "expression"
        )
        expect(insertOps).toHaveLength(2)
        expect(insertOps[0].data.id).toBe("parent")
        expect(insertOps[1].data.id).toBe("child")
    })

    it("topologically sorts 3-level deep inserted expressions", () => {
        const changeset: TCoreChangeset = {
            expressions: {
                added: [
                    {
                        id: "grandchild",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: "child",
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                    {
                        id: "root",
                        type: "operator",
                        operator: "and",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: "d",
                        combinedChecksum: "cd",
                    },
                    {
                        id: "child",
                        type: "formula",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: "root",
                        position: 1,
                        checksum: "c",
                        descendantChecksum: "d",
                        combinedChecksum: "cd",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const ops = orderChangeset(changeset)
        const insertOps = ops.filter(
            (op) => op.type === "insert" && op.entity === "expression"
        )
        expect(insertOps.map((op) => op.data.id)).toEqual([
            "root",
            "child",
            "grandchild",
        ])
    })

    it("puts deletes before inserts", () => {
        const changeset: TCoreChangeset = {
            expressions: {
                added: [
                    {
                        id: "e2",
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
        const ops = orderChangeset(changeset)
        const summary = opSummary(ops)
        const deleteIdx = summary.indexOf("delete:expression")
        const insertIdx = summary.indexOf("insert:expression")
        expect(deleteIdx).toBeLessThan(insertIdx)
    })

    it("reverse-topologically sorts deleted expressions so children come before parents", () => {
        const changeset: TCoreChangeset = {
            expressions: {
                added: [],
                modified: [],
                removed: [
                    {
                        id: "parent",
                        type: "operator",
                        operator: "and",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: "d",
                        combinedChecksum: "cd",
                    },
                    {
                        id: "child",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: "parent",
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
            },
        }
        const ops = orderChangeset(changeset)
        const deleteOps = ops.filter(
            (op) => op.type === "delete" && op.entity === "expression"
        )
        expect(deleteOps).toHaveLength(2)
        expect(deleteOps[0].data.id).toBe("child")
        expect(deleteOps[1].data.id).toBe("parent")
    })

    it("emits reparent updates before deleting the old parent (cascade safety)", () => {
        // Scenario: absorbSameOperator reparents V3, V4 from OR to AND,
        // then deletes OR and F1. If the DB has ON DELETE CASCADE on
        // parentId, deleting OR before updating V3/V4's parentId destroys them.
        const changeset: TCoreChangeset = {
            expressions: {
                added: [],
                modified: [
                    {
                        // V3 — reparented from OR to AND
                        id: "v3",
                        type: "variable",
                        variableId: "var3",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: "and", // new parent
                        position: 3,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                    {
                        // V4 — reparented from OR to AND
                        id: "v4",
                        type: "variable",
                        variableId: "var4",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: "and", // new parent
                        position: 4,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                    {
                        // AND — checksum updated (not reparented)
                        id: "and",
                        type: "operator",
                        operator: "and",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c2",
                        descendantChecksum: "d2",
                        combinedChecksum: "cd2",
                    },
                ],
                removed: [
                    {
                        // OR — the old parent being deleted
                        id: "or",
                        type: "operator",
                        operator: "or",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: "f1",
                        position: 1,
                        checksum: "c",
                        descendantChecksum: "d",
                        combinedChecksum: "cd",
                    },
                    {
                        // F1 — formula wrapper also deleted
                        id: "f1",
                        type: "formula",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: "and",
                        position: 2,
                        checksum: "c",
                        descendantChecksum: "d",
                        combinedChecksum: "cd",
                    },
                ],
            },
        }
        const ops = orderChangeset(changeset)

        // Find the first update for a reparented child (v3 or v4)
        const firstReparentUpdate = ops.findIndex(
            (op) =>
                op.type === "update" &&
                op.entity === "expression" &&
                (op.data.id === "v3" || op.data.id === "v4")
        )
        // Find the first delete of the old parent
        const firstDelete = ops.findIndex(
            (op) =>
                op.type === "delete" &&
                op.entity === "expression" &&
                (op.data.id === "or" || op.data.id === "f1")
        )

        expect(firstReparentUpdate).not.toBe(-1)
        expect(firstDelete).not.toBe(-1)
        // The reparent update must come BEFORE the delete
        expect(firstReparentUpdate).toBeLessThan(firstDelete)
    })

    it("drops expressions from modified when also in removed (dedup)", () => {
        // Scenario: changeOperatorType records OR as modified (operator
        // field changed), then absorbSameOperator records it as removed.
        // The changeset should not contain OR in both buckets.
        const changeset: TCoreChangeset = {
            expressions: {
                added: [],
                modified: [
                    {
                        // OR — stale modified entry (also being deleted)
                        id: "or",
                        type: "operator",
                        operator: "and", // changed from or to and
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: "f1",
                        position: 1,
                        checksum: "c",
                        descendantChecksum: "d",
                        combinedChecksum: "cd",
                    },
                    {
                        // V3 — legitimately modified (reparented)
                        id: "v3",
                        type: "variable",
                        variableId: "var3",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: "and",
                        position: 3,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
                removed: [
                    {
                        id: "or",
                        type: "operator",
                        operator: "or",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: "f1",
                        position: 1,
                        checksum: "c",
                        descendantChecksum: "d",
                        combinedChecksum: "cd",
                    },
                ],
            },
        }
        const ops = orderChangeset(changeset)

        // OR is detached and then deleted, never updated with the stale
        // modified entry (operator "and"): the detach carries only the
        // parent and a root's position.
        const orOps = ops.filter(
            (op) => op.entity === "expression" && op.data.id === "or"
        )
        expect(orOps.map((op) => op.type)).toEqual(["update", "delete"])
        expect(orOps[0].data).toEqual({
            id: "or",
            parentId: null,
            position: 0,
        })

        // V3 should still appear as an update
        const v3Ops = ops.filter(
            (op) =>
                op.type === "update" &&
                op.entity === "expression" &&
                op.data.id === "v3"
        )
        expect(v3Ops).toHaveLength(1)
    })

    it("includes argument and roles updates at the end", () => {
        const changeset: TCoreChangeset = {
            roles: { conclusionPremiseId: "p1" },
            argument: { id: "a1", version: 1 } as TCoreArgument,
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
        const ops = orderChangeset(changeset)
        const summary = opSummary(ops)
        const insertVar = summary.indexOf("insert:variable")
        const updateArg = summary.indexOf("update:argument")
        const updateRoles = summary.indexOf("update:roles")
        expect(insertVar).toBeLessThan(updateArg)
        expect(insertVar).toBeLessThan(updateRoles)
    })
})
