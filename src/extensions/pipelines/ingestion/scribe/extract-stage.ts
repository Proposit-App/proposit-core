// scribe stage 1 — `extract`: one cheap LLM call that produces the
// canonical claim set (the same per-extension canonicalization shape
// scholar's `claim-canonicalization` stage emits), collapsing scholar's
// segmentation, claim-mention, citation-source, axiom-indicator,
// canonicalization, and type-classification stages.
//
// Because a stage writes exactly one output slot, `extract` is paired
// with two deterministic adapter stages that republish its parts under
// the canonicalization and classification slots scholar's deterministic
// backend + `finalizeResponseV2` read.

import { llmStage } from "../../../../lib/pipelines/stage-helpers.js"
import { deterministicStage } from "../../../../lib/pipelines/stage-helpers.js"
import type { TStage, TStageContext } from "../../../../lib/pipelines/types.js"
import {
    STAGE_IDS,
    buildResponseSchema,
    ClaimTypeClassificationOutputSchema,
    type TClaimCanonicalizationOutput,
    type TClaimTypeClassificationOutput,
} from "../../base/stages/index.js"
import type {
    TIngestionExtension,
    TIngestionInput,
    TLlmStageOptionsOverride,
} from "../../base/types.js"

export const EXTRACT_MODEL = "gpt-5.4-mini"

/** Internal default knobs for scribe's `extract` stage. */
export const EXTRACT_STAGE_DEFAULTS: TLlmStageOptionsOverride = {
    model: EXTRACT_MODEL,
}

export const EXTRACT_SYSTEM_PROMPT = `You read a raw argument and emit its canonical claim set in one pass.

For each distinct proposition the author makes, emit one canonical claim. Two phrasings of the same proposition merge into a single claim.

Each canonical claim carries:
- \`miniId\` — assign in order: c1, c2, c3, ...
- \`mentionIds\` — leave as a single synthetic id per claim (e.g. ["c1-m"]); scribe does not track sub-claim mentions.
- \`type\` — "normal" (a primary proposition), "citation" (content is "the cited source asserts X"; populate \`url\` + \`title\`), or "axiomatic" (invoked as self-evident; populate \`axiom\`).
- \`suggestedSymbol\` — a short PascalCase-or-snake_case identifier (letters/digits/underscores, starts with a letter or underscore, under 32 chars). Avoid single letters and generic names.
- the extension fields your output schema requires (title, body, url, axiom — whichever apply to the claim's type).
- \`mentionToClaim\` — one \`{ "mentionId": "...", "claimMiniId": "..." }\` entry per synthetic mention id you used.

Style:
- Third-person, present-tense, active voice.
- State the proposition itself — never "The author claims that ...". For a citation claim, the title summarizes what the source asserts.

Output ONLY the schema-shaped object. No prose.`

function buildExtractPrompt(ctx: TStageContext): {
    system: string
    user: string
} {
    const input = ctx.input as TIngestionInput
    const system = `<!-- stage-id: ${STAGE_IDS.extract} -->\n${EXTRACT_SYSTEM_PROMPT}`
    const user = `Input text:\n\n${input.text}\n\nProduce the canonicalClaims + mentionToClaim object.`
    return { system, user }
}

/**
 * Build scribe's `extract` LLM stage. Its `outputSchema` is the
 * per-extension canonicalization schema, so the cheap model is asked
 * for the same extension-shaped claim records (title/body/url/axiom)
 * scholar's canonicalizer produces — without which finalize would
 * assemble empty claims.
 */
export function createExtractStage(
    extension: TIngestionExtension,
    options?: TLlmStageOptionsOverride
): TStage<TClaimCanonicalizationOutput> {
    return llmStage<TClaimCanonicalizationOutput>({
        id: STAGE_IDS.extract,
        dependsOn: [],
        outputSchema: buildResponseSchema(extension),
        model: options?.model ?? EXTRACT_MODEL,
        maxOutputTokens: options?.maxOutputTokens,
        reasoningEffort: options?.reasoningEffort,
        retry: options?.retry,
        buildPrompt: buildExtractPrompt,
    })
}

/**
 * Adapter — republish `extract`'s canonical claims under the
 * canonicalization slot scholar's deterministic stages + finalize read.
 * `extract` already emits the canonicalization shape, so this is a
 * pass-through (with a defensive empty default). Built per-extension
 * because the canonicalization slot's schema carries the extension's
 * claim fields.
 */
export function createExtractCanonicalizationAdapterStage(
    extension: TIngestionExtension
): TStage<TClaimCanonicalizationOutput> {
    return deterministicStage<TClaimCanonicalizationOutput>({
        id: STAGE_IDS.claimCanonicalization,
        dependsOn: [STAGE_IDS.extract],
        outputSchema: buildResponseSchema(extension),
        fn: (ctx) =>
            ctx.get<TClaimCanonicalizationOutput>(STAGE_IDS.extract) ?? {
                canonicalClaims: [],
                mentionToClaim: [],
            },
    })
}

/**
 * Adapter — derive the classification slot from `extract`'s claim
 * records: each canonical claim already carries its `type`, so the
 * classification entry is `{ miniId, type, sourceString }`.
 * `sourceString` is the claim's `url` when present (citation claims),
 * else null — mirroring what scholar's classification stage records.
 */
export const extractClassificationAdapterStage: TStage<TClaimTypeClassificationOutput> =
    deterministicStage<TClaimTypeClassificationOutput>({
        id: STAGE_IDS.claimTypeClassification,
        dependsOn: [STAGE_IDS.extract],
        outputSchema: ClaimTypeClassificationOutputSchema,
        fn: (ctx) => {
            const canon = ctx.get<TClaimCanonicalizationOutput>(
                STAGE_IDS.extract
            )
            const claims = canon?.canonicalClaims ?? []
            return {
                classifications: claims.map((c) => {
                    const url = (c as Record<string, unknown>).url
                    const sourceString =
                        typeof url === "string" && url.length > 0 ? url : null
                    return { miniId: c.miniId, type: c.type, sourceString }
                }),
            }
        },
    })
