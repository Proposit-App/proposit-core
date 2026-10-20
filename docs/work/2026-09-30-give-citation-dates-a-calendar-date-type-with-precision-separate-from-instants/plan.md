# Plan: give citation dates a calendar-date type with precision

Branch `feat/calendar-dates`, off `feat/response-arguments` (the 6.0.0 line). Run `pnpm run check` before each commit; every commit leaves it green. Each new test is run red before the code that makes it pass, and a test that is green on its first run is broken on purpose to prove it can fail.

Criteria numbers refer to `spec.md`.

## Task 1: pin today's year output

**Creates** `test/extensions/citations/ieee-year-output.test.ts`.

For each of the 15 year types, format its fixture from `oneOfEachType()` (`test/extensions/citations/ieee.test.ts`; move the function to a shared `test/extensions/citations/fixtures.ts` so both files use it) and pin the full segment list (text, role, style) with `toMatchInlineSnapshot`, generated from today's code.

**Proves:** criterion 12's baseline exists before anything changes. It must pass now and pass unchanged after Task 5.

## Task 2: the calendar date in `src/lib`

**Creates** `src/lib/schemata/calendar-date.ts` (exported through `src/lib/schemata/index.ts`, like `shared.ts`) and `test/core/calendar-date.test.ts`.

- `calendarDateType(options?: TSchemaOptions)` and `CalendarDate = calendarDateType()`: a TypeBox string with pattern `^\d{4}(-\d{2}(-\d{2})?)?$`, plus a `Type.Refine` that checks the whole value itself: shape, month 01-12, day in range for that month. Leap years are computed by arithmetic (`y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)`), never with `Date.UTC`.
- `parseCalendarDate(value: string)`: `{ year, month?, day?, precision }`, or a `TypeError` naming the value.
- `calendarDateFromInstant(value: Date | string, precision = "day", timeZone = "UTC")`. It uses the UTC getters when `timeZone` is "UTC", otherwise `Intl.DateTimeFormat` with `timeZone`. It zero-pads years below 1000; a year outside 0000-9999 gives a `RangeError`; an invalid input gives a `TypeError`.

**Proves:** criteria 1, 9 and 10. Also: the relaxed copy keeps the refinement, tested by running `calendarDateType()` through the relaxed schema module's stripping on a small object schema.

## Task 3: rendering a calendar date

**Modifies:**
- `src/extensions/citations/ieee/segment-builder.ts`: `formatCalendarDate`, and the `calendarDate` case in `resolveSource`, which throws a `TypeError` naming the field for anything `parseCalendarDate` refuses (a `Date`, an ISO instant, "c. 1787");
- `src/extensions/citations/ieee/formatting.ts`: re-export `formatCalendarDate`;
- `src/extensions/citations/ieee/templates/instruction-types.ts`: `kind` gains `"calendarDate"`;
- `src/extensions/citations/ieee/templates/fragments.ts`: `calendarDateField(field, role)`, and `yearOrUndated()`.

Nothing uses them yet.

**Proves:** `formatCalendarDate` at each precision, in the five zones of the zone harness (criterion 4's `formatCalendarDate` half), and its `TypeError` on "1787-13" (criterion 8's last sentence). The test file is `test/extensions/citations/ieee-date-time-zones.test.ts`.

## Task 4: switch the 15 date fields

**Modifies:**
- `src/extensions/citations/ieee/references.ts`: the 15 fields in the spec's table become `CalendarDate`; Video `releaseDate` becomes `Type.Optional(CalendarDate)`;
- the templates using them: `textual-sources.ts`, `periodicals.ts`, `conferences.ts`, `digital-sources.ts`, `multimedia.ts`, `personal.ts`, `legal.ts`. Each `dateField` use on one of those fields becomes `calendarDateField`. The `accessedOn()` fragment is untouched;
- `test/extensions/citations/ieee.test.ts`, `ieee-date-time-zones.test.ts` and the shared fixtures: every `Date` in one of the 15 fields becomes a calendar string. The fixture in `ieee-origin-document.test.ts` is an `accessedDate` and stays.

**Creates** `test/extensions/citations/ieee-date-types.test.ts` (the `expectTypeOf` checks).

