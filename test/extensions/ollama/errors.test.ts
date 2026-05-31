// Unit tests for the Ollama provider's error classes + the
// `classifyOllamaError` mapping.
//
// The framework classifies provider errors by the `retryReason` string
// tag on the thrown object (see `src/lib/pipelines/stage-helpers.ts`
// #classifyError) — NOT by class identity. So these tests assert the
// `retryReason` tag and the `code` (a `src/lib/pipelines/failure-codes`
// constant) for each Ollama failure mode.
//
// Critical mapping rules (reviewer P2):
//   * Context-overflow / model-eval error → NonRetryableLlmError
//     (deterministic; never SchemaValidationLlmError, which is tagged
//     `transient` and WOULD be retried — a guaranteed-failing 2nd hit).
//   * ECONNREFUSED (daemon down) → NonRetryable.
//   * model-not-pulled (404) → NonRetryable.
//   * ECONNRESET / socket drop → Transient.
//   * cold-VRAM-load 5xx → Transient.

import { describe, it, expect } from "vitest"
import {
    NonRetryableLlmError,
    RateLimitLlmError,
    SchemaValidationLlmError,
    ToolLoopExhaustedError,
    TransientLlmError,
    classifyOllamaError,
} from "../../../src/extensions/ollama/errors.js"
import {
    LLM_NON_RETRYABLE_ERROR,
    LLM_TRANSIENT_ERROR,
} from "../../../src/lib/pipelines/failure-codes.js"

// Helper to build an Error carrying a Node-style `code` and/or a
// `status` like the `ollama` SDK / undici surfaces.
function errWith(args: {
    message?: string
    code?: string
    status?: number
}): Error {
    const e = new Error(args.message ?? "boom") as Error & {
        code?: string
        status?: number
    }
    if (args.code !== undefined) e.code = args.code
    if (args.status !== undefined) e.status = args.status
    return e
}

describe("Ollama error classes — retryReason tags + codes", () => {
    it("TransientLlmError carries retryReason 'transient' and the transient code", () => {
        const e = new TransientLlmError({ message: "x" })
        expect(e.retryReason).toBe("transient")
        expect(e.code).toBe(LLM_TRANSIENT_ERROR)
    })

    it("NonRetryableLlmError has NO retryReason tag and the non-retryable code", () => {
        const e = new NonRetryableLlmError({ message: "x" })
        expect((e as { retryReason?: unknown }).retryReason).toBeUndefined()
        expect(e.code).toBe(LLM_NON_RETRYABLE_ERROR)
    })

    it("SchemaValidationLlmError is tagged 'transient' (framework schema-retry path)", () => {
        const e = new SchemaValidationLlmError({ message: "x" })
        expect(e.retryReason).toBe("transient")
    })

    it("RateLimitLlmError carries retryReason 'rate_limit'", () => {
        const e = new RateLimitLlmError({ message: "x" })
        expect(e.retryReason).toBe("rate_limit")
    })

    it("ToolLoopExhaustedError records the round cap and is non-retryable (no tag)", () => {
        const e = new ToolLoopExhaustedError({ message: "x", rounds: 6 })
        expect(e.rounds).toBe(6)
        expect((e as { retryReason?: unknown }).retryReason).toBeUndefined()
    })
})

