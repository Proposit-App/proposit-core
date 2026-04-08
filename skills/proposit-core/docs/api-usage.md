# proposit-core API Reference

## 1. Creating an Argument

```typescript
import { ArgumentEngine } from "@proposit/proposit-core"

const engine = new ArgumentEngine({
    id: "arg-1",
    version: 0,
    title: "My Argument",
    description: "Description",
})
```

- Constructor accepts `Omit<TCoreArgument, "checksum">` -- extra fields allowed (`additionalProperties: true` in schema).
- Optional second parameter: `{ checksumConfig?: TCoreChecksumConfig }`.
- Retrieve metadata: `engine.getArgument()` returns `TCoreArgument` (with checksum).

## 2. Variable Management

Variables are argument-scoped. A single `VariableManager` is shared across all premises.

```typescript
// Add
const { result: variable, changes } = engine.addVariable({
    id: "v1",
    argumentId: "arg-1",
    argumentVersion: 0,
    symbol: "P",
})

// Update (rename)
engine.updateVariable("v1", { symbol: "Q" })

// Remove -- cascades: deletes all referencing expressions across all premises (with operator collapse)
engine.removeVariable("v1")

// Read
engine.getVariables() // TCorePropositionalVariable[] (sorted by ID, with checksums)
```

**Signatures:**

| Method                                           | Returns                                                        |
| ------------------------------------------------ | -------------------------------------------------------------- |
| `engine.addVariable(variable)`                   | `TCoreMutationResult<TCorePropositionalVariable>`              |
| `engine.updateVariable(variableId, { symbol? })` | `TCoreMutationResult<TCorePropositionalVariable \| undefined>` |
| `engine.removeVariable(variableId)`              | `TCoreMutationResult<TCorePropositionalVariable \| undefined>` |
| `engine.getVariables()`                          | `TCorePropositionalVariable[]`                                 |

**Throws:** duplicate symbol, duplicate ID, mismatched `argumentId`/`argumentVersion`.

## 3. Premise CRUD

```typescript
// Create (auto-generated UUID)
const { result: pm, changes } = engine.createPremise({ title: "Premise 1" })

// Create with explicit ID
const { result: pm2 } = engine.createPremiseWithId("p-1", {
    title: "Premise 1",
})

// Remove
const { result: removedData } = engine.removePremise("p-1")

// Read
engine.getPremise("p-1") // PremiseManager | undefined
engine.hasPremise("p-1") // boolean
engine.listPremiseIds() // string[] (sorted)
engine.listPremises() // PremiseManager[] (sorted by ID)
```

- `extras` is `Record<string, unknown>` -- preserved via `additionalProperties` (e.g. `{ title: "..." }`).
- First premise created is auto-assigned as conclusion (reflected in changeset `changes.roles`).

**Signatures:**

| Method                                    | Returns                                          |
| ----------------------------------------- | ------------------------------------------------ |
| `engine.createPremise(extras?)`           | `TCoreMutationResult<PremiseManager>`            |
| `engine.createPremiseWithId(id, extras?)` | `TCoreMutationResult<PremiseManager>`            |
| `engine.removePremise(premiseId)`         | `TCoreMutationResult<TCorePremise \| undefined>` |

## 4. Expression Tree

### Insertion APIs (prefer the top two)

```typescript
const pm = engine.getPremise("p-1")!

// 1. Append as last child (position auto-computed)
const { result: expr } = pm.appendExpression(null, {
    id: "e-root",
    type: "operator",
    operator: "implies",
    argumentId: "arg-1",
    argumentVersion: 0,
    parentId: null, // ignored for appendExpression -- parentId comes from first arg
})

// 2. Insert relative to sibling
pm.addExpressionRelative("e-sibling", "before", {
    id: "e-new",
    type: "variable",
    variableId: "v1",
    argumentId: "arg-1",
    argumentVersion: 0,
    parentId: "e-root", // ignored -- derived from sibling's parent
})

// 3. Low-level with explicit position
pm.addExpression({
    id: "e-3",
    type: "variable",
    variableId: "v1",
    argumentId: "arg-1",
    argumentVersion: 0,
    parentId: "e-root",
    position: 0,
})
```

