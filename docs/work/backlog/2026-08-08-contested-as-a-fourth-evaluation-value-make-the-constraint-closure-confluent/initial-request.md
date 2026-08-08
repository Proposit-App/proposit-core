# Contested as a fourth evaluation value; make the constraint closure confluent

A code review of the unpublished 4.0.0 found the constraint closure in
`src/lib/core/evaluation/argument-evaluation.ts` (the `while (changed)` sweep)
to be **nondeterministic**, plus three smaller defects in the same evaluation
pass.

## Product changes

**Reported symptom.** Conclusion premise `X`; supporting premises `A → X` and
`X → F`; the reader asserts `A = true` and `F = false` and accepts both root
operators. Forward modus ponens drives `X` true, the contrapositive drives `X`
false, and `trySetChild` never overwrites — so whichever premise the sweep
reaches first wins. Premise visitation order comes from
`ArgumentEngine.listPremiseIds()`, which sorts by lexicographic UUID, so the
answer is decided by which random id happened to sort lower. Measured over 300
structurally identical arguments: `conclusionTrue` came back `true` 157 times
and `false` 143 times.

`premiseSetSatisfiable` is `true` in every one of those runs and cannot be used
to detect the condition: it asks about the premise set *alone*, and here it is
the reader's assertions **plus** the granted steps that are jointly
inconsistent.

**Decision.** The conflict does not resolve to `unknown`. In the product
owner's words:

> Contested as a new value type altogether. I don't want it to resolve to
> unknown because the users value assignments have to determine yet conflicting
> values. It's not that the value is unknown. It's that the user saying it is
> both true and false. This value type can only happen as a result of argument
> evaluation, and not from an explicit assignment — users can still only assign
> the three Kleene values.

So: a fourth value, produced only by evaluation, never assignable.

## Technical changes

1. **A fourth truth value.** Assignment stays three-valued; evaluation output
   widens to four. A caller must not be able to feed the fourth value back in
   as an assignment, enforced in the types rather than by convention.
2. **A confluent closure.** The propagation sweep must reach the same fixed
   point regardless of the order it visits premises and operators in.
3. **`evaluate`'s `forcedTrueVariableIds` silently discards the axiomatic set.**
   `argument-engine.ts` does `options?.forcedTrueVariableIds ??
   this.getAxiomaticBoundVariableIds()` — a replace where `checkValidity`
   correctly unions. Passing an empty set flips `premiseSetSatisfiable`
   `false → true`, runs derivation that should be suppressed, and lets the
   forced axiom pollute `conclusionAttribution.assertedByReader`.
4. **`premisesHoldConclusionFalse` inherits an undocumented vacuity.** It is
   built on `survivingSupportingPremisesTrue`, which is vacuously `true` when
   every supporting premise was struck — so striking the only premise reports
   `premisesHoldConclusionFalse = true`, telling the reader the argument
   failed. Its sibling carries the vacuity warning; this one does not. The CLI
   label for the field ("premises hold, conclusion does not follow") is also
   wrong on its own terms: the field means the conclusion is **false**.
5. **`isPremiseSetSatisfiable` conflates "unsatisfiable" with "unevaluable".**
   A premise whose root is `null` on every row drives the walk to `false`, and
   `false` suppresses derivation argument-wide. It should return `null`, the
   same honest-degradation rule the variable ceiling already follows. No
   reachable trigger was constructed; treat as hardening.
6. **Three false "least fixed point" claims** — in `argument-evaluation.ts`,
   `docs/api-reference.md` and `AGENTS.md`. The fill-`null`s-only property is
   real and gives attribution the monotonicity it needs; what is missing is
   *uniqueness*, because `true` and `false` are incomparable in the information
   order.

## Meta changes

This rides the **unpublished 4.0.0** — nothing in core has been released, so
the shape may change freely. Stay at 4.0.0 and fold the work into the existing
`docs/release-notes/v4.0.0.md` and `docs/changelogs/v4.0.0.md` rather than
cutting 5.0.0.

The downstream API delta must be enumerated explicitly: `@proposit/shared`,
`proposit-server` and `proposit-mobile` all model three values today.
