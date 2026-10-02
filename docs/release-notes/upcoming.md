# Upcoming

## Fixed

### Stored citations format without decoding first

A citation read back from storage holds its dates as the ISO strings JSON
wrote, such as `"2026-07-30T00:00:00.000Z"`. `formatCitationParts` used to
crash on those with `d.getUTCMonth is not a function` unless you had run the
reference through `Value.Decode` first. It now formats them exactly as it
formats the decoded `Date`, and `formatDate` accepts either form.

A date field holding something that is not a date at all now fails with a
`TypeError` that names the field.
