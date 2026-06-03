// Concrete `TLlmProvider` backed by the OpenAI Responses API.
//
// The V1 adapter: raw `fetch` to
// `https://api.openai.com/v1/responses` with strict-mode
// structured output via the inlined TypeBox → JSON Schema converter,
// translation of the framework's `TToolSpec` discriminated union
// into the Responses-API tool-shape, and a function-tool agent loop
// capped by `maxToolCallRounds` (default 6). Built-in tools
// (`web_search` / `file_search` / `mcp`) execute on OpenAI's
// infrastructure and don't enter the loop.
//
// The provider deliberately uses raw `fetch` rather than the
// `openai` npm SDK. `openai` is declared as an optional peer in
// `package.json` for forward-looking insurance — a future version may
// adopt it; V1 keeps the dependency surface minimal.
//
// Error classification routes HTTP-status families into framework-
// recognized error classes (see `./errors.ts`):
//
//   * 5xx                        → `TransientLlmError`
//   * 429 (insufficient_quota)   → `QuotaExhaustedLlmError`
//   * 429 (any other body)       → `RateLimitLlmError`
//   * 400, 422                   → `SchemaValidationLlmError`
//   * 401, 403, other 4xx        → `NonRetryableLlmError`
//   * loop cap exceeded          → `ToolLoopExhaustedError`
//
// The framework's `llmStage` retry policy classifies via the
// `retryReason` tag on the thrown error; the class names exist for
// caller observability (`instanceof` checks) and stack-trace
// readability.

import type { TSchema } from "typebox"
import type {
    TLlmProvider,
    TLlmRequest,
    TLlmResponse,
    TLlmTokenUsage,
    TToolSpec,
} from "../../lib/llm/types.js"
import {
    debugLlmFailure,
    debugLlmRequest,
    debugLlmResponse,
} from "../../lib/pipelines/debug-log.js"
import { typeboxToOpenAiSchema } from "./structured-output.js"
import {
    NonRetryableLlmError,
    QuotaExhaustedLlmError,
    RateLimitLlmError,
    ResponseNotFoundError,
    SchemaValidationLlmError,
    ToolLoopExhaustedError,
    TransientLlmError,
} from "./errors.js"
import type {
    TOpenAiFetch,
    TOpenAiInputMessage,
    TOpenAiOutputItem,
    TOpenAiResponsesEnvelope,
    TOpenAiResponsesRequestBody,
    TOpenAiTool,
} from "./types.js"

const STAGE_ID_MARKER = /<!--\s*stage-id:\s*([^\s>]+)\s*-->/

const DEFAULT_BASE_URL = "https://api.openai.com/v1/responses"
const DEFAULT_MAX_TOOL_ROUNDS = 6

export type TCreateOpenAiResponsesProviderOptions = {
    apiKey: string
    /** Override the default `https://api.openai.com/v1/responses`. */
    baseUrl?: string
    /**
     * Injectable `fetch`. Defaults to `globalThis.fetch`. Tests inject
     * mocks; runtimes without a global `fetch` (older Node) inject a
     * polyfill.
     */
    fetch?: TOpenAiFetch
    /**
     * Cap on the number of round-trips the function-tool agent loop
     * can take before throwing `ToolLoopExhaustedError`. Defaults to
     * 6. Built-in tools (`web_search` / `file_search` / `mcp`) don't
     * count against this cap — they run server-side.
     */
    maxToolCallRounds?: number
    /**
     * Stream the foreground response over SSE and accumulate to the
     * terminal envelope inside the provider. Defaults to **`true`** —
     * gives connection-drop resilience and parity with the Ollama
     * provider. No data-retention implications (unlike `backgroundMode`).
     * Set `false` to restore the blocking `response.json()` path.
     */
    stream?: boolean
    /**
     * Run long reasoning calls in OpenAI **background mode**
     * (submit-then-poll) so the result does not depend on a
     * continuously-held connection. Defaults to **`false`**.
     *
     * Background mode requires `store: true`, which retains the
     * response server-side (~10 min, for polling) and is **NOT
     * ZDR-compatible**. Enable only where that data-retention posture
     * is acceptable. V1 supports the **no-tools path only**: a request
     * that sets `backgroundMode` and carries `tools` throws
     * `NonRetryableLlmError`.
     */
    backgroundMode?: boolean
    /**
     * Combine OpenAI **background mode** with **live SSE streaming**:
     * the request is submitted with `{ background: true, stream: true,
     * store: true }` so it keeps generating server-side even if the
     * connection drops, and the SSE stream is consumed live while it
     * runs. This is independent of the `stream` option (foreground-
     * only streaming) and `backgroundMode` (poll-only).
     *
     * When `true`, `backgroundMode` is ignored for this provider
     * instance. `stream` is also ignored (SSE is always used in this
     * mode). V1 supports the **no-tools path only**: a request that
     * sets `backgroundStreamMode` and carries `tools` throws
     * `NonRetryableLlmError`.
     *
     * The response id is surfaced immediately from the submit POST
     * body (before any SSE bytes), making it available for durable
     * persistence by the caller. Defaults to **`false`**.
     */
    backgroundStreamMode?: boolean
    /**
     * Poll interval (ms) for the background submit-then-poll loop.
     * Defaults to 2000. Ignored unless `backgroundMode` is `true`.
     */
    backgroundPollIntervalMs?: number
}

