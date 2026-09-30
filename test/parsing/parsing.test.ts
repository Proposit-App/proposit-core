import { describe, expect, it } from "vitest"
import { Value } from "typebox/value"
import { isClaimBound, isPremiseBound } from "../../src/lib/schemata"
import {
    ParsedClaimSchema,
    ParsedVariableSchema,
    ParsedPremiseSchema,
    ParsedArgumentResponseSchema,
    buildParsingResponseSchema,
    getParsingResponseSchema,
} from "../../src/lib/parsing/schemata"
import type {
    TParsedClaim,
    TParsedVariable,
    TParsedPremise,
    TParsedArgumentResponse,
} from "../../src/lib/parsing/schemata"
import { buildParsingPrompt } from "../../src/lib/parsing/prompt-builder"
import { BasicsParsingSchema } from "../../src/extensions/basics/schemata"
import { ArgumentParser } from "../../src/lib/parsing/argument-parser"
import Type from "typebox"

// ---------------------------------------------------------------------------
// Parsing — response schemas
// ---------------------------------------------------------------------------
describe("Parsing — response schemas", () => {
    describe("ParsedClaimSchema", () => {
        it("accepts a valid claim", () => {
            const claim: TParsedClaim = {
                miniId: "c1",
                role: "premise",
                type: "normal",
            }
            expect(Value.Check(ParsedClaimSchema, claim)).toBe(true)
        })

        it("accepts additional properties", () => {
            const claim = {
                miniId: "c1",
                role: "conclusion",
                type: "normal",
                citationMiniIds: [],
                customField: "extra",
            }
            expect(Value.Check(ParsedClaimSchema, claim)).toBe(true)
        })

        it("rejects invalid role", () => {
            const claim = {
                miniId: "c1",
                role: "invalid",
                type: "normal",
                citationMiniIds: [],
            }
            expect(Value.Check(ParsedClaimSchema, claim)).toBe(false)
        })
    })

    describe("ParsedVariableSchema", () => {
        it("accepts a valid variable", () => {
            const variable: TParsedVariable = {
                miniId: "v1",
                symbol: "P",
                claimMiniId: "c1",
            }
            expect(Value.Check(ParsedVariableSchema, variable)).toBe(true)
        })
    })

    describe("ParsedPremiseSchema", () => {
        it("accepts a valid premise", () => {
            const premise: TParsedPremise = {
                miniId: "p1",
                formula: "P and Q",
            }
            expect(Value.Check(ParsedPremiseSchema, premise)).toBe(true)
        })
    })

    describe("ParsedArgumentResponseSchema", () => {
        it("accepts a valid response with argument", () => {
            const response: TParsedArgumentResponse = {
                argument: {
                    claims: [
                        {
                            miniId: "c1",
                            role: "premise",
                            type: "normal",
                        },
                        {
                            miniId: "s1",
                            role: "premise",
                            type: "citation",
                        },
                    ],
                    variables: [
                        { miniId: "v1", symbol: "P", claimMiniId: "c1" },
                    ],
                    premises: [{ miniId: "p1", formula: "P" }],
                    conclusionPremiseMiniId: "p1",
                },
                uncategorizedText: null,
                selectionRationale: "Clear argument structure",
                failureText: null,
            }
            expect(Value.Check(ParsedArgumentResponseSchema, response)).toBe(
                true
            )
        })

        it("accepts null argument with failureText", () => {
            const response: TParsedArgumentResponse = {
                argument: null,
                uncategorizedText: "Some text",
                selectionRationale: null,
                failureText: "Could not parse argument",
            }
            expect(Value.Check(ParsedArgumentResponseSchema, response)).toBe(
                true
            )
        })

        it("accepts additional properties on nested schemas", () => {
            const response = {
                argument: {
                    claims: [
                        {
                            miniId: "c1",
                            role: "conclusion",
                            type: "normal",
                            citationMiniIds: [],
                            customClaimField: true,
                        },
                    ],
                    variables: [
                        {
                            miniId: "v1",
                            symbol: "P",
                            claimMiniId: "c1",
                            customVarField: 42,
                        },
                    ],
                    premises: [
                        {
                            miniId: "p1",
                            formula: "P",
                            customPremField: "x",
                        },
                    ],
                    conclusionPremiseMiniId: "p1",
                    customArgField: "extra",
                },
                uncategorizedText: null,
                selectionRationale: null,
                failureText: null,
                customResponseField: "top-level-extra",
            }
            expect(Value.Check(ParsedArgumentResponseSchema, response)).toBe(
                true
            )
        })
    })

    describe("buildParsingResponseSchema", () => {
        it("returns core schema with no options", () => {
            const schema = buildParsingResponseSchema()
            const response = {
                argument: {
                    claims: [
                        {
                            miniId: "c1",
                            role: "premise",
                            type: "normal",
                            citationMiniIds: [],
                        },
                    ],
                    variables: [
                        { miniId: "v1", symbol: "P", claimMiniId: "c1" },
                    ],
                    premises: [{ miniId: "p1", formula: "P" }],
                    conclusionPremiseMiniId: "p1",
                },
                uncategorizedText: null,
                selectionRationale: null,
                failureText: null,
            }
            expect(Value.Check(schema, response)).toBe(true)
        })

        it("merges claim extension fields", () => {
            const schema = buildParsingResponseSchema({
                claimSchema: Type.Object({
                    confidence: Type.Number(),
                }),
            })
            const response = {
                argument: {
                    claims: [
                        {
                            miniId: "c1",
                            role: "premise",
                            type: "normal",
                            citationMiniIds: [],
                            confidence: 0.9,
                        },
                    ],
                    variables: [
                        { miniId: "v1", symbol: "P", claimMiniId: "c1" },
                    ],
                    premises: [{ miniId: "p1", formula: "P" }],
                    conclusionPremiseMiniId: "p1",
                },
                uncategorizedText: null,
                selectionRationale: null,
                failureText: null,
            }
            expect(Value.Check(schema, response)).toBe(true)

            // Should reject when required extension field is missing
            const invalid = {
                argument: {
                    claims: [
                        {
                            miniId: "c1",
                            role: "premise",
                            type: "normal",
                            citationMiniIds: [],
                            // confidence missing
                        },
                    ],
                    variables: [
                        { miniId: "v1", symbol: "P", claimMiniId: "c1" },
                    ],
                    premises: [{ miniId: "p1", formula: "P" }],
                    conclusionPremiseMiniId: "p1",
                },
                uncategorizedText: null,
                selectionRationale: null,
                failureText: null,
            }
            expect(Value.Check(schema, invalid)).toBe(false)
        })

        it("merges parsedArgumentSchema extension fields", () => {
            const schema = buildParsingResponseSchema({
                parsedArgumentSchema: Type.Object({
                    argumentTitle: Type.String(),
                }),
            })
            const response = {
                argument: {
                    claims: [
                        {
                            miniId: "c1",
                            role: "premise",
                            type: "normal",
                            citationMiniIds: [],
                        },
                    ],
                    variables: [
                        { miniId: "v1", symbol: "P", claimMiniId: "c1" },
                    ],
                    premises: [{ miniId: "p1", formula: "P" }],
                    conclusionPremiseMiniId: "p1",
                    argumentTitle: "My argument",
                },
                uncategorizedText: null,
                selectionRationale: null,
                failureText: null,
            }
            expect(Value.Check(schema, response)).toBe(true)
        })

        it("merges multiple extension schemas simultaneously", () => {
            const schema = buildParsingResponseSchema({
                claimSchema: Type.Object({
                    confidence: Type.Number(),
                }),
                premiseSchema: Type.Object({
                    label: Type.String(),
                }),
                variableSchema: Type.Object({
                    description: Type.String(),
                }),
            })
            const response = {
                argument: {
                    claims: [
                        {
                            miniId: "c1",
                            role: "premise",
                            type: "normal",
                            citationMiniIds: ["s1"],
                            confidence: 0.95,
                        },
                        {
                            miniId: "s1",
                            role: "premise",
                            type: "citation",
                            citationMiniIds: [],
                            confidence: 0.5,
                        },
                    ],
                    variables: [
                        {
                            miniId: "v1",
                            symbol: "P",
                            claimMiniId: "c1",
                            description: "Prop P",
                        },
                    ],
                    premises: [
                        {
                            miniId: "p1",
                            formula: "P",
                            label: "First premise",
                        },
                    ],
                    conclusionPremiseMiniId: "p1",
                },
                uncategorizedText: null,
                selectionRationale: null,
                failureText: null,
            }
            expect(Value.Check(schema, response)).toBe(true)
        })
    })

    describe("getParsingResponseSchema", () => {
        it("returns a valid JSON Schema object from core schema", () => {
            const jsonSchema = getParsingResponseSchema()
            expect(jsonSchema).toBeDefined()
            expect(jsonSchema.type).toBe("object")
            const props = jsonSchema.properties as Record<string, unknown>
            expect(props).toBeDefined()
            expect(props.argument).toBeDefined()
            expect(props.uncategorizedText).toBeDefined()
            expect(props.failureText).toBeDefined()
        })

        it("returns JSON Schema from an extended schema", () => {
            const extended = buildParsingResponseSchema({
                claimSchema: Type.Object({
                    confidence: Type.Number(),
                }),
            })
            const jsonSchema = getParsingResponseSchema(extended)
            expect(jsonSchema).toBeDefined()
            expect(jsonSchema.type).toBe("object")
            const props = jsonSchema.properties as Record<string, unknown>
            expect(props).toBeDefined()
            expect(props.argument).toBeDefined()
        })
    })

    describe("Parsing — prompt builder", () => {
        it("includes core instructions with default schema", () => {
            const prompt = buildParsingPrompt(ParsedArgumentResponseSchema)
            expect(prompt).toContain("expert argument analyst")
            expect(prompt).toContain("propositional argument")
            expect(prompt).toContain("uncategorizedText")
            expect(prompt).toContain("selectionRationale")
            expect(prompt).toContain("failureText")
            expect(prompt).toContain("implies")
            expect(prompt).toContain("third person")
        })

        it("includes formula syntax rules", () => {
            const prompt = buildParsingPrompt(ParsedArgumentResponseSchema)
            expect(prompt).toContain("and")
            expect(prompt).toContain("or")
            expect(prompt).toContain("not")
            expect(prompt).toContain("implies")
            expect(prompt).toContain("iff")
            expect(prompt).toContain("parentheses")
        })

        it("includes root-only constraint for implies and iff", () => {
            const prompt = buildParsingPrompt(ParsedArgumentResponseSchema)
            expect(prompt).toMatch(/implies.*root/i)
            expect(prompt).toMatch(/iff.*root/i)
        })

        it("discovers extension fields and generates constraint instructions", () => {
            const extended = buildParsingResponseSchema({
                claimSchema: Type.Object({
                    title: Type.String({
                        maxLength: 50,
                        description: "A short title for the claim",
                    }),
                    body: Type.String({ maxLength: 500 }),
                }),
            })
            const prompt = buildParsingPrompt(extended)
            expect(prompt).toContain("title")
            expect(prompt).toContain("50")
            expect(prompt).toContain("body")
            expect(prompt).toContain("500")
        })

        it("appends customInstructions", () => {
            const prompt = buildParsingPrompt(ParsedArgumentResponseSchema, {
                customInstructions: 'CMV means "change my view"',
            })
            expect(prompt).toContain('CMV means "change my view"')
        })

        it("does not include extension instructions for core-only schema", () => {
            const prompt = buildParsingPrompt(ParsedArgumentResponseSchema)
            expect(prompt).not.toContain("maxLength")
        })

        it("includes miniId prefix conventions", () => {
            const prompt = buildParsingPrompt(ParsedArgumentResponseSchema)
            expect(prompt).toContain("MiniId Conventions")
            expect(prompt).toContain("c1")
            expect(prompt).toContain("v1")
            expect(prompt).toContain("p1")
            // Unified claim prefix — no separate s/a prefixes.
            expect(prompt).not.toContain("s1")
            expect(prompt).not.toContain("a1")
        })

        it("explains support via formulas instead of a separate citation field", () => {
            const prompt = buildParsingPrompt(ParsedArgumentResponseSchema)
            // The old citationMiniIds field has been removed entirely.
            expect(prompt).not.toContain("citationMiniIds")
            // The replacement guidance is the Support via Formulas section.
            expect(prompt).toContain("Support via Formulas")
            expect(prompt).toMatch(
                /antecedent.*implies.*consequent|implies.*supported claim/i
            )
            expect(prompt).toContain("do not list supports as a separate field")
        })
    })

    // -----------------------------------------------------------------------
    // Parsing — ArgumentParser
    // -----------------------------------------------------------------------
    describe("Parsing — ArgumentParser", () => {
        function validResponse(): TParsedArgumentResponse {
            return {
                argument: {
                    claims: [
                        {
                            miniId: "C1",
                            role: "premise",
                            type: "normal",
                        },
                        {
                            miniId: "C2",
                            role: "conclusion",
                            type: "normal",
                        },
                        {
                            miniId: "S1",
                            role: "premise",
                            type: "citation",
                        },
                    ],
                    variables: [
                        { miniId: "V1", symbol: "P", claimMiniId: "C1" },
                        { miniId: "V2", symbol: "Q", claimMiniId: "C2" },
                        { miniId: "V3", symbol: "S", claimMiniId: "S1" },
                    ],
                    premises: [
                        { miniId: "P1", formula: "(P and S) implies Q" },
                        { miniId: "P2", formula: "P" },
                    ],
                    conclusionPremiseMiniId: "P1",
                    derivationBacking: [
                        {
                            derivedClaimMiniId: "C2",
                            supportingClaimMiniIds: ["S1"],
                        },
                    ],
                },
                uncategorizedText: null,
                selectionRationale: null,
                failureText: null,
            }
        }

        describe("validate", () => {
            it("accepts a valid response", () => {
                const parser = new ArgumentParser()
                const result = parser.validate(validResponse())
                expect(result.argument).toBeDefined()
                expect(result.argument!.claims).toHaveLength(3)
            })

            it("accepts null argument with failureText", () => {
                const parser = new ArgumentParser()
                const result = parser.validate({
                    argument: null,
                    uncategorizedText: null,
                    selectionRationale: null,
                    failureText: "Could not parse",
                })
                expect(result.argument).toBeNull()
                expect(result.failureText).toBe("Could not parse")
            })

            it("throws on malformed input", () => {
                const parser = new ArgumentParser()
                expect(() => parser.validate("not an object")).toThrow()
            })

            it("throws on missing required fields", () => {
                const parser = new ArgumentParser()
                expect(() => parser.validate({ argument: {} })).toThrow()
            })
        })

        describe("build", () => {
            it("produces ArgumentEngine and libraries", () => {
                const parser = new ArgumentParser()
                const result = parser.build(validResponse())
                expect(result.engine).toBeDefined()
                expect(result.claimLibrary).toBeDefined()
                expect(result.claimCitationLibrary).toBeDefined()
            })

            it("creates claims in library", () => {
                const parser = new ArgumentParser()
                const result = parser.build(validResponse())
                const allClaims = result.claimLibrary.getAll()
                // 2 normal claims (C1, C2) + 1 citation claim (S1)
                expect(allClaims).toHaveLength(3)
            })

            it("creates variables bound to claims", () => {
                const parser = new ArgumentParser()
                const result = parser.build(validResponse())
                const snap = result.engine.snapshot()
                const vars = snap.variables.variables
                const claimBoundVars = vars.filter((v) => isClaimBound(v))
                const premiseBoundVars = vars.filter((v) => isPremiseBound(v))
                expect(claimBoundVars).toHaveLength(3)
                expect(premiseBoundVars).toHaveLength(2) // auto-created for each premise
                const claimSymbols = claimBoundVars.map((v) => v.symbol).sort()
                expect(claimSymbols).toEqual(["P", "Q", "S"])
            })

            it("creates premises with expression trees", () => {
                const parser = new ArgumentParser()
                const result = parser.build(validResponse())
                const snap = result.engine.snapshot()
                expect(snap.premises).toHaveLength(2)
                // One premise "(P and S) implies Q" has more than 1 expression
                const impliesPremise = snap.premises.find(
                    (p) => p.expressions.expressions.length > 1
                )!
                expect(impliesPremise).toBeDefined()
                // The other premise "P" has 1 expression (variable)
                const singlePremise = snap.premises.find(
                    (p) => p.expressions.expressions.length === 1
                )!
                expect(singlePremise).toBeDefined()
                expect(singlePremise.expressions.expressions[0].type).toBe(
                    "variable"
                )
            })

            it("sets conclusion role", () => {
                const parser = new ArgumentParser()
                const result = parser.build(validResponse())
                const snap = result.engine.snapshot()
                expect(snap.conclusionPremiseId).toBeDefined()
            })

            it("wires claim-source associations", () => {
                const parser = new ArgumentParser()
                const result = parser.build(validResponse())
                const assocs = result.claimCitationLibrary.getAll()
                // Premise "(P and S) implies Q" puts citation-bound S in the
                // antecedent and normal-bound Q in the consequent, yielding
                // a single Q → S citation edge.
                expect(assocs).toHaveLength(1)
            })

            it("shares variables across premises", () => {
                const parser = new ArgumentParser()
                // Both premises reference P: "P -> Q" and "P"
                const result = parser.build(validResponse())
                const snap = result.engine.snapshot()
                // Find variable P
                const varP = snap.variables.variables.find(
                    (v) => v.symbol === "P"
                )!
                // Both premises should reference variable P
                const premisesWithP = snap.premises.filter((p) =>
                    p.expressions.expressions.some(
                        (e) => e.type === "variable" && e.variableId === varP.id
                    )
                )
                expect(premisesWithP).toHaveLength(2)
            })

            it("throws on null argument", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                resp.argument = null
                expect(() => parser.build(resp)).toThrow(/argument is null/i)
            })

            it("throws on formula referencing undeclared variable miniId", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                // Add a premise that references an undeclared variable symbol
                resp.argument!.premises.push({
                    miniId: "P3",
                    formula: "V99",
                })
                expect(() => parser.build(resp)).toThrow(/V99/)
            })

            it("throws on nested implies", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                resp.argument!.premises = [
                    {
                        miniId: "P1",
                        formula: "(P implies Q) and P",
                    },
                ]
                expect(() => parser.build(resp)).toThrow(/implication/i)
            })

            it("auto-normalizes nested operators by inserting formula buffers", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                // "(P and Q) or P" creates or(and(P,Q), P) — and is child of or
                // autoNormalize should insert a formula buffer between or and and
                resp.argument!.premises = [
                    { miniId: "P1", formula: "(P and Q) or P" },
                ]
                resp.argument!.conclusionPremiseMiniId = "P1"
                const result = parser.build(resp)
                const snap = result.engine.snapshot()
                expect(snap.premises).toHaveLength(1)
                const exprs = snap.premises[0].expressions.expressions
                // Should have: or, formula(buffer), and, var(P), var(Q), var(P)
                // = 6 expressions total
                const formulaExprs = exprs.filter((e) => e.type === "formula")
                expect(formulaExprs.length).toBeGreaterThanOrEqual(1)
                const orExpr = exprs.find(
                    (e) => e.type === "operator" && e.operator === "or"
                )
                expect(orExpr).toBeDefined()
                const andExpr = exprs.find(
                    (e) => e.type === "operator" && e.operator === "and"
                )
                expect(andExpr).toBeDefined()
                // The and operator should NOT be a direct child of or
                // (a formula buffer should sit between them)
                expect(andExpr!.parentId).not.toBe(orExpr!.id)
            })

            it("throws on variable referencing undeclared claim miniId", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                resp.argument!.variables = [
                    { miniId: "V1", symbol: "P", claimMiniId: "C99" },
                ]
                resp.argument!.premises = [{ miniId: "P1", formula: "P" }]
                resp.argument!.conclusionPremiseMiniId = "P1"
                expect(() => parser.build(resp)).toThrow(/C99/)
            })

            it("throws on unresolvable conclusionPremiseMiniId", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                resp.argument!.conclusionPremiseMiniId = "P99"
                expect(() => parser.build(resp)).toThrow(/P99/)
            })

            it("throws on invalid formula syntax", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                resp.argument!.premises = [{ miniId: "P1", formula: "P &&& Q" }]
                // Error message should mention the premise miniId
                expect(() => parser.build(resp)).toThrow(/P1/)
            })

            it("includes empty warnings array on successful strict build", () => {
                const parser = new ArgumentParser()
                const result = parser.build(validResponse())
                expect(result.warnings).toEqual([])
            })

            it("ignores citationMiniIds (deprecated field; edges now come from formulas)", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                // The old citation-walking pass would have thrown here; the
                // new formula-inference pass ignores citationMiniIds entirely.
                // Cast since citationMiniIds is no longer in the schema, but
                // additionalProperties: true lets it through at runtime.
                ;(
                    resp.argument!.claims[0] as TParsedClaim & {
                        citationMiniIds: string[]
                    }
                ).citationMiniIds = ["BOGUS"]
                expect(() => parser.build(resp)).not.toThrow()
            })
        })

        describe("build lenient mode", () => {
            function validResponse(): TParsedArgumentResponse {
                return {
                    argument: {
                        claims: [
                            {
                                miniId: "C1",
                                role: "premise",
                                type: "normal",
                            },
                            {
                                miniId: "C2",
                                role: "conclusion",
                                type: "normal",
                            },
                        ],
                        variables: [
                            { miniId: "V1", symbol: "P", claimMiniId: "C1" },
                            { miniId: "V2", symbol: "Q", claimMiniId: "C2" },
                        ],
                        premises: [
                            { miniId: "P1", formula: "P implies Q" },
                            { miniId: "P2", formula: "P" },
                        ],
                        conclusionPremiseMiniId: "P1",
                    },
                    uncategorizedText: null,
                    selectionRationale: null,
                    failureText: null,
                }
            }

            it("skips premise with malformed formula and emits FORMULA_PARSE_ERROR", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                resp.argument!.premises.push({
                    miniId: "P3",
                    formula: "P &&& Q",
                })
                const result = parser.build(resp, { strict: false })
                // P1 and P2 survive, P3 skipped
                const snap = result.engine.snapshot()
                expect(snap.premises).toHaveLength(2)
                expect(result.warnings).toHaveLength(1)
                expect(result.warnings[0].code).toBe("FORMULA_PARSE_ERROR")
                expect(result.warnings[0].context.premiseMiniId).toBe("P3")
            })

            it("skips premise with nested implies and emits FORMULA_STRUCTURE_ERROR", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                resp.argument!.premises.push({
                    miniId: "P3",
                    formula: "(P implies Q) and P",
                })
                const result = parser.build(resp, { strict: false })
                const snap = result.engine.snapshot()
                expect(snap.premises).toHaveLength(2)
                expect(result.warnings).toHaveLength(1)
                expect(result.warnings[0].code).toBe("FORMULA_STRUCTURE_ERROR")
                expect(result.warnings[0].context.premiseMiniId).toBe("P3")
            })

            it("ignores citationMiniIds (no longer wired into the parser) even in lenient mode", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                // Add a citation-typed claim S1 and a variable bound to it,
                // then put S in the antecedent of an implies premise so the
                // new formula-inference pass produces a single edge.
                // Cast the claim literal: citationMiniIds is no longer in the
                // schema, but additionalProperties: true lets it through.
                resp.argument!.claims.push({
                    miniId: "S1",
                    role: "premise",
                    type: "citation",
                    citationMiniIds: [],
                } as TParsedClaim)
                resp.argument!.variables.push({
                    miniId: "V3",
                    symbol: "S",
                    claimMiniId: "S1",
                })
                resp.argument!.premises[0] = {
                    miniId: "P1",
                    formula: "(P and S) implies Q",
                }
                // citationMiniIds is now ignored — bogus values do not warn.
                ;(
                    resp.argument!.claims[0] as TParsedClaim & {
                        citationMiniIds: string[]
                    }
                ).citationMiniIds = ["S1", "BOGUS"]
                resp.argument!.derivationBacking = [
                    {
                        derivedClaimMiniId: "C2",
                        supportingClaimMiniIds: ["S1"],
                    },
                ]
                const result = parser.build(resp, { strict: false })
                // 2 normal claims + 1 citation claim; one citation edge from
                // the formula's antecedent.
                expect(result.claimLibrary.getAll()).toHaveLength(3)
                const cits = result.claimCitationLibrary.getAll()
                expect(cits).toHaveLength(1)
                expect(result.warnings).toEqual([])
            })

            it("skips variable with bad claim ref and emits UNRESOLVED_CLAIM_MINIID", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                // V2 references nonexistent claim C99
                resp.argument!.variables[1] = {
                    miniId: "V2",
                    symbol: "Q",
                    claimMiniId: "C99",
                }
                // Remove premise P1 that uses Q, keep P2 that uses only P
                resp.argument!.premises = [{ miniId: "P2", formula: "P" }]
                resp.argument!.conclusionPremiseMiniId = "P2"
                const result = parser.build(resp, { strict: false })
                const snap = result.engine.snapshot()
                // P survives as a claim-bound variable; 1 auto premise-bound var from 1 premise
                const claimBound = snap.variables.variables.filter((v) =>
                    isClaimBound(v)
                )
                expect(claimBound).toHaveLength(1)
                expect(claimBound[0].symbol).toBe("P")
                expect(snap.variables.variables).toHaveLength(2)
                expect(result.warnings).toHaveLength(1)
                expect(result.warnings[0].code).toBe("UNRESOLVED_CLAIM_MINIID")
                expect(result.warnings[0].context.variableMiniId).toBe("V2")
                expect(result.warnings[0].context.claimMiniId).toBe("C99")
            })

            it("skips premise with undeclared variable symbol and emits UNDECLARED_VARIABLE_SYMBOL", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                resp.argument!.premises.push({ miniId: "P3", formula: "X" })
                const result = parser.build(resp, { strict: false })
                const snap = result.engine.snapshot()
                expect(snap.premises).toHaveLength(2)
                expect(result.warnings).toHaveLength(1)
                expect(result.warnings[0].code).toBe(
                    "UNDECLARED_VARIABLE_SYMBOL"
                )
                expect(result.warnings[0].context.premiseMiniId).toBe("P3")
                expect(result.warnings[0].context.symbol).toBe("X")
            })

            it("skips conclusion assignment and emits UNRESOLVED_CONCLUSION_MINIID", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                resp.argument!.conclusionPremiseMiniId = "P99"
                const result = parser.build(resp, { strict: false })
                const snap = result.engine.snapshot()
                // Premises still created, but conclusion was auto-assigned to first premise
                expect(snap.premises).toHaveLength(2)
                expect(snap.conclusionPremiseId).toBeDefined() // auto-conclusion on first added premise
                expect(result.warnings).toHaveLength(1)
                expect(result.warnings[0].code).toBe(
                    "UNRESOLVED_CONCLUSION_MINIID"
                )
                expect(result.warnings[0].context.conclusionPremiseMiniId).toBe(
                    "P99"
                )
            })

            it("cascade: skipped variable causes premise skip with both warnings", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                // Make V2 (symbol Q) reference a bad claim
                resp.argument!.variables[1] = {
                    miniId: "V2",
                    symbol: "Q",
                    claimMiniId: "C99",
                }
                // P1 is "P implies Q" — Q is now undeclared, so P1 gets skipped
                // P2 is "P" — still valid; set it as conclusion so we don't also trigger UNRESOLVED_CONCLUSION_MINIID
                resp.argument!.conclusionPremiseMiniId = "P2"
                const result = parser.build(resp, { strict: false })
                const snap = result.engine.snapshot()
                expect(snap.premises).toHaveLength(1)
                const claimBound = snap.variables.variables.filter((v) =>
                    isClaimBound(v)
                )
                expect(claimBound).toHaveLength(1)
                expect(claimBound[0].symbol).toBe("P")
                expect(snap.variables.variables).toHaveLength(2) // 1 claim-bound + 1 auto
                expect(result.warnings).toHaveLength(2)
                const codes = result.warnings.map((w) => w.code)
                expect(codes).toContain("UNRESOLVED_CLAIM_MINIID")
                expect(codes).toContain("UNDECLARED_VARIABLE_SYMBOL")
            })

            it("returns identical result with empty warnings when lenient and no issues", () => {
                const parser = new ArgumentParser()
                const resp = validResponse()
                const strictResult = parser.build(resp)
                const lenientResult = parser.build(resp, { strict: false })
                // Both should produce same structure (different UUIDs, so compare shape)
                const strictSnap = strictResult.engine.snapshot()
                const lenientSnap = lenientResult.engine.snapshot()
                expect(lenientSnap.premises).toHaveLength(
                    strictSnap.premises.length
                )
                expect(lenientSnap.variables.variables).toHaveLength(
                    strictSnap.variables.variables.length
                )
                expect(lenientResult.warnings).toEqual([])
            })

            it("strict mode still throws on all error types", () => {
                const parser = new ArgumentParser()

                // FORMULA_PARSE_ERROR
                const r1 = validResponse()
                r1.argument!.premises = [{ miniId: "P1", formula: "P &&& Q" }]
                expect(() => parser.build(r1)).toThrow(/P1/)

                // FORMULA_STRUCTURE_ERROR
                const r2 = validResponse()
                r2.argument!.premises = [
                    { miniId: "P1", formula: "(P implies Q) and P" },
                ]
                expect(() => parser.build(r2)).toThrow(/implication/i)

                // UNDECLARED_VARIABLE_SYMBOL
                const r3 = validResponse()
                r3.argument!.premises.push({ miniId: "P3", formula: "X" })
                expect(() => parser.build(r3)).toThrow(/X/)

                // UNRESOLVED_CLAIM_MINIID
                const r4 = validResponse()
                r4.argument!.variables = [
                    { miniId: "V1", symbol: "P", claimMiniId: "C99" },
                ]
                r4.argument!.premises = [{ miniId: "P1", formula: "P" }]
                r4.argument!.conclusionPremiseMiniId = "P1"
                expect(() => parser.build(r4)).toThrow(/C99/)

                // UNRESOLVED_CONCLUSION_MINIID
                const r6 = validResponse()
                r6.argument!.conclusionPremiseMiniId = "P99"
                expect(() => parser.build(r6)).toThrow(/P99/)
            })
        })

        describe("subclass hooks", () => {
            it("mapClaim reflects custom fields on built claims", () => {
                class Custom extends ArgumentParser {
                    protected override mapClaim(parsed: {
                        miniId: string
                    }): Record<string, unknown> {
                        return { title: `claim-${parsed.miniId}` }
                    }
                }
                const parser = new Custom()
                const result = parser.build(validResponse())
                const claims = result.claimLibrary.getAll()
                expect(
                    claims.every(
                        (c) =>
                            (c as Record<string, unknown>).title !== undefined
                    )
                ).toBe(true)
            })

            it("mapPremise reflects on premise snapshot", () => {
                class Custom extends ArgumentParser {
                    protected override mapPremise(parsed: {
                        miniId: string
                    }): Record<string, unknown> {
                        return { label: `p-${parsed.miniId}` }
                    }
                }
                const parser = new Custom()
                const result = parser.build(validResponse())
                const snap = result.engine.snapshot()
                for (const p of snap.premises) {
                    expect(
                        (p.premise as Record<string, unknown>).label
                    ).toBeDefined()
                }
            })

            it("mapVariable reflects on variable snapshot", () => {
                class Custom extends ArgumentParser {
                    protected override mapVariable(parsed: {
                        miniId: string
                    }): Record<string, unknown> {
                        return { tag: `var-${parsed.miniId}` }
                    }
                }
                const parser = new Custom()
                const result = parser.build(validResponse())
                const snap = result.engine.snapshot()
                // Only claim-bound variables go through mapVariable; auto-created premise-bound ones do not
                const claimBound = snap.variables.variables.filter((v) =>
                    isClaimBound(v)
                )
                for (const v of claimBound) {
                    expect((v as Record<string, unknown>).tag).toBeDefined()
                }
                expect(claimBound.length).toBeGreaterThan(0)
            })

            it("mapArgument reflects on argument snapshot", () => {
                class Custom extends ArgumentParser {
                    protected override mapArgument(): Record<string, unknown> {
                        return { title: "My argument" }
                    }
                }
                const parser = new Custom()
                const result = parser.build(validResponse())
                const snap = result.engine.snapshot()
                expect((snap.argument as Record<string, unknown>).title).toBe(
                    "My argument"
                )
            })

            it("mapClaimCitation reflects on citation entities", () => {
                class Custom extends ArgumentParser {
                    protected override mapClaimCitation(
                        dependentParsed: TParsedClaim,
                        _supportingParsed: TParsedClaim,
                        dependentClaimId: string,
                        _supportingClaimId: string
                    ): Record<string, unknown> {
                        return {
                            link: `${dependentParsed.miniId}-${dependentClaimId}`,
                        }
                    }
                }
                const parser = new Custom()
                const result = parser.build(validResponse())
                const cits = result.claimCitationLibrary.getAll()
                expect(cits).toHaveLength(1)
                const link = (cits[0] as Record<string, unknown>).link as string
                // Link format is "claimMiniId-realDependentClaimUUID". The
                // dependent claim is the consequent of the implies premise
                // — C2 in this fixture.
                expect(link).toMatch(/^C2-/)
            })
        })
    })
})

