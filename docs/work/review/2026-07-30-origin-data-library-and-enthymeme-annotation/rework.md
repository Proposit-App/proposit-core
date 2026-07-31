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

---

# Rework round 2 — review of `d3f64be..HEAD`

The normalizer fix (`0a9e654`) and the P-6 fix (`74166e1`) came back clean and
hard-verified — 400k random strings, exhaustive lengths 1-5, every Unicode code
point in 14 contexts, zero non-idempotent; 19 real emoji sequences round-trip;
200k prose strings byte-identical to pre-rework. Not iterating to a fixed point
was judged correct. Both are left alone.

Two of the other fixes introduced defects. Everything below was reproduced
against the built output before any code was written; a failing test lands
before each fix.

## 1. HIGH — two or more unlinked anchors brick the library permanently

`5e2cf41` added `ORIGIN_ANCHOR_LINK_NOT_FOUND`, but `withValidation` requires
`validate().ok` over the **whole** library after every mutation. So one orphan
anchor cannot be removed while another orphan remains — each removal is rolled
back by the violation the *other* anchor still raises.

Reproduced:

```
1 orphan anchor(s): removed 1/1
2 orphan anchor(s): removed 0/2 — ORIGIN_ANCHOR_LINK_NOT_FOUND: origin anchor "a2" …
3 orphan anchor(s): removed 0/3 — 2 invariant violations detected
```

The dead end is total. On a two-orphan library `removeAnchor("a1")` throws,
`removeAnchor("a2")` throws, there is no link to remove, and
`removeDocument("d1")` throws `ORIGIN_DOCUMENT_IN_USE`. Every mutation fails
forever; the only exit is hand-editing `origins.json`. `fromSnapshot` does not
validate, so such a file loads silently and bricks on the first write.

Reachable from any `origins.json` written on this branch before `5e2cf41` — the
smoke test created exactly that shape while anchors-without-links were still
legal — or from any consumer assembling a snapshot programmatically.

**Root cause: the wrong question.** `withValidation` asks "is the library clean
now?" when what matters is "did this mutation make it worse?". Demanding
cleanliness means a library that is already inconsistent can never be repaired,
which is exactly the state a validating library has to leave repairable.

**Fix.** Compare the post-mutation violation set against the pre-mutation set and
reject only violations the mutation *introduced*. One uniform rule, no
add-versus-remove branching: an `addAnchor` with no link still introduces a new
violation and is still refused, on a clean library and a broken one alike.

Carry the pre-mutation set as state between mutations rather than recomputing it,
so this stays at one `validate()` per mutation and does not undo `e66d44f`.
`fromSnapshot` seeds it once from the loaded state.

**Do not break the other direction**, which is correct and tested: `removeLink`
while anchors remain must stay refused with a clean rollback
(`test/origin/origin-library.test.ts:615`). Under the introduced-violations rule
it does — the orphaning is new.

## 2. MEDIUM — the premise path still has the exact defect the expression path lost

`b047659` made `patchAndMarkExpression` delete an `undefined`-valued key. The
premise equivalent `updateExtras` is
`setExtras({ ...this.getExtras(), ...updates })` — the spread **creates** the key
holding `undefined`, and `setExtras` spreads it again into the new premise.
Verified end to end:

```
premise unmark   : 'enthymeme' in premise    -> true  (value undefined)
expression unmark: 'enthymeme' in expression -> false
```

