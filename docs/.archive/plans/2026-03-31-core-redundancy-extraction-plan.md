# Core Redundancy Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract 6 repeated code patterns in `src/lib/core/` into reusable helpers — pure refactoring with no behavioral or public API changes.

**Architecture:** Each extraction is independent. Task 1 (VersionedLibrary) touches separate files from Tasks 2-6. Tasks 2-6 each touch one file. All existing tests must continue to pass without modification.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Extract VersionedLibrary base class

**Files:**

- Create: `src/lib/core/versioned-library.ts`
- Modify: `src/lib/core/claim-library.ts`
- Modify: `src/lib/core/source-library.ts`
- Modify: `src/lib/index.ts`

- [ ] **Step 1: Run the full test suite to confirm green baseline**

Run: `pnpm run check`
Expected: All checks pass.

- [ ] **Step 2: Create `src/lib/core/versioned-library.ts`**

This abstract base class contains all shared logic from `ClaimLibrary` and `SourceLibrary`. The `snapshot()` method and `fromSnapshot()` static factory remain in the subclasses since they return type-specific snapshot objects.

```typescript
import { Value } from "typebox/value"
import type { TSchema } from "typebox"
import type { TCoreChecksumConfig } from "../types/checksum.js"
import { DEFAULT_CHECKSUM_CONFIG } from "../consts.js"
import { entityChecksum } from "./checksum.js"
import type {
    TInvariantValidationResult,
    TInvariantViolation,
} from "../types/validation.js"
import { InvariantViolationError } from "./invariant-violation-error.js"

type TVersionedEntity = {
    id: string
    version: number
    frozen: boolean
    checksum: string
}

export abstract class VersionedLibrary<TEntity extends TVersionedEntity> {
    protected entities: Map<string, Map<number, TEntity>>
    protected checksumConfig?: TCoreChecksumConfig

    protected abstract readonly entityLabel: string
    protected abstract readonly schema: TSchema
    protected abstract readonly checksumFieldsKey: keyof TCoreChecksumConfig
    protected abstract readonly schemaInvalidCode: string
    protected abstract readonly frozenSuccessorCode: string

    constructor(options?: { checksumConfig?: TCoreChecksumConfig }) {
        this.entities = new Map()
        this.checksumConfig = options?.checksumConfig
    }

    protected restoreFromEntities(entities: TEntity[]): void {
        this.entities = new Map()
        for (const entity of entities) {
            let versions = this.entities.get(entity.id)
            if (!versions) {
                versions = new Map()
                this.entities.set(entity.id, versions)
            }
            versions.set(entity.version, entity)
        }
    }

    protected withValidation<T>(fn: () => T): T {
        const allEntities = this.getAll()
        try {
            const result = fn()
            const validation = this.validate()
            if (!validation.ok) {
                this.restoreFromEntities(allEntities)
                throw new InvariantViolationError(validation.violations)
            }
            return result
        } catch (e) {
            if (!(e instanceof InvariantViolationError)) {
                this.restoreFromEntities(allEntities)
            }
            throw e
        }
    }

    public create(
        entity: Omit<TEntity, "version" | "frozen" | "checksum">
    ): TEntity {
        return this.withValidation(() => {
            if (this.entities.has(entity.id as string)) {
                throw new Error(
                    `${this.entityLabel} with ID "${entity.id}" already exists.`
                )
            }
            const full = {
                ...entity,
                version: 0,
                frozen: false,
                checksum: "",
            } as TEntity
            full.checksum = this.computeChecksum(full)

            const versions = new Map<number, TEntity>()
            versions.set(0, full)
            this.entities.set(full.id, versions)
            return full
        })
    }

    public update(
        id: string,
        updates: Partial<
            Omit<TEntity, "id" | "version" | "frozen" | "checksum">
        >
    ): TEntity {
        return this.withValidation(() => {
            const versions = this.entities.get(id)
            if (!versions) {
                throw new Error(`${this.entityLabel} "${id}" does not exist.`)
            }
            const maxVersion = this.maxVersion(versions)
            const current = versions.get(maxVersion)!
            if (current.frozen) {
                throw new Error(
                    `${this.entityLabel} "${id}" version ${maxVersion} is frozen and cannot be updated.`
                )
            }
            const updated = {
                ...current,
                ...updates,
                id: current.id,
                version: current.version,
                frozen: current.frozen,
                checksum: "",
            } as TEntity
            updated.checksum = this.computeChecksum(updated)
            versions.set(maxVersion, updated)
            return updated
        })
    }

    public freeze(id: string): { frozen: TEntity; current: TEntity } {
        return this.withValidation(() => {
            const versions = this.entities.get(id)
            if (!versions) {
                throw new Error(`${this.entityLabel} "${id}" does not exist.`)
            }
            const maxVersion = this.maxVersion(versions)
            const current = versions.get(maxVersion)!
            if (current.frozen) {
                throw new Error(
                    `${this.entityLabel} "${id}" version ${maxVersion} is already frozen.`
                )
            }
            const frozenEntity = {
                ...current,
                frozen: true,
                checksum: "",
            } as TEntity
            frozenEntity.checksum = this.computeChecksum(frozenEntity)
            versions.set(maxVersion, frozenEntity)

            const nextVersion = maxVersion + 1
            const nextEntity = {
                ...current,
                version: nextVersion,
                frozen: false,
                checksum: "",
            } as TEntity
            nextEntity.checksum = this.computeChecksum(nextEntity)
            versions.set(nextVersion, nextEntity)

            return { frozen: frozenEntity, current: nextEntity }
        })
    }

    public get(id: string, version: number): TEntity | undefined {
        return this.entities.get(id)?.get(version)
    }

    public getCurrent(id: string): TEntity | undefined {
        const versions = this.entities.get(id)
        if (!versions) return undefined
        return versions.get(this.maxVersion(versions))
    }

    public getAll(): TEntity[] {
        const result: TEntity[] = []
        for (const versions of this.entities.values()) {
            for (const entity of versions.values()) {
                result.push(entity)
            }
        }
        return result
    }

    public getVersions(id: string): TEntity[] {
        const versions = this.entities.get(id)
        if (!versions) return []
        return Array.from(versions.values()).sort(
            (a, b) => a.version - b.version
        )
    }

    public validate(): TInvariantValidationResult {
        const violations: TInvariantViolation[] = []
        const entityType = this.entityLabel.toLowerCase()
        for (const [id, versions] of this.entities) {
            const sortedVersions = [...versions.entries()].sort(
                ([a], [b]) => a - b
            )
            for (const [version, entity] of sortedVersions) {
                if (!Value.Check(this.schema, entity)) {
                    violations.push({
                        code: this.schemaInvalidCode,
                        message: `${this.entityLabel} "${id}" version ${version} does not conform to schema`,
                        entityType,
                        entityId: id,
                    })
                }
                if (entity.frozen) {
                    const maxVer = this.maxVersion(versions)
                    if (version < maxVer && !versions.has(version + 1)) {
                        violations.push({
                            code: this.frozenSuccessorCode,
                            message: `${this.entityLabel} "${id}" version ${version} is frozen but has no successor version`,
                            entityType,
                            entityId: id,
                        })
                    }
                }
            }
        }
        return { ok: violations.length === 0, violations }
    }

    protected maxVersion(versions: Map<number, TEntity>): number {
        let max = -1
        for (const v of versions.keys()) {
            if (v > max) max = v
        }
        return max
    }

    protected computeChecksum(entity: TEntity): string {
        const fields =
            this.checksumConfig?.[this.checksumFieldsKey] ??
            DEFAULT_CHECKSUM_CONFIG[this.checksumFieldsKey]!
        return entityChecksum(
            entity as unknown as Record<string, unknown>,
            fields
        )
    }
}
```

