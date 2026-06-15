// SSE stream reading and Responses-API envelope/output parsing for the
// OpenAI provider. These are pure, transport-agnostic helpers: given an
// HTTP `Response` (for streaming) or a parsed envelope, they extract the
// terminal envelope, assistant text, function calls, and token usage.
//
// `isAbortError` lives here as the lowest-level shared abort predicate —
// `readSseEnvelope` needs it, and the HTTP and retrieval layers (which
// sit above this module) import it down.

import type { TLlmTokenUsage } from "../../lib/llm/types.js"
import { SchemaValidationLlmError, TransientLlmError } from "./errors.js"
import type { TOpenAiOutputItem, TOpenAiResponsesEnvelope } from "./types.js"

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
export async function readSseEnvelope(
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

export function pickFunctionCalls(
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

export function extractAssistantText(
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

export function safeParseJson(raw: string): unknown {
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

export function extractUsage(
    envelope: TOpenAiResponsesEnvelope
): TLlmTokenUsage {
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

export function mergeUsage(
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

export function isAbortError(err: unknown): boolean {
    return (
        typeof err === "object" &&
        err !== null &&
        (err as { name?: unknown }).name === "AbortError"
    )
}
