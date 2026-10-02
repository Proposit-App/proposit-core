# Spec: give citation dates a calendar-date type with precision, separate from instants

Line numbers are against `56628266` on `feat/response-arguments`. The request is `initial-request.md`. Its answers are the requester's provisional answers on the maintainer's behalf, and the maintainer confirms them with this spec.

## Does this need a major version on its own?

**Yes.** Fifteen existing reference fields change their type from `Date` to a calendar-date string (Design, "Which fields change"). Consumer code that builds or reads those fields stops compiling. Stored data that holds an instant in one of them stops validating until it is converted. Shipped outside a major release, this would be 7.0.0. "Rejected: an additive version" explains why no non-breaking form is worth having.

## Capability changes

The capability ledger is empty (`tcw capabilities list` prints nothing), so no ledger record changes. The taxonomy gains:

- **Vocabulary:** **calendar date**: a day, month or year as written, with no time of day or zone, at a stated precision. Child of `reference`.
- **Changed feature:** `ieee-citation-formatting`. Its description gains "rendering calendar dates at their precision, and instants in a caller-supplied time zone".

## Problem

- Every citation date is an `EncodableDate` (`src/lib/schemata/shared.ts:32-50`), which decodes to a JavaScript `Date`: an instant, one moment in time. `EncodableDate` reads a day such as "1787-11-22" as midnight UTC of that day.
- Since 5.4.2 the IEEE formatter reads every date back by its UTC calendar day (`src/extensions/citations/ieee/segment-builder.ts:24-33`). Historical dates therefore render the same day in every zone. No single stored time of day could do that, because some zones were more than 12 hours from UTC in 1787 (`docs/work/completed/2026-09-30-ieee-citation-dates-render-a-day-off-outside-utc/intake.md:18-22`).
- Two problems remain:
  - **A true instant renders the wrong day for most readers.** An access date stamped when a citation is saved in Los Angeles in the evening is the next day in UTC, and renders as that day.
  - **A date always renders as a full day.** `formatDate` has one output, "Mon. D, YYYY". A source known only to its year or month cannot be written without inventing a day, and the invented day is then printed.
- The request's "noon UTC" convention is a mistake carried over from the intake. The convention since 5.4.2 is midnight UTC (`segment-builder.ts:24`, `docs/release-notes/v5.4.2.md:50`). This spec uses midnight UTC.

## Goals

1. **A calendar date is a value of its own:** a year, a year and month, or a full day, with no time or zone. It renders exactly as written, at its precision, in every time zone.
2. **An instant renders in a time zone the caller supplies,** defaulting to UTC, so a consumer can show a reader their own day.
3. **Each reference date field is one kind or the other,** as the requester decided: access dates are instants, every other reference date is a calendar date.
4. **The encoded form round-trips exactly** through `snapshot()`, JSON and decoding, precision included.
5. **Consumers can convert what they already store,** by a stated rule and a provided helper.

## Non-goals

- **Uncertainty and alternatives** ("1755?", "1755 or 1757", EDTF qualifiers). They wait for a later item. The encoding is chosen so that adding them is additive (Design, "Encoding").
- **Dates before year 0 or after 9999.** The four-digit year matches the existing `year` fields (`references.ts:163`, pattern `^\d{4}$`).
- **The 15 `year` string fields** on Book, JournalArticle and the others (list below). They already hold a year as written, so they have no time-zone problem. Whether they should become calendar dates, which would allow a month (IEEE prints "Nov. 1787" for journals and magazines), is an open question in Notes, not part of this change.
- **A migration run by core.** Consumers convert their own data (Design, "Converting stored data").
- **Any other citation style, and other places `EncodableDate` is used.** The CLI's `createdAt` and `publishedAt` (`src/cli/schemata.ts:25-27`) are real instants and stay as they are.

## Design

### The calendar date

- **Encoding.** A calendar date is an ISO 8601 calendar string at one of three precisions:
  - `"1787"`: a year;
  - `"1787-11"`: a year and month;
  - `"1787-11-22"`: a day.
- **Why a string, and this one.**
  - It is plain JSON, so it needs no codec. It encodes, hashes and round-trips as itself, with no `Date` and no zone.
  - Its precision is its length, so it cannot be lost.
  - It is the format SQL `DATE` and `Temporal.PlainDate` use for days, and the level-0 form of the Library of Congress Extended Date/Time Format (EDTF). EDTF's uncertainty marks (`"1755?"`, `"1787-11~"`) and alternatives (`"[1755,1757]"`) extend this same string, so the deferred work adds accepted forms without changing these.
  - CSL-JSON `date-parts` (`[[1787, 11, 22]]`) was weighed. It is an array of arrays, it cannot carry EDTF's marks without a parallel field, and it reads worse when stored.