export function createOpenAiResponsesProvider(
    options: TCreateOpenAiResponsesProviderOptions
): TLlmProvider {
    const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
    const fetchImpl =
        options.fetch ?? (globalThis.fetch as TOpenAiFetch | undefined)
    if (!fetchImpl) {
        throw new Error(
            "createOpenAiResponsesProvider: no fetch implementation available. Pass `fetch` explicitly or run in an environment that provides `globalThis.fetch` (Node ≥18, modern browsers, Expo)."
        )
    }
    const maxToolRounds = options.maxToolCallRounds ?? DEFAULT_MAX_TOOL_ROUNDS
    const useStream = options.stream ?? true
    const useBackgroundStream = options.backgroundStreamMode ?? false
    const useBackground = useBackgroundStream
        ? false
        : (options.backgroundMode ?? false)
    const backgroundPollIntervalMs = options.backgroundPollIntervalMs ?? 2000

    const respond = async <T>(
        req: TLlmRequest<T>
    ): Promise<TLlmResponse<T>> => {
        if (
            (useBackground || useBackgroundStream) &&
            req.tools &&
            req.tools.length > 0
        ) {
            throw new NonRetryableLlmError({
                message:
                    "OpenAI background mode does not support function tools in V1. Disable backgroundMode / backgroundStreamMode for tool-using requests, or run the tools synchronously.",
            })
        }

        const schemaName = deriveSchemaName(req.outputSchema)
        const convertedSchema = typeboxToOpenAiSchema(req.outputSchema)
        const tools = req.tools ? translateTools(req.tools) : undefined
        // Extract the stage-id marker from the system prompt for
        // debug-log correlation. Inert outside debug mode (the marker
        // is an HTML comment); load-bearing for `PROPOSIT_PIPELINE_DEBUG=1`
        // diagnostic lines so consumers can group request/response
        // pairs by stage.
        const stageIdMatch = STAGE_ID_MARKER.exec(req.systemPrompt)
        const debugStageId = stageIdMatch ? stageIdMatch[1] : null

        // Build the running `input` array. Subsequent agent-loop
        // iterations append tool-result messages to this same array.
        const input: TOpenAiInputMessage[] = [
            { role: "system", content: req.systemPrompt },
            { role: "user", content: req.userMessage },
        ]

        let lastUsage: TLlmTokenUsage = { input: 0, output: 0 }
        let lastResponseId: string | undefined

        // Fire the mid-flight id callback at most once across the whole
        // call (background-stream mode is no-tools-only, so the loop runs
        // a single round, but guard regardless of future loop behavior).
        let responseIdNotified = false
        const notifyResponseId = (responseId: string): void => {
            lastResponseId = responseId
            if (responseIdNotified) return
            responseIdNotified = true
            req.onResponseCreated?.(responseId)
        }

        for (let round = 0; round < maxToolRounds; round += 1) {
            const body: TOpenAiResponsesRequestBody = {
                model: req.model,
                input,
                text: {
                    format: {
                        type: "json_schema",
                        name: schemaName,
                        strict: true,
                        schema: convertedSchema,
                    },
                },
            }
            if (req.maxOutputTokens !== undefined) {
                body.max_output_tokens = req.maxOutputTokens
            }
            if (req.reasoningEffort) {
                body.reasoning = { effort: req.reasoningEffort }
            }
            if (tools) {
                body.tools = tools
            }

            debugLlmRequest({
                stageId: debugStageId,
                model: req.model,
                maxOutputTokens: req.maxOutputTokens,
                reasoningEffort: req.reasoningEffort,
                systemPromptLen: req.systemPrompt.length,
                userMessageLen: req.userMessage.length,
                systemPromptHead: req.systemPrompt,
                userMessageHead: req.userMessage,
            })

            const envelope = await fetchResponseEnvelope({
                url: baseUrl,
                apiKey: options.apiKey,
                body,
                fetchImpl,
                signal: req.signal,
                stream: useStream,
                background: useBackground,
                backgroundStream: useBackgroundStream,
                pollIntervalMs: backgroundPollIntervalMs,
                onResponseId: notifyResponseId,
            })

            // The mid-flight callback (background-stream mode) already set
            // `lastResponseId`; fall back to the terminal envelope id for
            // the synchronous / poll paths where no mid-flight id fires.
            lastResponseId = envelope.id ?? lastResponseId
            lastUsage = mergeUsage(lastUsage, extractUsage(envelope))

            if (envelope.status === "failed") {
                const err = envelope.error
                const message = `OpenAI Responses API returned status: "failed"${
                    err?.code ? ` (code: ${err.code})` : ""
                }: ${err?.message ?? "no error detail provided"}`
                debugLlmFailure({
                    stageId: debugStageId,
                    model: req.model,
                    errorName: "NonRetryableLlmError",
                    errorMessage: message,
                    status: envelope.status,
                    tokenUsage: lastUsage,
                })
                // A terminal `failed` envelope is a definitive failure of
                // *this* response — surface immediately rather than burn a
                // retry. The `error.message` is preserved for the caller.
                throw new NonRetryableLlmError({ message })
            }

            // **Incomplete-envelope classification (v1.3.1).** When
            // the model stops before finishing, the Responses API
            // returns 200 OK with `status: "incomplete"` +
            // `incomplete_details: { reason: <reason> }` and a
            // *partial* `output_text`. Pre-v1.3.1 the provider
            // blindly ran the partial text through `safeParseJson`,
            // which surfaced a cryptic `SchemaValidationLlmError:
            // Unterminated string in JSON at position N`. The
            // framework's default policy then retried, hit the same
            // wall on attempt 2, and produced the deterministic
            // two-attempt-failure pattern users reported.
            //
            // The fold post-validation splits the classification by
            // `incomplete_details.reason`:
            //
            //   * `max_output_tokens` → `TransientLlmError`
            //     (retryable; a re-roll with the same prompt is the
            //     correct strategy when the cap is the issue,
            //     because a single retry may still succeed if the
            //     model produces a slightly more compact answer;
            //     and if it doesn't, the actionable next step is
            //     raising the cap on the stage).
            //   * `content_filter` → `NonRetryableLlmError`
            //     (deterministic — OpenAI's policy filter doesn't
            //     change between calls; retrying burns a second API
            //     hit for no benefit. Surface immediately so the
            //     caller can re-prompt with different input.)
            //   * any other reason → `TransientLlmError` as a
            //     conservative default, but emit a `console.warn`
            //     so a new `incomplete_details.reason` value lands
            //     on operators' radar even when debug logging is
            //     off. Once we see the new reason in practice, the
            //     classification gets extended.
            if (envelope.status === "incomplete") {
                const reason =
                    envelope.incomplete_details?.reason ?? "unspecified"
                // Surface the truncated `output_text` (when present)
                // on the debug channel so devs running with
                // `PROPOSIT_PIPELINE_DEBUG=1` can see exactly how far
                // the model got before the stop fired.
                const partialText = extractAssistantText(envelope.output)
                const errorName =
                    reason === "content_filter"
                        ? "NonRetryableLlmError"
                        : "TransientLlmError"
                debugLlmFailure({
                    stageId: debugStageId,
                    model: req.model,
                    errorName,
                    errorMessage: `incomplete (reason: ${reason})`,
                    status: envelope.status,
                    incompleteReason: reason,
                    rawText: partialText,
                    tokenUsage: lastUsage,
                })
                const message = formatIncompleteMessage(reason)
                if (reason === "content_filter") {
                    throw new NonRetryableLlmError({ message })
                }
                if (
                    reason !== "max_output_tokens" &&
                    reason !== "unspecified"
                ) {
                    // Conservative default for an unknown reason:
                    // treat as transient (we can't prove it's
                    // deterministic) but warn so this lands on
                    // operators' radar even when debug logging is
                    // off. Plain `console.warn` rather than the
                    // gated `debug-log` helper because the whole
                    // point is "noticing the new value without
                    // having to opt into debug mode".
                    console.warn(
                        `[proposit/openai] Unrecognized incomplete_details.reason "${reason}" — classifying as transient (retryable). If this reason is in fact deterministic, classify it explicitly in provider.ts.`
                    )
                }
                throw new TransientLlmError({ message })
            }

            const functionCalls = pickFunctionCalls(envelope.output)
            // Edge case — simultaneous `function_call` + final
            // `message` in the same response: the Responses API
            // contract says the model emits either tool calls or a
            // final answer in a given turn, not both, but a
            // misbehaving prompt could in principle yield both. The
            // provider's policy here is conservative: if any
            // `function_call` items appear, treat the round as a
            // tool-call round (execute handlers, ignore the message,
            // re-call). The follow-up round gets to produce the
            // final answer. Callers that want the message even when
            // tools fire would need a different exit condition; we
            // accept this behavior as V1.
            if (functionCalls.length > 0) {
                // Per the Responses-API conversation-history
                // contract, the next request must include each
                // original `function_call` item the model emitted,
                // immediately followed by its matching
                // `function_call_output`. Omitting the
                // `function_call` items returns a 400 with a
                // conversation-state error on round 2+. Order is
                // preserved across all calls in the round.
                for (const call of functionCalls) {
                    const handler = findFunctionHandler(req.tools, call.name)
                    if (!handler) {
                        throw new NonRetryableLlmError({
                            message: `OpenAI requested unknown function tool "${call.name}".`,
                        })
                    }
                    const parsedArgs = safeParseJson(call.arguments)
                    const handlerResult = await handler.handler(parsedArgs)
                    // Echo the original function_call (verbatim
                    // wire-shape) before its matching output. The
                    // API enforces this pairing by `call_id`.
                    input.push({
                        type: "function_call",
                        call_id: call.callId,
                        name: call.name,
                        arguments: call.arguments,
                    })
                    input.push({
                        type: "function_call_output",
                        call_id: call.callId,
                        output:
                            typeof handlerResult === "string"
                                ? handlerResult
                                : JSON.stringify(handlerResult),
                    })
                }
                // Loop back for the next round.
                continue
            }

            const text = extractAssistantText(envelope.output)
            if (text === undefined) {
                debugLlmFailure({
                    stageId: debugStageId,
                    model: req.model,
                    errorName: "TransientLlmError",
                    errorMessage: "no assistant text content",
                    status: envelope.status,
                    tokenUsage: lastUsage,
                })
                throw new TransientLlmError({
                    message:
                        "OpenAI Responses API returned no assistant text content.",
                })
            }
            let parsed: unknown
            try {
                parsed = safeParseJson(text)
            } catch (err) {
                debugLlmFailure({
                    stageId: debugStageId,
                    model: req.model,
                    errorName: err instanceof Error ? err.name : "Error",
                    errorMessage:
                        err instanceof Error ? err.message : String(err),
                    status: envelope.status,
                    rawText: text,
                    tokenUsage: lastUsage,
                })
                throw err
            }
            debugLlmResponse({
                stageId: debugStageId,
                status: envelope.status,
                outputTextLen: text.length,
                tokenUsage: lastUsage,
                rawResponseId: lastResponseId,
            })
            return {
                output: parsed as T,
                tokenUsage: lastUsage,
                rawResponseId: lastResponseId,
            }
        }

        throw new ToolLoopExhaustedError({
            message: `Function-tool agent loop exceeded ${maxToolRounds.toString()} rounds without a final response.`,
            rounds: maxToolRounds,
        })
    }

    return { respond }
}

