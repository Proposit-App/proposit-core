import type { TCitationSegment } from "./formatting.js" // type-only import — no runtime cycle

// ---------------------------------------------------------------------------
// Template types
// ---------------------------------------------------------------------------

/** How to extract and format a value from the reference object. */
export type TFieldSource =
    | { kind: "string"; field: string }
    | { kind: "date"; field: string }
    | { kind: "authors"; field: string }
    | { kind: "singleAuthor"; field: string }
    | { kind: "literal"; text: string }

/** One instruction in a segment template. */
export type TSegmentInstruction =
    | {
          type: "segment"
          source: TFieldSource
          role: TCitationSegment["role"]
          style?: TCitationSegment["style"]
      }
    | {
          type: "separator"
          text: string
      }
    | {
          type: "conditional"
          /** Field name to check for `!== undefined` */
          field: string
          /** If the field is an array, also check `.length > 0` */
          checkLength?: boolean
          /** Instructions to emit when the field is present */
          then: TSegmentInstruction[]
      }

export type TSegmentTemplate = TSegmentInstruction[]

// ---------------------------------------------------------------------------
// Per-type templates
// ---------------------------------------------------------------------------

export const BOOK_TEMPLATE: TSegmentTemplate = [
    {
        type: "segment",
        source: { kind: "authors", field: "authors" },
        role: "authors",
        style: "plain",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "title" },
        role: "title",
        style: "italic",
    },
    {
        type: "conditional",
        field: "edition",
        then: [
            { type: "separator", text: ", " },
            {
                type: "segment",
                source: { kind: "string", field: "edition" },
                role: "edition",
            },
            {
                type: "segment",
                source: { kind: "literal", text: " ed." },
                role: "suffix",
            },
        ],
    },
    {
        type: "conditional",
        field: "location",
        then: [
            { type: "separator", text: ", " },
            {
                type: "segment",
                source: { kind: "string", field: "location" },
                role: "location",
            },
        ],
    },
    { type: "separator", text: ": " },
    {
        type: "segment",
        source: { kind: "string", field: "publisher" },
        role: "publisher",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "year" },
        role: "year",
    },
    { type: "separator", text: "." },
    {
        type: "conditional",
        field: "isbn",
        then: [
            { type: "separator", text: " " },
            {
                type: "segment",
                source: { kind: "string", field: "isbn" },
                role: "isbn",
            },
        ],
    },
]
