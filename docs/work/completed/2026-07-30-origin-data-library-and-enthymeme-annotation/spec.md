# Spec — Origin data library and enthymeme annotation

## Capability changes

**None registered in this node.** `proposit-core` has no `docs/capabilities/`
tree — it is a runtime-agnostic library that asserts no user-facing support of
its own. The nine capability entries this work enables are owned by the shared
product master and are registered by the `proposit-shared` slice, per the epic's
constraint that no capability records are written during planning.

New **Vocabulary** entries are registered here, because core is where these terms
are defined:

| Term | Kind | Parent |
|---|---|---|
| `origin-document` | Vocabulary | `origin-data` |
| `origin-link` | Vocabulary | `origin-data` |
| `origin-anchor` | Vocabulary | `origin-data` |
| `origin-stance` | Vocabulary | `origin-data` |
| `enthymeme` | Vocabulary | — (annotates `premise` / `propositional-expression`) |

`reference` already exists locally and is linked rather than extended — an origin
document's attribution *is* a `reference`, carried opaquely.

---

## Problem

An argument cannot record the text it was built from, cannot record which of its
parts derive from which span of that text, and cannot record that a part was
deliberately left unspoken in the original. Grepping the worktree for
`enthymeme` and `origin` under `src/` returns nothing, so this is greenfield.

Concretely, `TPropositCoreSnapshot`
(`src/lib/core/interfaces/library.interfaces.ts:298-328`) composes exactly five
slices — `arguments` (:313), `claims` (:315), `citations` (:317), `axioms`
(:319), `forks` (:321-327) — and none of them can hold a source text, a span, or
an omission marker.

### Why core is being asked to hold a source text

`AGENTS.md` states core owns no application metadata — "user IDs, timestamps,
display text — those are consumer concerns." A source text reads as display text
under a literal application of that rule. The reconciliation, stated in core's
own terms:

> Core owns the **structure**: entity identity, the anchor relation, checksum
> participation, snapshot round-tripping, and grammar validity. The document
> **text is opaque content** — core stores it, digests it, and slices it by
> index, but never parses, renders, formats, or interprets it. Core gains no
> notion of user, session, or presentation.

This is not a new exception; it is the existing precedent applied to a new
entity. Two pieces of evidence in the repo:

1. `CoreClaimSchema` (`src/lib/schemata/claim.ts:37-55`) carries
   `additionalProperties: true` and no reference data at all. The IEEE reference
   is added *outside* `src/lib/`, by intersection, at
   `src/extensions/citations/ieee/citation-claim.ts:6-13`
   (`Type.Intersect([CoreClaimSchema, Type.Object({ …, citation: IEEEReferenceSchema })])`).
   Core holds the slot; the extension gives it meaning.
2. `CoreClaimConnectionSchema` (`src/lib/schemata/claim-connection.ts:3-33`) is a
   checksummed edge with `additionalProperties: true`, specialized by *which
   library holds it* rather than by a discriminant field. Origin links and
   anchors follow that idiom exactly.

The invariant that survives intact is the operative half of it: **core interprets
nothing it does not own the grammar for.** A `string` field whose only operations
are digest, length, and index-slice is not display text in the sense
`AGENTS.md` forbids; it is an opaque payload with a coordinate system.

What would violate the invariant, and is therefore excluded below: any notion of
who pasted the text, when, whether they may share it, how it renders, or how long
it is allowed to be. All five are consumer concerns and none appear in this
slice.

---

## Goals

1. Hold an argument's source text as a first-class core entity with identity, a
   content digest, checksum participation, and snapshot round-tripping.
2. Associate a source text with an argument *version*, carrying a stance that
   says whether the argument claims to represent the text or merely started from
   it.
3. Associate individual argument parts with the spans of that text they derive
   from, in a durable, standard, exportable form.
4. Let an author declare a claim expression or a premise unspoken, in every case
   — including an argument with no source text at all.
5. Do all of the above without changing the checksum of a single pre-existing
   entity.

## Non-goals

- **Automatic enthymeme detection**, suggestion derivation, or contradiction
  detection. Core stores the declaration; the derivation layer is shared's.
