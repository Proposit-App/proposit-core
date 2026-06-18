// Concrete `TLlmProvider` backed by an OpenAI-compatible
// `/v1/chat/completions` endpoint (a local llama-server by default, or
// any OpenAI-compatible chat backend by swapping baseUrl + token).
//
// Synchronous, structured-output-only:
//   * One POST to `{baseUrl}/chat/completions` via raw `fetch` (the
//     `./http.ts` `requestJson` helper) — no SSE, no background/poll, no
//     mid-flight responseId. `TLlmProvider.respond` is the whole surface;
//     the optional `onResponseCreated` hook is left uncalled (a
//     synchronous provider never learns an id mid-flight), which is
//     contract-legal — the same posture the prior local provider took.
//   * Structured output via the lax `typeboxToJsonSchema` converter under
//     a `response_format: { type: "json_schema", json_schema: { ... } }`.
//   * `reasoningEffort` is ignored (no chat-completions analogue);
//     `maxOutputTokens` maps to `max_tokens` (positive values only).
//   * Function tools are NOT supported — a request carrying `tools` fails
//     fast with `NonRetryableLlmError`. This provider serves the
//     structured-output ingestion path, which uses no tools, so there is
//     no multi-round tool loop to port.
//   * `requestTimeoutMs` is enforced via `AbortSignal.timeout` inside
//     `requestJson` — no extra HTTP-stack dependency.
//
// Error classification routes HTTP-status families + fetch failures into
// the framework-recognized error classes (see `./errors.ts`). The
// framework's `llmStage` retry policy classifies via the `retryReason`
// tag on the thrown error.

import type { TSchema } from "typebox"
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
import { typeboxToJsonSchema } from "./structured-output.js"
import { requestJson } from "./http.js"
import { NonRetryableLlmError, SchemaValidationLlmError } from "./errors.js"
import {
    DEFAULT_API_KEY,
    DEFAULT_BASE_URL,
    DEFAULT_REQUEST_TIMEOUT_MS,
    type TChatCompletionsFetch,
    type TChatCompletionsProviderConfig,
    type TChatCompletionsRequestBody,
} from "./types.js"

const STAGE_ID_MARKER = /<!--\s*stage-id:\s*([^\s>]+)\s*-->/

export type TCreateChatCompletionsProviderOptions =
    TChatCompletionsProviderConfig

function abortError(): Error {
    const e = new Error("The chat-completions request was aborted.")
    e.name = "AbortError"
    return e
}

// Derive the `json_schema.name` from the schema's `$id` (sanitized to the
// `^[a-zA-Z0-9_-]{1,64}$` shape OpenAI-compatible servers accept), or a
// stable default when the schema is anonymous.
function deriveSchemaName(schema: TSchema): string {
    const id = (schema as { $id?: unknown }).$id
    if (typeof id === "string" && id.length > 0) {
        const cleaned = id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64)
        if (cleaned.length > 0) return cleaned
    }
    return "structured_output"
}

export function createChatCompletionsProvider(
    options?: TChatCompletionsProviderConfig
): TLlmProvider {
    const config = options ?? {}
    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL
    const url = `${baseUrl}/chat/completions`
    const apiKey = config.apiKey ?? DEFAULT_API_KEY
    const timeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    const fetchImpl =
        config.fetch ?? (globalThis.fetch as TChatCompletionsFetch | undefined)
    if (!fetchImpl) {
        throw new Error(
            "createChatCompletionsProvider: no fetch implementation available. Pass `fetch` explicitly or run in an environment that provides `globalThis.fetch` (Node ≥18, modern browsers, Expo)."
        )
    }

    const respond = async <T>(
        req: TLlmRequest<T>
    ): Promise<TLlmResponse<T>> => {
        if (req.signal?.aborted) {
            throw abortError()
        }
        if (req.tools && req.tools.length > 0) {
            throw new NonRetryableLlmError({
                message:
                    "The chat-completions provider does not support function tools — it serves structured-output requests only. Remove `tools` from the request or use a tool-capable provider.",
            })
        }

        const stageIdMatch = STAGE_ID_MARKER.exec(req.systemPrompt)
        const debugStageId = stageIdMatch ? stageIdMatch[1] : null
        const convertedSchema = typeboxToJsonSchema(req.outputSchema)

        const body: TChatCompletionsRequestBody = {
            model: req.model,
            messages: [
                { role: "system", content: req.systemPrompt },
                { role: "user", content: req.userMessage },
            ],
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: deriveSchemaName(req.outputSchema),
                    schema: convertedSchema,
                },
            },
            // Deterministic structured output.
            temperature: 0,
        }
        // `max_tokens`, positive only: 0 means "generate nothing".
        if (req.maxOutputTokens !== undefined && req.maxOutputTokens > 0) {
            body.max_tokens = req.maxOutputTokens
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

        let response
        try {
            response = await requestJson({
                url,
                apiKey,
                body,
                fetchImpl,
                signal: req.signal,
                timeoutMs,
            })
        } catch (err) {
            // Honor a mid-flight abort: surface a clean AbortError so
            // `llmStage`'s detector marks the stage skipped rather than
            // failed. Other errors are already framework-classified by
            // `requestJson`; re-throw them.
            if (
                req.signal?.aborted ||
                (err instanceof Error && err.name === "AbortError")
            ) {
                throw abortError()
            }
            const classified =
                err instanceof Error ? err : new Error(String(err))
            debugLlmFailure({
                stageId: debugStageId,
                model: req.model,
                errorName: classified.name,
                errorMessage: classified.message,
                tokenUsage: { input: 0, output: 0 },
            })
            throw classified
        }

        const tokenUsage: TLlmTokenUsage = {
            input: response.usage?.prompt_tokens ?? 0,
            output: response.usage?.completion_tokens ?? 0,
        }
        const text = response.choices?.[0]?.message?.content
        if (text === undefined || text === "") {
            debugLlmFailure({
                stageId: debugStageId,
                model: req.model,
                errorName: "SchemaValidationLlmError",
                errorMessage: "no assistant content",
                tokenUsage,
            })
            throw new SchemaValidationLlmError({
                message:
                    "The chat-completions endpoint returned no assistant content.",
            })
        }
        let parsed: unknown
        try {
            parsed = JSON.parse(text) as unknown
        } catch (err) {
            debugLlmFailure({
                stageId: debugStageId,
                model: req.model,
                errorName: "SchemaValidationLlmError",
                errorMessage: err instanceof Error ? err.message : String(err),
                rawText: text,
                tokenUsage,
            })
            throw new SchemaValidationLlmError({
                message: `The chat-completions endpoint returned malformed JSON in structured-output content: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            })
        }
        debugLlmResponse({
            stageId: debugStageId,
            outputTextLen: text.length,
            tokenUsage,
        })
        return {
            output: parsed as T,
            tokenUsage,
            // A chat-completions response carries no durable response id we
            // surface; `rawResponseId` is optional, so leave it undefined.
            rawResponseId: undefined,
        }
    }

    return { respond }
}
