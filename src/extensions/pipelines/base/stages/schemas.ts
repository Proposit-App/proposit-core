// Shared TypeBox schemas for the v2-multi-stage ingestion stages.
//
// Each stage's output schema lives here (rather than next to the stage
// module) so the schemas can be referenced from `finalize-response-v2.ts`,
// the v2 unit tests, and any future consumer that wants to validate a
// recorded stage output without importing the stage's `run` function.

import Type, { type Static } from "typebox"

// **Span shape (`{ start, end }`).** Spans use a named-key object
// rather than a positional tuple. The original tuple shape
// (`Type.Tuple([Type.Number(), Type.Number()])`) caused the OpenAI
// structured-output converter to throw `UnsupportedSchemaError:
// "Tuple"` at request-build time — `segmentation` then surfaced a
// `LLM_NON_RETRYABLE_ERROR` on first attempt, every downstream stage
// cascade-skipped on the required dep, and the recording mode
// completed in ~9ms with `output: null` and zero LLM calls. The
// named-key form is also more LLM-friendly (each value carries its
// semantic role rather than relying on positional convention) and
// stays within the converter's supported subset (Object, Array,
// String, Number, Integer, Boolean, Literal, Union, Optional, Record,
// Null). See `test/extensions/argument-ingestion/stages/schema-converter-regression.test.ts`
// for the regression coverage that pins every v2 LLM stage's
// `outputSchema` through `typeboxToOpenAiSchema`.
export const SpanSchema = Type.Object({
    start: Type.Number({
        description:
            "Inclusive character offset where the span begins (relative to the parent text).",
    }),
    end: Type.Number({
        description:
            "Exclusive character offset where the span ends (relative to the parent text).",
    }),
})
export type TSpan = Static<typeof SpanSchema>

// -- Stage 1: segmentation --

// **Why every LLM-stage output is wrapped in a single-key object.**
// The OpenAI Responses-API strict-mode structured output requires the
// root schema to be `{ "type": "object" }`. Bare top-level arrays are
// rejected with a 400 `invalid_json_schema` ("schema must be a JSON
// Schema of 'type: object', got 'type: array'"). To keep every LLM
// stage's outputSchema acceptable to the converter + the API, we wrap
// the natural array shape in a single-key envelope (`segments`,
// `mentions`, `sources`, `axioms`, `relations`). Downstream readers
// access the array via `output.segments` (etc.); the envelope is
// shallow and does not change the per-item shape. The same regression
// test that pins `typeboxToOpenAiSchema` survival now also asserts
// every LLM-stage's converted root is `type: object`.

export const SegmentationOutputSchema = Type.Object({
    segments: Type.Array(
        Type.Object({
            segmentId: Type.String(),
            text: Type.String(),
            span: SpanSchema,
        })
    ),
})
export type TSegmentationOutput = Static<typeof SegmentationOutputSchema>
export type TSegment = TSegmentationOutput["segments"][number]

// -- Stage 2: claim-mention-extraction --

export const ClaimMentionExtractionOutputSchema = Type.Object({
    mentions: Type.Array(
        Type.Object({
            mentionId: Type.String(),
            segmentId: Type.String(),
            text: Type.String(),
            span: SpanSchema,
        })
    ),
})
export type TClaimMentionExtractionOutput = Static<
    typeof ClaimMentionExtractionOutputSchema
>
export type TClaimMention = TClaimMentionExtractionOutput["mentions"][number]

// -- Stage 3: citation-source-detection --

export const CitationSourceDetectionOutputSchema = Type.Object({
    sources: Type.Array(
        Type.Object({
            sourceId: Type.String(),
            segmentIds: Type.Array(Type.String()),
            sourceString: Type.String(),
            url: Type.Union([Type.String(), Type.Null()]),
            spans: Type.Array(SpanSchema),
        })
    ),
})
export type TCitationSourceDetectionOutput = Static<
    typeof CitationSourceDetectionOutputSchema
>
export type TCitationSource = TCitationSourceDetectionOutput["sources"][number]

// -- Stage 4: axiom-indicator-detection --

export const AxiomIndicatorDetectionOutputSchema = Type.Object({
    axioms: Type.Array(
        Type.Object({
            axiomId: Type.String(),
            segmentIds: Type.Array(Type.String()),
            indicator: Type.String(),
            spans: Type.Array(SpanSchema),
        })
    ),
})
export type TAxiomIndicatorDetectionOutput = Static<
    typeof AxiomIndicatorDetectionOutputSchema
>
export type TAxiomIndicator = TAxiomIndicatorDetectionOutput["axioms"][number]

