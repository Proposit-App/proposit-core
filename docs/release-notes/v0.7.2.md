# Release Notes

## Bug Fixes

- **Mutation changesets now include all expressions with updated checksums.** Previously, when adding an expression, only the new expression appeared in the changeset. Parent and ancestor expressions whose checksums changed as a result were silently omitted, causing downstream consumers (such as persistence layers) to store stale checksum values. This could lead to unexpected conflict errors on subsequent operations. All ancestor expressions with changed checksums are now correctly included in the changeset's `modified` list.
