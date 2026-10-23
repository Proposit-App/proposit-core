// Review turn — Socratic reviewer stage.
//
// Produces a `TStage` that runs one turn of Socratic dialogue: the model
// examines the user's argument, asks probing questions, and provides
// feedback to strengthen it. Does NOT call `.close()` on the conversation.

import type { TStage } from "../../lib/pipelines/types.js"
import type { TReasoningEffort } from "../../lib/llm/types.js"
import { ParsedArgumentResponseSchema } from "../../lib/parsing/schemata.js"
import { llmStage } from "../../lib/pipelines/stage-helpers.js"

/**
 * Create a review turn stage.
 *
 * The review stage runs one turn of Socratic dialogue: the model examines
 * the user's argument, asks probing questions, and provides feedback to
 * strengthen it. Output is validated against the parsing response schema.
 */
export function createReviewTurn(
    model: string,
    reasoningEffort?: TReasoningEffort
): TStage<unknown> {
    return llmStage({
        id: "builder:review",
        dependsOn: [],
        outputSchema: ParsedArgumentResponseSchema,
        model,
        reasoningEffort,
        buildPrompt: () => ({
            system: `You are a Socratic reviewer helping to strengthen a propositional argument. Examine the user's argument below and ask probing questions that challenge its assumptions, evidence, and logical structure.

Your goal is to help the user build a more rigorous, well-supported argument through guided questioning. Provide at most 2-3 focused questions per turn.

Respond as a single message. Do not try to parse the argument or restate it in a structured form; just ask questions.

You may format your reply with Markdown, limited to bulleted or numbered lists, **bold**, *italic*, and paragraphs separated by blank lines. Do not use headings, links, images, tables, block quotes, or code, inline or fenced. When you ask two or more questions, put them in a numbered list; a single question is a plain sentence.`,
            user: "", // overridden by executeTurn
        }),
    })
}