- **Schema.** `CalendarDate` in `src/lib/schemata/shared.ts`, next to `EncodableDate`. It is a TypeBox string with the pattern `^\d{4}(-\d{2}(-\d{2})?)?$`, refined so that the month is 01-12 and the day exists in that month and year (leap years included). The static type is `string`.
  - **The validity check must be a refinement, not only the pattern.** The relaxed reference schemas strip `pattern` but keep TypeBox's non-enumerable refinements (`src/extensions/citations/ieee/relaxed.ts:47-90`). So a relaxed schema still rejects "1787-13" and "1787-02-30". A pattern alone would let them through.
- **Helpers,** exported from the root with the schema:
  - `parseCalendarDate(value): { year, month?, day?, precision: "year" | "month" | "day" }`. Throws on an invalid value.
  - `calendarDateFromInstant(date: Date, precision = "day"): string`: the instant's UTC calendar day, cut to the requested precision.

### Which fields change

Calendar date (15 fields), in `src/extensions/citations/ieee/references.ts`:

| Line | Type | Field |
|---|---|---|
| 349 | Standard | `date` |
| 406 | Patent | `date` |
| 552 | NewspaperArticle | `date` |
| 585 | ConferencePaper | `date` |
| 618 | ConferenceProceedings | `date` |
| 756 | Blog | `date` |
| 806 | SocialMedia | `postDate` |
| 868 | Video | `releaseDate` (optional) |
| 959 | Presentation | `date` |
| 973 | Interview | `date` |
| 983 | PersonalCommunication | `date` |
| 996 | Email | `date` |
| 1016 | Law | `dateEnacted` |
| 1033 | CourtCase | `date` |
| 1049 | GovernmentPublication | `date` |

Instants, unchanged as `EncodableDate` (6 fields): `accessedDate` on Website (`:210`), OnlineDocument (`:736`), Blog (`:762`), SocialMedia (`:812`, optional), Video (`:878`) and Podcast (`:909`).

Email `date` and SocialMedia `postDate` are moments a system recorded, like an access date. They are listed as calendar dates, as the requester's answer names posting dates, and are open questions in Notes.

Every other field keeps its schema. The 15 types that hold `year: Type.String({ pattern: "^\\d{4}$" })` are unchanged: Book, BookChapter, Handbook, TechnicalReport, Thesis, Dictionary, Encyclopedia, JournalArticle, MagazineArticle, Dataset, Software, Preprint, Course, Datasheet and ProductManual. Course has no date field besides `year`.

### Rendering

- **A calendar date** renders at its precision with the existing IEEE month abbreviations (`segment-builder.ts:9-22`):
  - `"1787"` → "1787";
  - `"1787-11"` → "Nov. 1787";
  - `"1787-11-22"` → "Nov. 22, 1787".

  No `Date` is built, so the result is the same in every time zone, and in every process zone. The new public formatter is `formatCalendarDate(value: string): string`, beside `formatDate`.
- **An instant** renders as its calendar day in a time zone, as "Mon. D, YYYY":
  - `formatCitationParts(ref, options?)` gains `options.timeZone`, an IANA zone name, defaulting to `"UTC"`.
  - `formatDate(d, timeZone = "UTC")` gains the same optional parameter.
  - The day is read with `Intl.DateTimeFormat` in that zone. An unknown zone name throws the `RangeError` that `Intl` throws.
  - **Default output is unchanged:** with no zone given, every instant renders exactly as it does in 5.4.3.
- **Templates.** A new segment source kind, `calendarDate` (beside `date`, `templates/instruction-types.ts:11`), and a fragment `calendarDateField(field, role)` (beside `dateField`, `templates/fragments.ts:46-50`). Every template use of a changed field switches to it. The segment roles (`date`, `accessedDate`) are unchanged.

### Converting stored data

A consumer whose stored or fixture data holds an instant in one of the 15 fields converts it before loading with 6.0.0:

- **The rule:** the new value is the instant's UTC calendar day, at day precision. For example, "1787-11-22T00:00:00.000Z" → "1787-11-22". Data written under the convention since 5.4.2, a day stored as midnight UTC, maps to exactly the day it meant.
- `calendarDateFromInstant` applies the rule.
- **Core does not convert on load.** `CalendarDate` rejects an instant-shaped string with a validation error naming the field. Accepting both forms would leave every reader of the field handling two types, which is the thing this change removes.
- **Checksums.** Default checksums do not include reference data (`src/lib/checksum-config.ts:49`, `:65`), so they are unchanged. A consumer whose checksum configuration adds `citation` (claims) or `reference` (origin documents) gets new checksums for converted entities, and must re-hash before loading with strict checksum verification. The release notes say this.

### Rejected: an additive version

- A non-breaking form would add new optional calendar-date fields beside the 15 `Date` fields, or widen each to `Date | string`.
- The first leaves two fields for one date on 15 types, with the old one never removable short of a major release.
- The second still breaks every consumer that reads the field as a `Date`, so it is not non-breaking at all.
- Since 6.0.0 is a major release, the breaking form costs nothing extra there.

