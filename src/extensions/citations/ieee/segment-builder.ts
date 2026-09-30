import type { TCitationSegment } from "./segment-types.js"
import type { TSegmentInstruction } from "./segment-templates.js"
import type { TAuthor } from "./references.js"

// ---------------------------------------------------------------------------
// Shared formatting helpers (canonical home — formatting.ts re-exports these)
// ---------------------------------------------------------------------------

export const IEEE_MONTHS = [
    "Jan.",
    "Feb.",
    "Mar.",
    "Apr.",
    "May",
    "Jun.",
    "Jul.",
    "Aug.",
    "Sep.",
    "Oct.",
    "Nov.",
    "Dec.",
]

// A citation date is a calendar date, stored as midnight UTC of that day (the
// way `EncodableDate` decodes "1787-11-22"). Read it back in UTC: the local-time
// getters shift it into the formatting process's time zone and print the day
// before or after, and no stored time of day avoids that for every zone.
export function formatDate(d: Date): string {
    const month = IEEE_MONTHS[d.getUTCMonth()]
    const day = d.getUTCDate()
    const year = d.getUTCFullYear()
    return `${month} ${day}, ${year}`
}

export function formatSingleAuthor(author: TAuthor): string {
    if (!("givenNames" in author)) return author.name
    const initials = author.givenNames
        .trim()
        .split(/\s+/)
        .map((name) => `${name.charAt(0)}.`)
        .join(" ")
    const name = `${initials} ${author.familyName}`
    return author.suffix ? `${name} ${author.suffix}` : name
}

export function formatNamesInCitation(authors: TAuthor[]): string {
    if (authors.length === 0) return ""
    if (authors.length > 6) {
        return `${formatSingleAuthor(authors[0])} et al.`
    }
    const formatted = authors.map(formatSingleAuthor)
    if (formatted.length === 1) return formatted[0]
    if (formatted.length === 2) return `${formatted[0]} and ${formatted[1]}`
    return `${formatted.slice(0, -1).join(", ")}, and ${formatted[formatted.length - 1]}`
}

// ---------------------------------------------------------------------------
// Template engine
// ---------------------------------------------------------------------------

function resolveSource(
    ref: Record<string, unknown>,
    source: TSegmentInstruction & { type: "segment" }
): string {
    const src = source.source
    switch (src.kind) {
        case "string":
            return ref[src.field!] as string
        case "date":
            return formatDate(ref[src.field!] as Date)
        case "authors":
            return formatNamesInCitation(ref[src.field!] as TAuthor[])
        case "singleAuthor":
            return formatSingleAuthor(ref[src.field!] as TAuthor)
        case "literal":
            return src.text!
    }
}

function emitInstructions(
    ref: Record<string, unknown>,
    instructions: TSegmentInstruction[],
    segs: TCitationSegment[]
): void {
    for (const instr of instructions) {
        switch (instr.type) {
            case "separator":
                segs.push({ text: instr.text, role: "separator" })
                break
            case "segment": {
                const seg: TCitationSegment = {
                    text: resolveSource(ref, instr),
                    role: instr.role,
                }
                if (instr.style) seg.style = instr.style
                segs.push(seg)
                break
            }
            case "conditional": {
                const value = ref[instr.field]
                const present =
                    value !== undefined &&
                    !(
                        instr.checkLength &&
                        Array.isArray(value) &&
                        value.length === 0
                    )
                if (present) emitInstructions(ref, instr.then, segs)
                else if (instr.else) emitInstructions(ref, instr.else, segs)
                break
            }
        }
    }
}

export function buildSegments(
    ref: Record<string, unknown>,
    template: TSegmentInstruction[]
): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    emitInstructions(ref, template, segs)
    return segs
}