// -- Stage 5: claim-canonicalization --

// The per-claim record in `canonicalClaims` carries:
//   - `miniId` — c1, c2, ... allocated by the canonicalizer
//   - `mentionIds` — list of mention ids that resolved to this claim
//   - `suggestedSymbol` — snake_case-ish symbol proposal (validated
//     downstream by `variable-assignment`)
//   - the extension fields from `extension.claimSchema` (e.g. for
//     `basics`: a discriminated union over `type`)
//
// We can't bake the extension shape into a static TypeBox object —
// the canonicalizer's schema is built per-extension by
// `buildCanonicalClaimsSchema(extension)` below. The exported
// `ClaimCanonicalizationOutputSchema` is the *base* shape (without the
// extension fields) and is used by tests that don't need the per-
// extension constraints.
export const BaseCanonicalClaimSchema = Type.Object({
    miniId: Type.String(),
    mentionIds: Type.Array(Type.String()),
    suggestedSymbol: Type.String(),
    // Per spec §7.2 row 5, the canonicalizer also drafts the
    // per-claim type. We capture it as `type` and let
    // `claim-type-classification` refine/confirm. Extension fields
    // (title/body/url/axiom) come from the merged extension schema.
    type: Type.Union([
        Type.Literal("normal"),
        Type.Literal("citation"),
        Type.Literal("axiomatic"),
    ]),
})
export type TBaseCanonicalClaim = Static<typeof BaseCanonicalClaimSchema>

// **Why `mentionToClaim` is an array, not a map.** OpenAI Responses-API
// strict-mode JSON Schema does not support `additionalProperties` or
// `patternProperties` — fixed-shape objects only. `Type.Record(K, V)`
// generates JSON Schema like `{ type: "object", additionalProperties:
// <V> }`, which strict mode rejects with 400 `invalid_json_schema`
// ("'required' is required to be supplied and to be an array
// including every key in properties. Extra required key
// 'mentionToClaim' supplied."). Surfacing the map as an explicit
// `[{ mentionId, claimMiniId }, ...]` list bypasses the constraint
// entirely. Downstream readers convert to a `Map<string, string>`
// when they need O(1) lookups.
export const MentionToClaimEntrySchema = Type.Object({
    mentionId: Type.String(),
    claimMiniId: Type.String(),
})
export type TMentionToClaimEntry = Static<typeof MentionToClaimEntrySchema>

export const ClaimCanonicalizationOutputSchema = Type.Object({
    canonicalClaims: Type.Array(BaseCanonicalClaimSchema),
    mentionToClaim: Type.Array(MentionToClaimEntrySchema),
})
export type TClaimCanonicalizationOutput = Static<
    typeof ClaimCanonicalizationOutputSchema
>
/** Per-claim record including the extension-injected fields. */
export type TCanonicalClaim = TBaseCanonicalClaim & Record<string, unknown>

// -- Stage 6: claim-type-classification --

// Same OpenAI strict-mode constraint as above. The natural shape
// `Record<miniId, { type, sourceString }>` becomes an explicit list
// of `{ miniId, type, sourceString }` entries, wrapped in a
// single-key `classifications` envelope (the lambda-fold 3 root-
// must-be-object invariant). Downstream readers build a Map on
// receipt when they need keyed lookups.
export const ClaimTypeClassificationEntrySchema = Type.Object({
    miniId: Type.String(),
    type: Type.Union([
        Type.Literal("normal"),
        Type.Literal("citation"),
        Type.Literal("axiomatic"),
    ]),
    sourceString: Type.Union([Type.String(), Type.Null()]),
})
export type TClaimTypeClassificationEntry = Static<
    typeof ClaimTypeClassificationEntrySchema
>

export const ClaimTypeClassificationOutputSchema = Type.Object({
    classifications: Type.Array(ClaimTypeClassificationEntrySchema),
})
export type TClaimTypeClassificationOutput = Static<
    typeof ClaimTypeClassificationOutputSchema
>

// -- Stage 8: variable-assignment --

export const VariableAssignmentOutputSchema = Type.Array(
    Type.Object({
        miniId: Type.String(),
        symbol: Type.String(),
        claimMiniId: Type.String(),
    })
)
export type TVariableAssignmentOutput = Static<
    typeof VariableAssignmentOutputSchema
>
export type TAssignedVariable = TVariableAssignmentOutput[number]

// -- Stage 9: relation-extraction --

