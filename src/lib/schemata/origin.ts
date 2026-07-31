// Origin data — the source text an argument was built from, its association
// with an argument version, and the spans of it individual argument parts
// derive from.
//
// The document text is opaque content: core stores it, digests it, and slices
// it by index, but never parses, renders, formats, or interprets it. Nothing
// here gives core a notion of user, session, or presentation.
//
// Every entity carries `additionalProperties: true`, following
// `CoreClaimConnectionSchema` — an application extends them with its own
// fields, and an IEEE attribution rides on a document through the same slot
// (see `extensions/citations/ieee/origin-document.ts`), exactly as an IEEE
// citation rides on `CoreClaimSchema`.

import Type, { type Static } from "typebox"
import { UUID } from "./shared.js"

export const OriginStanceSchema = Type.Union(
    [Type.Literal("representation"), Type.Literal("seed")],
    {
        description:
            "What an argument claims about its source text. 'representation' asserts the argument faithfully renders the source, so unanchored content is meaningful; 'seed' says only that the argument started from the source.",
    }
)
export type TOriginStance = Static<typeof OriginStanceSchema>

export const OriginAnchorTargetTypeSchema = Type.Union(
    [
        Type.Literal("expression"),
        Type.Literal("premise"),
        Type.Literal("argument"),
    ],
    {
        description:
            "What an anchor points at. Argument-scoped only: a global claim is excluded because a claim is shared by reference across arguments, so 'where did it come from' has no single answer — the provenance belongs to this argument's use of it.",
    }
)
export type TOriginAnchorTargetType = Static<
    typeof OriginAnchorTargetTypeSchema
>

export const OriginSegmentSchema = Type.Object(
    {
        segmentId: Type.String({
            description: "Producer-assigned identifier for this segment.",
        }),
        startCodePoint: Type.Number({
            description:
                "Inclusive start of the segment, counted in Unicode code points.",
        }),
        endCodePoint: Type.Number({
            description:
                "Exclusive end of the segment, counted in Unicode code points.",
        }),
    },
    {
        additionalProperties: true,
        description:
            "One entry of a document's optional segmentation overlay. Not load-bearing — nothing in core reads it, anchors do not depend on it, and segments need not cover the whole text.",
    }
)
export type TOriginSegment = Static<typeof OriginSegmentSchema>

export const CoreOriginDocumentSchema = Type.Object(
    {
        id: UUID,
        text: Type.String({
            description:
                "The source text, normalized by `normalizeOriginText`. Immutable: correcting a document means replacing it, which invalidates its anchors by design. This string is the coordinate system every anchor indexes into.",
        }),
        digest: Type.String({
            description:
                "SHA-256 of the normalized text, as 64 lowercase hex characters. Makes duplicate texts detectable; whether a duplicate may be reused is a consumer policy decision.",
        }),
        segments: Type.Optional(
            Type.Array(OriginSegmentSchema, {
                description:
                    "Optional segmentation overlay. Present only when a producer supplied one.",
            })
        ),
        checksum: Type.String({
            description: "Entity checksum for sync detection.",
        }),
    },
    {
        additionalProperties: true,
        description:
            "An immutable source text an argument was built from. Extended via additionalProperties for app-level fields and for attribution metadata.",
    }
)
export type TCoreOriginDocument = Static<typeof CoreOriginDocumentSchema>

export const CoreOriginLinkSchema = Type.Object(
    {
        id: UUID,
        argumentId: UUID,
        argumentVersion: Type.Number({
            description:
                "The argument version this link attaches the document to. Links are per-version, so a new version records its own stance.",
        }),
        documentId: UUID,
        stance: OriginStanceSchema,
        checksum: Type.String({
            description: "Entity checksum for sync detection.",
        }),
    },
    {
        additionalProperties: true,
        description:
            "An association between one argument version and one origin document, carrying the stance the author takes toward that source.",
    }
)
export type TCoreOriginLink = Static<typeof CoreOriginLinkSchema>

export const CoreOriginAnchorSchema = Type.Object(
    {
        id: UUID,
        argumentId: UUID,
        argumentVersion: Type.Number(),
        documentId: UUID,
        targetType: OriginAnchorTargetTypeSchema,
        targetId: UUID,
        exact: Type.String({
            description:
                "The quoted passage. Durable identity for this anchor: the positions are a fast path, and this is what survives if they ever stop agreeing.",
        }),
        prefix: Type.Optional(
            Type.String({
                description:
                    "Text immediately before the quote, used to disambiguate a passage that occurs more than once.",
            })
        ),
        suffix: Type.Optional(
            Type.String({
                description:
                    "Text immediately after the quote, used to disambiguate a passage that occurs more than once.",
            })
        ),
        startCodePoint: Type.Number({
            description:
                "Inclusive start of the quote in the document, counted in Unicode code points — never UTF-16 code units. Slice it with `sliceByCodePoints`; a bare `String.prototype.slice` is wrong on any astral-plane character.",
        }),
        endCodePoint: Type.Number({
            description:
                "Exclusive end of the quote in the document, counted in Unicode code points.",
        }),
        checksum: Type.String({
            description: "Entity checksum for sync detection.",
        }),
    },
    {
        additionalProperties: true,
        description:
            "A span of an origin document that one part of one argument version derives from. Carries both of the Web Annotation Data Model's text selectors — the quote with its surrounding context, and the code-point positions.",
    }
)
export type TCoreOriginAnchor = Static<typeof CoreOriginAnchorSchema>
