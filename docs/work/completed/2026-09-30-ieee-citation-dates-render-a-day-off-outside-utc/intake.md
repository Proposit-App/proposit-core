# IEEE citation dates render a day off outside UTC

Reported by a downstream consumer on 2026-09-30, reproduced against 5.4.1.

## Problem

The IEEE citation formatter prints a date one day early or late for any reader
whose time zone isn't UTC. A NewspaperArticle citation dated 1787-11-22 prints
"Nov. 21, 1787" under `TZ=America/Los_Angeles`.

## Root cause

`formatDate` in `src/extensions/citations/ieee/segment-builder.ts` uses the
local-time getters `d.getMonth()`, `d.getDate()` and `d.getFullYear()`.
`EncodableDate` decodes a calendar-date string such as "1787-11-22" as midnight
UTC, so the local getters shift it into the reader's zone.

Storing noon UTC doesn't fully fix it either. For historical dates, local mean
time puts some zones more than 12 hours from UTC (Asia/Manila about -15:56 and
America/Sitka about +14:58 in 1787), so no single stored instant renders the
same day everywhere. A consumer that renders on a UTC server and again in the
reader's browser also gets mismatched output.

## Observed with 5.4.1

| TZ                  | midnight UTC | noon UTC |
| ------------------- | ------------ | -------- |
| UTC                 | Nov. 22      | Nov. 22  |
| America/Los_Angeles | Nov. 21      | Nov. 22  |
| Pacific/Auckland    | Nov. 22      | Nov. 22  |
| Asia/Manila         | Nov. 21      | Nov. 21  |
| America/Sitka       | Nov. 22      | Nov. 23  |

## Proposed fix

Treat a citation date as a calendar date: `formatDate` reads `getUTCMonth()`,
`getUTCDate()` and `getUTCFullYear()`. Every reference type carrying an
`EncodableDate` (NewspaperArticle.date, and any access or publication date on
other types) goes through the same function, so one change covers them all.
Check whether any caller depends on local-time rendering.

## Impact

A patch release; no data changes.

## Tests (write the failing ones first)

- `formatDate(new Date("1787-11-22"))` is "Nov. 22, 1787" under `TZ=UTC`,
  America/Los_Angeles, Pacific/Auckland, Asia/Manila and America/Sitka. Make
  sure the test cannot pass by accident in UTC.
- A full NewspaperArticle citation built from date "1787-11-22" shows
  "Nov. 22, 1787" in the same zones.
- A modern date ("2024-01-01") still renders "Jan. 1, 2024" in each zone.
