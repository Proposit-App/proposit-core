# upcoming changelog

<changes starting-hash="897f80d" ending-hash="c3f1e2e">

## Added

### `OriginLibrary` — a sixth `PropositCore` library slice

Three new entities in `src/lib/schemata/origin.ts`, all carrying `additionalProperties: true` after the `CoreClaimConnectionSchema` idiom:

- `CoreOriginDocumentSchema` — an immutable source text with a SHA-256 `digest` and an optional, non-load-bearing `segments` overlay.
- `CoreOriginLinkSchema` — `(argumentId, argumentVersion)` to `documentId`, carrying a `stance` of `representation` or `seed`.
- `CoreOriginAnchorSchema` — an argument-scoped target plus both of the W3C Web Annotation Data Model's text selectors: the quote with optional surrounding context, and the code-point positions.

The library is modelled on `ClaimAxiomLibrary`: a private validating wrapper that rolls back a rejected mutation, caller-supplied ids, and `snapshot()` plus a static `fromSnapshot()`. It takes no claim or argument lookup — `ArgumentLibrary` is constructed after it in the `PropositCore` dependency order, so cross-checking argument existence would invert that order.

What it does enforce is everything decidable from its own contents, of which the load-bearing check is that slicing a document by an anchor's code-point span returns the anchor's own `exact` quote. Failing that is `ORIGIN_ANCHOR_QUOTE_MISMATCH`, which turns a mis-measured anchor into a rejected write rather than a silent wrong highlight downstream.

`addDocument` takes the entity without `checksum` or `digest`: normalization and digesting happen inside the library rather than at the call site, so every document shares one coordinate system and one identity rule.

Anchor `targetType` is `expression`, `premise`, or `argument`. A global claim is excluded structurally — a claim is an independently-versioned trunk shared by reference across arguments, so "where did this claim come from" has no single answer; it is a property of one argument's use of it. A discriminant field is used here where the connection libraries use none, because all three anchor kinds live in **one** library, so "which library holds it" cannot carry the specialization.

### `normalizeOriginText` and code-point addressing

New `src/lib/utils/origin-text.ts`, exporting `normalizeOriginText`, `codePointLength`, `sliceByCodePoints`, `buildCodePointIndex`, and `sliceByCodePointsIndexed`.

The step order is the design, and each swap breaks something specific:

1. Line breaks fold to LF **first**, because a lone carriage return is itself a C0 control — stripping first would delete the break instead of converting it.
2. Stripping precedes NFC, because removing an invisible character can leave a base letter adjacent to a combining mark it was previously separated from (a base letter, a zero-width space, then a combining acute). Composing first would leave that pair for a _second_ application to compose, breaking idempotence. NFC emits no control, invisible, or line break, so the reverse hazard does not exist.

Pinned by 25 idempotence fixtures plus content-preservation and preservation-boundary suites.

Offsets are code points, not UTF-16 code units. `Intl.Segmenter`, `graphemer`, and `grapheme-splitter` all segment grapheme clusters — a different unit that would yield wrong offsets — so only the built-in string iterator is used. `test/origin/origin-text.test.ts` asserts that `String.prototype.slice` on the same offsets returns a **different** string, so the suite fails if anyone switches the unit.

### `sha256Hex`

New `src/lib/utils/sha256.ts` — a synchronous pure-TypeScript FIPS 180-4 implementation over `TextEncoder`, deliberately not `crypto.subtle.digest`. Every library mutator here is synchronous and `entityChecksum` is synchronous by construction, so an async digest would either infect the whole mutation surface or push the digest onto the caller, contradicting "core computes and stores it". `crypto.subtle` is also absent from a bare React Native runtime.

`test/origin/sha256.test.ts` pins it against published NIST vectors **and** against `node:crypto` over an eleven-fixture set, so a consumer digesting the same bytes with Web Crypto agrees by construction. `node:crypto` appears in the test only; `src/lib/` may not import it.

FNV-1a (`computeHash`) is not reused for this — a 32-bit non-cryptographic hash is unusable for content identity. A document's _entity_ checksum covers its `digest` rather than its `text`, so hashing a long document costs one pass over 64 hex characters, and attributing a document leaves its checksum unchanged.

