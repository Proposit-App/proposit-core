# Outcome — Origin data library and enthymeme annotation

All twelve planned tasks shipped. `pnpm run check` and `bash scripts/smoke-test.sh`
both pass.

Code landed on branch `origin-data-library` in
`.worktrees/origin-data-library`; lifecycle and taxonomy artifacts landed on
`main` in the primary checkout.

## What shipped

| # | Task | Commit (branch) |
|---|---|---|
| 1 | Synchronous SHA-256 for content digests | `897f80d` |
| 2 | `normalizeOriginText` + code-point slicing | `589d5fa` |
| 3 | Checksum goldens, recorded before the field existed | `4e22cdd` |
| 4 | The `enthymeme` field on premises and variable expressions | `3d313cb` |
| 5 | Presentable rule `P-6` | `00d68d0` |
| 6 | Origin document / link / anchor schemas + checksum keys | `9913819` |
| 7 | `OriginLibrary` | `703f3bc` |
| 8 | `origins` as the sixth `PropositCore` slice | `5a1ba92` |
| 9 | `IEEEOriginDocumentSchema` | `df95061` |
| 10 | CLI `origins` group + enthymeme marking | `29bc2c5` |
| 12 | Documentation Sync | `d3f64be` |

On `main` in the primary checkout: `9faf86b` (adopt), `f249538` (spec),
`7a56f88` (plan), `09a053c` (taxonomy — task 11).

## The `out-of-character` question, answered

**Verdict: not adopted.** Recorded in `spec.md` §3 before any normalizer code was
written, as the request asked.

The evidence came from unpacking `out-of-character@2.3.0` rather than reading its
README. Its `exports` map has a single `"."` entry resolving to a pre-bundled
`builds/out-of-character.mjs`; grepping that bundle for `require(`,
`import … from`, `glob`, `colorette`, and `node:` returns **zero** hits — the
character catalogue is inlined. So the runtime concern the epic raised (a
filesystem-bound `glob` reaching the main entry and disqualifying it under React
Native) does **not** materialize. That half of the blocking check passes, and
the epic's phrasing implied it would fail.

It fails the other half twice over:

1. `glob@13.0.6` and `colorette@^2.0.20` are declared as plain `dependencies`,
   not `optionalDependencies` or `devDependencies`. Every installer of
   `@proposit/proposit-core` — server, mobile, and every downstream consumer —
   would install a filesystem glob engine and a terminal-colour library in order
   to normalize a string.
2. An `import` of it inside `src/lib/` breaches the repo's stated grep-proof
   zero-third-party boundary regardless of what the bundle does at runtime.

Neither reason is about merit. Per the request's explicit fallback the subset is
hand-rolled in `src/lib/utils/origin-text.ts`, with its *logic* lifted rather
than rediscovered: the four preservation boundaries (emoji ZWJ, variation
selectors after a pictograph / emoji component / ideograph, Mongolian FVS after
Mongolian script, and emoji tag sequences) are reproduced from its `src/match.js`
and `src/isEmoji.js`, and each is tested in both directions.

## Things the request or the plan got wrong, corrected in place

- **`examples/arguments/*.yaml` does not fire.** The request listed it among the
  Documentation Sync triggers expected to fire. It does not: the YAML import
  format has no top-level slot for connections — citations and axioms are
  *inferred* from `supportingClaim.type` at `argument-parser.ts:639-668` — and
  origin data is argument-external. Recorded in `spec.md` Notes and in `plan.md`
  §12 rather than silently skipped.

- **The epic's "hash with `crypto.subtle`" instruction is not followed in core.**
  `crypto.subtle.digest` is asynchronous, and every library mutator here is
  synchronous, as is `entityChecksum`. Making document creation `async` would
  either infect the whole mutation surface or push the digest onto the caller,
  contradicting "core computes and stores it"; `crypto.subtle` is also absent
  from a bare React Native runtime. `sha256Hex` is a synchronous pure-TS
  implementation instead. The algorithm is identical, so this is a packaging
  choice rather than a protocol divergence — and it is pinned as such:
  `test/origin/sha256.test.ts` asserts agreement with `node:crypto` over an
  eleven-fixture set, so any consumer digesting the same bytes with Web Crypto
  agrees by construction.

- **The IEEE reference is not declared in `src/lib/`.** The request says the
  document "reuses `ReferenceTypeSchema` … already exported from
  `src/extensions/citations/ieee/`". Honored, but by intersection *in the
  extension* (`IEEEOriginDocumentSchema`), exactly as `IEEECitationClaimSchema`
  extends `CoreClaimSchema` today. Importing the reference vocabulary into
  `src/lib/` would have put an extension's types inside the boundary and given
  core a reference type it has no business interpreting.