// -- Public retrieval API --

/**
 * The status values the OpenAI Responses API reports for a stored
 * response. `completed` / `failed` / `incomplete` / `cancelled` are
 * terminal; `queued` / `in_progress` are transient.
 */
export type TResponseStatus =
    | "queued"
    | "in_progress"
    | "completed"
    | "failed"
    | "incomplete"
    | "cancelled"

/**
 * The structured result of a `retrieveResponse` call. All fields
 * except `status` and `rawResponseId` are absent for non-terminal
 * or failed responses.
 */
export type TRetrievedResponse = {
    /** Current status of the stored response. */
    status: TResponseStatus
    /**
     * Parsed text output, present when `status === "completed"` and
     * the response carried a `message` output item.
     */
    output?: string
    /** Token usage reported by OpenAI, when available. */
    tokenUsage?: import("../../lib/llm/types.js").TLlmTokenUsage
    /** The OpenAI response id that was retrieved. */
    rawResponseId: string
}

/**
 * Retrieve a stored OpenAI response by id. Surfaces the current
 * status, output text (when completed), and token usage.
 *
 * Throws {@link ResponseNotFoundError} when the response is not found
 * (HTTP 404), which typically means the ~10-minute retention window
 * has elapsed. Callers should clear the stored id, settle the
 * associated stage as failed, and surface a retry prompt.
 *
 * @param id - The OpenAI response id to retrieve.
 * @param options - Provider configuration (apiKey, optional baseUrl and fetch).
 */
