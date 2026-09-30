// Cleaning up the model's guess of what kind of reference a citation
// claim is, and building the `UnparsedCitation` finalize attaches to it.

import { IEEE_REFERENCE_TYPES } from "../../../citations/ieee/references.js"
import type {
    TUnparsedCitation,
    TUnparsedCitationTypeGuess,
} from "../../../citations/unparsed/index.js"

// The valid `citationTypeGuess` values — the 33 IEEE reference types
// plus the explicit "unknown" fallback. Built from the IEEE list so the
// sanitizer stays in lockstep with the reference-type schema.
const VALID_CITATION_TYPE_GUESSES = new Set<TUnparsedCitationTypeGuess>([
    ...IEEE_REFERENCE_TYPES,
    "unknown",
])

/**
 * Coerce an LLM-emitted citation-type guess into the valid guess enum,
 * clamping anything absent or out-of-enum to "unknown". The model is
 * never trusted to stay in-enum, so its raw value is validated here
 * rather than relied upon.
 */
function sanitizeCitationTypeGuess(raw: unknown): TUnparsedCitationTypeGuess {
    if (
        typeof raw === "string" &&
        VALID_CITATION_TYPE_GUESSES.has(raw as TUnparsedCitationTypeGuess)
    ) {
        return raw as TUnparsedCitationTypeGuess
    }
    return "unknown"
}

/**
 * Build the `UnparsedCitation` attached to a claim that finalize keeps
 * typed `citation`. The display `text` is the claim's authored title,
 * falling back to the type-classifier's recorded `sourceString` and
 * finally the claim miniId so the text is never empty. The guess is
 * sanitized; a present, non-empty url is carried, else omitted.
 */
export function buildUnparsedCitation(args: {
    title: string | undefined
    sourceString: string | null | undefined
    rawGuess: unknown
    url: unknown
    fallbackText: string
}): TUnparsedCitation {
    const text =
        firstNonEmptyString(args.title) ??
        firstNonEmptyString(args.sourceString) ??
        args.fallbackText
    const citation: TUnparsedCitation = {
        type: "unparsed",
        text,
        citationTypeGuess: sanitizeCitationTypeGuess(args.rawGuess),
    }
    const url = firstNonEmptyString(args.url)
    if (url !== undefined) {
        citation.url = url
    }
    return citation
}

/** Return a trimmed non-empty string, or undefined for anything else. */
export function firstNonEmptyString(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
}
