import { describe, expect, it } from "vitest"
import { ArgumentEngine, PremiseEngine } from "../../src/lib/index"
import { Value } from "typebox/value"
import {
    CoreArgumentSchema,
    CorePropositionalVariableSchema,
    CorePremiseSchema,
    type TCoreArgument,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
    type TCorePremise,
} from "../../src/lib/schemata"
import { VariableManager } from "../../src/lib/core/variable-manager"
import { ExpressionManager } from "../../src/lib/core/expression-manager"
import type { TExpressionInput } from "../../src/lib/core/expression-manager"
import type { TOptionalChecksum } from "../../src/lib/schemata/shared"
import type { TCoreChangeset } from "../../src/lib/types/mutation"
import { aLib } from "./fixtures"

describe("schema shapes with additionalProperties", () => {
    it("CoreArgumentSchema accepts { id, version, checksum } with additional properties", () => {
        const valid = Value.Check(CoreArgumentSchema, {
            id: "x",
            version: 0,
            checksum: "abc123",
            descendantChecksum: null,
            combinedChecksum: "abc123",
            title: "Test",
            custom: 42,
        })
        expect(valid).toBe(true)
    })

    it("CoreArgumentSchema rejects missing required fields", () => {
        const invalid = Value.Check(CoreArgumentSchema, { id: "x" })
        expect(invalid).toBe(false)
    })

    it("CorePropositionalVariableSchema accepts { id, argumentId, argumentVersion, symbol, checksum } with additional properties", () => {
        const valid = Value.Check(CorePropositionalVariableSchema, {
            id: "v-1",
            argumentId: "a-1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
            symbol: "P",
            checksum: "abc123",
            label: "Proposition P",
        })
        expect(valid).toBe(true)
    })

    it("CorePremiseSchema accepts minimal shape with additional properties", () => {
        const valid = Value.Check(CorePremiseSchema, {
            id: "p-1",
            argumentId: "a-1",
            argumentVersion: 0,
            type: "freeform",
            claimId: "claim-default",
            claimVersion: 0,
            variables: [],
            expressions: [],
            checksum: "abc123",
            descendantChecksum: null,
            combinedChecksum: "abc123",
            title: "My Premise",
            priority: 1,
        })
        expect(valid).toBe(true)
    })
})

describe("field preservation — unknown fields survive round-trips", () => {
    const ARG_WITH_EXTRAS = {
        id: "arg-1",
        version: 1,
        title: "My Argument",
        customField: 42,
    }

    it("preserves unknown fields on the argument through getArgument()", () => {
        const engine = new ArgumentEngine(
            ARG_WITH_EXTRAS as TOptionalChecksum<TCoreArgument>,
            aLib(),
            { behavior: "permissive" }
        )
        const result = engine.getArgument()
        expect((result as Record<string, unknown>).title).toBe("My Argument")
        expect((result as Record<string, unknown>).customField).toBe(42)
    })

    it("preserves unknown fields on the argument through snapshot()", () => {
        const engine = new ArgumentEngine(
            ARG_WITH_EXTRAS as TOptionalChecksum<TCoreArgument>,
            aLib(),
            { behavior: "permissive" }
        )
        const snap = engine.snapshot()
        expect((snap.argument as Record<string, unknown>).title).toBe(
            "My Argument"
        )
        expect((snap.argument as Record<string, unknown>).customField).toBe(42)
    })

    it("preserves extras on premises through toData()", () => {
        const engine = new ArgumentEngine({ id: "arg-1", version: 1 }, aLib(), {
            behavior: "permissive",
        })
        const { result: pm } = engine.createPremise({
            title: "My Premise",
            priority: "high",
        })
        const data = pm.toPremiseData()
        expect((data as Record<string, unknown>).title).toBe("My Premise")
        expect((data as Record<string, unknown>).priority).toBe("high")
    })

    it("preserves extras on premises through engine.snapshot()", () => {
        const engine = new ArgumentEngine({ id: "arg-1", version: 1 }, aLib(), {
            behavior: "permissive",
        })
        engine.createPremise({ title: "Premise One" })
        const snap = engine.snapshot()
        expect(
            (snap.premises[0].premise as Record<string, unknown>).title
        ).toBe("Premise One")
    })

    it("setExtras replaces all extras, not merges", () => {
        const engine = new ArgumentEngine({ id: "arg-1", version: 1 }, aLib(), {
            behavior: "permissive",
        })
        const { result: pm } = engine.createPremise({ a: "1", b: "2" })
        pm.setExtras({ c: "3" })
        expect(pm.getExtras()).toEqual({ c: "3" })
        expect(pm.getExtras()).not.toHaveProperty("a")
    })

    it("structural fields in toData() cannot be shadowed by extras", () => {
        const engine = new ArgumentEngine({ id: "arg-1", version: 1 }, aLib(), {
            behavior: "permissive",
        })
        const { result: pm } = engine.createPremise({
            id: "should-be-overridden",
            rootExpressionId: "fake",
        })
        const data = pm.toPremiseData()
        expect(data.id).not.toBe("should-be-overridden")
        expect(data.id).toBe(pm.getId())
        expect(pm.getRootExpressionId()).toBeUndefined()
    })
})

