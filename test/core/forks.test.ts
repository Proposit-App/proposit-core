import { describe, expect, it } from "vitest"
import {
    ArgumentEngine,
    forkArgumentEngine,
    ForkNamespace,
    ForkLibrary,
    PropositCore,
} from "../../src/lib/index"
import type {
    TCoreEntityForkRecord,
    TCoreExpressionForkRecord,
    TCoreClaimForkRecord,
} from "../../src/lib/index"
import { Value } from "typebox/value"
import {
    CoreEntityForkRecordSchema,
    CoreExpressionForkRecordSchema,
    CoreClaimForkRecordSchema,
    isPremiseBound,
    type TClaimBoundVariable,
    type TPremiseBoundVariable,
    type TCoreDerivationPremise,
} from "../../src/lib/schemata"
import { POSITION_INITIAL } from "../../src/lib/utils/position"
import { diffArguments } from "../../src/lib/core/diff"
import { ARG, aLib, makeVarExpr, VAR_P } from "./fixtures"

describe("forkArgument", () => {
    it("canFork rejects when overridden to return false", () => {
        class NoForkEngine extends ArgumentEngine {
            public override canFork(): boolean {
                return false
            }
        }
        const eng = new NoForkEngine(ARG, aLib())
        expect(eng.canFork()).toBe(false)
    })

    it("forks a simple argument with new IDs", () => {
        const claimLib = aLib()

        const eng = new ArgumentEngine(ARG, claimLib, {
            behavior: "permissive",
        })
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise()
        const premiseId = pm.getId()

        // Add a root variable expression
        const exprInput = makeVarExpr("expr-1", "var-p", {
            premiseId,
        })
        pm.addExpression(exprInput)

        // Set conclusion
        eng.setConclusionPremise(premiseId)

        // Fork
        const forkClaimLib = aLib()

        let idCounter = 0
        const { engine: forked, remapTable } = forkArgumentEngine(
            eng,
            "forked-arg",
            {
                claimLibrary: forkClaimLib,
            },
            { generateId: () => `gen-${++idCounter}` }
        )

        // Verify argument identity
        const forkedArg = forked.getArgument()
        expect(forkedArg.id).toBe("forked-arg")
        expect(forkedArg.version).toBe(0)

        // Verify remap table
        expect(remapTable.argumentId).toEqual({
            from: ARG.id,
            to: "forked-arg",
        })
        expect(remapTable.premises.size).toBe(1)
        expect(remapTable.expressions.size).toBe(1)
        expect(remapTable.variables.size).toBe(2) // VAR_P + 1 auto premise-bound

        // Verify premise was remapped
        const forkedPremises = forked.listPremises()
        expect(forkedPremises).toHaveLength(1)
        const forkedPremise = forkedPremises[0]
        const forkedPremiseId = forkedPremise.getId()
        expect(forkedPremiseId).not.toBe(premiseId)
        expect(remapTable.premises.get(premiseId)).toBe(forkedPremiseId)

        // Verify expression was remapped
        const forkedExprs = forkedPremise.getExpressions()
        expect(forkedExprs).toHaveLength(1)
        const forkedExpr = forkedExprs[0]
        expect(forkedExpr.id).not.toBe("expr-1")
        expect(remapTable.expressions.get("expr-1")).toBe(forkedExpr.id)

        // Verify expression's variableId was remapped
        expect(forkedExpr.type).toBe("variable")
        if (forkedExpr.type === "variable") {
            expect(forkedExpr.variableId).not.toBe("var-p")
            expect(remapTable.variables.get("var-p")).toBe(
                forkedExpr.variableId
            )
        }

        // Verify variable was remapped
        const forkedVars = forked.getVariables()
        expect(forkedVars).toHaveLength(2) // VAR_P + 1 auto premise-bound
        const forkedVar = forkedVars.find(
            (v) => remapTable.variables.get("var-p") === v.id
        )!
        expect(forkedVar).toBeDefined()
        expect(forkedVar.id).not.toBe("var-p")
        expect(remapTable.variables.get("var-p")).toBe(forkedVar.id)

        // Verify conclusion role was remapped
        expect(forked.getConclusionPremise()?.getId()).toBe(forkedPremiseId)
    })

    // -----------------------------------------------------------------------
    // Internal reference remapping
    // -----------------------------------------------------------------------

    it("remaps parentId chains, variableIds, boundPremiseId, rootExpressionId, and conclusion", () => {
        const claimLib = aLib()
        const eng = new ArgumentEngine(
            { id: "src-arg", version: 2 },
            claimLib,
            { behavior: "permissive" }
        )

        // Add two claim-bound variables
        eng.addVariable({
            id: "var-p",
            argumentId: "src-arg",
            argumentVersion: 2,
            symbol: "P",
            claimId: "claim-default",
            claimVersion: 0,
        } as TClaimBoundVariable)
        eng.addVariable({
            id: "var-q",
            argumentId: "src-arg",
            argumentVersion: 2,
            symbol: "Q",
            claimId: "claim-default",
            claimVersion: 0,
        } as TClaimBoundVariable)

        // Premise 1: P and Q
        const { result: pm1 } = eng.createPremiseWithId("prem-1")
        pm1.addExpression({
            id: "op-and",
            argumentId: "src-arg",
            argumentVersion: 2,
            premiseId: "prem-1",
            type: "operator",
            operator: "and",
            parentId: null,
            position: POSITION_INITIAL,
        })
        pm1.addExpression({
            id: "expr-p",
            argumentId: "src-arg",
            argumentVersion: 2,
            premiseId: "prem-1",
            type: "variable",
            variableId: "var-p",
            parentId: "op-and",
            position: POSITION_INITIAL - 1,
        })
        pm1.addExpression({
            id: "expr-q",
            argumentId: "src-arg",
            argumentVersion: 2,
            premiseId: "prem-1",
            type: "variable",
            variableId: "var-q",
            parentId: "op-and",
            position: POSITION_INITIAL + 1,
        })

        // Premise 2: premise-bound variable referencing prem-1
        const { result: pm2 } = eng.createPremiseWithId("prem-2")
        eng.bindVariableToPremise({
            id: "var-r",
            argumentId: "src-arg",
            argumentVersion: 2,
            symbol: "R",
            boundPremiseId: "prem-1",
            boundArgumentId: "src-arg",
            boundArgumentVersion: 2,
        } as TPremiseBoundVariable)
        pm2.addExpression({
            id: "expr-r",
            argumentId: "src-arg",
            argumentVersion: 2,
            premiseId: "prem-2",
            type: "variable",
            variableId: "var-r",
            parentId: null,
            position: POSITION_INITIAL,
        })

        // Set premise 2 as conclusion
        eng.setConclusionPremise("prem-2")

        // Fork
        const forkClaimLib = aLib()
        let counter = 0
        const { engine: forked, remapTable } = forkArgumentEngine(
            eng,
            "fork-arg",
            {
                claimLibrary: forkClaimLib,
            },
            { generateId: () => `fk-${counter++}` }
        )

        // Resolve forked premise IDs from remap table
        const forkPrem1Id = remapTable.premises.get("prem-1")!
        const forkPrem2Id = remapTable.premises.get("prem-2")!
        expect(forkPrem1Id).toBeDefined()
        expect(forkPrem2Id).toBeDefined()

        // Verify forked premise 1 exists and getRootExpressionId is remapped
        const forkedPm1 = forked
            .listPremises()
            .find((p) => p.getId() === forkPrem1Id)!
        expect(forkedPm1).toBeDefined()
        const forkRootExprId = forkedPm1.getRootExpressionId()
        expect(forkRootExprId).not.toBeNull()
        expect(forkRootExprId).not.toBe("op-and")
        expect(remapTable.expressions.get("op-and")).toBe(forkRootExprId)

        // Verify parentId chains are remapped inside forked prem-1
        const forkExprs1 = forkedPm1.getExpressions()
        const forkOpExpr = forkExprs1.find((e) => e.type === "operator")!
        expect(forkOpExpr).toBeDefined()
        expect(forkOpExpr.parentId).toBeNull()
        const forkChildren = forkExprs1.filter(
            (e) => e.parentId === forkOpExpr.id
        )
        expect(forkChildren).toHaveLength(2)
        // Each child's parentId should point to the forked operator, not original
        for (const child of forkChildren) {
            expect(child.parentId).toBe(forkOpExpr.id)
            expect(child.parentId).not.toBe("op-and")
        }

        // Verify variableId references are remapped
        const forkVarPId = remapTable.variables.get("var-p")!
        const forkVarQId = remapTable.variables.get("var-q")!
        expect(forkVarPId).toBeDefined()
        expect(forkVarQId).toBeDefined()
        for (const child of forkChildren) {
            expect(child.type).toBe("variable")
            if (child.type === "variable") {
                expect([forkVarPId, forkVarQId]).toContain(child.variableId)
                expect(child.variableId).not.toBe("var-p")
                expect(child.variableId).not.toBe("var-q")
            }
        }

        // Verify premise-bound variable's boundPremiseId is remapped
        const forkVarR = forked.getVariables().find((v) => v.symbol === "R")!
        expect(forkVarR).toBeDefined()
        expect(isPremiseBound(forkVarR)).toBe(true)
        if (isPremiseBound(forkVarR)) {
            expect(forkVarR.boundPremiseId).toBe(forkPrem1Id)
            expect(forkVarR.boundPremiseId).not.toBe("prem-1")
        }

        // Verify conclusion is remapped to forked prem-2
        expect(forked.getConclusionPremise()?.getId()).toBe(forkPrem2Id)
        expect(forked.getConclusionPremise()?.getId()).not.toBe("prem-2")
    })

    // -----------------------------------------------------------------------
    // Remap table accuracy and engine independence
    // -----------------------------------------------------------------------

    it("remap table covers all entities and all mapped IDs differ from originals", () => {
        const claimLib = aLib()
        const eng = new ArgumentEngine(
            { id: "src-arg", version: 0 },
            claimLib,
            { behavior: "permissive" }
        )

        eng.addVariable({
            id: "v1",
            argumentId: "src-arg",
            argumentVersion: 0,
            symbol: "P",
            claimId: "claim-default",
            claimVersion: 0,
        } as TClaimBoundVariable)
        eng.addVariable({
            id: "v2",
            argumentId: "src-arg",
            argumentVersion: 0,
            symbol: "Q",
            claimId: "claim-default",
            claimVersion: 0,
        } as TClaimBoundVariable)

        const { result: pm1 } = eng.createPremiseWithId("pr1")
        pm1.addExpression({
            id: "e1",
            argumentId: "src-arg",
            argumentVersion: 0,
            premiseId: "pr1",
            type: "variable",
            variableId: "v1",
            parentId: null,
            position: POSITION_INITIAL,
        })

        const { result: pm2 } = eng.createPremiseWithId("pr2")
        pm2.addExpression({
            id: "e2",
            argumentId: "src-arg",
            argumentVersion: 0,
            premiseId: "pr2",
            type: "variable",
            variableId: "v2",
            parentId: null,
            position: POSITION_INITIAL,
        })

        const forkClaimLib = aLib()
        const { remapTable } = forkArgumentEngine(eng, "forked-arg", {
            claimLibrary: forkClaimLib,
        })

        // Remap table has correct counts
        expect(remapTable.variables.size).toBe(4) // 2 claim-bound + 2 auto premise-bound
        expect(remapTable.premises.size).toBe(2)
        expect(remapTable.expressions.size).toBe(2)

        // All mapped IDs differ from originals
        for (const [origId, newId] of remapTable.variables) {
            expect(newId).not.toBe(origId)
        }
        for (const [origId, newId] of remapTable.premises) {
            expect(newId).not.toBe(origId)
        }
        for (const [origId, newId] of remapTable.expressions) {
            expect(newId).not.toBe(origId)
        }
    })

    it("forked engine is independent from source engine", () => {
        const claimLib = aLib()
        const eng = new ArgumentEngine(
            { id: "src-arg", version: 0 },
            claimLib,
            { behavior: "permissive" }
        )
        eng.createPremiseWithId("prem-only")

        const forkClaimLib = aLib()
        const { engine: forked } = forkArgumentEngine(eng, "forked-arg", {
            claimLibrary: forkClaimLib,
        })

        // Mutate the fork
        forked.createPremise()

        // Source is unaffected
        expect(eng.listPremises()).toHaveLength(1)
        expect(forked.listPremises()).toHaveLength(2)
    })

    // -----------------------------------------------------------------------
    // Mutability and checksum divergence
    // -----------------------------------------------------------------------

    it("forked entities are fully mutable", () => {
        const claimLib = aLib()
        const eng = new ArgumentEngine(
            { id: "src-arg", version: 0 },
            claimLib,
            { behavior: "permissive" }
        )

        eng.addVariable({
            id: "var-p",
            argumentId: "src-arg",
            argumentVersion: 0,
            symbol: "P",
            claimId: "claim-default",
            claimVersion: 0,
        } as TClaimBoundVariable)
        eng.addVariable({
            id: "var-q",
            argumentId: "src-arg",
            argumentVersion: 0,
            symbol: "Q",
            claimId: "claim-default",
            claimVersion: 0,
        } as TClaimBoundVariable)

        const { result: pm } = eng.createPremiseWithId("prem-src")
        pm.addExpression({
            id: "op-and",
            argumentId: "src-arg",
            argumentVersion: 0,
            premiseId: "prem-src",
            type: "operator",
            operator: "and",
            parentId: null,
            position: POSITION_INITIAL,
        })
        pm.addExpression({
            id: "expr-p",
            argumentId: "src-arg",
            argumentVersion: 0,
            premiseId: "prem-src",
            type: "variable",
            variableId: "var-p",
            parentId: "op-and",
            position: POSITION_INITIAL - 1,
        })
        pm.addExpression({
            id: "expr-q",
            argumentId: "src-arg",
            argumentVersion: 0,
            premiseId: "prem-src",
            type: "variable",
            variableId: "var-q",
            parentId: "op-and",
            position: POSITION_INITIAL + 1,
        })

        const forkClaimLib = aLib()
        const { engine: forked, remapTable } = forkArgumentEngine(
            eng,
            "forked-arg",
            {
                claimLibrary: forkClaimLib,
            }
        )

        const forkedPremise = forked.listPremises()[0]
        const forkedOpId = remapTable.expressions.get("op-and")!

        // Change and → or on the forked premise
        expect(() =>
            forkedPremise.changeOperator(forkedOpId, "or")
        ).not.toThrow()

        // Add a new premise to the fork
        expect(() => forked.createPremise()).not.toThrow()

        // Remove the original forked premise
        expect(() => forked.removePremise(forkedPremise.getId())).not.toThrow()

        // Fork ends up with just the newly added premise
        expect(forked.listPremises()).toHaveLength(1)
    })

    it("forked entity checksums diverge from source checksums", () => {
        const claimLib = aLib()
        const eng = new ArgumentEngine(
            { id: "src-arg", version: 0 },
            claimLib,
            { behavior: "permissive" }
        )

        eng.addVariable({
            id: "var-p",
            argumentId: "src-arg",
            argumentVersion: 0,
            symbol: "P",
            claimId: "claim-default",
            claimVersion: 0,
        } as TClaimBoundVariable)

        const { result: pm } = eng.createPremiseWithId("prem-src")
        pm.addExpression({
            id: "expr-p",
            argumentId: "src-arg",
            argumentVersion: 0,
            premiseId: "prem-src",
            type: "variable",
            variableId: "var-p",
            parentId: null,
            position: POSITION_INITIAL,
        })

        const forkClaimLib = aLib()
        const { engine: forked } = forkArgumentEngine(eng, "forked-arg", {
            claimLibrary: forkClaimLib,
        })

        const srcSnapshot = eng.snapshot()
        const forkSnapshot = forked.snapshot()

        // Argument checksums differ (IDs differ)
        expect(forkSnapshot.argument.checksum).not.toBe(
            srcSnapshot.argument.checksum
        )
        expect(forkSnapshot.argument.combinedChecksum).not.toBe(
            srcSnapshot.argument.combinedChecksum
        )

        // Premise checksums differ
        const srcPremise = srcSnapshot.premises[0]
        const forkPremise = forkSnapshot.premises[0]
        expect(forkPremise).toBeDefined()
        expect(forkPremise.premise.checksum).not.toBe(
            srcPremise.premise.checksum
        )

        // Expression checksums differ
        const srcExprs = srcSnapshot.premises[0].expressions.expressions
        const forkExprs = forkSnapshot.premises[0].expressions.expressions
        expect(forkExprs[0]).toBeDefined()
        expect(forkExprs[0].checksum).not.toBe(srcExprs[0].checksum)
    })

    // -----------------------------------------------------------------------
    // diffArguments with fork-aware matchers
    // -----------------------------------------------------------------------

    it("diffArguments without matchers sees forked entities as removed + added", () => {
        const claimLib = aLib()
        const eng = new ArgumentEngine(ARG, claimLib, {
            behavior: "permissive",
        })
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise()
        pm.addExpression(
            makeVarExpr("expr-1", "var-p", { premiseId: pm.getId() })
        )

        const forkClaimLib = aLib()
        const { engine: forked } = forkArgumentEngine(eng, "forked-arg", {
            claimLibrary: forkClaimLib,
        })

        const diff = diffArguments(eng, forked)

        // Without matchers, IDs differ → removed + added
        expect(diff.premises.removed).toHaveLength(1)
        expect(diff.premises.added).toHaveLength(1)
        expect(diff.premises.modified).toHaveLength(0)
        expect(diff.variables.removed).toHaveLength(2) // VAR_P + 1 auto
        expect(diff.variables.added).toHaveLength(2)
    })
})

