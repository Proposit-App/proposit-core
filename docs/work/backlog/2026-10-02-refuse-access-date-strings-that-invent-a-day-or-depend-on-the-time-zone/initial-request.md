# Refuse access-date strings that invent a day or depend on the time zone

Found by the combined 6.0.0 review (citation dates), and kept out of 6.0.0 because the calendar-date change left access dates exactly as they were.

## Problem

An access date is an `EncodableDate`, and the schemas (strict, relaxed and union) accept any string `new Date` can parse. Since the JSON fix, the citation formatter reads such a string the way `EncodableDate` decodes it, so these render without error:

| Stored `accessedDate` | Renders | |
|---|---|---|
| `"2026-07"` | "Jul. 1, 2026" | an invented day, every zone |
| `"1787"` | "Jan. 1, 1787" | an invented day, every zone |
| `"1"`, `"12"` | "Jan. 1, 2001", "Dec. 1, 2001" in UTC; the day before in Asia/Tokyo | a date in 2001, moved by the zone |
| `"2026-07-30T00:00:00"`, `"July 30, 2026"` | "Jul. 29, 2026" in Asia/Tokyo | the day depends on the zone, the defect 5.4.2 fixed |

Every other reference date now refuses a month- or year-only value, so a consumer who writes access dates the same way gets an invented day with no error.

The second half of the problem: an access date stored as a short, valid string (`"2026-09-01"`) hashes differently raw than after `Value.Decode`. `Date.toJSON` turns it into `"2026-09-01T00:00:00.000Z"`, so a consumer who adds `citation` or `reference` to their checksum configuration gets two checksums for one citation. The defaults hash neither.

## Proposed direction

Accept only an ISO date-time with `Z` or an offset (the form `JSON.stringify` writes) for access dates, in `EncodableDate` or in the `date` source kind and the access-date fields. This touches `EncodableDate`'s other users (`JsonPrimitiveSchema` and `JsonValueSchema`), so it is a breaking change to plan, not a fix to slip in.

## Tests

A test per row of the table, run in the zone harness (`test/extensions/citations/ieee-date-time-zones.test.ts`), plus a checksum test of raw against decoded.
