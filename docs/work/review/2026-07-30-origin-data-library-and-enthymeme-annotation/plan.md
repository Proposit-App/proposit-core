# Plan — Origin data library and enthymeme annotation

Code lands on branch `origin-data-library` in the worktree
`.worktrees/origin-data-library`; lifecycle artifacts stay on `main` in the
primary checkout. Every task is its own commit and leaves the suite green — the
ordering below exists to make that true, not merely to group related edits.

**Ordering rationale.** Tasks 1-2 are leaf utilities with no dependants, so they
can be proved in isolation before anything consumes them. Task 3 is the checksum
regression, written and passing **before** the field it protects exists — the one
sequencing constraint the request states outright, and the only one whose
violation is undetectable after the fact. Tasks 4-5 are the two independent
platform-visible changes (`enthymeme`, `P-6`). Tasks 6-9 build the library bottom
up, so `OriginLibrary` can be tested before `PropositCore` knows about it. Task
10 is the CLI, last among code because it consumes everything. Task 11 is
taxonomy, task 12 is Documentation Sync.

New tests go in per-area files, not `core.test.ts` by default, per `AGENTS.md`
Testing. The exception is the `PropositCore` slice wiring, whose neighbours all
live in `core.test.ts`.

---

## 1. Synchronous SHA-256

**Changes:** new `src/lib/utils/sha256.ts` exporting `sha256Hex(text: string): string`,
a pure-TS FIPS 180-4 implementation over `TextEncoder`. Exported from
`src/lib/index.ts`.

**Verified by:** new `test/origin/sha256.test.ts` —
- published NIST vectors (`""`, `"abc"`, the 448-bit and 896-bit messages);
- equality with `node:crypto`'s `createHash("sha256").update(t,"utf8").digest("hex")`
  over a fixture set including multi-byte, astral-plane, and long (>64 KiB) inputs,
  which pins the cross-runtime agreement claimed in spec §5;
- a single-character difference changes the digest.

`node:crypto` is used **in the test only** — `src/lib/` may not import it.

## 2. Text normalization and code-point slicing

**Changes:** new `src/lib/utils/origin-text.ts` exporting `normalizeOriginText`,
`codePointLength`, `sliceByCodePoints`, `buildCodePointIndex`,
`sliceByCodePointsIndexed`. Exported from `src/lib/index.ts`. The four-step
order (line endings → strip → NFC → trim) and the "later edits are a data
migration" warning are stated in the function's own doc comment, not only in the
plan.

**Verified by:** new `test/origin/origin-text.test.ts` —
- **idempotence** over the fixture set in acceptance criterion 7;
- **content preservation** per criterion 8 — internal whitespace runs, blank-line
  paragraph breaks, smart quotes, em dashes, mixed-script text, punctuation;
- **the preservation boundaries** per criterion 9 — family ZWJ emoji, keycap
  sequence, ideograph + U+FE0F, Mongolian + FVS, and an emoji tag sequence all
  survive, while a bare ZWJ, bare variation selector, bare FVS, and bare
  tag-character run in plain text are stripped;
- bidi controls stripped unconditionally;
- lone CR becomes LF rather than vanishing — the specific failure the step order
  exists to prevent;
- `sliceByCodePoints` vs `String.prototype.slice` on an astral document per
  criterion 11, asserting they **differ**;
- `buildCodePointIndex` + `sliceByCodePointsIndexed` agree with
  `sliceByCodePoints` on every span of a mixed-plane document.

## 3. Checksum regression — written before the field exists

**Changes:** new `test/origin/enthymeme-checksum.test.ts` only. No source change.

Builds a fixture set of freeform and derivation premises and of variable,
operator, and formula expressions; computes `entityChecksum` for each against
`DEFAULT_CHECKSUM_CONFIG` and against a `createChecksumConfig({...})` variant;
asserts each equals a hard-coded golden hex string recorded now.

**Verified by:** the test passes on the current tree. Its whole purpose is to
still pass **unchanged** after task 4 — that is the byte-identity proof, and
recording the goldens before the field exists is what makes it one.

## 4. The `enthymeme` field

**Changes:**
- `src/lib/schemata/propositional.ts` — `enthymeme: Type.Optional(Type.Boolean())`
  on `CorePropositionalVariableExpressionSchema` (:46-52),
  `CoreFreeformPremiseSchema` (:200-210), `CoreDerivationPremiseSchema` (:212-223).
  `Type.Optional`, never `Nullable`; a comment states why at each site.
