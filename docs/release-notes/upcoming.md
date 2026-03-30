# Release Notes

## New: Graph command

You can now visualize arguments as directed graphs using the new `graph` command. It outputs DOT (Graphviz) format that can be piped to `dot` to produce SVG or PNG images.

Use `--analysis <filename>` to overlay evaluation results — expression nodes are colored by truth value, making it easy to see how truth flows through the argument.

## New: Browser-compatible ID generation

The library no longer imports from `node:crypto`. All entity ID generation now uses a pluggable `generateId` option, defaulting to `globalThis.crypto.randomUUID()` which works in Node.js 20+ and all modern browsers.

Pass a custom `generateId` function through `TLogicEngineOptions`, `TPropositCoreConfig`, or `TParserBuildOptions` to control how entity IDs are generated.