- **Fork or version propagation of origin entities.** Core's fork machinery
  touches no association library — `fork.ts`, `fork-namespace.ts`, and
  `fork-library.ts` contain zero references to citations, axioms, or claim
  connections, and `TForkLibrarySnapshot`
  (`library.interfaces.ts:260-277`) declares remap records for exactly five
  entity types. Origin entities follow that precedent; **no sixth fork-record
  type is added.**
- **A citation claim for the origin text.** The document carries reference
  metadata only, so grammar rule D-5 (`docs/Proposit_Grammar.md:530`) is
  untouched and no grammar change follows from attribution.
- **Cross-argument or cross-owner document sharing, dedup policy, or limits.**
  Core computes the digest that makes dedup *possible*; who may reuse a document
  is a consumer policy decision.
- **Anchoring to a global claim.** Forced, not stylistic: a claim is an
  independently-versioned trunk shared by reference across arguments, so "where
  did this claim come from" has no single answer. Anchors target *this
  argument's use* — a claim expression, a premise, or the argument.
- **Editing a document in place, or re-anchoring after replacement.** Documents
  are immutable by construction; replacing one invalidates its anchors by design.
- **A document structure model.** One flat text. No footnotes, sections, or
  appendices. The `segments` overlay is a non-load-bearing hint.
- **Fuzzy quote matching.** Deferred to the slice with the measured hit rate.
- **Changeset participation.** See Design §7.

---

## Design

### 1. Three new entities, one new library

New file `src/lib/schemata/origin.ts`, star-exported through
`src/lib/schemata/index.ts`. All three carry `additionalProperties: true`, per
the `CoreClaimConnectionSchema` idiom.

| Entity | Fields |
|---|---|
| `CoreOriginDocumentSchema` | `id`, `text`, `digest`, `segments?`, `checksum` |
| `CoreOriginLinkSchema` | `id`, `argumentId`, `argumentVersion`, `documentId`, `stance`, `checksum` |
| `CoreOriginAnchorSchema` | `id`, `argumentId`, `argumentVersion`, `documentId`, `targetType`, `targetId`, `exact`, `prefix?`, `suffix?`, `startCodePoint`, `endCodePoint`, `checksum` |

- `stance` is `Type.Union([Type.Literal("representation"), Type.Literal("seed")])`.
- `targetType` is `Type.Union([Type.Literal("expression"), Type.Literal("premise"), Type.Literal("argument")])`.
  A discriminant is used here — unlike citations/axioms — because all three
  anchor kinds live in **one** library, so "which library holds it" cannot carry
  the specialization.
- `segments` is `Type.Optional(Type.Array(Type.Object({ segmentId, startCodePoint, endCodePoint })))`,
  an overlay only. Nothing in core reads it.

**The IEEE reference is not declared in `src/lib/`.** The document schema's
`additionalProperties: true` holds the slot; the typed shape ships from the
extension as `IEEEOriginDocumentSchema` in a new
`src/extensions/citations/ieee/origin-document.ts`, intersecting
`CoreOriginDocumentSchema` with `{ url: Nullable(Type.String()), reference: IEEEReferenceSchema }`
— byte-for-byte the `IEEECitationClaimSchema` pattern
(`citation-claim.ts:6-13`). This is what keeps `src/lib/` free of the reference
vocabulary while still satisfying "reuses `ReferenceTypeSchema`,
`IEEE_REFERENCE_TYPES`, and the 33 per-type schemas".

`OriginLibrary` (`src/lib/core/origin-library.ts`) is modelled on
`ClaimAxiomLibrary` (`src/lib/core/claim-axiom-library.ts`), which is the
cleaner of the two connection libraries: constructor taking only
`{ checksumConfig? }`, private `withValidation` rollback wrapper (:71-87),
`add*`/`remove*`/`get*`/`getAll*`/`snapshot()`/`validate()`/
`static fromSnapshot()`. It takes **no** claim lookup — origin entities reference
arguments and documents, not claims — and no `generateId`; ids are
caller-supplied, matching both connection libraries.

`validate()` enforces, per entity:

