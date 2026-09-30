# Types & Schemas Reference

Quick-reference for all exported types. For API usage, see [api-usage.md](./api-usage.md).

---

## 1. Expression Types

**Source:** `src/lib/schemata/propositional.ts`, `src/lib/core/ExpressionManager.ts`

### `TCorePropositionalExpression<T>`

Discriminated union on `type`. Generic parameter `T` narrows the union (defaults to all three).

**Common fields (all variants):**

| Field             | Type             | Notes                           |
| ----------------- | ---------------- | ------------------------------- |
| `id`              | `string`         | UUID                            |
| `argumentId`      | `string`         | UUID                            |
| `argumentVersion` | `number`         |                                 |
| `parentId`        | `string \| null` | `null` for root expressions     |
| `position`        | `number`         | `>= 0`, ordering among siblings |
| `checksum`        | `string`         | Entity-level checksum           |

**Variant-specific fields:**

| Variant      | `type`       | Extra field  | Field type                 |
| ------------ | ------------ | ------------ | -------------------------- |
| `"variable"` | `"variable"` | `variableId` | `string` (UUID)            |
| `"operator"` | `"operator"` | `operator`   | `TCoreLogicalOperatorType` |
| `"formula"`  | `"formula"`  | _(none)_     |                            |

**Narrowing:** `TCorePropositionalExpression<"variable">` gives only the variable variant. Aliases: `TCorePropositionalVariableExpression`, `TCoreOperatorExpression`, `TCoreFormulaExpression`.

### `TExpressionInput`

Same as `TCorePropositionalExpression` but with `checksum` omitted. Preserves discriminated-union narrowing via distributive conditional type. Used as input for `addExpression`, `insertExpression`, and as the internal storage type.

```typescript
type TExpressionInput = Omit<TCorePropositionalExpression<T>, "checksum"> // for each T
```

### `TExpressionWithoutPosition`

Same as `TCorePropositionalExpression` but with both `position` and `checksum` omitted. Used as input for `appendExpression` and `addExpressionRelative`.

```typescript
type TExpressionWithoutPosition = Omit<
    TCorePropositionalExpression<T>,
    "position" | "checksum"
>
```

### `TExpressionUpdate`

```typescript
interface TExpressionUpdate {
    position?: number
    variableId?: string
    operator?: TCoreLogicalOperatorType
}
```

Used by `updateExpression(id, updates)`. Only set fields are applied. Forbidden fields (`id`, `parentId`, `type`, `argumentId`, `argumentVersion`, `checksum`) throw if present.

---

## 2. Variable Type

**Source:** `src/lib/schemata/propositional.ts`

### `TCorePropositionalVariable`

```typescript
interface TCorePropositionalVariable {
    id: string // UUID
    argumentId: string // UUID
    argumentVersion: number
    symbol: string // e.g. "P", "Q"
    checksum: string
}
```

Schema has `additionalProperties: true` -- extra fields survive round-trips.

### `TVariableInput` (internal)

`Omit<TCorePropositionalVariable, "checksum">`. Used as input for `addVariable` and as internal storage in `VariableManager`. Not publicly exported from the package index.

---

## 3. Premise Type

**Source:** `src/lib/schemata/propositional.ts`

### `TCorePremise`

```typescript
interface TCorePremise {
    id: string // UUID
    rootExpressionId?: string // UUID, present if premise has expressions
    variables: string[] // IDs of referenced variables
    expressions: TCorePropositionalExpression[] // full expression tree
    checksum: string
}
```

Schema has `additionalProperties: true` -- extra fields survive round-trips.

Returned by `PremiseManager.toData()` and included in `TCoreArgumentEngineData.premises`.

---

## 4. Argument Types

**Source:** `src/lib/schemata/argument.ts`

### `TCoreArgument`

```typescript
interface TCoreArgument {
    id: string // UUID
    version: number
    checksum: string
}
```

Schema has `additionalProperties: true` -- extra fields survive round-trips.

### `TCoreArgumentRoleState`

```typescript
interface TCoreArgumentRoleState {
    conclusionPremiseId?: string // UUID
}
```

Supporting premises are derived dynamically (any inference premise that is not the conclusion). There is no `supportingPremiseIds` field.

---

## 5. Logical Operators

**Source:** `src/lib/schemata/propositional.ts`

### `TCoreLogicalOperatorType`

```typescript
type TCoreLogicalOperatorType = "not" | "and" | "or" | "implies" | "iff"
```

**Arity and placement rules:**

| Operator  | Arity           | Root-only? |
| --------- | --------------- | ---------- |
| `not`     | unary (1 child) | No         |
| `and`     | variadic (2+)   | No         |
| `or`      | variadic (2+)   | No         |
| `implies` | binary (2)      | Yes        |
| `iff`     | binary (2)      | Yes        |

