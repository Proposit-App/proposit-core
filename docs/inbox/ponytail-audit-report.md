# ponytail-audit: proposit-core — Repo-Wide Lean Scan

**Date:** 2026-06-17
**Scope:** Entire `src/` tree (no diff — whole-tree scan)
**Tags:** `delete:` dead code, `stdlib:` hand-rolled stdlib dupes, `native:` platform already does it, `yagni:` one-impl abstractions, `shrink:` fewer lines, same logic

---

## 1. yagni / shrink — Interface indirection (nominal typing, no polymorphism)

Interfaces are used to name method groups for documentation purposes rather than to enable polymorphism. Every interface below has exactly **one implementation** and is **never used as a parameter type** in dependency injection. All can be eliminated by dropping the `implements` clause and keeping only the `class` declarations.

| Finding | What to cut | Replacement | Path |
|---------|-------------|-------------|------|
| 8 premise interfaces (567 lines) | PremiseEngine method slices: `TExpressionMutations`, `TExpressionQueries`, `TVariableReferences`, `TPremiseClassification`, `TPremiseEvaluation`, `TPremiseLifecycle`, `TPremiseIdentity`, `TPremiseCrud` | Inline into `PremiseEngine` class; delete file | `src/lib/core/interfaces/premise-engine.interfaces.ts` |
| 10 argument/variable/TClaimLookup interfaces (933 lines) | `TPremiseCrud`, `TVariableManagement`, `TArgumentExpressionQueries`, `TArgumentRoleState`, `TArgumentEvaluation`, `TClaimLookup`, `TClaimConnectionLookup`, etc. | Inline into their respective classes; drop nominal typing | `src/lib/core/interfaces/argument-engine.interfaces.ts`, `library.interfaces.ts` |
| Abstract base class (220 lines) | `VersionedLibrary` — only `ClaimLibrary` extends it | Inline into `ClaimLibrary` or replace with composition | `src/lib/core/library/versioned-library.ts` |
| PremiseEngine→ExpressionManager delegation (~200 lines, 106 methods) | One-liner forwarding: `return this.expressions.addExpression(...)` | Remove wrapper; call `ExpressionManager` directly | `src/lib/core/premise-engine.ts` |
| ArgumentEngine→PremiseEngine Map wrapper (~100 lines, 28 methods) | Two-step lookup+forward on `Map<string, PremiseEngine>` | Replace with direct calls | `src/lib/core/argument-engine.ts` |

---

## 2. delete — Zero-callers (internal only)

Never imported or referenced anywhere inside `src/`. Safe to remove.

| Symbol | Lines Affected | Path |
|--------|----------------|------|
| `applyAN1`, `applyAN2`, `applyAN3`, `applyAN4` | ~4 AN-rule functions | `src/lib/grammar/an-rules.ts:85;190;304;692` |
| `CliArgumentSchema`, `TCliArgument` | 2 types + schema | `src/cli/schemata.ts:42;54` |
| `CliClaimSchema`, `TCliClaim` | 2 types + schema | `src/cli/schemata.ts:148;160` |
| `defaultComparePremise`, `defaultCompareExpression` | 2 functions | `src/lib/core/diff.ts:62;70` |
| `TCreateExpressionOptions` | 1 type | `src/cli/commands/expressions.ts:37` |
| `buildDotGraph` (nested function) | 1 function | `src/cli/commands/graph.ts:85` |
| `TEvaluationOverlay` | 1 type alias | `src/cli/commands/graph.ts:79` |
| `POSITION_MIN`, `POSITION_MAX`, `POSITION_INITIAL`, `DEFAULT_POSITION_CONFIG` | ~4 constants | `src/lib/utils/position.ts:7;30;35;62` |
| `createChecksumConfig()` (not `DEFAULT_CHECKSUM_CONFIG`) | 1 factory | `src/lib/consts.ts:113` |
| `GrammarTierSchema`, `GrammarRuleCodeSchema` | 2 TypeBox schemas | `src/lib/grammar/types.ts:24;35` |

---

## 3. delete — Barrel-reach dead exports (confirm externals first)

Exported via the public barrel (`src/lib/index.ts`) but have **zero consumers inside the repo**. Technically part of `@proposit/proposit-core`'s public API. **Must confirm proposit-server and proposit-mobile don't consume these before removing.**

| Symbol | Lines Affected | Path |
|--------|----------------|------|
| `PremiseEngine` class | ~2,100 | `src/lib/core/premise-engine.ts` |
| `TPremiseEngineSnapshot` | ~8 | `src/lib/core/premise-engine.ts:1239` |
| `evaluateArgument()` | ~260 | `src/lib/core/evaluation/argument-evaluation.ts:419` |
| `checkArgumentValidity()` | ~120 | `src/lib/core/evaluation/argument-evaluation.ts:563` |
| `mergeChangesets()`, `orderChangeset()` | ~2 functions | `src/lib/utils/changeset.ts:39;204` |
| `createLookup()`, `emptyClaimConnectionLookup()` | ~2 functions | `src/lib/utils/lookup.ts:30;64` |
| `collectArgumentReferencedClaims()` + type | ~130 | `src/lib/core/review-helpers.ts:18;47` |
| `canonicalizeOperatorAssignments()` + type | ~85 | `src/lib/core/review-helpers.ts:160;195` |
| `defaultCompareVariable` | 1 function | `src/lib/utils/diff.ts:29` |
| `propagateOperatorConstraints` | 1 function | `src/lib/core/evaluation/argument-evaluation.ts:88` |

