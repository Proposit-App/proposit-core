/**
 * Integration test — hits the real OpenAI API.
 *
 * Requires OPENAI_API_KEY in .env.development (or already in env).
 * Skipped automatically when no key is available.
 */
import fs from "node:fs"
import path from "node:path"
import { describe, it, expect, beforeAll } from "vitest"
import { buildParsingPrompt } from "../../src/lib/parsing/prompt-builder.js"
import {
    BasicsArgumentParser,
    BasicsParsingSchema,
} from "../../src/extensions/basics/index.js"
import { createOpenAiProvider } from "../../src/cli/llm/openai.js"

// ---------------------------------------------------------------------------
// Load API key
// ---------------------------------------------------------------------------

function loadApiKey(): string | undefined {
    // Prefer env var if already set
    if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY

    const envPath = path.resolve(import.meta.dirname, "../../.env.development")
    if (!fs.existsSync(envPath)) return undefined

    const content = fs.readFileSync(envPath, "utf-8")
    for (const line of content.split("\n")) {
        const match = /^OPENAI_API_KEY=(.+)$/.exec(line)
        if (match) return match[1].trim()
    }
    return undefined
}

const apiKey = loadApiKey()

const describeIf = apiKey ? describe : describe.skip

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeIf("parse API integration", () => {
    let provider: ReturnType<typeof createOpenAiProvider>
    let systemPrompt: string

    beforeAll(() => {
        provider = createOpenAiProvider({ apiKey: apiKey! })
        systemPrompt = buildParsingPrompt(BasicsParsingSchema)
    })

    it("parses text with URL sources into url + optional text fields", async () => {
        const inputText = `
Climate change is accelerating according to recent studies.

According to [NASA's climate report](https://climate.nasa.gov/evidence/),
global temperatures have risen significantly over the past century.
This means we need to take action to reduce carbon emissions.

See also: https://www.ipcc.ch/report/ar6/
            `.trim()

        const raw = await provider.complete({
            systemPrompt,
            userMessage: inputText,
            responseSchema: BasicsParsingSchema,
        })

        // Validate against schema
        const parser = new BasicsArgumentParser()
        const response = parser.validate(raw)

        expect(response.argument).not.toBeNull()
        const arg = response.argument!

        // Should have extracted sources with URLs
        expect(arg.sources.length).toBeGreaterThanOrEqual(1)

        for (const source of arg.sources) {
            // Every source must have a url
            expect(source).toHaveProperty("url")
            expect(typeof source.url).toBe("string")
            expect(source.url.length).toBeGreaterThan(0)
        }

        // At least one source should have a text field (the NASA link has anchor text)
        const sourcesWithText = arg.sources.filter(
            (s) =>
                "text" in s && typeof s.text === "string" && s.text.length > 0
        )

        // Build engine to verify full pipeline
        const built = parser.build(response, { strict: false })
        expect(built.engine).toBeDefined()
        expect(built.sourceLibrary.getAll().length).toBeGreaterThanOrEqual(1)

        // Log for manual inspection
        console.log("=== Parsed sources ===")
        for (const source of arg.sources) {
            console.log(
                `  ${source.miniId}: url=${source.url}${source.text ? ` text="${source.text}"` : ""}`
            )
        }
        console.log(
            `Sources with text: ${sourcesWithText.length}/${arg.sources.length}`
        )
        console.log(`Warnings: ${built.warnings.length}`)
        for (const w of built.warnings) {
            console.log(`  [${w.code}] ${w.message}`)
        }
    }, 60_000)

    it("parses text without sources and returns empty sources array", async () => {
        const inputText = `
If it rains, the ground gets wet. It is raining. Therefore, the ground is wet.
            `.trim()

        const raw = await provider.complete({
            systemPrompt,
            userMessage: inputText,
            responseSchema: BasicsParsingSchema,
        })

        const parser = new BasicsArgumentParser()
        const response = parser.validate(raw)

        expect(response.argument).not.toBeNull()
        expect(response.argument!.sources).toEqual([])

        const built = parser.build(response, { strict: false })
        expect(built.sourceLibrary.getAll()).toHaveLength(0)
    }, 60_000)
})