- [ ] **Step 3: Rewrite `src/lib/core/claim-library.ts` as a thin subclass**

Replace the entire file with:

```typescript
import type { TCoreClaim } from "../schemata/claim.js"
import { CoreClaimSchema } from "../schemata/claim.js"
import type { TCoreChecksumConfig } from "../types/checksum.js"
import type {
    TClaimLibraryManagement,
    TClaimLibrarySnapshot,
} from "./interfaces/library.interfaces.js"
import {
    CLAIM_SCHEMA_INVALID,
    CLAIM_FROZEN_NO_SUCCESSOR,
} from "../types/validation.js"
import { VersionedLibrary } from "./versioned-library.js"

export class ClaimLibrary<TClaim extends TCoreClaim = TCoreClaim>
    extends VersionedLibrary<TClaim>
    implements TClaimLibraryManagement<TClaim>
{
    protected readonly entityLabel = "Claim"
    protected readonly schema = CoreClaimSchema
    protected readonly checksumFieldsKey = "claimFields" as const
    protected readonly schemaInvalidCode = CLAIM_SCHEMA_INVALID
    protected readonly frozenSuccessorCode = CLAIM_FROZEN_NO_SUCCESSOR

    public snapshot(): TClaimLibrarySnapshot<TClaim> {
        return { claims: this.getAll() }
    }

    public static fromSnapshot<TClaim extends TCoreClaim = TCoreClaim>(
        snapshot: TClaimLibrarySnapshot<TClaim>,
        options?: { checksumConfig?: TCoreChecksumConfig }
    ): ClaimLibrary<TClaim> {
        const lib = new ClaimLibrary<TClaim>(options)
        lib.restoreFromEntities(snapshot.claims)
        return lib
    }
}
```

