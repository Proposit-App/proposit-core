# Upcoming release notes

## Fixed

- **CLI: building an expression tree top-down now works.** Creating an
  operator first and then attaching its children — the workflow shown in
  the CLI examples — previously discarded the operator the moment it was
  created, leaving the premise empty. Operators (and `insert` wrappers) now
  stay in place while you fill them in; run `repair` or `normalize` once the
  tree is complete to tidy it.
