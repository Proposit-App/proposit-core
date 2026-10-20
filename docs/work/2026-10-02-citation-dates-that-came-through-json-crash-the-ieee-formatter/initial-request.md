# Citation dates that came through JSON crash the IEEE formatter

## The request

A reference read back from JSON without `Value.Decode` holds its dates as ISO strings. `formatCitationParts` passes the value straight to `formatDate` (`src/extensions/citations/ieee/segment-builder.ts`, the `date` source kind casts it to `Date`), which calls `getUTCMonth` and throws `TypeError: d.getUTCMonth is not a function`. Every date field of every reference type is affected.

Found by the review of the calendar-date spec, and reproduced on 5.4.3. The requester, on the maintainer's behalf, asked for it to be fixed on its own branch, test first, and to ride 6.0.0: the consumer decodes dates before formatting and is not affected, so no patch release.

Also asked: check whether IEEE abbreviates September as "Sept.", against IEEE's own reference guide, and fix it if so.

## Acceptance

- Formatting a JSON round-tripped reference gives the same segments as formatting the original, for all 33 types.
- `formatDate` accepts the ISO string form, giving the same day in every time zone of the existing zone suite.
- A value that is not a date fails with a `TypeError` naming the field.
