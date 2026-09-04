/**
 * Integration test — hits the real OpenAI API, and costs tokens.
 *
 * Opt-in, on the same two conditions as the other live suites:
 * `RUN_LIVE_LLM_TESTS=1` AND an `OPENAI_API_KEY` (env, or
 * `.env.development`). CI sets neither.
 *
 * Gating on the key alone is the wrong question — it bills every developer who
 * merely has one exported, on every `pnpm run test`, and turns an unreachable
 * host into a failing test run rather than a skipped suite.
 */
import fs from "node:fs"
import path from "node:path"
import { describe, it, expect, beforeAll } from "vitest"
import { buildParsingPrompt } from "../../src/lib/parsing/prompt-builder.js"
import {
    BasicsArgumentParser,
    BasicsParsingSchema,
} from "../../src/extensions/basics/index.js"
import { createOpenAiResponsesProvider } from "../../src/extensions/openai/index.js"

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
const optInEnabled = process.env.RUN_LIVE_LLM_TESTS === "1"

const describeIf = optInEnabled && apiKey ? describe : describe.skip

if (optInEnabled && !apiKey) {
    console.warn(
        "[parse-api] RUN_LIVE_LLM_TESTS=1 but OPENAI_API_KEY is not set — skipping the live parse suite."
    )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const DEFAULT_PARSE_MODEL = "gpt-5.4"

describeIf("parse API integration", () => {
    let provider: ReturnType<typeof createOpenAiResponsesProvider>
    let systemPrompt: string

    beforeAll(() => {
        provider = createOpenAiResponsesProvider({ apiKey: apiKey! })
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

        const llmResponse = await provider.respond({
            model: DEFAULT_PARSE_MODEL,
            systemPrompt,
            userMessage: inputText,
            outputSchema: BasicsParsingSchema,
        })
        const raw = llmResponse.output as Record<string, unknown>

        // Validate against schema
        const parser = new BasicsArgumentParser()
        const parsed = parser.validate(raw)

        expect(parsed.argument).not.toBeNull()
        const arg = parsed.argument!

        // Should have extracted at least one citation-typed claim
        const citationClaims = arg.claims.filter((c) => c.type === "citation")
        expect(citationClaims.length).toBeGreaterThanOrEqual(1)

        // Build engine to verify full pipeline
        const built = parser.build(parsed, { strict: false })
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

        const llmResponse = await provider.respond({
            model: DEFAULT_PARSE_MODEL,
            systemPrompt,
            userMessage: inputText,
            outputSchema: BasicsParsingSchema,
        })
        const raw = llmResponse.output as Record<string, unknown>

        const parser = new BasicsArgumentParser()
        const parsed = parser.validate(raw)

        expect(parsed.argument).not.toBeNull()
        const citationClaims = parsed.argument!.claims.filter(
            (c) => c.type === "citation"
        )
        expect(citationClaims).toEqual([])

        const built = parser.build(parsed, { strict: false })
        const builtCitationClaims = built.claimLibrary
            .getAll()
            .filter((c) => (c as Record<string, unknown>).type === "citation")
        expect(builtCitationClaims).toHaveLength(0)
    }, 60_000)
})