- [ ] **Step 4: Rewrite `src/lib/core/source-library.ts` as a thin subclass**

Replace the entire file with:

```typescript
import type { TCoreSource } from "../schemata/source.js"
import { CoreSourceSchema } from "../schemata/source.js"
import type { TCoreChecksumConfig } from "../types/checksum.js"
import type {
    TSourceLibraryManagement,
    TSourceLibrarySnapshot,
} from "./interfaces/library.interfaces.js"
import {
    SOURCE_SCHEMA_INVALID,
    SOURCE_FROZEN_NO_SUCCESSOR,
} from "../types/validation.js"
import { VersionedLibrary } from "./versioned-library.js"

export class SourceLibrary<TSource extends TCoreSource = TCoreSource>
    extends VersionedLibrary<TSource>
    implements TSourceLibraryManagement<TSource>
{
    protected readonly entityLabel = "Source"
    protected readonly schema = CoreSourceSchema
    protected readonly checksumFieldsKey = "sourceFields" as const
    protected readonly schemaInvalidCode = SOURCE_SCHEMA_INVALID
    protected readonly frozenSuccessorCode = SOURCE_FROZEN_NO_SUCCESSOR

    public snapshot(): TSourceLibrarySnapshot<TSource> {
        return { sources: this.getAll() }
    }

    public static fromSnapshot<TSource extends TCoreSource = TCoreSource>(
        snapshot: TSourceLibrarySnapshot<TSource>,
        options?: { checksumConfig?: TCoreChecksumConfig }
    ): SourceLibrary<TSource> {
        const lib = new SourceLibrary<TSource>(options)
        lib.restoreFromEntities(snapshot.sources)
        return lib
    }
}
```

- [ ] **Step 5: Add `VersionedLibrary` export to `src/lib/index.ts`**

Add after the `SourceLibrary` export line:

```typescript
export { VersionedLibrary } from "./core/versioned-library.js"
```

- [ ] **Step 6: Run the full check suite**

Run: `pnpm run check`
Expected: All checks pass — no behavioral changes.

- [ ] **Step 7: Commit**

```bash
git add src/lib/core/versioned-library.ts src/lib/core/claim-library.ts src/lib/core/source-library.ts src/lib/index.ts
git commit -m "refactor: extract VersionedLibrary base class from ClaimLibrary and SourceLibrary"
```