describe("classifyOllamaError — failure-mode mapping", () => {
    it("ECONNREFUSED (daemon down) → NonRetryableLlmError with an actionable hint", () => {
        const result = classifyOllamaError(errWith({ code: "ECONNREFUSED" }))
        expect(result).toBeInstanceOf(NonRetryableLlmError)
        expect(result.message).toMatch(/ollama serve/i)
        expect(result.message).toMatch(/11434/)
    })

    it("model-not-pulled (404) → NonRetryableLlmError hinting `ollama pull`", () => {
        const result = classifyOllamaError(
            errWith({
                status: 404,
                message: 'model "qwen3.6:latest" not found, try pulling it',
            })
        )
        expect(result).toBeInstanceOf(NonRetryableLlmError)
        expect(result.message).toMatch(/ollama pull/i)
    })

    it("context-length overflow → NonRetryableLlmError, NEVER SchemaValidationLlmError", () => {
        const result = classifyOllamaError(
            errWith({
                message:
                    "input length exceeds the maximum context length for this model",
            })
        )
        expect(result).toBeInstanceOf(NonRetryableLlmError)
        expect(result).not.toBeInstanceOf(SchemaValidationLlmError)
        // Must NOT carry a retry tag — a retry re-fails deterministically.
        expect(
            (result as { retryReason?: unknown }).retryReason
        ).toBeUndefined()
    })

    it("ECONNRESET / mid-stream socket drop → TransientLlmError", () => {
        const result = classifyOllamaError(errWith({ code: "ECONNRESET" }))
        expect(result).toBeInstanceOf(TransientLlmError)
        expect((result as TransientLlmError).retryReason).toBe("transient")
    })

    it("cold-VRAM-load 5xx (model pulled but loading) → TransientLlmError", () => {
        const result = classifyOllamaError(
            errWith({ status: 503, message: "model is loading" })
        )
        expect(result).toBeInstanceOf(TransientLlmError)
        expect((result as TransientLlmError).retryReason).toBe("transient")
    })

    it("generic 500 → TransientLlmError", () => {
        const result = classifyOllamaError(errWith({ status: 500 }))
        expect(result).toBeInstanceOf(TransientLlmError)
    })

    it("an unknown/unclassifiable error → NonRetryableLlmError (safe default, fail fast)", () => {
        const result = classifyOllamaError(errWith({ message: "weird" }))
        expect(result).toBeInstanceOf(NonRetryableLlmError)
    })

    it("a fetch-failure wrapper with ECONNREFUSED cause → NonRetryable (daemon down)", () => {
        // undici surfaces a connection refusal as a `TypeError: fetch
        // failed` whose `.cause` carries the ECONNREFUSED code.
        const cause = errWith({ code: "ECONNREFUSED" })
        const wrapper = new Error("fetch failed") as Error & { cause?: unknown }
        wrapper.cause = cause
        const result = classifyOllamaError(wrapper)
        expect(result).toBeInstanceOf(NonRetryableLlmError)
        expect(result.message).toMatch(/ollama serve/i)
    })

    it("undici UND_ERR_HEADERS_TIMEOUT (direct code) → TransientLlmError (transient)", () => {
        const result = classifyOllamaError(
            errWith({ code: "UND_ERR_HEADERS_TIMEOUT" })
        )
        expect(result).toBeInstanceOf(TransientLlmError)
        expect((result as TransientLlmError).retryReason).toBe("transient")
        expect(result.code).toBe(LLM_TRANSIENT_ERROR)
    })

    it("undici UND_ERR_BODY_TIMEOUT (direct code) → TransientLlmError", () => {
        const result = classifyOllamaError(
            errWith({ code: "UND_ERR_BODY_TIMEOUT" })
        )
        expect(result).toBeInstanceOf(TransientLlmError)
        expect((result as TransientLlmError).retryReason).toBe("transient")
    })

    it("undici UND_ERR_CONNECT_TIMEOUT (direct code) → TransientLlmError", () => {
        const result = classifyOllamaError(
            errWith({ code: "UND_ERR_CONNECT_TIMEOUT" })
        )
        expect(result).toBeInstanceOf(TransientLlmError)
        expect((result as TransientLlmError).retryReason).toBe("transient")
    })

    it("a `fetch failed` wrapper whose .cause.code is UND_ERR_HEADERS_TIMEOUT → Transient (the real-world v2 fan-out failure)", () => {
        const cause = errWith({ code: "UND_ERR_HEADERS_TIMEOUT" })
        const wrapper = new Error("fetch failed") as Error & { cause?: unknown }
        wrapper.cause = cause
        const result = classifyOllamaError(wrapper)
        expect(result).toBeInstanceOf(TransientLlmError)
        expect((result as TransientLlmError).retryReason).toBe("transient")
    })
})
