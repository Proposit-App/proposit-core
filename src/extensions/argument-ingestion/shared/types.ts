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
