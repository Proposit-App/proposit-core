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

    it("parses text with URL references into citation-typed claims", async () => {
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

        // Should have extracted at least one citation-typed claim
        const citationClaims = arg.claims.filter((c) => c.type === "citation")
        expect(citationClaims.length).toBeGreaterThanOrEqual(1)

        // Build engine to verify full pipeline
        const built = parser.build(response, { strict: false })
        expect(built.engine).toBeDefined()
        const allClaims = built.claimLibrary.getAll()
        const builtCitationClaims = allClaims.filter(
            (c) => (c as Record<string, unknown>).type === "citation"
        )
        expect(builtCitationClaims.length).toBeGreaterThanOrEqual(1)

        // Log for manual inspection
        console.log("=== Parsed claims ===")
        for (const claim of arg.claims) {
            const extras = claim as Record<string, unknown>
            console.log(
                `  ${claim.miniId} [${claim.type}]: title="${
                    typeof extras.title === "string" ? extras.title : ""
                }"`
            )
        }
        console.log(
            `Citation claims: ${citationClaims.length}/${arg.claims.length}`
        )
        console.log(`Warnings: ${built.warnings.length}`)
        for (const w of built.warnings) {
            console.log(`  [${w.code}] ${w.message}`)
        }
    }, 60_000)

    it("parses text without citations and returns no citation-typed claims", async () => {
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
        const citationClaims = response.argument!.claims.filter(
            (c) => c.type === "citation"
        )
        expect(citationClaims).toEqual([])

        const built = parser.build(response, { strict: false })
        const builtCitationClaims = built.claimLibrary
            .getAll()
            .filter((c) => (c as Record<string, unknown>).type === "citation")
        expect(builtCitationClaims).toHaveLength(0)
    }, 60_000)
})
