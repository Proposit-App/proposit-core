// Public retrieval API for stored OpenAI Responses: retrieve a stored
// response by id, reconnect-and-stream a dropped background response to
// completion, cancel an in-flight response, and submit a background
// response without polling. These are the resync surfaces a consumer
// drives after a durable suspend.
//
// Layering: this module sits alongside `provider.ts` (neither imports
// the other) and above `openai-http.ts` / `openai-parsing.ts`, from
// which it consumes the transport and parsing helpers.

import type { TLlmRequest } from "../../lib/llm/types.js"
import {
    callOnce,
    getResponseById,
    parseJsonOrThrowTransient,
    resolveFetch,
} from "./openai-http.js"
import {
    extractAssistantText,
    extractUsage,
    isAbortError,
    readSseEnvelope,
} from "./openai-parsing.js"
import { deriveSchemaName } from "./openai-tools.js"
import { typeboxToOpenAiSchema } from "./structured-output.js"
import {
    classifyHttpError,
    NonRetryableLlmError,
    ResponseNotFoundError,
    TransientLlmError,
} from "./errors.js"
import {
    DEFAULT_BASE_URL,
    type TOpenAiFetch,
    type TOpenAiResponsesEnvelope,
    type TOpenAiResponsesRequestBody,
} from "./types.js"

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
