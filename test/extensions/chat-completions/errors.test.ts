// Unit tests for the chat-completions provider's error classes + the
// `classifyHttpError` / `classifyFetchError` mappings.
//
// The framework classifies provider errors by the `retryReason` string
// tag on the thrown object (see `src/lib/pipelines/stage-helpers.ts`
// #classifyError) — NOT by class identity. So these tests assert the
// `retryReason` tag for each class and the status-family routing.
//
// Critical mapping rules:
//   * 5xx + network/fetch failures → Transient (retryable).
//   * 429 splits on the body code: `insufficient_quota` → quota-exhausted
//     (fail-fast); every other 429 → rate-limit.
//   * 400 + other 4xx → NonRetryable (a request-shape bug re-fails).
//   * 422 → SchemaValidation (model output failed schema; re-roll may
//     succeed).

import { describe, it, expect } from "vitest"
import {
    NonRetryableLlmError,
    QuotaExhaustedLlmError,
    RateLimitLlmError,
    SchemaValidationLlmError,
    TransientLlmError,
    classifyHttpError,
    classifyFetchError,
} from "../../../src/extensions/chat-completions/errors.js"

describe("chat-completions error classes — retryReason tags", () => {
    it("TransientLlmError is tagged transient", () => {
        expect(new TransientLlmError({ message: "x" }).retryReason).toBe(
            "transient"
        )
    })
    it("RateLimitLlmError is tagged rate_limit", () => {
        expect(new RateLimitLlmError({ message: "x" }).retryReason).toBe(
            "rate_limit"
        )
    })
    it("QuotaExhaustedLlmError is tagged quota_exhausted", () => {
        expect(new QuotaExhaustedLlmError({ message: "x" }).retryReason).toBe(
            "quota_exhausted"
        )
    })
    it("SchemaValidationLlmError is tagged transient (framework schema-retry path)", () => {
        expect(new SchemaValidationLlmError({ message: "x" }).retryReason).toBe(
            "transient"
        )
    })
    it("NonRetryableLlmError carries no retryReason tag", () => {
        expect(
            (
                new NonRetryableLlmError({ message: "x" }) as {
                    retryReason?: unknown
                }
            ).retryReason
        ).toBeUndefined()
    })
})

describe("classifyHttpError — status-family routing", () => {
    it("5xx → TransientLlmError", () => {
        expect(classifyHttpError(500, "boom")).toBeInstanceOf(TransientLlmError)
        expect(classifyHttpError(503, "loading")).toBeInstanceOf(
            TransientLlmError
        )
    })
    it("429 (no quota code) → RateLimitLlmError", () => {
        expect(classifyHttpError(429, "slow down")).toBeInstanceOf(
            RateLimitLlmError
        )
    })
    it("429 insufficient_quota → QuotaExhaustedLlmError", () => {
        expect(
            classifyHttpError(429, "quota", "insufficient_quota")
        ).toBeInstanceOf(QuotaExhaustedLlmError)
    })
    it("400 → NonRetryableLlmError (request-shape bug; do not burn a retry)", () => {
        expect(classifyHttpError(400, "bad request")).toBeInstanceOf(
            NonRetryableLlmError
        )
    })
    it("422 → SchemaValidationLlmError (model output failed schema; re-roll may succeed)", () => {
        expect(classifyHttpError(422, "unprocessable")).toBeInstanceOf(
            SchemaValidationLlmError
        )
    })
    it("401 → NonRetryableLlmError", () => {
        expect(classifyHttpError(401, "unauthorized")).toBeInstanceOf(
            NonRetryableLlmError
        )
    })
})

describe("classifyFetchError — network failures are transient", () => {
    it("a generic `fetch failed` TypeError → TransientLlmError", () => {
        const e = new TypeError("fetch failed")
        expect(classifyFetchError(e)).toBeInstanceOf(TransientLlmError)
    })
    it("an ECONNREFUSED-carrying error → TransientLlmError (server down/slow is retryable)", () => {
        const cause = Object.assign(new Error("connect ECONNREFUSED"), {
            code: "ECONNREFUSED",
        })
        const e = Object.assign(new TypeError("fetch failed"), { cause })
        expect(classifyFetchError(e)).toBeInstanceOf(TransientLlmError)
    })
})
