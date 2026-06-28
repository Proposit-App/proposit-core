# Prune dead public barrel exports (gated on proposit-server and proposit-mobile consumer grep)

## Product changes

None intended — these symbols have zero callers **inside** proposit-core. But they ARE
part of `@proposit/proposit-core`'s published surface (barrel `src/lib/index.ts` and
extension subpath exports), so removing them is a breaking API change unless the external
consumers also have zero references.

## Technical changes

Decomposed out of the repo-wide lean scan (parent:
`2026-06-21-ponytail-lean-scan-residual-deletions-structuredclone-swap`). Everything here
is an **export-surface removal** and is therefore **GATED** on a cross-repo consumer grep —
do that gate FIRST.

### GATE — run before touching any code

Grep both consumers for every symbol below before removing it from the barrel/subpath
exports. Any non-zero hit means the symbol is live public API — keep it.

```
# from the workspace root, for each candidate symbol:
grep -rn "<Symbol>" /Users/brian/Projects/Proposit-App/proposit-server/{src,app,lib} \
                    /Users/brian/Projects/Proposit-App/proposit-mobile/{src,app}
```

(Also check that `@proposit/shared` does not re-export the symbol onward to its own
consumers — `shared` re-exports parts of the core engine + grammar wire format.)

> **Public-API contract — read before deleting anything.**
>
> - `orderChangeset`, `PremiseEngine`, `evaluateArgument`, and `createChecksumConfig` are
>   all barrel-exported from `src/lib/index.ts` (verified 2026-06-28:
>   `PremiseEngine`/`TPremiseEngineSnapshot` L11–12, `evaluateArgument`/`checkArgumentValidity`
>   L37–38, `mergeChangesets`/`orderChangeset` L47, `createChecksumConfig` L74). They are
>   **published public API**, not internal helpers — zero in-repo callers does NOT make them
>   removable.
> - The engine **interface files** — `premise-engine.interfaces.ts`,
>   `argument-engine.interfaces.ts`, `shared.interfaces.ts`, `library.interfaces.ts` — are
>   the **canonical `[Public-Engine-API]` Documentation-Sync surface** (see proposit-core
>   `CLAUDE.md` → Documentation Sync). They carry the JSDoc that documents the published
>   engine API. They are required surface for a published library, **not** indirection to be
>   inlined. Do **not** remove/inline them (this is why the audit's §1 interface-removal
>   recommendation is held in the parent).
> - Any removal here requires **confirming zero external consumers** (server + mobile +
>   shared re-exports) for that specific symbol before acting.

### HELD regardless of grep — `orderChangeset` (do NOT remove)

`orderChangeset` (`src/lib/utils/changeset.ts`) emits FK-safe persistence ordering — a
documented core **invariant** (proposit-core `CLAUDE.md` → Invariants). proposit-server's
persistence layer is its near-certain consumer. Even if a grep momentarily showed no hit,
removing it would delete a load-bearing ordering guarantee. **Strike it from the deletion
list; keep `orderChangeset` exported.** (`mergeChangesets`, listed alongside it in the
audit, may still be evaluated under the normal grep gate.)

### a. barrel-reach dead exports (confirm externals first)

Exported via `src/lib/index.ts`, zero in-repo consumers. Each requires the GATE grep.

