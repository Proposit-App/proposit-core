export type {
    TLlmCompletionRequest,
    TLlmProvider,
    TLlmProviderOptions,
} from "./types.js"
export { createOpenAiProvider, OPENAI_API_KEY_ENV } from "./openai.js"

import { createOpenAiProvider, OPENAI_API_KEY_ENV } from "./openai.js"
import type { TLlmProvider, TLlmProviderOptions } from "./types.js"

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

export function createLlmProvider(
    name: string,
    options: TLlmProviderOptions
): TLlmProvider {
    switch (name) {
        case "openai":
            return createOpenAiProvider(options)
        default:
            throw new Error(
                `Unknown LLM provider "${name}". Supported: openai.`
            )
    }
}