export async function retrieveResponse(
    id: string,
    options: {
        apiKey: string
        baseUrl?: string
        fetch?: TOpenAiFetch
        signal?: AbortSignal
    }
): Promise<TRetrievedResponse> {
    const fetchImpl = resolveFetch(options.fetch, "retrieveResponse")
    const envelope = await getResponseById({
        url: options.baseUrl ?? DEFAULT_BASE_URL,
        id,
        apiKey: options.apiKey,
        fetchImpl,
        signal: options.signal,
    })
    return envelopeToRetrievedResponse(envelope, id)
}

/**
 * Reconnect to a stored, still-generating background response and
 * **stream it to completion**. This is what actually drives a dropped
 * background response forward: a passive `retrieveResponse` GET only
 * reads the current state and leaves a `queued` / `in_progress`
 * response sitting where it is, whereas reconnecting with `stream=true`
 * resumes consumption so the response reaches a terminal status.
 *
 * Issues `GET /responses/{id}?stream=true&starting_after=<cursor>` and
 * consumes the SSE stream to its terminal event, returning the same
 * {@link TRetrievedResponse} shape as {@link retrieveResponse}.
 *
 * Throws {@link ResponseNotFoundError} when the response is not found
 * (HTTP 404 — typically the ~10-minute retention window elapsed).
 * Honors `signal`: an abort propagates as an `AbortError` from the
 * underlying stream read.
 *
 * @param id - The OpenAI response id to reconnect to.
 * @param options - `apiKey`, optional `startingAfter` SSE cursor
 *   (defaults to 0 — replay from the start of the stored stream),
 *   optional `baseUrl`, `fetch`, and `signal`.
 */
export async function reconnectStream(
    id: string,
    options: {
        apiKey: string
        startingAfter?: number
        baseUrl?: string
        fetch?: TOpenAiFetch
        signal?: AbortSignal
    }
): Promise<TRetrievedResponse> {
    const fetchImpl = resolveFetch(options.fetch, "reconnectStream")
    const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
    const startingAfter = options.startingAfter ?? 0
    const url = `${baseUrl}/${id}?stream=true&starting_after=${startingAfter.toString()}`

    let response: Response
    try {
        response = await fetchImpl(url, {
            method: "GET",
            headers: { Authorization: `Bearer ${options.apiKey}` },
            signal: options.signal,
        })
    } catch (err) {
        if (isAbortError(err)) throw err
        throw new TransientLlmError({
            message: `Network error reconnecting to OpenAI background response: ${
                err instanceof Error ? err.message : String(err)
            }`,
        })
    }
    if (response.status === 404) {
        throw new ResponseNotFoundError({ responseId: id })
    }
    if (!response.ok) {
        const errorBody = await response.text().catch(() => "")
        throw classifyHttpError(
            response.status,
            `OpenAI reconnect ${response.status.toString()}: ${
                errorBody || response.statusText
            }`
        )
    }
    const envelope = await readSseEnvelope(response)
    return envelopeToRetrievedResponse(envelope, id)
}

/**
 * Cancel a stored, in-flight OpenAI response. Issues
 * `POST /responses/{id}/cancel` and returns the resulting
 * {@link TRetrievedResponse} (typically `status: "cancelled"`).
 *
 * Cancel is **idempotent** per the Responses API: cancelling twice, or
 * cancelling an already-terminal response, simply returns the final
 * `Response` object rather than erroring — so callers do not need to
 * guard against double-cancel.
 *
 * Throws {@link ResponseNotFoundError} when the response is not found
 * (HTTP 404 — typically the ~10-minute retention window elapsed).
 * Honors `signal` (an abort propagates as an `AbortError`).
 *
 * Use this to stop an in-flight background response when a stage is
 * abandoned (resync timeout) or an import is cancelled, so generation
 * does not keep running (and billing) server-side after the consumer
 * has given up on it.
 *
 * @param id - The OpenAI response id to cancel.
 * @param options - `apiKey`, optional `baseUrl`, `fetch`, and `signal`.
 */
export async function cancelResponse(
    id: string,
    options: {
        apiKey: string
        baseUrl?: string
        fetch?: TOpenAiFetch
        signal?: AbortSignal
    }
): Promise<TRetrievedResponse> {
    const fetchImpl = resolveFetch(options.fetch, "cancelResponse")
    const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL

    let response: Response
    try {
        response = await fetchImpl(`${baseUrl}/${id}/cancel`, {
            method: "POST",
            headers: { Authorization: `Bearer ${options.apiKey}` },
            signal: options.signal,
        })
    } catch (err) {
        if (isAbortError(err)) throw err
        throw new TransientLlmError({
            message: `Network error cancelling OpenAI background response: ${
                err instanceof Error ? err.message : String(err)
            }`,
        })
    }
    if (response.status === 404) {
        throw new ResponseNotFoundError({ responseId: id })
    }
    if (!response.ok) {
        const errorBody = await response.text().catch(() => "")
        throw classifyHttpError(
            response.status,
            `OpenAI cancel ${response.status.toString()}: ${
                errorBody || response.statusText
            }`
        )
    }
    const envelope = await parseJsonOrThrowTransient(
        response,
        "OpenAI cancel body was not valid JSON"
    )
    return envelopeToRetrievedResponse(envelope, id)
}

function resolveFetch(
    injected: TOpenAiFetch | undefined,
    fnName: string
): TOpenAiFetch {
    const fetchImpl = injected ?? (globalThis.fetch as TOpenAiFetch | undefined)
    if (!fetchImpl) {
        throw new Error(
            `${fnName}: no fetch implementation available. Pass \`fetch\` explicitly or run in an environment that provides \`globalThis.fetch\` (Node ≥18, modern browsers, Expo).`
        )
    }
    return fetchImpl
}

function envelopeToRetrievedResponse(
    envelope: TOpenAiResponsesEnvelope,
    id: string
): TRetrievedResponse {
    const output = extractAssistantText(envelope.output)
    const usage = extractUsage(envelope)
    const result: TRetrievedResponse = {
        status: (envelope.status ?? "in_progress") as TResponseStatus,
        rawResponseId: envelope.id ?? id,
    }
    if (output !== undefined) {
        result.output = output
    }
    if (usage.input > 0 || usage.output > 0) {
        result.tokenUsage = usage
    }
    return result
}

