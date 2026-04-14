# Changelog

<changes starting-hash="23429e5" ending-hash="f09b5e6">

## Added

- `UnparsedURLReferenceSchema` in `src/extensions/ieee/references.ts` — new IEEE reference type (`"UnparsedURL"`) with required `url` and optional `text` fields
- `RelaxedUnparsedURLReferenceSchema` in `src/extensions/ieee/relaxed.ts` — constraint-stripped variant
- `UNPARSED_URL_TEMPLATE` in `src/extensions/ieee/segment-templates.ts` — formatting template rendering optional text as quoted title followed by `[Online]. Available: url`
- `UnparsedURL` entry in `TEMPLATES` map (`src/extensions/ieee/formatting.ts`)
- Integration test `test/integration/parse-api.test.ts` — hits real OpenAI API to verify full parse pipeline produces sources with `url` and optional `text` fields; auto-skips when no API key is available

## Changed

- `ParsedSourceSchema` (`src/lib/parsing/schemata.ts`) — now has `url` (required) and `text` (optional) instead of just `text` (required)
- `CORE_SOURCE_KEYS` in `src/lib/parsing/prompt-builder.ts` — added `"url"`
- Parser system prompt "Sources" section (`src/lib/parsing/prompt-builder.ts`) — rewritten to instruct the LLM to extract `url` and optional `text` (e.g., markdown anchor text) for each source
- `ReferenceTypeSchema` discriminator union — added `"UnparsedURL"` literal
- `IEEEReferenceSchema` and `IEEEReferenceSchemaMap` — added `UnparsedURLReferenceSchema`
- `IEEEReferenceSchemaRelaxed` and `IEEEReferenceSchemaMapRelaxed` — added `RelaxedUnparsedURLReferenceSchema`
- Test fixtures in `test/core.test.ts` — updated source objects to include `url` field; added url-only source test for `ParsedSourceSchema`
- Count assertions in `test/extensions/ieee.test.ts` — updated 33 → 34 for new reference type; added `UnparsedURL` entry to exhaustive formatting test

</changes>
