# Spec: give citation dates a calendar-date type with precision

Line numbers are against `4abd8a10` on `feat/response-arguments`. The request is `initial-request.md`.

**Status of the decisions in this spec.**

- The requester's answers in `initial-request.md` are provisional, given on the maintainer's behalf. The maintainer confirms them with this spec.
- One adversarial review round was run on the first draft (2026-10-02). This is the revision that followed it; no further round was run.
- The review showed that rendering access dates in a reader's time zone misreads data stored as the 5.4.2 release notes advised ("Out of scope: access dates"). On that, **the requester chose, on the maintainer's behalf, to leave access dates exactly as they are in this change.** The maintainer may choose differently, and either of the two later options described there can be added without breaking anything.

## Does this need a major version on its own?

**Yes.** Fifteen existing reference fields change their type from `Date` to a calendar-date string (Design, "Which fields change"):

- Consumer code that builds or reads those fields stops compiling.
- Stored data that holds an instant in one of them no longer passes the IEEE schema until it is converted.

Shipped outside a major release, this would be 7.0.0. Inside 6.0.0, which is already a major release, it costs nothing extra. "Additive alternatives" describes the non-breaking route, and why it is a fallback rather than the plan.

## Capability changes

The capability ledger is empty (`tcw capabilities list` prints nothing), so no ledger record changes. The taxonomy gains:

- **Vocabulary:** **calendar date**: a day, month or year as written, with no time of day or zone, at a stated precision. Child of `reference`.
- **Changed feature:** `ieee-citation-formatting`. Its description gains "rendering calendar dates at their precision".

## Problem

- Every citation date is an `EncodableDate` (`src/lib/schemata/shared.ts:32-50`), which decodes to a JavaScript `Date`: an instant, one moment in time. `EncodableDate` reads a day such as "1787-11-22" as midnight UTC of that day.
- Since 5.4.2 the IEEE formatter reads every date back by its UTC calendar day (`src/extensions/citations/ieee/segment-builder.ts:24-33`). Historical dates therefore render the same day in every zone. No single stored time of day could do that, because some zones were more than 12 hours from UTC in 1787 (`docs/work/completed/2026-09-30-ieee-citation-dates-render-a-day-off-outside-utc/intake.md:18-22`).
- What remains:
  - **A date always renders as a full day.** `formatDate` has one output, "Mon. D, YYYY". A source known only to its year or month cannot be written without inventing a day, and the invented day is then printed.
  - **A day is stored as a moment.** A publication date is a day as printed on the source, not a moment. Storing it as midnight UTC works only because every reader of it agrees to read it back in UTC, and nothing in the type says so.
  - **An access date shows the UTC day,** not the day the person citing saw it. This change does not address it ("Out of scope: access dates").
- The request's "noon UTC" convention is a mistake carried over from the intake. The convention since 5.4.2 is midnight UTC (`segment-builder.ts:24`, `docs/release-notes/v5.4.2.md:50`). This spec uses midnight UTC.

## Goals

1. **A calendar date is a value of its own:** a year, a year and month, or a full day, with no time or zone. It renders exactly as written, at its precision, in every time zone.
2. **Every reference date other than an access date is a calendar date.**
3. **The encoded form round-trips exactly** through `snapshot()`, JSON and decoding, precision included.
4. **Consumers can convert what they already store,** by a stated rule and a provided helper, including data written before 5.4.2.
5. **A value that is not a valid calendar date fails at formatting with an error naming the field,** since core does not check citations when it loads them.

## Non-goals

- **Uncertainty and alternatives** ("1755?", "1755 or 1757", EDTF qualifiers). They wait for a later item. The encoding is chosen so that adding them is additive (Design, "Encoding").
- **Dates before year 0000 or after 9999.** The four-digit year matches the existing `year` fields (`references.ts:163`, pattern `^\d{4}$`).
- **The 15 `year` string fields** on Book, JournalArticle and the others. They are question (b) for the maintainer (Notes).
- **A migration run by core.** Consumers convert their own data (Design, "Converting stored data").
- **Any other citation style, and other places `EncodableDate` is used.** The CLI's `createdAt` and `publishedAt` (`src/cli/schemata.ts:25-27`) are real instants and stay as they are.

### Out of scope: access dates

