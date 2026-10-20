# Place the year where IEEE does for datasets, courses and software

## The request

Three IEEE templates put the year in a different place from IEEE's own Reference Guide (version "V 3.28.2025", read 2026-10-02):

| Type | Template | IEEE's form |
|---|---|---|
| Dataset | `src/extensions/citations/ieee/templates/digital-sources.ts` (`DATASET_TEMPLATE`) | "Author, Date, Year. "Title of Dataset," distributed by …" (guide line 410): the date comes right after the author |
| Course | `templates/multimedia.ts` (`COURSE_TEMPLATE`) | "(Year)" in parentheses (guide line 370) |
| Software | `templates/digital-sources.ts` (`SOFTWARE_TEMPLATE`) | "(Date)" in parentheses (guide line 703) |

Found by the bounded review of the calendar-date spec's year change on 2026-10-02 (`2026-09-30-give-citation-dates-a-calendar-date-type-with-precision-separate-from-instants`). That change keeps each year segment where it is, and names this as out of scope.

## Notes

- The templates are public constants (`DATASET_TEMPLATE`, `COURSE_TEMPLATE`, `SOFTWARE_TEMPLATE`), so moving a segment changes their shape and the rendered text of every citation of those types. Decide the release accordingly.
- The guide's line numbers refer to its plain-text export (the PDF link redirects to the Google Doc "IEEE Reference Style Guide for Authors").
- After the calendar-date change, the year segment can also be "(n.d.)"; an IEEE form that already puts the year in parentheses must not end up as "((n.d.))".