**Permitted `updateExpression` swaps:** `and` <-> `or`, `implies` <-> `iff`. `not` cannot be changed.

---

## 6. Evaluation Types

**Source:** `src/lib/types/evaluation.ts`

### Core value types

```typescript
type TCoreTrivalentValue = boolean | null // null = unknown/unset
type TCoreVariableAssignment = Record<string, TCoreTrivalentValue> // variable ID -> value
```

### `TCoreExpressionAssignment`

Input to `evaluate()` methods.

```typescript
interface TCoreExpressionAssignment {
    variables: TCoreVariableAssignment
    rejectedExpressionIds: string[] // these evaluate to false, children skipped
}
```

### `TCoreValidationResult` / `TCoreValidationIssue`

```typescript
interface TCoreValidationResult {
    ok: boolean
    issues: TCoreValidationIssue[]
}

interface TCoreValidationIssue {
    code: TCoreValidationCode
    severity: "error" | "warning"
    message: string
    premiseId?: string
    expressionId?: string
    variableId?: string
}
```

### `TCoreValidationCode`

Machine-readable strings:

- `ARGUMENT_NO_CONCLUSION`, `ARGUMENT_CONCLUSION_NOT_FOUND`
- `ARGUMENT_VARIABLE_ID_SYMBOL_MISMATCH`, `ARGUMENT_VARIABLE_SYMBOL_AMBIGUOUS`
- `PREMISE_EMPTY`, `PREMISE_ROOT_MISSING`, `PREMISE_ROOT_MISMATCH`
- `EXPR_CHILD_COUNT_INVALID`, `EXPR_BINARY_POSITIONS_INVALID`, `EXPR_VARIABLE_UNDECLARED`
- `ASSIGNMENT_MISSING_VARIABLE`, `ASSIGNMENT_UNKNOWN_VARIABLE`

### `TCorePremiseEvaluationResult`

Returned per-premise by `ArgumentEngine.evaluate()`.

```typescript
interface TCorePremiseEvaluationResult {
    premiseId: string
    premiseType: "inference" | "constraint"
    rootExpressionId?: string
    rootValue?: TCoreTrivalentValue
    expressionValues: Record<string, TCoreTrivalentValue>
    variableValues: Record<string, TCoreTrivalentValue>
    inferenceDiagnostic?: TCorePremiseInferenceDiagnostic
}
```

### `TCorePremiseInferenceDiagnostic`

Discriminated union on `kind`:

- `kind: "implies"` -- has `leftValue`, `rightValue`, `rootValue`, `antecedentTrue`, `consequentTrue`, `isVacuouslyTrue`, `fired`, `firedAndHeld`
- `kind: "iff"` -- has `leftValue`, `rightValue`, `rootValue`, `leftToRight: TCoreDirectionalVacuity`, `rightToLeft: TCoreDirectionalVacuity`, `bothSidesTrue`, `bothSidesFalse`

Both variants include `premiseId` and `rootExpressionId`.

### `TCoreDirectionalVacuity`

```typescript
interface TCoreDirectionalVacuity {
    antecedentTrue: TCoreTrivalentValue
    consequentTrue: TCoreTrivalentValue
    implicationValue: TCoreTrivalentValue
    isVacuouslyTrue: TCoreTrivalentValue
    fired: TCoreTrivalentValue
}
```

### `TCoreArgumentEvaluationResult`

Top-level result from `ArgumentEngine.evaluate()`.

```typescript
interface TCoreArgumentEvaluationResult {
    ok: boolean
    validation?: TCoreValidationResult
    assignment?: TCoreExpressionAssignment
    referencedVariableIds?: string[]
    conclusion?: TCorePremiseEvaluationResult
    supportingPremises?: TCorePremiseEvaluationResult[]
    constraintPremises?: TCorePremiseEvaluationResult[]
    isAdmissibleAssignment?: TCoreTrivalentValue
    allSupportingPremisesTrue?: TCoreTrivalentValue
    conclusionTrue?: TCoreTrivalentValue
    isCounterexample?: TCoreTrivalentValue
    preservesTruthUnderAssignment?: TCoreTrivalentValue
}
```

### `TCoreArgumentEvaluationOptions`

```typescript
interface TCoreArgumentEvaluationOptions {
    strictUnknownAssignmentKeys?: boolean
    includeExpressionValues?: boolean
    includeDiagnostics?: boolean
    validateFirst?: boolean
}
```

### `TCoreValidityCheckResult`

Top-level result from `ArgumentEngine.checkValidity()`.

