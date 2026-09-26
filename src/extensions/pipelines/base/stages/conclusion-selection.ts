// `conclusion-selection` — chooses the claim that is the argument's
// conclusion (the proposition the argument is FOR). The model returns a
// confidence-ranked list of candidate claim miniIds (best first); the
// stage resolves a single `conclusionMiniId` from it — the first viable
// candidate (a known normal claim), or a relation-graph fallback
// (highest-in-degree terminal) when the model returns none. It stays
// null only when there is no argument structure at all (no claims, or no
// support relations). A non-null id flows into `formula-compilation`,
// which mints the conclusion premise; a null id drives
// `formula-compilation.conclusionPremiseMiniId === null` and finalize's
// "argument: null + failureText: 'No single conclusion could be
// selected.'". The full ranked list rides along on the stage output for
// consumers that want to offer alternates.
//
// This is a strong-reasoning stage: reasoning_effort=medium.

import {
    STAGE_IDS,
    ConclusionSelectionLlmOutputSchema,
    ConclusionSelectionOutputSchema,
    type TClaimTypeClassificationEntry,
    type TClaimTypeClassificationOutput,
    type TConclusionSelectionLlmOutput,
    type TConclusionSelectionOutput,
    type TInferenceRelation,
    type TRelationExtractionOutput,
} from "./schemas.js"
import type { TReasoningEffort } from "../../../../lib/llm/types.js"
import { llmStage } from "../../../../lib/pipelines/stage-helpers.js"
import type { TLlmOutputCheckFailure } from "../../../../lib/pipelines/stage-helpers.js"
import type { TStage, TStageContext } from "../../../../lib/pipelines/types.js"
import type { TLlmStageOptionsOverride } from "../types.js"

export const CONCLUSION_SELECTION_MODEL = "gpt-6-sol"
export const CONCLUSION_SELECTION_REASONING: TReasoningEffort = "medium"

export const CONCLUSION_SELECTION_NO_CONCLUSION_FAILURE_CODE =
    "NO_SINGLE_CONCLUSION"

/**
 * The failure a stage reports when the model found no structure in claims
 * that must have some, and what a reader is shown when retrying did not
 * help.
 */
export const NO_ARGUMENT_STRUCTURE_FAILURE = {
    code: "NO_ARGUMENT_STRUCTURE",
    message: "Couldn't work out how these claims connect to a conclusion.",
} as const

/**
 * `llmStage` content check shared by the stages that propose an argument's
 * structure: once there are at least two normal claims, the model must
 * name at least one relation and — when `conclusionCandidates` is given —
 * at least one conclusion candidate. With fewer there is nothing to
 * connect, so an empty answer is accepted. A failure retries the stage;
 * see `llmStage`'s `checkOutput`.
 */
export function checkArgumentStructure(
    ctx: TStageContext,
    output: {
        relations: readonly unknown[]
        conclusionCandidates?: readonly string[]
    }
): TLlmOutputCheckFailure | undefined {
    const normalClaims = (
        ctx.get<TClaimTypeClassificationOutput>(
            STAGE_IDS.claimTypeClassification
        )?.classifications ?? []
    ).filter((entry) => entry.type === "normal").length
    if (normalClaims < 2) return undefined
    if (output.relations.length === 0) return NO_ARGUMENT_STRUCTURE_FAILURE
    if (output.conclusionCandidates?.length === 0) {
        return NO_ARGUMENT_STRUCTURE_FAILURE
    }
    return undefined
}

export const CONCLUSION_SELECTION_SYSTEM_PROMPT = `You select the conclusion claim of an argument from the canonical claim set and the relation graph.

You receive:
- the per-claim type map (normal / citation / axiomatic)
- the inference relation graph from \`relation-extraction\` (each relation's antecedents jointly imply its consequent)

Emit:
- \`conclusionCandidates\` — an array of canonical claim miniIds ordered by DECREASING confidence: the first element is your single best pick for the conclusion. Return exactly one when the conclusion is clear; return several (best first) only when multiple claims are genuinely plausible conclusions. Return an empty array ONLY when the input has no argument structure at all.
- \`rationale\` — a one-sentence explanation of your ordering and best pick (or, for an empty array, why no claim is a conclusion)
- \`title\` — for your FIRST candidate only: a short noun phrase naming what this step DOES in the argument — the inferential move, not the proposition. Do not restate the consequent: that claim's own title is already shown directly beneath this one. Aim for under 60 characters. Examples: "Limits of the crowd's power", "Residence as tacit consent", "Principle over survival". Return an empty string when \`conclusionCandidates\` is empty.

## Selection rules

1. The conclusion is the claim that no other claim is meant to support but is itself the terminus of one or more support edges. In a clean argument it's the "therefore X" claim — list it first.
2. When several distinct claims are each terminal and plausibly the point, include them all, ordered best first. Do not abstain just because more than one is plausible.
3. Citation-typed and axiomatic-typed claims are never conclusions — never include them as candidates; they are always sources of support.
4. If no claim is supported by any relation (a single-statement input), return an empty array; there is no argument to select a conclusion from.

Always name your best candidate first rather than abstaining. Only an input with no argument structure yields an empty array.`

