// `conclusion-selection` — picks the single claim that is the
// argument's conclusion (the proposition the argument is FOR). Returns
// null when no single conclusion can be selected (multiple distinct
// conclusions, no clear conclusion at all). The null path drives
// `formula-compilation.conclusionPremiseMiniId === null` which in
// turn drives finalize's "argument: null + failureText: 'No single
// conclusion could be selected.'" per spec §7.5.
//
// Per spec §6.4 this is a strong-reasoning stage: gpt-5.5 with
// reasoning_effort=medium.

import {
    STAGE_IDS,
    ConclusionSelectionOutputSchema,
    type TClaimTypeClassificationOutput,
    type TConclusionSelectionOutput,
    type TRelationExtractionOutput,
} from "./schemas.js"
import { llmStage } from "../../../lib/pipelines/stage-helpers.js"
import type { TStage, TStageContext } from "../../../lib/pipelines/types.js"

export const CONCLUSION_SELECTION_MODEL = "gpt-5.5"
export const CONCLUSION_SELECTION_REASONING:
    | "minimal"
    | "low"
    | "medium"
    | "high" = "medium"

export const CONCLUSION_SELECTION_NO_CONCLUSION_FAILURE_CODE =
    "NO_SINGLE_CONCLUSION"

export const CONCLUSION_SELECTION_SYSTEM_PROMPT = `You select the single conclusion claim of an argument from the canonical claim set and the relation graph.

You receive:
- the per-claim type map (normal / citation / axiomatic)
- the support relation graph from \`relation-extraction\`

Emit:
- \`conclusionMiniId\` — the canonical claim miniId of the conclusion, OR \`null\` when no single claim is clearly the conclusion
- \`rationale\` — a one-sentence explanation of your pick (or your inability to pick one)

## Selection rules

1. The conclusion is the claim that no other claim is meant to support but is itself the terminus of one or more support edges. In a clean argument it's the "therefore X" claim.
2. If multiple distinct claims are each terminal AND each could plausibly be THE point of the argument (genuinely ambiguous), return null with a rationale naming the contenders.
3. Citation-typed and axiomatic-typed claims are never conclusions — they are always sources of support.
4. If no claim is supported by any relation (a single-statement input), return null; there is no argument to select a conclusion from.

The default disposition is "select"; only return null when ambiguity is genuine. Forcing a wrong choice is worse than admitting "no single conclusion could be selected" — downstream stages handle the null cleanly.`

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
                          `  [${r.relationId}] ${r.type}: sources=[${r.sources.join(",")}] target=${r.target}`
                  )
                  .join("\n")
            : "  (no relations)"

    const markedSystem = `<!-- stage-id: ${STAGE_IDS.conclusionSelection} -->\n${CONCLUSION_SELECTION_SYSTEM_PROMPT}`
    const user = `Per-claim types:\n${typeLines}\n\nRelations:\n${relationLines}\n\nSelect the conclusion (or return null).`
    return { system: markedSystem, user }
}

// Inner llmStage that actually performs the LLM call.
const innerStage = llmStage<TConclusionSelectionOutput>({
    id: STAGE_IDS.conclusionSelection,
    dependsOn: [
        STAGE_IDS.claimTypeClassification,
        STAGE_IDS.relationExtraction,
    ],
    outputSchema: ConclusionSelectionOutputSchema,
    model: CONCLUSION_SELECTION_MODEL,
    reasoningEffort: CONCLUSION_SELECTION_REASONING,
    buildPrompt,
})

/**
 * `conclusionSelectionStage` wraps the inner `llmStage` so that when
 * the LLM returns `conclusionMiniId: null`, the stage emits a
 * `ProcessingFailure` with code `NO_SINGLE_CONCLUSION` via
 * `ctx.addFailure` (spec §7.2 row 10). The stage still completes
 * successfully — the null output flows through `formula-compilation`
 * (which emits `conclusionPremiseMiniId: null`) into `finalize-response-v2`
 * (which assembles `{ argument: null, failureText: "No single
 * conclusion could be selected." }`). The added failure is a
 * UI-rendering hint, not a task-outcome signal; severity is `warning`
 * to match the informational-only role of finalize's failureText path.
 */
export const conclusionSelectionStage: TStage<TConclusionSelectionOutput> = {
    id: innerStage.id,
    dependsOn: innerStage.dependsOn,
    outputSchema: innerStage.outputSchema,
    run: async (ctx) => {
        const output = await innerStage.run(ctx)
        if (output.conclusionMiniId === null) {
            ctx.addFailure({
                code: CONCLUSION_SELECTION_NO_CONCLUSION_FAILURE_CODE,
                message:
                    output.rationale.length > 0
                        ? output.rationale
                        : "No single conclusion could be selected.",
                severity: "warning",
                context: { rationale: output.rationale },
            })
        }
        return output
    },
}
