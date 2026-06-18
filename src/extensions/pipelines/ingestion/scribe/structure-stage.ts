// scribe stage 2 — `structure`: one cheap LLM call that produces the
// support relation graph + a confidence-ranked list of conclusion
// candidates, collapsing scholar's relation-extraction and
// conclusion-selection LLM stages. Paired with two deterministic
// adapters that republish the relation-extraction and
// conclusion-selection slots scholar's backend + finalize read.
//
// The conclusion adapter reproduces scholar's conclusion-selection
// outer-run resolution: pick the first candidate that is a normal
// claim, else the deterministic relation-graph fallback, else null +
// the `NO_SINGLE_CONCLUSION` failure — so the conclusion slot carries
// the resolved `conclusionMiniId` that finalize + formula-compilation
// read, not the raw model candidates.

import { llmStage } from "../../../../lib/pipelines/stage-helpers.js"
import { deterministicStage } from "../../../../lib/pipelines/stage-helpers.js"
import type { TStage, TStageContext } from "../../../../lib/pipelines/types.js"
import {
    STAGE_IDS,
    RelationExtractionOutputSchema,
    ConclusionSelectionOutputSchema,
    selectFallbackConclusion,
    CONCLUSION_SELECTION_NO_CONCLUSION_FAILURE_CODE,
    type TClaimCanonicalizationOutput,
    type TClaimTypeClassificationOutput,
    type TConclusionSelectionOutput,
    type TRelationExtractionOutput,
} from "../../base/stages/index.js"
import type { TLlmStageOptionsOverride } from "../../base/types.js"
import {
    ScribeStructureOutputSchema,
    type TScribeStructureOutput,
} from "./schemas.js"

export const STRUCTURE_MODEL = "gpt-5.4-mini"

/** Internal default knobs for scribe's `structure` stage. */
export const STRUCTURE_STAGE_DEFAULTS: TLlmStageOptionsOverride = {
    model: STRUCTURE_MODEL,
}

export const STRUCTURE_SYSTEM_PROMPT = `You read a canonical claim set — each claim's id, type, and content fields (title/body) — and emit the argument's structure.

Emit:
- \`relations\` — the support edges between claims. Each relation: a stable \`relationId\` (r1, r2, ...), a \`type\` of "support" / "joint-support" / "derivation-support", a \`sources\` array of supporting claim miniIds, a single \`target\` claim miniId, and an \`evidence\` object ({ segmentIds: [], quote: "" } is acceptable when you have no span to cite).
- \`conclusionCandidates\` — the claim miniIds that could be the argument's conclusion, ordered by DECREASING confidence (best first). The conclusion is the claim other claims support but that supports nothing further. Never list a citation- or axiomatic-typed claim. Return an empty array only when there is no argument structure.
- \`rationale\` — one sentence explaining your best pick (or why none qualifies).

Output ONLY the schema-shaped object. No prose.`

function buildStructurePrompt(ctx: TStageContext): {
    system: string
    user: string
} {
    const canon = ctx.get<TClaimCanonicalizationOutput>(
        STAGE_IDS.claimCanonicalization
    )
    const typeEnvelope = ctx.get<TClaimTypeClassificationOutput>(
        STAGE_IDS.claimTypeClassification
    )
    const typeByMiniId = new Map<string, string>()
    for (const entry of typeEnvelope?.classifications ?? []) {
        typeByMiniId.set(entry.miniId, entry.type)
    }
    // Mirror scholar's relation-extraction prompt: the model needs each
    // claim's content (title/body/url/axiom), not just its id + type, to
    // infer support edges + a conclusion. Reading only the type slot here
    // left the model with bare `[c1] type=normal` placeholders, so it
    // emitted no relations and scribe degraded to `argument: null`.
    const claimLines = (canon?.canonicalClaims ?? [])
        .map((c) => {
            const refinedType = typeByMiniId.get(c.miniId) ?? c.type
            return `  [${c.miniId}] type=${refinedType} symbol=${c.suggestedSymbol} fields=${JSON.stringify(
                {
                    ...c,
                    miniId: undefined,
                    mentionIds: undefined,
                    suggestedSymbol: undefined,
                    type: undefined,
                }
            )}`
        })
        .join("\n")
    const system = `<!-- stage-id: ${STAGE_IDS.scribeStructure} -->\n${STRUCTURE_SYSTEM_PROMPT}`
    const user = `Canonical claims (with types + content fields):\n${claimLines}\n\nEmit the relations + conclusionCandidates + rationale object.`
    return { system, user }
}

