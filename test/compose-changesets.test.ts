import { describe, expect, it } from "vitest"
import { composeChangesets } from "../src/lib/utils/changeset.js"
import type { TCoreChangeset } from "../src/lib/types/mutation.js"

// Entities only need an id and something that changes; the expression
// bucket stands in for all three entity categories, which share one rule.
type TEntity = { id: string; v: number }
const e = (id: string, v: number) => ({ id, v })
const changes = (
    added: TEntity[] = [],
    modified: TEntity[] = [],
    removed: TEntity[] = []
) =>
    ({ expressions: { added, modified, removed } }) as unknown as TCoreChangeset
const buckets = (c: TCoreChangeset) => c.expressions as unknown

describe("composeChangesets — one change after another", () => {
    it("keeps an entity added and then modified as added, with the later value", () => {
        expect(
            buckets(
                composeChangesets(
                    changes([e("x", 1)]),
                    changes([], [e("x", 2)])
                )
            )
        ).toEqual({ added: [e("x", 2)], modified: [], removed: [] })
    })

    it("drops an entity added and then removed", () => {
        expect(
            composeChangesets(
                changes([e("x", 1)]),
                changes([], [], [e("x", 1)])
            ).expressions
        ).toBeUndefined()
    })

    it("turns an entity modified and then removed into removed", () => {
        expect(
            buckets(
                composeChangesets(
                    changes([], [e("x", 1)]),
                    changes([], [], [e("x", 1)])
                )
            )
        ).toEqual({ added: [], modified: [], removed: [e("x", 1)] })
    })

    it("turns an entity removed and then added again into modified", () => {
        expect(
            buckets(
                composeChangesets(
                    changes([], [], [e("x", 1)]),
                    changes([e("x", 2)])
                )
            )
        ).toEqual({ added: [], modified: [e("x", 2)], removed: [] })
    })

    it("keeps the later value of an entity modified twice", () => {
        expect(
            buckets(
                composeChangesets(
                    changes([], [e("x", 1)]),
                    changes([], [e("x", 2)])
                )
            )
        ).toEqual({ added: [], modified: [e("x", 2)], removed: [] })
    })

    it("keeps unrelated entities from both sides", () => {
        expect(
            buckets(
                composeChangesets(
                    changes([e("a", 1)], [], [e("r", 1)]),
                    changes([], [e("m", 1)])
                )
            )
        ).toEqual({
            added: [e("a", 1)],
            modified: [e("m", 1)],
            removed: [e("r", 1)],
        })
    })

    it("takes the later roles and argument when the second sets them", () => {
        const first = {
            roles: { conclusionPremiseId: "p1" },
            argument: { id: "a", version: 1 },
        } as unknown as TCoreChangeset
        const second = {
            roles: { conclusionPremiseId: "p2" },
        } as unknown as TCoreChangeset
        const composed = composeChangesets(first, second)
        expect(composed.roles).toEqual({ conclusionPremiseId: "p2" })
        expect(composed.argument).toEqual({ id: "a", version: 1 })
    })
})
