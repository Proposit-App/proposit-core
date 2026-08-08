---
from: proposit-app
initiative: 2026-08-07-review-verdicts-as-two-axes-with-rejection-striking-premises-from-the-record
---

# Rejection strikes the premise; evaluation emits orthogonal facts

Epic: [Review verdicts as two axes with rejection striking premises from the record](tcw://W/proposit-app/2026-08-07-review-verdicts-as-two-axes-with-rejection-striking-premises-from-the-record)

**Slice A of five. This slice leads the initiative — nothing else can start until
it resolves.**

Adopt with `tcw work new --initiative 2026-08-07-review-verdicts-as-two-axes-with-rejection-striking-premises-from-the-record`,
**not** `tcw work inbox accept` — accept double-dates the slug and drops the
initiative link on a delegated slice. Then `git rm` this file.

## Design of record

`/Users/brian/Projects/Proposit-App/docs/work/active/2026-08-07-review-verdicts-as-two-axes-with-rejection-striking-premises-from-the-record/design.md`

Read it before writing your spec; it carries the model and the reasoning behind
every decision, including two rounds of external review. `spec.md` beside it
carries the initiative's node boundaries and acceptance criteria. This request is
a summary, not a substitute — where they disagree, the design wins.

## Problem

A reviewer's accept/reject decision on a premise's inference is stored and
evaluated as though it were a truth value. It isn't.

Rejecting `P → Q` is currently read as *the conditional is false*, which forces
the antecedent true and the consequent false — two values nobody asserted. The
argument is then reported **unsound**, the reading reserved for a factually false
premise, when the reviewer's objection was that the reasoning doesn't hold. The
reject-reason vocabulary confirms the mismatch: `non-sequitur`,
`correlation-not-causation`, `hasty-generalization`, `circular-inference` are all
claims about inferential warrant, and none says the consequent is false.

Acceptance manufactures facts too: a premise-level decision fans out onto every
non-negation operator, so accepting `(A ∧ B) → C` also "accepts" the conjunction
and forces `A` and `B` true.

Underlying both: three-valued assignments use one representation for "decided
unknown", "skipped" and "never asked", so an explicit *I don't know* is silently
overwritten by propagation.

## Scope

Evaluation semantics only. No UI, no review-flow concerns — those are slices B–E.

1. **Rejection strikes the premise from the record.** A struck premise leaves the
   premise set; it does not contribute `unknown` to the whole-argument
   conjunction, it contributes nothing, and the argument is evaluated as the
   smaller argument that remains. Struck, not deleted — the premise and its
   objection stay in the record; the accurate framing is *the inference
   application is marked unusable for this evaluation*.
2. **Striking is always premise-granular.** The operator a decision is recorded
   against is provenance for the objection, never a different evaluation rule.
   Formulas never contain holes. The conclusion premise is never strikable, and
   derivation premises are never offered.
3. **Accepted-`implies` propagation is preserved.** Modus ponens stays
   load-bearing: accept `P → Q`, hold `P` true, derive `Q` true — including over a
   prior explicit *unknown*, which is correct.
4. **Explicit unknown is distinguished from never-asked and from skipped.**
5. **Premise-set satisfiability check**, classical SAT over the premise set alone,
   ignoring the reader's assignment. Derivation is suppressed entirely while the
   *surviving* set is unsatisfiable. Note the set is the surviving one, not the
   authored one — striking can restore satisfiability.
6. **Empty-surviving-set guard.** "All supporting premises true" is a conjunction
   over surviving premises and an empty conjunction is vacuously true, so striking
   every supporting premise would satisfy it. Striking makes that path reachable
   for the first time; it must never read as an argument that reached its
   conclusion.
7. **Orthogonal facts replace the single grade.** Emit facts, not a named-grade
   enum under a precedence ladder; the UI composes the label. The six facts are in
   the design's §5 table.
8. **Conclusion attribution is two facts, not one winner** — was it asserted by
   the reader, and would it still be derivable with that assertion withheld. The
   counterfactual must be an intervention followed by fresh derivational closure,
   and closure must be a **least fixed point**, or mutually supporting premises
   certify each other and a cycle reports as an independent derivation.
9. **Per-value provenance**, extended to intermediate claims — slice B's
   contradiction alert must name the chain that produced a derived value.
10. **`inadmissible` is demoted** from a grade to a reported condition. The word
    keeps its existing meaning (an assignment violating a restriction premise);
    this design says *struck*, never *inadmissible*, for refusal.

Breaking → **major** bump.

## Open questions this slice must settle in its spec

1. **The final assessment vocabulary.** The words in the design's §5 label table
   are illustrative, not names. Hard constraint from external review: **no proof
   language** — *reaches its conclusion* / *does not reach its conclusion*, never
   *proved*, because every assessment is relative to one reader's assignment and
   may rest on inductively-accepted steps.
2. **Where the existing grade words re-home.** `sound` / `unsound` /
   `vacuously-true` / `counterexample` are argument-quality language currently
   applied to the conclusion. Mapping each onto one of the two axes is the deep
   fix for the pill/verdict contradiction.

## Acceptance criteria owned by this slice

1. Rejecting an inference never produces a truth value for any atom. Specifically,
   rejecting `P → Q` with `P` true and `Q` unknown leaves `Q` unknown.
2. Accepting `(A ∧ B) → C` assigns nothing to `A` or `B`.
3. A claim decided *unknown* is never overwritten except by an inference the
   reader granted.
4. Striking every supporting premise never yields a *proved* reading.
5. The water-and-mammals shape — conclusion "water is made of hydrogen and
   oxygen", supported solely by "if mammals are warm-blooded, then water is made
   of hydrogen and oxygen" — reports the conclusion true and the argument as
   having established nothing.
6. The redundant-support shape (`A → C`, `B → C`, first struck, second granted)
   reports the conclusion established and one premise refused.

One engine test per criterion, named so the mapping is visible.

Shared with other slices: criterion 8 (satisfiability and derivation suppression
are this slice's half), criterion 9 (this slice emits the facts the clients
compose), criterion 10 (this slice fixes the vocabulary; every slice reviews its
own shipped copy against it).

## Out of scope

- Predicate-calculus support, and with it any representation of inductive
  strength. **Known accepted limitation:** all acceptances propagate identically,
  so granting a merely inductive step yields a categorically true consequent
  (*most birds fly; Tweety is a bird*). Deferred deliberately — it belongs in the
  logic, not in review metadata. Do not patch it with a defeasibility flag. Do not
  record it as "the next engine version fixes it": predicate calculus is a
  prerequisite, not the whole answer.
- Any static entailment check. Authors deliberately leave antecedents for readers
  to value, so `{A → C} ⊭ C` for nearly every well-formed argument in the system;
  a classical entailment check would report almost all of them invalid. Only the
  reader-relative version survives.
- Computing whether a refusal was load-bearing (the per-refusal counterfactual).
- Scoped assumptions and discharge.

## Publish handling — read before planning

**This slice completes without publishing.** Code merged and tagged, plus
`pnpm run build && pnpm run pack:branch` for a branch-suffixed validation tarball.
Never plain `pnpm pack` — it names the file by version alone, so two branches at
the same version overwrite each other in a directory a consumer is pinned to.

The npm release happens once at the end of the initiative, coordinated at the
workspace root, after all five slices are code-complete. Reason: this slice
deletes `TCoreEvaluationGrade`, which `proposit-server` and `proposit-mobile` both
render, so every consumer's gate is red by construction until slices B and E
repair them — and the root's validation policy requires every consumer green
before a PUBLISH READY verdict. **Expect the consumers red. That is the signal
the slice worked, not a regression to chase.**