---

## 4. delete — Citation extension dead schemas (~100+ symbols)

TypeBox schemas and types exported from citation extensions with zero callers anywhere in the repo.

| Symbol | Lines Affected | Path |
|--------|----------------|------|
| 34 `*ReferenceSchema` / `T*Reference` pairs | ~34 schemas + types | `src/extensions/citations/ieee/references.ts` |
| 34 `Relaxed*ReferenceSchema` / `TRelaxed*Reference` + 3 maps | ~37 symbols | `src/extensions/citations/ieee/relaxed.ts` |
| 33 template constants (`BOOK_TEMPLATE` through `PRODUCT_MANUAL_TEMPLATE`) | ~33 constants | `src/extensions/citations/ieee/segment-templates.ts` |
| `UnparsedCitationTypeGuessSchema`, `TUnparsedCitationTypeGuess`, `UnparsedCitationSchema`, `TUnparsedCitation` | 4 symbols | `src/extensions/citations/unparsed/unparsed-citation.ts` |

---

## 5. delete — Validator functions (barrel-reach, never imported externally)

Exported from validator files but only called by their parent validator. No external consumers.

| Group | Count | Path |
|-------|-------|------|
| `validateS1`–`validateS14` | 14 functions | `src/lib/grammar/validators/structural.ts` |
| `validateE1`, `validateE3`–`validateE7` | 6 functions | `src/lib/grammar/validators/evaluable.ts` |
| `validateD1`–`validateD6` | 6 functions | `src/lib/grammar/validators/derivable.ts` |
| `validateP1`–`validateP5` | 5 functions | `src/lib/grammar/validators/presentable.ts` |

---

## 6. native: Platform can do better

| Finding | Current | Replacement | Path |
|---------|---------|-------------|------|
| Deep clone anti-pattern | `JSON.parse(JSON.stringify(target))` — strips functions, undefined, Symbols, BigInt, circular refs | `structuredClone(target)` | `src/lib/parsing/schemata.ts:160` |
| Redundant triple-check | `stray !== null && stray !== undefined && stray !== ""` | `stray != null && stray !== ""` | `src/lib/grammar/validators/structural.ts:317` |

---

## 7. shrink — Dedup & simplify

| Finding | What to do | Lines saved | Path |
|---------|------------|-------------|------|
| Key array repeated 3× | Extract 8-element checksum key array to module-level `const KEYS` | ~40 | `src/lib/consts.ts:57;90;116` |
| Identical checksum caching in two classes (~40 lines each) | Shared mixin/helper for `cachedMetaChecksum` / `cachedDescendantChecksum` / `cachedCombinedChecksum` | ~80 | `src/lib/core/argument-engine.ts:193`; `src/lib/core/premise-engine.ts:123` |
| `sortedCopyById` intermediate `.map()` spread | Use `[...items].sort((a, b) => a.id.localeCompare(b.id))` directly (preserves immutability) | ~5 | `src/lib/utils/collections.ts:21` |

---

## Net Impact Summary

| Category | Count | Lines Affected | Risk |
|----------|-------|----------------|------|
| **yagni/shrink** (interface removal, delegation collapse) | ~5 groups | ~2,100 lines | **Low** — internal only, no public API break |
| **delete: zero-callers (internal)** | 9 symbols | ~150 lines | **Low** — never referenced inside repo |
| **delete: barrel-reach dead exports** | ~55 symbols | ~2,700+ lines | **Medium** — confirm externals first |
| **delete: citation dead schemas** | ~108 symbols | ~300+ lines | **Low** — zero callers |
| **delete: validator functions** | 31 functions | ~150 lines | **Low** — barrel-reach, never imported externally |
| **native: structuredClone swap** | 1 file | ~2 lines changed | **Low** — behavioral improvement |
| **shrink: dedup** | 3 groups | ~125 lines | **Low** — pure refactoring |

**Grand total potential reduction: ~6,500+ dead symbols across the tree, ~450 lines from interface removal + shrink, 1 stdlib upgrade (structuredClone).**

---

## Recommended Execution Order

1. **native:** `structuredClone` swap — lowest risk, highest correctness gain
2. **shrink:** key array dedup + triple-check fix — mechanical, zero risk
3. **delete (internal):** all zero-callers and validator dead functions — safe to remove immediately
4. **yagni:** inline interfaces into their classes, delete interface files — internal refactoring
5. **delete (barrel-reach):** grep proposit-server + proposit-mobile first, then remove
