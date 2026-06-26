// Finalize turn — parse the argument and close the conversation.
//
// Produces a `TStage` that runs the finalize action: the model produces
// a `TParsedArgumentResponse` from the conversation transcript, and the
// conversation is sealed.

import type { TStage } from "../../lib/pipelines/types.js"
import type { TReasoningEffort } from "../../lib/llm/types.js"
import type { TConversation } from "../../lib/conversation/conversation.js"
import { ParsedArgumentResponseSchema } from "../../lib/parsing/schemata.js"
import { buildParsingPrompt } from "../../lib/parsing/prompt-builder.js"
import { llmStage } from "../../lib/pipelines/stage-helpers.js"

/**
 * Options for creating a finalize turn.
 */
export type TFinalizeTurnOptions = {
    model: string
    reasoningEffort?: TReasoningEffort
    /** Called after the turn completes to seal the conversation. */
    onClose: () => void
}

/**
 * Create a finalize turn stage.
 *
 * The finalize stage runs the argument-parsing prompt, produces a
 * `TParsedArgumentResponse`, and calls `onClose` to seal the conversation.
 * This is the terminal turn — no further turns are allowed after this.
 *
 * The `onClose` callback is invoked by `executeTurn` after the stage
 * completes (via `TExecuteTurnDeps.onComplete`).
 */
export function createFinalizeTurn(
    options: TFinalizeTurnOptions
): TStage<unknown> {
    const systemPrompt = buildParsingPrompt(ParsedArgumentResponseSchema)

    return llmStage({
        id: "builder:finalize",
        dependsOn: [],
        outputSchema: ParsedArgumentResponseSchema,
        model: options.model,
        reasoningEffort: options.reasoningEffort,
        buildPrompt: () => ({
            system: systemPrompt,
            user: "", // overridden by executeTurn
        }),
        retry: { maxAttempts: 1 },
    })
}