### Presentable rule `P-6`

An expression carrying `enthymeme: true` must be a variable expression whose variable is claim-bound. `validateP6` reads `ctx.expressions` and `ctx.variables` — both already on `TValidatorContext` — and reuses the exported `isPremiseBound` guard.

Both halves are reported, because neither is expressible in the schema. The TypeScript types confine the field to variable expressions, but the entity schemas stay open for app-level fields, so `patchExpressionAppFields` on an operator or formula expression succeeds and shifts that expression's checksum. Closing those schemas was the alternative and was rejected — the same openness is what carries `creatorId` and `createdOn` in the existing app-extension coverage.

The tier dispatcher composes cumulatively, so placing the rule in Presentable makes it invisible to the lower three tiers with no extra work, and the Structural-only throw rule means marking a premise-bound variable never throws at mutation time. `E-2` and `D-7` remain reserved.

### The `enthymeme` field

`Type.Optional(Type.Literal(true))` on `CorePropositionalVariableExpressionSchema` and on `CommonPremiseFields`, which both `CorePremiseSchema` variants compose. Added to the default `expressionFields` and `premiseFields` checksum sets.

**Backward compatible with no migration**, and the reason is exact: `entityChecksum` picks a field only when the key is present on the entity, and `createChecksumConfig` unions additional fields onto the defaults rather than replacing them. An entity lacking the key contributes nothing and hashes byte-identically.

That holds **only** while unmarked entities omit the key. Persisting `enthymeme: null` — or `false` — makes the key present and shifts the checksum of every premise and expression in existence. A plain `Type.Optional(Type.Boolean())` rejects `null` and accepts `false`, which is the likelier of the two to arrive by accident from an unchecked form control or an ORM default, so the schema is narrowed to the literal `true`. The CLI's on-disk schemas mirror it.

`test/origin/enthymeme-checksum.test.ts` was written and passing **before** the field existed, against seven frozen fixtures in `checksum-fixtures.ts` with hard-coded golden hex strings. Those goldens are unchanged now that the field has landed — that is the byte-identity proof, and re-recording them would convert it into a tautology. The same file separately asserts that `null`, `true`, and `false` each change the hash and each differ from the others.

No new mutator was added: an expression takes the field through the existing `patchExpressionAppFields`, a premise through the existing extras round-trip. Unmarking passes `undefined`, and every path that writes caller-supplied fields onto an entity now **deletes** a key whose value is `undefined` rather than assigning it — `PremiseEngine.patchAndMarkExpression`, `setExtras` on both `ArgumentEngine` and `PremiseEngine` (and therefore both `updateExtras`), and the `ArgumentParser` `map*` extension hooks, all through one `withoutUndefinedValues` helper — `Object.assign` left the key present holding `undefined`, which is checksum-safe and JSON-safe on its own but makes `"enthymeme" in entity` true, and any downstream mapper that turns `undefined` into `null` then flips the field from absent to present. The change is in the shared helper, so it covers every patched field rather than this one path.

### `IEEEOriginDocumentSchema`

New `src/extensions/citations/ieee/origin-document.ts`, intersecting `CoreOriginDocumentSchema` with `url` and `reference` — the `IEEECitationClaimSchema` pattern verbatim. Attribution deliberately does not enter `src/lib/`: core holds the slot through `additionalProperties`, the extension supplies the reference vocabulary. No citation claim is created, so grammar rule D-5 is untouched.

### CLI `origins` command group

`origins attach`, `origins list`, `origins show`, `origins link`, `origins unlink`, `origins remove`, `origins anchor add`, and `origins anchor remove`, plus `--enthymeme` and `--no-enthymeme` on `premises update` and a new `expressions mark`.

`attach` and `link` verify the argument version exists on disk before minting anything — the library deliberately cannot see arguments, so a typo would otherwise persist a link nothing resolves and nothing reports. `link` attaches an already-stored text to another argument, which is what makes the digest useful; `remove` refuses while any link or anchor still points at the document.

