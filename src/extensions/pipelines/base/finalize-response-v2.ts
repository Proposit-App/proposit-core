// `finalize-response-v2` — the module other code and the package exports
// import the ingestion pipeline's final assembler from. The work itself
// lives under `finalize/`: the assembler, source-anchor resolution, title
// composition, and citation-type cleanup, one file each.

export {
    finalizeResponseV2,
    FINALIZE_V2_FAILURE_TEXTS,
} from "./finalize/assembler.js"
export type { TFinalizeResponseV2Input } from "./finalize/assembler.js"
export { SOURCE_ANCHOR_NOTE_CODES } from "./finalize/source-anchor-resolution.js"
