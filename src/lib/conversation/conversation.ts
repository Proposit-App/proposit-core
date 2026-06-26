// Stateful conversation primitive for interactive, user-driven multi-turn
// LLM exchanges.
//
// Holds the response-ID chain and cumulative token usage. The user
// decides which turn runs next, in any amount and order, until a
// terminal `finalize` turn ends it.
//
// A conversation is NOT a pipeline. It is a thin, builder-agnostic
// stateful object that threads response-IDs and tallies tokens.

import type { TStage, TPipelineEvent } from "../pipelines/types.js"
import type { TLlmTokenUsage, TResponseId } from "../llm/types.js"
import type { TExecuteTurnDeps, TTurnInput, TTurnResult } from "./turn.js"
import { executeTurn } from "./turn.js"

// -- Public types ----------------------------------------------------------

/**
 * The conversation object. Methods:
 *   - `turn(stage, input, opts?)` — run one turn
 *   - `close()` — seal the conversation (finalize calls this)
 *
 * `.turn` after `.close()` throws `ConversationClosedError`.
 */
export type TConversation = {
    /**
     * Run one turn: execute the stage, thread `previousResponseId`
     * (from `branchFrom` or the last response id), and return the
     * result including the new response id.
     */
    turn<TOut>(
        stage: TStage<TOut>,
        input: TTurnInput,
        opts?: { branchFrom?: TResponseId; onComplete?: () => void }
    ): Promise<TTurnResult<TOut>>
    /** The latest provider response id in the chain. */
    readonly lastResponseId: TResponseId | null
    /** Cumulative token usage across all turns. */
    readonly tokenUsage: TLlmTokenUsage
    /** Whether the conversation has been closed. */
    readonly closed: boolean
    /** Seal the conversation. Subsequent `.turn` calls throw. */
    close(): void
}

/** Thrown when `.turn` is called on a closed conversation. */
export class ConversationClosedError extends Error {
    constructor() {
        super("Conversation is closed — no more turns allowed.")
        this.name = "ConversationClosedError"
    }
}

// -- createConversation ----------------------------------------------------

/**
 * Create a new stateful conversation object.
 *
 * The conversation holds the response-ID chain and cumulative token
 * usage. Each `.turn(...)` call executes a single stage through the
 * conversation primitive's execution path, threading `previousResponseId`
 * so the provider can chain against the upstream response.
 */
export function createConversation(deps: TExecuteTurnDeps): TConversation {
    let closed = false
    let lastResponseId: TResponseId | null = null
    let cumulativeTokens: TLlmTokenUsage = { input: 0, output: 0 }

    return {
        async turn<TOut>(
            stage: TStage<TOut>,
            input: TTurnInput,
            opts?: { branchFrom?: TResponseId; onComplete?: () => void }
        ): Promise<TTurnResult<TOut>> {
            if (closed) {
                throw new ConversationClosedError()
            }

            const turnInput: TTurnInput = {
                userMessage: input.userMessage,
                previousResponseId:
                    opts?.branchFrom ?? lastResponseId ?? undefined,
            }

            const result = await executeTurn(stage, turnInput, {
                ...deps,
                onComplete: opts?.onComplete,
            })

            lastResponseId = result.responseId
            cumulativeTokens = {
                input: cumulativeTokens.input + result.tokenUsage.input,
                output: cumulativeTokens.output + result.tokenUsage.output,
            }

            return result
        },

        get lastResponseId(): TResponseId | null {
            return lastResponseId
        },

        get tokenUsage(): TLlmTokenUsage {
            return cumulativeTokens
        },

        get closed(): boolean {
            return closed
        },

        close(): void {
            closed = true
        },
    }
}