That is verbatim the failure the commit message describes.
`docs/api-reference.md` names the premise extras round-trip as the sanctioned
premise route in the same breath as `patchExpressionAppFields`, and the sentence
added at `:975` ("That applies to any field patched to `undefined`, not only
this one") reads as a general guarantee that is not one.

The CLI already hand-rolls `getExtras()` → `delete` → `setExtras()`, which is
evidence the gap was known CLI-side and never closed in the library — the same
"fixed the caller, not the shared helper" mistake, in the other direction.

**Fix** in `setExtras`, covering `updateExtras` and every direct caller. Add the
premise mirror of the `"enthymeme" in expr` assertion. Then delete the CLI
hand-roll, whose passing is the evidence it worked.

## 3. MEDIUM — `addDocument` marks a document verified before `validate()` looks at it

`e66d44f` seeds `verifiedDocumentBodies` inside the `withValidation` callback, so
the skip in `validate()` fires on the very pass that was supposed to check the
document. `ORIGIN_DOCUMENT_TEXT_NOT_NORMALIZED` is no longer reachable at add
time — and that check is exactly what caught the idempotence bug fixed in
`0a9e654`, in the function this file's own header calls a one-way door. The perf
commit deleted the self-check that found the bug the previous commit fixed.

Fuzzing says the assumption holds today, so this is defense-in-depth rather than
a live bug. Restore it anyway: seed the entry only when
`normalizeOriginText(text) === text`. One extra normalize per `addDocument` —
O(document size) **once**, not the per-mutation cost `e66d44f` removed.

## 4. MEDIUM — `documentIndexes` is keyed by id while the comment and changelog claim text

The lookup reads `this.documentIndexes.get(document.id)` and trusts it, while the
comment beside it says "the text cannot change under it" and
`docs/changelogs/upcoming.md` states outright that both caches are "keyed to the
exact text that passed, not to the document id". True of the body record, false
of the index.

Invalidation is coupled to the wrong map as well: `restoreFromSnapshot` drops
`documentIndexes[id]` only when `verifiedDocumentBodies[id]` exists *and*
mismatches, so a document indexed but never verified keeps its index across a
restore.

No reachable wrong slice today — `restoreFromSnapshot` is private and only ever
fed a self-taken snapshot, and no document-update path exists. But
`TCodePointIndex` already carries `.text` precisely so this is one comparison.
Make the code match the claim, and the trap a future `replaceDocument` would fall
into disappears.

## 5. MEDIUM — three shipped Public-API doc sites still say `Object.assign`

Contradicting `b047659`: `src/lib/core/argument-engine.ts:1586`,
`src/lib/core/interfaces/argument-engine.interfaces.ts:452`, and
`docs/api-reference.md:233`. All three carry their own Documentation Sync
entries, and `api-reference.md` now contradicts itself — `:233` says
`Object.assign`, `:975` says the key is deleted.

## 6. MEDIUM — `docs/api-reference.md` states the old schema two lines below the corrected one

`:968` correctly says `Type.Optional(Type.Literal(true))` rejects both `null` and
`false`. The blockquote immediately below still reads "The schema is
`Type.Optional(Type.Boolean())`, never `Nullable`, and unmarking must delete the
field rather than set it to `false`" — which accepts `false`, in the one
paragraph flagged as the invariant. `:964` is stale the same way.

## 7. LOW — the `stripInvisibleCharacters` docstring overstates the rule

A removal candidate *does* legitimize another in two places by design:
`EMOJI_ADJACENT` matches `FE0F` and the skin tones (correctly, for
`emoji + FE0F + ZWJ + emoji`), and the Mongolian free variation selectors are
themselves `Script=Mongolian`, so an FVS run self-legitimizes. Both are stable
because the base must have *survived*, so idempotence is unaffected — the
sentence is simply stronger than the code. "…never on the strength of a
neighbour that did not survive" is accurate.

## Deferred — record in `outcome.md`, do not implement

- **Retained code-point index memory.** 20 anchored documents totalling 10 MB of
  text retain **103 MB** of heap; no eviction, no cap, bounded only by live
  document count. Peak is unchanged from before `e66d44f`; steady state is not.
  The `ponytail:` comment documents the time tradeoff and is silent on memory —
  add the sentence, do not re-engineer. The lazy fix, if it bites, is indexing
  only documents that have anchors and dropping the index with their last anchor.
- **`arguments delete` does not cascade to `origins.json`.** The CLI removes
  directories only, so the invariant `assertArgumentVersionExists` establishes on
  create is broken by the very next command, leaving links and anchors pointing
  at nothing — which the origin library structurally cannot detect, by design.
  The smoke test masks it by unlinking first. Record the choice (cascade /
  refuse / document) without implementing it.
- **`Value.Parse` on an on-disk `enthymeme: false`** fails as "Invalid or corrupt
  file" with no indication which field. Not a live break — every writer was
  traced and none emits `false`, and the feature is unreleased.

---

# Rework round 3 — the third occurrence of the `undefined`-key defect

Round 2 fixed the expression path (`patchAndMarkExpression`). Round 3 fixed the
premise path, in `setExtras` rather than `updateExtras` so every caller was
covered. `ArgumentEngine` has its own independent `setExtras` / `updateExtras`
pair with the identical shape and was not touched.

Confirmed against the worktree source:

```
engine.updateExtras({ note: "hello" })   ->  'note' in argument = true
engine.updateExtras({ note: undefined }) ->  'note' in argument = true  | value = undefined
```

Verbatim the failure the last two rounds have been closing. It matters at least
as much here, not less: `createChecksumConfig` **unions** additional fields onto
the per-entity defaults rather than replacing them, so an app that extends
`argumentFields` past the default `["version"]` — which is what the consuming
repos do — gets a checksum that moves when a field is cleared. Arguments carry
`descendantChecksum` and `combinedChecksum`, so an argument-level shift
propagates further than a premise-level one.

## The sweep

`grep -rn "\.\.\.extras" src/` — six sites, three distinct shapes:

| Site | Shape | Verdict |
|---|---|---|
| `premise-engine.ts:1248` | `getExtras()` return | fine — reads, does not build an entity |
| `argument-engine.ts:646` | `getExtras()` return | fine — same |
| `premise-engine.ts` `setExtras` | clear-a-field | fixed in round 3 |
| **`argument-engine.ts:651`** `setExtras` | clear-a-field | **the reported defect** |
| **`argument-parser.ts:368`** | builds a claim from `mapClaim` | **latent, same shape** |
| **`argument-parser.ts:420`** | builds a variable from `mapVariable` | **latent, same shape** |
| **`argument-parser.ts:586`** | builds a connection from `mapHook` | **latent, same shape** |

The three parser sites spread a consumer-supplied mapping hook's output into a
brand-new entity. A hook returning `{ title: undefined }` for a field it could
not populate — completely ordinary JavaScript, and `mapClaim` is a documented
extension point — creates the key holding `undefined` on the entity. The
checksum is unaffected there (`canonicalSerialize` is `JSON.stringify`, which
drops `undefined`), so this is the weaker half of the defect: no checksum shift,
but `"title" in claim` is true and the same downstream `undefined` → `null`
mapper flips it to present. Fixed in the same commit rather than left for a
fourth round, as instructed.

## Fix

This is the third hand-written copy of the same filter, so it stops being
copy-paste: one `withoutUndefinedValues` helper in `src/lib/utils/collections.ts`
(internal, not barrel-exported — the invariant is core's, not a consumer's), used
by both `setExtras` implementations and the three parser sites. Smaller total
diff than three more inline filters, and it gives the invariant a name.

Failing test first: the argument-level mirror of the premise assertion added in
round 3.

## Process note, carried forward

Piping a linter into `tail` reports `tail`'s exit code, not the linter's, which
is how two commits in round 3 were made with lint still failing (both caught and
amended, nothing shipped). Verification commands whose exit code matters are no
longer piped.
