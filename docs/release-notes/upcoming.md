# Upcoming

## Added

### API reference for every subpath

The generated API reference now covers four subpaths it left out:
`extensions/openai`, `extensions/chat-completions`, `builder` and
`pipelines/scheduling`. Two types their signatures already used are now
exported where you can name them:

- `TChatCompletionsFetch`, the type of the chat-completions provider's
  `fetch` option;
- `TStageOutcomeRecordMap`, the record map the scheduling helpers take.

## Changed

### `orderChangeset` runs an update after the insert it depends on

`orderChangeset` used to run every expression update before any insert. An
update that moved an expression under an operator the same changeset
inserts, or onto a variable it inserts, therefore ran before that row
existed. A store that checks foreign keys on every statement rejects it.
`wrapExpression`, `insertExpression` and `toggleNegation` produce the first
kind on their own. Changesets combined with `composeChangesets` can produce
the second.

Now such an update is split in two. First, before the deletes, it moves the
expression to the root (`parentId: null, position: 0`). If the update needs
only a new parent, this first write carries the rest of the new row too. If
it points at a new variable, it carries nothing else, like the update a
removed expression gets. Then the full update runs right after the inserts.
When one of these points at a new variable, the variable and premise deletes
also wait until after it. Changesets without such an update are ordered exactly as
before.

If your persistence layer holds back updates that point at a newly inserted
parent until after its inserts, as proposit-app's server does, remove that
workaround. `orderChangeset` does it now. Keeping it can reorder an update
past a variable delete that was held back for it. With a cascading variable
key, that loses the row.

Two cases are still unsafe, both only when a changeset moves an expression
onto a new variable, so that the deletes wait. They involve a unique rule
checked per statement:

- a variable is inserted with the symbol of one being removed;
- a premise is inserted as the conclusion while the removed conclusion
  premise still exists.

Making such rules deferred, so they are checked at the end of the
transaction, removes both.
