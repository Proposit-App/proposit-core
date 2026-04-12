# Changelog

## Bug Fixes

- `orderChangeset` now emits expression updates (reparent phase) before expression deletes to prevent `ON DELETE CASCADE` from destroying reparented children whose old parent is being removed (`src/lib/utils/changeset.ts`)
- `orderChangeset` now skips modified expressions whose IDs also appear in the removed set, eliminating no-op updates on rows about to be deleted (`src/lib/utils/changeset.ts`)
- Added 2 tests covering cascade-safe reparent ordering and modified/removed deduplication (`test/core.test.ts`)