- schema check via `Value.Check`, mirroring `claim-axiom-library.ts:242`;
- duplicate ids;
- a link's / anchor's `documentId` resolves to a document in this library;
- `0 <= startCodePoint <= endCodePoint <= codePointLength(document.text)`;
- **`sliceByCodePoints(document.text, startCodePoint, endCodePoint) === anchor.exact`.**

The last one is the load-bearing check: it makes an anchor at an unverified
offset structurally invalid rather than a silent wrong highlight, and it is
enforceable entirely inside the library because a document and its anchors live
together. Argument existence is deliberately **not** checked — `ArgumentLibrary`
is constructed after this one and cross-checking it would invert the dependency
order established at `proposit-core.ts:148-182`.

New error codes in `src/lib/types/validation.ts` (after the axiom block at
:85-97), and `"originDocument" | "originLink" | "originAnchor"` added to
`TInvariantViolationEntityType` (:1-10).

### 2. `normalizeOriginText` — order of operations is the design

New file `src/lib/utils/origin-text.ts`, exported from the public barrel.

```
1. line endings   CRLF → LF, lone CR → LF
2. strip          BOM/ZWNBSP, C0/C1 controls except \n and \t,
                  bidi controls, zero-width characters, tag characters,
                  stray variation selectors
3. NFC            String.prototype.normalize("NFC")
4. trim
```

**The order is not arbitrary and each swap breaks something specific:**

- Stripping before line-ending normalization would delete a lone CR outright
  (`\r` is a C0 control), silently losing a line break in classic-Mac text.
- NFC before stripping breaks idempotence: removing a zero-width character can
  put a base letter next to a combining mark that was previously separated
  (`e` + U+200B + U+0301), which a *second* application would then compose.
  Stripping first means pass two has nothing left to strip and NFC is already
  fixed. NFC composition never emits a control, an invisible, or a CR, so the
  reverse hazard does not exist.

**Does not**, and a test asserts each: collapse internal whitespace, reflow
paragraphs, fold smart quotes or dashes, case-fold, strip punctuation, strip
emoji, or strip non-ASCII. This is normalization for *encoding*, never for
*content*.

### 3. `out-of-character` — the dependency question, answered

**Verdict: do not adopt. Hand-roll the subset and mine its logic.**

Evidence, from `npm pack out-of-character@2.3.0` and reading the tarball:

- Its `exports` map has a single `"."` entry resolving to a pre-bundled
  `builds/out-of-character.mjs`; grepping that bundle for `require(`, `import …
  from`, `glob`, `colorette`, and `node:` returns **zero** hits. The character
  catalogue is inlined. So the *runtime* concern the epic raised (a filesystem-
  bound `glob` reaching the main entry, disqualifying it under React Native)
  does **not** materialize — that half of the blocking check passes.
- It fails on the other half, twice over. `glob@13.0.6` and `colorette@^2.0.20`
  are declared as plain `dependencies`, not `optionalDependencies` or
  `devDependencies`, so every installer of `@proposit/proposit-core` — server,
  mobile, and every downstream consumer — installs a filesystem glob engine and
  a terminal-colour library to normalize a string. And an `import` of it inside
  `src/lib/` breaches the repo's stated grep-proof boundary regardless of what
  the bundle does at runtime.

Neither reason is about merit; the library is well built. Per the request's
explicit fallback, the subset is hand-rolled in `origin-text.ts` and its
behavior pinned by tests. Its *logic* is lifted rather than rediscovered — the
three preservation boundaries that are the actual hard part, all reproduced from
`src/match.js` and `src/isEmoji.js` in the tarball:

| Character class | Stripped | Preserved when |
|---|---|---|
| U+200D ZWJ | yes | the adjacent code point is `\p{Extended_Pictographic}`, U+FE0F, or a skin-tone modifier U+1F3FB–U+1F3FF |
| U+FE00–U+FE0F variation selectors | yes | preceded by `\p{Extended_Pictographic}`, `\p{Emoji_Component}`, or `\p{Ideographic}` |
| U+180B–U+180D Mongolian FVS | yes | preceded by `\p{Script=Mongolian}` |
| U+E0000–U+E007F tag characters | yes | the run begins immediately after an `\p{Extended_Pictographic}` (emoji tag sequence, e.g. the England flag) |

