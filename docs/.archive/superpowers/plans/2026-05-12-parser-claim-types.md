# Type-aware argument parser via formula inference — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the parser's `citationMiniIds` field with formula-derived citation and axiom edges; unify the miniId convention; have the parser build both `ClaimCitationLibrary` and `ClaimAxiomLibrary`.

**Architecture:** The parser stops asking the LLM for support links as a separate field. Instead, after building the engine, it walks each `implies`/`iff`-rooted premise: the right-hand operand identifies the consequent claim, the left-hand subtree provides candidate antecedent variables, and any antecedent variable bound to a citation- or axiomatic-typed claim becomes a support edge routed to the corresponding library. Library `add()` enforces semantic invariants; the parser wraps any throws as warnings in non-strict mode.

**Tech Stack:** TypeScript, TypeBox runtime schemas, vitest for testing, peggy-generated formula parser.

**Spec:** `docs/superpowers/specs/2026-05-12-parser-claim-types-design.md`

---

## File map

**Modified:**

- `src/lib/parsing/types.ts` — warning-code union
- `src/lib/parsing/schemata.ts` — drop `citationMiniIds` from `ParsedClaimSchema`
- `src/lib/parsing/prompt-builder.ts` — `CORE_CLAIM_KEYS`, `CORE_PROMPT` rewrites
- `src/lib/parsing/argument-parser.ts` — add `TAxiom` type param, replace citation-walking pass with formula-inference pass, add `mapClaimAxiom` hook, update `mapClaimCitation` signature, build `ClaimAxiomLibrary`
- `test/integration/parse-api.test.ts` — drop `citationMiniIds: []` from fixtures
- `test/extensions/basics.test.ts` — drop `citationMiniIds: []` from fixtures
- `docs/api-reference.md` — parser API documentation
- `docs/release-notes/upcoming.md` — user-facing release note
- `docs/changelogs/upcoming.md` — developer changelog
- `CLAUDE.md` — design rules referencing the old field or prefix convention (verify only)
- `README.md` — verify-only pass for `citationMiniIds` / c-s-a prefix mentions

**Created:**

- `test/parser.test.ts` — new unit-test file for the formula-inference pass

---

### Task 1: Add new warning codes (keep old one intact)

**Files:**

- Modify: `src/lib/parsing/types.ts`

- [ ] **Step 1: Update the warning-code union**

Replace the existing `TParserWarningCode` type with:

```ts
export type TParserWarningCode =
    | "UNRESOLVED_CITATION_MINIID"
    | "UNRESOLVED_CLAIM_MINIID"
    | "UNRESOLVED_CONCLUSION_MINIID"
    | "UNDECLARED_VARIABLE_SYMBOL"
    | "FORMULA_PARSE_ERROR"
    | "FORMULA_STRUCTURE_ERROR"
    | "CITATION_EDGE_REJECTED"
    | "AXIOM_EDGE_REJECTED"
```

