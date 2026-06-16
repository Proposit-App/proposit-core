# Upcoming changelog

Commit range: `v1.11.3..HEAD`.

## Added

- New `@proposit/proposit-core/extensions/citations/unparsed` subpath exporting the unparsed-citation family: `UnparsedCitationSchema` (`{ type: "unparsed", text, citationTypeGuess, url? }`), `UnparsedCitationTypeGuessSchema` (the 33 IEEE reference types plus an `"unknown"` fallback, composed from `ReferenceTypeSchema`), and the inferred `TUnparsedCitation` / `TUnparsedCitationTypeGuess` types. An unparsed citation is a reference extracted from input text that has not yet been structured into a well-formed IEEE reference — it carries the raw `text`, a guessed reference type, and an optional locator url.
- `IEEE_REFERENCE_TYPES` — a `readonly` array of the 33 IEEE reference-type literals, exported from `extensions/citations/ieee` for callers that need to enumerate them. Constrained to `ReferenceTypeSchema`'s literal set with a compile-time exhaustiveness guard so the array and the schema cannot drift.

## Changed

- **BREAKING:** removed the `UnparsedURL` reference type. `ReferenceTypeSchema` / `IEEEReferenceSchema` / `IEEEReferenceSchemaMap` (and their `relaxed` counterparts), the `UnparsedURL` formatting template, and the `UnparsedURLReferenceSchema` / `RelaxedUnparsedURLReferenceSchema` / `UNPARSED_URL_TEMPLATE` exports no longer exist. "IEEE reference" now strictly means a fully-structured reference (33 types). The replacement for an extracted, not-yet-structured reference is `UnparsedCitationSchema` in the new `unparsed` subpath.
- **BREAKING:** relocated the IEEE module from `extensions/ieee` to `extensions/citations/ieee`. The public subpath `@proposit/proposit-core/extensions/ieee` is gone — import from `@proposit/proposit-core/extensions/citations/ieee` instead. No back-compat alias is provided.

## Tests

- Added an `UnparsedURL removal` suite to `test/extensions/ieee.test.ts` asserting `ReferenceTypeSchema` has 33 literals, rejects `"UnparsedURL"`, and that `IEEEReferenceSchema` no longer validates an `UnparsedURL` shape; updated the exhaustive-formatting and relaxed-map assertions from 34 to 33 entries.
- Added `test/extensions/citations/unparsed/unparsed-citation.test.ts` covering url-less and url-bearing unparsed citations, the `"unknown"` type-guess, rejection of a missing `text` and of a non-IEEE/`"unknown"` type-guess, and clean `.type` discrimination between an IEEE reference and an unparsed citation in a shared union.
