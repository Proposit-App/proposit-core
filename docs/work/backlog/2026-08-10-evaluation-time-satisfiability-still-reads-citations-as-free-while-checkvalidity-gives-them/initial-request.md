# Evaluation-time satisfiability still reads citations as free while checkValidity gives them

Deferred from
`2026-08-10-checkvalidity-enumerates-citation-bound-variables-the-default-assignment-treats-as-given`,
which made `checkValidity` treat a citation as given and deliberately left this
half alone. Filed at that item's closeout, as promised in its outcome.

The engine now reads a citation two ways depending on who asks.

## Technical changes

`checkArgumentValidity` builds its exclusion and forced-true sets from the
**grounded** set — citation ∪ axiomatic — via `getGroundedBoundVariableIds()` on
`ArgumentEngine`. `evaluateArgument`'s own `isPremiseSetSatisfiable` call
(`src/lib/core/evaluation/argument-evaluation.ts:637`) receives
`options?.forcedTrueVariableIds`, which on the evaluation path is the
**axiomatic-only** set. So the same premise set can be satisfiable when
evaluation asks and unsatisfiable when validity asks, on an argument where a
premise holds only if a cited claim is false.

The narrow change is to pass the grounded set at `:637` as well. It is one line
and it is not the hard part.

## Why it was excluded, and what has to be decided first

Pinning citations true there can only shrink the model set, so a premise set
that holds only with a cited claim false flips from **satisfiable** to
**contradictory**. `premiseSetSatisfiable === false` is what suppresses
derivation argument-wide (`argument-evaluation.ts:648-651`), and that state
surfaces to a reader as the review's **blocked** state in both clients.

So the question is not "is the line correct" but "what should a reader see when
their argument only works if a cited source is wrong?" Today they get a working
argument. After the narrow change they get a blocked review. Either may be
right; it is a product decision, and it belongs to whoever owns the reader's
experience of a contradiction — not to a consistency cleanup.

Note the asymmetry that already exists and is *deliberate*: validity asks a
structural question and gives the citation; evaluation asks the reader's
question, and a reader may disagree with a source
(`AGENTS.md`, "'Grounded' and 'unassignable' are different sets"). An argument
that evaluation-time satisfiability should mirror validity has to answer why
this asymmetry is different from that one.

## Meta changes

Whichever way it resolves, the two call sites should stop being able to disagree
silently — either they share one source for the set, or the difference is named
where both are read.

A reproduction is a starting point regardless: one argument, one cited claim,
one premise that holds only when the citation is false; assert that
`checkValidity` and `evaluateArgument` currently disagree about whether the
premise set can hold. That test is worth writing before the product question is
settled, because it makes the disagreement concrete rather than described.
