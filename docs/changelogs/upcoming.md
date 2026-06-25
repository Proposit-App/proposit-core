# upcoming changelog

## Added

- `BasicsCitationClaimExtension` (`@proposit/proposit-core/basics`) gains an optional `citationTypeGuess` field — a best-guess IEEE reference type (one of the 33 `IEEE_REFERENCE_TYPES`) or `"unknown"`. Optional, so it is non-breaking to consumers validating older canonical-claim data. Both ingestion pipelines (scholar `claim-canonicalization`, scribe `extract`) now produce it for citation claims; their prompts ask the model to fill it.

## Changed

- **Ingestion finalize now emits an explicit unparsed citation for every citation claim.** A claim classified `citation` stays typed `citation` and carries a `citation: { type: "unparsed", text, citationTypeGuess, url? }` object. `text` is the claim title (falling back to the classifier's recorded source string, then the claim id), so a url-less reference renders its text instead of a blank proposition. The guess is sanitized against the 33 IEEE literals + `"unknown"` and clamped to `"unknown"` for any absent or out-of-enum value — the model is never trusted to stay in-enum.
- **Removed the url-presence band-aid in finalize.** A url-less citation used as a logical node was previously demoted to `normal`; it now stays `citation` with its unparsed citation. Premise placement is handled separately (see below), so a citation no longer lands in a freeform premise.
- **Citation/axiomatic claims are kept out of freeform premises.** A deterministic relation pre-pass runs before formula compilation: a `support`/`joint-support` relation whose source claim is `citation` or `axiomatic` is relabeled to `derivation-support` (compiling to a derivation premise) when it has a single source. A multi-source freeform relation that mixes such a source — which cannot become a compliant derivation antecedent — is dropped and recorded as a `warning` processing failure; the rest of the import still succeeds. One bad relation degrades to an omitted premise, never a failed import.

## Tests

- `test/extensions/pipelines/finalize-response-v2.test.ts` — the citation-claim suite now asserts a citation source stays `citation` with a well-formed unparsed citation, that an absent or out-of-enum guess clamps to `"unknown"`, that a valid guess and a present url ride through, and that no loose `citationTypeGuess` field is left on the claim.
- `test/extensions/pipelines/stages/formula-compilation.test.ts` — added coverage for `rerouteDerivationOnlyRelations`: a citation/axiomatic single-source `support` relabels to `derivation-support` and compiles to a derivation premise; a multi-source citation-in-freeform relation is dropped with a warning while the other relations survive; and the stage runs the pre-pass off its claim-type-classification input.
- Re-recorded the `with-url-citation` golden fixtures (v2 + scribe) to carry the unparsed citation + guess, and the `with-axiom` v2 golden to reflect the dropped axiom-mixing freeform premise.
