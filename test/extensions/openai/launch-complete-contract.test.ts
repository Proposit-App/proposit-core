// Drift-guard contract test for the launch/complete classification.
//
// `completeStage` (in `src/lib/pipelines/`) cannot import the OpenAI
// provider's classifier (the zero-SDK-import invariant), so its
// status/reason -> outcome+retry mapping is a deliberate `lib/`-side
// MIRROR of the provider's classification, carved into the package-
// internal `validateLlmOutcome`. This test pins the mirror to the
// provider: for each `(status, incompleteReason)` envelope, it drives the
// real `provider.respond()` (background mode, terminal-on-submit) and
// derives the provider's `(outcome, retryReason)` from what it
// throws/returns, then asserts `validateLlmOutcome` maps the SAME envelope
// to the SAME `(outcome, retryReason)`. A future provider-classification
// change the mirror misses fails CI here.

import { describe, it, expect, vi } from "vitest"
import Type from "typebox"
import { createOpenAiResponsesProvider } from "../../../src/extensions/openai/provider.js"
import type { TOpenAiFetch } from "../../../src/extensions/openai/types.js"
import {
    llmStage,
    readLlmStageConfig,
    validateLlmOutcome,
} from "../../../src/lib/pipelines/stage-helpers.js"
import type { TRetryReason } from "../../../src/lib/pipelines/stage-helpers.js"
import type { TResponseStatus } from "../../../src/lib/llm/types.js"

const outputSchema = Type.Object({ value: Type.Number() })

function asFetch(mock: ReturnType<typeof vi.fn>): TOpenAiFetch {
    return mock as unknown as TOpenAiFetch
}

// A terminal-on-submit envelope so background mode returns without polling.
function terminalEnvelope(body: {
    status: string
    incompleteReason?: string
    errorMessage?: string
    outputText?: string
}): Response {
    const json: Record<string, unknown> = {
        id: "resp_contract",
        status: body.status,
    }
    if (body.incompleteReason) {
        json.incomplete_details = { reason: body.incompleteReason }
    }
    if (body.errorMessage) json.error = { message: body.errorMessage }
    if (body.outputText !== undefined) {
        json.output = [
            {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: body.outputText }],
            },
        ]
    }
    json.usage = { input_tokens: 1, output_tokens: 1 }
    return new Response(JSON.stringify(json), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    })
}

// Derive the provider's classification of an envelope into the same
// (outcome, retryReason) shape `completeStage` reports — by running
// provider.respond() and inspecting what it throws/returns. This is the
// independent "source of truth" the mirror is compared against.
async function providerClassification(envelope: Response): Promise<{
    outcome: "completed" | "failed" | "skipped"
    retryReason: TRetryReason | undefined
}> {
    const fetchMock = vi.fn(() => Promise.resolve(envelope.clone()))
    const provider = createOpenAiResponsesProvider({
        apiKey: "k",
        backgroundMode: true,
        fetch: asFetch(fetchMock),
    })
    try {
        await provider.respond({
            model: "gpt-5.4",
            systemPrompt: "sys",
            userMessage: "u",
            outputSchema,
        })
        return { outcome: "completed", retryReason: undefined }
    } catch (err) {
        // An AbortError (a cancelled background response) maps to a
        // `skipped` stage with no retryReason in the in-process path.
        if ((err as { name?: string }).name === "AbortError") {
            return { outcome: "skipped", retryReason: undefined }
        }
        // The framework classifies by the `retryReason` tag; absence means
        // non-retryable (fail-fast — no retryReason surfaced).
        const tag = (err as { retryReason?: unknown }).retryReason
        const retryReason =
            tag === "transient" ||
            tag === "rate_limit" ||
            tag === "quota_exhausted"
                ? (tag as TRetryReason)
                : undefined
        return { outcome: "failed", retryReason }
    }
}

function mirrorClassification(
    rawText: string | undefined,
    status: TResponseStatus,
    incompleteReason: string | undefined
): {
    outcome: "completed" | "failed" | "skipped"
    retryReason: TRetryReason | undefined
} {
    const cfg = readLlmStageConfig(
        llmStage<{ value: number }>({
            id: "c",
            dependsOn: [],
            outputSchema,
            model: "mock",
            buildPrompt: () => ({ system: "s", user: "u" }),
        })
    )!
    const out = validateLlmOutcome(cfg, rawText, status, incompleteReason)
    const retryReason =
        out.outcome === "failed" && out.failure
            ? out.failure.code === "LLM_NON_RETRYABLE_ERROR"
                ? undefined
                : out.failure.reason
            : undefined
    return { outcome: out.outcome, retryReason }
}

describe("completeStage classification mirrors the OpenAI provider", () => {
    type TRow = {
        name: string
        status: TResponseStatus
        incompleteReason?: string
        outputText?: string
    }
    const rows: TRow[] = [
        {
            name: "completed + valid",
            status: "completed",
            outputText: JSON.stringify({ value: 1 }),
        },
        {
            name: "incomplete / max_output_tokens → transient",
            status: "incomplete",
            incompleteReason: "max_output_tokens",
        },
        {
            name: "incomplete / content_filter → fail-fast (no retryReason)",
            status: "incomplete",
            incompleteReason: "content_filter",
        },
        {
            name: "failed → fail-fast (no retryReason, NOT transient)",
            status: "failed",
        },
        {
            name: "cancelled → skipped (no retryReason)",
            status: "cancelled",
        },
    ]

    for (const row of rows) {
        it(`${row.name}`, async () => {
            const envelope = terminalEnvelope({
                status: row.status,
                incompleteReason: row.incompleteReason,
                errorMessage: row.status === "failed" ? "boom" : undefined,
                outputText: row.outputText,
            })
            const provider = await providerClassification(envelope)
            const mirror = mirrorClassification(
                row.outputText,
                row.status,
                row.incompleteReason
            )
            expect(mirror).toEqual(provider)
        })
    }
})
