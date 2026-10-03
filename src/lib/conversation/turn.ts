// Stateless single-turn execution primitive.
//
// Wraps one `TStage` run with the full pipeline machinery (retry loop,
// output-schema validation, event emission, token accounting) and
// threads `previousResponseId` into the LLM request so the provider can
// chain against the upstream response. Surfaces the provider response id
// so the caller can forward it on the next turn.
//
// This is the shared substrate for both:
//   - a consumer's stateless per-request executor (threads the chain
//     from the client-supplied `lastResponseId`)
//   - the CLI's stateful conversation object (accumulates the chain)

import type {
    TStage,
    TProcessingFailure,
    TPipelineEvent,
} from "../pipelines/types.js"
import type { TLlmProvider, TLlmTokenUsage, TResponseId } from "../llm/types.js"
import { executeStage } from "../pipelines/single-stage.js"
import type { TStageOutcomeRecord } from "../pipelines/single-stage.js"
import type { TSchema } from "typebox"

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
    /**
     * The provider response id for this turn (nullable for non-chaining
     * providers such as chat-completions). For a turn that failed it is the
     * last response the provider returned, which the stage may have
     * rejected, or `null` when none returned. A caller chaining turns should
     * keep its previous id when the turn failed (it recorded failures and
     * produced no output), as `createConversation` does.
     */
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

// -- Internal: LLM provider wrapper ----------------------------------------
//
// Wraps the underlying provider to inject `previousResponseId` into each
// `respond` call and capture the surfaced response id. Also replaces the
// user message `llmStage`'s `buildPrompt` produced with the caller-supplied
// one. Each turn gets its own wrapper holding its own input, so turns run at
// once never see each other's message, retries included.

function wrapProviderForTurn(
    llm: TLlmProvider,
    input: TTurnInput,
    captured: { responseId: TResponseId | null }
): TLlmProvider {
    const underlying = llm
    return {
        async respond<T>(req: import("../llm/types.js").TLlmRequest<T>) {
            req.previousResponseId = input.previousResponseId
            req.userMessage = input.userMessage
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
    return (await runTurn(stage, input, deps)).result
}

/**
 * `executeTurn`, also saying whether the stage completed. Internal: a
 * conversation moves its chain only onto a completed turn's response.
 */
export async function runTurn<TOut>(
    stage: TStage<TOut>,
    input: TTurnInput,
    deps: TExecuteTurnDeps
): Promise<{ result: TTurnResult<TOut>; completed: boolean }> {
    // Capture the response id from the provider's response.
    const captured: { responseId: TResponseId | null } = {
        responseId: null,
    }

    // Wrap the LLM provider to inject `previousResponseId` and capture
    // the response id.
    const wrapped = wrapProviderForTurn(deps.llm, input, captured)

    // Create a synthetic pipeline containing just this stage.
    const stageId = stage.id
    const pipeline: import("../pipelines/types.js").TPipeline<unknown, TOut> = {
        id: "turn",
        version: "0.0.0",
        inputSchema: TypeAnySchema,
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

    // Call the completion callback (for terminal turns like finalize).
    deps.onComplete?.()

    const completed = result.outcome === "completed"
    return {
        completed,
        result: {
            output: (completed
                ? ((result.output as TOut | null | undefined) ?? null)
                : null) as TOut | null,
            responseId: captured.responseId,
            tokenUsage: result.tokenUsage ?? { input: 0, output: 0 },
            failures: result.failures,
        },
    }
}

// -- Hand-written schema object for the synthetic pipeline's input --------
// The validator accepts any value against it, so the one-stage pipeline a turn
// builds never rejects its input.

const TypeAnySchema: TSchema = { type: "any" }
