# Outcome: forking breaks bindings into another argument

All four sites are fixed on `fix/fork-external-bindings`, one commit per site, each together with its test.

## Each test failed first, for the stated reason

| Test | Failure before the fix |
|---|---|
| `test/core/forks.test.ts` — `forkArgumentEngine` keeps the binding | `Bound premise "undefined" does not exist in this argument.` |
| `test/core/forks.test.ts` — `PropositCore.forkArgument` succeeds | the same error |
| `test/core/variables.test.ts` — not among the variables bound to local `p1` | `expected [ …(2) ] to not include 'v-ext'` |
| `test/core/variables.test.ts` — survives removing local `p1` | `expected undefined to be defined` (the cascade deleted it) |
| `test/core/variables.test.ts` — placed in local `p1` | `Circular binding: variable "v-ext" is bound to this premise` |
| `test/changeset/order-changeset.test.ts` — not held back | `expected 1 to be less than 0` (the update came after the insert) |

## Changes

- `src/lib/core/fork.ts`: remap a premise-bound variable only when it is bound into the source argument.
- `src/lib/core/argument-engine.ts` (`getVariablesBoundToPremise`), `src/lib/core/argument/circularity.ts` and `src/lib/utils/changeset-order.ts`: require `boundArgumentId` to be this argument before matching a local premise.
- Documentation:
  - `docs/api-reference.md`: `forkArgumentEngine` and `getVariablesBoundToPremise`;
  - `skills/proposit-core/docs/forking-and-diffs.md`;
  - the `getVariablesBoundToPremise` JSDoc in `argument-engine.interfaces.ts`;
  - changelog and release notes, under Fixed.
  Other documentation entries do not fire, as the plan records.

## Checks

- `pnpm run check` passes.
- `pnpm run test`: 2751 passed, 13 skipped.

## Release

- The target is 5.4.3. It also carries the unreleased entries already in `upcoming.md` from the repository cleanup.
- The tarball goes to the consumer for validation.
- The version bump, merge and tag wait for that verdict.
