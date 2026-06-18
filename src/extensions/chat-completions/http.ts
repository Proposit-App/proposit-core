// Raw-fetch HTTP transport for an OpenAI-compatible
// `/v1/chat/completions` endpoint: a single POST of JSON, a per-request
// timeout enforced via `AbortSignal.timeout` (composed with the caller's
// abort signal so a mid-flight cancel still propagates), and non-2xx →
// error-class classification. No SSE, no background poll — this provider
// is synchronous. The timeout is a standard `AbortSignal.timeout` with
// no extra HTTP-stack dependency.

import {
    classifyFetchError,
    classifyHttpError,
    TransientLlmError,
} from "./errors.js"
import type {
    TChatCompletionsFetch,
    TChatCompletionsResponse,
} from "./types.js"

function isAbortError(err: unknown): boolean {
    return (
        typeof err === "object" &&
        err !== null &&
        (err as { name?: unknown }).name === "AbortError"
    )
}

// Compose the caller's AbortSignal with a timeout signal so EITHER one
// aborts the request. `AbortSignal.any` / `AbortSignal.timeout` are
// available on the supported Node floor (>=22). When no timeout is
// configured (timeoutMs <= 0) and no caller signal is present, returns
// undefined (no abort).
function resolveSignal(
    callerSignal: AbortSignal | undefined,
    timeoutMs: number
): AbortSignal | undefined {
    const timeoutSignal =
        timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined
    if (callerSignal && timeoutSignal) {
        return AbortSignal.any([callerSignal, timeoutSignal])
    }
    return callerSignal ?? timeoutSignal
}

export async function requestJson(args: {
    url: string
    apiKey: string
    body: unknown
    fetchImpl: TChatCompletionsFetch
    signal?: AbortSignal
    timeoutMs: number
}): Promise<TChatCompletionsResponse> {
    const signal = resolveSignal(args.signal, args.timeoutMs)
    let response: Response
    try {
        response = await args.fetchImpl(args.url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${args.apiKey}`,
            },
            body: JSON.stringify(args.body),
            signal,
        })
    } catch (err) {
        // A caller-initiated abort propagates verbatim so `llmStage`'s
        // mid-flight-abort detector marks the stage skipped. A timeout
        // (the AbortSignal.timeout firing) or any other transport
        // failure is transient.
        if (isAbortError(err) && args.signal?.aborted) {
            throw err
        }
        throw classifyFetchError(err)
    }

    if (!response.ok) {
        const errorBody = await response.text().catch(() => "")
        const message = `Chat-completions endpoint ${response.status.toString()}: ${
            errorBody || response.statusText
        }`
        // Best-effort structured extraction of the provider error
        // code/type so a 429 can be split into persistent quota
        // exhaustion vs. transient throttling. An unparseable body leaves
        // `providerErrorCode` undefined, which `classifyHttpError` treats
        // as the safe transient default.
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

    return response
        .json()
        .then((j) => j as TChatCompletionsResponse)
        .catch((err: unknown) => {
            throw new TransientLlmError({
                message: `Chat-completions response body was not valid JSON: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            })
        })
}
