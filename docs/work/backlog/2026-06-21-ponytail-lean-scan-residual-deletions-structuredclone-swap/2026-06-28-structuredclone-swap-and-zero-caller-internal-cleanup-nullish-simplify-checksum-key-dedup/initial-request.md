# structuredClone swap and zero-caller internal cleanup (nullish simplify, checksum-key dedup)

## Product changes

None — internal-only cleanup. No public API, CLI surface, or behavior changes.

## Technical changes

Safe, mechanical wins decomposed out of the repo-wide lean scan (parent:
`2026-06-21-ponytail-lean-scan-residual-deletions-structuredclone-swap`). Every item
here is internal: no barrel (`src/lib/index.ts`) or extension subpath export is removed,
so no cross-repo consumer grep is required. (Export-surface removals were split into the
sibling child `…-prune-dead-public-barrel-exports-…`.)

> Re-verify each line/path with a fresh grep before editing — line numbers below are from
> the 2026-06-17 audit and may have drifted.

### a. native — platform built-ins / nullish simplification

| Finding                 | Current                                                                                            | Replacement                     | Path (verified 2026-06-28)                     |
| ----------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------- |
| Deep-clone anti-pattern | `JSON.parse(JSON.stringify(target))` — strips functions, undefined, Symbols, BigInt; throws on circular refs | `structuredClone(target)`       | `src/lib/parsing/schemata.ts:178` (audit cited stale `:160`) |
| Redundant triple-check  | `stray !== null && stray !== undefined && stray !== ""`                                            | `stray != null && stray !== ""` | `src/lib/grammar/validators/structural.ts:317` |

Both verified present 2026-06-28. The `schemata.ts:178` clone is the only
`JSON.parse(JSON.stringify(...))` left in `src/lib/`.

### b. shrink — dedup & simplify (no API change)

| Finding                                                    | What to do                                                                                           | Lines saved | Path                                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------- |
| 8-element checksum-key array repeated 3×                   | Extract the `["expressionFields" … "claimAxiomFields"]` array to a module-level `const KEYS` in `consts.ts` and reuse from `normalizeChecksumConfig`, `serializeChecksumConfig`, `createChecksumConfig` | ~40         | `src/lib/consts.ts:57;90;116` (all three verified 2026-06-28)               |
| Identical checksum caching in two classes (~40 lines each) | Shared mixin/helper for `cachedMetaChecksum` / `cachedDescendantChecksum` / `cachedCombinedChecksum` | ~80         | `src/lib/core/argument-engine.ts:193`; `src/lib/core/premise-engine.ts:123` |
| `sortedCopyById` intermediate `.map()` spread              | Use `[...items].sort((a, b) => a.id.localeCompare(b.id))` directly (preserves immutability)          | ~5          | `src/lib/utils/collections.ts:21`                                           |

> The checksum-key dedup edits the **body** of `createChecksumConfig` (extracting its
> local `keys` array) — it does **not** remove the function. `createChecksumConfig` is
> barrel-exported public API; its removal is out of scope here and held in the sibling
> child (see the Held-by-invariant note in the parent).
>
> The checksum-caching mixin touches the `argument-engine.ts` / `premise-engine.ts`
> god-classes — low-risk (pure internal dedup, no API change) but larger blast radius than
> the others; sequence it last and run the full suite after.

### c. delete — genuinely zero-caller internals (non-barrel-exported)

Never imported or referenced anywhere inside `src/`, and NOT re-exported from
`src/lib/index.ts`. Safe to remove. **Re-grep each symbol repo-wide before deleting** to
confirm zero callers (incl. tests, CLI, examples) and confirm it is not barrel-exported.

| Symbol                                                                        | Lines Affected       | Path                                         |
| ----------------------------------------------------------------------------- | -------------------- | -------------------------------------------- |
| `applyAN1`, `applyAN2`, `applyAN3`, `applyAN4`                                | ~4 AN-rule functions | `src/lib/grammar/an-rules.ts:85;190;304;692` |
| `CliArgumentSchema`, `TCliArgument`                                           | 2 types + schema     | `src/cli/schemata.ts:42;54`                  |
| `CliClaimSchema`, `TCliClaim`                                                 | 2 types + schema     | `src/cli/schemata.ts:148;160`                |
| `defaultComparePremise`, `defaultCompareExpression`                           | 2 functions          | `src/lib/core/diff.ts:62;70`                 |
| `TCreateExpressionOptions`                                                    | 1 type               | `src/cli/commands/expressions.ts:37`         |
| `buildDotGraph` (nested function)                                             | 1 function           | `src/cli/commands/graph.ts:85`               |
| `TEvaluationOverlay`                                                          | 1 type alias         | `src/cli/commands/graph.ts:79`               |
| `POSITION_MIN`, `POSITION_MAX`, `POSITION_INITIAL`, `DEFAULT_POSITION_CONFIG` | ~4 constants         | `src/lib/utils/position.ts:7;30;35;62`       |
| `GrammarTierSchema`, `GrammarRuleCodeSchema`                                  | 2 TypeBox schemas    | `src/lib/grammar/types.ts:24;35`             |

> **`createChecksumConfig()` (`consts.ts:113`) was listed by the audit under this
> "zero-callers (internal only)" group — that classification is WRONG.** It IS barrel-
> exported (`src/lib/index.ts:74`), so it is part of `@proposit/proposit-core`'s public
> API. Its removal is moved to the sibling child and gated on the cross-repo consumer grep.
> Do NOT delete it here. (The key-array dedup in §b only rewrites its internals.)

## Acceptance criteria

- `structuredClone` replaces the lone `JSON.parse(JSON.stringify)` in `schemata.ts`; clone
  behavior verified by existing parse/schema tests.
- `structural.ts:317` triple-check simplified to `!= null && !== ""` with no S-6 test
  regressions.
- Checksum-key array extracted to a single module const; the three call sites reuse it.
- Each §c symbol confirmed zero-caller AND non-barrel-exported by a fresh repo-wide grep
  immediately before deletion; `createChecksumConfig` explicitly excluded.
- `pnpm run check` green (typecheck + lint + full test suite).