function buildPrompt(ctx: TStageContext): { system: string; user: string } {
    const typeEnvelope = ctx.get<TClaimTypeClassificationOutput>(
        STAGE_IDS.claimTypeClassification
    )
    const classifications = typeEnvelope?.classifications ?? []
    const relationEnvelope = ctx.get<TRelationExtractionOutput>(
        STAGE_IDS.relationExtraction
    )
    const relations = relationEnvelope?.relations ?? []

    const typeLines = classifications
        .map((entry) => `  [${entry.miniId}] type=${entry.type}`)
        .join("\n")
    const relationLines =
        relations.length > 0
            ? relations
                  .map(
                      (r) =>
                          `  [${r.relationId}] antecedents=[${r.antecedents.join(",")}] consequent=${r.consequent}`
                  )
                  .join("\n")
            : "  (no relations)"

    const markedSystem = `<!-- stage-id: ${STAGE_IDS.conclusionSelection} -->\n${CONCLUSION_SELECTION_SYSTEM_PROMPT}`
    const user = `Per-claim types:\n${typeLines}\n\nRelations:\n${relationLines}\n\nList the conclusion candidate miniIds, best first (empty array only if there is no argument).`
    return { system: markedSystem, user }
}

/** Internal default knobs for the conclusion-selection stage. */
export const CONCLUSION_SELECTION_STAGE_DEFAULTS: TLlmStageOptionsOverride = {
    model: CONCLUSION_SELECTION_MODEL,
    reasoningEffort: CONCLUSION_SELECTION_REASONING,
}

/**
 * Pick a conclusion deterministically from the relation graph when the
 * model abstains. A candidate is a `normal`-typed claim that is the
 * target of at least one support relation. Pure sinks (a target that
 * supports nothing else) are preferred — the textbook "therefore X"
 * terminus; when none exists (e.g. a support cycle) any supported normal
 * claim is eligible. The winner has the highest in-degree, ties broken
 * by document order (earliest appearance in the claim-type list) so the
 * pick is stable across runs. Returns null when no candidate exists —
 * there is no argument to draw a conclusion from.
 *
 * Exported so a cheaper ingestion pipeline that produces conclusion
 * candidates in one combined LLM call can reuse the identical
 * resolution when adapting its output into the conclusion-selection
 * slot — keeping the resolved `conclusionMiniId` contract uniform
 * across pipelines.
 */
export function selectFallbackConclusion(
    classifications: readonly TClaimTypeClassificationEntry[],
    relations: readonly TInferenceRelation[]
): string | null {
    if (relations.length === 0) return null

    const documentOrder = new Map<string, number>()
    classifications.forEach((entry, index) => {
        if (!documentOrder.has(entry.miniId)) {
            documentOrder.set(entry.miniId, index)
        }
    })
    const normalMiniIds = new Set(
        classifications
            .filter((entry) => entry.type === "normal")
            .map((entry) => entry.miniId)
    )

    const sourceMiniIds = new Set<string>()
    const inDegree = new Map<string, number>()
    for (const relation of relations) {
        for (const antecedent of relation.antecedents)
            sourceMiniIds.add(antecedent)
        inDegree.set(
            relation.consequent,
            (inDegree.get(relation.consequent) ?? 0) + 1
        )
    }

    const supportedNormals = [...inDegree.keys()].filter((miniId) =>
        normalMiniIds.has(miniId)
    )
    const pureSinks = supportedNormals.filter(
        (miniId) => !sourceMiniIds.has(miniId)
    )
    const pool = pureSinks.length > 0 ? pureSinks : supportedNormals
    if (pool.length === 0) return null

    return pool.reduce((best, miniId) => {
        const bestDegree = inDegree.get(best) ?? 0
        const degree = inDegree.get(miniId) ?? 0
        if (degree > bestDegree) return miniId
        if (degree < bestDegree) return best
        const bestOrder = documentOrder.get(best) ?? Number.MAX_SAFE_INTEGER
        const order = documentOrder.get(miniId) ?? Number.MAX_SAFE_INTEGER
        return order < bestOrder ? miniId : best
    })
}

