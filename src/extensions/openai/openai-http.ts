// HTTP transport for the OpenAI Responses API: the single-call POST,
// the foreground/background dispatch, the submit-then-poll background
// loop, and the background-stream create. These functions own the wire
// interaction (fetch, headers, abort handling, status classification);
// they return the parsed `TOpenAiResponsesEnvelope` and leave the
// retrieval-shaped projection to the layer above.
//
// Layering: this module sits above `openai-parsing.ts` (it consumes
// `readSseEnvelope` / `isAbortError`) and `errors.ts` (error classes +
// `classifyHttpError`); nothing here imports from `provider.ts` or
// `openai-retrieval.ts`, keeping the dependency graph acyclic.

import { isAbortError, readSseEnvelope } from "./openai-parsing.js"
import {
    classifyHttpError,
    ResponseNotFoundError,
    TransientLlmError,
} from "./errors.js"
import type {
    TOpenAiFetch,
    TOpenAiResponsesEnvelope,
    TOpenAiResponsesRequestBody,
} from "./types.js"

export function resolveFetch(
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

// -- HTTP --

export async function fetchResponseEnvelope(args: {
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

export async function parseJsonOrThrowTransient(
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

export async function getResponseById(args: {
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

export async function callOnce(args: {
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
