// Canonical stage-id ordering for the ingestion pipeline family.
//
// Each list is the ordered stage-id sequence the corresponding factory
// (`createScholarPipeline` / `createScribePipeline`) produces — the single
// source of truth a consumer can import to render or drive the pipeline's
// stages without hardcoding its own copy. The lists are maintained by hand and
// guarded against drift by a test that asserts each equals
// `pipeline.stages.map((s) => s.id)`.

/** Ordered stage ids of the scholar ingestion pipeline. */
export const INGESTION_SCHOLAR_STAGE_IDS: readonly string[] = [
    "segmentation",
    "claim-mention-extraction",
    "citation-source-detection",
    "axiom-indicator-detection",
    "claim-canonicalization",
    "claim-type-classification",
    "claim-reference-validation",
    "variable-assignment",
    "relation-extraction",
    "conclusion-selection",
    "formula-compilation",
    "formula-validation",
]

/** Ordered stage ids of the scribe ingestion pipeline. */
export const INGESTION_SCRIBE_STAGE_IDS: readonly string[] = [
    "extract",
    "claim-canonicalization",
    "claim-type-classification",
    "claim-mention-extraction",
    "claim-reference-validation",
    "variable-assignment",
    "scribe-structure",
    "relation-extraction",
    "conclusion-selection",
    "formula-compilation",
    "formula-validation",
]

/**
 * The ordered canonical stage ids for a pipeline id, or an empty list for an
 * unknown / absent id (so a consumer degrades gracefully to whatever stages it
 * actually observes). The ids are the stable pipeline identifiers set by the
 * scholar / scribe factories.
 */
export function getCanonicalStageIds(
    pipelineId: string | undefined
): readonly string[] {
    if (pipelineId === "argument-ingestion-scholar")
        return INGESTION_SCHOLAR_STAGE_IDS
    if (pipelineId === "argument-ingestion-scribe")
        return INGESTION_SCRIBE_STAGE_IDS
    return []
}
