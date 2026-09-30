// The stable pipeline identifiers set by the ingestion factories. Consumers
// see them as `pipeline.id` and pass them back to `getCanonicalStageIds`, so
// each is written once here and imported by both places.

/** Pipeline id of the scholar ingestion pipeline. */
export const SCHOLAR_PIPELINE_ID = "argument-ingestion-scholar"

/** Pipeline id of the scribe ingestion pipeline. */
export const SCRIBE_PIPELINE_ID = "argument-ingestion-scribe"
