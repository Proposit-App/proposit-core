// Extension-internal wire-format types for the OpenAI Responses API.
//
// These types model the subset of the Responses API the provider
// touches: the request body shape, the response envelope, and the
// per-content-block discriminants we need to read. They are not
// re-exported from the extension barrel — `createOpenAiResponsesProvider`
// is the only public surface; consumers should never inspect these
// shapes directly.
//
// The types are intentionally permissive (every nested field is
// optional / `unknown`) because OpenAI evolves the API frequently
// and we want a `JSON.parse` of an unexpected payload to surface as
// a missing-field error in our own parsing code rather than as a
// TypeScript compile error in dependents.
//
// Property names here are *wire* names dictated by the OpenAI API
// (snake_case); the in-repo brain-style camelCase rule does not
// apply to external wire formats.
/* eslint-disable @typescript-eslint/naming-convention */

export type TOpenAiInputMessage =
    | { role: "system" | "user" | "assistant"; content: string }
    | {
          type: "function_call_output"
          call_id: string
          output: string
      }

export type TOpenAiTool =
    | { type: "web_search" }
    | { type: "file_search"; vector_store_ids: string[] }
    | { type: "mcp"; server_url: string; allowed_tools?: string[] }
    | {
          type: "function"
          name: string
          description: string
          parameters: Record<string, unknown>
          strict?: boolean
      }

export type TOpenAiTextFormat = {
    type: "json_schema"
    name: string
    schema: Record<string, unknown>
    strict: true
}

export type TOpenAiResponsesRequestBody = {
    model: string
    input: TOpenAiInputMessage[]
    text: { format: TOpenAiTextFormat }
    tools?: TOpenAiTool[]
    max_output_tokens?: number
    reasoning?: { effort: "minimal" | "low" | "medium" | "high" }
}

export type TOpenAiOutputContentBlock = {
    type?: string
    text?: string
}

export type TOpenAiOutputItem =
    | {
          type: "message"
          role?: string
          content?: TOpenAiOutputContentBlock[]
      }
    | {
          type: "function_call"
          call_id: string
          name: string
          arguments: string
      }
    | {
          // Built-in tool surface — model has already incorporated
          // the result into the message stream. We don't need to act
          // on these; they appear alongside `type: "message"`.
          type: string
          [field: string]: unknown
      }

export type TOpenAiResponsesEnvelope = {
    id?: string
    output?: TOpenAiOutputItem[]
    usage?: {
        input_tokens?: number
        output_tokens?: number
        output_tokens_details?: { reasoning_tokens?: number }
    }
    error?: { message?: string; code?: string }
}

export type TOpenAiFetch = (url: string, init: RequestInit) => Promise<Response>