// -- HTTP --

async function fetchResponseEnvelope(args: {
    url: string
    apiKey: string
    body: TOpenAiResponsesRequestBody
    fetchImpl: TOpenAiFetch
    signal?: AbortSignal
    stream: boolean
    background: boolean
    backgroundStream: boolean
    pollIntervalMs: number
    onResponseId?: (responseId: string) => void
}): Promise<TOpenAiResponsesEnvelope> {
    if (args.backgroundStream) {
        return runBackgroundStream({
            url: args.url,
            apiKey: args.apiKey,
            body: args.body,
            fetchImpl: args.fetchImpl,
            signal: args.signal,
            onResponseId: args.onResponseId,
        })
    }
    if (args.background) {
        return runBackground({
            url: args.url,
            apiKey: args.apiKey,
            body: args.body,
            fetchImpl: args.fetchImpl,
            signal: args.signal,
            pollIntervalMs: args.pollIntervalMs,
        })
    }
    if (args.stream) {
        const response = await callOnce({
            url: args.url,
            apiKey: args.apiKey,
            body: { ...args.body, stream: true },
            fetchImpl: args.fetchImpl,
            signal: args.signal,
        })
        return readSseEnvelope(response)
    }
    const response = await callOnce({
        url: args.url,
        apiKey: args.apiKey,
        body: args.body,
        fetchImpl: args.fetchImpl,
        signal: args.signal,
    })
    return parseJsonOrThrowTransient(
        response,
        "OpenAI response body was not valid JSON"
    )
}

