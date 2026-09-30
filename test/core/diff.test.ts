import { describe, expect, it } from "vitest"
import { ArgumentEngine } from "../../src/lib/index"
import {
    type TCoreArgument,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
} from "../../src/lib/schemata"
import type { TOptionalChecksum } from "../../src/lib/schemata/shared"
import { POSITION_INITIAL } from "../../src/lib/utils/position"
import {
    defaultCompareArgument,
    defaultCompareVariable,
    defaultComparePremise,
    defaultCompareExpression,
    diffArguments,
} from "../../src/lib/core/diff"
import { ARG, aLib, makeVar, makeVarExpr, makeOpExpr, VAR_P } from "./fixtures"

describe("diffArguments", () => {
    describe("defaultCompareArgument", () => {
        it("returns empty array (no core diffable fields)", () => {
            const a = { ...ARG } as TCoreArgument
            const b = { ...ARG, version: 2 } as TCoreArgument
            expect(defaultCompareArgument(a, b)).toEqual([])
        })
    })

    describe("defaultCompareVariable", () => {
        it("returns empty array when symbol matches", () => {
            expect(
                defaultCompareVariable(
                    VAR_P as TCorePropositionalVariable,
                    VAR_P as TCorePropositionalVariable
                )
            ).toEqual([])
        })

        it("detects symbol change", () => {
            const before = makeVar("var-p", "P") as TCorePropositionalVariable
            const after = makeVar("var-p", "X") as TCorePropositionalVariable
            expect(defaultCompareVariable(before, after)).toEqual([
                { field: "symbol", before: "P", after: "X" },
            ])
        })
    })

    describe("defaultComparePremise", () => {
        it("returns empty when premises match", () => {
            const before = {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 1,
                checksum: "x",
                descendantChecksum: null,
                combinedChecksum: "x",
                type: "freeform" as const,
            }
            const after = {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 1,
                checksum: "x",
                descendantChecksum: null,
                combinedChecksum: "x",
                type: "freeform" as const,
            }
            expect(defaultComparePremise(before, after)).toEqual([])
        })

        it("returns empty for premises differing only in extra fields", () => {
            const before = {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 1,
                checksum: "x",
                descendantChecksum: null,
                combinedChecksum: "x",
                type: "freeform" as const,
            }
            const after = {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 1,
                checksum: "y",
                descendantChecksum: null,
                combinedChecksum: "y",
                type: "freeform" as const,
            }
            expect(defaultComparePremise(before, after)).toEqual([])
        })
    })

    describe("defaultCompareExpression", () => {
        it("detects parentId change", () => {
            const before = makeVarExpr("e1", "var-p", {
                parentId: "p1",
                position: 0,
            }) as TCorePropositionalExpression
            const after = makeVarExpr("e1", "var-p", {
                parentId: "p2",
                position: 0,
            }) as TCorePropositionalExpression
            expect(defaultCompareExpression(before, after)).toEqual([
                { field: "parentId", before: "p1", after: "p2" },
            ])
        })

        it("detects position change", () => {
            const before = makeVarExpr("e1", "var-p", {
                parentId: "p1",
                position: 0,
            }) as TCorePropositionalExpression
            const after = makeVarExpr("e1", "var-p", {
                parentId: "p1",
                position: 1,
            }) as TCorePropositionalExpression
            expect(defaultCompareExpression(before, after)).toEqual([
                { field: "position", before: 0, after: 1 },
            ])
        })

        it("detects variableId change on variable expression", () => {
            const before = makeVarExpr("e1", "var-p", {
                parentId: null,
                position: POSITION_INITIAL,
            }) as TCorePropositionalExpression
            const after = makeVarExpr("e1", "var-q", {
                parentId: null,
                position: POSITION_INITIAL,
            }) as TCorePropositionalExpression
            expect(defaultCompareExpression(before, after)).toEqual([
                { field: "variableId", before: "var-p", after: "var-q" },
            ])
        })

        it("detects operator change on operator expression", () => {
            const before = makeOpExpr("e1", "and", {
                parentId: null,
                position: POSITION_INITIAL,
            }) as TCorePropositionalExpression
            const after = makeOpExpr("e1", "or", {
                parentId: null,
                position: POSITION_INITIAL,
            }) as TCorePropositionalExpression
            expect(defaultCompareExpression(before, after)).toEqual([
                { field: "operator", before: "and", after: "or" },
            ])
        })

        it("detects type change between expression types", () => {
            const before = makeVarExpr("e1", "var-p", {
                parentId: null,
                position: POSITION_INITIAL,
            }) as TCorePropositionalExpression
            const after = makeOpExpr("e1", "and", {
                parentId: null,
                position: POSITION_INITIAL,
            }) as TCorePropositionalExpression
            expect(defaultCompareExpression(before, after)).toEqual([
                { field: "type", before: "variable", after: "operator" },
            ])
        })
    })

    // Helper: create an engine with one premise containing P → Q
    function buildSimpleEngine(arg: TOptionalChecksum<TCoreArgument>): {
        engine: ArgumentEngine
        premiseId: string
    } {
        const engine = new ArgumentEngine(arg, aLib(), {
            behavior: "permissive",
        })
        const varP = makeVar("var-p", "P")
        const varQ = makeVar("var-q", "Q")
        engine.addVariable(varP)
        engine.addVariable(varQ)

        const { result: pm } = engine.createPremiseWithId("premise-1", {
            title: "First premise",
        })
        pm.addExpression(
            makeOpExpr("expr-implies", "implies", {
                parentId: null,
                position: POSITION_INITIAL,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-p", "var-p", {
                parentId: "expr-implies",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", "var-q", {
                parentId: "expr-implies",
                position: 1,
            })
        )

        // premise-1 has implies root → automatically supporting
        return { engine, premiseId: "premise-1" }
    }

    describe("diffArguments function", () => {
        it("returns empty diff for identical engines", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const { engine: engineB } = buildSimpleEngine(ARG)
            // Use a symbol-based variable matcher because auto-created
            // premise-bound variables have random IDs that differ between engines
            const diff = diffArguments(engineA, engineB, {
                variableMatcher: (a, b) => a.symbol === b.symbol,
            })

            expect(diff.argument.changes).toEqual([])
            expect(diff.variables.added).toEqual([])
            expect(diff.variables.removed).toEqual([])
            expect(diff.variables.modified).toEqual([])
            expect(diff.premises.added).toEqual([])
            expect(diff.premises.removed).toEqual([])
            expect(diff.premises.modified).toEqual([])
            expect(diff.roles.conclusion).toEqual({
                before: "premise-1",
                after: "premise-1",
            })
        })

        it("detects added and removed variables", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const { engine: engineB } = buildSimpleEngine(ARG)

            // Add a new variable to engineB
            const varR = makeVar("var-r", "R")
            engineB.addVariable(varR)

            const diff = diffArguments(engineA, engineB)
            expect(diff.variables.added).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ id: "var-r", symbol: "R" }),
                ])
            )
        })

        it("detects modified variable (symbol change)", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const argB = { ...ARG }
            const engineB = new ArgumentEngine(argB, aLib(), {
                behavior: "permissive",
            })
            // Same variable ID, different symbol
            engineB.addVariable(makeVar("var-p", "X"))
            engineB.addVariable(makeVar("var-q", "Q"))
            const { result: pm } = engineB.createPremiseWithId("premise-1", {
                title: "First premise",
            })
            pm.addExpression(
                makeOpExpr("expr-implies", "implies", {
                    parentId: null,
                    position: POSITION_INITIAL,
                })
            )
            pm.addExpression(
                makeVarExpr("expr-p", "var-p", {
                    parentId: "expr-implies",
                    position: 0,
                })
            )
            pm.addExpression(
                makeVarExpr("expr-q", "var-q", {
                    parentId: "expr-implies",
                    position: 1,
                })
            )
            // premise-1 has implies root → automatically supporting

            const diff = diffArguments(engineA, engineB)
            expect(diff.variables.modified).toEqual([
                expect.objectContaining({
                    changes: [{ field: "symbol", before: "P", after: "X" }],
                }),
            ])
        })

        it("detects added premise", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const { engine: engineB } = buildSimpleEngine(ARG)

            const { result: pm2 } = engineB.createPremiseWithId("premise-2", {
                title: "Second premise",
            })
            pm2.addExpression(
                makeVarExpr("expr-p2", "var-p", {
                    parentId: null,
                    position: POSITION_INITIAL,
                })
            )

            const diff = diffArguments(engineA, engineB)
            expect(diff.premises.added).toHaveLength(1)
            expect(diff.premises.added[0].id).toBe("premise-2")
        })

        it("detects removed premise", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const engineB = new ArgumentEngine(ARG, aLib(), {
                behavior: "permissive",
            })

            const diff = diffArguments(engineA, engineB)
            expect(diff.premises.removed).toHaveLength(1)
            expect(diff.premises.removed[0].id).toBe("premise-1")
        })

        it("detects modified premise via expression-level changes", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const engineB = new ArgumentEngine(ARG, aLib(), {
                behavior: "permissive",
            })
            engineB.addVariable(makeVar("var-p", "P"))
            engineB.addVariable(makeVar("var-q", "Q"))
            const { result: pm } = engineB.createPremiseWithId("premise-1", {
                title: "First premise",
            })
            // Different root expression ID to trigger expression-level diffs
            pm.addExpression(
                makeOpExpr("expr-iff", "iff", {
                    parentId: null,
                    position: POSITION_INITIAL,
                })
            )
            pm.addExpression(
                makeVarExpr("expr-p", "var-p", {
                    parentId: "expr-iff",
                    position: 0,
                })
            )
            pm.addExpression(
                makeVarExpr("expr-q", "var-q", {
                    parentId: "expr-iff",
                    position: 1,
                })
            )
            // premise-1 has iff root → automatically supporting

            const diff = diffArguments(engineA, engineB)
            expect(diff.premises.modified).toHaveLength(1)
            // No premise-level field changes (rootExpressionId is not a schema field)
            expect(diff.premises.modified[0].changes).toEqual([])
            // Expression-level changes: implies removed, iff added
            expect(diff.premises.modified[0].expressions.removed).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ id: "expr-implies" }),
                ])
            )
            expect(diff.premises.modified[0].expressions.added).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ id: "expr-iff" }),
                ])
            )
        })

        it("detects modified expressions within a premise", () => {
            // Build engineA with an 'and' root so removing one child doesn't collapse
            const engineA = new ArgumentEngine(ARG, aLib(), {
                behavior: "permissive",
            })
            engineA.addVariable(makeVar("var-p", "P"))
            engineA.addVariable(makeVar("var-q", "Q"))
            const { result: pmA } = engineA.createPremiseWithId("premise-1", {
                title: "First premise",
            })
            pmA.addExpression(
                makeOpExpr("expr-and", "and", {
                    parentId: null,
                    position: POSITION_INITIAL,
                })
            )
            pmA.addExpression(
                makeVarExpr("expr-p", "var-p", {
                    parentId: "expr-and",
                    position: 0,
                })
            )
            pmA.addExpression(
                makeVarExpr("expr-q", "var-q", {
                    parentId: "expr-and",
                    position: 1,
                })
            )
            // Add a third child so removing one still leaves 2 (no collapse)
            engineA.addVariable(makeVar("var-r", "R"))
            pmA.addExpression(
                makeVarExpr("expr-r", "var-r", {
                    parentId: "expr-and",
                    position: 2,
                })
            )

            // Build engineB identically, then swap expr-r for expr-s
            const engineB = new ArgumentEngine(ARG, aLib(), {
                behavior: "permissive",
            })
            engineB.addVariable(makeVar("var-p", "P"))
            engineB.addVariable(makeVar("var-q", "Q"))
            engineB.addVariable(makeVar("var-r", "R"))
            const { result: pmB } = engineB.createPremiseWithId("premise-1", {
                title: "First premise",
            })
            pmB.addExpression(
                makeOpExpr("expr-and", "and", {
                    parentId: null,
                    position: POSITION_INITIAL,
                })
            )
            pmB.addExpression(
                makeVarExpr("expr-p", "var-p", {
                    parentId: "expr-and",
                    position: 0,
                })
            )
            pmB.addExpression(
                makeVarExpr("expr-q", "var-q", {
                    parentId: "expr-and",
                    position: 1,
                })
            )
            // Different expression at position 2
            const varS = makeVar("var-s", "S")
            engineB.addVariable(varS)
            pmB.addExpression(
                makeVarExpr("expr-s", "var-s", {
                    parentId: "expr-and",
                    position: 2,
                })
            )

            const diff = diffArguments(engineA, engineB)
            expect(diff.premises.modified).toHaveLength(1)
            const premiseDiff = diff.premises.modified[0]
            expect(premiseDiff.expressions.removed).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ id: "expr-r" }),
                ])
            )
            expect(premiseDiff.expressions.added).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ id: "expr-s" }),
                ])
            )
        })

        it("detects conclusion change", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const { engine: engineB } = buildSimpleEngine(ARG)

            // Both engines auto-set premise-1 as conclusion; engineB changes to premise-conc
            const { result: pmConc } = engineB.createPremiseWithId(
                "premise-conc",
                {
                    title: "Conclusion",
                }
            )
            pmConc.addExpression(
                makeOpExpr("expr-impl-conc", "implies", {
                    parentId: null,
                    position: POSITION_INITIAL,
                })
            )
            pmConc.addExpression(
                makeVarExpr("expr-p-conc", "var-p", {
                    parentId: "expr-impl-conc",
                    position: 0,
                })
            )
            pmConc.addExpression(
                makeVarExpr("expr-q-conc", "var-q", {
                    parentId: "expr-impl-conc",
                    position: 1,
                })
            )
            engineB.setConclusionPremise("premise-conc")

            const diff = diffArguments(engineA, engineB)
            expect(diff.roles.conclusion.before).toBe("premise-1")
            expect(diff.roles.conclusion.after).toBe("premise-conc")
        })

        it("detects conclusion change between engines", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const { engine: engineB } = buildSimpleEngine(ARG)

            // Both engines auto-set premise-1 as conclusion; add a second premise to engineB and set it as conclusion
            const { result: pm2 } = engineB.createPremiseWithId("premise-2", {
                title: "Second premise",
            })
            pm2.addExpression(
                makeOpExpr("expr-impl-2", "implies", {
                    parentId: null,
                    position: POSITION_INITIAL,
                })
            )
            pm2.addExpression(
                makeVarExpr("expr-p-2", "var-p", {
                    parentId: "expr-impl-2",
                    position: 0,
                })
            )
            pm2.addExpression(
                makeVarExpr("expr-q-2", "var-q", {
                    parentId: "expr-impl-2",
                    position: 1,
                })
            )
            engineB.setConclusionPremise("premise-2")

            const diff = diffArguments(engineA, engineB)
            expect(diff.roles.conclusion.before).toBe("premise-1")
            expect(diff.roles.conclusion.after).toBe("premise-2")
        })

        it("uses custom comparator extending default", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const { engine: engineB } = buildSimpleEngine(ARG)
            engineB.getPremise("premise-1")!.setExtras({ title: "Updated" })

            const diff = diffArguments(engineA, engineB, {
                comparePremise: (before, after) => {
                    const changes = [...defaultComparePremise(before, after)]
                    const bTitle = (before as Record<string, unknown>).title
                    const aTitle = (after as Record<string, unknown>).title
                    if (bTitle !== aTitle) {
                        changes.push({
                            field: "title",
                            before: bTitle,
                            after: aTitle,
                        })
                    }
                    // Custom: always report a "custom" field
                    changes.push({
                        field: "customField",
                        before: "a",
                        after: "b",
                    })
                    return changes
                },
            })

            expect(diff.premises.modified).toHaveLength(1)
            expect(diff.premises.modified[0].changes).toEqual([
                {
                    field: "title",
                    before: "First premise",
                    after: "Updated",
                },
                { field: "customField", before: "a", after: "b" },
            ])
        })

        it("custom comparator replaces default entirely", () => {
            const { engine: engineA } = buildSimpleEngine(ARG)
            const { engine: engineB } = buildSimpleEngine(ARG)
            engineB.getPremise("premise-1")!.setExtras({ title: "Updated" })

            // Custom comparator that ignores extras changes
            const diff = diffArguments(engineA, engineB, {
                comparePremise: () => [],
            })

            // Premise is not in modified because comparator returned no changes
            // (and no expression changes either since engines are otherwise identical)
            expect(diff.premises.modified).toEqual([])
        })
    })
})

describe("diffArguments — generic type parameters", () => {
    it("accepts and returns extended types", () => {
        type TExtArg = TCoreArgument & { projectId: string }
        const argA: TOptionalChecksum<TExtArg> = {
            id: "a1",
            version: 0,
            projectId: "proj-1",
        }
        const argB: TOptionalChecksum<TExtArg> = {
            id: "a1",
            version: 1,
            projectId: "proj-1",
        }
        const engineA = new ArgumentEngine<TExtArg>(argA, aLib())
        const engineB = new ArgumentEngine<TExtArg>(argB, aLib())

        const diff = diffArguments(engineA, engineB)
        expect(diff.argument.before.projectId).toBe("proj-1")
        expect(diff.argument.after.projectId).toBe("proj-1")
    })
})