describe("forkArgumentEngine", () => {
    it("produces identical results to the engine method", () => {
        const claimLib = aLib()

        const eng = new ArgumentEngine(
            { id: "src-arg", version: 2 },
            claimLib,
            { behavior: "permissive" }
        )

        eng.addVariable({
            id: "var-p",
            argumentId: "src-arg",
            argumentVersion: 2,
            symbol: "P",
            claimId: "claim-default",
            claimVersion: 0,
        } as TClaimBoundVariable)

        const { result: pm } = eng.createPremiseWithId("prem-1")
        pm.addExpression({
            id: "expr-1",
            argumentId: "src-arg",
            argumentVersion: 2,
            premiseId: "prem-1",
            type: "variable",
            variableId: "var-p",
            parentId: null,
            position: POSITION_INITIAL,
        })

        eng.setConclusionPremise("prem-1")

        const forkClaimLib = aLib()

        let counter = 0
        const { engine: forked, remapTable } = forkArgumentEngine(
            eng,
            "fork-arg",
            {
                claimLibrary: forkClaimLib,
            },
            { generateId: () => `fk-${counter++}` }
        )

        // Verify argument identity
        const forkedArg = forked.getArgument()
        expect(forkedArg.id).toBe("fork-arg")
        expect(forkedArg.version).toBe(0)

        // Verify remap table
        expect(remapTable.argumentId).toEqual({
            from: "src-arg",
            to: "fork-arg",
        })
        expect(remapTable.premises.size).toBe(1)
        expect(remapTable.expressions.size).toBe(1)
        expect(remapTable.variables.size).toBe(2) // var-p + auto premise-bound

        // Verify premise was remapped
        const forkedPremise = forked.listPremises()[0]
        expect(forkedPremise.getId()).toBe(remapTable.premises.get("prem-1"))

        // Verify expression was remapped
        const forkedExpr = forkedPremise.getExpressions()[0]
        expect(forkedExpr.id).toBe(remapTable.expressions.get("expr-1"))

        // Verify variable was remapped
        const forkedVar = forked
            .getVariables()
            .find((v) => v.id === remapTable.variables.get("var-p"))!
        expect(forkedVar).toBeDefined()

        // Verify conclusion remapped
        expect(forked.getConclusionPremise()?.getId()).toBe(
            remapTable.premises.get("prem-1")
        )

        // Verify independence
        forked.createPremise()
        expect(eng.listPremises()).toHaveLength(1)
        expect(forked.listPremises()).toHaveLength(2)
    })

    it("does not call canFork()", () => {
        class NoForkEngine extends ArgumentEngine {
            public override canFork(): boolean {
                return false
            }
        }
        const eng = new NoForkEngine(ARG, aLib())
        // Standalone function should NOT check canFork
        expect(() =>
            forkArgumentEngine(eng, "new-arg", {
                claimLibrary: aLib(),
            })
        ).not.toThrow()
    })

    // Behavior threading through the fork path
    it("inherits permissive behavior from the source engine", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        expect(eng.behavior).toBe("permissive")

        const { engine: forked } = forkArgumentEngine(eng, "forked-arg", {
            claimLibrary: aLib(),
        })
        expect(forked.behavior).toBe("permissive")
    })

    it("inherits assistive behavior from the source engine", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "assistive" })
        expect(eng.behavior).toBe("assistive")

        const { engine: forked } = forkArgumentEngine(eng, "forked-arg", {
            claimLibrary: aLib(),
        })
        expect(forked.behavior).toBe("assistive")
    })

    it("inherits the default assistive behavior when source omits it", () => {
        // Source constructed without explicit `behavior` — defaults to
        // 'assistive'. The fork inherits that default.
        const eng = new ArgumentEngine(ARG, aLib())
        expect(eng.behavior).toBe("assistive")

        const { engine: forked } = forkArgumentEngine(eng, "forked-arg", {
            claimLibrary: aLib(),
        })
        expect(forked.behavior).toBe("assistive")
    })

    it("respects an explicit options.behavior override (permissive → assistive)", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const { engine: forked } = forkArgumentEngine(
            eng,
            "forked-arg",
            { claimLibrary: aLib() },
            { behavior: "assistive" }
        )
        expect(eng.behavior).toBe("permissive")
        expect(forked.behavior).toBe("assistive")
    })

    it("respects an explicit options.behavior override (assistive → permissive)", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "assistive" })
        const { engine: forked } = forkArgumentEngine(
            eng,
            "forked-arg",
            { claimLibrary: aLib() },
            { behavior: "permissive" }
        )
        expect(eng.behavior).toBe("assistive")
        expect(forked.behavior).toBe("permissive")
    })

    it("forked engine's behavior is independent — setBehavior on source does not affect fork", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const { engine: forked } = forkArgumentEngine(eng, "forked-arg", {
            claimLibrary: aLib(),
        })
        expect(forked.behavior).toBe("permissive")

        // Mutating the source's behavior must NOT affect the fork.
        eng.setBehavior("assistive")
        expect(forked.behavior).toBe("permissive")
    })
})

