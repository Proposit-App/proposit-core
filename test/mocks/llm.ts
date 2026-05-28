// Mock `LlmProvider` for framework unit tests.
//
// Two keying modes:
//
//   1. **Stage-id marker.** When a stage's system prompt contains a
//      `<!--stage-id: <id>-->` HTML comment, the mock looks up the
//      stage's response queue under `<id>`. Each `respond` call pops
//      the next queued response for that stage. This is the default
//      keying mode used by `llmStage`-driven tests, where
//      `buildPrompt` is responsible for emitting the marker.
//
//   2. **Call-order keying.** When `keyByCallOrder: true` is passed,
//      the mock treats `responses` as a single flat queue keyed by
//      the constant `__byOrder` and pops responses in arrival order.
//      Tests that don't want to encode stage ids in prompts can use
//      this mode by enumerating responses in scheduling order.
//
// In either mode, a `MockResponse` is one of:
//   - `{ kind: "ok", output, tokenUsage? }` — return a successful
//     `LlmResponse`. Token usage defaults to `{ input: 1, output: 1 }`
//     when not specified, so the aggregator has something non-trivial
//     to sum in tests that don't care about exact figures.
//   - `{ kind: "error", error }` — throw the supplied error.
//   - `{ kind: "schema-invalid", output, tokenUsage? }` — return the
//     output as-is even if it would fail the caller's schema; lets
//     tests exercise the `OUTPUT_SCHEMA_INVALID` retry path.
//
// `onCall(record)` fires before every response is dispatched — tests
// use this to record per-call timing for concurrency assertions.

import type {
    TLlmProvider,
    TLlmRequest,
    TLlmResponse,
    TLlmTokenUsage,
} from "../../src/lib/llm/types.js"

export type TMockResponse =
    | { kind: "ok"; output: unknown; tokenUsage?: TLlmTokenUsage }
    | { kind: "error"; error: Error }
    | {
          kind: "schema-invalid"
          output: unknown
          tokenUsage?: TLlmTokenUsage
      }

export type TMockCallRecord = {
    stageId: string | null
    model: string
    systemPrompt: string
    userMessage: string
    at: number
}

export type TMockProviderOptions = {
    responses: Record<string, TMockResponse[]>
    onCall?: (record: TMockCallRecord) => void
    keyByCallOrder?: boolean
    /**
     * Optional artificial delay (ms) before each response resolves.
     * Useful for concurrency tests that need stages to actually
     * overlap in wall-clock time.
     */
    responseDelayMs?: number
}

const STAGE_ID_MARKER = /<!--\s*stage-id:\s*([^\s>]+)\s*-->/

export function extractStageIdFromSystemPrompt(
    systemPrompt: string
): string | null {
    const match = STAGE_ID_MARKER.exec(systemPrompt)
    return match ? match[1] : null
}

const BY_ORDER_KEY = "__byOrder"

export function createMockLlmProvider(
    opts: TMockProviderOptions
): TLlmProvider {
    const queues: Record<string, TMockResponse[]> = {}
    for (const [key, list] of Object.entries(opts.responses)) {
        queues[key] = [...list]
    }
    const delay = opts.responseDelayMs ?? 0

    const respond = async <T>(
        req: TLlmRequest<T>
    ): Promise<TLlmResponse<T>> => {
        const stageId = extractStageIdFromSystemPrompt(req.systemPrompt)
        if (opts.onCall) {
            opts.onCall({
                stageId,
                model: req.model,
                systemPrompt: req.systemPrompt,
                userMessage: req.userMessage,
                at: now(),
            })
        }

        const key = opts.keyByCallOrder ? BY_ORDER_KEY : stageId
        if (key === null) {
            throw new Error(
                `mock-llm: could not determine stage id from system prompt and keyByCallOrder is false. Prompt: ${req.systemPrompt}`
            )
        }
        const queue = queues[key]
        if (!queue || queue.length === 0) {
            throw new Error(
                `mock-llm: no canned response for key "${key}" (queue empty).`
            )
        }
        const response = queue.shift()
        if (!response) {
            throw new Error(`mock-llm: queue for "${key}" returned undefined.`)
        }

        if (delay > 0) {
            await sleepWithSignal(delay, req.signal)
        }
        if (req.signal?.aborted) {
            throw new Error("mock-llm: aborted")
        }

        switch (response.kind) {
            case "ok":
                return {
                    output: response.output as T,
                    tokenUsage: response.tokenUsage ?? {
                        input: 1,
                        output: 1,
                    },
                }
            case "schema-invalid":
                return {
                    output: response.output as T,
                    tokenUsage: response.tokenUsage ?? {
                        input: 1,
                        output: 1,
                    },
                }
            case "error":
                throw response.error
        }
    }

    return { respond }
}

function now(): number {
    return typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now()
}

async function sleepWithSignal(
    ms: number,
    signal?: AbortSignal
): Promise<void> {
    if (!signal) {
        await new Promise<void>((resolve) => setTimeout(resolve, ms))
        return
    }
    await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort)
            resolve()
        }, ms)
        const onAbort = (): void => {
            clearTimeout(timer)
            signal.removeEventListener("abort", onAbort)
            resolve()
        }
        signal.addEventListener("abort", onAbort, { once: true })
    })
}

/**
 * Convenience helper: build a transient error suitable for the mock's
 * `kind: "error"` response. The framework's `llmStage` checks for a
 * `retryReason` tag to decide retry behavior.
 */
export function makeTransientError(message: string): Error {
    const err = new Error(message)
    ;(err as unknown as { retryReason: string }).retryReason = "transient"
    return err
}

export function makeRateLimitError(message: string): Error {
    const err = new Error(message)
    ;(err as unknown as { retryReason: string }).retryReason = "rate_limit"
    return err
}

/**
 * Convenience helper: build a quota-exhaustion error suitable for the
 * mock's `kind: "error"` response. Mirrors the `retryReason:
 * "quota_exhausted"` tag the provider attaches to a
 * `QuotaExhaustedLlmError` (persistent budget exhaustion — an
 * `insufficient_quota` 429), which `classifyError` reads to drive
 * fail-fast behavior.
 */
export function makeQuotaError(message: string): Error {
    const err = new Error(message)
    ;(err as unknown as { retryReason: string }).retryReason = "quota_exhausted"
    return err
}
