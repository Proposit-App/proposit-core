// `basicsExtension` — the default `TIngestionExtension` value used by
// CLI / server consumers that don't ship a custom per-entity field
// set. Composes the schemas from `src/extensions/basics/` (claim
// title+body | title+url | axiom+title; premise title; argument title).
//
// Keeping the value in the `argument-ingestion` extension (rather than
// `basics/`) avoids a back-reference from `basics/` into ingestion
// infrastructure; `basics/` continues to own only the schema
// definitions and the `BasicsArgumentParser` build-hook overrides.

import Type from "typebox"
import { BasicsParsingSchema } from "../../basics/index.js"
import {
    CoreClaimAxiomaticTypeSchema,
    CoreClaimCitationTypeSchema,
    CoreClaimNormalTypeSchema,
} from "../../../lib/schemata/claim.js"
import type { TIngestionExtension } from "./types.js"

// Mirror the per-entity extension shapes from src/extensions/basics/
// schemata.ts. We re-declare them here (rather than importing) to
// keep `basics/schemata.ts` decoupled from the ingestion layer —
// the file's purpose is the composite parsing schema; the per-entity
// shapes are intermediate artifacts the file doesn't export.
const BASICS_NORMAL_CLAIM_EXTENSION = Type.Object({
    title: Type.String({
        maxLength: 50,
        description: "A short title summarizing the claim",
    }),
    body: Type.String({
        maxLength: 500,
        description: "A detailed description of the claim",
    }),
    type: CoreClaimNormalTypeSchema,
})

const BASICS_CITATION_CLAIM_EXTENSION = Type.Object({
    title: Type.String({
        maxLength: 50,
        description: "A short title summarizing the claim",
    }),
    url: Type.String({
        maxLength: 500,
        description: "The URL of the citation supporting the claim",
    }),
    type: CoreClaimCitationTypeSchema,
})

const BASICS_AXIOMATIC_CLAIM_EXTENSION = Type.Object({
    axiom: Type.String({
        maxLength: 50,
        description: "The axiom supporting the claim",
    }),
    type: CoreClaimAxiomaticTypeSchema,
})

const BASICS_CLAIM_EXTENSION = Type.Union([
    BASICS_NORMAL_CLAIM_EXTENSION,
    BASICS_CITATION_CLAIM_EXTENSION,
    BASICS_AXIOMATIC_CLAIM_EXTENSION,
])

const BASICS_VARIABLE_EXTENSION = Type.Object({})

const BASICS_PREMISE_EXTENSION = Type.Object({
    title: Type.String({
        maxLength: 50,
        description: "A short title for this premise",
    }),
})

const BASICS_ARGUMENT_EXTENSION = Type.Object({
    title: Type.String({
        maxLength: 50,
        description: "A short title for the argument",
    }),
})

/**
 * Default ingestion extension composing the `basics` per-entity
 * fields. Matches what the CLI's `parse` command and the server's
 * argument-ingestion endpoint use today. Hand to
 * `createIngestionV1Pipeline(basicsExtension)` for a drop-in pipeline.
 */
export const basicsExtension: TIngestionExtension = {
    responseSchema: BasicsParsingSchema,
    claimSchema: BASICS_CLAIM_EXTENSION,
    variableSchema: BASICS_VARIABLE_EXTENSION,
    premiseSchema: BASICS_PREMISE_EXTENSION,
    argumentSchema: BASICS_ARGUMENT_EXTENSION,
}
