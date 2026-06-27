// Distill turn — collapse the builder conversation into clean single-author prose.
//
// Produces a `TStage` that runs the distill action: the model reads the full
// conversation (user↔reviewer transcript) and emits the user's final, settled
// argument as a single prose block. The consumer then feeds that prose into the
// existing ingestion pipeline (`createScribePipeline(basicsExtension)`) to get
// a schema-valid `TParsedArgumentResponse`.
//
// One parser, zero schema drift. Finalize's output is identical to ingestion by
// construction.

import Type from "typebox"
import type { TStage } from "../../lib/pipelines/types.js"
import type { TReasoningEffort } from "../../lib/llm/types.js"
import { llmStage } from "../../lib/pipelines/stage-helpers.js"

/**
 * Minimal output schema for the distill turn.
 *
 * Distill emits prose — not a parsed argument — so there is no
 * `buildParsingPrompt` import, no `ParsedArgumentResponseSchema`, and no
 * structured-argument shape to drift. The consumer feeds this string into the
 * existing ingestion pipeline to get the final `TParsedArgumentResponse`.
 */
const DistillOutputSchema = Type.Object({
    argumentText: Type.String({
        minLength: 1,
        description:
            "The user's final, settled argument as a single self-contained prose statement.",
    }),
})
export type TDistillOutput = { argumentText: string }

/**
 * Options for creating a distill turn.
 */
export type TDistillTurnOptions = {
    model: string
    reasoningEffort?: TReasoningEffort
    /** Called after the turn completes to seal the conversation. */
    onClose: () => void
}

/**
 * Create a distill turn stage.
 *
 * The distill stage reads the full builder conversation (user↔reviewer
 * transcript) and produces clean single-author prose representing the user's
 * final, settled argument. The prose is then fed into the existing ingestion
 * pipeline (by the consumer) to yield a `TParsedArgumentResponse` shaped
 * exactly like ingested arguments — same enrichment, same parser, zero drift.
 *
 * The whole transcript reaches this turn via the existing chaining
 * (`previousResponseId` / `userMessage`) — chained off the latest response,
 * not a re-rooted pre-review response. The distill prompt uses reviewer
 * questions only as context to interpret the user's (often terse, reactive)
 * answers; the ingestion pipeline keeps receiving single-author text and is
 * never told it originated from a conversation.
 *
 * This is the terminal turn — seals the conversation via `onClose`.
 * No further turns are allowed after this.
 *
 * `retry.maxAttempts: 1` — distillation failure is a content issue, not a
 * transient one. Retrying the same prompt will not help.
 */
export function createDistillTurn(
    options: TDistillTurnOptions
): TStage<TDistillOutput> {
    return llmStage({
        id: "builder:distill",
        dependsOn: [],
        outputSchema: DistillOutputSchema,
        model: options.model,
        reasoningEffort: options.reasoningEffort,
        buildPrompt: () => ({
            system: `You are reading a conversation between a user building a propositional argument and a Socratic reviewer.

Your job is to distill the user's final, settled argument into a single self-contained prose statement.

## Instructions

- Extract the user's final, settled position — the argument as it stands after the full back-and-forth.
- Use the reviewer's questions ONLY as context to interpret the user's answers. Resolve terse or reactive answers into standalone claims (e.g. fold "yes, and also Y" into a complete proposition).
- Ignore the reviewer's questions themselves, discarded ideas, simulated-user turns, and any material the user moved away from.
- Write in third person, present tense, active voice. Each sentence should be a clear declarative statement.
- Do NOT prepend author-attribution frames like "The author claims…" — write the proposition itself.
- The output must be a single coherent prose passage (one or more paragraphs) that fully expresses the argument.

## Output

Respond with exactly:
{"argumentText": "The distilled argument goes here."}

The argumentText field must be non-empty.`,
            user: "", // overridden by executeTurn with transcript
        }),
        retry: { maxAttempts: 1 },
    })
}