The six `accessedDate` fields stay `EncodableDate`, rendered by their UTC day exactly as today. There is no display time-zone option. The first draft had one; it was dropped for this reason:

> The 5.4.2 release notes (`docs/release-notes/v5.4.2.md:49-53`) told consumers to store every citation date, access dates included, as midnight UTC of the day they mean, and the fixtures do the same (`test/extensions/citations/ieee.test.ts`, `accessedDate: new Date(Date.UTC(2026, 8, 1))`). Rendering such a value in a zone west of UTC prints the day before, for every access date already stored. Even for a true moment, rendering in each reader's zone makes one citation show different access days to different readers, and a server rendering in UTC disagree with a browser rendering in local time, which is the defect 5.4.2 fixed. The intake's example has the person saving and the person reading as the same Los Angeles user; that is the only case where the reader's zone gives the right answer.

Either of these can be added later without breaking anything, if the maintainer wants it:

- **(i) An access date becomes a calendar date,** captured in the saver's zone at the moment of saving (for example `calendarDateFromInstant(new Date(), "day", "America/Los_Angeles")`). The citation then prints the day the person citing saw the source, for every reader. This is the IEEE meaning of "Accessed:". It changes the six fields' type, so it is itself breaking if done after 6.0.0; done in 6.0.0, it is one more row in the table below.
- **(ii) An access date stays a moment, rendered in a zone the caller passes.** The formatter gains a `timeZone` option applying to access dates only. The release notes would have to say that values stored as midnight UTC shift a day west of UTC, and which zone each kind of caller should pass. Additive at any time.

## Design

### The calendar date

- **Encoding.** A calendar date is an ISO 8601 calendar string at one of three precisions:
  - `"1787"`: a year;
  - `"1787-11"`: a year and month;
  - `"1787-11-22"`: a day.
- **Why a string, and this one.**
  - It is plain JSON, so it needs no codec. It encodes, hashes and round-trips as itself, with no `Date` and no zone. (`canonicalSerialize`, `src/lib/core/checksum.ts:16-29`, is `JSON.stringify` with sorted keys, so a string hashes as itself.)
  - Its precision is its length, so it cannot be lost.
  - It is the format SQL `DATE` and `Temporal.PlainDate` use for days, and the level-0 form of the Library of Congress Extended Date/Time Format (EDTF). EDTF's uncertainty marks (`"1755?"`, `"1787-11~"`) and alternatives (`"[1755,1757]"`) extend this same string, so the deferred work adds accepted forms without changing these.
  - CSL-JSON `date-parts` (`[[1787, 11, 22]]`) was weighed. It is an array of arrays, it cannot carry EDTF's marks without a parallel field, and it reads worse when stored.
- **Schema.** `CalendarDate` in `src/lib/schemata/shared.ts`, next to `EncodableDate`, exported from the package root. It lives in `src/lib` rather than the citations extension because a calendar date is a general concept with no citation-specific meaning, like `EncodableDate` beside it.
  - It is a TypeBox string with the pattern `^\d{4}(-\d{2}(-\d{2})?)?$`, plus a refinement. The static type is `string`.
  - **The refinement checks the whole value itself,** not only the month and day: the shape (four-digit year, optional two-digit month, optional two-digit day), the month 01-12, and that the day exists in that month and year, leap years included. The relaxed reference schemas strip `pattern` but keep TypeBox's non-enumerable refinements (`src/extensions/citations/ieee/relaxed.ts:79-90`), so the refinement is the only check a relaxed schema makes. A refinement that relied on the pattern for the shape would let "87" and "hello" through every relaxed schema. (The review confirmed against TypeBox 1.3.8 that a `Type.Refine` survives the relaxed copy.)
  - **Leap years are computed by arithmetic, never with `Date.UTC`,** which maps years 0-99 to 1900-1999 and so misjudges "0000-02-29".
