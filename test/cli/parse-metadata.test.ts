import { describe, expect, it } from "vitest"
import type { TParsedArgumentResponse } from "../../src/lib/parsing/schemata"
import { ArgumentParser } from "../../src/lib/parsing/argument-parser"

describe("CliArgumentParser metadata injection", () => {
    class TestCliParser extends ArgumentParser {
        private readonly title: string
        private readonly description: string

        constructor(title: string, description: string) {
            super()
            this.title = title
            this.description = description
        }

        protected override mapArgument(): Record<string, unknown> {
            return {
                title: this.title,
                description: this.description,
                createdAt: new Date("2026-01-01T00:00:00Z"),
                published: false,
            }
        }
    }

    function validResponse(): TParsedArgumentResponse {
        return {
            argument: {
                claims: [
                    {
                        miniId: "C1",
                        role: "premise" as const,
                        type: "normal" as const,
                    },
                ],
                variables: [{ miniId: "V1", symbol: "A", claimMiniId: "C1" }],
                premises: [{ miniId: "P1", formula: "A" }],
                conclusionPremiseMiniId: "P1",
            },
            uncategorizedText: null,
            selectionRationale: null,
            failureText: null,
        }
    }

    it("injects title and description into the built argument", () => {
        const parser = new TestCliParser("My Title", "My Desc")
        const { engine } = parser.build(validResponse())
        const arg = engine.getArgument() as Record<string, unknown>
        expect(arg.title).toBe("My Title")
        expect(arg.description).toBe("My Desc")
        expect(arg.published).toBe(false)
        expect(arg.createdAt).toEqual(new Date("2026-01-01T00:00:00Z"))
    })

    it("uses default title when not specified", () => {
        const parser = new TestCliParser("Parsed argument", "")
        const { engine } = parser.build(validResponse())
        const arg = engine.getArgument() as Record<string, unknown>
        expect(arg.title).toBe("Parsed argument")
        expect(arg.description).toBe("")
    })
})
