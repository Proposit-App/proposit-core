# Release Notes

### Bug Fixes

- Fixed an issue where rebuilding an engine from stored data could produce different checksums on each rebuild when using granular auto-normalize configuration. This affected applications using checksum-based optimistic concurrency control.
- Fixed grammar config not being applied to all internal components when restoring from a snapshot with an explicit grammar config override.
