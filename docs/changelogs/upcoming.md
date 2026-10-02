# Upcoming

## Fixed

- `formatCitationParts` threw `TypeError: d.getUTCMonth is not a function` for
  any reference whose date fields held ISO strings, the form a reference
  takes after `JSON.stringify` and `JSON.parse` without `Value.Decode`. The
  `date` source kind and `formatDate` now read such a string the way
  `EncodableDate` decodes one. `formatDate` accepts `Date | string`; a value
  that is neither a valid date nor a date string throws a `TypeError`, and
  the citation formatter names the field.