```typescript
interface TCoreValidityCheckResult {
    ok: boolean
    validation?: TCoreValidationResult
    isValid?: boolean
    checkedVariableIds?: string[]
    numAssignmentsChecked?: number
    numAdmissibleAssignments?: number
    counterexamples?: TCoreCounterexample[]
    truncated?: boolean
}
```

### `TCoreCounterexample`

```typescript
interface TCoreCounterexample {
    assignment: TCoreExpressionAssignment
    result: TCoreArgumentEvaluationResult
}
```

### `TCoreValidityCheckOptions`

```typescript
interface TCoreValidityCheckOptions {
    mode?: "firstCounterexample" | "exhaustive"
    maxVariables?: number
    maxAssignmentsChecked?: number
    includeCounterexampleEvaluations?: boolean
    validateFirst?: boolean
}
```

### `TCoreArgumentEngineData`

Returned by `ArgumentEngine.toData()`.

```typescript
interface TCoreArgumentEngineData {
    argument: TCoreArgument
    premises: TCorePremise[]
    roles: TCoreArgumentRoleState
}
```

---

## 7. Mutation Types

**Source:** `src/lib/types/mutation.ts`

### `TCoreMutationResult<T>`

Wrapper returned by all mutating methods on `PremiseManager` and `ArgumentEngine`.

```typescript
interface TCoreMutationResult<T> {
    result: T // direct answer (e.g. the removed expression)
    changes: TCoreChangeset // all side effects
}
```

### `TCoreChangeset`

Only affected categories are present.

```typescript
interface TCoreChangeset {
    expressions?: TCoreEntityChanges<TCorePropositionalExpression>
    variables?: TCoreEntityChanges<TCorePropositionalVariable>
    premises?: TCoreEntityChanges<TCorePremise>
    roles?: TCoreArgumentRoleState // new role state (present only when roles changed)
    argument?: TCoreArgument // new argument (present only when argument changed)
}
```

### `TCoreEntityChanges<T>`

```typescript
interface TCoreEntityChanges<T> {
    added: T[]
    modified: T[]
    removed: T[]
}
```

### `TCoreRawChangeset` (internal)

Same shape as `TCoreChangeset` but uses `TExpressionInput` and `TVariableInput` (no checksums). Used internally by `ChangeCollector`; converted to `TCoreChangeset` via `attachChangesetChecksums()` before returning to callers.

---

## 8. Diff Types

**Source:** `src/lib/types/diff.ts`

### `TCoreArgumentDiff`

Top-level result from `diffArguments(engineA, engineB, options?)`.

```typescript
interface TCoreArgumentDiff {
    argument: TCoreEntityFieldDiff<TCoreArgument>
    variables: TCoreEntitySetDiff<TCorePropositionalVariable>
    premises: TCorePremiseSetDiff
    roles: TCoreRoleDiff
}
```

### `TCoreFieldChange`

```typescript
interface TCoreFieldChange {
    field: string
    before: unknown
    after: unknown
}
```

### `TCoreEntityFieldDiff<T>`

Field-level diff for a single matched entity.

```typescript
interface TCoreEntityFieldDiff<T> {
    before: T
    after: T
    changes: TCoreFieldChange[]
}
```

### `TCoreEntitySetDiff<T>`

Set-level diff for a collection of ID-keyed entities.

```typescript
interface TCoreEntitySetDiff<T extends { id: string }> {
    added: T[]
    removed: T[]
    modified: TCoreEntityFieldDiff<T>[]
}
```

### `TCorePremiseDiff`

Extends `TCoreEntityFieldDiff<TCorePremise>` with nested expression diffs.

```typescript
interface TCorePremiseDiff extends TCoreEntityFieldDiff<TCorePremise> {
    expressions: TCoreEntitySetDiff<TCorePropositionalExpression>
}
```

### `TCorePremiseSetDiff`

```typescript
interface TCorePremiseSetDiff {
    added: TCorePremise[]
    removed: TCorePremise[]
    modified: TCorePremiseDiff[]
}
```

### `TCoreRoleDiff`

```typescript
interface TCoreRoleDiff {
    conclusion: { before: string | undefined; after: string | undefined }
}
```

### `TCoreFieldComparator<T>`

```typescript
type TCoreFieldComparator<T> = (before: T, after: T) => TCoreFieldChange[]
```

### `TCoreDiffOptions`

Per-entity comparator overrides for `diffArguments`.

```typescript
interface TCoreDiffOptions {
    compareArgument?: TCoreFieldComparator<TCoreArgument>
    compareVariable?: TCoreFieldComparator<TCorePropositionalVariable>
    comparePremise?: TCoreFieldComparator<TCorePremise>
    compareExpression?: TCoreFieldComparator<TCorePropositionalExpression>
}
```

---

## 9. Relationship Types

