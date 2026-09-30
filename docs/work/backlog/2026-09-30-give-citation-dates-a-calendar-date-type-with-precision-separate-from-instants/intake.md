# Give citation dates a calendar-date type with precision, separate from instants

Filed 2026-09-30 at the maintainer's request, as a backlog item: not scheduled.

## Request

In the maintainer's words: "allow certain timestamps to be marked as
'historical' or something like that so that we don't convert the timestamp to
the reader's locale time and instead render it as UTC."

## Background

- Today every citation date is an `EncodableDate` instant. The fix for
  `2026-09-30-ieee-citation-dates-render-a-day-off-outside-utc` (5.4.2) formats
  every date by its UTC calendar day.
- The convention that follows: store the exact moment, and store noon UTC when
  the time is unknown. That makes historical dates render the same day
  everywhere.
- The cost is that a true instant, such as an access date stamped when a
  citation is saved, shows its UTC day rather than the reader's. A reader in Los
  Angeles saving in the evening sees the next day.

## What is usually done (design direction, for the spec to evaluate)

- **Separate two kinds of date:**
  - a calendar date with no time or zone (SQL `DATE`, `Temporal.PlainDate`,
    schema.org `Date`), rendered exactly as written;
  - an instant (`TIMESTAMPTZ`, `Temporal.Instant`), rendered in a zone the
    caller supplies.
- **Give calendar dates a precision,** as citation tools do:
  - CSL-JSON `date-parts`, e.g. `[[1787, 11, 22]]`, or `[[1755]]` when only the
    year is known;
  - optionally uncertainty and alternatives in the style of the Library of
    Congress EDTF (`1755?`, `1787-11~`, `[1755,1757]`), which a timestamp cannot
    express (e.g. a birth year given as "1755 or 1757").

## The spec must decide

- Which reference fields are calendar dates (publication, first-printing, event
  dates) and which are instants (access dates).
- The encoded shape and how it round-trips.
- How IEEE renders each precision ("1787", "Nov. 1787", "Nov. 22, 1787") and
  each uncertainty.
- How the formatter receives a display zone for instants (UTC by default).
- Whether and how existing stored instant-shaped dates migrate (noon-UTC values
  map cleanly to calendar days).
- The release version.

## Consumer impact

Applications using the library would need editor inputs for precision and a
display zone for instants. The spec should describe that interface in general
terms.

## Tests

- Each precision renders correctly.
- A calendar date renders the same day in every time zone.
- An instant renders in the supplied zone.
- Stored noon-UTC dates convert to the right calendar day.
- A round trip through encode and decode preserves precision and uncertainty.