async function parseJsonOrThrowTransient(
    response: Response,
    context: string
): Promise<TOpenAiResponsesEnvelope> {
    return response
        .json()
        .then((j) => j as TOpenAiResponsesEnvelope)
        .catch((err: unknown) => {
            throw new TransientLlmError({
                message: `${context}: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            })
        })
}

function abortError(): Error {
    const e = new Error("The OpenAI background request was aborted.")
    e.name = "AbortError"
    return e
}

// Resolves (never rejects) on abort by design: the poll loop owns the
// abort→cancel→throw decision at exactly two checkpoints (top-of-loop and
// the in-flight-GET catch), so this helper just needs to wake the loop
// promptly instead of waiting out the full interval. Keeping it
// non-throwing avoids a second, competing abort surface.
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal?.aborted) {
            resolve()
            return
        }
        const onAbort = (): void => {
            cleanup()
            resolve()
        }
        const cleanup = (): void => {
            clearTimeout(timer)
            signal?.removeEventListener("abort", onAbort)
        }
        const timer = setTimeout(() => {
            cleanup()
            resolve()
        }, ms)
        signal?.addEventListener("abort", onAbort, { once: true })
    })
}

async function getResponseById(args: {
    url: string
    id: string
    apiKey: string
    fetchImpl: TOpenAiFetch
    signal?: AbortSignal
}): Promise<TOpenAiResponsesEnvelope> {
    let response: Response
    try {
        response = await args.fetchImpl(`${args.url}/${args.id}`, {
            method: "GET",
            headers: { Authorization: `Bearer ${args.apiKey}` },
            signal: args.signal,
        })
    } catch (err) {
        if (isAbortError(err)) throw err
        throw new TransientLlmError({
            message: `Network error polling OpenAI background response: ${
                err instanceof Error ? err.message : String(err)
            }`,
        })
    }
    if (response.status === 404) {
        // Response has aged out of the ~10-minute retention window or
        // was never stored. Surface as a typed error so callers can
        // clear the stored id and settle the stage as failed.
        throw new ResponseNotFoundError({ responseId: args.id })
    }
    if (!response.ok) {
        const errorBody = await response.text().catch(() => "")
        throw classifyHttpError(
            response.status,
            `OpenAI poll ${response.status.toString()}: ${
                errorBody || response.statusText
            }`
        )
    }
    return parseJsonOrThrowTransient(
        response,
        "OpenAI poll body was not valid JSON"
    )
}

// Intentionally takes no AbortSignal — cancel must fire even though the
// caller's signal has already aborted; passing the fired signal would
// abort the cancel itself.
async function cancelBackground(args: {
    url: string
    id: string
    apiKey: string
    fetchImpl: TOpenAiFetch
}): Promise<void> {
    // Best-effort + idempotent — swallow errors; the abort is surfaced
    // regardless of whether cancel succeeds.
    try {
        await args.fetchImpl(`${args.url}/${args.id}/cancel`, {
            method: "POST",
            headers: { Authorization: `Bearer ${args.apiKey}` },
        })
    } catch {
        // ignore
    }
}

function isTerminalBackgroundStatus(status: string | undefined): boolean {
    return (
        status === "completed" ||
        status === "failed" ||
        status === "incomplete" ||
        status === "cancelled"
    )
}

/**
 * Submit a single request with `{ background: true, stream: true,
 * store: true }` and consume the resulting SSE stream live, returning
 * the terminal envelope.
 *
 * A background response can only be streamed if it was *created* with
 * `stream: true` (a background-without-stream response is poll-only and
 * cannot later be streamed), so this mode uses one streaming create
 * call rather than a separate non-streaming submit POST. The response
 * id is therefore not in a JSON POST body — it arrives in the first
 * `response.created` SSE event. `onResponseId` fires the moment that
 * event is parsed (before the terminal event), so the caller can
 * persist the id while the call is still in flight.
 *
 * The response keeps generating server-side even if the connection
 * drops during stream consumption, and can be recovered via
 * `retrieveResponse` within the ~10-minute retention window. A
 * connection drop mid-stream (no terminal event before stream end) is
 * classified as a `TransientLlmError` so the framework's retry policy
 * applies — but because the id was already surfaced mid-flight, a
 * crashed in-flight call can be recovered rather than blindly re-run.
 */
async function runBackgroundStream(args: {
    url: string
    apiKey: string
    body: TOpenAiResponsesRequestBody
    fetchImpl: TOpenAiFetch
    signal?: AbortSignal
    onResponseId?: (responseId: string) => void
}): Promise<TOpenAiResponsesEnvelope> {
    if (args.signal?.aborted) throw abortError()

    const httpResponse = await callOnce({
        url: args.url,
        apiKey: args.apiKey,
        body: { ...args.body, background: true, stream: true, store: true },
        fetchImpl: args.fetchImpl,
        signal: args.signal,
    })

    return readSseEnvelope(httpResponse, args.onResponseId)
}

async function runBackground(args: {
    url: string
    apiKey: string
    body: TOpenAiResponsesRequestBody
    fetchImpl: TOpenAiFetch
    signal?: AbortSignal
    pollIntervalMs: number
}): Promise<TOpenAiResponsesEnvelope> {
    if (args.signal?.aborted) throw abortError()
    const submit = await callOnce({
        url: args.url,
        apiKey: args.apiKey,
        body: { ...args.body, background: true, store: true },
        fetchImpl: args.fetchImpl,
        signal: args.signal,
    })
    const submitEnvelope = await parseJsonOrThrowTransient(
        submit,
        "OpenAI background submit body was not valid JSON"
    )
    const id = submitEnvelope.id
    if (!id) {
        throw new TransientLlmError({
            message: "OpenAI background submit returned no response id.",
        })
    }
    // Fast-path: a small/cached request can come back already terminal on
    // submit — return it directly rather than issuing a redundant poll GET
    // (and avoid a `store`-expiry window between submit and first poll).
    if (isTerminalBackgroundStatus(submitEnvelope.status)) {
        if (submitEnvelope.status === "cancelled") throw abortError()
        return submitEnvelope
    }
    for (;;) {
        if (args.signal?.aborted) {
            await cancelBackground({
                url: args.url,
                id,
                apiKey: args.apiKey,
                fetchImpl: args.fetchImpl,
            })
            throw abortError()
        }
        let env: TOpenAiResponsesEnvelope
        try {
            env = await getResponseById({
                url: args.url,
                id,
                apiKey: args.apiKey,
                fetchImpl: args.fetchImpl,
                signal: args.signal,
            })
        } catch (err) {
            // Abort landing DURING an in-flight poll GET surfaces as an
            // AbortError from getResponseById (real fetch rejects the
            // in-flight request). The top-of-loop check alone would miss
            // it, so cancel here before re-throwing — this is what makes
            // the "AbortSignal → cancel POST" guarantee hold mid-poll.
            if (isAbortError(err)) {
                await cancelBackground({
                    url: args.url,
                    id,
                    apiKey: args.apiKey,
                    fetchImpl: args.fetchImpl,
                })
                throw abortError()
            }
            throw err
        }
        const status = env.status
        // Deliberately inlined rather than calling
        // `isTerminalBackgroundStatus`: `cancelled` is terminal too but
        // needs the opposite disposition (throw `abortError()` vs. return
        // the envelope), so the two terminal cases are split here.
        if (
            status === "completed" ||
            status === "failed" ||
            status === "incomplete"
        ) {
            return env
        }
        if (status === "cancelled") {
            throw abortError()
        }
        await abortableDelay(args.pollIntervalMs, args.signal)
    }
}

async function callOnce(args: {
    url: string
    apiKey: string
    body: TOpenAiResponsesRequestBody
    fetchImpl: TOpenAiFetch
    signal?: AbortSignal
}): Promise<Response> {
    let response: Response
    try {
        response = await args.fetchImpl(args.url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${args.apiKey}`,
            },
            body: JSON.stringify(args.body),
            signal: args.signal,
        })
    } catch (err) {
        // Aborts come through as a thrown error with `name === "AbortError"`
        // (DOM spec). Surface as-is so `llmStage`'s mid-flight-abort
        // detector turns it into `StageAbortedError`. Other low-level
        // fetch failures are transient.
        if (isAbortError(err)) {
            throw err
        }
        throw new TransientLlmError({
            message: `Network error calling OpenAI: ${
                err instanceof Error ? err.message : String(err)
            }`,
        })
    }

    if (response.ok) {
        return response
    }

    const errorBody = await response.text().catch(() => "")
    const message = `OpenAI Responses API ${response.status.toString()}: ${
        errorBody || response.statusText
    }`
    // Best-effort structured extraction of the provider error
    // code/type so a 429 can be split into persistent quota exhaustion
    // vs. transient throttling. Never throws on malformed bodies — an
    // unparseable body leaves `providerErrorCode` undefined, which
    // `classifyHttpError` treats as the safe transient default.
    let providerErrorCode: string | undefined
    try {
        const parsed = JSON.parse(errorBody) as {
            error?: { code?: string; type?: string }
        }
        providerErrorCode = parsed.error?.code ?? parsed.error?.type
    } catch {
        providerErrorCode = undefined
    }
    throw classifyHttpError(response.status, message, providerErrorCode)
}

function classifyHttpError(
    status: number,
    message: string,
    providerErrorCode?: string
): Error {
    if (status >= 500) {
        return new TransientLlmError({ message, status })
    }
    if (status === 429) {
        // 429 splits on the body's structured error code: persistent
        // budget exhaustion (`insufficient_quota`) is fail-fast, every
        // other (and every unparseable) 429 stays the transient
        // throttle. The safe default is always "transient + retryable"
        // — never a false quota trip.
        if (providerErrorCode === "insufficient_quota") {
            return new QuotaExhaustedLlmError({ message, status })
        }
        return new RateLimitLlmError({ message, status })
    }
    // 400 vs 422 split:
    //
    // OpenAI returns 400 for malformed requests — typically a
    // converter bug, an unsupported parameter, or a request shape
    // the API doesn't accept. Retrying a 400 just burns the second
    // attempt; classify as non-retryable so the framework surfaces
    // the error immediately.
    //
    // OpenAI returns 422 when the model's structured-output reply
    // failed server-side strict-mode validation. A re-roll can
    // sometimes succeed, so we route 422 through the
    // schema-validation class (which carries `retryReason:
    // "transient"` as the V1 retry workaround until the framework
    // grows a dedicated `schema_validation` retry tag).
    if (status === 400) {
        return new NonRetryableLlmError({ message, status })
    }
    if (status === 422) {
        return new SchemaValidationLlmError({ message, status })
    }
    return new NonRetryableLlmError({ message, status })
}