`"origins"` is added to `NAMED_COMMANDS` in `src/cli/router.ts` — omitting it routes the word as an argument UUID and dies in `resolveVersion` with an unrelated error. State persists to `origins.json` through the existing read/write triplet idiom; the bare-`catch` fallback to an empty library means no migration file is needed.

`anchor add` derives `exact` by slicing the stored document rather than accepting it as input: the operator selected a range, so the positions are authoritative and a hand-typed quote could only disagree with them.

## Fixed

### `normalizeOriginText` was not idempotent, and `addDocument` refused ordinary text

`isLegitimateInContext` read its neighbours from the pre-strip array while `stripInvisibleCharacters` accumulated its output separately, so a code point being removed still acted as the legitimacy base for the one beside it. The joiner, the variation selectors, and the tag characters are all `Emoji_Component` or pictograph-adjacent, so they qualified each other.

`"The cat" + U+200D + U+FE00 + " sat."` kept the variation selector on the first pass — its predecessor in the _original_ array was the joiner — and dropped it on the second. `addDocument` stored the first-pass string and `withValidation` then re-normalized to check it, got the second, and rolled back with `ORIGIN_DOCUMENT_TEXT_NOT_NORMALIZED`. The library refused to store text it had just normalized itself.

Worse for the consumer flow the docs prescribe: normalize at your import boundary, measure offsets, hand the same string to `addDocument`, and every anchor fails `ORIGIN_ANCHOR_QUOTE_MISMATCH` because the stored text differs from the one measured.

The rule is now that **a removal candidate never legitimizes another removal candidate**: the backward look reads only what was actually emitted, and the joiner's one forward look rejects a `next` that is itself a candidate. Iterating to a fixed point was the alternative and was rejected — it hides the wrong per-pass rule behind a loop.

Every pre-existing idempotence fixture separated its invisibles with an ordinary letter, so no test placed two candidates adjacent and the entire failure class was untested. Added thirteen adjacency fixtures plus an exhaustive sweep over every three-code-point string from a fourteen-symbol emoji/invisible alphabet — 2,744 strings, which found 144 non-idempotent cases before the fix.

A bare joiner followed by a variation selector in plain prose previously survived both passes, each keeping the other alive. Both are now stripped.

### A mutation is judged on what it introduces, not on whether everything is clean

`withValidation` required `validate().ok` over the whole library after every mutation, which made an already-inconsistent library permanently unrepairable: two anchors violating the same invariant each blocked the other's removal, and `removeDocument` then refused because they were still there. Every mutation failed forever, with hand-editing `origins.json` the only exit — reachable from any file written before the anchor-link rule existed, or from any snapshot a consumer assembles.

It now compares the post-mutation violation set against the pre-mutation one and rejects only what the mutation _introduced_. One rule, no add-versus-remove branching: an `addAnchor` with no link still introduces a violation and is still refused on a broken library as on a clean one, and `removeLink` still refuses to orphan existing anchors. The pre-mutation set is carried between mutations rather than recomputed, so this stays at one `validate()` per mutation; `fromSnapshot` seeds it once and still does not reject a payload, which is what leaves a bad one repairable.

### An anchor could name an argument version with no link

`addAnchor` accepted an anchor for `arg@77` when the only link was `arg@0`, and `validate()` reported nothing. The link carries the stance, and the stance is what decides whether unanchored content means anything, so an anchor without one is provenance no consumer can interpret. `validate()` now requires every anchor's `(argumentId, argumentVersion, documentId)` to have a matching link — new code `ORIGIN_ANCHOR_LINK_NOT_FOUND` — which also makes removing a link that still has anchors a violation, and fixes the persistence order a consumer must follow.

### `validate()` re-scanned every document body on every mutation

Documents are immutable and `addDocument` computes their text and digest itself, yet every `addAnchor`, `addLink`, and `removeAnchor` re-ran `normalizeOriginText` and `sha256Hex` over every document and rebuilt a code-point index per document. One hundred `addAnchor` calls against five ~98 KB documents took **1,117 ms**; the same run now takes **44 ms**.