**Input types:**

- `appendExpression` and `addExpressionRelative`: `TExpressionWithoutPosition` (no `position` or `checksum`).
- `addExpression`: `TExpressionInput` (no `checksum`, but has `position`).

### Other mutations

```typescript
// Insert (wraps existing nodes under new operator)
pm.insertExpression(newOperatorExpr, leftNodeId, rightNodeId)

// Update in-place (restricted swaps: and<->or, implies<->iff)
pm.updateExpression("e-1", { operator: "or" })
pm.updateExpression("e-var", { variableId: "v2" })
pm.updateExpression("e-1", { position: 5 })

// Remove
pm.removeExpression("e-1", true) // deleteSubtree=true: delete subtree + operator collapse
pm.removeExpression("e-1", false) // deleteSubtree=false: promote single child into slot
```

**Signatures:**

| Method                                                         | Returns                                                          |
| -------------------------------------------------------------- | ---------------------------------------------------------------- |
| `pm.appendExpression(parentId, expr)`                          | `TCoreMutationResult<TCorePropositionalExpression>`              |
| `pm.addExpressionRelative(siblingId, "before"\|"after", expr)` | `TCoreMutationResult<TCorePropositionalExpression>`              |
| `pm.addExpression(expr)`                                       | `TCoreMutationResult<TCorePropositionalExpression>`              |
| `pm.insertExpression(expr, leftNodeId?, rightNodeId?)`         | `TCoreMutationResult<TCorePropositionalExpression>`              |
| `pm.updateExpression(id, updates)`                             | `TCoreMutationResult<TCorePropositionalExpression>`              |
| `pm.removeExpression(id, deleteSubtree)`                       | `TCoreMutationResult<TCorePropositionalExpression \| undefined>` |

**Read methods:**

| Method                             | Returns                                               |
| ---------------------------------- | ----------------------------------------------------- |
| `pm.getExpression(id)`             | `TCorePropositionalExpression \| undefined`           |
| `pm.getExpressions()`              | `TCorePropositionalExpression[]` (sorted by ID)       |
| `pm.getChildExpressions(parentId)` | `TCorePropositionalExpression[]` (sorted by position) |
| `pm.getRootExpression()`           | `TCorePropositionalExpression \| undefined`           |
| `pm.getRootExpressionId()`         | `string \| undefined`                                 |

### Expression type rules

- `implies` and `iff` must be root (`parentId: null`). Cannot be nested.
- `not`: exactly 1 child. Cannot swap operator (delete and re-create instead).
- `and`/`or`: 2+ children. Can swap between each other.
- `implies`/`iff`: exactly 2 children at positions 0 and 1. Can swap between each other.
- `formula`: transparent unary wrapper (1 child). Equivalent to parentheses.

### Operator collapse (on remove with `deleteSubtree: true`)

After deleting a subtree, `collapseIfNeeded` runs on the parent:

- **0 children left**: parent operator/formula deleted, recurse to grandparent.
- **1 child left**: parent deleted, surviving child promoted into parent's slot.

## 5. Roles

```typescript
engine.setConclusionPremise("p-1")
engine.clearConclusionPremise()
engine.getConclusionPremise() // PremiseManager | undefined
engine.listSupportingPremises() // PremiseManager[] -- derived: inference premises not the conclusion
engine.getRoleState() // TCoreArgumentRoleState: { conclusionPremiseId?: string }
```

- Supporting premises are **derived**, not explicitly managed. Any inference premise (`implies`/`iff` root) that is not the conclusion is automatically supporting.
- `setConclusionPremise` and `clearConclusionPremise` return `TCoreMutationResult<TCoreArgumentRoleState>`.

## 6. Evaluation

### Premise-level

```typescript
const result = pm.evaluate({
    variables: { v1: true, v2: false, v3: null },
    rejectedExpressionIds: ["e-5"],
})
// result: TCorePremiseEvaluationResult
// result.rootValue -- TCoreTrivalentValue (true | false | null)
// result.expressionValues -- Record<string, TCoreTrivalentValue>
// result.inferenceDiagnostic -- for implies/iff roots
```

### Argument-level

