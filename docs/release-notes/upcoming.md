# Release Notes

## Changed: Checksums no longer include entity IDs by default

- **Checksums no longer include entity IDs by default.** The `DEFAULT_CHECKSUM_CONFIG` now excludes each entity's own `id` field, making checksums content-based and predictable without knowing server-assigned IDs. All FK references (e.g., `parentId`, `variableId`, `claimId`) are still included. To restore the old behavior, pass a custom `checksumConfig` that includes `id` in the relevant field sets.

## New: Graph command

You can now visualize arguments as directed graphs using the new `graph` command. It outputs DOT (Graphviz) format that can be piped to `dot` to produce SVG or PNG images.

Use `--analysis <filename>` to overlay evaluation results — expression nodes are colored by truth value, making it easy to see how truth flows through the argument.
