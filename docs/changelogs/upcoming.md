# Upcoming

## Testing

### Characterisation coverage for attribution on an all-asserted argument

Two cases pinned in `test/evaluation/attribution.test.ts`. No behavior changed;
these record what the evaluator already does, so they pass before and after.

The first builds the conclusion `(A ∨ ¬B) → C` with the single supporting
premise `A → (B ∧ C)`, assigns every claim `true`, and accepts every root
operator — the shape a reader produces by answering everything and granting
every step. It asserts the full result: the conclusion is `true`,
`premisesHoldConclusionFalse` is `false`, nothing is struck, the premise set is
satisfiable, no variable is contested, `conclusionAttribution` is
`{ assertedByReader: true, reachedWithoutAssertion: false }`, and every
`variableProvenance` origin is `asserted`. Withholding the reader's own
assertions leaves the conditional premise with an unknown antecedent, so
nothing reaches `C` — the conclusion holds on the reader's answer alone, and
that is the correct result rather than a defect.

The second records what `variableProvenance` reports for a derivation premise,
with a bare-variable tree and with a real antecedent. Both fixtures come back
all-`asserted`, and the test comments say why that is a property of the fixture
rather than of the engine: `buildArgument` swaps a derivation premise's naked-Q
placeholder root for the tree given, so a premise asserting the synthesized
variable alone is not expressible, and `ensureClaimBoundVariable` reuses the
authored variable rather than synthesizing a sibling. Reaching the shape where
a derivation's consequent is a second claim-bound variable needs a fixture that
can bind one.

That shape matters to consumers keying off provenance: when it is reachable and
the reader has not granted the derivation's step, the synthesized variable
reports `{ value: null, origin: "unassigned" }` while every authored variable
reports `asserted`. A consumer scanning `variableProvenance` for `unassigned`
to decide whether the reader left anything outstanding would therefore misread
a reader who answered every claim they can see, since no reader can answer that
variable. `@proposit/shared` takes the outstanding-claim set from its caller for
exactly this reason.
