// Shared TypeBox schemas for the v2-multi-stage ingestion stages.
//
// Each stage's output schema lives here (rather than next to the stage
// module) so the schemas can be referenced from `finalize-response-v2.ts`,
// the v2 unit tests, and any future consumer that wants to validate a
// recorded stage output without importing the stage's `run` function.

import Type, { type Static } from "typebox"

// -- Stage 1: segmentation --

export const SegmentationOutputSchema = Type.Array(
    Type.Object({
        segmentId: Type.String(),
        text: Type.String(),
        span: Type.Tuple([Type.Number(), Type.Number()]),
    })
)
export type TSegmentationOutput = Static<typeof SegmentationOutputSchema>
export type TSegment = TSegmentationOutput[number]

// -- Stage 2: claim-mention-extraction --

export const ClaimMentionExtractionOutputSchema = Type.Array(
    Type.Object({
        mentionId: Type.String(),
        segmentId: Type.String(),
        text: Type.String(),
        span: Type.Tuple([Type.Number(), Type.Number()]),
    })
)
export type TClaimMentionExtractionOutput = Static<
    typeof ClaimMentionExtractionOutputSchema
>
export type TClaimMention = TClaimMentionExtractionOutput[number]

// -- Stage 3: citation-source-detection --

export const CitationSourceDetectionOutputSchema = Type.Array(
    Type.Object({
        sourceId: Type.String(),
        segmentIds: Type.Array(Type.String()),
        sourceString: Type.String(),
        url: Type.Union([Type.String(), Type.Null()]),
        spans: Type.Array(Type.Tuple([Type.Number(), Type.Number()])),
    })
)
export type TCitationSourceDetectionOutput = Static<
    typeof CitationSourceDetectionOutputSchema
>
export type TCitationSource = TCitationSourceDetectionOutput[number]

// -- Stage 4: axiom-indicator-detection --

export const AxiomIndicatorDetectionOutputSchema = Type.Array(
    Type.Object({
        axiomId: Type.String(),
        segmentIds: Type.Array(Type.String()),
        indicator: Type.String(),
        spans: Type.Array(Type.Tuple([Type.Number(), Type.Number()])),
    })
)
export type TAxiomIndicatorDetectionOutput = Static<
    typeof AxiomIndicatorDetectionOutputSchema
>
export type TAxiomIndicator = TAxiomIndicatorDetectionOutput[number]

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

export const ClaimCanonicalizationOutputSchema = Type.Object({
    canonicalClaims: Type.Array(BaseCanonicalClaimSchema),
    mentionToClaim: Type.Record(Type.String(), Type.String()),
})
export type TClaimCanonicalizationOutput = Static<
    typeof ClaimCanonicalizationOutputSchema
>
/** Per-claim record including the extension-injected fields. */
export type TCanonicalClaim = TBaseCanonicalClaim & Record<string, unknown>

// -- Stage 6: claim-type-classification --

export const ClaimTypeClassificationOutputSchema = Type.Record(
    Type.String(),
    Type.Object({
        type: Type.Union([
            Type.Literal("normal"),
            Type.Literal("citation"),
            Type.Literal("axiomatic"),
        ]),
        sourceString: Type.Union([Type.String(), Type.Null()]),
    })
)
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

export const RelationKindSchema = Type.Union([
    Type.Literal("support"),
    Type.Literal("joint-support"),
    Type.Literal("derivation-support"),
])
export type TRelationKind = Static<typeof RelationKindSchema>

export const RelationExtractionOutputSchema = Type.Array(
    Type.Object({
        relationId: Type.String(),
        type: RelationKindSchema,
        sources: Type.Array(Type.String()),
        target: Type.String(),
        evidence: Type.Object({
            segmentIds: Type.Array(Type.String()),
            quote: Type.String(),
        }),
    })
)
export type TRelationExtractionOutput = Static<
    typeof RelationExtractionOutputSchema
>
export type TRelation = TRelationExtractionOutput[number]

// -- Stage 10: conclusion-selection --

export const ConclusionSelectionOutputSchema = Type.Object({
    conclusionMiniId: Type.Union([Type.String(), Type.Null()]),
    rationale: Type.String(),
})
export type TConclusionSelectionOutput = Static<
    typeof ConclusionSelectionOutputSchema
>

// -- Stage 11: formula-compilation --

export const FormulaPremiseRoleHintSchema = Type.Union([
    Type.Literal("support"),
    Type.Literal("joint-support"),
    Type.Literal("derivation"),
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
} as const