```typescript
const result = engine.evaluate({
    variables: { v1: true, v2: false },
    rejectedExpressionIds: [],
})

if (result.ok) {
    result.isAdmissibleAssignment // TCoreTrivalentValue
    result.allSupportingPremisesTrue // TCoreTrivalentValue
    result.conclusionTrue // TCoreTrivalentValue
    result.isCounterexample // TCoreTrivalentValue
    result.preservesTruthUnderAssignment // TCoreTrivalentValue
    result.conclusion // TCorePremiseEvaluationResult
    result.supportingPremises // TCorePremiseEvaluationResult[]
    result.constraintPremises // TCorePremiseEvaluationResult[]
}
```

**Options:** `engine.evaluate(assignment, { validateFirst?, includeExpressionValues?, includeDiagnostics?, strictUnknownAssignmentKeys? })`

### Validity check

```typescript
const result = engine.checkValidity({
    mode: "firstCounterexample", // or "exhaustive"
    maxVariables: 20,
    maxAssignmentsChecked: 1_000_000,
})

if (result.ok) {
    result.isValid // true | false | undefined (undefined = truncated)
    result.counterexamples // TCoreCounterexample[]
    result.checkedVariableIds // string[]
    result.numAssignmentsChecked
    result.numAdmissibleAssignments
    result.truncated // boolean
}
```

### Structural validation

```typescript
const validation = engine.validateEvaluability()
// validation: TCoreValidationResult { ok: boolean, issues: TCoreValidationIssue[] }
// Also: pm.validateEvaluability() for premise-level
```

## 7. Diffing

```typescript
import {
    diffArguments,
    defaultCompareArgument,
    defaultCompareVariable,
    defaultComparePremise,
    defaultCompareExpression,
} from "@proposit/proposit-core"

const diff = diffArguments(engineA, engineB, {
    compareArgument: defaultCompareArgument,
    compareVariable: defaultCompareVariable,
    comparePremise: defaultComparePremise,
    compareExpression: defaultCompareExpression,
})
// diff: TCoreArgumentDiff
// diff.argument -- TCoreEntityFieldDiff<TCoreArgument>
// diff.variables -- TCoreEntitySetDiff<TCorePropositionalVariable>
// diff.premises -- TCorePremiseSetDiff (with nested expression diffs)
// diff.roles -- TCoreRoleDiff
```

- Standalone function. Pluggable comparators (each receives before/after, returns `TCoreFieldChange[]`).
- All options optional -- defaults are used when omitted.

## 8. Relationship Analysis

```typescript
import {
    analyzePremiseRelationships,
    buildPremiseProfile,
} from "@proposit/proposit-core"

// Analyze how all premises relate to a focused premise
const analysis = analyzePremiseRelationships(engine, "p-conclusion")
// analysis: TCorePremiseRelationshipAnalysis
// analysis.focusedPremiseId
// analysis.premises -- TCorePremiseRelationResult[] per other premise
//   each: { premiseId, relationship, variableDetails, transitive }
//   relationship: "supporting" | "contradicting" | "restricting" | "downstream" | "unrelated"

// Build a variable profile for a single premise
const profile = buildPremiseProfile(pm)
// profile: TCorePremiseProfile
// profile.premiseId
// profile.appearances -- TCoreVariableAppearance[]
```

Both are standalone functions.

## 9. Formula Parsing

```typescript
import { parseFormula } from "@proposit/proposit-core"
import type { FormulaAST } from "@proposit/proposit-core"

const ast: FormulaAST = parseFormula("P -> (Q & R)")
```

**Supported syntax:** `&&`/`∧` (AND), `||`/`∨` (OR), `!`/`¬` (NOT), `->`/`→` (implies), `<->`/`↔` (iff), parentheses.

**AST types:**

```typescript
type FormulaAST =
    | { type: "variable"; name: string }
    | { type: "not"; operand: FormulaAST }
    | { type: "and"; operands: FormulaAST[] }
    | { type: "or"; operands: FormulaAST[] }
    | { type: "implies"; left: FormulaAST; right: FormulaAST }
    | { type: "iff"; left: FormulaAST; right: FormulaAST }
```

## 10. Mutation Result Pattern

Every mutating method returns `TCoreMutationResult<T>`:

