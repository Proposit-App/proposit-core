# Outcome: citation dates that came through JSON crash the IEEE formatter

Branch `fix/decode-citation-dates-when-formatting`, off `main` at 5.4.3. It rides 6.0.0 (the requester's decision). Its one behaviour change beyond the crash: an invalid `Date` used to print as "undefined NaN, NaN" and now throws, which the changelog states.

## What shipped

- `3b3a09b6`: `formatDate` takes `Date | string` and reads a string the way `EncodableDate` decodes one. The `date` source kind does the same and, for a value that is not a date, throws a `TypeError` naming the field. Tests, red first with the reported `TypeError` except where noted (corrected after verification):
  - all 33 reference types, JSON round-tripped, format exactly as the originals (the fixtures were moved into a shared `oneOfEachType()` for this; the existing all-types test uses it unchanged);
  - `formatDate` on the ISO string, in each of the five zones of the zone suite;
  - a non-date in `accessedDate` names the field (red first on the message match);
  - `formatDate` rejects a non-date. As first written this passed without the fix, since `"not a date".getUTCMonth` throws a `TypeError` too; verification caught it, and it now asserts the message, which fails against main.
- Changelog and release notes under Fixed.

`pnpm run check` passes: 2759 tests passed, 13 skipped.

## The September abbreviation: no change

IEEE's current "Reference Guide" (https://journals.ieeeauthorcenter.ieee.org/wp-content/uploads/sites/7/IEEE_Reference_Guide.pdf, which now redirects to the Google Doc "IEEE Reference Style Guide for Authors", read 2026-10-02) writes "Sep." in all five of its examples, and "Jun." and "Jul." (for example "Jul./Aug."); it never writes "Sept.", "June" or "July". That is exactly what `IEEE_MONTHS` prints. The "Sept." / "June" / "July" forms some library guides give come from the 2016 IEEE Editorial Style Manual, which the current guide supersedes.

## What went differently from the request

- The item was started after the code was written, not before: the fix was made on its own branch first and the item's records written afterwards. Nothing else about the work changed.
- No spec or plan: the request's three acceptance points were small enough to test directly.

## Merging note

`docs/changelogs/upcoming.md` and `docs/release-notes/upcoming.md` are new on this branch, as on the two 6.0.0 branches, so combining them needs those files merged by hand.

## Fixes after the verify assessment (2026-10-02)

The read-only verify assessment found no defects and confirmed all three acceptance points, the decode rule (identical to `EncodableDate`'s), absent optional fields formatting without throwing, and the September finding against IEEE's guide (version "V 3.28.2025"). Its gaps are fixed:

- the `formatDate` rejection test now asserts the message and fails against main;
- the round trip now covers the two optional date fields, `Video.releaseDate` and `SocialMedia.accessedDate`;
- an invalid `Date` is reported as "Invalid Date" rather than `null`, and a value `JSON.stringify` cannot write no longer loses the field name (test red first);
- the two overstated claims above are corrected.

Left as is: the decode logic is a copy of `toDate` in `src/lib/schemata/shared.ts` rather than shared, because sharing it would add `toDate` to the package's root exports through `schemata/index.ts`.
