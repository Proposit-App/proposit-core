# Changelog

## IEEE Schema Compliance

- `src/extensions/ieee/references.ts` — Added `AuthorSchema`/`TAuthor` exports; replaced all flat-string person fields with `AuthorSchema`; added `title` to 19 types; added `year`/`date` to 16 types; restructured Blog (`blogTitle`→`blogName`, added `postTitle`, `date`); removed `authors` from Handbook; added `releaseDate` to Video
- `src/extensions/ieee/formatting.ts` — `formatNamesInCitation` now takes `TAuthor[]` with "et al." for 7+ authors; new `formatSingleAuthor` export; `formatDate` uses IEEE month abbreviations with periods; all 33 segment builders updated for new fields and structured authors
- `src/extensions/ieee/relaxed.ts` — Automatically regenerated from updated strict schemas (no manual changes)
- `test/extensions/ieee.test.ts` — Rewritten: 56 tests (up from 48) with structured author fixtures, new `formatSingleAuthor` tests, et al. tests, formatDate IEEE month tests
