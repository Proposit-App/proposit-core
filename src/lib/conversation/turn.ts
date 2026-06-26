// Stateless single-turn execution primitive.
//
// Wraps one `TStage` run with the full pipeline machinery (retry loop,
// output-schema validation, event emission, token accounting) and
// threads `previousResponseId` into the LLM request so the provider can
// chain against the upstream response. Surfaces the provider response id
// so the caller can forward it on the next turn.
//
// This is the shared substrate for both:
//   - the server's stateless per-request executor (threads the chain
//     from the client-supplied `lastResponseId`)
//   - the CLI's stateful conversation object (accumulates the chain)

import type { TStage, TProcessingFailure, TPipelineEvent } from "../pipelines/types.js"
import type { TLlmProvider, TLlmTokenUsage, TResponseId } from "../llm/types.js"
import { executeStage } from "../pipelines/execute.js"
import type { TStageOutcomeRecord } from "../pipelines/execute.js"
import type { TSchema } from "typebox"
import { Value } from "typebox/value"
import Type from "typebox"

// -- Public types ----------------------------------------------------------

/**
 * Input supplied to a single conversational turn. The caller is
 * responsible for assembling the user message (which may include the
 * full transcript when the provider cannot chain by reference).
 */
export type TTurnInput = {
    /** The user message for this turn. */
    userMessage: string
    /** The provider response id to chain against; absent for the first turn. */
    previousResponseId?: TResponseId
}

/**
 * Result of a single conversational turn. Mirrors the shape the
 * server's Argument Builder actions need: output, the new response id,
 * token usage, and any processing failures.
 */
export type TTurnResult<TOut> = {
    /** The stage's parsed output, or `null` when the turn failed. */
    output: TOut | null
    /** The provider response id for this turn (nullable for
     * non-chaining providers such as chat-completions). */
    responseId: TResponseId | null
    /** Cumulative token usage for this turn's LLM call. */
    tokenUsage: TLlmTokenUsage
    /** Processing failures recorded during the turn. */
    failures: TProcessingFailure[]
}

/**
 * Minimal dependencies for a single-turn execution. A subset of the
 * full pipeline deps — no concurrency or pipeline-level bookkeeping.
 */
export type TExecuteTurnDeps = {
    llm: TLlmProvider
    signal?: AbortSignal
    onEvent?: (event: TPipelineEvent) => void
    /** Called after the stage completes (after retry loop + validation).
     * Useful for terminal turns that need to seal a conversation. */
    onComplete?: () => void
}

// -- Internal: module-level bridge for user message ------------------------
//
// `llmStage` builds its user message from `buildPrompt(ctx)`. To override
// it without modifying the stage, we use a module-level variable that the
// provider wrapper reads. This keeps `executeTurn`'s signature clean
// while still letting the caller supply the actual user message.
//
// The variable is set synchronously before `executeStage` and cleared
// after it resolves, so it's safe for sequential (non-concurrent) use.

let CURRENT_TURN_INPUT: TTurnInput | null = null

// -- Internal: LLM provider wrapper ----------------------------------------
//
// Wraps the underlying provider to inject `previousResponseId` into each
// `respond` call and capture the surfaced response id. Also overrides the
// user message via the module-level bridge so `llmStage`'s `buildPrompt`
// user message is replaced with the caller-supplied one.

function wrapProviderForTurn(
    llm: TLlmProvider,
    previousResponseId: TResponseId | undefined,
    captured: { responseId: TResponseId | null }
): TLlmProvider {
    const underlying = llm
    return {
        async respond<T>(req: import("../llm/types.js").TLlmRequest<T>) {
            // Inject `previousResponseId` into the request.
            req.previousResponseId = previousResponseId
            // Override user message via the module-level bridge.
            if (CURRENT_TURN_INPUT) {
                req.userMessage = CURRENT_TURN_INPUT.userMessage
            }
            const response = await underlying.respond(req)
            // Capture the response id if surfaced.
            if (response.rawResponseId) {
                captured.responseId = response.rawResponseId
            }
            return response
        },
    }
}

// -- executeTurn -----------------------------------------------------------

/**
 * Run one conversational turn: execute the stage through the single-stage
 * executor (preserving retry loop, output-schema validation, event
 * emission, token accounting) while threading `previousResponseId` into
 * the LLM request and surfacing the provider response id.
 *
 * Uses a synthetic pipeline so `executeStage` can run the arbitrary stage
 * through the same execution machinery the full pipeline uses. The stage's
 * own `dependsOn` are preserved; since no upstream stages exist, any
 * dependencies that are satisfied will be `completed` (they simply don't
 * exist, so `ctx.get` returns `undefined` for them).
 */
export async function executeTurn<TOut>(
    stage: TStage<TOut>,
    input: TTurnInput,
    deps: TExecuteTurnDeps
): Promise<TTurnResult<TOut>> {
    // Capture the response id from the provider's response.
    const captured: { responseId: TResponseId | null } = {
        responseId: null,
    }

    // Wrap the LLM provider to inject `previousResponseId` and capture
    // the response id.
    const wrapped = wrapProviderForTurn(deps.llm, input.previousResponseId, captured)

    // Bridge the user message to the provider wrapper.
    CURRENT_TURN_INPUT = input

    // Create a synthetic pipeline containing just this stage.
    const stageId = stage.id
    const pipeline: import("../pipelines/types.js").TPipeline<unknown, TOut> = {
        id: "turn",
        version: "0.0.0",
        inputSchema: Value.Check(TypeAnySchema, {}) ? TypeAnySchema : (Type.Object({}) as TSchema),
        outputSchema: stage.outputSchema,
        stages: [stage],
        finalize: {
            dependsOn: [stageId],
            run: (ctx) => ctx.get(stageId) as TOut,
        },
    }

    // Run the stage through the single-stage executor.
    const upstream: Record<string, TStageOutcomeRecord> = {}
    const result = await executeStage(
        pipeline,
        stageId,
        upstream,
        {},
        {
            llm: wrapped,
            signal: deps.signal,
            onEvent: deps.onEvent,
        }
    )

    // Clear the user message bridge.
    CURRENT_TURN_INPUT = null

    // Call the completion callback (for terminal turns like finalize).
    deps.onComplete?.()

    return {
        output: (result.outcome === "completed"
            ? (result.output as TOut | null | undefined) ?? null
            : null) as TOut | null,
        responseId: captured.responseId,
        tokenUsage: result.tokenUsage ?? { input: 0, output: 0 },
        failures: result.failures,
    }
}

// -- Minimal `Type.Any()` without importing TypeBox ------------------------
// Used as the synthetic pipeline's input schema.

const TypeAnySchema: TSchema = { type: "any" }