describe("ForkRecordSchemas", () => {
    describe("CoreEntityForkRecordSchema", () => {
        it("should accept a valid entity fork record", () => {
            const record = {
                entityId: crypto.randomUUID(),
                forkedFromEntityId: crypto.randomUUID(),
                forkedFromArgumentId: crypto.randomUUID(),
                forkedFromArgumentVersion: 3,
                forkId: crypto.randomUUID(),
            }
            expect(Value.Check(CoreEntityForkRecordSchema, record)).toBe(true)
        })

        it("should reject a record missing required fields", () => {
            const record = {
                entityId: crypto.randomUUID(),
            }
            expect(Value.Check(CoreEntityForkRecordSchema, record)).toBe(false)
        })

        it("should accept additional properties", () => {
            const record = {
                entityId: crypto.randomUUID(),
                forkedFromEntityId: crypto.randomUUID(),
                forkedFromArgumentId: crypto.randomUUID(),
                forkedFromArgumentVersion: 0,
                forkId: crypto.randomUUID(),
                customField: "hello",
            }
            expect(Value.Check(CoreEntityForkRecordSchema, record)).toBe(true)
        })
    })

    describe("CoreExpressionForkRecordSchema", () => {
        it("should require forkedFromPremiseId", () => {
            const base = {
                entityId: crypto.randomUUID(),
                forkedFromEntityId: crypto.randomUUID(),
                forkedFromArgumentId: crypto.randomUUID(),
                forkedFromArgumentVersion: 0,
                forkId: crypto.randomUUID(),
            }
            expect(Value.Check(CoreExpressionForkRecordSchema, base)).toBe(
                false
            )

            const withPremise = {
                ...base,
                forkedFromPremiseId: crypto.randomUUID(),
            }
            expect(
                Value.Check(CoreExpressionForkRecordSchema, withPremise)
            ).toBe(true)
        })
    })

    describe("CoreClaimForkRecordSchema", () => {
        it("should require forkedFromEntityVersion", () => {
            const base = {
                entityId: crypto.randomUUID(),
                forkedFromEntityId: crypto.randomUUID(),
                forkedFromArgumentId: crypto.randomUUID(),
                forkedFromArgumentVersion: 0,
                forkId: crypto.randomUUID(),
            }
            expect(Value.Check(CoreClaimForkRecordSchema, base)).toBe(false)

            const withVersion = { ...base, forkedFromEntityVersion: 2 }
            expect(Value.Check(CoreClaimForkRecordSchema, withVersion)).toBe(
                true
            )
        })
    })
})