Bidi controls (U+061C, U+200E, U+200F, U+202A–U+202E, U+2066–U+2069) are stripped
unconditionally — the *Trojan Source* class, a spoofing surface because this text
is stored and rendered on two platforms. Zero-width space/non-joiner (U+200B,
U+200C), word joiner (U+2060), soft hyphen (U+00AD), and ZWNBSP/BOM (U+FEFF) are
stripped unconditionally.

Handling is code-point-aware throughout (`for…of` over the string, tracking a
code-point index), because a naive UTF-16 scan cannot tell a lone surrogate from
half an astral character.

### 4. `sliceByCodePoints` and the code-point index map

Also in `src/lib/utils/origin-text.ts`:

- `codePointLength(text): number`
- `sliceByCodePoints(text, startCodePoint, endCodePoint): string`
- `buildCodePointIndex(text): TCodePointIndex` + `sliceByCodePointsIndexed(index, start, end)`
  — one map built per document and reused across that document's anchors, so
  `OriginLibrary.validate()` over N anchors is O(len + N·span) rather than
  O(N·len).

Built on the string iterator, which yields **code points** — the W3C unit.
`Intl.Segmenter`, `graphemer`, and `grapheme-splitter` all segment **grapheme
clusters**, a different unit that would silently produce wrong offsets; the
sophisticated-looking option is the incorrect one, and none is used.

The field names carry the unit (`startCodePoint` / `endCodePoint`) precisely so a
bare `text.slice(start, end)` on them reads as wrong at the call site.

### 5. Content digest — SHA-256, computed synchronously

`sha256Hex(text): string` in a new `src/lib/utils/sha256.ts`, a ~70-line pure-TS
implementation over `TextEncoder`.

**This deviates from the epic's "use Web Crypto `crypto.subtle.digest`"
guidance, deliberately.** `crypto.subtle.digest` is asynchronous. Every library
mutator in this repo is synchronous — `ClaimAxiomLibrary.add` (:89),
`ClaimCitationLibrary.add`, `ClaimLibrary`, `ArgumentLibrary` — and
`entityChecksum` (`src/lib/core/checksum.ts:36`) is synchronous by construction.
Making document creation `async` to obtain a digest would either infect the whole
mutation surface or force the digest to be supplied by the caller, contradicting
"core computes and stores it". `crypto.subtle` is also not present in a bare
React Native runtime, which the shared consumer must run under.

The algorithm is identical either way, so this is a packaging choice, not a
protocol divergence — and it is pinned as such: the test suite asserts
`sha256Hex(t)` equals `node:crypto`'s `createHash("sha256")` over the same input
for the whole fixture set. (`node:crypto` is banned in `src/lib/`, not in
`test/`.) Any server-side `crypto.subtle` digest therefore agrees by
construction.

`FNV-1a` (`computeHash`, `checksum.ts:4`) is **not** reused for this: it is a
32-bit non-cryptographic hash whose collision rate is unusable for content
identity. The two coexist — FNV for sync-detection checksums, SHA-256 for content
identity — and the document's *entity checksum* hashes the `digest`, not the
`text`, so a long document costs one FNV pass over 64 hex characters rather than
over the whole body.

### 6. The `enthymeme` field, and the checksum guarantee

`enthymeme: Type.Optional(Type.Boolean())` is added to:

- `CorePropositionalVariableExpressionSchema` (`src/lib/schemata/propositional.ts:46-52`)
- `CoreFreeformPremiseSchema` (`:200-210`) and `CoreDerivationPremiseSchema` (`:212-223`)

and `"enthymeme"` is added to `expressionFields` (`src/lib/consts.ts:15-24`) and
`premiseFields` (`:35-40`).

This is backward compatible with **no migration**, and the reason is exact:
`entityChecksum` picks a field only `if (field in entity)`
(`src/lib/core/checksum.ts:41-45`), and `createChecksumConfig` **unions**
additional fields onto the defaults rather than replacing them (`consts.ts:111`).
An entity that lacks the key contributes nothing to `picked` and hashes
byte-identically.

