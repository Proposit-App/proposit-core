# Assertion → Claim Terminology Rename

**Date:** 2026-03-15
**Status:** Approved
**Type:** Breaking refactor (terminology only)

## Motivation

"Assertion" is an overloaded term in programming (test assertions, type assertions). Renaming to "Claim" eliminates this ambiguity for library consumers. "Claim" is also shorter and equally appropriate in the argumentation/logic domain.

## Scope

Pure terminology rename. No behavioral, structural, or architectural changes. Every occurrence of "Assertion" / "assertion" in the domain sense becomes "Claim" / "claim".

## Rename Mapping

### Types & Interfaces

| Before                                  | After                           |
| --------------------------------------- | ------------------------------- |
| `TCoreAssertion`                        | `TCoreClaim`                    |
| `TAssertionLookup<TAssertion>`          | `TClaimLookup<TClaim>`          |
| `TAssertionLibrarySnapshot<TAssertion>` | `TClaimLibrarySnapshot<TClaim>` |

### Classes

| Before                         | After                  |
| ------------------------------ | ---------------------- |
| `AssertionLibrary<TAssertion>` | `ClaimLibrary<TClaim>` |

### Schemata

| Before                | After             |
| --------------------- | ----------------- |
| `CoreAssertionSchema` | `CoreClaimSchema` |

### Fields (on variable schema/entities)

| Before             | After          |
| ------------------ | -------------- |
| `assertionId`      | `claimId`      |
| `assertionVersion` | `claimVersion` |

### Fields (on snapshot type)

| Before                                 | After                          |
| -------------------------------------- | ------------------------------ |
| `TAssertionLibrarySnapshot.assertions` | `TClaimLibrarySnapshot.claims` |

### Parameters & Properties

| Before                                             | After          |
| -------------------------------------------------- | -------------- |
| `assertionLibrary`                                 | `claimLibrary` |
| `assertionFields` (checksum config type + default) | `claimFields`  |

### Generic Type Parameters

| Before                    | After    |
| ------------------------- | -------- |
| `TAssertion` (everywhere) | `TClaim` |

### File Renames

| Before                              | After                           |
| ----------------------------------- | ------------------------------- |
| `src/lib/schemata/assertion.ts`     | `src/lib/schemata/claim.ts`     |
| `src/lib/core/assertion-library.ts` | `src/lib/core/claim-library.ts` |

## Execution Strategy

Bottom-up rename in dependency order. Each layer compiles before moving to the next.

### Layer 1 — Schemata

- Rename `src/lib/schemata/assertion.ts` → `claim.ts`
- Rename `CoreAssertionSchema` → `CoreClaimSchema`, `TCoreAssertion` → `TCoreClaim`, update JSDoc descriptions
- Update `src/lib/schemata/propositional.ts`: `assertionId` → `claimId`, `assertionVersion` → `claimVersion`, JSDoc descriptions
- Update `src/lib/schemata/index.ts` re-export path

### Layer 2 — Interfaces & Types

- Update `src/lib/core/interfaces/library.interfaces.ts`: rename types, generic params, `assertions` field → `claims`, JSDoc
- Update `src/lib/core/interfaces/argument-engine.interfaces.ts`: `assertionId`/`assertionVersion` in `updateVariable` signature and JSDoc
- Update `src/lib/core/interfaces/index.ts` re-exports
- Update `src/lib/types/checksum.ts`: `assertionFields` → `claimFields` on `TCoreChecksumConfig`

### Layer 3 — Core Implementation

- Rename `src/lib/core/assertion-library.ts` → `claim-library.ts`
- Rename class `AssertionLibrary` → `ClaimLibrary`, all internals, error messages, snapshot `assertions` → `claims`
- Update `src/lib/consts.ts`: `assertionFields` → `claimFields`, string literals `"assertionId"` → `"claimId"`, `"assertionVersion"` → `"claimVersion"`, `"assertionFields"` → `"claimFields"` in config keys
- Update `src/lib/core/argument-engine.ts`: parameter names, validation, error messages, inline comments
- Update `src/lib/core/diff.ts`: field comparison references, JSDoc

### Layer 4 — Barrel Exports

- Update `src/lib/index.ts` export path and name

### Layer 5 — CLI

- Update `src/cli/engine.ts`: import + instantiation
- Update `src/cli/import.ts`: import + instantiation + usage
- Update `src/cli/commands/variables.ts`: TODO comment, variable literal field names

### Layer 6 — Tests

- Update `test/core.test.ts`: ~134 fixture occurrences, `AssertionLibrary` instantiation, `aLib()` and `makeVar()` helpers
- Update `test/diff-renderer.test.ts`: fixture occurrences

### Layer 7 — Documentation

- Update `CLAUDE.md`: design rules, documentation sync section
- Update `docs/api-reference.md`: full API docs
- Update `docs/plans/2026-03-13-global-libraries-design.md`: design spec references

## What Does NOT Change

- Test framework assertions (`expect()`, etc.)
- Historical design docs (except `2026-03-13-global-libraries-design.md`)
- Any behavioral logic
- Source-related terminology (`SourceLibrary`, `TSourceLookup`, etc.)

## Verification

- `pnpm run check` passes (typecheck + lint + prettier + tests + build)
- No remaining occurrences of "assertion" in domain sense (grep verification)
- All exports updated in barrel files