- **A missing `origins` snapshot slot is tolerated, not refused.** The obvious
  reading of the axiom precedent (`LEGACY_MISSING_AXIOM_SLOT`) would have added a
  matching hard guard. That guard exists because a pre-v0.12 snapshot could
  legitimately contain `axiomatic` claims whose connections were silently
  dropped, so absence was ambiguous. Nothing ever held origin data, so absence
  here is unambiguously "none" and defaulting to an empty library is lossless —
  and a hard guard would break `@proposit/shared` and `proposit-server` the
  moment they repin, before their own slices land. As a consequence no CLI
  migration file was needed either.

- **The plan predicted a CLI `--enthymeme` flag on "the existing update
  commands" for both premises and expressions.** There is no
  `expressions update`, so a new `expressions mark` subcommand was added instead.

- **A CLI-only bug the plan did not anticipate, caught by the smoke test.**
  `CliPremiseMetaSchema` declares `additionalProperties: Type.String()`, so
  writing a *boolean* `enthymeme` into a premise's `meta.json` made the file
  unreadable on the next command (`Invalid or corrupt file`). `pnpm run check`
  was green throughout; only `scripts/smoke-test.sh` surfaced it. Both
  `CliPremiseMetaSchema` and the variable arm of `CliExpressionSchema` now
  declare the field explicitly, with `Type.Optional` for the same reason the core
  schemas use it.

- **`CLI_EXAMPLES.md` initially documented a tier flag that does not exist.**
  Written as `analysis validate-argument --tier presentable`; the CLI has no
  tier-aware grammar-validation surface at all (`analysis validate-argument` runs
  `validateEvaluability`, and `validate` runs the invariant sweep). Corrected to
  say so rather than adding a command nobody asked for.

## Decisions worth carrying forward

- **No new mutator was needed for `enthymeme`.** An expression takes the field
  through the existing `patchExpressionAppFields`; a premise through the existing
  `getExtras()` / `setExtras()` round-trip. `enthymeme` is deliberately *not*
  added to the premise engine's structural-field allowlist in `getExtras` /
  `setExtras` — doing so would preserve it across a replace-all, but would also
  make it unsettable through the only premise-level route that exists.

- **Unmarking must delete the key, never set `false`.** Both CLI paths pass
  `undefined` (expressions) or delete the extra (premises). `undefined` is
  dropped by both `canonicalSerialize` and JSON, so the entity's checksum returns
  exactly to its pre-mark value — asserted in
  `test/origin/enthymeme-mutation.test.ts`.

- **The three origin generics are appended at the end** of the `PropositCore` and
  `TPropositCoreOptions` parameter lists rather than slotted in beside the other
  libraries, so a consumer that spells out all twelve arguments keeps its
  bindings.

- **`orderChangeset` and the fork machinery are untouched**, matching the
  citation/axiom precedent. A comment at `forkArgument`'s closure walk records
  that origin entities are copied at the persistence layer, so the omission reads
  as a decision rather than an oversight.

- **Two new invariants were added to `AGENTS.md`**: the absent-not-null rule for
  `enthymeme`, and `normalizeOriginText` as a one-way door whose later edits are
  data migrations. The "core owns no application metadata" entry gained a clause
  covering an origin document's `text`.

## Verification

`pnpm run check` — typecheck, prettier, eslint, 2246 tests passing (14 skipped,
79 files), build + typedoc, all green.

`bash scripts/smoke-test.sh` — passes, including the new section 9o covering
`origins attach` / `list` / `show` / `anchor add` / `anchor remove`, the
`--enthymeme` and `--no-enthymeme` flags, `expressions mark`, and four failure
paths (out-of-range span, unknown stance, unknown document, unknown expression).
The normalized-length assertion in that section proves the BOM was stripped, both
CRLFs folded, and the trailing blank line trimmed on the way in.

`tcw validate` reports the same 4 pre-existing `resolution`/`status` problems on
completed June/July items and nothing new. `tcw taxonomy check` is clean.

## Not done, deliberately

- No version cut, tag, or publish. This slice ships in one core release with the
  sibling pipeline-provenance slice, gated on consumer-side tarball validation
  coordinated at the workspace root.
- Nothing pushed.
- No IEEE attribution CLI commands — resolving a URL into reference fields is a
  network operation the CLI has no counterpart for.
- No fuzzy quote matching; deferred to the slice with the measured hit rate.

---

# Rework pass — dual-review findings

All seven findings addressed at full scope. Each was reproduced against the
built output first, and each fix landed behind a failing test. `pnpm run check`
and `bash scripts/smoke-test.sh` both pass.

| # | Severity | Finding | Commit |
|---|---|---|---|
| 1 | HIGH | `normalizeOriginText` not idempotent; `addDocument` refused its own output | `0a9e654` |
| 2 | MEDIUM | Schema accepted `enthymeme: false` | `5f44214` |
| 3 | MEDIUM | `enthymeme` on a non-variable expression unreported | `74166e1` |
| 4 | MEDIUM | `validate()` re-scanned every document body per mutation | `e66d44f` |
| 5 | LOW | Anchor with no matching link accepted | `5e2cf41` |
| 6 | LOW | Unmarking left the key present as `undefined` | `b047659` |
| 7 | LOW | CLI surface gaps | `c3f1e2e` |
| — | — | Documentation Sync over the rework diff | `fe59fb9` |

