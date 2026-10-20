# Outcome

## Decision

Accepted by the maintainer on 2026-09-30.

## Evidence

- `formatDate` reads a citation date with the UTC getters, matching how
  `EncodableDate` decodes a date as midnight UTC.
- `test/extensions/citations/ieee-date-time-zones.test.ts` failed before the
  fix and passes after it, across five time zones including two whose 1787
  local mean time was more than twelve hours from UTC.
- Released as 5.4.2.

## Deferred follow-ups

A calendar-date type with precision is filed as its own backlog item
(`2026-09-30-give-citation-dates-a-calendar-date-type-with-precision-separate-from-instants`).

## Closeout

Merged to `main` directly, with no work branch for tcw to merge.
