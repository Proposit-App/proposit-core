// Simulate turn — play-the-user stage.
//
// Produces a `TStage` that generates a simulated user message challenging
// the argument. This turn is discardable: its output does not need to be
// chained forward (the caller omits it from `branchFrom`).

import type { TStage } from "../../lib/pipelines/types.js"
import type { TReasoningEffort } from "../../lib/llm/types.js"
import { ParsedArgumentResponseSchema } from "../../lib/parsing/schemata.js"
import { llmStage } from "../../lib/pipelines/stage-helpers.js"

/**
 * Create a simulate turn stage.
 *
 * The simulate stage generates a user-side message that challenges the
 * argument — a counterargument, clarification request, or objection.
 * This turn is discardable: its output does not need to be chained
 * forward.
 */
export function createSimulateTurn(
    model: string,
    reasoningEffort?: TReasoningEffort
): TStage<unknown> {
    return llmStage({
        id: "builder:simulate",
        dependsOn: [],
        outputSchema: ParsedArgumentResponseSchema,
        model,
        reasoningEffort,
        buildPrompt: () => ({
            system: `You are playing the role of a skeptical but reasonable user in a dialogue about an argument. Generate a single user-side message that challenges, questions, or objects to the argument being discussed.

Your message should be a realistic counterargument, clarification request, or objection. Be specific — reference particular claims or reasoning in the argument.

Respond as a single message — do NOT attempt to parse or structure anything. Just write your user-side message.`,
            user: "", // overridden by executeTurn
        }),
    })
}
