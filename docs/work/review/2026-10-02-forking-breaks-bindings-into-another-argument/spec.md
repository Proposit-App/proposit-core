# Spec: forking breaks bindings into another argument

Line numbers are against `90578ec3`.

## Capability changes

None. The capability ledger is empty and this restores documented behaviour.

## Problem

A premise-bound variable is **internal** when `boundArgumentId` equals its own argument's id, and **external** otherwise (`isExternallyBound`, `src/lib/schemata/propositional.ts:194-199`). Evaluation already tells them apart (`argument-evaluation.ts:244`, `premise-resolver.ts:27-32`, `satisfiability.ts:86-90`). Four sites do not:

1. **Forking.** `forkArgumentEngine` remaps every premise-bound variable as internal (`src/lib/core/fork.ts:147-159`): it looks the bound premise up in the fork's own remap table and rewrites `boundArgumentId` to the new argument. For an external binding the lookup gives `undefined`. `fromSnapshot` then treats the variable as internal (`argument-engine.ts:1926-1931`) and throws `Bound premise "undefined" does not exist in this argument` (`argument-engine.ts:1263-1266`). Any argument holding an external binding cannot be forked.
2. **Premise removal.** `getVariablesBoundToPremise` (`argument-engine.ts:1491-1496`) matches on `boundPremiseId` alone. `removePremise` cascades through it (`:1080`), so removing a local premise also removes an external binding whose remote premise has the same id.
3. **Circularity.** `wouldCreateCycle` (`src/lib/core/argument/circularity.ts:45-48`) treats an external binding whose remote premise id equals the target premise as a cycle, so placing that variable in that local premise is refused as circular.
4. **Changeset ordering.** `orderChangeset` (`src/lib/utils/changeset-order.ts:251-252`) places an external binding after the insert of a local premise that shares its remote premise id.

Sites 2–4 need two premise ids to coincide across arguments. That is rare with generated UUIDs but routine with caller-chosen ids, which the engine accepts.

## Goals

1. Forking keeps every external binding exactly as it was: same `boundPremiseId`, `boundArgumentId`, `boundArgumentVersion`. Internal bindings keep being remapped as today.
2. Sites 2–4 consider only internal bindings when matching a local premise.

## Non-goals

- Any change to how external bindings evaluate, or to `canBind`.
- `PropositCore.forkArgument`'s fork records. It calls `forkArgumentEngine` and inherits the fix; its records already name variables by id.

## Design

Each site tests "internal" the way evaluation already does: `boundArgumentId` equal to the argument's id. At sites 3 and 4 the variable's own `argumentId` stands in for the argument's id, so neither needs new context.

## Acceptance criteria

All are new tests, written first and run against the unchanged code to confirm each fails for the stated reason.

1. `test/core/forks.test.ts`: forking an engine holding one external binding succeeds, and the forked variable's three binding fields equal the original's. Forking an engine holding an internal binding still remaps it to the forked premise and argument.
2. `test/core/forks.test.ts`: `PropositCore.forkArgument` on an argument holding an external binding succeeds.
3. `test/core/variables.test.ts`: with a local premise `p1` and an external binding to premise `p1` of another argument, `getVariablesBoundToPremise("p1")` excludes the external binding, and removing local `p1` leaves it in place.
4. `test/core/variables.test.ts`: the same external binding can be placed as a variable expression inside local premise `p1` without a circularity error.
5. `test/changeset/`: `orderChangeset` on a changeset that inserts premise `p1` and modifies an external binding to a remote `p1` does not move that update after the insert.
6. `pnpm run check` passes.

## Risks

Low. Each change narrows a match to the internal case that every site's own comments describe.

## Notes

Release as 5.4.3 (patch). The tarball goes to the consumer for validation before release.