// ---------------------------------------------------------------------------
// generateId injection — ArgumentParser
// ---------------------------------------------------------------------------

describe("generateId injection — ArgumentParser", () => {
    it("uses injected generateId for all entity IDs", () => {
        let counter = 0
        const generateId = () => `parser-id-${++counter}`

        const parser = new ArgumentParser()

        const response: TParsedArgumentResponse = {
            argument: {
                claims: [
                    {
                        miniId: "C1",
                        role: "premise",
                        type: "normal",
                    },
                ],
                variables: [
                    {
                        miniId: "V1",
                        symbol: "P",
                        claimMiniId: "C1",
                    },
                ],
                premises: [
                    {
                        miniId: "P1",
                        formula: "P",
                    },
                ],
                conclusionPremiseMiniId: "P1",
            },
            uncategorizedText: null,
            selectionRationale: null,
            failureText: null,
        }

        const result = parser.build(response, { generateId })

        // Argument ID
        expect(result.engine.getArgument().id).toMatch(/^parser-id-/)

        // Variable IDs (claim-bound)
        const vars = result.engine.getVariables()
        expect(vars.length).toBeGreaterThanOrEqual(1)
        const claimBoundVars = vars.filter((v) => "claimId" in v)
        expect(claimBoundVars.length).toBe(1)
        expect(claimBoundVars[0].id).toMatch(/^parser-id-/)

        // Claim IDs
        const claims = result.claimLibrary.getAll()
        expect(claims.length).toBe(1)
        expect(claims[0].id).toMatch(/^parser-id-/)

        // Expression IDs
        const premises = result.engine.listPremises()
        expect(premises.length).toBe(1)
        const exprs = premises[0].getExpressions()
        for (const expr of exprs) {
            expect(expr.id).toMatch(/^parser-id-/)
        }
    })
})