describe("ForkNamespace", () => {
    const makeRecord = (
        overrides: Partial<TCoreEntityForkRecord> = {}
    ): TCoreEntityForkRecord => ({
        entityId: crypto.randomUUID(),
        forkedFromEntityId: crypto.randomUUID(),
        forkedFromArgumentId: crypto.randomUUID(),
        forkedFromArgumentVersion: 0,
        forkId: crypto.randomUUID(),
        ...overrides,
    })

    describe("create", () => {
        it("should store and return the record", () => {
            const ns = new ForkNamespace()
            const record = makeRecord()
            const result = ns.create(record)
            expect(result).toEqual(record)
            expect(ns.get(record.entityId)).toEqual(record)
        })

        it("should throw on duplicate entityId", () => {
            const ns = new ForkNamespace()
            const record = makeRecord()
            ns.create(record)
            expect(() => ns.create(record)).toThrow(/already exists/)
        })
    })

    describe("get", () => {
        it("should return undefined for missing entityId", () => {
            const ns = new ForkNamespace()
            expect(ns.get("nonexistent")).toBeUndefined()
        })
    })

    describe("getAll", () => {
        it("should return all records", () => {
            const ns = new ForkNamespace()
            const r1 = ns.create(makeRecord())
            const r2 = ns.create(makeRecord())
            expect(ns.getAll()).toEqual(expect.arrayContaining([r1, r2]))
            expect(ns.getAll()).toHaveLength(2)
        })
    })

    describe("getByForkId", () => {
        it("should return records matching the forkId", () => {
            const ns = new ForkNamespace()
            const forkId = crypto.randomUUID()
            const r1 = ns.create(makeRecord({ forkId }))
            const r2 = ns.create(makeRecord({ forkId }))
            ns.create(makeRecord({ forkId: crypto.randomUUID() }))

            const results = ns.getByForkId(forkId)
            expect(results).toHaveLength(2)
            expect(results).toEqual(expect.arrayContaining([r1, r2]))
        })

        it("should return empty array for unknown forkId", () => {
            const ns = new ForkNamespace()
            expect(ns.getByForkId("nonexistent")).toEqual([])
        })
    })

    describe("remove", () => {
        it("should remove and return the record", () => {
            const ns = new ForkNamespace()
            const record = ns.create(makeRecord())
            const removed = ns.remove(record.entityId)
            expect(removed).toEqual(record)
            expect(ns.get(record.entityId)).toBeUndefined()
        })

        it("should throw if entityId not found", () => {
            const ns = new ForkNamespace()
            expect(() => ns.remove("nonexistent")).toThrow(/not found/)
        })
    })

    describe("snapshot / fromSnapshot", () => {
        it("should round-trip all records", () => {
            const ns = new ForkNamespace()
            const r1 = ns.create(makeRecord())
            const r2 = ns.create(makeRecord())

            const snap = ns.snapshot()
            const restored = ForkNamespace.fromSnapshot(snap)

            expect(restored.getAll()).toEqual(expect.arrayContaining([r1, r2]))
            expect(restored.getAll()).toHaveLength(2)
        })
    })

    describe("validate", () => {
        it("should return ok for valid records", () => {
            const ns = new ForkNamespace()
            ns.create(makeRecord())
            const result = ns.validate()
            expect(result.ok).toBe(true)
        })
    })
})