Both the verified-body record and the code-point index are keyed to the exact text that passed, not to the document id, so neither a tampered snapshot nor a future document-replace path can inherit an earlier verdict or slice against the wrong string — both asserted directly. A document is recorded as verified only once its own normalization self-check holds, so `ORIGIN_DOCUMENT_TEXT_NOT_NORMALIZED` stays reachable at add time.

The remaining O(n²) in anchor count across a bulk import is one short slice comparison per pair and is named in a comment on `withValidation`. Retained index memory is the other side of the trade and is recorded as a follow-up: twenty anchored documents totalling 10 MB of text hold roughly 103 MB of heap, with no eviction and no cap.

## Changed

- **`TPropositCoreSnapshot` gains an `origins` slot**, and `PropositCore` and `TPropositCoreOptions` gain `TOriginDocument`, `TOriginLink`, and `TOriginAnchor`. The three parameters are appended at the **end** of every generic list rather than slotted in beside the other libraries — inserting them mid-list would silently re-bind every consumer that spells out all twelve arguments.

- **`PropositCore.fromSnapshot` tolerates a missing `origins` slot**, defaulting to an empty library. Deliberately unlike the `LEGACY_MISSING_AXIOM_SLOT` guard beside it: that one exists because a pre-v0.12 snapshot could legitimately hold axiomatic claims whose connections were dropped, so absence was ambiguous. Nothing ever held origin data, so absence here is unambiguously "none" and defaulting is lossless — and a hard guard would break `@proposit/shared` and `proposit-server` the moment they repin, before they persist origin data of their own.

- **`CliPremiseMetaSchema` and the variable arm of `CliExpressionSchema` now declare `enthymeme`.** `CliPremiseMetaSchema` sets `additionalProperties` to a _string_ schema, so a boolean core field that is not declared explicitly makes the premise's `meta.json` unreadable — the CLI reports `Invalid or corrupt file`. Caught by the smoke test rather than by `pnpm run check`. Both use `Type.Optional`, never `Nullable`, for the same reason the core schemas do.

- **`forkArgument` carries a comment recording that origin entities are not cloned.** Core's fork machinery touches no association library — `fork.ts`, `fork-namespace.ts`, and `fork-library.ts` reference no citation, axiom, or claim connection, and `TForkLibrarySnapshot` declares remap records for exactly five entity types. Origin entities follow that precedent and are copied at the persistence layer instead; no sixth fork-record type was added.

- **`orderChangeset` is untouched.** It handles five argument-scoped entity kinds and has never included claims, citations, axioms, or forks — those persist through `snapshot()` and `fromSnapshot()`, and origin entities take the same route. Recorded because the standing invariant asks that any change adding entity types be flagged, and the answer here is that none was added.

## Notes

**`out-of-character` was evaluated as a dependency and rejected.** Reading the v2.3.0 tarball, its single `"."` export resolves to a pre-bundled `builds/out-of-character.mjs` with zero hits for `require(`, `import ... from`, `glob`, `colorette`, or `node:` — the character catalogue is inlined, so the runtime concern the epic raised does not materialize.

It fails the other half of the check twice over. `glob@13.0.6` and `colorette` are declared as plain `dependencies`, so every installer of `@proposit/proposit-core` would pull a filesystem glob engine in order to normalize a string; and an import inside `src/lib/` breaches the repo's grep-proof zero-third-party boundary regardless of what the bundle does at runtime.

Its _logic_ was lifted rather than rediscovered. Four preservation boundaries are reproduced from its `src/match.js` and `src/isEmoji.js`, each tested in both directions:

| Character class                   | Stripped | Preserved when                                                                       |
| --------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| U+200D zero width joiner          | yes      | adjacent to `\p{Extended_Pictographic}`, U+FE0F, or a skin-tone modifier             |
| U+FE00–U+FE0F variation selectors | yes      | preceded by `\p{Extended_Pictographic}`, `\p{Emoji_Component}`, or `\p{Ideographic}` |
| U+180B–U+180F Mongolian FVS       | yes      | preceded by `\p{Script=Mongolian}`                                                   |
| U+E0000–U+E007F tag characters    | yes      | the run begins immediately after a pictograph                                        |

Bidi controls, zero-width space and non-joiner, word joiner, soft hyphen, and the byte-order mark are stripped unconditionally.

