# Outcome: give citation dates a calendar-date type with precision

Branch `feat/calendar-dates`, off `feat/response-arguments` (the 6.0.0 line). The maintainer decided on 2026-10-02 that it ships in 6.0.0.

## What shipped

| Task | Commit | What |
|---|---|---|
| 1 | `38d4166c` | Shared IEEE test fixtures (`test/extensions/citations/fixtures.ts`). The segments of every year-dated type's fixture are pinned from the code as it stood (`ieee-year-output.test.ts`, 15 snapshots, each read once against the guide before committing). |
| 2 | `e81f5a16` | `CalendarDate`, `calendarDateType`, `parseCalendarDate`, `calendarDateFromInstant`, `TCalendarDateParts` and `TCalendarDatePrecision` (`src/lib/schemata/calendar-date.ts`). 34 tests, red first. The leap-year cases were proved by weakening the rule to `% 4`, which turned "1900-02-29" red. |
| 3 | `b6a291c4` | `formatCalendarDate`, the `calendarDate` source kind, which throws a `TypeError` naming the field, and the fragments `calendarDateField` and `yearOrUndated`. Tests red first in the zone harness. |
| 4 | `642cbe86` | The 15 date fields become `CalendarDate`; their 15 template uses become `calendarDateField`; the fixtures move from `Date` to strings. New `ieee-calendar-dates.test.ts` and `ieee-date-types.test.ts`; 21 of the runtime tests and every type check were red first. |
| 5 | `05703616` | The 15 `year` fields become `Type.Optional(calendarDateType({ description }))`; the 15 template uses become `yearOrUndated()`. 111 new tests were red first. The pins from Task 1 pass unchanged. |
| 6 | `3bd353e5` | The API reference ("Citation dates"), changelog, release notes, README, SKILL.md, an `AGENTS.md` invariant, and the taxonomy (`reference/calendar-date`, and the `ieee-citation-formatting` description). |

`pnpm run check` passes at `3bd353e5`: 3267 tests passed, 15 skipped; after the fixes below, 3282 passed, 15 skipped.

## Acceptance criteria

1. **Met.** `test/core/calendar-date.test.ts` checks the accepted and refused values. It adds "1787-11-00", "", and Arabic-Indic digits to the refused list.
2. **Met.** `ieee-calendar-dates.test.ts`, "a relaxed schema still checks the whole calendar date".
3. **Met.** The same file's round-trip test covers `Value.Decode` and `Value.Encode`, and `ClaimLibrary` snapshot → JSON → `fromSnapshot`.
4. **Met** (after verification). Both `formatCitationParts` and `formatCalendarDate` are checked at each precision, in all five zones of the harness.
5. **Met** (after verification). A Blog with both kinds of date, in all five zones.
6. **Met.** Every existing `accessedDate` assertion is unchanged and passes.
7. **Met.** All 15 date fields, and all 6 access dates.
8. **Met.** A `Date` or an ISO instant throws a `TypeError` naming `date`, and `formatCalendarDate("1787-13")` throws.
9. **Met.** Conversion is checked in the five zones, at each precision, in Berlin and Los Angeles, with year 950 padded through both the UTC and the zone path, years out of range, invalid input and an unknown zone.
10. **Met.**
11. **Met.** `ieee-date-types.test.ts`.
12. **Met.** Task 1's snapshots pass unchanged after Task 5.
13. **Met.** Each of the 15 types accepts and refuses through the strict and relaxed schemas and keeps the description. The five IEEE examples render as the guide prints them, and "c. 1787" throws naming `year`.
14. **Met.** For all 15 types, the undated segments equal the dated ones with the year's text replaced by "(n.d.)", and an undated Datasheet's text contains ", (n.d.).".
15. **Met.** The surface gains `CalendarDate`, `calendarDateType`, `parseCalendarDate`, `calendarDateFromInstant`, `formatCalendarDate`, `TCalendarDateParts` and its properties, and `TCalendarDatePrecision`. It loses nothing.
16. **Met.** See Task 6.

