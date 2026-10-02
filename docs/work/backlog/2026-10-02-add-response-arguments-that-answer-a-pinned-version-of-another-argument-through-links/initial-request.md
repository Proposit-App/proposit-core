# Add response arguments that answer a pinned version of another argument through links

## What is wanted

The library should be able to represent one argument answering another, natively, so that a consumer no longer has to build that relationship out of features meant for something else.

Today an argument is one author's set of premises, all asserted together, with one conclusion. Three things follow that make answering an argument impossible to model well:

1. **Copying is not opposing.** The only relationship one argument can have with another is that it was forked from it. People fork to rephrase, extend, restrict or add citations, so a fork cannot also mean "I disagree".
2. **An objection cannot live inside the argument it objects to.** Since every premise is asserted at once, placing `P implies Q` and an attack on it in one argument makes the argument contradict itself.
3. **There is no way to argue that a step does not follow.** A reader's evaluation input can already reject an operator, which withholds the step without asserting anything, but there is no authored, argued form of that. Writing `NOT(P implies Q)` is not a substitute: under material implication it says P is true and Q is false, which is not what someone conceding P and Q but denying the step means.

The requester wants a second kind of argument whose job is to answer one other argument at a pinned version. Every point of contact between the answer and the argument it answers must be logically checkable rather than free text. The answer must be able to do all three standard kinds of attack — denying the conclusion, denying something the argument relies on, and denying that a step follows — and the corresponding kinds of support. Answers can themselves be answered, to any depth.

Beyond representing the answer, the requester wants core to:

- check an answer on its own terms: whether each point it makes follows from the rest of it, and whether it is consistent with itself;
- tell an answer's author what happened to each point of contact when the answered argument is revised, and help bring the answer up to the new version;
- turn a reader's agreement with an answer into input for evaluating the argument it answers, one step at a time along a chain of answers, with a record of where each carried value came from.

The full request as it arrived — including a detailed proposed design, acceptance criteria and four open questions — is the item's `intake.md`. The design there is the requester's proposal; `spec` decides what is built.

## Constraints

- **Boundary.** Core decides only what can be decided from argument content: structure, logic, bindings between arguments, differences between two snapshots, and carrying a reader's answers. Who made what, storage, which versions exist or are available, and presentation stay with the consumer. Core never fetches a snapshot; the caller supplies it. Allow/refuse policy goes through the existing `canBind` hook. Nothing in the public API may name consumer concepts such as accounts, ownership, storage or availability.
- **Core is more permissive than any one consumer.** Every kind of answer is allowed against every expression, including operators inside derivation premises.
- **No existing checksum may change.** Any new field must be absent, not present with a default, on data that does not use it. A test over fixtures captured from the released version must prove it.
- **No existing evaluation result may change value** for any existing input; new facts arrive in new fields.
- **Release.** The version number is core's to decide. A major version is acceptable. If it is a major, the two backlog items that also break compatibility — the calendar-date type for citation dates and the at-most-one operator — ship in the same release (decided by the maintainer when this request was taken in). The release waits for consumer-side validation: build the validation tarball with `pnpm run build && pnpm run pack:branch`, report its path to the requester, and do not release until the requester reports the verdict.
- **Process.** The maintainer asked to stop after the spec and its adversarial review, before planning or code, for review.
- **Public repository.** The item, commits, changelog and release notes describe this in general library terms only.

## Out of scope

- Any concept of who wrote or answered something, and any storage or display behaviour.
- Fetching or listing argument versions.
- Automatically scoring a whole web of answers (abstract argumentation semantics); carrying goes one step at a time, driven by a reader's answers.

## Notes

- References: asked; none provided beyond the in-repo files the intake names.
- The idea was worked out with the maintainer in conversation before the request arrived. Points settled there that the request relies on: forks keep meaning "copied from"; the three kinds of attack (rebutting, undermining, undercutting) map onto denying the conclusion, denying a relied-on statement, and denying a step; a rejection of a step is never a truth value.
- An earlier answer from core, already reflected in the intake: honouring a rejection of the conclusion premise's root step by marking it, not striking it, changes no existing result field and is by itself a minor change; argument kinds with no conclusion are what could justify a major version, since `ARGUMENT_NO_CONCLUSION` is stable wire format.
- Size: very large. Kept as one item because the pieces are meant to be validated and released together; `spec` should say whether any part can ship on its own.

## Added 2026-10-02

After the first adversarial spec review (verdict: NOT DONE), the maintainer delegated the scoping decision. The decision:

- **Split.** Carrying a reader's agreement into the answered argument moves to its own item: `2026-10-02-carry-a-reader-s-agreement-with-a-response-argument-into-the-argument-it-answers`. That covers held statements, the carried layer, evaluating a response under a reader's input, and `carryAnswers`. All five of the review's unresolved evaluation questions sit there.
- **This item keeps** argument kinds, expression-bound links, checking a response, bringing a response up to a newer target version, link references, and the conclusion-step flag.
- **Shipping.** Both items ship in 6.0.0.
- **The fork defect** found while specifying this item ships separately, as a 5.4.3 patch: `2026-10-02-forking-breaks-bindings-into-another-argument`.
- **6.0.0 is not limited to this work.** The maintainer confirmed it will carry many other changes as well.