</changes>

<changes starting-hash="68f2481" ending-hash="25f98ae">

## Added

- **`locateSourceAnchor` + `TIngestionSourceAnchor`, exported from `@proposit/proposit-core/pipelines/base`.**
  `locateSourceAnchor(input, quote, hintUtf16)` finds a quote in a text and
  returns `{quote, startUtf16, endUtf16, prefix, suffix}`, or `undefined` when
  the quote cannot be found. The ladder is exact match, then a
  whitespace-insensitive retry (any whitespace run matches any other, covering a
  model that flattens a line break to a space); nothing approximate. `hintUtf16`
  only selects among repeated occurrences, so a wrong hint degrades to "picked
  another occurrence of the same text", never to a wrong span. `prefix`/`suffix`
  carry `SOURCE_ANCHOR_CONTEXT_CHARS` (32) characters of surrounding input,
  clamped at both ends. On a whitespace-insensitive hit the returned `quote` is
  the **input's** text for the matched range rather than the caller's copy,
  which is what keeps `input.slice(startUtf16, endUtf16) === quote` true for
  every anchor the function returns.
- **`finalizeResponseV2` attaches `sourceAnchors` to claims and premises.** A
  claim gets one anchor per canonicalizer mention that resolved to it, in
  `mentionIds` order, deduped by range; a premise compiled from a relation gets
  one anchor for that relation's `evidence.quote`. The key is **omitted
  entirely** when nothing resolves — never `sourceAnchors: []`.
- **`SOURCE_ANCHOR_NOTE_CODES` — non-fatal notes for anchor resolution.**
  Finalize emits `SOURCE_ANCHOR_UNRESOLVED` when a quote is not found in the
  input and `SOURCE_ANCHOR_AMBIGUOUS` when it occurs more than once and the hint
  broke the tie. Both are `severity: "warning"` on `PipelineResult.failures` via
  `ctx.addFailure`; neither stops assembly. Dropping an unlocatable quote was
  already correct, but dropping it in silence meant a model that started
  paraphrasing would take anchor coverage to zero in production with no
  detector. An empty relation evidence quote is not reported — it is a legal
  "no span to cite", not a failed lookup.
- **`locateSourceAnchor` now returns `TSourceAnchorMatch`** —
  `{ anchor, occurrences }` rather than a bare anchor, so a caller can tell a
  unique match from a tie-break. The emitted `sourceAnchors` payload is
  unchanged.
- **The mention hint is `segment.span.start + mention.span.start`.** The
  composition is required: `claim-mention-extraction` asks the model for spans
  "relative to the SEGMENT'S TEXT (not the original input)", so a raw mention
  span drifts further from the truth the deeper into the document a claim sits.
  It is only a hint either way — offsets are produced by locating the quote, so
  an emitted span always slices back to its own quote.
- **`TFinalizeResponseV2Input` takes optional `segmentation` and `mentions`.**
  The two stage outputs are passed in rather than read from `ctx`, because a
  pipeline that lacks those stages can neither declare them in
  `finalize.dependsOn` (`UNKNOWN_DEP`) nor have finalize read them (`ctx.get`
  outside `dependsOn` is a configuration error). `createScholarPipeline`
  declares both as optional finalize deps and passes them;
  `createScribePipeline` passes neither.

## Fixed

- **Anchor `prefix`/`suffix` no longer strand a lone surrogate.** The context
  window is measured in UTF-16 code units, so a non-BMP character straddling its
  boundary used to leave an unpaired surrogate at the edge of the string. That
  is not cosmetic: Postgres rejects an unpaired surrogate escape on insert into
  `json`/`jsonb`, so a single emoji 31 code units from a claim would fail a
  consumer's whole persist transaction, and a `TextEncoder` round-trip instead
  substitutes U+FFFD, silently breaking the re-locate path the context exists to
  serve. The window now shrinks by one code unit, dropping the character whole.
