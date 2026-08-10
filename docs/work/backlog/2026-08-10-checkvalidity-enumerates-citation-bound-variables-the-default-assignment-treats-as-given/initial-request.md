# checkValidity enumerates citation-bound variables the default assignment treats as given

**This is a question before it is a defect.** Two parts of the engine read the
same claim type in opposite ways, and which one is wrong is a semantics decision,
not a code decision. Please settle the reading before anyone changes a line.

## The inconsistency

`isGroundedVariable` (`argument-engine.ts:2911`) groups the two non-normal claim
types together:

> Returns `true` iff the variable is claim-bound to a citation or axiomatic
> claim — the "grounded" claim types that a default assignment seeds `true`.

The default assignment honours that grouping: rule 1 of `D(claim)`
(`argument-engine.ts:2924`) is "`c` is a citation or axiomatic claim → `true`".

`checkValidity` does not. It carves out **only** the axiomatic half
(`argument-engine.ts:2844`), unioning `getAxiomaticBoundVariableIds()` into both
`excludedVariableIds` and `forcedTrueVariableIds`. A citation-bound variable is
`isClaimBound`, so the filter at `argument-evaluation.ts:946` returns `true` for
it and it becomes a free column in the 2ⁿ enumeration.

So the exhaustive check searches assignments in which a cited source's claim is
**false**, while every other part of the engine hands that same claim `true`
unless the reader says otherwise.

## Why it matters

1. **Reported failing cases may be ones no reader would accept.** A
   counterexample that only exists because a citation was flipped false is a
   statement about a world where the source says the opposite of what it says.
   The check presents it as "an assignment where every premise holds but the
   conclusion does not", which reads as a flaw in the argument.
2. **Every citation doubles the search space.** With
   `SATISFIABILITY_VARIABLE_CEILING = 16`, a citation-heavy argument spends its
   budget on columns the rest of the engine considers settled. Curated arguments
   carry citations on most claims.
3. It is a live inconsistency inside one engine, which is the shape of defect
   this codebase has been bitten by repeatedly — one rule written down twice,
   drifting.

## The two readings

**A citation is given.** A citation claim reports what a source says; the source
says it whether or not the reader likes it. Then `checkValidity` should exclude
citation-bound variables and force them true exactly as it does axiomatic ones —
a two-line change unioning the grounded set instead of the axiomatic set — and
the ceiling immediately buys more room.

**A citation is assertable.** A cited source can be wrong, and a reader is
entitled to reject one; the default assignment only *seeds* it true, and validity
asks what follows regardless of what anyone assumed. Then the current behaviour
is right and the defect is documentary — `isGroundedVariable`'s doc comment and
`D(claim)`'s rule 1 should stop implying the two types behave alike, and the
carve-out's asymmetry should be stated where a reader of `checkValidity` will
find it.

There is a third position worth naming: the answer may differ **per caller**.
Validity as an authoring aid ("does my argument hold up?") wants citations given;
validity as an adversarial check ("what could break this?") wants them free. If
so, the resolution is an option on `TCoreValidityCheckOptions`, defaulted to
whichever reading the product leads with, not a hardcoded choice.

## Origin

Found while investigating why "Check all possible assignments" is disabled on
every argument in `proposit-server`
(`2026-08-10-the-exhaustive-check-is-disabled-on-almost-every-argument-…`). That
one is a separate, unambiguous client-side defect; this is what reading the
engine's exclusion rules turned up alongside it.

## Test, once the reading is settled

An argument with one citation-backed supporting claim: assert what the
enumeration does with that variable — a column, or pinned true and absent — and
pin the resulting failing-case set either way. Whichever reading wins, the
grouping should be stated once and consumed by both call sites, so the next
reader cannot find them disagreeing.
