# Upcoming changelog

Commit range: `v1.11.1..HEAD`.

## Changed

- `CORE_PROMPT` (`src/lib/parsing/prompt-builder.ts`): added a "Best-Effort Extraction"
  section and revised the `argument`/`failureText` field descriptions and Edge Cases so
  the parse never refuses a half-baked argument. A lone conclusion or one-sided passage
  now yields a best-effort structured argument; `argument: null` + `failureText` is
  reserved for input with no extractable proposition at all. Affects the CLI `parse`
  command, the basics parser, and legacy single-shot ingestion (the v2 multi-stage
  ingestion has its own refusal logic and is unaffected).
- `docs/api-reference.md`: clarified `TParsedArgumentResponse` to document the
  best-effort prompt behavior and when `failureText` is populated.

## Tests

- `test/core.test.ts`: added "Basics parse — best-effort, never refuse half-baked"
  deterministic substring assertions guarding the new prompt guidance.
- `test/extensions/argument-ingestion/fixtures/*/recorded-llm.json`: re-stamped the v1
  golden-corpus request hashes for the new prompt (request `systemPrompt` + `hash` only;
  recorded responses and `expected.json` unchanged — all five fixtures are well-formed
  arguments whose best-effort parse is identical to the prior refusal-capable parse).
