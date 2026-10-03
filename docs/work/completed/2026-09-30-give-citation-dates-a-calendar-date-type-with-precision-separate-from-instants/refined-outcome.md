# Refined outcome: give citation dates a calendar-date type with precision

## Decision

**Accepted** on 2026-10-02 by the requester, on the maintainer's behalf, under the maintainer's standing rule that the requester decides what is easy to change later. Logged for the maintainer. The scope is the maintainer's own decisions of 2026-10-02:
- it ships in 6.0.0;
- access dates are left as they are;
- Email and SocialMedia post dates are calendar dates;
- the 15 `year` fields become optional calendar dates, with "(n.d.)" for an undated source.

## Evidence

- A read-only verify assessment found no defects. It covered:
  - all 16 criteria;
  - `CalendarDate` edge cases, with the pattern and the refinement agreeing on every probe;
  - 60,027 comparisons between `calendarDateFromInstant`'s zone and UTC paths, with none disagreeing;
  - the relaxed schemas;
  - the output of all 15 templates.
- Its gaps were fixed before acceptance (`outcome.md`): zone coverage for criteria 4 and 5, two stale comments, and the release-note wording.
- `pnpm run check` passes at `94109cac`: 3282 tests passed, 15 skipped.

## Left as they are, by the requester's decision

- The release notes keep their Added, Fixed and Migrating headings. The changelog carries the Breaking list.
- The error text for a bad `Date` depends on the process time zone.

## Capability ledger and taxonomy

The ledger is empty. The taxonomy gained `reference/calendar-date`, and the `ieee-citation-formatting` description was updated.

## Follow-ups

- `2026-10-02-place-the-year-where-ieee-does-for-datasets-courses-and-software`: three templates place the year differently from IEEE.
- Uncertainty and two-month issues ("1787?", "Jul./Aug.") stay out of scope until a later item.
- Options (i) and (ii) for access dates stay open, per the spec.

## Closeout

Resolution `done`. Fast-forwarded into `feat/response-arguments` for 6.0.0. Not pushed or published by this session.