**Proves:** criteria 2, 3, 4 (through `formatCitationParts`), 5, 6, 7, 8 and 11 (date half). This is the riskiest task, because it changes 15 schemas and their templates at once. That is why Tasks 2 and 3 land first, with their tests already passing.

## Task 5: the year fields

**Modifies:**
- `references.ts`: each of the 15 `year` fields becomes `Type.Optional(calendarDateType({ description: <the spec's text> }))`;
- the 15 templates listed in the spec's year table: `stringField("year", "year")` becomes `yearOrUndated()`;
- `ieee-date-types.test.ts`: year types are `string | undefined`.

**Proves:**
- criterion 13 (accepts and refuses, renders the IEEE examples, "c. 1787" throws naming `year`, the type, the description);
- criterion 14 (undated sources, all 15 types, including Datasheet and Book);
- criterion 12: Task 1's pins pass unchanged.

## Task 6: documentation and public surface

See the Documentation Sync block. Then run `pnpm run api-surface:update`, check that the diff only adds the five names of criterion 15 (and template or property lines the build lists), and commit.

**Proves:** criteria 15 and 16. `pnpm run check` passes.

## Documentation Sync

Every declared entry was evaluated.

- **Fires:**
  - `docs/api-reference.md` [Public-API]: a new "Citation dates" section covering `CalendarDate`, `calendarDateType`, `parseCalendarDate`, `calendarDateFromInstant` and `formatCalendarDate`, which fields are calendar dates and which instants, `year` and "(n.d.)", and the formatting error.
  - `docs/release-notes/upcoming.md` [Public-API]: Added (calendar dates, precision, "(n.d.)"); Migrating (the instant conversion rule with the zone for pre-5.4.2 data, the three year rules and the undated markers, the render-time throw for unconverted values, the checksum note, the template shape change).
  - `docs/changelogs/upcoming.md` [Any-Code-Change]: Breaking, Added and Tests entries.
  - `README.md` [Public-CLI-API, concepts]: the IEEE paragraph (`:270`) gains a sentence on calendar dates and undated sources.
  - `skills/proposit-core/SKILL.md` [Public-API]: the citations line names calendar dates. No new subpath.
  - `skills/proposit-core/docs/*.md` [Public-Engine-API]: no skill doc describes citation dates today (checked: none mentions `EncodableDate`, `formatDate` or a reference date). So nothing to keep compiling; SKILL.md carries the one line.
- **Does not fire:**
  - `README.md#invalid-constructions`: no grammar rule or engine error changes. The formatting `TypeError` is an extension's, not an engine error code.
  - `AGENTS.md`: there is an easy-to-violate rule worth one invariant line: "A citation's calendar date is a string, never a `Date`: build no `Date` from it, or the process time zone moves the day." It fires on that, as a new invariant.
  - `CLI_EXAMPLES.md`, `scripts/smoke-test.sh`, `skills/proposit-core/docs/cli.md`: the CLI never touches IEEE references (`src/cli/schemata.ts` uses `EncodableDate` only for its own timestamps).
  - The engine and library interface JSDoc files: no engine or library signature changes.
  - `examples/arguments/*.yaml`: no core argument schema changes, and the examples hold no IEEE references.
- **Taxonomy:** `tcw taxonomy add` for the vocabulary entry "calendar date" (child of `reference`), and the `ieee-citation-formatting` description gains the spec's words.

## Verification

What the suite cannot check:

- **Reading the output.** For one reference of each precision and one undated Datasheet, read the joined citation text against the IEEE guide examples the spec cites. A test pins strings; only a reader can tell that the punctuation around the year reads right.
- **A consumer's stored data.** The conversion rules are documented, not executed by core. Apply them by hand to a copy of each recorded pipeline fixture that holds a citation (`test/extensions/pipelines/fixtures/*`, none of which holds a reference date today; confirm) and to the README example, to check that the rules cover what is actually stored.

## Notes

- `toMatchInlineSnapshot` in Task 1 writes the expected values into the test file from the code as it stands. Read them once, against the IEEE guide, before committing, so the baseline is checked rather than assumed.
- The `unparsed` citation extension holds no dates and is untouched.
