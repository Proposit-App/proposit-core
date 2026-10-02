# Give citation dates a calendar-date type with precision, separate from instants

## The request

In the maintainer's words (`intake.md`): "allow certain timestamps to be marked as 'historical' or something like that so that we don't convert the timestamp to the reader's locale time and instead render it as UTC."

Today every citation date is an instant, a single moment in time. Since 5.4.2 every date is formatted by its UTC calendar day, and the convention is to store noon UTC when the time is unknown. That makes historical dates render the same day everywhere. But a true instant, such as an access date stamped when a citation is saved, then shows its UTC day rather than the reader's: a reader in Los Angeles saving in the evening sees the next day.

What is wanted is two kinds of date:

- **a calendar date**, a day (or month, or year) as written, with no time or zone, rendered exactly as written everywhere;
- **an instant**, an exact moment, rendered in a time zone the caller chooses.

A calendar date carries its **precision**: a year alone, a year and month, or a full day. Citations often know only the year.

## Answers so far (2026-10-02)

These are the requester's provisional answers on the maintainer's behalf, given so the spec can be written. The maintainer confirms them with the spec.

- **Which fields are which.** Access dates are instants. Every other reference date (publication, event, posting, first printing) is a calendar date. Where a field's nature is unclear, the spec lists it as an open question rather than guessing.
- **Precisions.** Year, year and month, and full day.
- **Stored data.** The product is pre-launch, so there is no production data to protect. Consumers still have stored and fixture data. The spec states a conversion rule consumers apply: an existing instant maps to its UTC calendar day, under the noon-UTC convention from the 5.4.2 fix, at full-day precision. Core does not run a migration.
- **Time zone for instants.** The caller passes a display time zone, defaulting to UTC. This is the upgrade path noted when 5.4.2 was decided.
- **Encoding.** No preference between CSL-JSON `date-parts`, EDTF strings or anything else has been recorded. The spec chooses what fits and says why.
- **Release.** Whether this ships in 6.0.0 is an open scope question with the maintainer. The spec has to say plainly whether the change needs a major version on its own.

## Out of scope

- Uncertainty and alternatives ("1755?", "1755 or 1757", EDTF-style qualifiers). They wait for a later item; adding them later is additive.
- A migration run by core over stored data.
- Anything about how a consuming application builds its editor, beyond describing the library interface it would use.

## Notes

- The request stage asked for reference material: no CSL or EDTF preference, and none provided beyond the intake's design direction (CSL-JSON `date-parts`, `Temporal.PlainDate` versus `Temporal.Instant`, SQL `DATE` versus `TIMESTAMPTZ`, Library of Congress EDTF).
- The intake lists what the spec must decide: which fields are which, the encoded shape and its round trip, IEEE rendering per precision, how the formatter receives a display zone, how existing instants convert, and the release version. The answers above settle some of these provisionally.

## References

- `intake.md`: the raw request, with background and the design direction.
- `2026-09-30-ieee-citation-dates-render-a-day-off-outside-utc` (5.4.2): the fix this builds on, and where the noon-UTC convention and the display-zone upgrade path were decided.

## Added 2026-10-02: a correction

The "noon UTC" convention above, carried over from `intake.md`, is wrong. Since 5.4.2 a citation date has been stored as **midnight UTC** of the day it means, which is how `EncodableDate` decodes "1787-11-22" (`src/extensions/citations/ieee/segment-builder.ts:24`, `docs/release-notes/v5.4.2.md:50`). The 5.4.2 work rejected noon UTC because some zones were more than 12 hours from UTC historically. So the conversion rule is "the instant's UTC calendar day", with no time of day assumed.
