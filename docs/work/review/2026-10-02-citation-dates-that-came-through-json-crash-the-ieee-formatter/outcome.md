# Outcome: citation dates that came through JSON crash the IEEE formatter

Branch `fix/decode-citation-dates-when-formatting`, off `main` at 5.4.3. It rides 6.0.0 (the requester's decision); nothing in it breaks anything, so it could equally ship as a patch.

## What shipped

- `3b3a09b6`: `formatDate` takes `Date | string` and reads a string the way `EncodableDate` decodes one. The `date` source kind does the same and, for a value that is not a date, throws a `TypeError` naming the field. Tests, each red first with the reported `TypeError`:
  - all 33 reference types, JSON round-tripped, format exactly as the originals (the fixtures were moved into a shared `oneOfEachType()` for this; the existing all-types test uses it unchanged);
  - `formatDate` on the ISO string, in each of the five zones of the zone suite;
  - a non-date in `accessedDate` names the field; `formatDate` rejects a non-date.
- Changelog and release notes under Fixed.

`pnpm run check` passes: 2759 tests passed, 13 skipped.

## The September abbreviation: no change

IEEE's current "Reference Guide" (https://journals.ieeeauthorcenter.ieee.org/wp-content/uploads/sites/7/IEEE_Reference_Guide.pdf, which now redirects to the Google Doc "IEEE Reference Style Guide for Authors", read 2026-10-02) writes "Sep." in all five of its examples, and "Jun." and "Jul." (for example "Jul./Aug."); it never writes "Sept.", "June" or "July". That is exactly what `IEEE_MONTHS` prints. The "Sept." / "June" / "July" forms some library guides give come from the 2016 IEEE Editorial Style Manual, which the current guide supersedes.

## What went differently from the request

- The item was started after the code was written, not before: the fix was made on its own branch first and the item's records written afterwards. Nothing else about the work changed.
- No spec or plan: the request's three acceptance points were small enough to test directly.

## Merging note

`docs/changelogs/upcoming.md` and `docs/release-notes/upcoming.md` are new on this branch, as on the two 6.0.0 branches, so combining them needs those files merged by hand.
