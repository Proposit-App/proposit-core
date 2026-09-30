import { describe, expect, it } from "vitest"
import { ParsedArgumentResponseSchema } from "../../../src/lib/parsing/schemata"
import { buildParsingPrompt } from "../../../src/lib/parsing/prompt-builder"
import { BasicsParsingSchema } from "../../../src/extensions/basics/schemata"
import { CLAIM_CANONICALIZATION_SYSTEM_PROMPT } from "../../../src/extensions/pipelines/base/stages/claim-canonicalization"

// ---------------------------------------------------------------------------
// Ingestion prompts — anti-attribution clause (no "The author claims…" frame)
// ---------------------------------------------------------------------------
// Regression guards: every in-code prompt that authors user-facing claim
// prose must forbid the attributive reporting wrapper ("The author claims X")
// while keeping the existing third-person, present-tense, declarative voice.
// These are deterministic substring assertions so a later prompt rewrite that
// silently drops the clause fails CI.
describe("Ingestion prompts — anti-attribution clause", () => {
    const ANTI_ATTRIBUTION_ANCHOR =
        "never prepend an author-attributive reporting frame"

    it("CORE_PROMPT (buildParsingPrompt) forbids author-attributive frames in claim prose", () => {
        const prompt = buildParsingPrompt(ParsedArgumentResponseSchema)
        // Still third-person declarative — clause is additive, not a voice switch.
        expect(prompt).toContain("third person")
        expect(prompt).toContain(ANTI_ATTRIBUTION_ANCHOR)
        // Names at least one banned frame so the model has a concrete example.
        expect(prompt).toContain("According to the author")
        // The citation carve-out must survive in the production prompt too:
        // citation claims summarizing an external cited source keep that
        // source attribution — only author-attribution of the argument's
        // own claims is forbidden. (CORE_PROMPT is the shipping path, so a
        // future rewrite that drops this fence must fail CI here.)
        expect(prompt).toContain(
            "Citation claims that summarize what an external"
        )
    })

    it("buildParsingPrompt(BasicsParsingSchema) carries the anti-attribution clause", () => {
        const prompt = buildParsingPrompt(BasicsParsingSchema)
        expect(prompt).toContain(ANTI_ATTRIBUTION_ANCHOR)
    })

    it("CLAIM_CANONICALIZATION_SYSTEM_PROMPT forbids author-attributive frames in titles/bodies", () => {
        expect(CLAIM_CANONICALIZATION_SYSTEM_PROMPT).toContain(
            "third-person, present-tense"
        )
        expect(CLAIM_CANONICALIZATION_SYSTEM_PROMPT).toContain(
            ANTI_ATTRIBUTION_ANCHOR
        )
        // The citation-to-source convention must survive — citation titles
        // legitimately summarize what the *cited source* asserts; that
        // attribution is to the external source, not the argument's author.
        expect(CLAIM_CANONICALIZATION_SYSTEM_PROMPT).toContain(
            "summarizes what the source asserts"
        )
    })
})
