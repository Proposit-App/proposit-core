// Barrel for the ingestion pipeline family (scholar + scribe).
// Subpath: @proposit/proposit-core/pipelines/ingestion
export { createScholarPipeline } from "./scholar/index.js"
export type { TCreateScholarPipelineOptions } from "./scholar/index.js"
export { createScribePipeline } from "./scribe/index.js"
export type { TCreateScribePipelineOptions } from "./scribe/index.js"
