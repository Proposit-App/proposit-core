## Proving a test in this library

**Run a new test against the unchanged code and read which ones fail, before
writing the fix.** A pin that passes before the change proves nothing, and the
failure mode is not "I forgot to run it" — it is measuring something _adjacent_
to the claim. Three times in two days: a counterexample-list assertion whose
fixture's only counterexample was already correct; a row-count assertion that
the first-satisfying-row early return made identical either way; a
`variableProvenance` assertion aimed at a defect that lives in
`claimAttribution`. Each looked like coverage.

Before trusting a pin, name the exact field the change writes and assert on
**that field**. Where a plausible wrong fix exists, implement it, confirm the
pin fails, and revert.

**A reported bug is reproduced before anyone tries to fix it.** Write the test
that reproduces it first, then have subagents attempt the fix and prove it with
that test passing. Starting from the fix is how a defect gets patched at the
site that reported it rather than where every caller routes through.

Add the test to the file or directory that matches its area, not by default to
`core.test.ts`.