**It holds only while unmarked entities omit the key entirely.** `enthymeme:
null` makes `"enthymeme" in entity` true and changes the checksum of every
premise and expression in existence, breaking hierarchical checksums and sync
detection platform-wide. `Type.Optional(Type.Boolean())` — not
`Nullable(Type.Boolean())` — is what encodes that at the schema level, and
`Nullable` is used elsewhere in the same file (`propositional.ts:22`, `:36`) so
the choice is deliberate rather than incidental.

**Sequencing is part of the design**: the regression test is written and passing
against a fixture set *before* the field exists, then re-run after. See
Acceptance criterion 6.

### 7. Wiring the sixth slice

Twelve files. The map, with the traps called out:

| File | Change |
|---|---|
| `src/lib/schemata/origin.ts` | new — three schemas |
| `src/lib/schemata/index.ts` | star-export it |
| `src/lib/utils/origin-text.ts` | new — normalizer + code-point helpers |
| `src/lib/utils/sha256.ts` | new |
| `src/lib/core/origin-library.ts` | new — `OriginLibrary` |
| `src/lib/types/checksum.ts` | `originDocumentFields?` / `originLinkFields?` / `originAnchorFields?` |
| `src/lib/consts.ts:3-12` | three keys in `CHECKSUM_CONFIG_KEYS` **and** `:14-56` `DEFAULT_CHECKSUM_CONFIG` — `createChecksumConfig` does `DEFAULT_CHECKSUM_CONFIG[key]!` (:109), so a key present in the tuple but absent from the defaults is a **runtime crash, not a type error** |
| `src/lib/types/validation.ts` | entity-type union (:1-10) + new `ORIGIN_*` codes |
| `src/lib/core/interfaces/library.interfaces.ts` | `TOriginLookup`, `TOriginLibraryManagement`, `TOriginLibrarySnapshot`; `TPropositCoreSnapshot` (:298-328) gains a generic + an `origins` slot |
| `src/lib/core/interfaces/index.ts` | re-export |
| `src/lib/core/proposit-core.ts` | options generics (:48-61) + body (:62-78); class generics (:93-106); public field (:107-124); constructor (:126-183); `snapshot()` (:189-210); `fromSnapshot` generics/params/restore/reconstruct (:221-360); `validate()` (:368-377); class JSDoc (:80-92, which already says "four libraries" and is stale) |
| `src/lib/index.ts:22-23` | `export { OriginLibrary }` |

Default checksum field sets:

- `originDocumentFields`: `{ digest }`
- `originLinkFields`: `{ argumentId, argumentVersion, documentId, stance }`
- `originAnchorFields`: `{ argumentId, argumentVersion, documentId, targetType, targetId, exact, prefix, suffix, startCodePoint, endCodePoint }`

**`fromSnapshot` tolerates a missing `origins` slot**, defaulting to an empty
library — deliberately *unlike* the `LEGACY_MISSING_AXIOM_SLOT` guard at
`proposit-core.ts:280-289`. That guard exists because a pre-v0.12 snapshot could
legitimately contain `axiomatic` claims whose connections were silently dropped,
so absence was ambiguous. Nothing ever held origin data, so absence here is
unambiguously "none", and defaulting is lossless. It also keeps this release
consumable by `proposit-shared` and `proposit-server` before their slices land,
which the epic's ordering requires. No CLI migration file is needed as a
consequence.

**`orderChangeset` is not touched.** `src/lib/utils/changeset.ts` handles exactly
five argument-scoped entity kinds (`expression`, `variable`, `premise`,
`argument`, `roles`; the union at :143-159) and has never included claims,
citations, axioms, or forks — those persist through `snapshot()`/`fromSnapshot()`.
Origin entities follow the same route, so the FK-ordering invariant flagged in
`AGENTS.md` is untouched. Recorded explicitly because the invariant says to flag
any change adding entity types, and the answer is "no changeset entity type is
added".

### 8. Grammar rule P-6

New Presentable-tier code `P-6` appended to `GrammarRuleCodeSchema`
(`src/lib/grammar/types.ts:66-70`). `E-2` and `D-7` remain reserved and are not
reused.

> **P-6 — Enthymeme marks a claim-bound variable.** A variable expression
> carrying `enthymeme: true` resolves to a claim-bound variable.

