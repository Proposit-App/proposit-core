# Plan — citations are given in `checkValidity`

Four tasks. The suite is green at every boundary: T1 is a failing test, T2 makes
it pass, T3 pins the trap, T4 is documentation over the finished diff.

## T1 — the failing test, before any source change

`test/evaluation/validity-citations.test.ts` (new).

Build one argument twice through the real engine — a conclusion whose derivation
rests on a supporting claim, plus a second claim that is `citation` in one
fixture and `normal` in the other. Reuse `test/evaluation/fixtures.ts`; it
already builds claim-typed arguments for the striking and confluence suites.

Assertions, all failing before T2:

- The citation fixture's `numAssignmentsChecked` is half the normal fixture's
  (criterion 1).
- No returned counterexample assigns a citation-bound variable `false`
  (criterion 2).
- An argument valid only when citations are given returns `isValid: true`
  (criterion 3).

**Verified by:** `pnpm exec vitest run test/evaluation/validity-citations.test.ts`
— must fail, and must fail on the *assertion*, not on fixture construction. A
test that errors while building proves nothing.

## T2 — the grounded carve-out

`src/lib/core/argument-engine.ts`.

Add `collectGroundedBoundVariables()` beside `collectAxiomaticBoundVariables()`,
filtering the variable list by the existing `isGroundedVariable` predicate, and
`getGroundedBoundVariableIds()` beside `getAxiomaticBoundVariableIds()`. Switch
`checkValidity` (`argument-engine.ts:2844`) to the grounded ids for **both**
`excludedVariableIds` and `forcedTrueVariableIds`, leaving the union with the
caller's sets exactly as it is.

`collectAxiomaticBoundVariables` and `applyAxiomaticForcedAssignments` are not
touched. No change in `src/lib/core/evaluation/`.

**Verified by:** T1 goes green; `pnpm run check` stays green.

## T3 — pin the trap

Same new test file.

- `evaluate()` accepts a caller assignment on a citation-bound variable and does
  not throw; the assigned value is what the evaluation reads (criterion 5).
- `evaluate()` still throws `AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN` for an
  axiomatic-bound variable (criterion 4, evaluate half).
- `checkValidity` still excludes and forces axiomatic variables (criterion 4,
  validity half).
- The default assignment still seeds a citation `true` (criterion 6).

These pass immediately after T2 — they are regression pins, and their value is
that widening the wrong collector later turns them red. Written as their own
task so the diff shows them as deliberate.

**Verified by:** temporarily point `applyAxiomaticForcedAssignments` at the
grounded collector and confirm the criterion-5 test fails. Revert. A pin nobody
has seen fail is a pin nobody knows works.

## T4 — Documentation Sync

One pass over the finished diff, after T1–T3.

Evaluated every entry in `AGENTS.md` § Documentation Sync:

| Entry | Fires? |
| --- | --- |
| `docs/api-reference.md` [Public-API] | **Yes** — `checkValidity`'s enumeration rule is public behaviour and the reference describes it. |
| `src/lib/core/interfaces/argument-engine.interfaces.ts` [Public-Engine-API] | **Yes** — `checkValidity`'s JSDoc states what it excludes. |
| `docs/release-notes/upcoming.md` [Public-API] | **Yes** — a reader-visible change in what counts as a failing case. |
| `docs/changelogs/upcoming.md` [Any-Code-Change] | **Yes** — always. |
| `AGENTS.md` [Routing] | **Yes, narrowly** — "widening the axiomatic collector silently forbids reader assignment on citation claims" is exactly the easy-to-violate invariant that entry exists for. |
| `README.md` [Public-CLI-API] / "Invalid Constructions" [Validation-Rules] | No — no CLI surface, no validation rule, error code, or operator constraint changes. |
| `CLI_EXAMPLES.md`, `scripts/smoke-test.sh` [Public-CLI-API] | No — no new command, flag, or CLI behaviour. |
| `premise-engine` / `shared` / `library` interfaces | No — untouched. |
| `proposit-core.ts`, `argument-library.ts`, `fork-library.ts`, `fork-namespace.ts` [Public-API] | No — no public method changes. |
| `examples/arguments/*.yaml` [Argument-Schema] | No — no schema change. |

Plus the in-code comments criterion 8 requires, at `isGroundedVariable` and
`checkValidity`.

**Verified by:** `pnpm run check` (prettier + build + typedoc) green; the two
in-code comments present.

## Verification the suite cannot check

- **Nothing is published.** Consumers stay on npm `4.0.0`; core merges to `main`
  and tags locally. No consumer gate runs, and none is expected to.
- **No reader can reach this today.** `proposit-server`'s gate disables the
  exhaustive check on every real argument, so there is no browser check to run
  until that item lands. Recorded rather than hand-waved: this fix is unobservable
  end-to-end until the server item ships.

## Notes

The excluded sibling — `evaluateArgument`'s satisfiability call at
`argument-evaluation.ts:637` still pinning only axiomatic variables — is filed as
its own item during closeout, not carried here.
