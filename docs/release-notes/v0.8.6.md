# Release Notes

## IEEE Extension Enrichment

- All 33 IEEE reference type schemas now include field descriptions, validation constraints (min lengths, regex patterns for ISBN/DOI/URL, format hints), and proper date handling via `EncodableDate`.
- New `IEEEReferenceSchemaMap` export for per-type schema lookup.
- New relaxed schema variants (`IEEEReferenceSchemaRelaxed`, `IEEEReferenceSchemaMapRelaxed`, and all 33 individual relaxed schemas) with validation constraints stripped for permissive use cases.
- New `formatCitationParts()` function that produces structured citation segments with roles and style hints for consumer rendering.
- New `formatNamesInCitation()` function for IEEE-style author name abbreviation.

**Breaking:** `accessedDate`, `date`, `postDate`, and `dateEnacted` fields across all reference types now use `EncodableDate` instead of `Type.Number()` or `Type.String()`. Values convert automatically from strings and numbers via `Value.Parse()`.