The schema confines the annotation to variable expressions and premises but
cannot express claim-boundness, because that is a property of the *variable* the
expression points at, not of the expression. Marking a premise-bound variable
unspoken is meaningless: a premise-bound variable's truth is derived from another
premise's evaluation, so there is no natural-language assertion for a speaker to
have left out.

`validateP6` lives in `src/lib/grammar/validators/presentable.ts` and is added to
`validatePresentable` (:228-238). It needs only `ctx.expressions` and
`ctx.variables`, both already on `TValidatorContext`
(`validators/context.ts:14-21`), and reuses the exported `isPremiseBound` guard
(`propositional.ts:169-173`). Because the dispatcher composes tiers cumulatively
(`grammar/validate.ts:20-31`), placing it in Presentable makes it invisible to
`structural` / `evaluable` / `derivable` with no extra work — and per the
standing invariant, mutations throw only on Structural violations, so marking a
premise-bound variable never throws.

A new rule code is stable wire format: core owns it, `@proposit/shared`
re-exports the grammar wire format and picks it up through the dep range with no
shared code change.

### 9. CLI

The CLI is core's only execution surface and the epic names it in this slice's
scope, so it gains enough to create and inspect origin data end to end — and no
more:

- `src/cli/storage/libraries.ts` — `originsPath()` / `readOriginLibrary()` /
  `writeOriginLibrary()`, mirroring the axiom triplet (:18-20, :48-60, :76-82).
  The existing bare-`catch` → empty-library idiom means a missing file needs no
  migration.
- `src/cli/engine.ts` — construct in `hydratePropositCore` (:54-67), persist in
  `persistCore` (:70-77).
- `src/cli/commands/origins.ts` + `src/cli.ts` registration + **`origins` added
  to `NAMED_COMMANDS` in `src/cli/router.ts:4-16`** — omitting the last one routes
  the command as an argument UUID and fails with an unrelated error.
- An `--enthymeme` / `--no-enthymeme` flag on the existing premise and expression
  commands.

Subcommands: `origins attach <file> --argument <id> --version <n> --stance
<representation|seed>`, `origins list`, `origins show <id>`, `origins anchor add
--document <id> --target <expression|premise|argument> --target-id <id> --start
<n> --end <n>`, `origins anchor remove <id>`.

**Not added:** IEEE attribution commands. Resolving a URL into reference fields
is a network operation the CLI has no counterpart for, and the reference rides on
`additionalProperties` for consumers that have one.

`examples/arguments/*.yaml` is **unchanged**: the YAML import format has no
top-level slot for connections (citations and axioms are *inferred* from
`supportingClaim.type` at `src/lib/parsing/argument-parser.ts:639-668`), and
origin data is argument-external. The Documentation Sync trigger is evaluated and
recorded as not firing rather than skipped.

---

## Acceptance criteria

1. `PropositCore` exposes `origins` as a public `OriginLibrary`, and `snapshot()`
   returns an `origins` slot alongside the existing five.
2. A snapshot containing a document, one link at each stance, an anchor on an
   expression and one on a premise, and `enthymeme: true` on an expression and on
   a premise survives `snapshot()` → `fromSnapshot()` with every entity and every
   checksum unchanged.
3. `PropositCore.fromSnapshot` on a payload with **no** `origins` key succeeds and
   yields an empty origin library — it does not throw.
4. `OriginLibrary.validate()` reports a violation for an anchor whose
   `[startCodePoint, endCodePoint)` slice of its document's text does not equal
   its `exact`, for an anchor or link whose `documentId` does not resolve, and for
   an anchor whose span exceeds the document's code-point length.
5. `engine.validate('presentable')` reports `P-6` for a variable expression with
   `enthymeme: true` bound to a premise-bound variable;
   `validate('structural')`, `validate('evaluable')`, and `validate('derivable')`
   report nothing for the same argument. Marking it does not throw at mutation
   time.
6. **The checksum regression, both directions.** A fixture set of premises and
   expressions is hashed; `enthymeme` is added to the schemas and to
   `expressionFields` / `premiseFields`; the same fixtures re-hash **byte-
   identically**. Separately, the same fixture with `enthymeme: null` present
   hashes **differently** — so the test fails loudly if absence is ever
   "normalized" into null. The first half is written and passing before the field
   exists.