- **Helpers,** exported from the root with the schema:
  - `parseCalendarDate(value: string): { year: number; month?: number; day?: number; precision: "year" | "month" | "day" }`. Throws a `TypeError` naming the value if it is not a valid calendar date.
  - `formatCalendarDate(value: string): string` in the IEEE extension, beside `formatDate` (see Rendering).
  - `calendarDateFromInstant(value: Date | string, precision: "year" | "month" | "day" = "day", timeZone = "UTC"): string`. It takes a `Date`, or the ISO string a stored `Date` comes back from JSON as, and gives its calendar day in `timeZone`, cut to `precision`. Its rules:
    - a year below 1000 is zero-padded ("0950");
    - a year outside 0000-9999 throws a `RangeError`;
    - an invalid `Date` or unparseable string throws a `TypeError`;
    - an unknown zone throws the `RangeError` that `Intl.DateTimeFormat` throws;
    - with `timeZone` left at "UTC" it uses the UTC getters, so no time-zone data is involved.

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

Unchanged, as `EncodableDate` (6 fields): `accessedDate` on Website (`:210`), OnlineDocument (`:736`), Blog (`:762`), SocialMedia (`:812`, optional), Video (`:878`) and Podcast (`:909`).

Email `date` and SocialMedia `postDate` are question (a) for the maintainer (Notes). This spec makes them calendar dates, following the requester's answer that names posting dates.

Every other field keeps its schema, including the 15 `year: Type.String({ pattern: "^\\d{4}$" })` fields (Book, BookChapter, Handbook, TechnicalReport, Thesis, Dictionary, Encyclopedia, JournalArticle, MagazineArticle, Dataset, Software, Preprint, Course, Datasheet, ProductManual).

### Rendering

- **A calendar date** renders at its precision with the existing IEEE month abbreviations (`segment-builder.ts:9-22`):
  - `"1787"` → "1787";
  - `"1787-11"` → "Nov. 1787";
  - `"1787-11-22"` → "Nov. 22, 1787".

  No `Date` is built, so the process time zone cannot affect the result. The abbreviations are those of IEEE's current Reference Guide, which writes "Sep.", "Jun." and "Jul." (checked 2026-10-02).
- **Templates.** A new segment source kind, `calendarDate` (beside `date`, `templates/instruction-types.ts:11`), and a fragment `calendarDateField(field, role)` (beside `dateField`, `templates/fragments.ts:46-50`). Every template use of a changed field switches to it. The segment roles (`date`, `accessedDate`) are unchanged.
- **Access dates render exactly as today,** through the `date` source kind.
- **A value that is not a valid calendar date.** Core never checks a citation against the IEEE schema when it loads one: `ClaimLibrary` validates claims against `CoreClaimSchema`, which allows extra properties, and `OriginLibrary.fromSnapshot` checks only `CoreOriginDocumentSchema` (`src/lib/core/origin-library.ts:529`). So an unconverted value (a `Date`, or an ISO instant string) reaches the formatter. The `calendarDate` source kind then throws a `TypeError` naming the field and the value, for example `Citation field "date" is not a calendar date: "1787-11-22T00:00:00.000Z"`. `formatCalendarDate` throws the same kind of error, without the field. This matches the `date` source kind's error for a non-date (the fix on `fix/decode-citation-dates-when-formatting`).

### Converting stored data

A consumer whose stored or fixture data holds an instant in one of the 15 fields converts it before formatting with 6.0.0:

- **The rule:** the new value is the stored instant's calendar day, at day precision, read in UTC unless the consumer knows the zone the value was written in. For example "1787-11-22T00:00:00.000Z" → "1787-11-22". `calendarDateFromInstant` applies it.
- **What the UTC rule gives.** For data written as 5.4.2 advised (midnight UTC of the day meant), it gives exactly that day. For older data it gives the day that has been *displayed* since 5.4.2, which is not always the day *meant*: before 5.4.2 the formatter used local-time getters, so a consumer east of UTC who built dates with `new Date(y, m, d)` stored local midnight, which is the previous UTC day. Such a consumer passes the zone the data was written in (`calendarDateFromInstant(value, "day", "Europe/Berlin")`) to recover the day meant. Conversion is the last moment that error can be corrected; after it, the day is stored as written. Real timestamps in Email `date` and SocialMedia `postDate` likewise convert to the day in whichever zone is passed.
- **Where unconverted data is caught.** Only by the consumer's own `Value.Check` or `Value.Parse` with an IEEE schema, or at formatting (Rendering). Core does not convert on load or check citations on load.
- **Checksums.** Default checksums do not include reference data (`src/lib/checksum-config.ts:49`, `:65`), so they are unchanged. A consumer whose checksum configuration adds `citation` (claims) or `reference` (origin documents) and converts stored data gets different checksums for those entities. Nothing in core checks claim or origin-document checksums on load (strict checksum verification exists only in `ArgumentEngine.fromSnapshot`, `src/lib/core/argument-engine.ts:1952`, `:2096`, and covers arguments, premises, expressions and variables). So the consequence is a stale stored checksum, not a load failure; such a consumer recomputes it when converting. The release notes say this.

