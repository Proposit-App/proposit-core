// Shared free-text length steering for the structured-output schema
// converters.
//
// Both structured-output converters — the OpenAI Responses-API
// strict-mode one (`../openai/structured-output.ts`) and the standard
// `json_schema` one for chat-completions (`../chat-completions/
// structured-output.ts`) — deliberately drop a String field's
// `maxLength`/`description` and project only `{ type: "string" }`.
// That left the per-field budget with no representation in the wire
// schema, so a model would routinely overshoot a declared cap and the
// overshoot reached the user as a value cut off mid-word.
//
// This helper restores a *steering* projection for free-text String
// fields, shared so the shrink math, hint wording, and exact-value
// exemption rule live in exactly one place. It does NOT enforce the
// true limit — a post-hoc clamp against the original schema remains the
// only thing that shortens, and it ends on a whole word. The projection
// only nudges the model toward the limit: it appends a *shrunk* budget
// (`floor(original * SHRINK)`) to `description`, so a model reading the
// schema sees the cap with headroom below the real one.
//
// A free-text field carries no `maxLength` on the wire. A model that
// enforces it — a local llama-server compiling the schema to a grammar,
// and newer OpenAI models in strict mode — stops generating at the cap,
// which cuts the value off mid-word ("…major politicians since 177")
// with nothing downstream able to repair it. Prose steering plus the
// word-boundary clamp keeps every value whole.
//
// Exact-value fields are exempt from both. A String that declares a
// `format` (e.g. `uri`) or a very small `maxLength` is not free text:
// shrinking it could clip a valid value short (a 500→450 `url` shrink
// would drop a long URL 50 chars early) and a "write fewer characters"
// hint is meaningless for an exact value. Those keep their original
// `maxLength` (and original `description`), with no hint.

import type { TSchema } from "typebox"

/**
 * Fraction of a free-text field's declared `maxLength` to state as its
 * budget in the wire schema's `description` — leaving headroom below the true cap so the model's
 * tendency to overshoot lands under the real limit rather than past it.
 *
 * ponytail: tunable heuristic knob. Lower it (e.g. 0.85, 0.8) if
 * truncation still surfaces in practice; raise it toward 1.0 if the
 * steering is clipping legitimately long values. A plain constant on
 * purpose — not an env var or config object.
 */
export const SHRINK = 0.9

// A String whose declared `maxLength` is at or below this is treated as
// an exact-value field (short identifiers, codes, enum-like strings)
// rather than free text: not shrunk, not hinted. Kept below the
// smallest real free-text budget (ingestion titles at 50) so those
// still steer.
const EXACT_VALUE_MAX_LENGTH = 16

/**
 * The String-schema fields this helper reads and may rewrite. A
 * converted JSON-Schema String carries these verbatim from the source
 * TypeBox String node.
 */
type TStringLengthFields = {
    maxLength?: number
    description?: string
    format?: string
}

function readStringLengthFields(schema: TSchema): TStringLengthFields {
    const s = schema as TStringLengthFields
    return {
        maxLength: typeof s.maxLength === "number" ? s.maxLength : undefined,
        description:
            typeof s.description === "string" ? s.description : undefined,
        format: typeof s.format === "string" ? s.format : undefined,
    }
}

function isExactValueField(fields: TStringLengthFields): boolean {
    if (fields.format !== undefined) return true
    if (
        fields.maxLength !== undefined &&
        fields.maxLength <= EXACT_VALUE_MAX_LENGTH
    ) {
        return true
    }
    return false
}

/**
 * Project a TypeBox String node into the wire-schema String object,
 * applying free-text length steering.
 *
 * - A free-text String with a `maxLength` gets no `maxLength` and a
 *   `description` ending `…at most <shrunk> characters`.
 * - An exact-value String (declares a `format`, or a very small
 *   `maxLength`) keeps its original `maxLength`/`description` and gets
 *   no hint.
 * - A String with no `maxLength` is returned as a bare
 *   `{ type: "string" }` (no shrink, no hint).
 *
 * Returns a plain object literal (the loose shape both converters
 * round-trip through the request body), never mutating the source.
 */
export function projectStringLengthHint(
    schema: TSchema
): Record<string, unknown> {
    const fields = readStringLengthFields(schema)

    // No budget declared: nothing to steer. Stay a bare string so the
    // converters' historical output is unchanged for unbounded fields.
    if (fields.maxLength === undefined) {
        return { type: "string" }
    }

    // Exact-value field: keep the real limit and any description as-is;
    // no shrink, no hint. `format` is read only to MAKE the exemption
    // decision — it is never projected into the wire object: the
    // converters strip all non-structural metadata, and OpenAI strict
    // mode supports only a fixed string-`format` set (date-time, date,
    // time, duration, email, hostname, ipv4, ipv6, uuid) — emitting an
    // unsupported `format` like `uri` risks a 400 at generation time.
    if (isExactValueField(fields)) {
        const exact: Record<string, unknown> = {
            type: "string",
            maxLength: fields.maxLength,
        }
        if (fields.description !== undefined) {
            exact.description = fields.description
        }
        return exact
    }

    // Free-text field: state the shrunk budget in prose only.
    const shrunk = Math.max(1, Math.floor(fields.maxLength * SHRINK))
    const budgetHint = `at most ${String(shrunk)} characters`
    const description =
        fields.description !== undefined
            ? `${fields.description}; ${budgetHint}`
            : budgetHint
    return { type: "string", description }
}