| Symbol                                           | Lines Affected | Path                                                 | Note |
| ------------------------------------------------ | -------------- | ---------------------------------------------------- | ---- |
| `PremiseEngine` class                            | ~2,100         | `src/lib/core/premise-engine.ts`                     | Published engine class — almost certainly consumed; high bar to remove |
| `TPremiseEngineSnapshot`                         | ~8             | `src/lib/core/premise-engine.ts:1239`                | |
| `evaluateArgument()`                             | ~260           | `src/lib/core/evaluation/argument-evaluation.ts:419` | Published eval entry point |
| `checkArgumentValidity()`                        | ~120           | `src/lib/core/evaluation/argument-evaluation.ts:563` | |
| `mergeChangesets()`                              | 1 function     | `src/lib/utils/changeset.ts:39`                      | `orderChangeset` (same file) is HELD — see above |
| `createLookup()`, `emptyClaimConnectionLookup()` | ~2 functions   | `src/lib/utils/lookup.ts:30;64`                      | |
| `collectArgumentReferencedClaims()` + type       | ~130           | `src/lib/core/review-helpers.ts:18;47`               | |
| `canonicalizeOperatorAssignments()` + type       | ~85            | `src/lib/core/review-helpers.ts:160;195`             | |
| `defaultCompareVariable`                         | 1 function     | `src/lib/utils/diff.ts:29`                           | |
| `propagateOperatorConstraints`                   | 1 function     | `src/lib/core/evaluation/argument-evaluation.ts:88`  | |
| `createChecksumConfig()`                         | 1 factory      | `src/lib/consts.ts:113`                              | Barrel-exported (`index.ts:74`); audit mis-filed it under "internal zero-callers" — it belongs HERE, gated. (Its *internal* key-array dedup is handled in the sibling child and does not remove the export.) |

### b. citation-extension dead schemas (subpath-export public API — confirm externals first)

TypeBox schemas/types exported from the citation extensions (`@proposit/proposit-core`
extension **subpath** exports), zero in-repo callers. These are public via subpath export,
so the same GATE applies — grep server/mobile for the IEEE/unparsed reference schemas
before removing (the citation-modeling work recently flipped unparsed-citation support to
Supported, so the unparsed schemas in particular may now have live consumers).

| Symbol                                                                                                         | Lines Affected      | Path                                                     |
| -------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------- |
| 34 `*ReferenceSchema` / `T*Reference` pairs                                                                    | ~34 schemas + types | `src/extensions/citations/ieee/references.ts`            |
| 34 `Relaxed*ReferenceSchema` / `TRelaxed*Reference` + 3 maps                                                   | ~37 symbols         | `src/extensions/citations/ieee/relaxed.ts`               |
| 33 template constants (`BOOK_TEMPLATE` through `PRODUCT_MANUAL_TEMPLATE`)                                      | ~33 constants       | `src/extensions/citations/ieee/segment-templates.ts`     |
| `UnparsedCitationTypeGuessSchema`, `TUnparsedCitationTypeGuess`, `UnparsedCitationSchema`, `TUnparsedCitation` | 4 symbols           | `src/extensions/citations/unparsed/unparsed-citation.ts` |

### c. validator functions (export-surface — confirm externals first)

Exported from the validator files but only called by their parent validator inside the
repo. The audit labels them "barrel-reach, never imported externally" — confirm that with
the GATE grep before removing each (and confirm grammar-rule wire codes are unaffected —
the `S-`/`E-`/`D-`/`P-` codes are stable wire format and must NOT change).

| Group                                   | Count        | Path                                        |
| --------------------------------------- | ------------ | ------------------------------------------- |
| `validateS1`–`validateS14`              | 14 functions | `src/lib/grammar/validators/structural.ts`  |
| `validateE1`, `validateE3`–`validateE7` | 6 functions  | `src/lib/grammar/validators/evaluable.ts`   |
| `validateD1`–`validateD6`               | 6 functions  | `src/lib/grammar/validators/derivable.ts`   |
| `validateP1`–`validateP5`               | 5 functions  | `src/lib/grammar/validators/presentable.ts` |

## Acceptance criteria

- For every candidate symbol: a recorded GATE grep across proposit-server, proposit-mobile,
  and `@proposit/shared` re-exports showing zero hits before it is removed.
- `orderChangeset` remains exported (held by invariant); the engine interface files remain
  intact (held by `[Public-Engine-API]`).
- If any symbols are removed, treat it as a breaking change: update `docs/api-reference.md`
  `[Public-API]` + the relevant `[Public-Engine-API]` interface JSDoc, and a `minor`/`major`
  version bump per the consumer-gated release process (do not self-publish).
- `pnpm run check` green.
