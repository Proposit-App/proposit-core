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
// schema itself (`buildResponseSchema(extension)`); only `structure`
// needs a bespoke schema, defined here.

import Type, { type Static } from "typebox"
import { RelationExtractionOutputSchema } from "../../base/stages/index.js"

// `structure` emits the relation graph (same per-relation shape as
// scholar's `relation-extraction`) plus the conclusion candidates +
// rationale (same fields scholar's conclusion-selection LLM emits,
// before the deterministic resolution the adapter reproduces).
export const ScribeStructureOutputSchema = Type.Object(
    {
        relations: RelationExtractionOutputSchema.properties.relations,
        conclusionCandidates: Type.Array(Type.String()),
        rationale: Type.String(),
    },
    { additionalProperties: false }
)
export type TScribeStructureOutput = Static<typeof ScribeStructureOutputSchema>
