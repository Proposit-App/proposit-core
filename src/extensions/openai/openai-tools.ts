// Translation of the framework's `TToolSpec` discriminated union into
// the OpenAI Responses-API tool wire format, plus the structured-output
// schema-name derivation (a stable, OpenAI-name-safe identifier for each
// response schema). These are pure helpers with no captured state.

import type { TSchema } from "typebox"
import type { TToolSpec } from "../../lib/llm/types.js"
import { typeboxToOpenAiSchema } from "./structured-output.js"
import type { TOpenAiTool } from "./types.js"

// -- tool translation --

export function translateTools(tools: readonly TToolSpec[]): TOpenAiTool[] {
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

export function findFunctionHandler(
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

export function deriveSchemaName(schema: TSchema): string {
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