/**
 * Build scribe's `structure` LLM stage. Depends on the canonicalization
 * + classification slots (populated by `extract`'s adapters) so the
 * model sees the claim set + types when proposing relations + a
 * conclusion.
 */
export function createStructureStage(
    options?: TLlmStageOptionsOverride
): TStage<TScribeStructureOutput> {
    return llmStage<TScribeStructureOutput>({
        id: STAGE_IDS.scribeStructure,
        dependsOn: [
            STAGE_IDS.claimCanonicalization,
            STAGE_IDS.claimTypeClassification,
        ],
        outputSchema: ScribeStructureOutputSchema,
        model: options?.model ?? STRUCTURE_MODEL,
        maxOutputTokens: options?.maxOutputTokens,
        reasoningEffort: options?.reasoningEffort,
        retry: options?.retry,
        buildPrompt: buildStructurePrompt,
    })
}

/**
 * Adapter — republish `structure`'s relations under the
 * relation-extraction slot.
 */
export const structureRelationAdapterStage: TStage<TRelationExtractionOutput> =
    deterministicStage<TRelationExtractionOutput>({
        id: STAGE_IDS.relationExtraction,
        dependsOn: [STAGE_IDS.scribeStructure],
        outputSchema: RelationExtractionOutputSchema,
        fn: (ctx) => ({
            relations:
                ctx.get<TScribeStructureOutput>(STAGE_IDS.scribeStructure)
                    ?.relations ?? [],
        }),
    })

/**
 * Adapter — republish `structure`'s conclusion candidates under the
 * conclusion-selection slot, reproducing scholar's deterministic
 * resolution: the model's first candidate that is a normal claim, else
 * the relation-graph fallback, else null + a `NO_SINGLE_CONCLUSION`
 * processing failure. Emits the full `TConclusionSelectionOutput` that
 * finalize + formula-compilation read.
 */
export const structureConclusionAdapterStage: TStage<TConclusionSelectionOutput> =
    deterministicStage<TConclusionSelectionOutput>({
        id: STAGE_IDS.conclusionSelection,
        dependsOn: [
            STAGE_IDS.scribeStructure,
            STAGE_IDS.claimTypeClassification,
            STAGE_IDS.relationExtraction,
        ],
        outputSchema: ConclusionSelectionOutputSchema,
        fn: (ctx) => {
            const structure = ctx.get<TScribeStructureOutput>(
                STAGE_IDS.scribeStructure
            )
            const candidates = structure?.conclusionCandidates ?? []
            const rationale = structure?.rationale ?? ""
            const classifications =
                ctx.get<TClaimTypeClassificationOutput>(
                    STAGE_IDS.claimTypeClassification
                )?.classifications ?? []
            const relations =
                ctx.get<TRelationExtractionOutput>(STAGE_IDS.relationExtraction)
                    ?.relations ?? []

            const normalMiniIds = new Set(
                classifications
                    .filter((entry) => entry.type === "normal")
                    .map((entry) => entry.miniId)
            )
            const modelPick =
                candidates.find((miniId) => normalMiniIds.has(miniId)) ?? null
            const conclusionMiniId =
                modelPick ??
                selectFallbackConclusion(classifications, relations)
            const usedGraphFallback =
                modelPick === null && conclusionMiniId !== null

            if (conclusionMiniId === null) {
                ctx.addFailure({
                    code: CONCLUSION_SELECTION_NO_CONCLUSION_FAILURE_CODE,
                    message:
                        rationale.length > 0
                            ? rationale
                            : "No single conclusion could be selected.",
                    severity: "warning",
                    context: { rationale },
                })
            }

            return {
                conclusionMiniId,
                conclusionCandidates: candidates,
                rationale: usedGraphFallback
                    ? `Auto-selected ${conclusionMiniId} from the relation graph (the model named no usable candidate).`
                    : rationale,
            }
        },
    })
