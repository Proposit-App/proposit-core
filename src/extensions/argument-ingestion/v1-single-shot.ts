// v1 single-shot ingestion pipeline.
//
// One `llmStage` (`parse-argument`) calls the configured LLM with the
// `buildParsingPrompt(extension.responseSchema)` system prompt + the
// raw input text as the user message; `outputSchema` is the extended
// `TParsedArgumentResponse` schema. The pipeline's `finalize` stage
// is required-dependent on `parse-argument` and merges the LLM
// response with an empty `processingFailures` slot via
// `finalizeResponse`.
//
// **Parity with the pre-1C CLI path.** Behaviorally equivalent to the
// pre-1C CLI path on schema-conformant LLM outputs (recorded-corpus
// parity). The new framework adds a single schema-validation retry
// per stage (default `RetryPolicy` from slice 1A — `maxAttempts: 2`,
// `retryOn: ["schema_validation", "transient"]`); the pre-1C
// direct-call path failed hard on the first schema-invalid response.
// This is a usability improvement, not a regression. The golden
// corpus exercises only the happy path, so the parity guarantee
// holds for any LLM response shape the corpus pins; off-corpus
// schema-invalid responses now retry once before the stage fails.
//
// v2 (Phase 2 / slice 2A) replaces the single stage with a graph of
// decomposed stages; the same `finalizeResponse` helper drives the
// merge, hence its placement under `shared/`.

import Type from "typebox"
import { llmStage } from "../../lib/pipelines/index.js"
import type { TPipeline } from "../../lib/pipelines/index.js"
import { buildParsingPrompt } from "../../lib/parsing/index.js"
import type { TParsedArgumentResponse } from "../../lib/parsing/index.js"
import { finalizeResponse } from "./shared/finalize-response.js"
import type { TIngestionExtension, TIngestionInput } from "./shared/types.js"

const PIPELINE_ID = "argument-ingestion-v1"
const PIPELINE_VERSION = "1.0.0"
const PARSE_STAGE_ID = "parse-argument"

const DEFAULT_PARSE_MODEL = "gpt-5.4"

export type TCreateIngestionV1PipelineOptions = {
    /** Override the default `gpt-5.4` model. */
    model?: string
    /** Optional caller-supplied custom-instructions appendix. */
    customInstructions?: string
}

const INGESTION_INPUT_SCHEMA = Type.Object({
    text: Type.String({ minLength: 1 }),
})

/**
 * Build the v1 ingestion pipeline for the supplied extension.
 *
 * The returned `TPipeline` accepts a `{ text }` input, calls one
 * `llmStage` against `extension.responseSchema`, and finalizes into
 * the parser-consumable `TParsedArgumentResponse` shape.
 */
export function createIngestionV1Pipeline(
    extension: TIngestionExtension,
    options?: TCreateIngestionV1PipelineOptions
): TPipeline<TIngestionInput, TParsedArgumentResponse> {
    const model = options?.model ?? DEFAULT_PARSE_MODEL
    const systemPrompt = buildParsingPrompt(extension.responseSchema, {
        customInstructions: options?.customInstructions,
    })

    // Embed a stage-id marker so the test mock (and any future
    // RecordingLlmProvider) can key replays by stage. The OpenAI
    // provider treats this as an inert HTML comment in the system
    // message.
    const markedSystemPrompt = `<!-- stage-id: ${PARSE_STAGE_ID} -->\n${systemPrompt}`

    const parseStage = llmStage<TParsedArgumentResponse>({
        id: PARSE_STAGE_ID,
        dependsOn: [],
        outputSchema: extension.responseSchema,
        model,
        buildPrompt: (ctx) => {
            const input = ctx.input as TIngestionInput
            return {
                system: markedSystemPrompt,
                user: input.text,
            }
        },
    })

    return {
        id: PIPELINE_ID,
        version: PIPELINE_VERSION,
        inputSchema: INGESTION_INPUT_SCHEMA,
        // The pipeline's declared `outputSchema` is the extension's
        // raw `responseSchema` — i.e., the LLM's structured output
        // shape. The actual runtime output (post-finalize) is
        // augmented with a `processingFailures: TProcessingFailure[]`
        // slot by `finalizeResponse`, so the runtime payload declares
        // one more field than this schema. The asymmetry is
        // intentional for V1: `outputSchema` advertises the *core*
        // output that downstream parsers (e.g. `ArgumentParser`)
        // consume, while `processingFailures` is a side-channel for
        // observability that consumers read separately. A future
        // slice (1G / 2C server wiring) may stitch the failure slot
        // into the schema via `Type.Intersect`; for now a docstring
        // is the contract.
        outputSchema: extension.responseSchema,
        stages: [parseStage],
        finalize: {
            dependsOn: [PARSE_STAGE_ID],
            run: (ctx) => {
                const parsed = ctx.get<TParsedArgumentResponse>(PARSE_STAGE_ID)
                if (!parsed) {
                    // Defensive: finalize.dependsOn is required, so
                    // the executor only invokes us when the upstream
                    // stage completed. If we still got here without
                    // an output, the framework is misbehaving — throw
                    // rather than emit a half-built response.
                    throw new Error(
                        `Pipeline "${PIPELINE_ID}" finalize invoked without a "${PARSE_STAGE_ID}" output.`
                    )
                }
                return finalizeResponse({
                    parsedResponse: parsed,
                    failures: [],
                })
            },
        },
    }
}
