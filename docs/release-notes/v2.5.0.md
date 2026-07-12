# upcoming release notes

## Added

- Added a complete Federalist Papers sample text corpus, with each paper
  available as its own clean plain-text document under
  `examples/texts/federalist-papers/`.
- **Enriched argument diffs** now show what changed at its source: each modified
  entity reports whether the entity itself changed (`modified-own`) or only its
  contained children or references changed (`modified-within`). When you edit a
  claim, premises that reference it are automatically marked, surfacing all
  downstream impacts in a single diff.
