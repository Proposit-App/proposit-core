# Changelog

## Changed (1692b7e–01c2b02)

- `DEFAULT_CHECKSUM_CONFIG`: removed own `id` field from `argumentFields`, `premiseFields`, `expressionFields`, and `variableFields` — checksums are now content-based and ID-free by default
- Updated all tests that hardcoded checksum values to reflect the new defaults

## Added

- `graph` CLI command: outputs argument as DOT (Graphviz) directed graph with premise clusters, expression tree nodes, variable bindings, and cross-premise edges
- `graph --analysis <filename>`: overlays evaluation results with truth-value coloring on expression nodes, variable definitions, and premise borders
- `graph --json`: outputs DOT string wrapped in JSON
- `generateId` option added to `TLogicEngineOptions`, `TPropositCoreConfig`, and `TParserBuildOptions`
- `defaultGenerateId` exported from library barrel — uses `globalThis.crypto.randomUUID()`
- Removed `node:crypto` import from all `src/lib/` files (argument-engine, premise-engine, expression-manager, proposit-core, argument-parser, fork)
- `ArgumentEngine.fromSnapshot` accepts optional `generateId` parameter for post-restoration mutations