## Acceptance criteria

Test files: `test/core/calendar-date.test.ts` (new), `test/extensions/citations/ieee-date-time-zones.test.ts`, `test/extensions/citations/ieee.test.ts`.

1. **Schema.** `CalendarDate` accepts "1787", "1787-11", "1787-11-22" and "2024-02-29". It rejects:
   - "1787-13", "1787-00", "1787-02-30", "2023-02-29";
   - "87", "1787-1", "1787-11-22T00:00:00.000Z";
   - a `Date`, and a number.
2. **Relaxed schemas keep the check.** `RelaxedNewspaperArticleReferenceSchema` rejects a `date` of "1787-02-30" through `Value.Check`.
3. **Round trip.** A NewspaperArticle with `date: "1787-11"` keeps that value, unchanged, through `ClaimLibrary` `snapshot()` → `JSON.stringify` → `JSON.parse` → `fromSnapshot`.
4. **Rendering by precision.** The date segment of a NewspaperArticle renders "1787", "Nov. 1787" and "Nov. 22, 1787" for the three precisions. `formatCalendarDate` gives the same three. Each is checked with the process zone set to UTC, America/Los_Angeles, Pacific/Auckland, Asia/Manila and America/Sitka, using the existing test file's zone harness (`ieee-date-time-zones.test.ts:34-42`).
5. **Instants in a zone.**
   - An access date of `new Date("2026-07-30T03:00:00Z")` renders "Jul. 30, 2026" with no zone, and with `timeZone: "UTC"`.
   - It renders "Jul. 29, 2026" with `timeZone: "America/Los_Angeles"`.
   - `timeZone: "Not/AZone"` throws a `RangeError`.
6. **Default unchanged.** Every existing assertion on `accessedDate` output in `ieee.test.ts` passes without a zone argument.
7. **Fields.**
   - Each of the 15 fields in the table accepts a calendar string and rejects a `Date`.
   - Each of the 6 `accessedDate` fields still accepts a `Date` and rejects a calendar string.
   - Checked over every type with a date field.
8. **Conversion.**
   - `calendarDateFromInstant(new Date("1787-11-22T00:00:00.000Z"))` is "1787-11-22", in every zone of criterion 4.
   - With precision "month" it is "1787-11"; with "year", "1787".
9. **Parsing.**
   - `parseCalendarDate("1787-11")` is `{ year: 1787, month: 11, precision: "month" }`.
   - It throws on "1787-13".
10. **Public surface.**
    - `docs/api-surface.txt` gains `CalendarDate`, `parseCalendarDate`, `calendarDateFromInstant`, `formatCalendarDate`, the `formatDate` and `formatCitationParts` options, and the `calendarDate` source kind.
    - Each of the 15 changed fields' static types changes from `Date` to `string`. Nothing else is lost.
    - `pnpm run check` passes.
11. **Documentation:**
    - the release notes' Breaking and Migrating sections, with the conversion rule and the checksum note;
    - the changelog;
    - `docs/api-reference.md`: a citation-dates section, since none exists today;
    - `README.md`'s IEEE paragraph (`:270`);
    - `skills/proposit-core`, where citations are described.

## Risks

- **Every fixture with a `Date` in a changed field breaks.** `ieee.test.ts` has 27 `new Date(` fixtures, and `ieee-origin-document.test.ts:19` has one more, though that one is an `accessedDate` and stays. The plan has to find all of them, and the breaks are compile errors, not silent.
- **`Intl` time-zone data.** Node ships full ICU by default, so IANA zones resolve. A runtime built with small ICU would reject zones other than UTC; the default stays UTC, so default output is unaffected.
- **Consumers' checksum configurations.** Covered above; the risk is only for consumers who hash reference data.
- **Interaction with the other 6.0.0 changes.** None in code: the response and carrying work touches no citation code.

## Notes

### Open questions for the maintainer

1. **Email `date` and SocialMedia `postDate`.** Both are moments a system recorded. This spec makes them calendar dates, following the answer that names posting dates. Should either be an instant, rendered in the reader's zone like an access date?
2. **The 15 `year` fields.** Should they become calendar dates, so that a journal or magazine article can give a month ("Nov. 1787"), as IEEE's own examples do? Doing so is breaking (a field rename or type change on 15 types), so it should either join this change in 6.0.0 or wait for the next major.
3. **Confirm the provisional answers** in `initial-request.md`, with the convention corrected from noon UTC to midnight UTC.

### Sweep for sibling defects

The sweep covered every use of `EncodableDate` in the repository (`src/lib/schemata/shared.ts`, `src/cli/schemata.ts`, `src/extensions/citations/ieee/references.ts`) and every caller of `formatDate` (`segment-builder.ts:70`; the re-export at `formatting.ts:14`). No other formatter renders a stored date, and the `unparsed` extension holds no dates.