export const RelationExtractionOutputSchema = Type.Object({
    relations: Type.Array(
        Type.Object({
            relationId: Type.String(),
            // `type` stays a discriminator so further relation kinds can
            // be added as union members without reshaping the object.
            type: Type.Literal("inference"),
            antecedents: Type.Array(Type.String()),
            consequent: Type.String(),
            evidence: Type.Object({
                segmentIds: Type.Array(Type.String()),
                quote: Type.String(),
            }),
        })
    ),
})
export type TRelationExtractionOutput = Static<
    typeof RelationExtractionOutputSchema
>
export type TInferenceRelation = TRelationExtractionOutput["relations"][number]

// -- Stage 10: conclusion-selection --

// What the model returns: a confidence-ranked list of candidate
// conclusion claim miniIds, best first. Ideally one; more when several
// claims are plausibly the conclusion. Empty only when the input has no
// argument structure to draw a conclusion from.
export const ConclusionSelectionLlmOutputSchema = Type.Object({
    conclusionCandidates: Type.Array(Type.String()),
    rationale: Type.String(),
})
export type TConclusionSelectionLlmOutput = Static<
    typeof ConclusionSelectionLlmOutputSchema
>

// The stage's downstream-visible output: `conclusionMiniId` is the
// resolved single pick (the first viable candidate, a relation-graph
// fallback when the model returns none, or null when no claim
// qualifies), while `conclusionCandidates` carries the model's full
// ranked list for consumers that want to offer alternates.
export const ConclusionSelectionOutputSchema = Type.Object({
    conclusionMiniId: Type.Union([Type.String(), Type.Null()]),
    conclusionCandidates: Type.Array(Type.String()),
    rationale: Type.String(),
})
export type TConclusionSelectionOutput = Static<
    typeof ConclusionSelectionOutputSchema
>

// -- Stage 11: formula-compilation --

export const FormulaPremiseRoleHintSchema = Type.Union([
    Type.Literal("freeform"),
    Type.Literal("conclusion"),
])
export type TFormulaPremiseRoleHint = Static<
    typeof FormulaPremiseRoleHintSchema
>

export const FormulaCompilationOutputSchema = Type.Object({
    premises: Type.Array(
        Type.Object({
            premiseMiniId: Type.String(),
            formula: Type.String(),
            roleHint: FormulaPremiseRoleHintSchema,
            // Optional pointer back to the relation that produced this
            // premise (null for the conclusion premise, which is
            // synthesized rather than extracted).
            sourceRelationId: Type.Union([Type.String(), Type.Null()]),
        })
    ),
    conclusionPremiseMiniId: Type.Union([Type.String(), Type.Null()]),
    // Citation/axiomatic backing extracted from inference antecedents:
    // each entry records that claim `derivedClaimMiniId` is grounded by
    // the listed citation/axiomatic supporting claims. The parser
    // materializes these into derivation premises.
    derivationBacking: Type.Array(
        Type.Object({
            derivedClaimMiniId: Type.String(),
            supportingClaimMiniIds: Type.Array(Type.String()),
        })
    ),
})
export type TFormulaCompilationOutput = Static<
    typeof FormulaCompilationOutputSchema
>
export type TCompiledPremise = TFormulaCompilationOutput["premises"][number]

// -- Stage 7 + 12 are validation stages whose `run` return value is
// the same shape: an array of structured processing-failure-context
// records. They emit failures via `ctx.addFailure` as the load-bearing
// channel; the array return is mirroring + downstream-readable.

export const ValidationStageOutputSchema = Type.Array(
    Type.Object({
        code: Type.String(),
        message: Type.String(),
        context: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    })
)
export type TValidationStageOutput = Static<typeof ValidationStageOutputSchema>

// -- Per-stage ids --

export const STAGE_IDS = {
    segmentation: "segmentation",
    claimMentionExtraction: "claim-mention-extraction",
    citationSourceDetection: "citation-source-detection",
    axiomIndicatorDetection: "axiom-indicator-detection",
    claimCanonicalization: "claim-canonicalization",
    claimTypeClassification: "claim-type-classification",
    claimReferenceValidation: "claim-reference-validation",
    variableAssignment: "variable-assignment",
    relationExtraction: "relation-extraction",
    conclusionSelection: "conclusion-selection",
    formulaCompilation: "formula-compilation",
    formulaValidation: "formula-validation",
    // The two cheap LLM stages of the fast ingestion pipeline. Each
    // makes one combined call; deterministic adapter stages then
    // republish its parts under the canonicalization / classification
    // (from `extract`) and relation / conclusion (from `scribeStructure`)
    // slots above, so the deterministic backend + finalize are shared
    // unchanged.
    extract: "extract",
    scribeStructure: "scribe-structure",
} as const