## Verification the suite cannot do

- **Read against IEEE.** "Nature, Oct. 2011, doi: …", "Nature, Dec. 11, 2018, doi: …", "Rep. TR-1, Nov. 1988.", "MIT Press, 1964.", an undated Datasheet "i7-12700K, (n.d.). [Online]. Available: …", "Times, Nov. 1787." and "US Patent US1234567, 1787." all read as the guide's examples do.
- **Stored data.** No recorded pipeline fixture and no file in `examples/` holds a reference date or year, so there was nothing there to convert.

## What the plan or spec got wrong

- **The API surface was updated at each task, not only in Task 6.** `pnpm run check` includes the surface check, so each task that added public names had to update it to keep its commit green.
- **Task 2's relaxed-schema test belonged to Task 4.** It checks the NewspaperArticle relaxed schema, which still held `EncodableDate` until Task 4, and `new Date("87")` is a valid date. It moved to `ieee-calendar-dates.test.ts`.
- **Snapshots in a file, not inline.** Task 1 used `toMatchSnapshot`, and the snapshot file sits beside the test. The 15 segment lists are long, and inline snapshots would have buried the test.
- **The public surface also gains `TCalendarDateParts` and `TCalendarDatePrecision`.** Criterion 15 did not name them: they are the types of `parseCalendarDate`'s result and of `precision`.
- **`AGENTS.md` fired.** The plan's Documentation Sync block listed it under "does not fire" while giving the invariant it then added.
- **Eras in `Intl`.** `calendarDateFromInstant` with a zone reads the year through `Intl.DateTimeFormat`, which counts years by era. The code converts a BC year to ISO numbering before the range check. Nothing in the plan mentioned it.
- **A test-fixture mistake, caught in Task 4.** The round-trip test first created a claim without `type`, which `ClaimLibrary` refuses. The test was wrong, not the code.

## Notes

- `docs/changelogs/upcoming.md` and `docs/release-notes/upcoming.md` already exist on `feat/response-arguments`, so this branch's entries merge without the hand-merge the other branches needed.
- The year-placement item (`2026-10-02-place-the-year-where-ieee-does-for-datasets-courses-and-software`) is in the backlog. This change keeps each year segment where it was.

## Fixes after the verify assessment (2026-10-02)

The read-only verify assessment found no defects. It checked:
- every criterion, with criteria 4 and 5 partly met;
- the claims in this outcome;
- `CalendarDate` against edge cases, with the pattern and the refinement agreeing on all of them;
- `calendarDateFromInstant`: 60,027 comparisons between the zone and UTC paths, plus eras, year 9999 and changes to and from daylight saving time;
- the relaxed schemas;
- all 15 templates' output, dated, by month and undated.

Fixed:
- **Criteria 4 and 5:** `formatCitationParts` at each precision, and the Blog with both kinds of date, now run in all five zones of the harness. The precision cases fail against the old code, which read "1787" as a `Date`.
- **A stale comment** above `formatDate` called its input "a calendar date", which now names the string type; `formatDate` serves only instants. Rewritten.
- **An outdated comment in `relaxed.ts`**, older than this change, said the clone drops TypeBox's hidden internals. It keeps them, and this change relies on that. Rewritten.
- **The release notes:**
  - pre-5.4.2 data needs a zone only east of UTC;
  - the year rule now says applying it twice changes nothing, that markers match regardless of spaces, and gives the "[1787]" example;
  - `year: null` throws, for a storage layer that turns absent values into `null`.
- **This outcome's wording** for criteria 4, 5 and 14.

Left as is:
- **No Breaking heading in the release notes.** That file has used Added, Fixed and Migrating throughout 6.0.0, and the changelog carries the Breaking list.
- **A `Date`'s text in the error message** depends on the process time zone, through `describeValue`, which is older than this change.
