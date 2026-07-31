# Origin data library and enthymeme annotation

Epic: [Argument origin data and enthymeme annotations](tcw://W/proposit-app/2026-07-29-argument-origin-data-and-enthymeme-annotations)

Slice **A** of the epic. Independent of the sibling slice *Carry ingestion
provenance through pipeline finalize* (B) — they share a package but not a code
path, so **do not chain them**. Both ship in **one** `@proposit/proposit-core`
release.

**Blocked by:** nothing. This is the epic's longest pole and its first slice.

---

## Read this first: why core is being asked to hold a source text

`proposit-core/AGENTS.md` states core owns no application metadata — "user IDs,
timestamps, display text — those are consumer concerns." A source text reads as
display text under that rule, and an agent applying the rule literally will
reject this slice.

The requester's instruction is explicit and was reaffirmed: the model belongs in
core, not the app layer. The reconciliation, which this slice should state in
core's own terms in its `spec.md` rather than treat the invariant as silently
overridden:

> Core owns the **structure** — entity identity, the anchor relation, checksum
> participation, snapshot round-tripping, and grammar validity. The text is
> **opaque content** on the entity, carried but never interpreted, exactly as
> the IEEE reference data already is under `src/extensions/citations/ieee/`.
> Core gains no notion of user, session, or presentation.

Precedent already in the repo: `CoreClaimConnectionSchema`
(`src/lib/schemata/claim-connection.ts:3-33`) is a checksummed edge with
`additionalProperties: true`, specialized by which library it lives in rather
than by a discriminant field. The origin library follows that idiom exactly.

---

## Problem

An argument cannot record the text it was built from, cannot record which of its
parts derive from which span of that text, and cannot record that a part was
deliberately left unspoken in the original. `enthymeme` appears nowhere in any of
the four repos — this is greenfield, not a partial implementation to extend.

## What changes

**1. A sixth library slice on the snapshot.** `TPropositCoreSnapshot` today
composes five — `arguments`, `claims`, `citations`, `axioms`, `forks`
(`src/lib/core/interfaces/library.interfaces.ts:296-329`). Add origin data as a
sixth, holding three entity kinds:

| Entity | Shape |
|---|---|
| Origin document | Immutable: full text, content digest, optional IEEE reference, optional segmentation overlay |
| Origin link | `(argument version) → document`, carries `stance` |
| Origin anchor | argument-scoped target → a W3C-style selector pair (below) |

**The anchor shape follows the [W3C Web Annotation Data
Model](https://www.w3.org/TR/annotation-model/)** — take its data model, not its
scope. Each anchor carries both text selectors, which the spec defines as
alternatives:

| W3C | Field | Role |
|---|---|---|
| `TextQuoteSelector.exact` | the quote | Durable identity |
| `.prefix` / `.suffix` | context either side | Disambiguates a repeated quote |
| `TextPositionSelector.start` / `.end` | `startCodePoint` / `endCodePoint` | Fast path and cross-check |

**Positions count Unicode code points, not UTF-16 code units.** Normative in the
spec: *"The selection of the text MUST be in terms of unicode code points (the
'character number'), not in terms of code units."* It also happens to be the only
choice under which Postgres `substring()` and the application layer agree.

Ship a `sliceByCodePoints()` helper alongside the schema and make the field names
carry the unit. A bare `text.slice(start, end)` on these offsets is **wrong** on
any astral-plane character and passes every ASCII test — the exact failure mode
this decision exists to remove, so do not leave the raw indices slice-able by
accident.

**Implement it with built-ins, and do not reach for a Unicode library here.**
JS's string iterator (`Array.from`, spread, `for...of`) iterates **code points**,
which is exactly the W3C unit. `Intl.Segmenter`, `graphemer`, and
`grapheme-splitter` segment **grapheme clusters** — a *different* unit that would
silently yield wrong offsets. The sophisticated-looking option is the incorrect
one here. For performance, build one code-point↔UTF-16 index map per document and
reuse it across that document's anchors rather than calling `Array.from` per
anchor.

Not taken from the spec, deliberately: `refinedBy` chaining (our targets are
structured entities, not DOM ranges), States / `TimeState` / `cached`
(immutability is our State), `DataPositionSelector` (byte ranges), and the spec's
own markup-oriented "normalization" (we annotate plain text).

`stance` is `representation | seed`. Anchor targets are **claim expression,
premise, argument** — never a global claim. That exclusion is forced, not
stylistic: a claim is an independently-versioned trunk shared by reference across
arguments, so "where did this claim come from" has no single answer. It is a
property of *this argument's use* of the claim.

The IEEE reference reuses `ReferenceTypeSchema`, `IEEE_REFERENCE_TYPES`, and the
33 per-type schemas already exported from `src/extensions/citations/ieee/` — the
document carries reference metadata only. **No citation claim is created**, so
grammar rule D-5 (`docs/Proposit_Grammar.md:530`, citation-bound variables only
in a derivation premise's antecedent) is untouched.

**1a. `normalizeOriginText` — one idempotent function, applied on document
creation.** The document text is the coordinate system every anchor indexes
into, so its exact bytes are part of the stored data's meaning.

**Does:** Unicode NFC; CRLF and lone CR → LF; strip BOM; strip control
characters except `\n` and `\t`; trim leading and trailing whitespace.

**Does not:** collapse internal whitespace, reflow paragraphs, fold smart quotes
or dashes, case-fold, or strip punctuation. This is normalization for
*encoding*, never for *content* — the document is supposed to be the original.

NFC is load-bearing: `é` composed (U+00E9) and decomposed (`e` + U+0301) differ
in length, so without it the same pasted text yields different offsets and a
different digest depending on the pasting platform.

> **NFC is our requirement, not the W3C spec's.** The Web Annotation Data Model
> mentions no Unicode normalization form at all. That is a gap in it — `exact` is
> matched by string comparison, so without a fixed form the same visible quote
> composed two ways fails to match. Do not relax the normalizer toward the spec
> on the grounds that the spec says less.

**Build vs adopt, researched — do not re-litigate from scratch.**

- `String.prototype.normalize("NFC")` is built in; that covers the hard part.
- **Invisible characters are harder than they look.** Bidi controls (*Trojan
  Source*; a spoofing surface, since this text is stored and rendered),
  steganographic tag characters, and stray variation selectors — all while
  *preserving* legitimate emoji ZWJ, keycap, CJK, and Mongolian sequences. Naive
  zero-width stripping breaks family and profession emoji. **Evaluate
  `out-of-character`** (v2.3.0, Jul 2026, dual ESM/CJS) for this subset. Blocking
  check: its deps are `glob` and `colorette`, and core's `src/lib/` carries **zero
  third-party SDK imports** as a grep-proof boundary — so if it cannot be taken
  cleanly, hand-roll the subset and pin the behavior with tests rather than
  breaching that rule. **Answer this early** — answering it late means either
  rewriting the normalizer or breaching a boundary under time pressure. It is not
  a blocker; the fallback is the hand-rolled, test-pinned subset.
- **`clean-text-utils` is a trap** — its features are `replaceDiacritics`,
  `replaceSmartChars`, `stripEmoji`, `stripNonASCII`, `stripPunctuation`. That is
  the list of things this function must never do.

Export it. The server calls it at the import boundary *before* its token
estimate, and core applies it again on document creation — which is safe
precisely because it is idempotent. Make idempotence a test, not an assumption
(`normalize(normalize(t)) === normalize(t)` over CRLF, lone CR, BOM, null bytes,
decomposed accents, astral-plane characters, mixed indentation).

**Treat any later edit to this function as a data migration, not a bug fix.**
Every stored anchor is an offset into text it produced.

**1b. Content digest.** Each document carries a SHA-256 digest of its normalized
text, so duplicate texts are detectable. Core computes and stores it; who is
allowed to share a document is a consumer policy decision and not core's
concern.

**2. The `enthymeme` field.** An optional field on
`CorePropositionalVariableExpressionSchema` (`src/lib/schemata/propositional.ts:46`)
and on both `CorePremiseSchema` variants (`propositional.ts:200`, `:212`, union
at `:225`). It is deliberately *not* part of the origin library — it must be
expressible on an argument with no source text at all.

**3. Checksum keys.** Add `origin*Fields` to `CHECKSUM_CONFIG_KEYS`
(`src/lib/consts.ts:3-12`) alongside `claimCitationFields` / `claimAxiomFields`,
and add `enthymeme` to `expressionFields` / `premiseFields`.

**4. One new Presentable-tier grammar rule.** The schema confines the annotation
to claim expressions and premises, but cannot express that a variable expression
must be **claim-bound**. Marking a premise-bound variable unspoken is meaningless;
that is a validator's job. New `TGrammarRuleCode` — see the coordination protocol
below.

**5. No fork change.** Core's fork machinery does not touch association libraries
at all: `fork.ts`, `fork-namespace.ts`, and `fork-library.ts` contain zero
references to citations, axioms, or claim connections, and `TForkLibrarySnapshot`
declares remap records for exactly five entity types
(`library.interfaces.ts:260-278`). Association rows are copied at the persistence
layer instead (`proposit-server/src/model/argument/forks.ts:279-283`). Origin
links and anchors follow that precedent. **Do not add a sixth fork-record type.**

## The one thing that can break the platform

`entityChecksum` includes a field only `if (field in entity)`
(`src/lib/core/checksum.ts:36-47`, guard at `:42`), and `createChecksumConfig`
**unions** additional fields onto the per-entity defaults rather than replacing
them (`src/lib/consts.ts:104-114`).

Adding `enthymeme` is therefore **backward compatible with no migration** — every
existing entity lacks the key and hashes byte-identically.

**This holds only if unmarked entities omit the key entirely.** An `enthymeme:
null` makes `"enthymeme" in entity` true and changes the checksum of every
premise and expression in existence, breaking hierarchical checksums and sync
detection platform-wide.

Write the regression test **before** adding the field: hash a fixture set, add
the field, re-hash, assert byte-identical — and separately assert that
`enthymeme: null` *does* change the hash, so the test fails loudly if someone
later "normalizes" absence into null.

## Grammar rule-code coordination

A new `TGrammarRuleCode` is stable wire format. Per `proposit-shared/AGENTS.md`,
the chain is core → shared → consumers: extend the union in
`src/lib/grammar/types.ts`, ship the validator that emits it, then shared's
re-export picks it up via the dep range with no shared code change. `E-2` and
`D-7` are reserved forever — do not reuse them.

## Verification

- `pnpm run check`.
- The checksum regression above, as its own test, both directions.
- Snapshot round-trip: an argument with a document, a link at each stance,
  anchors on an expression and a premise, and marks on an expression and a
  premise, survives `snapshot()` → `fromSnapshot()` unchanged.
- `normalizeOriginText` is idempotent over the fixture set above, **and**
  content-preserving: internal whitespace runs, blank-line paragraph breaks,
  smart quotes, and em dashes all survive unchanged. Both directions matter —
  the second is what stops a later "tidy-up" from silently re-indexing every
  anchor.
- Two texts differing only by line-ending style, BOM, or accent composition
  produce the **same** digest; two differing by a single character do not.
- `engine.validate('presentable')` reports a premise-bound variable marked
  unspoken; `validate('structural' | 'evaluable' | 'derivable')` do not.
- CLI smoke test (`bash scripts/smoke-test.sh`) covers any new command surface.

## Documentation Sync (expected to fire)

- `docs/api-reference.md` [Public-API] — the new library, its snapshot slice, and
  the mutation surface.
- `README.md` "Invalid Constructions" [Validation-Rules] — the new Presentable
  rule.
- `docs/Proposit_Grammar.md` — the rule inventory and the tier's rule list.
- `examples/arguments/*.yaml` [Argument-Schema] — core argument schemas change,
  and `test/examples.test.ts` reads these.
- `CLI_EXAMPLES.md` + `scripts/smoke-test.sh` [Public-CLI-API] — only if CLI
  surface is added.
- `docs/release-notes/upcoming.md` + `docs/changelogs/upcoming.md`.

## Consumer impact

- `proposit-shared` re-exports the new schemas and builds the mutation and
  derivation layer on them (slice C) — blocked on this slice.
- `proposit-server` persists the entities (slice D).
- `proposit-mobile` consumes them read-only through shared.

This slice ships in **one core release** together with slice B. Consumer-side
tarball validation across shared, server, and mobile runs before `pnpm publish`
and is coordinated at the workspace root — do not publish from this node. Remove
every `*.tgz` from the package root first.

## Note on this node's board

`tcw validate` in this repo currently reports 4 problems, all pre-existing
`resolution`/`status` mismatches on completed items from June and July
(`'shipped'` is not a valid resolution; three `'wontfix'` items sit in `completed`
rather than `discarded`). None relate to this epic. Do not read them as breakage
introduced here; clearing them is a separate chore.
