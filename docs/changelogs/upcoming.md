# upcoming changelog

<changes starting-hash="3eac233" ending-hash="3eac233">

## Fixed

- **`gradeEvaluation` no longer awards `sound` / `vacuously-true` when the
  supporting premises are not known true.** `allSupportingPremisesTrue` is a
  Kleene fold, so "at least one unknown, none false" yields `null`; the old
  `=== false` unsound check let `null` fall through to the true-conclusion
  branch and grade `sound`. A gate now runs after the counterexample check:
  anything other than `allSupportingPremisesTrue === true` — including `null` and
  `undefined` — grades `indeterminate`. No truthiness test; `undefined` is
  treated exactly as `null`.
- Precedence is otherwise unchanged and the JSDoc precedence list was renumbered
  to match: `ok === false` → `inadmissible` → `unsound` → `counterexample` → the
  new premise gate → `vacuously-true` → `sound` → `indeterminate`. The premise
  gate deliberately outranks vacuity, so an unknown-premise argument with a
  vacuously true conclusion grades `indeterminate`, not `vacuously-true`.
- Zero supporting premises still grades `sound` — the fold is seeded `true` — now
  pinned by an explicit test rather than left as an accident of the seed.

## Notes

- No schema, wire-format, or truth-table change. `kleene.ts`,
  `argument-evaluation.ts`, and `checkArgumentValidity` are untouched; validity
  output is byte-identical.
- `test/default-assignment.test.ts` gains a table-driven suite walking every
  permutation of `allSupportingPremisesTrue` × `conclusionTrue` ×
  `isCounterexample` × `isAdmissibleAssignment` over `true` / `false` / `null` /
  `undefined`, against an expectation function written from the specification
  rather than from the implementation.

</changes>
