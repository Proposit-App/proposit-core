import { describe, expect, it } from "vitest"
import { CONTESTED } from "../../src/lib/types/evaluation.js"
import { buildArgument, implies, v, xor } from "./fixtures.js"

/**
 * A granted `xor` step constrains its operands by parity: the reader has said
 * the exclusive disjunction holds, so an odd number of its operands are true.
 * That determines one operand exactly when the others are pinned, which is the
 * same shape the `or` rule already has — a child whose siblings are all known
 * false must itself be true.
 *
 * Every trigger reads a truth *component*, so it can only start holding as the
 * closure learns more. The order-independence that buys is asserted directly
 * rather than assumed: the engine visits premises in sorted-ID order and the
 * IDs are random, so repeating a build permutes the order the closure sees.
 */
function evaluateGrantedXor(
    values: Record<string, boolean | null>,
    operands: string[]
) {
    const built = buildArgument({
        conclusion: v("Z"),
        premises: [xor(...operands.map((name) => v(name)))],
    })
    const { engine, rootIds, variableId } = built
    const variables: Record<string, boolean | null> = {
        [variableId("Z")]: null,
    }
    for (const [name, value] of Object.entries(values)) {
        variables[variableId(name)] = value
    }
    const result = engine.evaluate({
        variables,
        operatorAssignments: { [rootIds[0]]: "accepted" },
    })
    return { result, variableId }
}

const valueOf = (
    outcome: ReturnType<typeof evaluateGrantedXor>,
    name: string
): unknown => outcome.result.variableProvenance?.[outcome.variableId(name)]?.value

describe("a granted xor step forces the parity remainder", () => {
    it("forces the last operand false when the others are an odd number of trues", () => {
        const outcome = evaluateGrantedXor({ A: true, B: null }, ["A", "B"])
        expect(valueOf(outcome, "B")).toBe(false)
    })

    it("forces the last operand true when the others are an even number of trues", () => {
        const outcome = evaluateGrantedXor({ A: false, B: null }, ["A", "B"])
        expect(valueOf(outcome, "B")).toBe(true)
    })

    it("counts parity across three operands rather than stopping at one", () => {
        const evenSiblings = evaluateGrantedXor(
            { A: true, B: true, C: null },
            ["A", "B", "C"]
        )
        expect(valueOf(evenSiblings, "C")).toBe(true)

        const oddSiblings = evaluateGrantedXor(
            { A: true, B: false, C: null },
            ["A", "B", "C"]
        )
        expect(valueOf(oddSiblings, "C")).toBe(false)
    })

    it("forces nothing while any sibling is still unanswered", () => {
        const outcome = evaluateGrantedXor(
            { A: true, B: null, C: null },
            ["A", "B", "C"]
        )
        // Unforced reads as either an absent provenance entry or a null one;
        // what matters is that the closure committed to neither truth value.
        expect(valueOf(outcome, "B") ?? null).toBe(null)
        expect(valueOf(outcome, "C") ?? null).toBe(null)
    })

    it("lands on contested when a sibling can be read either way", () => {
        // Two granted steps drive A both ways, so by the time the xor step is
        // read its sibling carries both components. Parity is then open in both
        // directions and the remaining operand inherits that, rather than the
        // closure silently picking whichever reading it saw first.
        const built = buildArgument({
            conclusion: v("Z"),
            premises: [
                implies(v("P"), v("A")),
                implies(v("A"), v("Q")),
                xor(v("A"), v("B")),
            ],
        })
        const { engine, rootIds, variableId } = built
        const run = (): unknown =>
            engine.evaluate({
                variables: {
                    [variableId("P")]: true,
                    [variableId("Q")]: false,
                    [variableId("A")]: null,
                    [variableId("B")]: null,
                    [variableId("Z")]: null,
                },
                operatorAssignments: {
                    [rootIds[0]]: "accepted",
                    [rootIds[1]]: "accepted",
                    [rootIds[2]]: "accepted",
                },
            }).variableProvenance?.[variableId("B")]?.value
        // B is the field this rule writes. A is driven contested by the two
        // implication steps whatever xor does, so asserting on A would pass
        // without the parity rule ever running.
        expect(run()).toBe(CONTESTED)
    })

    it("reaches the same answer on every run, whatever order the closure sees", () => {
        const outcomes = new Set<unknown>()
        for (let run = 0; run < 200; run++) {
            outcomes.add(
                valueOf(
                    evaluateGrantedXor({ A: true, B: true, C: null }, [
                        "A",
                        "B",
                        "C",
                    ]),
                    "C"
                )
            )
        }
        expect([...outcomes]).toEqual([true])
    })
})
