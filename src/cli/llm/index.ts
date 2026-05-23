// CLI-side LLM factory.
//
// Slice 1B moved the concrete OpenAI provider into
// `src/extensions/openai/`. This module now provides only the CLI's
// API-key resolution + the named-provider factory; the provider
// itself is constructed from `createOpenAiResponsesProvider` in the
// extensions tree. Callers should depend on `TLlmProvider` (from
// `src/lib/llm/`) as their provider contract, not on this CLI
// factory's shape.

import {
    createOpenAiResponsesProvider,
    type TCreateOpenAiResponsesProviderOptions,
} from "../../extensions/openai/index.js"
import type { TLlmProvider } from "../../lib/llm/index.js"

export const OPENAI_API_KEY_ENV = "OPENAI_API_KEY"

const PROVIDER_ENV_VARS: Record<string, string> = {
    openai: OPENAI_API_KEY_ENV,
}

export function resolveApiKey(providerName: string, explicit?: string): string {
    if (explicit) return explicit
    const envVar = PROVIDER_ENV_VARS[providerName]
    if (envVar) {
        const value = process.env[envVar]
        if (value) return value
    }
    const envHint = envVar ? ` or set ${envVar}` : ""
    throw new Error(
        `No API key provided for "${providerName}". Use --api-key${envHint}.`
    )
}

export type TCliLlmProviderOptions = Pick<
    TCreateOpenAiResponsesProviderOptions,
    "apiKey" | "baseUrl"
>

export function createLlmProvider(
    name: string,
    options: TCliLlmProviderOptions
): TLlmProvider {
    switch (name) {
        case "openai":
            return createOpenAiResponsesProvider({
                apiKey: options.apiKey,
                baseUrl: options.baseUrl,
            })
        default:
            throw new Error(
                `Unknown LLM provider "${name}". Supported: openai.`
            )
    }
}