## 1 — the normalizer

The root cause is one sentence: **a removal candidate must never legitimize
another removal candidate.** `isLegitimateInContext` read its neighbours from
the pre-strip array, and the joiner, the variation selectors, and the tag
characters all satisfy the emoji-adjacency and variation-selector-base tests
themselves, so they qualified each other.

The fix consults what actually survived — the backward look reads the emitted
output, the tag-run backscan walks the emitted output, and the joiner's single
forward look rejects a `next` that is itself a candidate. Iterating to a fixed
point was the offered alternative and was not taken: it hides a wrong per-pass
rule behind a loop.

The test debt the finding identified was real. No prior fixture placed two
removal candidates adjacent. Added thirteen adjacency fixtures, an exhaustive
sweep over every three-code-point string from a fourteen-symbol
emoji/invisible alphabet (2,744 strings — 144 failed before the fix), and two
`OriginLibrary` regressions: that `addDocument` stores text it normalized
itself, and that an anchor drawn against a consumer's own normalization still
validates. That second one is the downstream server slice's exact flow.

The related `ZWJ + VS16` case resolves under the same rule — neither anchors
the other now, and both are stripped from plain prose.

`AGENTS.md` and `docs/api-reference.md` both claimed the step order alone made
the function idempotent. Both now name the two mechanisms.

## 2 — `enthymeme: false`

`Type.Optional(Type.Literal(true))`, in the core schemas and in the CLI's
on-disk schemas, which had the same hole. The field's description already said
"a null or false value is not the same as absent"; the schema now agrees.

One knock-on: a P-6 test asserted `enthymeme: false` was ignored. `false` is no
longer representable in the type, so the case is kept with a cast — the
validator stays defensive about hand-built JSON.

## 3 — marks on non-variable expressions

Chose reporting over closing the schemas, as recorded in `rework.md`. Closing
`CoreOperatorExpressionSchema` and `CoreFormulaExpressionSchema` would break the
documented app-extension mechanism — the existing `patchExpressionAppFields`
coverage in `core.test.ts` attaches `creatorId` and `createdOn` through exactly
that openness.

`validateP6` now reports `P-6` for a mark on an operator or formula expression,
with `variableId` omitted since there is none. The JSDoc, the grammar doc, and
the README's rule table all say so.

## 4 — validation cost

1,117 ms → **44 ms** for 100 `addAnchor` calls against five ~98 KB documents,
measured against the built output.

Immutability is the licence: a document body checked once cannot change. The
verified record and the code-point index are both keyed to **the exact text
that passed**, not to the document id, so a tampered snapshot cannot inherit a
previous instance's verdict — covered by its own test. `restoreFromSnapshot`
drops any entry whose body no longer matches.

The remaining O(n²) in anchor count across a bulk import is one short slice
comparison per pair; named in a `ponytail:` comment on `withValidation` with the
upgrade path.

## 5 — anchors without links

Added the check rather than documenting the gap. New code
`ORIGIN_ANCHOR_LINK_NOT_FOUND`. Because it lives in `validate()`, it covers both
directions: `addAnchor` without a link is refused, and `removeLink` while
anchors remain is refused.

This exposed the same fixture debt as finding 1 — every existing anchor test
created anchors with no link at all. The `withDocument` helper now creates a
link by default, with three link-focused tests opting out.

It also turns the persistence order into an enforced invariant rather than a
docs sentence, which is what the server slice needs.

## 6 — `undefined` creating the key

Fixed at the root, in `PremiseEngine.patchAndMarkExpression`, not at the CLI
call site the finding named — so every patched field benefits rather than this
one path. A field patched to `undefined` is now deleted.

## 7 — CLI

`attach` and the new `link` both verify the argument version exists on disk
first. Added `origins link`, `origins unlink`, and `origins remove`. Smoke test
covers cross-argument reuse of one stored text, plus three new failure paths:
unknown argument, unknown version, and removing a still-referenced document.

## Also

`docs/api-reference.md` now states that origin entities never enter a changeset
and get no FK ordering from `orderChangeset` — persist documents, then links,
then anchors, and delete in reverse.

## Nothing pushed back on

Every finding reproduced exactly as described. The two places the report's
diagnosis was incomplete rather than wrong are noted above: the ZWJ+VS16 pair
(same root cause, so it fell out of the same fix) and finding 6's blast radius
(a shared helper, not the CLI path).

The three "explicitly NOT findings" were left alone: the hand-rolled SHA-256,
the confirmed-clean invariants, and `readOriginLibrary`'s parse-error handling.

## Verification

`pnpm run check` — 2,276 tests passing (14 skipped, 79 files), prettier clean,
eslint clean, build and typedoc green.

`bash scripts/smoke-test.sh` — `SMOKE TEST PASSED`.
