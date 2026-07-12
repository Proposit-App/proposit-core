# upcoming changelog

## Added

- Added 85 Federalist Papers plain-text fixtures under
  `examples/texts/federalist-papers/`, one file per paper.
- Cleaned the generated fixtures for sample-use readability: removed source-page
  chrome during extraction and fixed glued footnote-marker spacing found during
  post-generation audit.
- **Enriched `diffArguments` output** (commits 1cc69bb..914617a): Added four-state
  `state` field on modified entities (`modified-own` vs `modified-within`),
  reference-edge propagation marking premises that reference claim-edited
  variables, conclusion-role change folding into argument own-state, and
  documented id-stability contract governing state expressibility.
