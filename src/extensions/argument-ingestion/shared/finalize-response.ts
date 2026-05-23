// `finalize-response` — assembles the final `TParsedArgumentResponse`
// from per-stage outputs accumulated by the pipeline executor.
//
// v1 is a single-shot pipeline: the LLM emits the full response in
// one call, the `parse-argument` stage outputs that response verbatim,
// and `finalize` just attaches an empty `processingFailures` array
// (a forward-compat slot reserved for v2's per-stage failure aggregation).
//
// v2 will do most of the assembly here: each per-stage output
// (claims, variables, premises, conclusion selection, …) is merged
// into a single response and per-stage failures get folded into
// `processingFailures`. Today the function is intentionally trivial.

import type { TParsedArgumentResponse } from "../../../lib/parsing/index.js"
import type { TProcessingFailure } from "../../../lib/pipelines/index.js"

export type TFinalizeResponseInput = {
    /** Output of the single `parse-argument` llmStage in v1. */
    parsedResponse: TParsedArgumentResponse
    /**
     * Pipeline-level failures aggregated so far. v1's single stage
     * either succeeds (empty array) or the executor skips finalize.
     * v2 stages will add warnings/errors here.
     */
    failures: readonly TProcessingFailure[]
}

/**
 * Wire the per-stage outputs into the final response shape. v1's
 * implementation is a passthrough of `parsedResponse` with the v1's
 * empty `processingFailures` slot wired through. Returning a plain
 * `TParsedArgumentResponse` keeps the existing `ArgumentParser.build()`
 * consumer path unchanged.
 */
export function finalizeResponse(
    input: TFinalizeResponseInput
): TParsedArgumentResponse {
    const passthrough = {
        ...input.parsedResponse,
    } as TParsedArgumentResponse & {
        processingFailures?: readonly TProcessingFailure[]
    }
    // Reserve a `processingFailures` slot on the response. Today
    // `TParsedArgumentResponse` carries `additionalProperties: true`
    // so attaching this field is type-safe at runtime; v2 will
    // populate it from real stage warnings/errors. v1 always emits
    // an empty array so server-side consumers can rely on the slot
    // being present.
    passthrough.processingFailures = [...input.failures]
    return passthrough
}