```typescript
interface TCoreMutationResult<T> {
    result: T
    changes: TCoreChangeset
}

interface TCoreChangeset {
    expressions?: TCoreEntityChanges<TCorePropositionalExpression>
    variables?: TCoreEntityChanges<TCorePropositionalVariable>
    premises?: TCoreEntityChanges<TCorePremise>
    roles?: TCoreArgumentRoleState // present only when roles changed
    argument?: TCoreArgument // present only when argument changed
}

interface TCoreEntityChanges<T> {
    added: T[]
    modified: T[]
    removed: T[]
}
```

**Usage pattern:**

```typescript
const { result: premise, changes } = engine.createPremise()
changes.premises?.added // newly added premise
changes.roles // new role state (if changed, e.g. auto-conclusion)
changes.expressions?.removed // cascaded removals (e.g. from removeVariable)
```

## 11. Serialization

### PremiseManager

| Method                                     | Returns                                               | Description                                       |
| ------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------- |
| `pm.toData()`                              | `TCorePremise`                                        | Serializable snapshot (only referenced variables) |
| `pm.toDisplayString()`                     | `string`                                              | Human-readable formula (`P -> (Q /\ R)`)          |
| `pm.isInference()`                         | `boolean`                                             | Root is `implies` or `iff`                        |
| `pm.isConstraint()`                        | `boolean`                                             | Not an inference (inverse of above)               |
| `pm.checksum()`                            | `string`                                              | Premise-level checksum (lazy)                     |
| `pm.getId()`                               | `string`                                              | Premise ID                                        |
| `pm.getExtras()`                           | `Record<string, unknown>`                             | Extra fields (e.g. title)                         |
| `pm.setExtras(extras)`                     | `TCoreMutationResult<Record<string, unknown>>`        | Replace extras                                    |
| `pm.getReferencedVariableIds()`            | `Set<string>`                                         | Variable IDs used in expressions                  |
| `pm.getVariables()`                        | `TCorePropositionalVariable[]`                        | All argument-level variables                      |
| `pm.deleteExpressionsUsingVariable(varId)` | `TCoreMutationResult<TCorePropositionalExpression[]>` | Cascade delete                                    |

### ArgumentEngine

| Method                                | Returns                           | Description                     |
| ------------------------------------- | --------------------------------- | ------------------------------- |
| `engine.toData()`                     | `TCoreArgumentEngineData`         | Full state snapshot             |
| `engine.exportState()`                | `TCoreArgumentEngineData`         | Alias for `toData()`            |
| `engine.getArgument()`                | `TCoreArgument`                   | Argument metadata with checksum |
| `engine.checksum()`                   | `string`                          | Argument-level checksum (lazy)  |
| `engine.collectReferencedVariables()` | `{ variableIds, byId, bySymbol }` | Cross-premise variable index    |

## 12. Checksum Utilities

```typescript
import {
    computeHash,
    canonicalSerialize,
    entityChecksum,
    DEFAULT_CHECKSUM_CONFIG,
    createChecksumConfig,
} from "@proposit/proposit-core"

// Low-level hash
const hash = computeHash("input string")

// Serialize object to canonical deterministic JSON (sorted keys)
const serialized = canonicalSerialize({ a: 1, b: 2 })

// Entity checksum
const checksum = entityChecksum(entity, new Set(["id", "symbol"]))

// Custom config
const config = createChecksumConfig({
    expressionFields: new Set([
        "id",
        "type",
        "operator",
        "variableId",
        "parentId",
        "position",
    ]),
    variableFields: new Set(["id", "symbol"]),
})
const engine = new ArgumentEngine(arg, { checksumConfig: config })
```

## 13. Position Utilities

```typescript
import {
    POSITION_MIN, // 0
    POSITION_MAX, // Number.MAX_SAFE_INTEGER
    POSITION_INITIAL, // midpoint(POSITION_MIN, POSITION_MAX)
    midpoint, // (a, b) => a + (b - a) / 2
} from "@proposit/proposit-core"
```

Positions are opaque numbers. Only relative ordering matters. The `appendExpression` and `addExpressionRelative` APIs compute positions automatically -- prefer those over manual positioning.
