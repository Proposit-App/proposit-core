# Refined outcome: checkLink reports no attempted support for a reply's links

## Decision

**Accepted** on 2026-10-03 by the requester, on the maintainer's behalf. Released as 6.0.1.

## Evidence

The consumer validated the 6.0.1 tarball (sha256 `1767e6ca62073e9cdafd970c526e17d369af4486f4021966e0defcc5db8f4e4b`):

- Its test that was waiting for this fix passes.
- Its full gate passes on its integration branch, including end-to-end tests: 262 passed, 0 failed.
- The code difference from 6.0.0 is `check.js` alone.

`pnpm run check` passes in this repository: 3326 passed, 15 skipped. The tarball rebuilt from main at `v6.0.1` is byte-identical to the validated one.

## Notes

The "Y affirms, Z contradicts" case passed before the fix here. The consumer confirmed it never had that case, so there was nothing to chase.

## Capability ledger and taxonomy

The ledger is empty, and the taxonomy is unchanged.

## Closeout

Resolution `done`. Merged to main and tagged `v6.0.1`. Pushing and publishing wait for the maintainer.
