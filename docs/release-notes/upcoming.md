# Upcoming

## Fixed

### A cited source is taken at its word everywhere, not just in the exhaustive check

The engine asks two separate questions about an argument, and until now they
disagreed about citations. The exhaustive "check every possible assignment"
search treated a cited claim as given — that shipped in 4.0.1 — but the ordinary
evaluation that runs every time you review an argument still treated it as an
open question when checking whether the premises can all hold at once.

They now agree. An argument whose premises only hold if a cited source says the
opposite of what it actually says is reported as contradicting itself, in review
as well as in the check.

**Disagreeing with a source still works exactly as before.** Marking a cited
claim true or false is your call, it is recorded as your call, and the argument
still reports honestly whether it reaches its conclusion without your having to
assert anything. Only the "can these premises hold together at all" question
takes the source at its word — and that question was never yours to answer.

Measured against the 114 published arguments in a development database: nothing
became blocked that was not blocked before, and thirteen arguments that
previously could not be settled either way now get a straight answer.
