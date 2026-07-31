# Rework — Origin data library and enthymeme annotation

Dual review of `origin-data-library` returned seven findings. All go back for
rework at full scope, including the LOWs.

Every finding below was reproduced against the built output before any code was
written; the measurements in each entry are mine, not quoted. House rule: a
failing test lands before each fix. Several of these exist precisely because the
fixtures dodged the failure class, so the test comes first in every case.

## 1. HIGH — `normalizeOriginText` is not idempotent, and `addDocument` refuses text it normalized itself

`src/lib/utils/origin-text.ts:75-105`. `isLegitimateInContext` reads
`codePoints[index - 1]` and `codePoints[index + 1]` from the **pre-strip** array
while `stripInvisibleCharacters` accumulates `out` separately, so a code point
that is itself being removed still acts as the legitimacy base for its
neighbour. ZWJ (U+200D), the variation selectors, and the tag characters are all
`Emoji_Component` or pictograph-adjacent, which is exactly why they wrongly
qualify.

Reproduced against `dist/`:

| Input | Pass 1 | Pass 2 |
|---|---|---|
| `"The cat" + U+200D + U+FE00 + " sat."` | `"The cat︀ sat."` | `"The cat sat."` |
| `"The cat" + U+FE0F + U+FE0F + " sat."` | `"The cat️ sat."` | `"The cat sat."` |
| `"The cat" + U+E0067 + U+FE0F + " sat."` | `"The cat️ sat."` | `"The cat sat."` |

`addDocument` stores the pass-1 string, then `withValidation` runs `validate()`,
which re-normalizes and gets pass 2. Mismatch →
`ORIGIN_DOCUMENT_TEXT_NOT_NORMALIZED` → rollback → throw. The library refuses to
store ordinary text.

The second failure is worse for the epic: `origin-text.ts` and
`docs/api-reference.md` both tell consumers to normalize at their own import
boundary and again on document creation. A consumer that computes anchor offsets
against its once-normalized text then calls `addDocument` gets a differently
normalized stored text, and every anchor it adds fails
`ORIGIN_ANCHOR_QUOTE_MISMATCH`. That is the downstream server slice's exact flow.

**Root cause, stated so the fix is not a patch on one symptom:** a code point
that is itself a removal candidate must never serve as the legitimacy base for
another removal candidate.

**Fix.** Consult what actually survived: track the last *emitted* code point as
`previous`, run the tag-run backscan over the emitted output, and for the ZWJ
lookahead reject a `next` that is itself a removal candidate. Iterating to a
fixed point was the alternative and is rejected — it hides the bug behind a loop
and leaves the per-pass rule wrong.

**Test debt this exposes.** Every idempotence fixture at
`test/origin/origin-text.test.ts:44-79` separates its invisible characters with
an ordinary letter (`a${VS16}b${VS1}c`), so **no test places two removal
candidates adjacent** — the whole failure class is untested. Adjacency fixtures
plus a property test over an emoji/invisible alphabet.

**Related, and resolved by the same fix.** `"a" + ZWJ + VS16 + "b"` currently
normalizes to itself with both invisibles retained (ZWJ kept because its next is
VS16; VS16 kept because its previous is ZWJ). Stable, so not the idempotence
bug, but a bare ZWJ+VS16 pair surviving in plain prose is not intended. Under
the root-cause fix neither anchors the other and both are stripped.

`AGENTS.md` and `docs/api-reference.md` both assert that the step order is what
makes the function idempotent. That sentence becomes incomplete once the
removal-candidate rule carries part of the weight; both need to match.

## 2. MEDIUM — the schema accepts `enthymeme: false`, which breaks the checksum invariant exactly as `null` would

`src/lib/schemata/propositional.ts:52-57`. `Type.Optional(Type.Boolean())`
rejects `null` and accepts `false`; confirmed with `Value.Check` against both
`CorePropositionalVariableExpressionSchema` and `CoreFreeformPremiseSchema`. A
present key is a present key, and `false` is the likeliest value an unchecked
form control or an ORM default produces.

**Fix.** `Type.Optional(Type.Literal(true))`, which also makes the field's own
description ("a null or false value is not the same as absent") true of the
schema. Mirror it in the CLI's on-disk schemas, which have the same hole.

## 3. MEDIUM — `enthymeme` on a non-variable expression is silently accepted and never reported

