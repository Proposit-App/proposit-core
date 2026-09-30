import { describe, expect, it } from "vitest"
import { resolveApiKey, createLlmProvider } from "../../src/cli/llm"

describe("LLM provider abstraction", () => {
    describe("resolveApiKey", () => {
        it("returns explicit key when provided", () => {
            const key = resolveApiKey("openai", "sk-explicit")
            expect(key).toBe("sk-explicit")
        })

        it("falls back to OPENAI_API_KEY env var", () => {
            const original = process.env.OPENAI_API_KEY
            try {
                process.env.OPENAI_API_KEY = "sk-from-env"
                const key = resolveApiKey("openai")
                expect(key).toBe("sk-from-env")
            } finally {
                if (original === undefined) {
                    delete process.env.OPENAI_API_KEY
                } else {
                    process.env.OPENAI_API_KEY = original
                }
            }
        })

        it("throws when no key is available", () => {
            const original = process.env.OPENAI_API_KEY
            try {
                delete process.env.OPENAI_API_KEY
                expect(() => resolveApiKey("openai")).toThrow(/OPENAI_API_KEY/)
            } finally {
                if (original !== undefined) {
                    process.env.OPENAI_API_KEY = original
                }
            }
        })

        it("throws for unknown provider with no explicit key", () => {
            expect(() => resolveApiKey("unknown")).toThrow(/unknown/)
        })

        it("returns explicit key even for unknown provider", () => {
            const key = resolveApiKey("unknown", "sk-explicit")
            expect(key).toBe("sk-explicit")
        })
    })

    describe("createLlmProvider", () => {
        it("creates an openai provider", () => {
            const provider = createLlmProvider("openai", {
                apiKey: "sk-test",
            })
            expect(provider).toBeDefined()
            expect(typeof provider.respond).toBe("function")
        })

        it("throws on unknown provider name", () => {
            expect(() =>
                createLlmProvider("unknown", { apiKey: "sk-test" })
            ).toThrow(/unknown/i)
        })
    })
})
