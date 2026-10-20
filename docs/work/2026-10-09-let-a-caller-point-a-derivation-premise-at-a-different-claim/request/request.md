# Let a caller point a derivation premise at a different claim

## The request

A consumer of the engine needs to change which claim a derivation premise
derives, keeping the premise itself: its id, its own variable, its expression
tree and its extra fields such as the title.

The engine has no way to do that today:

- `PremiseEngine.setExtras` copies the existing `derivedClaimId` back, so a
  premise's derived claim cannot be changed through a mutation.
- Removing the premise and creating a new one loses the expressions that name
  the premise's own variable. When the consequent expression is removed, the
  engine collapses its parent operator, so the old tree cannot be rebuilt from
  its leaves.

The case that needs it: a claim is replaced by a new claim (for example a
copy made so an argument can edit a claim it does not own), and the argument's
derivation premise for the old claim should now derive the new one, with
everything else about the premise unchanged.

What the consumer does instead, for now: it edits `derivedClaimId` in a
snapshot and restores the engine from that snapshot with `rollback`. That works
today, but it relies on internal behaviour: `rollback` does not check that the
derived claim is in the claim library, which `createPremise` does check
(`CREATE_DERIVATION_CLAIM_NOT_FOUND`). The consumer has added its own check
before the rollback, and will switch to the engine method once it exists.

## Constraints

- The same validation as creating a derivation premise: the target claim must
  be in the claim library, with the same error code when it is not.
- The change should come back as a normal changeset (the premise modified, with
  its checksum recomputed), so a consumer can persist it like any other edit.
- No change to the behaviour of existing methods.

## Notes

- Written by the consumer's maintainer, from a code review of the workaround
  described above. Asked for reference material; none beyond this description.
- The method name is only a suggestion (for example
  `retargetDerivationPremise(premiseId, claimId)`); the spec decides the API.
