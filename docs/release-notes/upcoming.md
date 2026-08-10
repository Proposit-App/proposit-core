# Upcoming

## Changed

### A cited source is taken at its word when checking an argument

**Read this if your application offers the exhaustive "check every possible
assignment" search.** That search used to consider worlds in which a cited
claim is false — so it could report a failing case that only exists if the
source says the opposite of what it actually says. Nobody reading an argument
means that.

Citations are now **given**, exactly as self-evident claims already were: the
search fixes them true and does not treat them as an open question. Two
consequences:

- An argument whose only failing case needed a citation to be false is now
  reported as holding up.
- The search is smaller. Each citation used to double the work, and the search
  refuses to run past a fixed size — so arguments that were too big to check
  may now be checkable.

This does not change what a reader may say. You can still disagree with a
cited claim while reviewing, and doing so still moves the result; a citation is
simply not something the _exhaustive check_ second-guesses on your behalf.
Self-evident claims remain unassignable, as before.

### Larger arguments can be checked for contradictory premises

Before deciding what an argument establishes, the engine asks whether its
premises can all hold at once — a premise set that contradicts itself licenses
nothing. That question was answered by trying every combination of every claim
in the argument together, which gets expensive quickly and was simply declined
past a fixed size.

Claims that cannot affect each other are no longer tried against each other.
Most arguments split into small clusters — a few premises about one thing, a few
about another — and each cluster is now settled on its own. A claim that appears
only in the conclusion is not tried at all, since it cannot affect whether the
premises hold.

Two consequences:

- Arguments that were too large to answer may now be answered. The size limit
  applies to the largest cluster rather than to the whole argument.
- Ordinary review is cheaper, because this question is asked every time an
  argument is evaluated, not only when the exhaustive check is run.

Answers are unchanged. Anything reported before is reported the same way now —
there is simply less work behind it. Note that the saving depends on the shape
of the argument: one where everything genuinely connects to everything costs
exactly what it did before.
