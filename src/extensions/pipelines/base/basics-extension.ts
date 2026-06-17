// `basicsExtension` — the default `TIngestionExtension` value used by
// CLI / server consumers that don't ship a custom per-entity field
// set. Composes the per-entity extension shapes from
// `src/extensions/basics/schemata.ts` directly so the composite
// `BasicsParsingSchema` and the per-entity slots in this descriptor
// stay structurally identical without manual duplication.
//
// The multi-stage pipelines consume the per-entity slots to wire their
// decomposed stage outputs (e.g. canonicalization builds its output
// schema from `claimSchema`); `responseSchema` is the advertised
// pipeline output schema.

import {
    BasicsArgumentExtension,
    BasicsClaimExtension,
    BasicsParsingSchema,
    BasicsPremiseExtension,
    BasicsVariableExtension,
} from "../../basics/schemata.js"
import type { TIngestionExtension } from "./types.js"

/**
 * Default ingestion extension composing the `basics` per-entity
 * fields. Matches what the CLI's `parse` command and the server's
 * argument-ingestion endpoint use today. Hand to
 * `createScholarPipeline(basicsExtension)` for a drop-in pipeline.
 */
export const basicsExtension: TIngestionExtension = {
    responseSchema: BasicsParsingSchema,
    claimSchema: BasicsClaimExtension,
    variableSchema: BasicsVariableExtension,
    premiseSchema: BasicsPremiseExtension,
    argumentSchema: BasicsArgumentExtension,
}
