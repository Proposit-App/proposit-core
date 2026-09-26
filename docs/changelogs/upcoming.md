# Upcoming

## Fixed

- Scribe (`argument-ingestion-scribe`, now version 1.1.0): every source
  (citation) claim now backs the normal claim it supports, even when
  `scribe-structure` leaves it out of its relations. `extract`'s output gains a
  required `sourceSupport` array (`{ sourceMiniId, supportedMiniId }`), and its
  prompt requires one citation claim per explicit link offered as evidence. The
  `relation-extraction` adapter appends one single-antecedent relation
  (`source-<source>-<supported>`) per named pair, and for a source neither named
  nor used by `structure`, one to the normal claim whose mention overlaps the
  source's most, else the nearest normal claim whose mention ends before it.
  New warnings: `SOURCE_ATTACHMENT_INVALID_TARGET` (a named target that is
  unknown or not normal) and `SOURCE_ATTACHMENT_UNATTACHED`.
- Scribe's `conclusion-selection` adapter runs its graph fallback over
  `structure`'s own relations, no longer the `relation-extraction` slot.

## Tests

- Re-recorded the scribe golden corpus.
