// Unparsed (a.k.a. "raw") citations — references extracted from input text
// that have not yet been structured into a well-formed IEEE reference. They
// carry the raw `text`, the LLM's best guess at the IEEE reference type, and
// an optional locator url. A future task pipeline can convert these into a
// structured IEEE reference.

import Type, { type Static } from "typebox"
import { ReferenceTypeSchema } from "../ieee/references.js"

// The 33 well-formed IEEE reference types plus an explicit fallback for when
// no IEEE type applies or the type can't be guessed. Composed from
// ReferenceTypeSchema so the guessed-type set stays in lockstep with the IEEE
// reference types.
export const UnparsedCitationTypeGuessSchema = Type.Union([
    ReferenceTypeSchema,
    Type.Literal("unknown"),
])
export type TUnparsedCitationTypeGuess = Static<
    typeof UnparsedCitationTypeGuessSchema
>

export const UnparsedCitationSchema = Type.Object({
    type: Type.Literal("unparsed"),
    text: Type.String(),
    citationTypeGuess: UnparsedCitationTypeGuessSchema,
    url: Type.Optional(Type.String()),
})
export type TUnparsedCitation = Static<typeof UnparsedCitationSchema>