- `src/lib/consts.ts` — `"enthymeme"` added to `expressionFields` (:15-24) and
  `premiseFields` (:35-40).

**Verified by:** task 3's test re-run **with its golden strings untouched** —
byte-identity, criterion 6 first half. Then extend the same file with the second
half: the identical fixture carrying `enthymeme: null` hashes **differently**,
and one carrying `enthymeme: true` hashes differently again. A negative
assertion that no `Nullable` wraps the field is unnecessary — the null test is
the real guard.

Also: a round-trip test that a premise and an expression with `enthymeme: true`
survive `Value.Check` against their schemas, and that an entity without the key
is still valid.

## 5. Grammar rule P-6

**Changes:**
- `src/lib/grammar/types.ts` — `Type.Literal("P-6")` appended to the Presentable
  block (:66-70) and the header comment's rule inventory left intact (`E-2` /
  `D-7` stay reserved).
- `src/lib/grammar/validators/presentable.ts` — `validateP6`, added to
  `validatePresentable` (:228-238) and to the file's header rule list. Reads
  `ctx.expressions` + `ctx.variables`, reuses `isPremiseBound`
  (`propositional.ts:169-173`).

**Verified by:** new `test/grammar/presentable-p6.test.ts` —
- a variable expression with `enthymeme: true` bound to a premise-bound variable
  yields exactly one `P-6` violation from `validate('presentable')`;
- the same context yields **zero** violations from `validate('structural')`,
  `validate('evaluable')`, and `validate('derivable')` (criterion 5);
- a claim-bound variable expression with `enthymeme: true` yields none;
- a premise-bound variable expression **without** the field yields none;
- a premise (not an expression) with `enthymeme: true` yields none — the rule is
  about variable binding, and a premise has no binding to check;
- the mutation path that sets the flag does not throw, per the standing
  "mutations throw only on Structural violations" invariant.

## 6. Origin schemas and the supporting type/const wiring

**Changes:**
- new `src/lib/schemata/origin.ts` — `CoreOriginDocumentSchema`,
  `CoreOriginLinkSchema`, `CoreOriginAnchorSchema`, `OriginStanceSchema`,
  `OriginAnchorTargetTypeSchema`, plus `Static` types. All
  `additionalProperties: true`.
- `src/lib/schemata/index.ts` — star-export.
- `src/lib/types/checksum.ts` — `originDocumentFields?`, `originLinkFields?`,
  `originAnchorFields?`.
- `src/lib/consts.ts` — the same three keys in `CHECKSUM_CONFIG_KEYS` (:3-12)
  **and** their default sets in `DEFAULT_CHECKSUM_CONFIG` (:14-56), in one edit.
  Adding a key to the tuple without a default is a runtime crash at
  `createChecksumConfig` (:109 `DEFAULT_CHECKSUM_CONFIG[key]!`), not a type error.
- `src/lib/types/validation.ts` — `"originDocument" | "originLink" |
  "originAnchor"` on `TInvariantViolationEntityType` (:1-10) and an `ORIGIN_*`
  error-code block after the axiom block (:85-97).

**Verified by:** new `test/origin/origin-schemas.test.ts` — `Value.Check` accepts
a minimal and a fully-populated instance of each entity and rejects a bad
`stance`, a bad `targetType`, and a missing `digest`. Plus, in the same file, the
`consts.ts` trap: `createChecksumConfig({})` returns a config with all eleven keys
populated and does not throw, and `normalizeChecksumConfig` /
`serializeChecksumConfig` round-trip the three new keys.

## 7. `OriginLibrary`

**Changes:**
- new `src/lib/core/origin-library.ts`, modelled on
  `src/lib/core/claim-axiom-library.ts` — constructor `(options?: { checksumConfig? })`,
  private `restoreFromSnapshot` + `withValidation` rollback, `addDocument` /
  `addLink` / `addAnchor` / `removeDocument` / `removeLink` / `removeAnchor`,
  reverse indexes keyed by `documentId` and by `(argumentId, argumentVersion)`,
  `getAnchorsForTarget`, `snapshot()`, `validate()`, `static fromSnapshot()`.
  `addDocument` applies `normalizeOriginText` to the supplied text and computes
  `digest` with `sha256Hex` — the caller supplies neither.
- `src/lib/core/interfaces/library.interfaces.ts` — `TOriginLookup`,
  `TOriginLibraryManagement`, `TOriginLibrarySnapshot`.
- `src/lib/core/interfaces/index.ts` — re-export.
- `src/lib/index.ts` — `export { OriginLibrary }` beside the other libraries
  (:22-23).