// The basics parse (CORE_PROMPT via buildParsingPrompt) must never refuse a
// half-baked argument: a lone conclusion, a one-sided passage, or any input
// with at least one proposition yields a best-effort structured argument.
// `argument: null` / `failureText` is reserved for input with no extractable
// proposition at all. The behavioral cases (conclusion-only → non-null) are
// LLM-dependent and exercised by consumer/live suites; these are deterministic
// substring assertions so a later prompt rewrite that silently re-introduces
// refusal fails CI.
describe("Basics parse — best-effort, never refuse half-baked", () => {
    const BEST_EFFORT_ANCHOR = "never refuse a half-baked argument"

    it("CORE_PROMPT instructs best-effort extraction over refusal", () => {
        const prompt = buildParsingPrompt(ParsedArgumentResponseSchema)
        expect(prompt).toContain("Best-Effort Extraction")
        expect(prompt).toContain(BEST_EFFORT_ANCHOR)
        // A lone conclusion must still produce a non-null argument.
        expect(prompt).toContain("A lone conclusion with no support")
        // Incompleteness is explicitly NOT a refusal trigger.
        expect(prompt).toMatch(/Do NOT set `argument` to null[\s\S]*incomplete/)
    })

    it("CORE_PROMPT reserves null/failureText for no extractable proposition", () => {
        const prompt = buildParsingPrompt(ParsedArgumentResponseSchema)
        expect(prompt).toContain("no extractable proposition at all")
        // failureText is gated on argument being null, not on incompleteness.
        expect(prompt).toMatch(
            /failureText\*\*: Set ONLY when `argument` is null/
        )
    })

    it("buildParsingPrompt(BasicsParsingSchema) carries the best-effort clause", () => {
        const prompt = buildParsingPrompt(BasicsParsingSchema)
        expect(prompt).toContain(BEST_EFFORT_ANCHOR)
        expect(prompt).toContain("no extractable proposition at all")
    })
})