describe("ForkLibrary", () => {
    const makeBaseRecord = (
        overrides: Partial<TCoreEntityForkRecord> = {}
    ): TCoreEntityForkRecord => ({
        entityId: crypto.randomUUID(),
        forkedFromEntityId: crypto.randomUUID(),
        forkedFromArgumentId: crypto.randomUUID(),
        forkedFromArgumentVersion: 0,
        forkId: crypto.randomUUID(),
        ...overrides,
    })

    it("should expose five namespaces", () => {
        const lib = new ForkLibrary()
        expect(lib.arguments).toBeInstanceOf(ForkNamespace)
        expect(lib.premises).toBeInstanceOf(ForkNamespace)
        expect(lib.expressions).toBeInstanceOf(ForkNamespace)
        expect(lib.variables).toBeInstanceOf(ForkNamespace)
        expect(lib.claims).toBeInstanceOf(ForkNamespace)
    })

    it("should round-trip all namespaces via snapshot/fromSnapshot", () => {
        const lib = new ForkLibrary()
        const forkId = crypto.randomUUID()
        const argRecord = lib.arguments.create(makeBaseRecord({ forkId }))
        const premRecord = lib.premises.create(makeBaseRecord({ forkId }))
        const exprRecord = lib.expressions.create({
            ...makeBaseRecord({ forkId }),
            forkedFromPremiseId: crypto.randomUUID(),
        } as TCoreExpressionForkRecord)
        const varRecord = lib.variables.create(makeBaseRecord({ forkId }))
        const claimRecord = lib.claims.create({
            ...makeBaseRecord({ forkId }),
            forkedFromEntityVersion: 2,
        } as TCoreClaimForkRecord)

        const snap = lib.snapshot()
        const restored = ForkLibrary.fromSnapshot(snap)

        expect(restored.arguments.get(argRecord.entityId)).toEqual(argRecord)
        expect(restored.premises.get(premRecord.entityId)).toEqual(premRecord)
        expect(restored.expressions.get(exprRecord.entityId)).toEqual(
            exprRecord
        )
        expect(restored.variables.get(varRecord.entityId)).toEqual(varRecord)
        expect(restored.claims.get(claimRecord.entityId)).toEqual(claimRecord)
    })

    it("should merge validation results from all namespaces", () => {
        const lib = new ForkLibrary()
        lib.arguments.create(makeBaseRecord())
        const result = lib.validate()
        expect(result.ok).toBe(true)
    })
})