/**
 * Build the conclusion-selection stage with optional caller overrides.
 * The inner `llmStage` asks the model for a confidence-ranked
 * `conclusionCandidates` list (best first). The wrapper resolves a
 * single `conclusionMiniId`: the first candidate that is a known normal
 * claim, else a deterministic relation-graph fallback
 * (`selectFallbackConclusion`), else null — in which case it emits a
 * `NO_SINGLE_CONCLUSION` `ProcessingFailure` (severity `warning`) that
 * drives finalize's `{ argument: null, failureText: "No single
 * conclusion could be selected." }`. The resolved id flows downstream to
 * `formula-compilation`; the model's raw ranked list — and the title it
 * authored for the first candidate — are preserved on the output, the
 * latter usable only when the resolved id is that same candidate.
 */
export function createConclusionSelectionStage(
    options?: TLlmStageOptionsOverride
): TStage<TConclusionSelectionOutput> {
    const innerStage = llmStage<TConclusionSelectionLlmOutput>({
        id: STAGE_IDS.conclusionSelection,
        dependsOn: [
            STAGE_IDS.claimTypeClassification,
            STAGE_IDS.relationExtraction,
        ],
        outputSchema: ConclusionSelectionLlmOutputSchema,
        model: options?.model ?? CONCLUSION_SELECTION_MODEL,
        maxOutputTokens: options?.maxOutputTokens,
        reasoningEffort:
            options?.reasoningEffort ?? CONCLUSION_SELECTION_REASONING,
        retry: options?.retry,
        buildPrompt,
    })
    return {
        id: innerStage.id,
        dependsOn: innerStage.dependsOn,
        outputSchema: ConclusionSelectionOutputSchema,
        run: async (ctx) => {
            const llmOutput = await innerStage.run(ctx)
            const classifications =
                ctx.get<TClaimTypeClassificationOutput>(
                    STAGE_IDS.claimTypeClassification
                )?.classifications ?? []
            const relations =
                ctx.get<TRelationExtractionOutput>(STAGE_IDS.relationExtraction)
                    ?.relations ?? []

            // A conclusion must be a normal claim (rule 3). Take the
            // model's highest-confidence candidate that qualifies; if it
            // named none that resolve, fall back to the relation graph;
            // only then concede there is no conclusion.
            const normalMiniIds = new Set(
                classifications
                    .filter((entry) => entry.type === "normal")
                    .map((entry) => entry.miniId)
            )
            const modelPick =
                llmOutput.conclusionCandidates.find((miniId) =>
                    normalMiniIds.has(miniId)
                ) ?? null
            const conclusionMiniId =
                modelPick ??
                selectFallbackConclusion(classifications, relations)
            const usedGraphFallback =
                modelPick === null && conclusionMiniId !== null

            if (conclusionMiniId === null) {
                ctx.addFailure({
                    code: CONCLUSION_SELECTION_NO_CONCLUSION_FAILURE_CODE,
                    message:
                        llmOutput.rationale.length > 0
                            ? llmOutput.rationale
                            : "No single conclusion could be selected.",
                    severity: "warning",
                    context: { rationale: llmOutput.rationale },
                })
            }

            return {
                conclusionMiniId,
                conclusionCandidates: llmOutput.conclusionCandidates,
                // Carried verbatim: it belongs to the model's first
                // candidate, and only a reader that knows which
                // candidate won can tell whether it applies.
                title: llmOutput.title,
                rationale: usedGraphFallback
                    ? `Auto-selected ${conclusionMiniId} from the relation graph (the model named no usable candidate).`
                    : llmOutput.rationale,
            }
        },
    }
}

/** Backward-compatible default-options stage. */
export const conclusionSelectionStage: TStage<TConclusionSelectionOutput> =
    createConclusionSelectionStage()
