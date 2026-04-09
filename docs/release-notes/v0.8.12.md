# Release Notes

## Granular Auto-Normalization

The `autoNormalize` setting now accepts a configuration object for fine-grained control over which automatic structural corrections are applied during expression mutations.

Previously, `autoNormalize` was an all-or-nothing boolean — either all automatic behaviors were enabled, or none were. This made it difficult for applications that need some normalizations (e.g., auto-inserting formula buffers when wrapping) but not others (e.g., collapsing empty formulas after deletion).

You can now pass an object with four independent flags:

- **`wrapInsertFormula`** — auto-insert formula nodes when adding, inserting, or wrapping expressions would create an operator directly under another operator.
- **`negationInsertFormula`** — auto-insert a formula buffer when toggling negation on a non-not operator.
- **`collapseDoubleNegation`** — when toggling negation on a NOT expression, remove the existing NOT instead of wrapping in another NOT.
- **`collapseEmptyFormula`** — auto-collapse empty operators and formulas after removing expressions.

Using `true` or `false` continues to work as before — `true` enables all four behaviors, `false` disables all.

Loading from snapshots or data (`fromSnapshot`, `fromData`) only runs post-load normalization when `autoNormalize` is `true` (boolean). Granular config objects skip post-load normalization, giving applications full control over their persisted data.
