# Plan: forking breaks bindings into another argument

Work on branch `fix/fork-external-bindings`. Every commit leaves `pnpm run check` green, so the failing tests and each fix land together per site. Each test is first run alone against the unchanged code and its failure recorded in `outcome.md`.

## Tasks

1. **Forking.**
   - Tests: two cases in `test/core/forks.test.ts`: `forkArgumentEngine` keeps an external binding's three fields, and `PropositCore.forkArgument` succeeds on such an argument. Add an internal-binding case only if the existing suite lacks one.
   - Fix in `src/lib/core/fork.ts:147-159`: remap only when `boundArgumentId` equals the source argument id.
   - Proof: both tests fail before the fix (with the `Bound premise "undefined"` error) and pass after.
2. **Premise removal.**
   - Test in `test/core/variables.test.ts`: local `p1`, plus an external binding to remote `p1`. `getVariablesBoundToPremise("p1")` excludes it, and `removePremise("p1")` keeps it.
   - Fix in `src/lib/core/argument-engine.ts:1491-1496`: add `base.boundArgumentId === this.argument.id`.
   - Proof: the test fails before the fix, with the variable removed, and passes after.
3. **Circularity.**
   - Test in `test/core/variables.test.ts`: place the external binding's variable expression into local `p1`. It must not throw.
   - Fix in `src/lib/core/argument/circularity.ts`: return `false` for a binding whose `boundArgumentId` differs from its own `argumentId`.
   - Proof: the test fails before the fix, with a circularity error.
4. **Changeset ordering.**
   - Test in `test/changeset/order-changeset.test.ts`: a changeset that inserts `p1` and modifies an external binding to remote `p1`. The update is not placed after the insert.
   - Fix in `src/lib/utils/changeset-order.ts:251-252`: require `v.boundArgumentId === v.argumentId`.
   - Proof: the test fails before the fix.
5. **Documentation.** `docs/changelogs/upcoming.md` (Fixed) and `docs/release-notes/upcoming.md` (Fixed).
6. **Release candidate.** Bump `package.json` to 5.4.3 only at release. Before then:
   - run `pnpm run build && pnpm run pack:branch`;
   - report the tarball path to the requester for validation;
   - merge to `main` and tag `v5.4.3` once the verdict is in;
   - then tell the maintainer the repository is ready to publish.

## Documentation Sync

- `docs/changelogs/upcoming.md` [Any-Code-Change]: fires. Add a Fixed entry naming the four sites.
- `docs/release-notes/upcoming.md` [Public-API]: fires. Forking now works for arguments with external bindings, and removing a premise no longer deletes an unrelated external binding.
- `docs/api-reference.md` [Public-API]: checked. No signature changes. `forkArgumentEngine`'s description says nothing about bindings, and a sentence stating that external bindings are kept is added.
- `skills/proposit-core/docs/forking-and-diffs.md` [Public-Engine-API]: checked for a claim about bound variables; corrected if it says they are all remapped.
- Interfaces JSDoc [Public-Engine-API]: `getVariablesBoundToPremise`'s JSDoc (`argument-engine.interfaces.ts:352`) says "bound to the premise". It gains "in this argument".
- `README.md`, `README.md#invalid-constructions`, `CLI_EXAMPLES.md`, `scripts/smoke-test.sh`, `examples/arguments/*.yaml`, `AGENTS.md`, `skills/proposit-core/SKILL.md`, `skills/proposit-core/docs/cli.md`, `src/lib/core/proposit-core.ts` and the library and fork JSDoc files do not fire. There is no CLI, schema, rule or new-invariant change.

## Verification

- The suite covers all four sites.
- The consumer validates the tarball against its own forking of arguments that hold external bindings. This repository cannot check that.
