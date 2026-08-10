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