**Verified by:** new `test/origin/origin-library.test.ts` —
- CRUD for each entity kind, with checksums recomputed on add;
- `addDocument` normalizes and digests: a CRLF/BOM/decomposed-accent input and
  its already-clean equivalent produce the **same** `digest` and the same stored
  `text` (criterion 10);
- `validate()` reports each violation in criterion 4 — quote/span disagreement,
  unresolved `documentId` on a link and on an anchor, out-of-range span,
  duplicate id, schema failure;
- `withValidation` rolls back: a failing `addAnchor` leaves the library
  byte-identical to before, and throws `InvariantViolationError`;
- `snapshot()` → `fromSnapshot()` round-trip preserves all three collections and
  every checksum;
- an anchor spanning an astral-plane character validates, and the same numeric
  span interpreted as UTF-16 would not — the unit guard, at library level.

## 8. The sixth `PropositCore` slice

**Changes:** `src/lib/core/proposit-core.ts` at every site listed in spec §7 —
options generics and body, class generics, the `origins` public field, the
constructor, `snapshot()`, `fromSnapshot` (generics, param type, return type,
restore, reconstruct), `validate()`, and the stale "four libraries" class JSDoc
(:80-92). Plus `TPropositCoreSnapshot` in `library.interfaces.ts:298-328`.

`fromSnapshot` **defaults** a missing `origins` slot to an empty library rather
than throwing, deliberately unlike `LEGACY_MISSING_AXIOM_SLOT` (:280-289) — see
spec §7 for why absence is unambiguous here and why a hard guard would break
consumers before their own slices land.

`forkArgument` (:390-689) is **not** extended, and a comment at the citation/axiom
closure walk records that origin entities are copied at the persistence layer
instead, so the omission reads as a decision rather than an oversight.

**Verified by:** additions to `test/core.test.ts`, beside the existing
`PropositCore axioms field` block —
- `core.origins` is an `OriginLibrary`; `snapshot()` has an `origins` slot which
  is empty on a fresh core (criterion 1);
- `fromSnapshot` on a snapshot literal **without** an `origins` key succeeds and
  yields an empty library (criterion 3) — the mirror of the existing
  `LEGACY_MISSING_AXIOM_SLOT` test, asserting the opposite outcome for a stated
  reason;
- the existing full round-trip test (`:19713`) gains an origins slice;
- the full-fidelity round-trip of criterion 2 — a document, a link at each
  stance, anchors on an expression and a premise, and `enthymeme: true` on an
  expression and a premise, all surviving with identical checksums;
- `core.validate()` merges origin violations;
- `checksumConfig` propagates into `OriginLibrary`.

## 9. IEEE attribution for an origin document

**Changes:** new `src/extensions/citations/ieee/origin-document.ts` —
`IEEEOriginDocumentSchema = Type.Intersect([CoreOriginDocumentSchema,
Type.Object({ url: Nullable(Type.String()), reference: IEEEReferenceSchema })])`,
exported from `src/extensions/citations/ieee/index.ts`. No `src/lib/` change; the
document's `additionalProperties: true` already holds the slot.

**Verified by:** new `test/extensions/citations/ieee/origin-document.test.ts` — a
document with a populated IEEE reference passes both `IEEEOriginDocumentSchema`
and the bare `CoreOriginDocumentSchema`, and survives an `OriginLibrary`
snapshot round-trip with the extra fields intact (which is what
`additionalProperties: true` is for). A document with a malformed reference fails
the extension schema and still passes the core one.

## 10. CLI surface

**Changes:**
- `src/cli/storage/libraries.ts` — `originsPath` / `readOriginLibrary` /
  `writeOriginLibrary`, mirroring the axiom triplet.
- `src/cli/engine.ts` — construct in `hydratePropositCore`, persist in
  `persistCore`.
- new `src/cli/commands/origins.ts` — `attach`, `list`, `show`, `anchor add`,
  `anchor remove`, modelled on `src/cli/commands/axioms.ts`.
- `src/cli.ts` — `registerOriginCommands` import + registration.
- `src/cli/router.ts:4-16` — **`"origins"` added to `NAMED_COMMANDS`.** Omitting
  this routes the word as an argument UUID and fails in `resolveVersion` with an
  unrelated error.
- `src/cli/commands/premises.ts` and `.../expressions.ts` — `--enthymeme` /
  `--no-enthymeme` on the existing update commands.

