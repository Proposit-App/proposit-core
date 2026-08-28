# Upcoming

## Fixed

### Answering an unused claim no longer moves the supporting-premises aggregate

`survivingSupportingPremisesTrue`, `survivingSupportingPremiseCount` and
`allSupportStruck` now range over the argument's authored supporting premises
only. Derivation premises — the wiring the engine synthesizes to record that a
claim follows from its citation or axiom — are excluded.

Previously they were included whenever their tree had an `implies` root, which
is every citation- and axiom-backed derivation premise. If your argument had a
claim that no authored premise references but that carries a citation, a reader
answering that claim `false` flipped `survivingSupportingPremisesTrue` to
`false`, even though the argument never used the claim. That no longer happens,
and the count drops by one for each derivation premise it previously included.

Nothing disappears from what you render: the per-premise `supportingPremises`
and `constraintPremises` result lists are unchanged and still contain
derivation premises, as does `ArgumentEngine.listSupportingPremises()`.
`isAdmissibleAssignment`, `premiseSetSatisfiable`, `struckPremiseIds` and
`checkValidity()` are all unchanged.

One consequence worth checking if you branch on the count: an argument whose
supporting premises are _all_ derivation premises now reports a surviving count
of `0`, so `survivingSupportingPremisesTrue` is vacuously `true` and
`allSupportStruck` stays `false`. Read the count alongside the aggregate, as
the API reference has always advised.