describe("ForkLibrary 5-namespace shape", () => {
    it("snapshot contains exactly 5 namespaces", () => {
        const lib = new ForkLibrary()
        const snapshot = lib.snapshot()
        expect(Object.keys(snapshot).sort()).toEqual([
            "arguments",
            "claims",
            "expressions",
            "premises",
            "variables",
        ])
    })
})

describe("Fork record schema equality across namespaces", () => {
    it("claim fork records validate via CoreClaimForkRecordSchema", () => {
        const claimForkRecord = {
            entityId: "00000000-0000-0000-0000-000000000002",
            forkedFromEntityId: "00000000-0000-0000-0000-000000000003",
            forkedFromArgumentId: "00000000-0000-0000-0000-000000000004",
            forkedFromArgumentVersion: 0,
            forkedFromEntityVersion: 0,
            forkId: "00000000-0000-0000-0000-000000000005",
        }
        expect(Value.Check(CoreClaimForkRecordSchema, claimForkRecord)).toBe(
            true
        )
    })
})

// ---------------------------------------------------------------------------
// Fork integration with derivation premises
// ---------------------------------------------------------------------------

describe("Fork integration with derivation premises", () => {
    /**
     * Sets up a PropositCore with one argument containing one derivation
     * premise. The derivation premise is bound to a single "normal" claim.
     * Returns the core, the argument ID, and the original claim ID.
     */
    function setupArgumentWithDerivationPremise() {
        const propositCore = new PropositCore()

        // Create the claim that the derivation premise will reference.
        const claim = propositCore.claims.create({ type: "normal" })
        const claimId = claim.id

        // Create the argument and its derivation premise.
        const argId = crypto.randomUUID()
        const engine = propositCore.arguments.create({
            id: argId,
            version: 0,
        })
        engine.createPremise({ type: "derivation", derivedClaimId: claimId })

        return { propositCore, argumentId: argId, claimId }
    }

    it("propagates type and derivedClaimId through forkArgument", () => {
        const { propositCore, argumentId, claimId } =
            setupArgumentWithDerivationPremise()
        const { engine: forkedEngine, claimRemap } =
            propositCore.forkArgument(argumentId)

        const forkedPremises = forkedEngine.listPremises()
        const forkedDerivation = forkedPremises.find(
            (p) => p.toPremiseData().type === "derivation"
        )
        expect(forkedDerivation).toBeDefined()
        expect(
            (forkedDerivation!.toPremiseData() as TCoreDerivationPremise)
                .derivedClaimId
        ).toBe(claimRemap.get(claimId))
    })

    it("forks a derivation premise's expression tree with the consequent referencing the cloned variable", () => {
        const { propositCore, argumentId } =
            setupArgumentWithDerivationPremise()
        const { engine: forkedEngine } = propositCore.forkArgument(argumentId)

        const derivationPremise = forkedEngine
            .listPremises()
            .find((p) => p.toPremiseData().type === "derivation")!
        expect(derivationPremise).toBeDefined()

        // Verifies the forked derivation premise's tree is well-formed
        // by checking it parses as a valid naked-Q (D-1) or fully
        // populated state via validate('derivable').
        const violations = forkedEngine.validate("derivable")
        const d1ForThisPremise = violations.filter(
            (v) =>
                v.code === "D-1" &&
                "premiseId" in v &&
                v.premiseId === derivationPremise.getId()
        )
        expect(d1ForThisPremise).toEqual([])

        // The snapshot is still produceable.
        const snap = derivationPremise.snapshot()
        expect(snap.expressions.expressions.length).toBeGreaterThan(0)
    })
})

