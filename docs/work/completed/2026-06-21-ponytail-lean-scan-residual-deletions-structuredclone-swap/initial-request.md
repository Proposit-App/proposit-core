# Ponytail lean-scan — residual deletions + structuredClone swap

## Product changes

None directly — this item is now a **decomposition parent**. See the two children for
the actionable work.

## Technical changes

This was an oversized raw ponytail-audit dump (repo-wide lean scan, 2026-06-17, 7 sections)
with no acceptance criteria, mixing genuinely-safe mechanical wins with public-API removals
that conflict with proposit-core's published-library contract. It has been decomposed into
two scoped children, and the recommendations that conflict with repo invariants have been
explicitly held (below).

### Children (created 2026-06-28, nested under this item)

1. **`2026-06-28-structuredclone-swap-and-zero-caller-internal-cleanup-nullish-simplify-checksum-key-dedup`**
   — the SAFE, internal-only mechanical wins. No export is removed, so no cross-repo grep
   is needed. Covers the audit's §6 (`structuredClone` swap at `schemata.ts:178`,
   `structural.ts:317` nullish simplification), §7 (checksum-key-array dedup in `consts.ts`,
   checksum-caching mixin, `sortedCopyById` micro-shrink), and §2's genuinely-internal
   zero-caller helpers.

2. **`2026-06-28-prune-dead-public-barrel-exports-gated-on-proposit-server-and-proposit-mobile-consumer-grep`**
   — the PUBLIC-API / export-surface removals, **GATED on a cross-repo consumer grep** of
   proposit-server + proposit-mobile (+ `@proposit/shared` re-exports) first. Covers the
   audit's §3 (barrel-reach dead exports), §4 (citation-extension subpath schemas), and §5
   (validator functions). Its body carries the public-API contract notes and the
   `orderChangeset` carve-out.

## Held by invariant — recommendations NOT actioned (rationale preserved)

The original audit recommended several changes that conflict with proposit-core's
published-library invariants. They are kept here so the rationale is not silently dropped:

- **Audit §1 (yagni — "Interface indirection") — HELD, conflicts `[Public-Engine-API]`.**
  The audit proposed deleting the engine interface files by dropping their `implements`
  clauses:
  - `premise-engine.interfaces.ts` (8 premise interfaces, ~567 lines)
  - `argument-engine.interfaces.ts` + `library.interfaces.ts` (10 argument/variable/
    `TClaimLookup` interfaces, ~933 lines)
  - `versioned-library.ts` abstract base (~220 lines)

  These four interface files are the **canonical `[Public-Engine-API]` Documentation-Sync
  surface** (proposit-core `CLAUDE.md` → Documentation Sync). They hold the published
  engine-API JSDoc and are required surface for a published library — not nominal-typing
  bloat to inline. **Do not remove/inline them.**

  The §1 sub-items that are *internal refactors* (PremiseEngine→ExpressionManager
  delegation collapse ~200 lines / 106 methods; ArgumentEngine→PremiseEngine Map-wrapper
  collapse ~100 lines / 28 methods) are **not** pulled into either child either: they touch
  the `argument-engine.ts` / `premise-engine.ts` god-classes, which were deliberately
  triaged out of the architecture review as high-effort / high-regression-risk (the
  `withValidation` + `ChangeCollector` + checksum-dirty-propagation invariants are tightly
  interwoven) and are tracked separately for the engine-class decomposition. Not safe
  mechanical wins.

- **`orderChangeset` removal — HELD, conflicts the `orderChangeset` invariant.** The audit
  §3 lists `orderChangeset` (`src/lib/utils/changeset.ts`) among "barrel-reach dead
  exports". It emits FK-safe persistence ordering — a documented core **invariant**
  (proposit-core `CLAUDE.md` → Invariants) — and proposit-server's persistence layer is its
  near-certain consumer. It is **struck from the deletion list** in child #2 and must stay
  exported, regardless of grep result.

- **`createChecksumConfig` — HELD as public API.** The audit §2 mis-filed
  `createChecksumConfig` (`consts.ts:113`) under "zero-callers (internal only)". It is in
  fact barrel-exported (`src/lib/index.ts:74`). Its removal is moved into child #2's gated
  list; only its internal key-array dedup (non-removing) lives in child #1.

---

> Full original audit detail (the §1–§7 tables, net-impact summary, and recommended
> execution order) has been relocated into the two child bodies and the held-by-invariant
> notes above. The children are the source of truth for actionable scope; this item is the
> decomposition rollup.
