# v0.12.1

Five small follow-ups derived from the v0.12.0 post-release code review captured
in `docs/change-requests/v0.12-followups-from-review.md`.

## Fixes

- `populateFromSupports` dedupes by `supportingClaimId` before materializing
  variables. Tests added under
  `ManagedDerivationPremiseEngine.populateFromSupports (citations only)`.
- `applyAxiomaticForcedAssignments` uses `Object.hasOwn` so an explicit
  `undefined` assignment to an axiomatic-bound variable is rejected with
  `AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN`.
- `ClaimCitationLibrary.remove` and `ClaimAxiomLibrary.remove` throw
  `InvariantViolationError` with new codes `CITATION_NOT_FOUND` and
  `AXIOM_NOT_FOUND` instead of plain `Error`.
- `migrateV012` distinguishes ENOENT from non-ENOENT errors on its marker
  `fs.access` call.

## Internal

- `ArgumentEngine` extracts a shared `collectAxiomaticBoundVariables` helper
  used by both `applyAxiomaticForcedAssignments` and
  `getAxiomaticBoundVariableIds`.

## Error codes

Two new codes:

- `CITATION_NOT_FOUND` (`ClaimCitationLibrary.remove`).
- `AXIOM_NOT_FOUND` (`ClaimAxiomLibrary.remove`).
