# Refined outcome: citation dates that came through JSON crash the IEEE formatter

## Decision

**Accepted** on 2026-10-02 by the requester, on the maintainer's behalf: the requester set acceptance on a verifier finding no defect, and it found none. Logged for the maintainer. Rides 6.0.0; the consumer is not affected, since it decodes dates before formatting, so no patch release.

## Evidence

- A read-only verify assessment met all three acceptance points. It found the decode rule identical to `EncodableDate`'s, and that absent optional date fields still format without throwing. It confirmed the September finding against IEEE's current guide (version "V 3.28.2025"). It found no defect.
- Its gaps were fixed before acceptance (`outcome.md`):
  - a rejection test that passed without the fix;
  - the two optional date fields missing from the round trip;
  - an invalid `Date` reported as `null`;
  - two overstated claims.
- `pnpm run check` passes: 2760 tests passed, 13 skipped.

## The month abbreviations

There is no change. IEEE's current Reference Guide writes "Sep.", "Jun." and "Jul.", which is exactly what `IEEE_MONTHS` prints.

## Capability ledger and taxonomy

The ledger is empty, and the taxonomy is unchanged.

## Closeout

Resolution `done`. To be merged into `feat/response-arguments` for 6.0.0; not pushed or published by this session.

## Changed before release (2026-10-02)

The widening of `formatDate` to `Date | string` was reverted before 6.0.0 shipped. The requester decided it on the maintainer's behalf, after the combined 6.0.0 review. Calendar dates made 15 date fields strings, and the widened parameter let a 5.x call such as `formatDate(article.date)` keep compiling. It then read a calendar date as an instant and printed an invented day: "1787" became "Jan. 1, 1787".

`formatDate` takes a `Date` only again, and throws a `TypeError` for anything else. The fix this item made still holds for the access dates it now covers: the `date` source kind reads an ISO string itself before formatting. The changelog and release-note entries were narrowed to access dates to match.