---

### Task 2: Extract ExpressionManager.registerFormulaBuffer

**Files:**

- Modify: `src/lib/core/expression-manager.ts`

- [ ] **Step 1: Run tests to confirm green baseline**

Run: `pnpm run test`
Expected: All tests pass.

- [ ] **Step 2: Add the `registerFormulaBuffer` private method**

Add this method to `ExpressionManager`, near other private helpers (after `reparent`, around line 1160):

```typescript
private registerFormulaBuffer(
    sourceExpr: TExpr,
    parentId: string | null,
    position: number
): string {
    const formulaId = this.generateId()
    const formulaExpr = this.attachChecksum({
        id: formulaId,
        type: "formula",
        argumentId: sourceExpr.argumentId,
        argumentVersion: sourceExpr.argumentVersion,
        premiseId: (sourceExpr as unknown as { premiseId: string })
            .premiseId,
        parentId,
        position,
    } as TExpressionInput<TExpr>)

    this.expressions.set(formulaId, formulaExpr)
    this.collector?.addedExpression({
        ...formulaExpr,
    } as unknown as TCorePropositionalExpression)
    getOrCreate(
        this.childExpressionIdsByParentId,
        parentId,
        () => new Set()
    ).add(formulaId)
    getOrCreate(
        this.childPositionsByParentId,
        parentId,
        () => new Set()
    ).add(position)

    return formulaId
}
```

- [ ] **Step 3: Replace the formula buffer site in `addExpression`**