### Additive alternatives

A non-breaking route exists for each half of the problem, and is the fallback if this misses 6.0.0:

- **Precision:** an optional sibling field, `datePrecision?: "year" | "month" | "day"`, which cuts the existing midnight-UTC `Date` to that precision when formatting. Nothing is stored twice.
- **Widening each field to `Date | string`** is not non-breaking: every consumer reading the field as a `Date` breaks.

Inside 6.0.0 the breaking design is better: a day is stored as a day, with nothing to agree on about how to read it back.

## Acceptance criteria

Test files: `test/core/calendar-date.test.ts` (new), `test/extensions/citations/ieee-date-time-zones.test.ts`, `test/extensions/citations/ieee.test.ts`, and a type-level test file `test/extensions/citations/ieee-date-types.test.ts` (new).

1. **Schema.** `CalendarDate` accepts "1787", "1787-11", "1787-11-22", "2024-02-29" and "0000-02-29". It rejects:
   - "1787-13", "1787-00", "1787-02-30", "2023-02-29", "1900-02-29";
   - "87", "1787-1", "hello", "1787-11-22T00:00:00.000Z";
   - a `Date`, and a number.
2. **Relaxed schemas keep the whole check.** `RelaxedNewspaperArticleReferenceSchema` rejects, through `Value.Check`, a `date` of "1787-02-30", "87", and "1787-11-22T00:00:00.000Z".
3. **Round trip.** A NewspaperArticle with `date: "1787-11"` keeps that value, unchanged, through `ClaimLibrary` `snapshot()` → `JSON.stringify` → `JSON.parse` → `fromSnapshot`, and through `Value.Decode` and `Value.Encode`.
4. **Rendering by precision.** Through `formatCitationParts`, the date segment of a NewspaperArticle renders "1787", "Nov. 1787" and "Nov. 22, 1787" for the three precisions; `formatCalendarDate` gives the same three. Each is run in the five zones of the existing zone harness (`ieee-date-time-zones.test.ts:14-48`). Since no `Date` is built, this guards against a future change that builds one; it is not a test that could have failed before.
5. **Both kinds in one reference.** Through `formatCitationParts`, a Blog with `date: "2026-07-30"` and `accessedDate: new Date("2026-07-30T03:00:00Z")` renders its date segment "Jul. 30, 2026" and its access segment "Jul. 30, 2026", in every zone of the harness.
6. **Access dates unchanged.** Every existing `accessedDate` assertion in `ieee.test.ts` and `ieee-origin-document.test.ts` passes unchanged.
7. **Fields.** Each of the 15 fields in the table accepts a calendar string and rejects a `Date` and an ISO instant string, through its strict schema. Each of the 6 `accessedDate` fields still accepts a `Date`.
8. **Unconverted data at formatting.** Through `formatCitationParts`, a NewspaperArticle whose `date` is a `Date`, and one whose `date` is "1787-11-22T00:00:00.000Z", each throw a `TypeError` whose message names the field `date`. `formatCalendarDate("1787-13")` throws a `TypeError`.
9. **Conversion.**
   - `calendarDateFromInstant(new Date("1787-11-22T00:00:00.000Z"))` is "1787-11-22" in every zone of the harness; with the ISO string instead of the `Date`, the same.
   - With precision "month" it is "1787-11"; with "year", "1787".
   - `calendarDateFromInstant(new Date("2024-06-14T23:00:00.000Z"), "day", "Europe/Berlin")` is "2024-06-15".
   - Year 950 gives "0950"; a year of 10000 throws a `RangeError`; an invalid `Date` throws a `TypeError`.
