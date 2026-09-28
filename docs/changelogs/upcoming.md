# Upcoming

## Internal

- `PremiseEngine`'s read-only routines moved out of the class into module
  functions under `src/lib/core/premise/`, over a `TPremiseReadContext` whose
  fields read back from the engine when used: the formula-tree walks
  (`formula-tree.ts`), the evaluability check (`evaluability.ts`), evaluation
  (`evaluation.ts`) and the invariant sweep (`invariants.ts`). The class keeps
  one-line delegating methods, so its public surface is unchanged, and
  `premise-engine.ts` is about 530 lines shorter. `evaluate` still calls
  `this.validateEvaluability()` and `this.isInference()`, and `validate` still
  calls `this.toPremiseData()` first, so overriding any of them keeps its
  effect.
