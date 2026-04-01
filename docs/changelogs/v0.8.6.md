# Changelog

## IEEE Extension Enrichment

- `src/extensions/ieee/references.ts` — Added field descriptions, validation constraints (minLength, minItems, pattern, format), EncodableDate for date fields, IEEEReferenceSchemaMap export with `satisfies Record<TReferenceType, TSchema>`
- `src/extensions/ieee/relaxed.ts` — New file: constraint-stripped schema variants with internal `stripConstraints` utility (safe for Value.Check/Value.Parse only)
- `src/extensions/ieee/formatting.ts` — New file: `formatCitationParts()`, `formatNamesInCitation()`, `TCitationSegment`, `TCitationFormatResult` types, 33 per-type segment builders
- `src/extensions/ieee/index.ts` — Updated barrel to re-export relaxed and formatting modules
- `test/extensions/ieee.test.ts` — New file: 48 tests covering schema validation, constraint rejections, EncodableDate, relaxed schemas, schema map, name formatting, citation parts formatting
