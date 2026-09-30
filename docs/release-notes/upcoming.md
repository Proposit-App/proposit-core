# Upcoming

## Added

### Check an argument against a grammar tier from the command line

`analysis validate-argument` takes a new `--tier` option, so the CLI can now
report every grammar rule the library checks, including the Presentable-tier
rules such as `P-6`, which were reachable only through
`engine.validate('presentable')` before:

```bash
proposit-core <argument-id> latest analysis validate-argument --tier presentable
```

The tier is `structural`, `evaluable`, `derivable` or `presentable`, and the
command checks every rule from Structural down to the tier you name. These
checks are added to the command's existing readiness checks rather than
replacing them, so a tier never reports `ok` for an argument the plain command
calls `invalid`. Each rule an argument breaks prints as
`<tier> <code>: <message>`. With `--json`, the output gains a `tier` field and a
`violations` array in the library's own format.

Without `--tier`, the command's output is unchanged.

## Fixed

### `check-validity` refuses a mode it does not recognise

`analysis check-validity --mode` used to treat any value other than
`exhaustive` as `first-counterexample`, so a typo such as `--mode exhastive`
silently ran the other search. It now exits with an error naming the two valid
modes. A script that passed a misspelled mode will now fail instead of running
the wrong search.