`src/lib/grammar/validators/presentable.ts:248` skips any expression whose type
is not `variable`, and the union schema accepts the extra key on operator and
formula expressions (confirmed). So
`engine.patchExpressionAppFields(operatorExprId, { enthymeme: true })` succeeds,
shifts that expression's checksum, and no tier reports anything. The CLI guards
it; the library API is what the three downstream repos call.

The JSDoc at `presentable.ts:234` — "The schema confines the annotation to
variable expressions and premises" — is true of the TypeScript types and false at
runtime.

**Fix: report `P-6`, do not close the schemas.** Closing the operator and formula
schemas would break the documented app-extension mechanism — the existing
`patchExpressionAppFields` coverage in `core.test.ts` attaches `creatorId` and
`createdOn` to expressions through exactly that openness. Reporting is also the
behavior consistent with the rest of the tier. Make the JSDoc true either way.

## 4. MEDIUM — `validate()` re-normalizes and re-digests every document body on every mutation

`src/lib/core/origin-library.ts:149-165` and `:428-454`. Documents are immutable
and their `text` and `digest` are computed by `addDocument` itself, yet every
`addAnchor` / `addLink` / `removeAnchor` re-runs `normalizeOriginText` and
`sha256Hex` over every document in the library, and rebuilds a code-point index
per document. Measured: 100 `addAnchor` calls against five ~98 KB documents =
**1,117 ms**. Cost is O(mutations × documents × text length).

The server slice bulk-imports a source text and then adds one anchor per
extracted claim inside a request handler; a chapter-length document with a few
hundred anchors stalls for tens of seconds.

**Fix.** Immutability is the licence: a document whose text and digest have been
checked once cannot change, so record it as verified and skip both checks
thereafter, and cache its code-point index. `addDocument` seeds both, since it
just computed them. Leave a comment naming the remaining ceiling.

## 5. LOW — an anchor can name an argument version with no link, and nothing reports it

`src/lib/core/origin-library.ts:484-538`. Confirmed: `addAnchor` with
`argumentVersion: 77` when the only link is version 0 is accepted and
`validate().ok` is `true`. The link carries the stance that gives an anchor its
meaning, so an anchor without one is provenance nobody can interpret.
`validate()` checks document existence for links and anchors but never that an
anchor's `(argumentId, argumentVersion, documentId)` has a matching link.

**Fix: add the check.** It is not deliberate. It also states the persistence
order the server slice needs — document, then link, then anchors — as an
enforced invariant rather than a docs sentence.

## 6. LOW — unmarking leaves the key present with value `undefined`

`src/lib/core/premise-engine.ts:1214-1221`. `patchAndMarkExpression` uses
`Object.assign`, so the CLI's unmark path creates the key with value
`undefined`. Checksum-safe and JSON-safe today, but `"enthymeme" in expr` is now
`true` on the in-memory entity while `AGENTS.md` states that unmarking deletes
the key. Any downstream mapper that turns `undefined` into `null` reintroduces
the exact failure the invariant guards.

**Fix at the root**, in `patchAndMarkExpression`, so every caller benefits rather
than only the CLI path the finding names.

## 7. LOW — CLI surface gaps

`src/cli/commands/origins.ts`.

- `origins attach` never checks that `--argument` names a real argument. A typo
  produces a permanently dangling link with no error at any point.
- No `origins remove` and no `origins link`. `removeDocument` and `removeLink`
  exist in the library with no CLI route, so a CLI user can create documents but
  never delete one, and cannot attach an existing document to a second argument
  version — `attach` always mints a new document even when the digest matches.

Add both, plus smoke-test coverage per the Public-CLI-API Documentation Sync
entry.

## Also

`docs/api-reference.md` does not tell a consumer that origin entities never enter
a changeset and therefore get no FK-ordering help from `orderChangeset`.
Documents must be persisted before links and anchors. The server slice is about
to write that code. One sentence.

## Confirmed clean — do not touch

- **The hand-rolled SHA-256.** Fuzzed against `node:crypto` across every byte
  length 0-200 (covering the 55/56/63/64 padding boundaries), 2/3/4-byte UTF-8 at
  every length 0-100, 500 random strings, 100 KB and 200 KB inputs, and lone
  surrogates — 1,008 cases, 0 mismatches.
- The checksum invariant, the code-point/UTF-16 discipline, `P-6`'s tier
  isolation and code reservation, the `src/lib/` third-party and `node:crypto`
  boundaries, and the optional `origins` snapshot slot.
- `readOriginLibrary` swallowing a JSON parse error and returning an empty
  library is real data loss, but it is the identical pattern used by all four
  pre-existing `read*Library` functions. Out of scope for this item.