10. **Parsing.** `parseCalendarDate("1787-11")` is `{ year: 1787, month: 11, precision: "month" }`; it throws a `TypeError` on "1787-13".
11. **Types.** With `expectTypeOf`: each of the 15 fields' static type on its reference type is `string` (or `string | undefined` for `releaseDate`), and each `accessedDate` is still `Date`.
12. **Unaffected types.** The segments for ProductManual, Datasheet and Course from the "handles all 33 reference types" fixtures are unchanged (snapshot of their text before and after).
13. **Public surface.** `docs/api-surface.txt` gains the names `CalendarDate`, `parseCalendarDate`, `calendarDateFromInstant`, `formatCalendarDate` and `calendarDateField` and loses none. (It records names only; types are criterion 11's.) `pnpm run check` passes.
14. **Documentation:**
    - the release notes' Breaking and Migrating sections, with the conversion rule (including the zone for pre-5.4.2 data) and the checksum note;
    - the changelog;
    - `docs/api-reference.md`: a citation-dates section, since none exists today;
    - `README.md`'s IEEE paragraph (`:270`);
    - `skills/proposit-core`, where citations are described.

## Risks

- **Every fixture with a `Date` in a changed field breaks.** `ieee.test.ts` has 27 `new Date(` fixtures; the plan has to find those in the 15 fields. The breaks are compile errors, not silent.
- **`Intl` time-zone data,** used only by `calendarDateFromInstant` when a zone is passed. Node ships full ICU by default. The default path uses the UTC getters and needs none.
- **Consumers' checksum configurations.** Covered above; it affects only consumers who hash reference data.
- **Interaction with other 6.0.0 changes.** The response and carrying work touches no citation code. The date-formatting fix (`fix/decode-citation-dates-when-formatting`) changes the `date` source kind beside the new `calendarDate` one; whichever lands second takes the other's lines.

## Effort

Medium. The schema and helpers are small; most of the work is the 15 template uses, the fixtures in the 15 fields, the new tests (about 14 criteria), and the five documentation targets.

## Notes

### Questions for the maintainer

1. **Access dates.** This change leaves them as they are (the requester's choice on your behalf). Do you want (i) or (ii) from "Out of scope: access dates", and if (i), in 6.0.0?
2. **(a) Email `date` and SocialMedia `postDate`.** Both are moments a system recorded. Three options:
   - a calendar date as the source prints it, in the sender's zone, captured when the email or post is ingested (what an IEEE citation prints, and what this spec does);
   - a calendar date in some other agreed zone;
   - a moment, rendered like an access date (which inherits the access-date question).
3. **(b) The 15 `year` fields.** Should their schema become `CalendarDate`, so a journal or magazine article can give a month ("Nov. 1787"), as IEEE's own examples do? Keeping the name `year` and the static type `string`, every value the strict schema accepts today stays valid, so strict users and stored data are unaffected. It breaks two things:
   - code that reads `year` as exactly four digits;
   - users of the relaxed schemas, where `^\d{4}$` is stripped today and any string is accepted: the refinement would start rejecting values like "c. 1787".

   It is therefore still a breaking change, and has to ride a major release: 6.0.0, or the next one.
4. **Confirm the provisional answers** in `initial-request.md`, with the stored convention corrected from noon UTC to midnight UTC.

### Review record

The 2026-10-02 review round found three blocking problems and five significant ones in the first draft. All are addressed above:

- the access-date hazard: the requester's choice, and the out-of-scope section;
- an access-date criterion that could not be met (`EncodableDate` accepts "1787"): dropped;
- a claimed load-time check that core does not make: corrected, and formatting errors defined;
- the conversion rule for pre-5.4.2 data: the zone parameter;
- the checksum note: confirmed and corrected;
- an API-surface criterion that file cannot show: replaced by type-level tests;
- the framing of questions (a) and (b).

It also found that a JSON round-tripped citation crashes the formatter today. That is fixed separately, on `fix/decode-citation-dates-when-formatting`.

### Sweep for sibling defects

The sweep covered every use of `EncodableDate` in the repository (`src/lib/schemata/shared.ts`, `src/cli/schemata.ts`, `src/extensions/citations/ieee/references.ts`) and every caller of `formatDate` (`segment-builder.ts:70`; the re-export at `formatting.ts:14`). No other formatter renders a stored date, and the `unparsed` extension holds no dates. The JSON round-trip crash above is the one defect it found.