- **A pipeline input without a `text` field no longer throws out of finalize.**
  `TStageContext.input` is `unknown` and `finalizeResponseV2` is public API for
  consumers assembling their own pipelines; the input was cast rather than
  checked, so a pipeline whose `inputSchema` is (say) `{ document: string }`
  reached `haystack.indexOf` with `undefined` and threw on the happy path, after
  every LLM call had been paid for. Anchors are the only reader of the input, so
  a missing `text` now yields no anchors — the documented behavior — instead.
- **Reported offsets are located rather than trusted, on both halves of the
  hint.** A mention's input position is `segment start + mention offset within
the segment`, and the composition previously read the model's number for each.
  The prompts require both segment and mention text be copied verbatim, so both
  terms are recoverable by searching — and both reported numbers are wrong on the
  recorded corpus: segment starts run one short on several segments, and a
  mention offset is off by 14 on `with-url-citation`, where the model miscounts
  past a markdown link. That last one is the largest error in the corpus and
  survived an earlier partial fix that addressed only the segment term. Harmless
  while every quote is unique; a confidently wrong location the moment one
  repeats.
- **A segment the model rewrote no longer derails the segment after it.** The
  scan carries a cursor so a repeated segment cannot collapse onto an earlier
  copy, but the not-found branch left the cursor behind the skipped segment's
  territory, so the next segment could match a duplicate inside it — worse than
  the reported number it replaced, and the exact collapse the cursor exists to
  prevent. The cursor now advances past the skipped segment, and among the
  candidates at or after it the one nearest the model's reported start wins
  rather than the first, which also removes the overshoot hazard the cursor
  advance would otherwise introduce.
- **An anchor range that would split a surrogate pair is refused.** The
  well-formedness guard covered the two context fields but not the located range
  itself, so an ill-formed model quote — a bare `\uD83D` escape is valid JSON and
  survives `JSON.parse` — could match inside a whole pair and put a lone
  surrogate in `quote`. The candidate range is discarded rather than the quote
  trimmed, which is what preserves
  `input.slice(startUtf16, endUtf16) === quote`.
- **An input carrying no `text` is reported once, not once per quote.** The
  fallback to `""` is correct and stays, but every mention and relation then
  reported its own `SOURCE_ANCHOR_UNRESOLVED`, blaming the model for a property
  of the caller's input shape and echoing every extracted quote into `failures`.
  Resolution is now skipped wholesale in that case and a single
  `SOURCE_ANCHOR_INPUT_UNAVAILABLE` names the real cause.

## Changed

- **`createScholarPipeline`'s `finalize.dependsOn` gains two optional entries** —
  `segmentation` and `claim-mention-extraction`. Both already ran; neither can
  fail the finalize gate, since an optional dep never propagates a skip.
- **`mentionIds` and `suggestedSymbol` are still stripped from the finalized
  claim**, and the comment saying so now explains why: carrying the raw ids
  forward would hand a consumer an id space the response never contains, while
  the resolved anchors are the actionable form of the same trace.

## Notes

- **No prompt changed and no LLM call was added.** The per-fixture
  `*-recorded-llm.json` recordings are byte-identical across this change, which
  the replay harness's prompt-hash guard would have rejected otherwise, and the
  golden e2e suites now assert the LLM call count directly (8 for the thorough
  pipeline, 2 for the fast one).
- **The fast pipeline emits no claim anchors.** It has no segmentation or
  mention stage and its `extract` prompt asks for synthetic mention ids. Its
  relation evidence would anchor premises, but its `structure` prompt states
  that an empty quote is acceptable and the recorded fixtures take that option,
  so in practice it currently produces none.
- **One recorded relation quote in the corpus is elided rather than verbatim**
  (`with-url-citation` joins two clauses with `...`), so that premise resolves
  to no anchor. Dropping it is the designed behavior — an unlocatable quote is
  never turned into an anchor at an unverified offset.
- **The recorded corpus emits exactly two resolution notes**, both of them
  model-behavior findings rather than defects: the elided `with-url-citation`
  quote above under the thorough pipeline, and a `with-axiom` relation under the
  fast pipeline whose evidence quote is a synthesized summary sentence rather
  than a copy. Pinned by a test that replays all ten recordings, added because an
  earlier count of "one" had been measured on the thorough pipeline alone.

</changes>
