# Upcoming

## Added

- `analysis validate-argument --tier <tier>` runs `ArgumentEngine.validate(tier)`
  alongside `validateEvaluability()`. The tier is `structural`, `evaluable`,
  `derivable` or `presentable`; the list is read from `GrammarTierSchema`. `ok`
  is true only when the readiness result is ok and there are no violations. Text
  output prints the readiness issue lines as before, then one
  `<tier> <code>: <message>` line per violation. `--json` prints
  `{ ok, issues, tier, violations }`, with `violations` exactly as the library
  returns them. Without `--tier`, the text and JSON output are unchanged. An
  unrecognised tier exits 1 before the argument is loaded.

## Fixed

- `analysis check-validity --mode` ran the first-counterexample search for any
  value other than `exhaustive`, so a misspelled mode ran the wrong search
  without saying so. It now accepts only `first-counterexample` and `exhaustive`
  and exits 1 on anything else, before the argument is loaded.
- A comment in the `validate` command pointed readers to "a separate command"
  for four-tier grammar validation. It now names
  `analysis validate-argument --tier`.
