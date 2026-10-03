// The instruction types a segment template is written in. buildSegments()
// interprets them to produce a citation's segments.

import type { TCitationSegment } from "../segment-types.js"

// ---------------------------------------------------------------------------
// Instruction types
// ---------------------------------------------------------------------------

export interface TSegmentSource {
    kind:
        | "string"
        | "date"
        | "calendarDate"
        | "authors"
        | "singleAuthor"
        | "literal"
    field?: string
    text?: string
}

export interface TSegmentInstructionSegment {
    type: "segment"
    source: TSegmentSource
    role: TCitationSegment["role"]
    style?: TCitationSegment["style"]
}

export interface TSegmentInstructionSeparator {
    type: "separator"
    text: string
}

export interface TSegmentInstructionConditional {
    type: "conditional"
    field: string
    checkLength?: boolean
    then: TSegmentInstruction[]
    /** Emitted exactly when `then` is not. */
    else?: TSegmentInstruction[]
}

export type TSegmentInstruction =
    | TSegmentInstructionSegment
    | TSegmentInstructionSeparator
    | TSegmentInstructionConditional