**Verified by:** `scripts/smoke-test.sh` gains a block per subcommand plus the
`--enthymeme` flag, including a failure path (an `anchor add` whose span does not
match the document text is rejected). Run with `bash scripts/smoke-test.sh` after
`pnpm run build`.

**Not added, deliberately:** IEEE attribution commands — resolving a URL into
reference fields is a network operation the CLI has no counterpart for.

## 11. Taxonomy vocabulary

**Changes:** `tcw taxonomy add` for `origin-data`, `origin-document`,
`origin-link`, `origin-anchor`, `origin-stance`, and `enthymeme`, linking
`origin-document` to the existing `reference` entry. Run from the **primary
checkout** (`tcw` fails inside a git worktree), so these land on `main` as a
docs commit, separate from the code branch.

**Verified by:** `tcw taxonomy check` and `tcw validate` report no new problems
beyond the four pre-existing `resolution`/`status` mismatches.

## 12. Documentation Sync

Evaluated once over the finished diff, per `stage-implement.md` — one commit,
separate from code. Triggers predicted to fire, from `AGENTS.md`:

| Entry | Why it fires |
|---|---|
| `docs/api-reference.md` [Public-API] | the origin library, its snapshot slice, `normalizeOriginText`, `sliceByCodePoints`, `sha256Hex`, `enthymeme` |
| `README.md` "Invalid Constructions" [Validation-Rules] | `P-6` |
| `docs/Proposit_Grammar.md` | Presentable rule inventory and tier rule list |
| `README.md` [Public-CLI-API] + `CLI_EXAMPLES.md` | the `origins` command group and `--enthymeme` |
| `scripts/smoke-test.sh` [Public-CLI-API] | covered by task 10 |
| `src/lib/core/interfaces/library.interfaces.ts` [Public-Engine-API] | new snapshot + lookup interfaces; JSDoc |
| `src/lib/core/proposit-core.ts` [Public-API] | JSDoc for the new public field and the changed snapshot shape |
| `docs/release-notes/upcoming.md` [Public-API] | user-facing summary |
| `docs/changelogs/upcoming.md` [Any-Code-Change] | commit-hash range |

Predicted **not** to fire:

| Entry | Why not |
|---|---|
| `AGENTS.md` [Routing] | no new easy-to-violate invariant and no new canonical doc route. Reconsidered at task 12: if the normalizer's one-way-door property reads as an invariant a future agent would trip over, it is added there. |
| `examples/arguments/*.yaml` [Argument-Schema] | the YAML import format has no slot for origin data and none is added; citations/axioms are inferred from claim type (`argument-parser.ts:639-668`), and origin data is argument-external. The request predicted this trigger would fire; it does not. |
| `argument-engine.interfaces.ts`, `premise-engine.interfaces.ts`, `shared.interfaces.ts`, `argument-library.ts`, `fork-library.ts`, `fork-namespace.ts` | no signature change; forking is untouched by design |

The `documentation-sync` skill is invoked once at task 12 over the whole change
rather than per task, so the above is a prediction to be checked, not a
substitute for running it.

---

## Verification

`pnpm run check` in the worktree (typecheck → prettier → eslint → vitest →
build), plus `bash scripts/smoke-test.sh` after the build for task 10.

**What the suite cannot check, and how it is covered instead:**

- **That no *existing* stored checksum changed.** The suite hashes fixtures, not
  production rows. Task 3's golden strings, recorded before the field exists, are
  the strongest available proxy; the real assurance is structural — the `if
  (field in entity)` guard at `checksum.ts:42` combined with `Type.Optional`.
  Consumers must independently guarantee that absence round-trips as absence and
  not as null; that is stated in the epic and belongs to the persistence slice.
- **That the normalizer's behavior is the *right* one**, as opposed to merely
  stable. It cannot be tested, only decided; criteria 7-9 pin the decision so a
  later change is loud.
- **Cross-repo wire-format agreement on `P-6`.** Nothing in this repo can prove
  `@proposit/shared` picks the code up; it does so through the dep range with no
  code change, and the consuming slice verifies it.
- **Release grouping.** This slice ships with the sibling pipeline-provenance
  slice in one core release, gated on consumer-side tarball validation at the
  workspace root. No version is cut, no tag is pushed, and no publish happens
  from this node.

## Notes

- No `tcw work edit --blocked-by` is recorded: this slice is the epic's first and
  has no blockers. The sibling slice shares the package but not a code path and is
  explicitly not chained to it.
- Tasks 1, 2, 5, 9 and 11 are independent of each other. They are ordered for a
  readable history, not because sequencing requires it.
