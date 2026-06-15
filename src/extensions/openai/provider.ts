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

import type {
    TLlmProvider,
    TLlmRequest,
    TLlmResponse,
    TLlmTokenUsage,
} from "../../lib/llm/types.js"
import {
    debugLlmFailure,
    debugLlmRequest,
    debugLlmResponse,
} from "../../lib/pipelines/debug-log.js"
import { typeboxToOpenAiSchema } from "./structured-output.js"
import {
    deriveSchemaName,
    findFunctionHandler,
    translateTools,
} from "./openai-tools.js"
import {
    callOnce,
    fetchResponseEnvelope,
    getResponseById,
    parseJsonOrThrowTransient,
    resolveFetch,
} from "./openai-http.js"
import {
    classifyHttpError,
    formatIncompleteMessage,
    NonRetryableLlmError,
    ResponseNotFoundError,
    ToolLoopExhaustedError,
    TransientLlmError,
} from "./errors.js"
import type {
    TOpenAiFetch,
    TOpenAiInputMessage,
    TOpenAiResponsesEnvelope,
    TOpenAiResponsesRequestBody,
} from "./types.js"
import {
    extractAssistantText,
    extractUsage,
    isAbortError,
    mergeUsage,
    pickFunctionCalls,
    readSseEnvelope,
    safeParseJson,
} from "./openai-parsing.js"

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
    /**
     * The envelope's `incomplete_details.reason`, present when
     * `status === "incomplete"` (e.g. `max_output_tokens`,
     * `content_filter`). Lets a completion-side consumer classify an
     * incomplete response without re-deriving it. Additive (since
     * v1.11.0).
     */
    incompleteReason?: string
    /**
     * The envelope's `error.message`, present when `status === "failed"`.
     * Additive (since v1.11.0).
     */
    errorMessage?: string
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

/**
 * Submit a background OpenAI response and return its `responseId` +
 * submit-time `status` **without polling or streaming to completion**.
 *
 * This is the submit-only half of the existing `backgroundMode`
 * (`runBackground`): it POSTs `{ background: true, store: true }`, parses
 * the submit envelope, and returns immediately — the caller drives the
 * response to completion later via {@link retrieveResponse} (typically
 * after a durable suspend keyed on the returned `responseId`). It is the
 * provider capability the pipeline's `launchStage` needs.
 *
 * **Terminal-on-submit fast-path:** a small/cached request can come back
 * already terminal (`completed`/`failed`/`incomplete`/`cancelled`) on the
 * submit POST. This function still returns `{ responseId, status }` for
 * that case (no throw, no poll); the caller proceeds to
 * `retrieveResponse(responseId)`, which sees the terminal state
 * immediately.
 *
 * **No-tools precondition:** background mode does not support function
 * tools in V1 — a tool-bearing request throws {@link NonRetryableLlmError},
 * matching `respond`'s background guard.
 *
 * @param req - The structured-output request (system/user prompts +
 *   `outputSchema` + model knobs). Tools are rejected.
 * @param options - `apiKey`, optional `baseUrl`, `fetch`, and `signal`.
 */
export async function submitBackgroundResponse<T>(
    req: TLlmRequest<T>,
    options: {
        apiKey: string
        baseUrl?: string
        fetch?: TOpenAiFetch
        signal?: AbortSignal
    }
): Promise<{ responseId: string; status: TResponseStatus }> {
    if (req.tools && req.tools.length > 0) {
        throw new NonRetryableLlmError({
            message:
                "OpenAI background mode does not support function tools in V1. Disable backgroundMode / backgroundStreamMode for tool-using requests, or run the tools synchronously.",
        })
    }

    const fetchImpl = resolveFetch(options.fetch, "submitBackgroundResponse")
    const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL

    const schemaName = deriveSchemaName(req.outputSchema)
    const convertedSchema = typeboxToOpenAiSchema(req.outputSchema)

    const body: TOpenAiResponsesRequestBody = {
        model: req.model,
        input: [
            { role: "system", content: req.systemPrompt },
            { role: "user", content: req.userMessage },
        ],
        text: {
            format: {
                type: "json_schema",
                name: schemaName,
                strict: true,
                schema: convertedSchema,
            },
        },
        background: true,
        store: true,
    }
    if (req.maxOutputTokens !== undefined) {
        body.max_output_tokens = req.maxOutputTokens
    }
    if (req.reasoningEffort) {
        body.reasoning = { effort: req.reasoningEffort }
    }

    const submit = await callOnce({
        url: baseUrl,
        apiKey: options.apiKey,
        body,
        fetchImpl,
        signal: req.signal ?? options.signal,
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
    // Return at submit — including the terminal-on-submit fast-path. Unlike
    // `runBackground`, a `cancelled` submit envelope is NOT thrown here: the
    // submit-only contract returns every terminal status, and the caller's
    // completion step classifies it (a cancelled response settles as a skip).
    return {
        responseId: id,
        status: (submitEnvelope.status ?? "queued") as TResponseStatus,
    }
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
    // Surface the incomplete reason / error message so a completion-side
    // consumer (e.g. `completeStage`) can classify the outcome.
    const incompleteReason = envelope.incomplete_details?.reason
    if (incompleteReason !== undefined) {
        result.incompleteReason = incompleteReason
    }
    const errorMessage = envelope.error?.message
    if (errorMessage !== undefined) {
        result.errorMessage = errorMessage
    }
    return result
}
