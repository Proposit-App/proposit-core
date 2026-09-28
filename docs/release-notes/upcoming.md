# Upcoming

## Added

### A note for a claim that was never looked up in the source

Finalize now reports `SOURCE_ANCHOR_NOT_ATTEMPTED` (a new member of
`SOURCE_ANCHOR_NOTE_CODES`) for each claim the mention stage produced no
mention for. Before, such a claim had no source anchor and no note, so it read
the same as a claim whose quote failed to resolve — or as success. The note is
a warning with `context: { claimMiniId }`, and it is emitted only when the
mention stage ran and the input carried text. A claim with an empty
`mentionIds` list was, and still is, also reported as `CLAIM_MENTION_LIST_EMPTY`
by claim-reference validation, so a consumer summing warnings sees it twice;
the new code is the one that also covers ids naming no produced mention. A consumer that counts every code
in `SOURCE_ANCHOR_NOTE_CODES` picks it up with no change.

### A note for a mention no claim references

The reverse case is reported too: `SOURCE_ANCHOR_MENTION_UNCLAIMED` (also in
`SOURCE_ANCHOR_NOTE_CODES`) for each mention the mention stage produced that no
claim's `mentionIds` names. Canonicalization is required to map every mention
to a claim, so such a mention means the passage was found and its anchor was
then attached to nothing — the claim it belonged to lost its anchor silently.
A warning, with `context: { mentionId, quote }`, under the same conditions as
`SOURCE_ANCHOR_NOT_ATTEMPTED`.

### Other

- `TLlmOutputCheckFailure`, the `{ code, message }` a stage's `checkOutput`
  returns to refuse an output, is now exported from the package root as well
  as from the pipelines module.

## Changed

### `changeOperator` swaps `and`, `or` and `xor` at any number of operands

`PremiseEngine.changeOperator` used to change an operator's type in place only
when it had two operands or fewer. With three or more it always split: it
required `sourceChildId` and `targetChildId` and threw without them, so a
four-operand `and` could not become `xor` as a whole.

Now, with neither child id given, a change between `and`, `or` and `xor`
updates the operator in place at any number of operands — same id, same
children, same order. That holds unless one of three existing behaviours
applies first: asking for the operator it already has returns it unchanged,
before any rule below; an operator with fewer than two operands whose parent
(or grandparent, through a formula) already has the requested type is merged
into it instead; and in `assistive` behavior normalization may then fold the
changed operator into a same-type operator above it, in which case `result` is
`null`. Nothing else changes for an operator with two operands or fewer, where
the child ids are not read. With three or more:

- naming both child ids still splits them out into a sub-operator, exactly as
  before;
- naming only one still throws, and an empty string passed as a child id
  counts as an id given;
- a change to `implies` or `iff` still throws: they take exactly two operands
  and must be roots, so neither a swap nor a split can produce one there.

The CLI's `expressions change-operator` follows the same rules.

## Fixed

- `changeOperator` returns `null` rather than `undefined` when, in `assistive`
  behavior, the swapped operator is folded into a same-operator operator above
  it by normalization (`or(a, (and(b, c)))` with the inner `and` changed to
  `or`). `null` already meant "the operator no longer exists" for a merge.