**Source:** `src/lib/types/relationships.ts`

### `TCoreVariableAppearance`

```typescript
interface TCoreVariableAppearance {
    variableId: string
    side: "antecedent" | "consequent" // TCorePremiseSide
    polarity: "positive" | "negative" // TCoreVariablePolarity
}
```

### `TCorePremiseProfile`

Returned by `buildPremiseProfile()`.

```typescript
interface TCorePremiseProfile {
    premiseId: string
    isInference: boolean
    appearances: TCoreVariableAppearance[]
}
```

### `TCorePremiseRelationshipType`

```typescript
type TCorePremiseRelationshipType =
    | "supporting"
    | "contradicting"
    | "restricting"
    | "downstream"
    | "unrelated"
```

### `TCoreVariableRelationship`

```typescript
interface TCoreVariableRelationship {
    variableId: string
    relationship: "supporting" | "contradicting" | "restricting"
}
```

### `TCorePremiseRelationResult`

```typescript
interface TCorePremiseRelationResult {
    premiseId: string
    relationship: TCorePremiseRelationshipType
    variableDetails: TCoreVariableRelationship[]
    transitive: boolean
}
```

### `TCorePremiseRelationshipAnalysis`

Top-level result from `analyzePremiseRelationships()`.

```typescript
interface TCorePremiseRelationshipAnalysis {
    focusedPremiseId: string
    premises: TCorePremiseRelationResult[]
}
```

---

## 10. Checksum Types

**Source:** `src/lib/types/checksum.ts`, `src/lib/checksum-config.ts`

### `TCoreChecksumConfig`

```typescript
interface TCoreChecksumConfig {
    expressionFields?: Set<string>
    variableFields?: Set<string>
    premiseFields?: Set<string>
    argumentFields?: Set<string>
    roleFields?: Set<string>
}
```

### `DEFAULT_CHECKSUM_CONFIG`

```typescript
{
    expressionFields: Set(["id", "type", "parentId", "position", "argumentId", "argumentVersion", "variableId", "operator"]),
    variableFields:   Set(["id", "symbol", "argumentId", "argumentVersion"]),
    premiseFields:    Set(["id", "rootExpressionId"]),
    argumentFields:   Set(["id", "version"]),
    roleFields:       Set(["conclusionPremiseId"]),
}
```

### `createChecksumConfig(additional)`

Merges additional fields into defaults (union, not replace). Pass to `ArgumentEngine` constructor via `options.checksumConfig`.

---

## 11. Analysis File Type

**Source:** `src/lib/schemata/analysis.ts`

### `TCoreAnalysisFile`

```typescript
interface TCoreAnalysisFile {
    argumentId: string
    argumentVersion: number
    assignments: Record<string, boolean | null> // variable symbol -> value
    rejectedExpressionIds: string[]
}
```

Used by CLI analysis commands. Not directly used by the library API.

---

## 12. Formula Parser Types

**Source:** `src/lib/core/parser/formula.ts`

### `FormulaAST`

Returned by `parseFormula(input)`.

```typescript
type FormulaAST =
    | { type: "variable"; name: string }
    | { type: "not"; operand: FormulaAST }
    | { type: "and"; operands: FormulaAST[] }
    | { type: "or"; operands: FormulaAST[] }
    | { type: "implies"; left: FormulaAST; right: FormulaAST }
    | { type: "iff"; left: FormulaAST; right: FormulaAST }
```

---

## 13. Position Constants

**Source:** `src/lib/utils/position.ts`

```typescript
const POSITION_MIN = 0
const POSITION_MAX = Number.MAX_SAFE_INTEGER // 9007199254740991
const POSITION_INITIAL = Math.floor(POSITION_MAX / 2) // 4503599627370495
function midpoint(a: number, b: number): number // a + (b - a) / 2
```

Used internally for sibling ordering. Callers typically use `appendExpression` or `addExpressionRelative` rather than computing positions directly.

---

## 14. Schema System Notes

- **Typebox-based.** Schemas defined with `Type.*` from `@sinclair/typebox`. Types extracted via `Static<typeof Schema>`.
- **Validation:** `Value.Parse(Schema, raw)` from `@sinclair/typebox/value` throws on invalid data. `Value.Check` returns `boolean`.
- **`additionalProperties: true`** on `CorePropositionalVariableSchema`, `CorePremiseSchema`, and `CoreArgumentSchema`. Extra fields survive round-trips through `Value.Parse`.
- **Expression schemas** use `Type.Interface` (intersection-like) to extend the base schema. They do not set `additionalProperties`.
- **`Nullable(T)`** helper produces `Type.Union([T, Type.Null()])` with `default: null`.
- **`UUID`** is `Type.String()` (no format enforcement at the schema level).
