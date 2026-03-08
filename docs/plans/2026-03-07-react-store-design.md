# React Store Integration Design

## Goal

Make `ArgumentEngine` usable in React via the `useSyncExternalStore` API (React 18+), without adding React as a dependency. The engine becomes a subscribable external store with structurally-shared snapshots for fine-grained reactivity.

## Approach

Add `subscribe()` and `getSnapshot()` to `ArgumentEngine`, matching the contract expected by `useSyncExternalStore`. Snapshots use structural sharing so that unchanged slices keep referential identity, enabling selectors to prevent unnecessary re-renders.

No new classes, no React dependency, no per-entity subscription channels.

## API Surface

Two new methods on `ArgumentEngine`:

```ts
subscribe(listener: () => void): () => void
getSnapshot(): TReactiveSnapshot<TArg, TPremise, TExpr, TVar>
```

- `subscribe` accepts a callback, returns an unsubscribe function.
- `getSnapshot` returns a cached, structurally-shared snapshot. Same reference if nothing has changed. Delegates to the protected `buildReactiveSnapshot()` method — subclasses override that to extend the snapshot while preserving `getSnapshot`'s stable identity (arrow function) for `useSyncExternalStore`.

Consumer usage in React:

```tsx
const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot)

// Fine-grained selection — only re-renders when this expression changes:
const expression = useSyncExternalStore(
    engine.subscribe,
    () => engine.getSnapshot().premises[premiseId].expressions[exprId]
)
```

## Snapshot Structure

```ts
type TReactiveSnapshot<TArg, TPremise, TExpr, TVar> = {
    argument: TArg
    variables: Record<string, TVar>
    premises: Record<
        string,
        {
            premise: TPremise
            expressions: Record<string, TExpr>
            rootExpressionId: string | undefined
        }
    >
    roles: TCoreArgumentRoleState
}
```

Records keyed by ID for direct selector lookups without `.find()`.

## Structural Sharing

When a mutation occurs, only changed slices get new object references. Everything else is reused from the previous snapshot.

Granularity:

- Expression mutation in premise A: new `premises["A"]` and `premises["A"].expressions` objects. `premises["B"]` keeps the same reference.
- Variable updated: new `variables` object. All `premises` references unchanged.
- Role change: new `roles` object. Everything else unchanged.

## Dirty Tracking

```ts
private dirty = {
  argument: false,
  variables: false,
  roles: false,
  premiseIds: new Set<string>(),
};
```

After each mutation, the engine reads the changeset and flips the relevant flags:

- `changes.expressions` entries: add each expression's `premiseId` to `dirty.premiseIds`
- `changes.variables` has entries: `dirty.variables = true`
- `changes.roles` present: `dirty.roles = true`
- `changes.argument` present: `dirty.argument = true`
- `changes.premises` has entries: add their IDs to `dirty.premiseIds`

`getSnapshot()` rebuilds only dirty slices, clears the flags, caches the result. No new tracking infrastructure — piggybacks on existing changeset returns.

## Subscribe/Notify Mechanism

```ts
// ArgumentEngine
private listeners: Set<() => void> = new Set();

subscribe(listener: () => void): () => void {
  this.listeners.add(listener);
  return () => this.listeners.delete(listener);
}

private notifySubscribers(): void {
  for (const listener of this.listeners) {
    listener();
  }
}
```

Notifications fire synchronously after every mutation.

`getSnapshot()` is lazy: notification tells React "something changed." The actual snapshot rebuild happens when React calls `getSnapshot()` during render.

## PremiseEngine Notification

ArgumentEngine passes a callback when constructing each PremiseEngine:

```ts
new PremiseEngine(..., { onMutate: () => this.markDirtyAndNotify(premiseId) });
```

PremiseEngine calls `this.options.onMutate()` at the end of each mutation method. This ensures mutations through PremiseEngine trigger ArgumentEngine's subscribers without adding a separate subscription layer.

## Integration Points

### ArgumentEngine (modified)

- Add `listeners` set, `subscribe()`, `notifySubscribers()`, `getSnapshot()`, `buildReactiveSnapshot()`
- `getSnapshot` is an arrow function (stable identity for React) that delegates to the protected `buildReactiveSnapshot()` method
- Subclasses extend snapshot content by overriding `buildReactiveSnapshot()` and calling `super.buildReactiveSnapshot()`
- Add `dirty` flags and `markDirty(changeset)` helper
- After every mutation method (`createPremise`, `removePremise`, `addVariable`, `removeVariable`, `updateVariable`, `setConclusionPremise`, `clearConclusionPremise`, `rollback`), call `markDirty(changeset)` then `notifySubscribers()`
- Pass `onMutate` callback when constructing PremiseEngines

### PremiseEngine (modified)

- Accept optional `onMutate` callback in constructor options
- Call it at the end of each mutation method (`addExpression`, `appendExpression`, `addExpressionRelative`, `updateExpression`, `removeExpression`, `insertExpression`, `deleteExpressionsUsingVariable`)

### Unchanged

- ExpressionManager, VariableManager (internal — PremiseEngine's callback handles propagation)
- Types, schemas, evaluation, validation, diff
- Existing return types or method signatures

### Exports

- `TReactiveSnapshot` type from `src/lib/types/`
- No new runtime dependencies
