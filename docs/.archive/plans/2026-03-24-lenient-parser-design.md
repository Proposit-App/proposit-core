# Lenient Parser Mode & MiniId Prompt Guidance

**Date:** 2026-03-24
**Status:** Approved

## Problem

`ArgumentParser.build()` hard-fails on invalid cross-entity miniId references. Since the primary consumer is LLM output — which can hallucinate references — a single bad miniId (e.g., using a claim miniId where a source miniId is expected) causes the entire build to fail. Additionally, `buildParsingPrompt()` doesn't communicate miniId namespacing conventions, making cross-entity confusion more likely.

## Changes

### 1. Lenient build mode

Add an optional `TParserBuildOptions` parameter to `build()` with a `strict` flag (default `true`). In lenient mode (`strict: false`), invalid references are skipped and collected as warnings instead of throwing.

#### New types (in `src/lib/parsing/types.ts`)

```typescript
type TParserWarningCode =
    | "UNRESOLVED_SOURCE_MINIID"
    | "UNRESOLVED_CLAIM_MINIID"
    | "UNRESOLVED_CONCLUSION_MINIID"
    | "UNDECLARED_VARIABLE_SYMBOL"
    | "FORMULA_PARSE_ERROR"
    | "FORMULA_STRUCTURE_ERROR"

type TParserWarning = {
    code: TParserWarningCode
    message: string
    context: Record<string, string>
}

type TParserBuildOptions = {
    strict?: boolean // default: true
}
```

The `context` field carries identifiers relevant to each warning code (e.g., `{ claimMiniId: "c1", sourceMiniId: "b1" }` for `UNRESOLVED_SOURCE_MINIID`, `{ premiseMiniId: "p1", symbol: "X" }` for `UNDECLARED_VARIABLE_SYMBOL`).

#### Changes to `TArgumentParserResult`

Add `warnings: TParserWarning[]`. Always present — empty array when strict or when lenient encounters no issues.

#### Changes to `build()` signature

```typescript
build(response: TParsedArgumentResponse, options?: TParserBuildOptions): TArgumentParserResult
```

#### Recovery behavior per reference type

| Reference                                          | Warning code                   | Recovery                                                                                      |
| -------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------- |
| `claim.sourceMiniIds` → unknown source miniId      | `UNRESOLVED_SOURCE_MINIID`     | Skip the association; claim still created                                                     |
| `variable.claimMiniId` → unknown claim miniId      | `UNRESOLVED_CLAIM_MINIID`      | Skip the variable entirely                                                                    |
| Formula symbol → undeclared variable symbol        | `UNDECLARED_VARIABLE_SYMBOL`   | Skip the entire premise                                                                       |
| Formula syntax error (malformed expression)        | `FORMULA_PARSE_ERROR`          | Skip the entire premise                                                                       |
| Formula structure error (nested `implies`/`iff`)   | `FORMULA_STRUCTURE_ERROR`      | Skip the entire premise                                                                       |
| `conclusionPremiseMiniId` → unknown premise miniId | `UNRESOLVED_CONCLUSION_MINIID` | Don't set conclusion role explicitly (auto-conclusion from first added premise still applies) |

**Cascade:** Skipping a variable due to `UNRESOLVED_CLAIM_MINIID` removes its symbol from the declared set. Premises referencing that symbol will also be skipped with an `UNDECLARED_VARIABLE_SYMBOL` warning. Both warnings are emitted so the caller sees the full chain.

**Zero-premise edge case:** If all premises are skipped, the engine has zero premises and no conclusion. This is a valid engine state (equivalent to an empty argument). Callers should check the warnings array and premise count to detect this situation.

**Strict mode:** Unchanged. All cases throw as they do today.

### 2. MiniId prompt guidance

Add a "MiniId Conventions" section to the `CORE_PROMPT` in `prompt-builder.ts`:

```
### MiniId Conventions

Each entity type uses a distinct prefix for its miniId to avoid cross-reference confusion:

- Claims: `c1`, `c2`, `c3`, ...
- Sources: `s1`, `s2`, `s3`, ...
- Variables: `v1`, `v2`, `v3`, ...
- Premises: `p1`, `p2`, `p3`, ...

Always use the correct prefix when referencing entities. For example, a claim's
`sourceMiniIds` array should contain source miniIds (e.g., `["s1", "s2"]`),
not claim miniIds.
```

This is guidance only — `build()` does not validate miniId prefix format.

## Files changed

- `src/lib/parsing/types.ts` — add `TParserWarningCode`, `TParserWarning`, `TParserBuildOptions`
- `src/lib/parsing/argument-parser.ts` — add `warnings` to `TArgumentParserResult`, update `build()` signature and implement lenient recovery paths
- `src/lib/parsing/prompt-builder.ts` — add miniId conventions section to `CORE_PROMPT`
- `src/lib/parsing/index.ts` — export `TParserWarningCode`, `TParserWarning`, `TParserBuildOptions`
- `src/cli/commands/parse.ts` — pass `{ strict: false }` to `build()` and display warnings
- `test/core.test.ts` — new tests for lenient mode

**Subclass note:** `BasicsArgumentParser` and other subclasses only override `map*` hooks. They inherit lenient behavior from the base class without changes.

## Test plan

1. **Lenient: unresolved source miniId** — claim references nonexistent source miniId with `{ strict: false }`. Build succeeds, claim created without that association, warnings contains `UNRESOLVED_SOURCE_MINIID`.
2. **Lenient: unresolved claim miniId** — variable references nonexistent claim miniId. Build succeeds, variable skipped, warnings contains `UNRESOLVED_CLAIM_MINIID`.
3. **Lenient: undeclared variable symbol** — formula uses undeclared symbol. Premise skipped, warnings contains `UNDECLARED_VARIABLE_SYMBOL`.
4. **Lenient: cascade from skipped variable** — variable skipped due to bad claim ref, then premise using that symbol also skipped. Both warnings emitted.
5. **Lenient: unresolved conclusion miniId** — conclusion references nonexistent premise. No conclusion set explicitly (auto-conclusion applies to first surviving premise), warnings contains `UNRESOLVED_CONCLUSION_MINIID`.
6. **Lenient: formula parse error** — premise has malformed formula (e.g., unbalanced parens). Premise skipped, warnings contains `FORMULA_PARSE_ERROR`.
7. **Lenient: formula structure error** — premise has nested `implies`/`iff`. Premise skipped, warnings contains `FORMULA_STRUCTURE_ERROR`.
8. **Lenient: no issues** — valid response with `{ strict: false }`. Identical result, warnings is empty array.
9. **Strict mode still throws** — each of the 6 cases still throws with default options.
10. **Strict: unresolved source miniId throws** — cover the previously untested strict path for bad source miniIds.
11. **Warnings on strict success** — valid response with default options. Warnings is empty array.
12. **Prompt includes miniId conventions** — `buildParsingPrompt()` output contains prefix guidance.