In `addExpression`, replace the inline formula-buffer block (the `if (this.grammarConfig.autoNormalize)` block that creates a formula, registers it, and rewrites expression's parentId) with a call to `registerFormulaBuffer`. The rewritten block should be:

```typescript
if (this.grammarConfig.autoNormalize) {
    const formulaId = this.registerFormulaBuffer(
        expression as unknown as TExpr,
        expression.parentId,
        expression.position
    )
    expression = {
        ...expression,
        parentId: formulaId,
        position: 0,
    } as TExpressionInput<TExpr>
    parent = this.expressions.get(formulaId)!
}
```

- [ ] **Step 4: Replace both formula buffer sites in `insertExpression`**

**Site 1 (parent formula buffer):** Replace the block that creates `formulaId`/`formulaExpr` and registers them for the anchor parent with:

```typescript
const formulaId = this.registerFormulaBuffer(
    expression as unknown as TExpr,
    anchorParentId,
    anchorPosition
)
```

Keep the subsequent lines that update `finalParentId = formulaId` and `finalPosition = 0`.

**Site 2 (child formula buffers):** Inside the loop over `childrenNeedingFormulaBuffer`, replace the inline formula creation with:

```typescript
for (const childId of childrenNeedingFormulaBuffer) {
    const child = this.expressions.get(childId)!
    const childPosition = child.position
    this.reparent(childId, null, 0)
    const childFormulaId = this.registerFormulaBuffer(
        expression as unknown as TExpr,
        expression.id as string,
        childPosition
    )
    this.reparent(childId, childFormulaId, 0)
}
```

- [ ] **Step 5: Replace all three formula buffer sites in `wrapExpression`**

**Site 1 (parent formula buffer):** Replace the block that creates the formula for the operator's parent slot:

```typescript
const formulaId = this.registerFormulaBuffer(
    operator as unknown as TExpr,
    anchorParentId,
    anchorPosition
)
```

Keep the subsequent lines that update `operatorParentId = formulaId` and `operatorPosition = 0`.

**Site 2 (existing node formula buffer):** Replace with:

```typescript
const existingNodePosition = existingNode.position
this.reparent(existingNodeId, null, 0)
const existingFormulaId = this.registerFormulaBuffer(
    operator as unknown as TExpr,
    operator.id as string,
    existingNodePosition
)
this.reparent(existingNodeId, existingFormulaId, 0)
```

**Site 3 (sibling formula buffer):** Replace with:

```typescript
const childPosition = (
    this.expressions.get(newSibling.id as string) ??
    (newSibling as unknown as TExpr)
).position
this.reparent(newSibling.id as string, null, 0)
const siblingFormulaId = this.registerFormulaBuffer(
    operator as unknown as TExpr,
    operator.id as string,
    childPosition
)
this.reparent(newSibling.id as string, siblingFormulaId, 0)
```

- [ ] **Step 6: Run the full check suite**

Run: `pnpm run check`
Expected: All checks pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/core/expression-manager.ts
git commit -m "refactor: extract registerFormulaBuffer in ExpressionManager"
```

---

### Task 3: Extract ExpressionManager.detachExpression

**Files:**

- Modify: `src/lib/core/expression-manager.ts`

- [ ] **Step 1: Add the `detachExpression` private method**

Add near `registerFormulaBuffer`:

```typescript
private detachExpression(expressionId: string, expression: TExpr): void {
    this.expressions.delete(expressionId)
    this.childExpressionIdsByParentId
        .get(expression.parentId)
        ?.delete(expressionId)
    this.childPositionsByParentId
        .get(expression.parentId)
        ?.delete(expression.position)
    this.childExpressionIdsByParentId.delete(expressionId)
    this.childPositionsByParentId.delete(expressionId)
}
```

- [ ] **Step 2: Replace the detach site in `removeSubtree` (bulk removal loop)**

In the `for (const id of toRemove)` loop inside `removeExpression`'s subtree branch, replace the 5 map operations with:

```typescript
for (const id of toRemove) {
    const expression = this.expressions.get(id)
    if (!expression) continue

    this.collector?.removedExpression({
        ...expression,
    } as unknown as TCorePropositionalExpression)
    this.detachExpression(id, expression)
}
```

- [ ] **Step 3: Replace the detach site in `removeAndPromote` (leaf removal)**

In the leaf-removal branch of `removeAndPromote`, replace the map operations that detach the target expression with a call to `detachExpression`, keeping the collector notification and parent dirtying in place.

- [ ] **Step 4: Replace detach sites in `collapseIfNeeded`**

In the formula-0-children branch and operator-0-children branch, replace the inline map operations with `detachExpression`. Keep the collector notification before the call and the `dirtyExpressionIds.delete` + `markExpressionDirty` + recursive `collapseIfNeeded` after.

In the operator-1-child promotion branch, replace the operator removal map operations with `detachExpression`.

- [ ] **Step 5: Replace the detach site in `deleteExpression`**

Replace the 5 map operations with `detachExpression`. Keep the children guard, collector notification, and dirty set handling in their current positions.

- [ ] **Step 6: Run the full check suite**

Run: `pnpm run check`
Expected: All checks pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/core/expression-manager.ts
git commit -m "refactor: extract detachExpression in ExpressionManager"
```

---

### Task 4: Extract PremiseEngine.assertVariableExpressionValid

**Files:**

- Modify: `src/lib/core/premise-engine.ts`

- [ ] **Step 1: Add the `assertVariableExpressionValid` private method**

Add near the existing `assertBelongsToArgument` helper:

```typescript
private assertVariableExpressionValid(
    expression: TExpressionInput<TExpr> | TExpressionWithoutPosition<TExpr>
): void {
    if (
        expression.type === "variable" &&
        !this.variables.hasVariable(expression.variableId)
    ) {
        throw new Error(
            `Variable expression "${expression.id}" references non-existent variable "${expression.variableId}".`
        )
    }

    if (expression.type === "variable" && this.circularityCheck) {
        if (
            this.circularityCheck(
                expression.variableId,
                this.premise.id
            )
        ) {
            throw new Error(
                `Circular binding: variable "${expression.variableId}" is bound to this premise (directly or transitively)`
            )
        }
    }
}
```

- [ ] **Step 2: Replace the guard in `addExpression`**

Replace the two `if` blocks (variable existence check + circularity check) with:

```typescript
this.assertVariableExpressionValid(expression)
```

Keep `assertBelongsToArgument` and the parent validation that follows.

- [ ] **Step 3: Replace the guard in `appendExpression`**

Same replacement — replace the two `if` blocks with `this.assertVariableExpressionValid(expression)`.

- [ ] **Step 4: Replace the guard in `addExpressionRelative`**

Same replacement — replace the two `if` blocks with `this.assertVariableExpressionValid(expression)`.

- [ ] **Step 5: Replace the guard in `insertExpression`**

Same replacement — replace the two `if` blocks with `this.assertVariableExpressionValid(expression)`.

- [ ] **Step 6: Replace the guard in `wrapExpression`**

Replace the two `if` blocks (which check `newSibling`, not `operator`) with:

```typescript
this.assertVariableExpressionValid(newSibling)
```

- [ ] **Step 7: Run the full check suite**

Run: `pnpm run check`
Expected: All checks pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/core/premise-engine.ts
git commit -m "refactor: extract assertVariableExpressionValid in PremiseEngine"
```

---

### Task 5: Extract PremiseEngine.finalizeExpressionMutation

**Files:**

- Modify: `src/lib/core/premise-engine.ts`

- [ ] **Step 1: Add the `finalizeExpressionMutation` private method**

Add near `flushAndBuildChangeset`:

```typescript
private finalizeExpressionMutation(
    collector: ChangeCollector<TExpr, TVar, TPremise, TArg>
): TCoreChangeset<TExpr, TVar, TPremise, TArg> {
    this.syncRootExpressionId()
    this.markDirty()
    const changes = this.flushAndBuildChangeset(collector)
    this.syncExpressionIndex(changes)
    this.onMutate?.()
    return changes
}
```

- [ ] **Step 2: Replace the epilogue in `addExpression`**

Replace these lines at the end of the try block:

```typescript
this.markDirty()
const changes = this.flushAndBuildChangeset(collector)
this.syncExpressionIndex(changes)
this.onMutate?.()
return {
    result: this.expressions.getExpression(expression.id)!,
    changes,
}
```

With:

```typescript
const changes = this.finalizeExpressionMutation(collector)
return {
    result: this.expressions.getExpression(expression.id)!,
    changes,
}
```

Note: `addExpression` sets `this.rootExpressionId` directly when `parentId === null`, so the extra `syncRootExpressionId()` call from the helper is redundant but harmless (it reads the same value that was just set).

- [ ] **Step 3: Replace the epilogue in `appendExpression`**

Same pattern — replace the 4-line epilogue + return with `finalizeExpressionMutation` + return.

- [ ] **Step 4: Replace the epilogue in `addExpressionRelative`**

Same pattern.

- [ ] **Step 5: Replace the epilogue in `removeExpression`**

Replace:

```typescript
this.syncRootExpressionId()
this.markDirty()

const changes = this.flushAndBuildChangeset(collector)
this.syncExpressionIndex(changes)
this.onMutate?.()
return {
    result: snapshot,
    changes,
}
```

With:

```typescript
const changes = this.finalizeExpressionMutation(collector)
return {
    result: snapshot,
    changes,
}
```

- [ ] **Step 6: Replace the epilogue in `insertExpression`**

Same pattern.

- [ ] **Step 7: Replace the epilogue in `wrapExpression`**

Same pattern.

- [ ] **Step 8: Replace the epilogues in `toggleNegation`**

Both branches (negation removal and negation addition) end with the same 4-line epilogue. Replace both with `finalizeExpressionMutation`.

- [ ] **Step 9: Replace the epilogues in `changeOperator`**

All three branches (merge, simple change, split) end with the same 4-line epilogue. Replace all three with `finalizeExpressionMutation`.

- [ ] **Step 10: Run the full check suite**

Run: `pnpm run check`
Expected: All checks pass.

- [ ] **Step 11: Commit**

```bash
git add src/lib/core/premise-engine.ts
git commit -m "refactor: extract finalizeExpressionMutation in PremiseEngine"
```

---

### Task 6: Extract ArgumentEngine.finalizeChanges

**Files:**

- Modify: `src/lib/core/argument-engine.ts`

- [ ] **Step 1: Add the `finalizeChanges` private method**

Add near `notifySubscribers`:

```typescript
private finalizeChanges(
    collector: ChangeCollector<TExpr, TVar, TPremise, TArg>
): TCoreChangeset<TExpr, TVar, TPremise, TArg> {
    this.markDirty()
    const changes = collector.toChangeset()
    this.markReactiveDirty(changes)
    this.notifySubscribers()
    return changes
}
```

- [ ] **Step 2: Replace the epilogue in `addVariable`**

Replace:

```typescript
this.markDirty()
this.markAllPremisesDirty()
const changes = collector.toChangeset()
this.markReactiveDirty(changes)
this.notifySubscribers()
return {
    result: withChecksum,
    changes,
}
```

With:

```typescript
this.markAllPremisesDirty()
const changes = this.finalizeChanges(collector)
return {
    result: withChecksum,
    changes,
}
```

- [ ] **Step 3: Replace the epilogue in `bindVariableToPremise`**

Same pattern as `addVariable` — keep `markAllPremisesDirty()`, replace the rest with `finalizeChanges`.

- [ ] **Step 4: Replace the epilogue in `bindVariableToExternalPremise`**

Same pattern.

- [ ] **Step 5: Replace the epilogue in `updateVariable`**

In the truthy branch only (when `updated` is defined):

```typescript
this.markAllPremisesDirty()
const changes = this.finalizeChanges(collector)
return {
    result: updated,
    changes,
}
```

The falsy branch (`return { result: undefined, changes: collector.toChangeset() }`) stays unchanged since it intentionally skips notifications.

- [ ] **Step 6: Replace the epilogue in `removeVariableCore`**

Same pattern as `addVariable` — keep `markAllPremisesDirty()`, replace the rest with `finalizeChanges`.

- [ ] **Step 7: Replace the epilogue in `createPremiseWithId`**

Replace:

```typescript
const changes = collector.toChangeset()
this.markReactiveDirty(changes)
this.notifySubscribers()
return {
    result: pm,
    changes,
}
```

With:

```typescript
const changes = this.finalizeChanges(collector)
return {
    result: pm,
    changes,
}
```

Note: `createPremiseWithId` already calls `this.markDirty()` earlier in the method. The helper calls it again, which is harmless (sets an already-true flag). The `markAllPremisesDirty()` call that happens conditionally between `markDirty()` and the epilogue stays in place.

- [ ] **Step 8: Replace the epilogue in `removePremise`**

Replace the tail:

```typescript
this.markDirty()
const changes = collector.toChangeset()
this.markReactiveDirty(changes)
this.notifySubscribers()
return { result: premiseData, changes }
```

With:

```typescript
const changes = this.finalizeChanges(collector)
return { result: premiseData, changes }
```

No `markAllPremisesDirty()` needed here (consistent with current behavior).

- [ ] **Step 9: Replace the epilogue in `setConclusionPremise`**

Replace:

```typescript
this.markDirty()
const changes = collector.toChangeset()
this.markReactiveDirty(changes)
this.notifySubscribers()
return { result: id, changes }
```

With:

```typescript
const changes = this.finalizeChanges(collector)
return { result: id, changes }
```

- [ ] **Step 10: Replace the epilogue in `clearConclusionPremise`**

Same pattern as `setConclusionPremise`.

- [ ] **Step 11: Run the full check suite**

Run: `pnpm run check`
Expected: All checks pass.

- [ ] **Step 12: Commit**

```bash
git add src/lib/core/argument-engine.ts
git commit -m "refactor: extract finalizeChanges in ArgumentEngine"
```