describe("PropositCore.forkArgument transitive closure across axioms", () => {
    it("clones a normal claim, its cited citation, and its supporting axiom", () => {
        const core = new PropositCore()
        const normalClaim = core.claims.create({ type: "normal" })
        const cited = core.claims.create({ type: "citation" })
        const axiom = core.claims.create({ type: "axiomatic" })
        core.citations.add({
            id: crypto.randomUUID(),
            claimId: normalClaim.id,
            claimVersion: normalClaim.version,
            supportingClaimId: cited.id,
            supportingClaimVersion: cited.version,
        })
        core.axioms.add({
            id: crypto.randomUUID(),
            claimId: normalClaim.id,
            claimVersion: normalClaim.version,
            supportingClaimId: axiom.id,
            supportingClaimVersion: axiom.version,
        })

        const arg = { id: crypto.randomUUID(), version: 0 }
        core.arguments.create(arg)
        // Add a claim-bound variable for normalClaim so the seed walk picks it up.
        const engine = core.arguments.get(arg.id)!
        engine.ensureClaimBoundVariable(normalClaim.id)

        const { claimRemap } = core.forkArgument(arg.id, crypto.randomUUID())

        // All three claims should be cloned.
        expect(claimRemap.size).toBe(3)
        expect(claimRemap.get(normalClaim.id)).toBeDefined()
        expect(claimRemap.get(cited.id)).toBeDefined()
        expect(claimRemap.get(axiom.id)).toBeDefined()

        // Cloned citation/axiom connections live in the same PropositCore's libraries,
        // pointing at the cloned claims.
        const newNormalId = claimRemap.get(normalClaim.id)!
        expect(core.citations.getConnectionsForClaim(newNormalId)).toHaveLength(
            1
        )
        expect(core.axioms.getConnectionsForClaim(newNormalId)).toHaveLength(1)
        const citationConn =
            core.citations.getConnectionsForClaim(newNormalId)[0]
        const axiomConn = core.axioms.getConnectionsForClaim(newNormalId)[0]
        expect(citationConn.claimVersion).toBe(0)
        expect(citationConn.supportingClaimVersion).toBe(0)
        expect(axiomConn.claimVersion).toBe(0)
        expect(axiomConn.supportingClaimVersion).toBe(0)
    })

    it("walks multi-hop closure: normal claim A supported by both citation B and axiom X", () => {
        const core = new PropositCore()
        const a = core.claims.create({ type: "normal" })
        const b = core.claims.create({ type: "citation" })
        const axiomForA = core.claims.create({ type: "axiomatic" })
        core.citations.add({
            id: crypto.randomUUID(),
            claimId: a.id,
            claimVersion: a.version,
            supportingClaimId: b.id,
            supportingClaimVersion: b.version,
        })
        core.axioms.add({
            id: crypto.randomUUID(),
            claimId: a.id,
            claimVersion: a.version,
            supportingClaimId: axiomForA.id,
            supportingClaimVersion: axiomForA.version,
        })

        const arg = { id: crypto.randomUUID(), version: 0 }
        core.arguments.create(arg)
        const engine = core.arguments.get(arg.id)!
        engine.ensureClaimBoundVariable(a.id)

        const { claimRemap } = core.forkArgument(arg.id, crypto.randomUUID())
        expect(claimRemap.get(a.id)).toBeDefined()
        expect(claimRemap.get(b.id)).toBeDefined()
        expect(claimRemap.get(axiomForA.id)).toBeDefined()
    })
})

