// Output schemas for scribe's two cheap LLM stages.
//
// scribe collapses scholar's eight LLM stages into two combined calls:
//   - `extract`  → the canonical claim set (the same per-extension
//     canonicalization shape scholar emits), so its deterministic
//     adapters can republish the canonicalization + classification
//     slots scholar's backend reads.
//   - `structure` → the relation graph + a confidence-ranked list of
//     conclusion candidates, so its adapters can republish the
//     relation-extraction + conclusion-selection slots.
//
// `extract`'s output schema is the per-extension canonicalization
// schema widened with the mention slot (`buildExtractOutputSchema`);
// `structure` needs a bespoke schema. Both are defined here.

import Type, { type Static, type TSchema } from "typebox"
import {
    ClaimMentionExtractionOutputSchema,
    RelationExtractionOutputSchema,
    buildResponseSchema,
} from "../../base/stages/index.js"
import type {
    TClaimCanonicalizationOutput,
    TClaimMentionExtractionOutput,
} from "../../base/stages/index.js"
import type { TIngestionExtension } from "../../base/types.js"

/**
 * What `extract` returns: the canonicalization slot's payload and the
 * mention slot's, in one object. Structural rather than a `Static<>`,
 * because the schema is built per-extension.
 */
export type TScribeExtractOutput = TClaimCanonicalizationOutput &
    TClaimMentionExtractionOutput

/**
 * `extract`'s output: the per-extension canonicalization shape, plus the
 * mentions whose quoted text becomes each claim's source anchor.
 *
 * The mentions ride along on the one stage that is given the input text,
 * rather than coming from a stage of their own — scribe's whole point is
 * that there are two LLM calls, and locating a claim in the text is not
 * worth a third. Their item shape is scholar's, so the same finalize
 * resolution reads them without a translation layer.
 *
 * The canonicalization envelope is `additionalProperties: false`, so the
 * widened shape is a distinct schema rather than an extra key on the
 * shared one — and the adapter that republishes the canonicalization slot
 * has to narrow back to it. See `createExtractCanonicalizationAdapterStage`.
 */
export function buildExtractOutputSchema(
    extension: TIngestionExtension
): TSchema {
    const canonicalization = buildResponseSchema(extension) as unknown as {
        properties: Record<string, TSchema>
    }
    return Type.Object(
        {
            ...canonicalization.properties,
            mentions: ClaimMentionExtractionOutputSchema.properties.mentions,
        },
        { additionalProperties: false }
    )
}

// `structure` emits the relation graph (same per-relation shape as
// scholar's `relation-extraction`, each relation carrying its own
// `title`) plus the conclusion candidates + rationale (same fields
// scholar's conclusion-selection LLM emits, before the deterministic
// resolution the adapter reproduces). `conclusionTitle` is the
// conclusion counterpart of a relation's `title`; it is named
// distinctly because both live on one object here.
export const ScribeStructureOutputSchema = Type.Object(
    {
        relations: RelationExtractionOutputSchema.properties.relations,
        conclusionCandidates: Type.Array(Type.String()),
        conclusionTitle: Type.String(),
        rationale: Type.String(),
    },
    { additionalProperties: false }
)
export type TScribeStructureOutput = Static<typeof ScribeStructureOutputSchema>
