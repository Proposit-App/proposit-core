# IEEE Extension Enrichment Design

**Date:** 2026-03-31
**Scope:** `src/extensions/ieee/`

## Summary

Enrich the IEEE citation extension from a schema-only package into a full-featured module with strict validation constraints, relaxed schema variants, a type-to-schema lookup map, and structured citation formatting utilities. No new schema fields are added — this pass enriches the existing 33 reference type schemas.

## Decisions

- **No article analysis utility** — `analyzeArticleHtml()` is too application-specific for the core library.
- **Structured formatting output** — `formatCitationParts()` returns typed segments with roles and style hints, not plain strings. Consumers compose their own rendering.
- **`IEEEReferenceSchemaMap`** — first-class export for per-type validation.
- **Pre-built relaxed schemas** — consumers import `IEEEReferenceSchemaRelaxed` / `IEEEReferenceSchemaMapRelaxed` directly, no need to call a strip function.
- **`EncodableDate` for all date fields** — `accessedDate`, `date`, `postDate`, `dateEnacted` all use `EncodableDate` from `src/lib/schemata/shared.ts`. `year` fields remain `Type.String()` with a `^\d{4}$` pattern.
- **Existing fields only** — no fields added or removed from the current schemas. A future pass will audit against the IEEE Reference Guide.

## File Structure

```
src/extensions/ieee/
├── index.ts          — barrel re-exports from all modules
├── references.ts     — enriched schemas, IEEEReferenceSchemaMap, types
├── relaxed.ts        — stripped schemas, relaxed map, relaxed union
├── formatting.ts     — formatCitationParts, formatNamesInCitation, segment types
└── source.ts         — IEEESourceSchema (unchanged)
```

## Section 1: Schema Enrichment (`references.ts`)

The existing 33 reference type schemas get constraints, descriptions, and date type normalization applied to their current fields.

### Constraints by field pattern

| Field pattern                                         | Constraint                                                                               | Example                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------- |
| Required `Type.String()` fields                       | `{ minLength: 1, description: "..." }`                                                   | `title`, `publisher`, `caseName`                                 |
| `authors` / `editors` / `inventors` (required arrays) | `Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })`                             | Book `authors`                                                   |
| `authors` (optional arrays)                           | `Type.Optional(Type.Array(Type.String({ minLength: 1 })))`                               | Dataset `authors`                                                |
| `year` fields                                         | `Type.String({ pattern: "^\\d{4}$", description: "Four-digit year" })`                   | Book `year`                                                      |
| URL fields                                            | `Type.String({ format: "uri", minLength: 1 })`                                           | Website `url`                                                    |
| ISBN fields                                           | `Type.Optional(Type.String({ pattern: "^(?:\\d{9}[\\dX]                                  | \\d{13})$", description: "ISBN-10 or ISBN-13 (digits only)" }))` | Book `isbn` |
| DOI fields                                            | `Type.Optional(Type.String({ pattern: "^10\\..+/.+$", description: "DOI identifier" }))` | JournalArticle `doi`                                             |
| `accessedDate`, `date`, `postDate`, `dateEnacted`     | `EncodableDate` (from `../../lib/schemata/shared.js`)                                    | Website `accessedDate`, Patent `date`                            |
| `type` discriminator                                  | unchanged (literal)                                                                      | all types                                                        |

### New exports

- `IEEEReferenceSchemaMap` — `Record<TReferenceType, TSchema>` mapping each type literal to its schema for per-type validation via `IEEEReferenceSchemaMap[ref.type]`.

### Breaking changes

- `accessedDate` moves from `Type.Number()` to `EncodableDate`.
- Freeform `date`/`postDate`/`dateEnacted` fields move from `Type.String()` to `EncodableDate`.
- Consumers storing numbers or plain strings will need to pass `Date` objects (or values that `EncodableDate.Convert()` can handle — strings and numbers both convert).

## Section 2: Relaxed Schemas (`relaxed.ts`)

Pre-built variants of all schemas with validation constraints stripped, preserving structural types only.

