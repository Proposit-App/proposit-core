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

No new mutator was added: an expression takes the field through the existing `patchExpressionAppFields`, a premise through the existing extras round-trip. Unmarking passes `undefined`, and `PremiseEngine.patchAndMarkExpression` now **deletes** a key patched to `undefined` rather than assigning it — `Object.assign` left the key present holding `undefined`, which is checksum-safe and JSON-safe on its own but makes `"enthymeme" in entity` true, and any downstream mapper that turns `undefined` into `null` then flips the field from absent to present. The change is in the shared helper, so it covers every patched field rather than this one path.

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

### An anchor could name an argument version with no link

`addAnchor` accepted an anchor for `arg@77` when the only link was `arg@0`, and `validate()` reported nothing. The link carries the stance, and the stance is what decides whether unanchored content means anything, so an anchor without one is provenance no consumer can interpret. `validate()` now requires every anchor's `(argumentId, argumentVersion, documentId)` to have a matching link — new code `ORIGIN_ANCHOR_LINK_NOT_FOUND` — which also makes removing a link that still has anchors a violation, and fixes the persistence order a consumer must follow.

### `validate()` re-scanned every document body on every mutation

Documents are immutable and `addDocument` computes their text and digest itself, yet every `addAnchor`, `addLink`, and `removeAnchor` re-ran `normalizeOriginText` and `sha256Hex` over every document and rebuilt a code-point index per document. One hundred `addAnchor` calls against five ~98 KB documents took **1,117 ms**; the same run now takes **44 ms**.

Both the verified-body record and the code-point index are keyed to the exact text that passed, not to the document id, so a tampered snapshot cannot inherit a previous instance's verdict — asserted directly. The remaining O(n²) in anchor count across a bulk import is one short slice comparison per pair and is named in a comment on `withValidation`.

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