function isAbortError(err: unknown): boolean {
    return (
        typeof err === "object" &&
        err !== null &&
        (err as { name?: unknown }).name === "AbortError"
    )
}

// -- incomplete-reason → user-facing message ----------------------------
//
// Per-reason error messages for the `status: "incomplete"` branch.
// The message is the dev's first read when a stage fails — keep it
// actionable, name the cap reason verbatim, and (for the truncation
// case specifically) point at the override knob that fixes it.

function formatIncompleteMessage(reason: string): string {
    if (reason === "max_output_tokens") {
        return `OpenAI Responses API returned status: "incomplete" (reason: max_output_tokens). The model's output exceeded the per-call \`max_output_tokens\` cap (either an explicit value on the request or the model's default). Pass a larger \`maxOutputTokens\` to TLlmRequest, or set the stage-level \`maxOutputTokens\` on the llmStage factory (e.g., the \`createIngestionV2Pipeline({ llm: { overrides: { ... } } })\` surface).`
    }
    if (reason === "content_filter") {
        return `OpenAI Responses API returned status: "incomplete" (reason: content_filter). OpenAI's content policy refused to complete this output; the input or generated content was flagged. Retrying will not succeed — review the input text or the stage's prompt and re-request.`
    }
    return `OpenAI Responses API returned status: "incomplete" (reason: ${reason}). The model stopped before completing the response. See OpenAI Responses API documentation for the complete \`incomplete_details.reason\` enumeration.`
}

// -- response parsing --

const SSE_TERMINAL_EVENTS = new Set([
    "response.completed",
    "response.incomplete",
    "response.failed",
])

// The lifecycle event the Responses API emits first, before any output
// chunks. It carries the response object — including `.id` — so a
// streaming consumer learns the id while the call is still in flight.
const SSE_CREATED_EVENT = "response.created"

type TParsedSseEvent =
    | { kind: "terminal"; envelope: TOpenAiResponsesEnvelope }
    | { kind: "created"; responseId: string }
    | undefined

/**
 * Parse one SSE event block. Returns:
 *
 *   * `{ kind: "terminal", envelope }` for a terminal Responses-API
 *     event (`response.completed` / `.incomplete` / `.failed`),
 *     carrying the embedded full `response` envelope;
 *   * `{ kind: "created", responseId }` for the lifecycle
 *     `response.created` event, surfacing the response id the moment
 *     it is known (before any output);
 *   * `undefined` for every intermediate / unrecognized event.
 *
 * The events carry a `type` field inside the data JSON, so we key off
 * that and fall back to the SSE `event:` line.
 */
function parseSseEvent(raw: string): TParsedSseEvent {
    let eventType: string | undefined
    const dataLines: string[] = []
    for (const line of raw.split("\n")) {
        if (line.startsWith(":")) continue // SSE comment line — ignore.
        if (line.startsWith("event:")) {
            eventType = line.slice(6).trim()
        } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).replace(/^ /, ""))
        }
    }
    if (dataLines.length === 0) return undefined
    let parsed: { type?: string; response?: TOpenAiResponsesEnvelope }
    try {
        parsed = JSON.parse(dataLines.join("\n")) as {
            type?: string
            response?: TOpenAiResponsesEnvelope
        }
    } catch {
        return undefined
    }
    // Prefer the discriminator inside the data JSON (Responses-API
    // events carry `type` there); fall back to the SSE `event:` line so
    // the parser is robust if the API ever sends the type only there.
    // (No `[DONE]` sentinel handling — that is a Chat-Completions frame
    // the Responses API does not emit.)
    const type = parsed.type ?? eventType
    if (type && SSE_TERMINAL_EVENTS.has(type) && parsed.response) {
        return { kind: "terminal", envelope: parsed.response }
    }
    if (type === SSE_CREATED_EVENT && parsed.response?.id) {
        return { kind: "created", responseId: parsed.response.id }
    }
    return undefined
}

/**
 * Read an SSE `text/event-stream` body and return the envelope carried
 * by the terminal event. A stream that ends with no terminal event
 * (connection drop) throws `TransientLlmError` so the framework retries.
 * `AbortError` from the underlying reader propagates verbatim so
 * `llmStage` marks the stage `skipped`.
 *
 * `onResponseId`, when supplied, fires the moment the `response.created`
 * lifecycle event is parsed — i.e. while the call is still streaming,
 * before the terminal event arrives. This is the load-bearing seam for
 * background-stream mode: it lets a caller persist the response id
 * mid-flight so an in-flight call interrupted before completion can be
 * recovered from the upstream's stored copy. Invoked at most once.
 *
 * Note: the event-separator scan assumes LF (`\n\n`) framing, which the
 * OpenAI Responses API emits. Reuse against a strict CRLF-only SSE
 * server would need the separator scan adjusted to `\r\n\r\n`.
 */
async function readSseEnvelope(
    response: Response,
    onResponseId?: (responseId: string) => void
): Promise<TOpenAiResponsesEnvelope> {
    const body = response.body
    if (!body) {
        throw new TransientLlmError({
            message: "OpenAI streaming response carried no body.",
        })
    }
    const reader = body.getReader() as ReadableStreamDefaultReader<Uint8Array>
    const decoder = new TextDecoder()
    let buffer = ""
    let terminal: TOpenAiResponsesEnvelope | undefined
    let idSurfaced = false
    const handleEvent = (rawEvent: string): void => {
        const parsedEvent = parseSseEvent(rawEvent)
        if (!parsedEvent) return
        if (parsedEvent.kind === "terminal") {
            terminal = parsedEvent.envelope
            return
        }
        // kind === "created": surface the id once, the moment it's known.
        if (!idSurfaced) {
            idSurfaced = true
            onResponseId?.(parsedEvent.responseId)
        }
    }
    try {
        for (;;) {
            const chunk = await reader.read()
            if (chunk.done) break
            buffer += decoder.decode(chunk.value, { stream: true })
            let sep = buffer.indexOf("\n\n")
            while (sep !== -1) {
                const rawEvent = buffer.slice(0, sep)
                buffer = buffer.slice(sep + 2)
                handleEvent(rawEvent)
                sep = buffer.indexOf("\n\n")
            }
        }
    } catch (err) {
        if (isAbortError(err)) {
            throw err
        }
        throw new TransientLlmError({
            message: `OpenAI streaming read failed: ${
                err instanceof Error ? err.message : String(err)
            }`,
        })
    }
    // Flush any bytes the streaming decoder is still holding (an
    // incomplete multi-byte UTF-8 sequence at the final chunk boundary),
    // then scan for any remaining terminal frame.
    buffer += decoder.decode()
    let tailSep = buffer.indexOf("\n\n")
    while (tailSep !== -1) {
        const rawEvent = buffer.slice(0, tailSep)
        buffer = buffer.slice(tailSep + 2)
        handleEvent(rawEvent)
        tailSep = buffer.indexOf("\n\n")
    }
    if (!terminal) {
        throw new TransientLlmError({
            message:
                "OpenAI streaming ended without a terminal response event (connection drop?).",
        })
    }
    return terminal
}