### What gets stripped

`minLength`, `maxLength`, `minItems`, `maxItems`, `pattern`, `format`, `minimum`, `maximum`.

### What's preserved

`type`, `properties`, `required`, `items`, `anyOf`, `allOf`, `const`, `description`, `default`, `$ref` — structural and documentary properties.

### Implementation

A recursive `stripConstraints(schema)` internal utility that deep-clones a TypeBox schema and removes constraint keys. Not exported.

### Exports

- `RelaxedBookReferenceSchema`, `RelaxedWebsiteReferenceSchema`, ... (all 33 relaxed variants)
- `IEEEReferenceSchemaRelaxed` — the relaxed discriminated union
- `IEEEReferenceSchemaMapRelaxed` — the relaxed type-to-schema lookup
- Corresponding types: `TRelaxedBookReference`, etc., `TRelaxedIEEEReference`

`EncodableDate` fields are preserved in relaxed schemas — stripping constraints doesn't change field types.

## Section 3: Citation Formatting (`formatting.ts`)

### Types

```ts
interface TCitationSegment {
    text: string
    role:
        | "authors"
        | "title"
        | "bookTitle"
        | "publisher"
        | "location"
        | "year"
        | "date"
        | "edition"
        | "pages"
        | "volume"
        | "issue"
        | "doi"
        | "url"
        | "isbn"
        | "accessedDate"
        | "institution"
        | "degree"
        | "organization"
        | "standardNumber"
        | "reportNumber"
        | "patentNumber"
        | "country"
        | "platform"
        | "separator"
        | "prefix"
        | "suffix"
        | "misc"
    style?: "italic" | "quoted" | "link" | "plain"
}

interface TCitationFormatResult {
    type: TReferenceType
    segments: TCitationSegment[]
}
```

### Exported functions

- **`formatCitationParts(ref: TIEEEReference): TCitationFormatResult`** — dispatches on `ref.type` and builds the segment array following IEEE template ordering. Each reference type has its own internal segment builder. Optional fields that are `undefined` are omitted along with their surrounding separators. No empty-string segments are produced. Author name formatting is applied inside — segments contain already-formatted author strings.

- **`formatNamesInCitation(names: string[]): string`** — formats a name array to IEEE abbreviated style: `"Jane Smith"` becomes `"J. Smith"`. Single-part names pass through unchanged. Joins with commas and `"and"` before the last entry.

### Example output (Book)

```ts
;[
    { text: "J. Author, K. Other", role: "authors", style: "plain" },
    { text: ", ", role: "separator" },
    { text: "Title of Book", role: "title", style: "italic" },
    { text: ", ", role: "separator" },
    { text: "3rd", role: "edition" },
    { text: " ed. ", role: "suffix" },
    { text: "New York, NY", role: "location" },
    { text: ": ", role: "separator" },
    { text: "Publisher", role: "publisher" },
    { text: ", ", role: "separator" },
    { text: "2024", role: "year" },
    { text: ".", role: "separator" },
]
```

## Section 4: Tests

New file `test/extensions/ieee.test.ts` following the `test/extensions/basics.test.ts` pattern.

### Test groups

1. **Schema validation** — each reference type validates a conforming object and rejects missing required fields, empty strings, malformed ISBNs/DOIs/URLs, invalid year patterns.
2. **EncodableDate fields** — date fields accept Date objects, convert from strings/numbers, reject non-date values.
3. **Relaxed schemas** — malformed ISBNs/DOIs/empty strings that fail strict validation pass relaxed validation; structural type mismatches (wrong type, missing required fields) still fail.
4. **IEEEReferenceSchemaMap** — each key maps to the correct schema, validates its own type, rejects other types.
5. **formatNamesInCitation** — single names, multi-part names, empty array, single-element array, two-element "and" join, 3+ with Oxford comma.
6. **formatCitationParts** — one test per reference type verifying correct segment ordering, roles, styles; tests for optional field omission; no empty-string segments.