describe("VariableManager — generic type parameter", () => {
    it("accepts and returns an extended variable type", () => {
        type TExtendedVar = TCorePropositionalVariable & { color: string }
        const vm = new VariableManager<TExtendedVar>()
        const v: TExtendedVar = {
            id: "v1",
            argumentId: "a1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
            symbol: "P",
            checksum: "abc",
            color: "red",
        }
        vm.addVariable(v)
        const retrieved = vm.getVariable("v1")!
        expect(retrieved.color).toBe("red")
        expect(retrieved.symbol).toBe("P")

        const all = vm.toArray()
        expect(all[0].color).toBe("red")

        const updated = vm.updateVariable("v1", { symbol: "Q" })!
        expect(updated.color).toBe("red")
        expect(updated.symbol).toBe("Q")

        const removed = vm.removeVariable("v1")!
        expect(removed.color).toBe("red")
    })
})

// ---------------------------------------------------------------------------
// mutation types — generic changesets
// ---------------------------------------------------------------------------

describe("mutation types — generic changesets", () => {
    it("TCoreChangeset accepts extended entity types", () => {
        type TExtVar = TCorePropositionalVariable & { color: string }

        const changeset: TCoreChangeset<TCorePropositionalExpression, TExtVar> =
            {
                variables: {
                    added: [
                        {
                            id: "v1",
                            argumentId: "a1",
                            argumentVersion: 0,
                            claimId: "claim-default",
                            claimVersion: 0,
                            symbol: "P",
                            checksum: "abc",
                            color: "red",
                        },
                    ],
                    modified: [],
                    removed: [],
                },
            }
        expect(changeset.variables!.added[0].color).toBe("red")
    })
})

// ---------------------------------------------------------------------------
// ExpressionManager — generic type parameter
// ---------------------------------------------------------------------------

describe("ExpressionManager — generic type parameter", () => {
    it("stores and returns extended expression types", () => {
        type TExtExpr = TCorePropositionalExpression & { tag: string }
        const em = new ExpressionManager<TExtExpr>()

        const expr: TExpressionInput<TExtExpr> = {
            id: "e1",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: null,
            position: 1000,
            type: "variable" as const,
            variableId: "v1",
            tag: "custom",
        }
        em.addExpression(expr)

        const retrieved = em.getExpression("e1")!
        expect((retrieved as unknown as { tag: string }).tag).toBe("custom")

        const all = em.toArray()
        expect((all[0] as unknown as { tag: string }).tag).toBe("custom")
    })
})

describe("PremiseEngine — generic type parameters", () => {
    it("preserves extended premise type in toData()", () => {
        type TExtPremise = TCorePremise & { color: string }
        const arg: TCoreArgument = {
            id: "a1",
            version: 0,
            checksum: "x",
            descendantChecksum: null,
            combinedChecksum: "x",
        }
        const vm = new VariableManager()
        const pm = new PremiseEngine<TCoreArgument, TExtPremise>(
            {
                id: "p1",
                argumentId: arg.id,
                argumentVersion: arg.version,
                color: "blue",
            } as TExtPremise,
            { argument: arg, variables: vm }
        )
        const data = pm.toPremiseData()
        expect(data.color).toBe("blue")
    })
})

describe("ArgumentEngine — generic type parameters", () => {
    it("preserves extended argument type", () => {
        type TExtArg = TCoreArgument & { projectId: string }
        const arg: TOptionalChecksum<TExtArg> = {
            id: "a1",
            version: 0,
            projectId: "proj-1",
        }
        const engine = new ArgumentEngine<TExtArg>(arg, aLib())
        const retrieved = engine.getArgument()
        expect(retrieved.projectId).toBe("proj-1")
        expect(typeof retrieved.checksum).toBe("string")
    })

    it("preserves extended variable type through addVariable", () => {
        type TExtVar = TCorePropositionalVariable & { color: string }
        const engine = new ArgumentEngine<
            TCoreArgument,
            TCorePremise,
            TCorePropositionalExpression,
            TExtVar
        >({ id: "a1", version: 0 }, aLib())
        const { result } = engine.addVariable({
            id: "v1",
            argumentId: "a1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
            symbol: "P",
            color: "red",
        })
        expect(result.color).toBe("red")
        expect(typeof result.checksum).toBe("string")
    })
})
