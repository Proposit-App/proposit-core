# Release Notes

## Bug Fixes

- **Fixed incorrect checksums in mutation changesets.** When modifying expressions (e.g., wrapping, negating, inserting), the returned changeset previously contained stale checksum values for non-leaf expressions. Consumers that persisted changeset data to a database would get incorrect `combinedChecksum` and `descendantChecksum` values. Changeset expressions now have fully computed hierarchical checksums that match the engine's internal state.
