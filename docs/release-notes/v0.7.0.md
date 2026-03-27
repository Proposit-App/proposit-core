# Release Notes

## Argument Forking

You can now fork an argument to create an independent copy for responding to, critiquing, or expanding on existing arguments.

- **`forkArgument()`** on `ArgumentEngine` creates a new argument with fresh entity IDs and full provenance tracking back to the original
- Every forked entity (premises, expressions, variables) carries `forkedFrom` metadata identifying its source
- The returned remap table maps original IDs to new IDs for application use
- Forked entities are fully mutable — modify, add, or remove anything in the fork without affecting the source
- Subclasses can override `canFork()` to restrict which arguments may be forked (e.g., only published ones)

## Fork-Aware Diffing

The diff system now supports pluggable entity matchers for comparing arguments that don't share entity IDs.

- **`createForkedFromMatcher()`** returns matchers that pair forked entities with their originals using provenance metadata
- New matcher options (`premiseMatcher`, `variableMatcher`, `expressionMatcher`) on `TCoreDiffOptions` allow custom pairing strategies
- Use `diffArguments(original, fork, { ...createForkedFromMatcher() })` to see exactly what changed in a fork

## Cross-Argument Variable Binding

Variables can now reference premises in other arguments, enabling structured responses and inter-argument reasoning.

- **`createPremise()`** now auto-creates a premise-bound variable for each new premise, making every premise automatically referenceable in other premises' expression trees
- **`bindVariableToExternalPremise()`** creates a variable bound to a premise in another argument — the binding is navigational, and the variable is evaluator-assigned (like claims)
- **`bindVariableToArgument()`** is a convenience for binding to another argument's conclusion premise
- External bindings are included in truth-table generation as free variables
- Subclasses can override `canBind()` to restrict which external arguments may be referenced