(`UNRESOLVED_CITATION_MINIID` stays for now — it's still referenced by the old citation-walking pass in `argument-parser.ts:373-388`. It will be removed in Task 9 after that pass is deleted.)

- [ ] **Step 2: Verify typecheck**

Run: `pnpm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/parsing/types.ts
git commit -m "feat(parsing): add CITATION_EDGE_REJECTED and AXIOM_EDGE_REJECTED warning codes"
```

---

### Task 2: Scaffold `TAxiom` parameter, `claimAxiomLibrary` field, and `mapClaimAxiom` hook

This task adds the new type parameter, returns an empty `ClaimAxiomLibrary` from `build()`, and adds the new hook — all without changing parsing behaviour. Existing tests must keep passing.

**Files:**

- Modify: `src/lib/parsing/argument-parser.ts`

- [ ] **Step 1: Import `ClaimAxiomLibrary`**

In `src/lib/parsing/argument-parser.ts`, add to the import block at the top (after the existing `ClaimCitationLibrary` import on line 19):

```ts
import { ClaimAxiomLibrary } from "../core/claim-axiom-library.js"
```

- [ ] **Step 2: Add `TAxiom` type parameter to `TArgumentParserResult`**

Replace the existing `TArgumentParserResult` type (currently lines 33–45) with:

```ts
export type TArgumentParserResult<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TClaim extends TCoreClaim = TCoreClaim,
    TCitation extends TCoreClaimConnection = TCoreClaimConnection,
    TAxiom extends TCoreClaimConnection = TCoreClaimConnection,
> = {
    engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TClaim>
    claimLibrary: ClaimLibrary<TClaim>
    claimCitationLibrary: ClaimCitationLibrary<TCitation>
    claimAxiomLibrary: ClaimAxiomLibrary<TAxiom>
    warnings: TParserWarning[]
}
```

- [ ] **Step 3: Add `TAxiom` type parameter to `ArgumentParser` class**

Replace the class declaration line (currently around line 238) and the matching `build()` return type to thread `TAxiom` through. Update:

```ts
export class ArgumentParser<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TClaim extends TCoreClaim = TCoreClaim,
    TCitation extends TCoreClaimConnection = TCoreClaimConnection,
    TAxiom extends TCoreClaimConnection = TCoreClaimConnection,
> {
```

And update `build()`'s return type annotation:

```ts
public build(
    response: TParsedArgumentResponse,
    options?: TParserBuildOptions
): TArgumentParserResult<TArg, TPremise, TExpr, TVar, TClaim, TCitation, TAxiom> {
```

- [ ] **Step 4: Construct an empty `ClaimAxiomLibrary` and include it in the result**

Currently, around line 365, the parser constructs `claimCitationLibrary`. Add a `claimAxiomLibrary` construction immediately after it:

```ts
const claimCitationLibrary = new ClaimCitationLibrary<TCitation>(claimLibrary)
const claimAxiomLibrary = new ClaimAxiomLibrary<TAxiom>(claimLibrary)
```

At the bottom of `build()` (currently around line 526), update the return statement to include the new library:

```ts
return {
    engine,
    claimLibrary,
    claimCitationLibrary,
    claimAxiomLibrary,
    warnings,
}
```

- [ ] **Step 5: Add the `mapClaimAxiom` hook (no callers yet)**

After the existing `mapClaimCitation` method at the bottom of the file (currently around line 554–560), add:

```ts
protected mapClaimAxiom(
    _dependentParsed: TParsedClaim,
    _supportingParsed: TParsedClaim,
    _dependentClaimId: string,
    _supportingClaimId: string,
): Record<string, unknown> {
    return {}
}
```

- [ ] **Step 6: Update `mapClaimCitation` signature**

Replace the existing `mapClaimCitation` definition (currently lines 554–560) with the new signature that exposes both ends as parsed claims:

```ts
protected mapClaimCitation(
    _dependentParsed: TParsedClaim,
    _supportingParsed: TParsedClaim,
    _dependentClaimId: string,
    _supportingClaimId: string,
): Record<string, unknown> {
    return {}
}
```

Then update its **single call site** in the citation-walking pass (currently around line 389):

```ts
// Before:
const extras = this.mapClaimCitation(parsedClaim, citingRef.id, sourceRef.id)
// After (look up the supporting parsed claim by miniId — the citation-walking
// pass iterates parsedClaim.citationMiniIds, so the supporting parsed claim is
// the entry in arg.claims whose miniId equals citationMiniId):
const supportingParsed = arg.claims.find((c) => c.miniId === citationMiniId)!
const extras = this.mapClaimCitation(
    parsedClaim,
    supportingParsed,
    citingRef.id,
    sourceRef.id
)
```

(This call site goes away in Task 5 when the citation-walking pass is replaced, but it must compile in the meantime.)

- [ ] **Step 7: Verify typecheck and full test suite still pass**

Run: `pnpm run typecheck && pnpm run test`
Expected: typecheck passes; all existing tests pass; no behaviour changes.

- [ ] **Step 8: Commit**

```bash
git add src/lib/parsing/argument-parser.ts
git commit -m "feat(parsing): scaffold TAxiom param, claimAxiomLibrary result field, and mapClaimAxiom hook"
```

---

### Task 3: Create `test/parser.test.ts` with helpers and the first failing test

This task introduces a dedicated unit-test file for the parser and writes the first formula-inference test, which **must fail** until Task 5 implements the new pass.

**Files:**

- Create: `test/parser.test.ts`

- [ ] **Step 1: Create the test file with shared imports and a fixture helper**

Create `test/parser.test.ts` with the following contents. The `buildResponse` helper consolidates the response-construction boilerplate — every test composes claims/variables/premises into a `TParsedArgumentResponse` and feeds it to `parser.build()`.

```ts
import { describe, it, expect } from "vitest"
import {
    ArgumentParser,
    type TParsedArgumentResponse,
    type TParsedClaim,
    type TParsedVariable,
    type TParsedPremise,
} from "../src/lib/parsing/index.js"

function buildResponse(parts: {
    claims: TParsedClaim[]
    variables: TParsedVariable[]
    premises: TParsedPremise[]
    conclusionPremiseMiniId: string
}): TParsedArgumentResponse {
    return {
        argument: {
            claims: parts.claims,
            variables: parts.variables,
            premises: parts.premises,
            conclusionPremiseMiniId: parts.conclusionPremiseMiniId,
        },
        uncategorizedText: null,
        selectionRationale: null,
        failureText: null,
    }
}

describe("ArgumentParser — formula-inferred citation/axiom edges", () => {
    it("extracts a single citation edge from IMPLIES(citation_var, normal_var)", () => {
        const response = buildResponse({
            claims: [
                {
                    miniId: "c1",
                    role: "premise",
                    type: "citation",
                    citationMiniIds: [],
                },
                {
                    miniId: "c2",
                    role: "conclusion",
                    type: "normal",
                    citationMiniIds: [],
                },
            ],
            variables: [
                { miniId: "v1", symbol: "Cite", claimMiniId: "c1" },
                { miniId: "v2", symbol: "Concl", claimMiniId: "c2" },
            ],
            premises: [{ miniId: "p1", formula: "Cite implies Concl" }],
            conclusionPremiseMiniId: "p1",
        })

        const parser = new ArgumentParser()
        const result = parser.build(response)

        const claims = result.claimLibrary.getAll()
        const citationClaim = claims.find((c) => c.type === "citation")!
        const normalClaim = claims.find((c) => c.type === "normal")!

        const edges = result.claimCitationLibrary.getConnectionsForClaim(
            normalClaim.id
        )
        expect(edges).toHaveLength(1)
        expect(edges[0].supportingClaimId).toBe(citationClaim.id)
        expect(result.claimAxiomLibrary.getAll()).toEqual([])
        expect(result.warnings).toEqual([])
    })
})
```

(Note: `citationMiniIds: []` is still required by the schema at this point. It will be dropped in Task 7.)

- [ ] **Step 2: Run the new test**

Run: `pnpm vitest test/parser.test.ts`
Expected: **FAILS** — the citation-walking pass still consults `parsedClaim.citationMiniIds`, which is `[]`, so no edge is produced. The assertion `expect(edges).toHaveLength(1)` fails with received length 0.

This failing state is the TDD red baseline for Task 5. Do not commit yet.

---

### Task 4: Add the rest of the parser unit tests in `test/parser.test.ts`

Write the remaining failing tests upfront so Task 5's implementation has the full suite to satisfy in one pass. All tests will fail or pass-by-accident until Task 5 lands.

**Files:**

- Modify: `test/parser.test.ts`

- [ ] **Step 1: Append the remaining tests inside the `describe` block**

Append the following `it` blocks inside the existing `describe("ArgumentParser — formula-inferred citation/axiom edges", ...)`:

```ts
it("emits two citation edges for OR antecedent with two citation vars", () => {
    const response = buildResponse({
        claims: [
            {
                miniId: "c1",
                role: "premise",
                type: "citation",
                citationMiniIds: [],
            },
            {
                miniId: "c2",
                role: "premise",
                type: "citation",
                citationMiniIds: [],
            },
            {
                miniId: "c3",
                role: "conclusion",
                type: "normal",
                citationMiniIds: [],
            },
        ],
        variables: [
            { miniId: "v1", symbol: "A", claimMiniId: "c1" },
            { miniId: "v2", symbol: "B", claimMiniId: "c2" },
            { miniId: "v3", symbol: "C", claimMiniId: "c3" },
        ],
        premises: [{ miniId: "p1", formula: "(A or B) implies C" }],
        conclusionPremiseMiniId: "p1",
    })

    const result = new ArgumentParser().build(response)
    const normalClaim = result.claimLibrary
        .getAll()
        .find((c) => c.type === "normal")!
    const edges = result.claimCitationLibrary.getConnectionsForClaim(
        normalClaim.id
    )
    expect(edges).toHaveLength(2)
})

it("emits a citation edge even for negated antecedent variables", () => {
    const response = buildResponse({
        claims: [
            {
                miniId: "c1",
                role: "premise",
                type: "citation",
                citationMiniIds: [],
            },
            {
                miniId: "c2",
                role: "conclusion",
                type: "normal",
                citationMiniIds: [],
            },
        ],
        variables: [
            { miniId: "v1", symbol: "Cite", claimMiniId: "c1" },
            { miniId: "v2", symbol: "Concl", claimMiniId: "c2" },
        ],
        premises: [{ miniId: "p1", formula: "not Cite implies Concl" }],
        conclusionPremiseMiniId: "p1",
    })

    const result = new ArgumentParser().build(response)
    const normalClaim = result.claimLibrary
        .getAll()
        .find((c) => c.type === "normal")!
    expect(
        result.claimCitationLibrary.getConnectionsForClaim(normalClaim.id)
    ).toHaveLength(1)
})

it("treats the right-hand operand of iff as the consequent", () => {
    const response = buildResponse({
        claims: [
            {
                miniId: "c1",
                role: "premise",
                type: "citation",
                citationMiniIds: [],
            },
            {
                miniId: "c2",
                role: "conclusion",
                type: "normal",
                citationMiniIds: [],
            },
        ],
        variables: [
            { miniId: "v1", symbol: "Cite", claimMiniId: "c1" },
            { miniId: "v2", symbol: "Concl", claimMiniId: "c2" },
        ],
        premises: [{ miniId: "p1", formula: "Cite iff Concl" }],
        conclusionPremiseMiniId: "p1",
    })

    const result = new ArgumentParser().build(response)
    const normalClaim = result.claimLibrary
        .getAll()
        .find((c) => c.type === "normal")!
    const citationClaim = result.claimLibrary
        .getAll()
        .find((c) => c.type === "citation")!
    const edges = result.claimCitationLibrary.getConnectionsForClaim(
        normalClaim.id
    )
    expect(edges).toHaveLength(1)
    expect(edges[0].supportingClaimId).toBe(citationClaim.id)
})

it("emits one citation edge, one axiom edge, and no edge for normal antecedent", () => {
    const response = buildResponse({
        claims: [
            {
                miniId: "c1",
                role: "premise",
                type: "citation",
                citationMiniIds: [],
            },
            {
                miniId: "c2",
                role: "premise",
                type: "axiomatic",
                citationMiniIds: [],
            },
            {
                miniId: "c3",
                role: "premise",
                type: "normal",
                citationMiniIds: [],
            },
            {
                miniId: "c4",
                role: "conclusion",
                type: "normal",
                citationMiniIds: [],
            },
        ],
        variables: [
            { miniId: "v1", symbol: "Cite", claimMiniId: "c1" },
            { miniId: "v2", symbol: "Ax", claimMiniId: "c2" },
            { miniId: "v3", symbol: "Norm", claimMiniId: "c3" },
            { miniId: "v4", symbol: "Concl", claimMiniId: "c4" },
        ],
        premises: [
            { miniId: "p1", formula: "(Cite and Ax and Norm) implies Concl" },
        ],
        conclusionPremiseMiniId: "p1",
    })

    const result = new ArgumentParser().build(response)
    // claimLibrary.getAll() preserves insertion order (Map iteration), so
    // claims appear in the same order as arg.claims in the fixture:
    // [citation, axiomatic, normal-supporting, normal-conclusion].
    const [citationClaim, axiomClaim, , conclClaim] =
        result.claimLibrary.getAll()
    expect(citationClaim.type).toBe("citation")
    expect(axiomClaim.type).toBe("axiomatic")
    expect(conclClaim.type).toBe("normal")

    const citationEdges = result.claimCitationLibrary.getConnectionsForClaim(
        conclClaim.id
    )
    expect(citationEdges).toHaveLength(1)
    expect(citationEdges[0].supportingClaimId).toBe(citationClaim.id)

    const axiomEdges = result.claimAxiomLibrary.getConnectionsForClaim(
        conclClaim.id
    )
    expect(axiomEdges).toHaveLength(1)
    expect(axiomEdges[0].supportingClaimId).toBe(axiomClaim.id)
})

it("dedupes identical (claim, supporting) pairs across premises", () => {
    const response = buildResponse({
        claims: [
            {
                miniId: "c1",
                role: "premise",
                type: "citation",
                citationMiniIds: [],
            },
            {
                miniId: "c2",
                role: "premise",
                type: "normal",
                citationMiniIds: [],
            },
            {
                miniId: "c3",
                role: "conclusion",
                type: "normal",
                citationMiniIds: [],
            },
        ],
        variables: [
            { miniId: "v1", symbol: "Cite", claimMiniId: "c1" },
            { miniId: "v2", symbol: "Intermediate", claimMiniId: "c2" },
            { miniId: "v3", symbol: "Concl", claimMiniId: "c3" },
        ],
        premises: [
            { miniId: "p1", formula: "Cite implies Concl" },
            { miniId: "p2", formula: "(Cite and Intermediate) implies Concl" },
        ],
        conclusionPremiseMiniId: "p1",
    })

    const result = new ArgumentParser().build(response)
    const conclClaim = result.claimLibrary.getAll()[2]
    expect(
        result.claimCitationLibrary.getConnectionsForClaim(conclClaim.id)
    ).toHaveLength(1)
})

it("emits no edge when a citation appears only in the consequent slot", () => {
    const response = buildResponse({
        claims: [
            {
                miniId: "c1",
                role: "premise",
                type: "normal",
                citationMiniIds: [],
            },
            {
                miniId: "c2",
                role: "conclusion",
                type: "citation",
                citationMiniIds: [],
            },
        ],
        variables: [
            { miniId: "v1", symbol: "Norm", claimMiniId: "c1" },
            { miniId: "v2", symbol: "Cite", claimMiniId: "c2" },
        ],
        premises: [{ miniId: "p1", formula: "Norm implies Cite" }],
        conclusionPremiseMiniId: "p1",
    })

    const result = new ArgumentParser().build(response)
    expect(result.claimCitationLibrary.getAll()).toEqual([])
    expect(result.claimAxiomLibrary.getAll()).toEqual([])
})

it("emits no edge from constraint premises (AND-rooted root)", () => {
    const response = buildResponse({
        claims: [
            {
                miniId: "c1",
                role: "premise",
                type: "citation",
                citationMiniIds: [],
            },
            {
                miniId: "c2",
                role: "conclusion",
                type: "normal",
                citationMiniIds: [],
            },
        ],
        variables: [
            { miniId: "v1", symbol: "Cite", claimMiniId: "c1" },
            { miniId: "v2", symbol: "Concl", claimMiniId: "c2" },
        ],
        premises: [
            { miniId: "p1", formula: "Cite and Concl" },
            { miniId: "p2", formula: "Concl" },
        ],
        conclusionPremiseMiniId: "p2",
    })

    const result = new ArgumentParser().build(response)
    expect(result.claimCitationLibrary.getAll()).toEqual([])
})

it("returns empty libraries when no implies/iff premise exists", () => {
    const response = buildResponse({
        claims: [
            {
                miniId: "c1",
                role: "conclusion",
                type: "normal",
                citationMiniIds: [],
            },
        ],
        variables: [{ miniId: "v1", symbol: "X", claimMiniId: "c1" }],
        premises: [{ miniId: "p1", formula: "X" }],
        conclusionPremiseMiniId: "p1",
    })

    const result = new ArgumentParser().build(response)
    expect(result.claimCitationLibrary.getAll()).toEqual([])
    expect(result.claimAxiomLibrary.getAll()).toEqual([])
})

it("emits AXIOM_EDGE_REJECTED in non-strict mode for IMPLIES(axiom, citation)", () => {
    const response = buildResponse({
        claims: [
            {
                miniId: "c1",
                role: "premise",
                type: "axiomatic",
                citationMiniIds: [],
            },
            {
                miniId: "c2",
                role: "conclusion",
                type: "citation",
                citationMiniIds: [],
            },
        ],
        variables: [
            { miniId: "v1", symbol: "Ax", claimMiniId: "c1" },
            { miniId: "v2", symbol: "Cite", claimMiniId: "c2" },
        ],
        premises: [{ miniId: "p1", formula: "Ax implies Cite" }],
        conclusionPremiseMiniId: "p1",
    })

    const result = new ArgumentParser().build(response, { strict: false })
    expect(result.claimAxiomLibrary.getAll()).toEqual([])
    const axWarning = result.warnings.find(
        (w) => w.code === "AXIOM_EDGE_REJECTED"
    )
    expect(axWarning).toBeDefined()
    expect(axWarning?.context.libraryErrorCode).toBe(
        "AXIOM_CLAIM_NOT_NORMAL_TYPE"
    )
})

it("throws on the same scenario in strict mode", () => {
    const response = buildResponse({
        claims: [
            {
                miniId: "c1",
                role: "premise",
                type: "axiomatic",
                citationMiniIds: [],
            },
            {
                miniId: "c2",
                role: "conclusion",
                type: "citation",
                citationMiniIds: [],
            },
        ],
        variables: [
            { miniId: "v1", symbol: "Ax", claimMiniId: "c1" },
            { miniId: "v2", symbol: "Cite", claimMiniId: "c2" },
        ],
        premises: [{ miniId: "p1", formula: "Ax implies Cite" }],
        conclusionPremiseMiniId: "p1",
    })

    expect(() => new ArgumentParser().build(response)).toThrow(
        /AXIOM_CLAIM_NOT_NORMAL_TYPE/
    )
})
```

- [ ] **Step 2: Run the suite to confirm a mix of failing tests**

Run: `pnpm vitest test/parser.test.ts`
Expected: multiple FAILures (the new pass doesn't exist yet) and a couple of tests that pass by accident (e.g., the empty-libraries one). Do not commit yet.

---

### Task 5: Implement the formula-inference pass and remove the old citation-walking pass

The core change. Replace the old citation-walking block (currently `argument-parser.ts:363-403`) with the new formula-driven pass that runs after premise creation.

**Files:**

- Modify: `src/lib/parsing/argument-parser.ts`

- [ ] **Step 1: Remove the old citation-walking pass**

In `argument-parser.ts`, delete the block starting with the comment "4. Wire claim citations" through the end of the `for (const parsedClaim of arg.claims)` loop (currently lines 363–403). Keep the two library constructions at the top of that block:

```ts
const claimCitationLibrary = new ClaimCitationLibrary<TCitation>(claimLibrary)
const claimAxiomLibrary = new ClaimAxiomLibrary<TAxiom>(claimLibrary)
```

(Those were already moved/added in Task 2. The deletion removes the `for` loop and the inner `citationMiniIds` walk.)

- [ ] **Step 2: Add a helper for collecting antecedent variable IDs**

Near the top of `argument-parser.ts` (after the existing `collectVariableNames` helper around line 105), add:

```ts
/** Collect all variable IDs reachable in a subtree, traversing through and/or/not/formula/implies/iff. */
function collectVariableIdsInSubtree(
    rootExpression: TCorePropositionalExpression,
    expressionsByParent: Map<string | null, TCorePropositionalExpression[]>,
    out: Set<string>
): void {
    if (rootExpression.type === "variable") {
        out.add(rootExpression.variableId)
        return
    }
    const children = expressionsByParent.get(rootExpression.id) ?? []
    for (const child of children) {
        collectVariableIdsInSubtree(child, expressionsByParent, out)
    }
}
```

- [ ] **Step 3: Add the formula-inference pass after premise creation**

After the existing step 8 (conclusion setting, currently around `argument-parser.ts:524`) and **before** the final `return` statement, insert:

```ts
// 9. Formula-inferred support edges
//    Walk each implies/iff-rooted premise; right-hand operand is the
//    consequent claim, left-hand subtree contributes antecedent variables.
//    Citation-typed antecedent vars → ClaimCitationLibrary edge;
//    axiomatic-typed antecedent vars → ClaimAxiomLibrary edge.
const citationEdgeKeys = new Set<string>()
const axiomEdgeKeys = new Set<string>()

for (const premise of engine.listPremises()) {
    const root = premise.getRootExpression()
    if (!root) continue
    if (root.type !== "operator") continue
    if (root.operator !== "implies" && root.operator !== "iff") continue

    const allExpressions = premise.getExpressions()
    const expressionsByParent = new Map<
        string | null,
        TCorePropositionalExpression[]
    >()
    for (const expr of allExpressions) {
        const bucket = expressionsByParent.get(expr.parentId) ?? []
        bucket.push(expr)
        expressionsByParent.set(expr.parentId, bucket)
    }
    // Children of the root, sorted by position. Right-hand operand is at
    // position 1 (consequent); position-0 subtree is the antecedent.
    const rootChildren = (expressionsByParent.get(root.id) ?? [])
        .slice()
        .sort((a, b) => a.position - b.position)
    if (rootChildren.length !== 2) continue
    const antecedentRoot = rootChildren[0]
    const consequentRoot = rootChildren[1]

    // Consequent must be a variable expression for the edge model to apply.
    if (consequentRoot.type !== "variable") continue
    const consequentVariable = engine.getVariable(consequentRoot.variableId)
    if (!consequentVariable) continue
    const consequentClaimId = consequentVariable.claimId
    const consequentClaimVersion = consequentVariable.claimVersion
    if (consequentClaimId === undefined) continue

    const antecedentVariableIds = new Set<string>()
    collectVariableIdsInSubtree(
        antecedentRoot,
        expressionsByParent,
        antecedentVariableIds
    )

    // Find which parsed claim corresponds to the consequent — we need the
    // parsed-claim form for mapClaimCitation/mapClaimAxiom mapping hooks.
    const consequentParsed = arg.claims.find((pc) => {
        const ref = claimMiniIdToId.get(pc.miniId)
        return ref?.id === consequentClaimId
    })
    if (!consequentParsed) continue

    for (const variableId of antecedentVariableIds) {
        const antecedentVariable = engine.getVariable(variableId)
        if (!antecedentVariable?.claimId) continue
        const supportingClaim = claimLibrary.get(
            antecedentVariable.claimId,
            antecedentVariable.claimVersion
        )
        if (!supportingClaim) continue
        const supportingParsed = arg.claims.find((pc) => {
            const ref = claimMiniIdToId.get(pc.miniId)
            return ref?.id === supportingClaim.id
        })
        if (!supportingParsed) continue

        const edgeKey = `${consequentClaimId}|${supportingClaim.id}`

        if (supportingClaim.type === "citation") {
            if (citationEdgeKeys.has(edgeKey)) continue
            citationEdgeKeys.add(edgeKey)
            const extras = this.mapClaimCitation(
                consequentParsed,
                supportingParsed,
                consequentClaimId,
                supportingClaim.id
            )
            try {
                claimCitationLibrary.add({
                    ...extras,
                    id: genId(),
                    claimId: consequentClaimId,
                    claimVersion: consequentClaimVersion,
                    supportingClaimId: supportingClaim.id,
                    supportingClaimVersion: supportingClaim.version,
                } as Omit<TCitation, "checksum">)
            } catch (error) {
                if (strict) throw error
                const code =
                    error instanceof Error && "violations" in error
                        ? (error as { violations: { code: string }[] })
                              .violations[0]?.code
                        : "unknown"
                warnings.push({
                    code: "CITATION_EDGE_REJECTED",
                    message: `Citation edge ${consequentClaimId} ← ${supportingClaim.id} rejected by library: ${code}`,
                    context: {
                        claimId: consequentClaimId,
                        supportingClaimId: supportingClaim.id,
                        libraryErrorCode: String(code),
                    },
                })
            }
        } else if (supportingClaim.type === "axiomatic") {
            if (axiomEdgeKeys.has(edgeKey)) continue
            axiomEdgeKeys.add(edgeKey)
            const extras = this.mapClaimAxiom(
                consequentParsed,
                supportingParsed,
                consequentClaimId,
                supportingClaim.id
            )
            try {
                claimAxiomLibrary.add({
                    ...extras,
                    id: genId(),
                    claimId: consequentClaimId,
                    claimVersion: consequentClaimVersion,
                    supportingClaimId: supportingClaim.id,
                    supportingClaimVersion: supportingClaim.version,
                } as Omit<TAxiom, "checksum">)
            } catch (error) {
                if (strict) throw error
                const code =
                    error instanceof Error && "violations" in error
                        ? (error as { violations: { code: string }[] })
                              .violations[0]?.code
                        : "unknown"
                warnings.push({
                    code: "AXIOM_EDGE_REJECTED",
                    message: `Axiom edge ${consequentClaimId} ← ${supportingClaim.id} rejected by library: ${code}`,
                    context: {
                        claimId: consequentClaimId,
                        supportingClaimId: supportingClaim.id,
                        libraryErrorCode: String(code),
                    },
                })
            }
        }
        // type === 'normal' → no edge
    }
}
```

The methods `engine.listPremises()`, `engine.getVariable(variableId)`, and `premise.getRootExpression()` / `premise.getExpressions()` exist on the engine and premise APIs as of this writing — confirmed by reading `src/lib/core/argument-engine.ts` (`listPremises` at line 957, `getVariable` at line 1308). The variable lookup returns a `TClaimBoundVariable` with `claimId` and `claimVersion` fields; the consequent variable's `claimVersion` is what's used in the edge construction. If any of these accessors have been renamed by the time this plan is executed, substitute the equivalent method without changing the algorithm.

- [ ] **Step 4: Run the parser tests**

Run: `pnpm vitest test/parser.test.ts`
Expected: all tests in `test/parser.test.ts` PASS.

- [ ] **Step 5: Run the full test suite**

Run: `pnpm run test`
Expected: existing tests still pass. If a test fails because it asserted on the old citationMiniIds-driven behaviour, fix the test in this same task before committing (this is the point at which the old behaviour is gone).

- [ ] **Step 6: Commit**

```bash
git add src/lib/parsing/argument-parser.ts test/parser.test.ts
git commit -m "feat(parsing): derive citation and axiom edges from premise formulas"
```

---

### Task 6: Drop `citationMiniIds` from `ParsedClaimSchema`

**Files:**

- Modify: `src/lib/parsing/schemata.ts`
- Modify: `src/lib/parsing/prompt-builder.ts`

- [ ] **Step 1: Update `ParsedClaimSchema`**

In `src/lib/parsing/schemata.ts`, replace the existing `ParsedClaimSchema` (currently lines 14–25) with:

```ts
export const ParsedClaimSchema = Type.Object(
    {
        miniId: Type.String(),
        role: ParsedClaimRoleType,
        type: ParsedClaimTypeType,
    },
    { additionalProperties: true }
)
```

- [ ] **Step 2: Update `CORE_CLAIM_KEYS` in prompt-builder**

In `src/lib/parsing/prompt-builder.ts`, replace line 8:

```ts
// Before:
const CORE_CLAIM_KEYS = new Set(["miniId", "role", "type", "citationMiniIds"])
// After:
const CORE_CLAIM_KEYS = new Set(["miniId", "role", "type"])
```

- [ ] **Step 3: Update parser unit tests to remove `citationMiniIds`**

In `test/parser.test.ts`, replace every occurrence of `citationMiniIds: [],` in fixture literals by deleting that property line. Run a global find on the file.

- [ ] **Step 4: Run the parser tests**

Run: `pnpm vitest test/parser.test.ts`
Expected: all tests still pass.

- [ ] **Step 5: Run the full test suite**

Run: `pnpm run test`
Expected: existing integration test (`test/integration/parse-api.test.ts`) and extension test (`test/extensions/basics.test.ts`) may now fail because they still set `citationMiniIds: []` in fixtures. They get fixed in Task 8 — don't fix here. Other tests should pass.

Note any failures and confirm they are confined to the two fixture files; if anything else breaks, investigate before proceeding.

- [ ] **Step 6: Commit**

```bash
git add src/lib/parsing/schemata.ts src/lib/parsing/prompt-builder.ts test/parser.test.ts
git commit -m "feat(parsing): drop citationMiniIds from ParsedClaimSchema"
```

---

### Task 7: Drop `UNRESOLVED_CITATION_MINIID` from `TParserWarningCode`

The old citation-walking pass was removed in Task 5; this code is now unused.

**Files:**

- Modify: `src/lib/parsing/types.ts`

- [ ] **Step 1: Update the union**

Replace the type with:

```ts
export type TParserWarningCode =
    | "UNRESOLVED_CLAIM_MINIID"
    | "UNRESOLVED_CONCLUSION_MINIID"
    | "UNDECLARED_VARIABLE_SYMBOL"
    | "FORMULA_PARSE_ERROR"
    | "FORMULA_STRUCTURE_ERROR"
    | "CITATION_EDGE_REJECTED"
    | "AXIOM_EDGE_REJECTED"
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm run typecheck`
Expected: no errors. (If the parser code still references the removed string literal anywhere, fix that reference; based on Task 5 there should be none.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/parsing/types.ts
git commit -m "feat(parsing): drop UNRESOLVED_CITATION_MINIID warning code"
```

---

### Task 8: Update existing fixtures in integration and extension tests

**Files:**

- Modify: `test/integration/parse-api.test.ts`
- Modify: `test/extensions/basics.test.ts`

- [ ] **Step 1: Remove `citationMiniIds: []` from `test/extensions/basics.test.ts`**

Find every line of the form `citationMiniIds: [],` in this file and delete it. The fixture claim entries should now only contain `miniId`, `role`, `type`, and whatever extension fields (title, body, url, axiom) the test specifies.

- [ ] **Step 2: Remove `citationMiniIds: []` from `test/integration/parse-api.test.ts`**

Same operation in this file. Note that `parse-api.test.ts` is the LLM integration test — its fixtures are filter-functions over LLM output, not fixed response objects. Inspect the file: look for any explicit literal `citationMiniIds` in test bodies and remove. If the file constructs synthetic responses anywhere, drop the property; otherwise, no change is needed there.

- [ ] **Step 3: Run the affected tests**

Run: `pnpm vitest test/extensions/basics.test.ts test/integration/parse-api.test.ts`
Expected: all tests in these files pass.

- [ ] **Step 4: Run the full test suite**

Run: `pnpm run test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add test/integration/parse-api.test.ts test/extensions/basics.test.ts
git commit -m "test(parsing): drop citationMiniIds from existing fixtures"
```

---

### Task 9: Rewrite the system prompt in `prompt-builder.ts`

**Files:**

- Modify: `src/lib/parsing/prompt-builder.ts`

- [ ] **Step 1: Rewrite the "Claim Types" section**

In `src/lib/parsing/prompt-builder.ts`, find the section that begins with `## Claim Types` (around line 91 in the current file). Replace its closing paragraph (the one that begins "A citation claim is just a claim whose propositional content is…") with:

```
A citation claim is just a claim whose propositional content is "the cited material says/shows X". Logical relationships between all claim kinds — normal, citation, axiomatic — are expressed through variables, formulas, and premises. The parser derives the citation and axiom support graphs from those formulas; you do not list supports as a separate field.

Apps using this library may extend axiomatic claims with a `reasonCode` field describing the category of self-evidence, and may constrain that field to a closed enum of allowed values via their schema extension. The core parser does not require any such field.
```

- [ ] **Step 2: Delete the "Citation Links" section**

Remove the entire `## Citation Links` section (the two paragraphs about `citationMiniIds`, currently around lines 101–107).

- [ ] **Step 3: Insert a "Support via Formulas" section in its place**

Where the deleted Citation Links section was, insert:

```
## Support via Formulas

To express that a citation-typed or axiomatic-typed claim supports another claim, include the supporting claim's variable in the antecedent (left-hand side) of an `implies` or `iff` premise whose consequent (right-hand side) is the supported claim's variable. For example, to express that citation C1 supports the normal claim X, write a premise with formula `C1_var implies X_var`.

For `iff` premises, the right-hand operand is treated as the supported claim by parser convention even though biconditionals are logically symmetric — place the supported claim on the right.

Constraint premises (premises whose root operator is not `implies` or `iff`) do not register any support edges, even if their formulas mention citation- or axiomatic-typed variables.

The parser infers the citation and axiom support graphs from these formulas; do not list supports as a separate field.
```

- [ ] **Step 4: Update the "MiniId Conventions" section**

Find the existing `## MiniId Conventions` section. Replace it with:

```
## MiniId Conventions

Each entity type uses a distinct prefix for its miniId to avoid cross-reference confusion:

- Claims (all kinds): `c1`, `c2`, `c3`, ... — the `type` field distinguishes `"normal"`, `"citation"`, and `"axiomatic"`.
- Variables: `v1`, `v2`, `v3`, ...
- Premises: `p1`, `p2`, `p3`, ...

Always use the correct prefix when referencing entities. Cross-type references:
- `claimMiniId` on a variable → any claim in the `claims` array
- `conclusionPremiseMiniId` → only `p`-prefixed miniIds (premises)
```

- [ ] **Step 5: Rewrite the "Self-Check" section**

Replace it with a 5-item list (drop the old item #5 about `citationMiniIds`, drop item #6 redundancy):

```
## Self-Check

Before finalizing your response, verify:
1. Every symbol that appears in any premise formula is declared in the `variables` array
2. Every variable's `claimMiniId` references an existing claim in the `claims` array
3. The `conclusionPremiseMiniId` references an existing premise in the `premises` array
4. No `implies` or `iff` operator is nested inside another operator in any formula
5. Every claim has a `type` field set to one of `"normal"`, `"citation"`, or `"axiomatic"`
```

- [ ] **Step 6: Verify "Citation Claim Metadata" section is still consistent**

Read the section starting at `## Citation Claim Metadata` (in the current file around line 109). The wording there describes populating extension fields like `url` and `citation` for citation-typed claims, which is still valid. **No edit required**, but confirm by reading that no sentence references `citationMiniIds`.

- [ ] **Step 7: Run the typecheck and full test suite**

Run: `pnpm run typecheck && pnpm run test`
Expected: all green. The prompt text is data — no behaviour change to the parser itself.

- [ ] **Step 8: Commit**

```bash
git add src/lib/parsing/prompt-builder.ts
git commit -m "feat(parsing): rewrite LLM system prompt for formula-derived supports and unified miniIds"
```

---

### Task 10: Run the full check pipeline

**Files:** none (verification only)

- [ ] **Step 1: Run typecheck + lint + tests + build**

Run: `pnpm run check`
Expected: all pass.

If anything fails, fix it in a follow-up commit before continuing to documentation.

---

### Task 11: Update changelog and release notes

**Files:**

- Modify: `docs/changelogs/upcoming.md`
- Modify: `docs/release-notes/upcoming.md`

- [ ] **Step 1: Read both files**

Read the current contents of `docs/changelogs/upcoming.md` and `docs/release-notes/upcoming.md` to understand existing style.

- [ ] **Step 2: Add a changelog entry**

In `docs/changelogs/upcoming.md`, append a section under whatever heading the file uses for the current upcoming version. Format following existing entries; include the commit hash range from this work (use `git log --oneline main..HEAD` to gather hashes if appropriate). Sample wording:

```
- parsing: drop `citationMiniIds` from `ParsedClaimSchema`; the parser now derives citation and axiom support edges from premise formulas. Any `implies`/`iff` premise's right-hand operand identifies the supported claim, and any citation- or axiomatic-typed claim referenced in the left-hand subtree becomes a support edge in the corresponding library.
- parsing: `ArgumentParser` and `TArgumentParserResult` gain a `TAxiom extends TCoreClaimConnection` type parameter; result objects now expose `claimAxiomLibrary` alongside `claimCitationLibrary`.
- parsing: new protected `mapClaimAxiom` hook (mirror of `mapClaimCitation`); both hooks' signatures expand to expose the supporting parsed claim alongside the dependent.
- parsing: warning codes — added `CITATION_EDGE_REJECTED` and `AXIOM_EDGE_REJECTED` for non-strict wrapping of library `add()` throws; removed `UNRESOLVED_CITATION_MINIID` (no longer reachable).
- parsing: LLM system prompt rewritten — unified miniId convention (all claims use the `c` prefix; `type` field discriminates kind); `## Citation Links` section replaced by `## Support via Formulas`.
```

- [ ] **Step 3: Add a release-note entry**

In `docs/release-notes/upcoming.md`, add user-facing language describing what changed and what consumers should do. Keep it plain and audience-focused:

```
## Parser changes

The argument parser no longer asks the LLM to list which citation- or axiomatic-typed claims back each normal claim as a separate field. Instead, support relationships are now expressed through the same propositional formulas that already encode the argument's reasoning: any citation- or axiomatic-typed claim whose variable appears in the left-hand side of an `implies` or `iff` premise becomes a support edge against the right-hand-side (consequent) claim.

The parser's result now includes both a `ClaimCitationLibrary` and a `ClaimAxiomLibrary` (previously only the citation library was returned). Subclasses of `ArgumentParser` can override the new `mapClaimAxiom` protected method to attach extension fields to axiom edges, mirroring the existing `mapClaimCitation` hook.

If you have a subclass of `ArgumentParser` that overrides `mapClaimCitation`, its signature has expanded to take the supporting parsed claim as a second argument. Update the override accordingly.

The miniId convention in the LLM system prompt has been unified: all claims now use the `c1, c2, c3, ...` prefix regardless of type, and the `type` field on each claim distinguishes `"normal"`, `"citation"`, and `"axiomatic"`.
```

- [ ] **Step 4: Commit**

```bash
git add docs/changelogs/upcoming.md docs/release-notes/upcoming.md
git commit -m "docs: changelog and release notes for parser claim-type changes"
```

---

### Task 12: Update API reference and verify other Documentation Sync entries

**Files:**

- Modify: `docs/api-reference.md`
- Possibly modify: `CLAUDE.md`, `README.md` (verify only)

- [ ] **Step 1: Update `docs/api-reference.md`**

Find the `ArgumentParser` / `TArgumentParserResult` section. Update:

- Type-parameter list: add `TAxiom extends TCoreClaimConnection` as the 7th parameter.
- Result type: include `claimAxiomLibrary: ClaimAxiomLibrary<TAxiom>`.
- `ParsedClaimSchema`: drop the `citationMiniIds` field.
- Mapping hooks: document `mapClaimAxiom` with the same signature shape as `mapClaimCitation`; update `mapClaimCitation`'s signature.
- Warning codes: drop `UNRESOLVED_CITATION_MINIID`, add `CITATION_EDGE_REJECTED` and `AXIOM_EDGE_REJECTED`. Note that the warning `context` field's `libraryErrorCode` carries the underlying `InvariantViolationError` violation code (e.g., `AXIOM_CLAIM_NOT_NORMAL_TYPE`).

- [ ] **Step 2: Verify `CLAUDE.md` design rules**

Search `CLAUDE.md` for references to `citationMiniIds`, the c/s/a prefix convention, or the parser-built-only-ClaimCitationLibrary claim:

Run: `grep -n "citationMiniIds\|ClaimAxiomLibrary\|miniId" /Users/brian/Projects/Proposit-App/proposit-core/CLAUDE.md`

If any design-rule entry mentions the old behaviour, update it to reflect that the parser now also builds `ClaimAxiomLibrary` and derives both from formulas. If no such mention exists, no edit is needed.

- [ ] **Step 3: Verify `README.md`**

Run: `grep -n "citationMiniIds\|prefix\b" /Users/brian/Projects/Proposit-App/proposit-core/README.md`

If `citationMiniIds` or the c/s/a prefix convention is mentioned, update those passages. If not, no edit is needed.

- [ ] **Step 4: Verify `src/lib/core/interfaces/library.interfaces.ts`**

Run: `grep -n "parser\|parsing" /Users/brian/Projects/Proposit-App/proposit-core/src/lib/core/interfaces/library.interfaces.ts`

If any JSDoc on the library interfaces references the parser's citation pass, update it. Most likely no change is needed (the interfaces describe the libraries themselves, not parser callers).

- [ ] **Step 5: Run the typecheck and full check**

Run: `pnpm run check`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add docs/api-reference.md CLAUDE.md README.md src/lib/core/interfaces/library.interfaces.ts
git commit -m "docs: update API reference and design notes for parser claim-type changes"
```

(If a path listed above was not actually modified, omit it from the `git add`.)

---

### Task 13: Offer a version bump

**Files:** none (interaction with user)

- [ ] **Step 1: Confirm changes are coherent**

Run: `git log --oneline main~13..HEAD` (or however many commits this work produced) and verify all changes are present.

- [ ] **Step 2: Run the full check one last time**

Run: `pnpm run check`
Expected: all pass.

- [ ] **Step 3: Ask the user to cut a patch version**

Per the project's CLAUDE.md convention: "After completing a major set of changes, offer to cut a new version via `pnpm version patch|minor|major`." Mention to the user that this is a patch-level change (per the spec) and that the version-bump workflow renames `docs/release-notes/upcoming.md` → `docs/release-notes/v{version}.md`, renames `docs/changelogs/upcoming.md` → `docs/changelogs/v{version}.md`, starts fresh upcoming files, and creates a `v{version}` git tag. Wait for explicit confirmation before running any of those commands.
