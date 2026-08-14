# Upcoming

## Added

### Ask for all of a claim's variables, not just one

A claim can be represented by more than one variable in the same argument —
the library never stopped you from adding a second, and applications built on
it routinely have two: the one an author wrote and the one that came with the
step that derives the claim. Each is reached and valued on its own during a
review, so they can end up saying different things about the same claim.

`getVariableIdForClaim` only ever answered with one of them, and its
description read as though there were only one to give. Anything asking "what
did the review conclude about this claim?" through it could therefore read the
wrong variable and show a claim as undecided while the argument's own summary
said otherwise.

There is now `getVariableIdsForClaim`, which gives you every variable standing
for the claim. Use it wherever dropping one would be wrong.

## Changed

### A claim's other variable no longer breaks a derivation step

`getVariableIdForClaim` still answers with a single variable and still answers
the same one it always did, so nothing that calls it changes behavior. What
changed is its description: it now says plainly that a claim may have several
variables, that the one it hands back is picked in a fixed order rather than
because it is special, and when to reach for the new list instead.

The structural check on a derivation step made the same wrong assumption and
did have teeth: if the claim being derived had two variables and the step named
the second one, the check reported the step as malformed even though it was
correctly built. A step is now accepted when it names any variable standing for
the claim it derives.