7. `normalizeOriginText(normalizeOriginText(t)) === normalizeOriginText(t)` for
   every fixture in a set covering CRLF, lone CR, BOM, null bytes, other C0/C1
   controls, decomposed accents, astral-plane characters, mixed indentation, bidi
   controls, tag characters, and stray variation selectors.
8. Normalization is content-preserving: a fixture with internal runs of spaces
   and tabs, blank-line paragraph breaks, smart quotes, em dashes, mixed-script
   text, and punctuation round-trips **unchanged**.
9. Normalization preserves a family ZWJ emoji, a keycap sequence, an ideograph
   followed by U+FE0F, a Mongolian character followed by an FVS, and an emoji tag
   sequence — while stripping a bare ZWJ, a bare variation selector, a bare
   Mongolian FVS, and a bare tag-character run from plain text.
10. Two texts differing only by line-ending style, by a leading BOM, or by accent
    composition produce the **same** digest; two differing by one character do
    not. `sha256Hex` agrees with `node:crypto`'s `createHash("sha256")` on every
    fixture.
11. `sliceByCodePoints` on a document containing an astral-plane character
    returns the intended substring, and the same offsets passed to
    `String.prototype.slice` are shown to return a **different** string — so the
    test fails if anyone switches the unit. `codePointLength` disagrees with
    `.length` on the same document.
12. `pnpm run check` passes, and `bash scripts/smoke-test.sh` covers every new
    CLI subcommand and the `--enthymeme` flag, including a failure path.

---

## Risks

- **The `null`-versus-absent checksum trap.** Highest severity in the slice: a
  violation silently invalidates hierarchical checksums platform-wide, with no
  error and no test failure anywhere else. Mitigated by criterion 6 and by
  `Type.Optional` rather than `Nullable` at the schema level. The same trap is
  re-armed downstream by any consumer whose column round-trips absence as null.
- **The normalizer is a one-way door.** Every stored anchor is an offset into
  text it produced, so its exact behavior becomes part of the stored data's
  meaning. Criteria 7-9 pin it before any anchor exists. **Treat a later edit to
  it as a data migration, not a bug fix** — recorded in the function's own
  doc comment, not only here.
- **A hand-rolled invisible-character subset is a bug farm** — that is precisely
  why the epic suggested a library. Mitigated by lifting the preservation
  boundaries verbatim rather than inventing them, and by criterion 9 testing each
  boundary in both directions. Accepted residual: our catalogue is narrower than
  `out-of-character`'s full table; the classes outside it (exotic Unicode
  whitespace mapped to a plain space, for instance) are left alone rather than
  half-handled, because leaving a character in place is content-preserving and
  removing the wrong one is not.
- **A hand-rolled SHA-256 is cryptographic code.** Mitigated by pinning it
  against `node:crypto` over the fixture set plus published test vectors. It is
  used for content identity only, never for authentication.
- **`P-6` is stable wire format.** A new rule code cannot be renamed without a
  coordinated cross-repo publish. `P-6` is the next free code and `E-2` / `D-7`
  stay reserved.
- **Twelve wiring sites in `proposit-core.ts` and three coupled sites in
  `consts.ts`.** The `consts.ts` one fails at *runtime* rather than at compile
  time (the `!` at :109). Mitigated by adding the key and its default in the same
  edit and by criterion 1 exercising `createChecksumConfig`.

## Notes

- The request's claim that the origin library must reuse `ReferenceTypeSchema`
  "already exported from `src/extensions/citations/ieee/`" is honored, but not by
  importing it into `src/lib/` — that would put an extension's vocabulary inside
  the boundary and give core a reference type it has no business interpreting.
  The intersection lives in the extension, exactly as `IEEECitationClaimSchema`
  does today.
- The request lists `examples/arguments/*.yaml` among the Documentation Sync
  triggers expected to fire. It does not: origin data is argument-external and
  the YAML format has no slot for it. Recorded rather than silently skipped.
- The epic's instruction to hash with `crypto.subtle` is not followed in core,
  for the synchronous-mutation reason in Design §5. The digests are identical, so
  no consumer sees a difference.
