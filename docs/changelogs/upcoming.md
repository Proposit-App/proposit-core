# Upcoming changelog

Commit range: `v1.5.0..HEAD`.

## Fixed

<changes starting-hash="3b071ea" ending-hash="039ceb3">
- Added an anti-attribution clause to the two in-code ingestion prompts
  that author user-facing claim prose, so the model stops prepending an
  attributive reporting frame ("The author claims X") to extracted
  claims:
  - `CORE_PROMPT` "Writing Style" in `src/lib/parsing/prompt-builder.ts`
    (the active production path, consumed by `proposit-server` via
    `buildParsingPrompt`).
  - `CLAIM_CANONICALIZATION_SYSTEM_PROMPT` "Style" in
    `src/extensions/argument-ingestion/stages/claim-canonicalization.ts`
    (the v2 multi-stage pipeline, fixed in lockstep).
  The clause keeps the existing third-person, present-tense, declarative
  voice and explicitly preserves the citation-to-source framing (citation
  claims still summarize what the external cited source asserts). The
  other ingestion-stage system prompts were audited and left unchanged —
  their "author" references are model-instruction text describing the
  input, not output-prose guidance, and the deterministic
  `*-detection` / classification / relation / conclusion stages don't
  author free-form claim prose.
- Added deterministic prompt-string regression tests in
  `test/core.test.ts` ("Ingestion prompts — anti-attribution clause")
  asserting the clause is present in `buildParsingPrompt(...)` output
  (including `BasicsParsingSchema`) and in
  `CLAIM_CANONICALIZATION_SYSTEM_PROMPT`.
- Refreshed the golden-corpus recordings under
  `test/extensions/argument-ingestion/fixtures/` (10 records across the
  5 fixtures' `recorded-llm.json` + `v2-recorded-llm.json`): the
  recorded-replay provider hashes the request including `systemPrompt`,
  so the prompt edit tripped the `RecordedPromptStaleError` drift guard.
  Updated each affected record's stored `systemPrompt` + recomputed hash;
  the recorded `response.output` is preserved verbatim (the golden
  outputs were already attribution-free, so no re-record against a live
  model was needed).
</changes>
