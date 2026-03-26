# Changelog

<changes starting-hash="c6fbae2" ending-hash="c6fbae2">

## Added

- `PremiseEngine.toggleNegation(expressionId, extraFields?)` — optional `Partial<TExpr>` second parameter merged into internally-created NOT and formula expressions. Structural fields (`id`, `type`, `operator`, `parentId`, `position`, `premiseId`, `argumentId`, `argumentVersion`) cannot be overridden. Updated interface in `src/lib/core/interfaces/premise-engine.interfaces.ts`.
- 6 new tests in `test/core.test.ts` under `"toggleNegation extraFields"` covering variable targets, operator targets with formula buffers, changeset checksum correctness, removal path (no-op), structural field override protection, and backwards compatibility.

</changes>