type TParsedFunctionCall = {
    callId: string
    name: string
    arguments: string
}

function pickFunctionCalls(
    output: TOpenAiOutputItem[] | undefined
): TParsedFunctionCall[] {
    if (!output) return []
    const calls: TParsedFunctionCall[] = []
    for (const item of output) {
        if (item.type === "function_call") {
            /* eslint-disable @typescript-eslint/naming-convention */
            const fc = item as {
                call_id: string
                name: string
                arguments: string
            }
            /* eslint-enable @typescript-eslint/naming-convention */
            calls.push({
                callId: fc.call_id,
                name: fc.name,
                arguments: fc.arguments,
            })
        }
    }
    return calls
}

function extractAssistantText(
    output: TOpenAiOutputItem[] | undefined
): string | undefined {
    if (!output) return undefined
    for (const item of output) {
        if (item.type === "message") {
            const msg = item as {
                content?: { type?: string; text?: string }[]
            }
            const blocks = msg.content ?? []
            const textBlock = blocks.find(
                (b) => b.type === "output_text" || b.type === "text"
            )
            if (textBlock?.text !== undefined) {
                return textBlock.text
            }
        }
    }
    return undefined
}

function safeParseJson(raw: string): unknown {
    try {
        return JSON.parse(raw) as unknown
    } catch (err) {
        throw new SchemaValidationLlmError({
            message: `OpenAI returned malformed JSON in structured-output text: ${
                err instanceof Error ? err.message : String(err)
            }`,
        })
    }
}

function extractUsage(envelope: TOpenAiResponsesEnvelope): TLlmTokenUsage {
    const usage = envelope.usage
    if (!usage) return { input: 0, output: 0 }
    const result: TLlmTokenUsage = {
        input: usage.input_tokens ?? 0,
        output: usage.output_tokens ?? 0,
    }
    const reasoning = usage.output_tokens_details?.reasoning_tokens
    if (reasoning !== undefined) {
        result.reasoning = reasoning
    }
    return result
}

function mergeUsage(
    accumulated: TLlmTokenUsage,
    next: TLlmTokenUsage
): TLlmTokenUsage {
    const merged: TLlmTokenUsage = {
        input: accumulated.input + next.input,
        output: accumulated.output + next.output,
    }
    if (accumulated.reasoning !== undefined || next.reasoning !== undefined) {
        merged.reasoning = (accumulated.reasoning ?? 0) + (next.reasoning ?? 0)
    }
    return merged
}

// -- tool translation --

function translateTools(tools: readonly TToolSpec[]): TOpenAiTool[] {
    return tools.map((tool) => {
        switch (tool.kind) {
            case "web_search":
                return { type: "web_search" }
            case "file_search":
                return {
                    type: "file_search",
                    vector_store_ids: [tool.vectorStoreId],
                }
            case "mcp": {
                const out: TOpenAiTool = {
                    type: "mcp",
                    server_url: tool.serverUrl,
                }
                if (tool.toolName) {
                    return {
                        ...out,
                        allowed_tools: [tool.toolName],
                    }
                }
                return out
            }
            case "function":
                return {
                    type: "function",
                    name: tool.name,
                    description: tool.description,
                    parameters: typeboxToOpenAiSchema(tool.parameters),
                    strict: true,
                }
        }
    })
}

function findFunctionHandler(
    tools: readonly TToolSpec[] | undefined,
    name: string
): Extract<TToolSpec, { kind: "function" }> | undefined {
    if (!tools) return undefined
    for (const tool of tools) {
        if (tool.kind === "function" && tool.name === name) {
            return tool
        }
    }
    return undefined
}

// -- schema name derivation --

function deriveSchemaName(schema: TSchema): string {
    const id = (schema as { $id?: unknown }).$id
    if (typeof id === "string" && id.length > 0) {
        return sanitizeName(id)
    }
    const serialized = canonicalJson(schema)
    return `schema_${shortHash(serialized)}`
}

function sanitizeName(raw: string): string {
    // OpenAI requires schema names match `^[a-zA-Z0-9_-]{1,64}$`.
    const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64)
    return cleaned.length > 0 ? cleaned : "schema"
}

function canonicalJson(value: unknown): string {
    return JSON.stringify(value, (_key, v: unknown) => {
        if (v !== null && typeof v === "object" && !Array.isArray(v)) {
            const obj = v as Record<string, unknown>
            const sorted: Record<string, unknown> = {}
            for (const key of Object.keys(obj).sort()) {
                sorted[key] = obj[key]
            }
            return sorted
        }
        return v
    })
}

function shortHash(input: string): string {
    // Stable 12-hex-char hash. We avoid pulling `crypto.subtle` because
    // it's async and would force `deriveSchemaName` to be async too;
    // FNV-1a is sufficient for naming uniqueness within a process.
    let h1 = 0xcbf29ce4
    let h2 = 0x84222325
    for (let i = 0; i < input.length; i += 1) {
        const c = input.charCodeAt(i)
        h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
        h2 = Math.imul(h2 ^ c, 0x01000193) >>> 0
    }
    const hex1 = h1.toString(16).padStart(8, "0")
    const hex2 = h2.toString(16).padStart(8, "0")
    return (hex1 + hex2).slice(0, 12)
}
