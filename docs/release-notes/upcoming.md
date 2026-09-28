# Upcoming

## Changed

### `changeOperator` swaps `and`, `or` and `xor` at any number of operands

`PremiseEngine.changeOperator` used to swap an operator's type in place only
when it had two operands. With three or more it always split: it required
`sourceChildId` and `targetChildId` and threw without them, so a four-operand
`and` could not become `xor` as a whole.

Now, with neither child id given, a change between `and`, `or` and `xor`
updates the operator in place at any number of operands — same id, same
children, same order. Naming both child ids still splits them out into a
sub-operator, exactly as before. A change to `implies` or `iff` on an operator
with three or more operands still needs both ids (those operators take exactly
two operands), as does a call naming only one. The CLI's
`expressions change-operator` follows the same rules.

## Added

- `TLlmOutputCheckFailure`, the `{ code, message }` a stage's `checkOutput`
  returns to refuse an output, is now exported from the package root as well
  as from the pipelines module.
