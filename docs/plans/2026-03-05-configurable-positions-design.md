# Configurable Position Range

**Date:** 2026-03-05
**Status:** Approved

## Problem

Current positions use `[0, Number.MAX_SAFE_INTEGER]` which doesn't fit in Postgres signed 4-byte integers (`int4`, range -2,147,483,647 to 2,147,483,647).

## Design

### Types

```typescript
type TCorePositionConfig = {
    min: number // default: -(2^31 - 1) = -2147483647
    max: number // default: 2^31 - 1 = 2147483647
    initial: number // default: 0
}

type TArgumentEngineOptions = {
    checksumConfig?: TCoreChecksumConfig
    positionConfig?: TCorePositionConfig
}
```

### Data flow

```
ArgumentEngine(argument, options?: TArgumentEngineOptions)
  └─ options.positionConfig?: TCorePositionConfig
  └─ options.checksumConfig?: TCoreChecksumConfig

  → passes positionConfig to PremiseManager constructor
    → passes positionConfig to ExpressionManager constructor
      → ExpressionManager uses config values instead of imported constants
```

### Changes

1. **`position.ts`** — Update defaults to signed int32 range. Add `TCorePositionConfig` type and `DEFAULT_POSITION_CONFIG` constant.
2. **Schema (`propositional.ts`)** — Remove `minimum: 0` from position field.
3. **`ExpressionManager`** — Accept `positionConfig` in constructor. Use config values instead of imported constants.
4. **`PremiseManager`** — Accept `positionConfig` in constructor, forward to `ExpressionManager`.
5. **`ArgumentEngine`** — Change constructor `options` to `TArgumentEngineOptions`. Forward `positionConfig` to `PremiseManager`.
6. **`src/index.ts`** — Export new types and constants.
7. **Tests** — Update position assertions, add tests for custom config.
8. **Docs** — Update CLAUDE.md, README.md, CLI_EXAMPLES.md as needed.
