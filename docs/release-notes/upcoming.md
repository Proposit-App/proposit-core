# Upcoming

## Changed

### `orderChangeset` runs an update after the insert it depends on

`orderChangeset` used to run every expression update before any insert. An
update that moved an expression under an operator the same changeset
inserts, or onto a variable it inserts, therefore ran before that row
existed. A store that checks foreign keys on every statement rejects it.
`wrapExpression`, `insertExpression` and `toggleNegation` produce the first
kind on their own. Changesets combined with `composeChangesets` can produce
the second.

Now such an update is split in two. First it gets the same detaching update
a removed expression gets (`{ id, parentId: null, position: 0 }`), before
the deletes. Then the full update runs right after the inserts. When one of
these points at a new variable, the variable and premise deletes also wait
until after it. Changesets without such an update are ordered exactly as
before.

If your persistence layer holds back updates that point at a newly inserted
parent until after its inserts, as proposit-app's server does, remove that
workaround. `orderChangeset` does it now. Keeping it can reorder an update
past a variable delete that was held back for it. With a cascading variable
key, that loses the row.

One case is still unsafe for a store that checks per statement that
variable symbols are unique: a changeset that removes a variable and
inserts another with the same symbol, while also moving an expression onto
a new variable.
