// Shared types for the argument-ingestion extension.
//
// The v1 single-shot pipeline and the (future) v2 multi-stage pipeline
// both produce a `TParsedArgumentResponse`-shaped output that the
// existing `ArgumentParser.build()` consumes. They share an extension
// descriptor — `TIngestionExtension` — so callers can plug in custom
// per-entity field shapes (titles, bodies, URLs, axiom labels, …)
// without reimplementing the pipelines.
//
// For v1 the descriptor is consumed in exactly one place:
// `createIngestionV1Pipeline` reads `responseSchema` and hands it to
// the single `llmStage`'s `outputSchema` (and to `buildParsingPrompt`
// for system-prompt construction). The per-entity slots are retained
// in the descriptor so v2 stages can compose them.

import type { TSchema } from "typebox"
import type { TReasoningEffort } from "../../../lib/llm/types.js"
import type { TRetryPolicy } from "../../../lib/pipelines/index.js"

/**
 * Bundle of TypeBox schemas a caller hands to an ingestion pipeline
 * factory. Only `responseSchema` is consumed by v1; the per-entity
 * slots are forward-compat surface for v2's stage decomposition (see
 * Phase 2 / slice 2A).
 *
 * `responseSchema` is the full `TParsedArgumentResponse` shape with
 * any caller extensions merged in — typically built via
 * `buildParsingResponseSchema({ claimSchema, premiseSchema,
 * parsedArgumentSchema })` from `src/lib/parsing/`.
 */
export type TIngestionExtension = {
    /** Full extended TParsedArgumentResponse schema (the LLM's output schema). */
    responseSchema: TSchema
    /** Extension shape for individual claims (Type.Object or discriminated Type.Union of Type.Objects). */
    claimSchema: TSchema
    /** Extension shape for individual variables. */
    variableSchema: TSchema
    /** Extension shape for individual premises. */
    premiseSchema: TSchema
    /** Extension shape for the top-level argument object. */
    argumentSchema: TSchema
}

/**
 * Input shape every ingestion pipeline accepts: the raw natural-
 * language text to parse. Wrapped in an object so future v2 stages
 * can attach side-input (per-stage hints, prior corrections, …)
 * without breaking the wire-shape.
 */
export type TIngestionInput = {
    text: string
}

/**
 * Per-stage LLM knob overrides for an ingestion pipeline factory.
 *
 * Every field is optional and merges over the stage's internal
 * default (which is in turn merged over the pipeline-level default).
 * The merge order is: stage-override > pipeline-default > internal
 * stage default. A missing field at every layer means the stage
 * keeps its built-in behavior.
 *
 * Exposes the knobs that have proven load-bearing for the v2 pipeline:
 * `maxOutputTokens` (the output-budget cap; not setting one means the
 * model's default applies, which is what caused the v1.3.0 segmentation
 * truncation against the Singer fixture), `reasoningEffort` (effort
 * budget for reasoning models — OpenAI-specific; ignored by the Ollama
 * provider), and `model` (the provider model identifier).
 *
 * The `model` knob lets a caller retarget every LLM stage at a
 * different backend without forking the stages — e.g. pointing the
 * whole v2 pipeline at a local Ollama model
 * (`{ llm: { defaults: { model: "qwen3.6:latest" } } }`) for cost-free
 * local development. Each stage keeps its own hard-coded `gpt-5.x`
 * default when no override is supplied, so production behavior is
 * unchanged.
 *
 * `retry` overrides the stage's framework retry policy. It is a
 * `Partial<TRetryPolicy>` carried straight through to `llmStage`,
 * which shallow-merges it over `DEFAULT_RETRY_POLICY` (this surface
 * does NOT merge it — see `resolveLlmStageOptions`). Its primary
 * consumer is the server's "no-auto-retry" toggle, which drops
 * `"transient"` from `retryOn`. Note that dropping `"transient"`
 * disables the retry for ALL transient causes — network/undici
 * timeouts, 5xx, AND `incomplete/max_output_tokens` truncation — not
 * timeouts alone, because every non-Abort transport error and the
 * truncation case both classify as `"transient"`.
 *
 * The struct is forward-compatible — new knobs can land additively
 * without breaking callers.
 */
export type TLlmStageOptionsOverride = {
    maxOutputTokens?: number
    reasoningEffort?: TReasoningEffort
    model?: string
    retry?: Partial<TRetryPolicy>
}

/**
 * Pipeline-level LLM-options surface threaded through every LLM
 * stage by the ingestion-pipeline factories.
 *
 * `defaults` applies to all LLM stages in the pipeline that don't
 * have a per-stage entry under `overrides`. A stage's internal
 * default still takes effect for any knob neither `defaults` nor
 * `overrides` sets.
 *
 * `overrides` is keyed by stage id (`STAGE_IDS.segmentation`,
 * `STAGE_IDS.claimMentionExtraction`, etc.). v1 has only one LLM
 * stage and uses the id `"parse-argument"`.
 */
export type TIngestionLlmOptions = {
    defaults?: TLlmStageOptionsOverride
    overrides?: Record<string, TLlmStageOptionsOverride>
}
