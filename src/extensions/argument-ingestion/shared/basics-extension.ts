// `basicsExtension` — the default `TIngestionExtension` value used by
// CLI / server consumers that don't ship a custom per-entity field
// set. Composes the per-entity extension shapes from
// `src/extensions/basics/schemata.ts` directly so the composite
// `BasicsParsingSchema` and the per-entity slots in this descriptor
// stay structurally identical without manual duplication.
//
// Slice 2A's multi-stage pipeline will consume the per-entity slots
// to wire decomposed stage outputs; for v1 only `responseSchema` is
// consumed by the factory.

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
 * `createIngestionV1Pipeline(basicsExtension)` for a drop-in pipeline.
 */
export const basicsExtension: TIngestionExtension = {
    responseSchema: BasicsParsingSchema,
    claimSchema: BasicsClaimExtension,
    variableSchema: BasicsVariableExtension,
    premiseSchema: BasicsPremiseExtension,
    argumentSchema: BasicsArgumentExtension,
}