describe("forking an argument bound into another argument", () => {
    const externalBinding = {
        id: "v-ext",
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        symbol: "Ext",
        boundPremiseId: "p-in-other-arg",
        boundArgumentId: "arg-other",
        boundArgumentVersion: 2,
    }

    it("forkArgumentEngine keeps the binding pointing into the other argument", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.bindVariableToExternalPremise(externalBinding)

        const { engine: forked, remapTable } = forkArgumentEngine(
            eng,
            "forked-arg",
            { claimLibrary: aLib() }
        )

        const variable = forked.getVariable(
            remapTable.variables.get("v-ext")!
        ) as unknown as TPremiseBoundVariable
        expect(variable.boundPremiseId).toBe("p-in-other-arg")
        expect(variable.boundArgumentId).toBe("arg-other")
        expect(variable.boundArgumentVersion).toBe(2)
    })

    it("forkArgumentEngine moves a binding into this argument onto the fork", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.createPremiseWithId("p-local")
        eng.bindVariableToPremise({
            id: "v-int",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "Int",
            boundPremiseId: "p-local",
            boundArgumentId: ARG.id,
            boundArgumentVersion: ARG.version,
        } as TPremiseBoundVariable)

        const { engine: forked, remapTable } = forkArgumentEngine(
            eng,
            "forked-arg",
            { claimLibrary: aLib() }
        )

        const variable = forked.getVariable(
            remapTable.variables.get("v-int")!
        ) as unknown as TPremiseBoundVariable
        expect(variable.boundPremiseId).toBe(remapTable.premises.get("p-local"))
        expect(variable.boundArgumentId).toBe("forked-arg")
        expect(variable.boundArgumentVersion).toBe(0)
    })

    it("PropositCore.forkArgument succeeds on an argument holding the binding", () => {
        const core = new PropositCore()
        const arg = { id: crypto.randomUUID(), version: 0 }
        core.arguments.create(arg)
        core.arguments.get(arg.id)!.bindVariableToExternalPremise({
            ...externalBinding,
            argumentId: arg.id,
            argumentVersion: arg.version,
        })

        const { engine } = core.forkArgument(arg.id, crypto.randomUUID())
        const [variable] = engine
            .snapshot()
            .variables.variables.filter((v) =>
                isPremiseBound(v)
            ) as unknown as TPremiseBoundVariable[]
        expect(variable.boundArgumentId).toBe("arg-other")
        expect(variable.boundPremiseId).toBe("p-in-other-arg")
    })
})
