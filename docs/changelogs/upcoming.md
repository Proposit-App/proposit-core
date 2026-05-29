# Upcoming changelog

Commit range: `v1.4.0..HEAD`.

## Changed

- **v2 ingestion premise titles now read as natural-language prose.**
  `finalizeResponseV2` (`src/extensions/argument-ingestion/shared/finalize-response-v2.ts`)
  previously titled each premise by prefixing the role
  (`Support:` / `Joint support →` / `Derivation:` / `Conclusion:`) and
  string-serializing the compiled symbolic `formula`, truncated at 50
  chars — which mangled multi-claim premises mid-symbol. Titles are now
  composed from the LLM-authored claim titles, mirroring
  `buildArgumentTitle`. The machine `formula` field and
  `TParsedArgumentResponse`'s shape are unchanged — only the
  human-facing `title` content changes. Forward-only; no backfill of
  persisted arguments. Composition rules:
    - Relation-derived premises (support / joint-support / derivation)
      are composed by **walking the source relation** (`sources` →
      `target`, both claim miniIds) rather than re-parsing the formula
      string. A premise renders as
      `If "<antecedent title>" then "<consequent title>"`, with
      multi-source antecedents `and`-joined
      (`If "<a>" and "<b>" then "<c>"`).
    - The conclusion premise (a bare symbol, no source relation)
      renders as the conclusion claim's title verbatim (unquoted).
    - Each claim title resolves via `title ?? axiom`; an unresolvable
      title falls back to the claim's assigned variable **symbol**
      (never throws). Axiomatic claims (which carry `axiom`, not
      `title`) compose correctly via this fallback.
    - The role prefix is **dropped** (the display layer renders a
      separate conclusion chip) and the 50-char truncation cap is
      removed.

## Tests

- `test/extensions/argument-ingestion/finalize-response-v2.test.ts`:
  new unit suite driving `finalizeResponseV2` with a hand-built
  `TStageContext` stub — pins the prose composition for a `support`
  (implies), a `joint-support` (and), and the conclusion premise; the
  no-role-prefix and no-truncation invariants; and the
  symbol-fallback path when a claim title is missing.
- `test/extensions/argument-ingestion/fixtures/{enthymeme,straightforward,with-axiom,with-url-citation}/v2-expected.json`:
  regenerated golden outputs (replay/rewrite mode, no live LLM) to
  reflect the prose titles. The `with-url-citation` fixture covers the
  `derivation`-role premise; `with-axiom` covers the axiom-as-title
  fallback.
