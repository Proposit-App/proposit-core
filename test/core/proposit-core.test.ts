import { describe, expect, it } from "vitest"
import {
    ArgumentEngine,
    PremiseEngine,
    ClaimLibrary,
    ForkLibrary,
    ArgumentLibrary,
    PropositCore,
} from "../../src/lib/index"
import { ClaimCitationLibrary } from "../../src/lib/core/claim-citation-library"
import {
    isClaimBound,
    type TCoreArgument,
    type TCorePropositionalVariable,
    type TCorePremise,
} from "../../src/lib/schemata"
import { VariableManager } from "../../src/lib/core/variable-manager"
import type { TOptionalChecksum } from "../../src/lib/schemata/shared"
import { POSITION_INITIAL } from "../../src/lib/utils/position"
import { ARG, aLib, makeVarExpr, VAR_P } from "./fixtures"
import { at, build, not, v, x } from "./response-fixtures"

describe("ArgumentLibrary", () => {
    const makeArgument = (): TOptionalChecksum<TCoreArgument> => ({
        id: crypto.randomUUID(),
        version: 0,
    })

    const makeLibraries = () => {
        const claimLibrary = new ClaimLibrary()
        return { claimLibrary }
    }

    it("should create and retrieve an engine", () => {
        const libs = makeLibraries()
        const argLib = new ArgumentLibrary(libs)
        const arg = makeArgument()
        const engine = argLib.create(arg)

        expect(engine).toBeInstanceOf(ArgumentEngine)
        expect(engine.getArgument().id).toBe(arg.id)
        expect(argLib.get(arg.id)).toBe(engine)
    })

    it("should throw on duplicate argument ID", () => {
        const libs = makeLibraries()
        const argLib = new ArgumentLibrary(libs)
        const arg = makeArgument()
        argLib.create(arg)
        expect(() => argLib.create(arg)).toThrow(/already exists/)
    })

    it("should list all engines", () => {
        const libs = makeLibraries()
        const argLib = new ArgumentLibrary(libs)
        argLib.create(makeArgument())
        argLib.create(makeArgument())
        expect(argLib.getAll()).toHaveLength(2)
    })

    it("should remove and return an engine", () => {
        const libs = makeLibraries()
        const argLib = new ArgumentLibrary(libs)
        const arg = makeArgument()
        const engine = argLib.create(arg)
        const removed = argLib.remove(arg.id)

        expect(removed).toBe(engine)
        expect(argLib.get(arg.id)).toBeUndefined()
    })

    it("should throw when removing nonexistent ID", () => {
        const libs = makeLibraries()
        const argLib = new ArgumentLibrary(libs)
        expect(() => argLib.remove("nonexistent")).toThrow(/not found/)
    })

    it("should round-trip via snapshot/fromSnapshot", () => {
        const libs = makeLibraries()
        const argLib = new ArgumentLibrary(libs)
        const arg = makeArgument()
        argLib.create(arg)

        const snap = argLib.snapshot()
        const restored = ArgumentLibrary.fromSnapshot(snap, libs)

        expect(restored.get(arg.id)).toBeDefined()
        expect(restored.get(arg.id)!.getArgument().id).toBe(arg.id)
    })

    it("should register a pre-built engine", () => {
        const libs = makeLibraries()
        const argLib = new ArgumentLibrary(libs)
        const arg = makeArgument()
        const engine = new ArgumentEngine(arg, libs.claimLibrary, {
            behavior: "permissive",
        })
        argLib.register(engine)
        expect(argLib.get(arg.id)).toBe(engine)
    })

    it("should throw when registering duplicate ID", () => {
        const libs = makeLibraries()
        const argLib = new ArgumentLibrary(libs)
        const arg = makeArgument()
        argLib.create(arg)
        const engine = new ArgumentEngine(arg, libs.claimLibrary, {
            behavior: "permissive",
        })
        expect(() => argLib.register(engine)).toThrow(/already exists/)
    })
})

describe("PropositCore", () => {
    it("should construct with default libraries", () => {
        const core = new PropositCore()
        expect(core.arguments).toBeInstanceOf(ArgumentLibrary)
        expect(core.claims).toBeInstanceOf(ClaimLibrary)
        expect(core.citations).toBeInstanceOf(ClaimCitationLibrary)
        expect(core.forks).toBeInstanceOf(ForkLibrary)
    })

    it("should accept pre-constructed libraries", () => {
        const claimLibrary = new ClaimLibrary()
        const claimCitationLibrary = new ClaimCitationLibrary(claimLibrary)
        const core = new PropositCore({
            claimLibrary,
            claimCitationLibrary,
        })
        expect(core.claims).toBe(claimLibrary)
        expect(core.citations).toBe(claimCitationLibrary)
    })

    it("should accept a pre-constructed fork library", () => {
        const forkLibrary = new ForkLibrary()
        const core = new PropositCore({ forkLibrary })
        expect(core.forks).toBe(forkLibrary)
    })

    it("should accept a pre-constructed argument library", () => {
        const claimLibrary = new ClaimLibrary()
        const claimCitationLibrary = new ClaimCitationLibrary(claimLibrary)
        const argumentLibrary = new ArgumentLibrary({
            claimLibrary,
        })
        const core = new PropositCore({
            claimLibrary,
            claimCitationLibrary,
            argumentLibrary,
        })
        expect(core.arguments).toBe(argumentLibrary)
    })

    it("should round-trip via snapshot/fromSnapshot with claims", () => {
        const core = new PropositCore()
        const claim = core.claims.create({
            id: crypto.randomUUID(),
            type: "normal",
        })

        const snap = core.snapshot()
        const restored = PropositCore.fromSnapshot(snap)

        expect(restored.claims.get(claim.id, claim.version)).toBeDefined()
        expect(restored.claims.get(claim.id, claim.version)!.id).toBe(claim.id)
    })

    it("should round-trip via snapshot/fromSnapshot with arguments", () => {
        const core = new PropositCore()
        const argId = crypto.randomUUID()
        core.arguments.create({ id: argId, version: 0 })

        const snap = core.snapshot()
        const restored = PropositCore.fromSnapshot(snap)

        expect(restored.arguments.get(argId)).toBeDefined()
    })

    it("should round-trip via snapshot/fromSnapshot with claim citations", () => {
        const core = new PropositCore()
        const claim = core.claims.create({
            id: crypto.randomUUID(),
            type: "normal",
        })
        core.claims.freeze(claim.id)
        const source = core.claims.create({
            id: crypto.randomUUID(),
            type: "citation",
        })
        core.claims.freeze(source.id)
        const cit = core.citations.add({
            id: crypto.randomUUID(),
            claimId: claim.id,
            claimVersion: 0,
            supportingClaimId: source.id,
            supportingClaimVersion: 0,
        })

        const snap = core.snapshot()
        const restored = PropositCore.fromSnapshot(snap)

        expect(restored.citations.get(cit.id)).toBeDefined()
        expect(restored.citations.get(cit.id)!.claimId).toBe(claim.id)
    })

    it("should round-trip via snapshot/fromSnapshot with fork records", () => {
        const core = new PropositCore()
        const forkId = crypto.randomUUID()
        core.forks.arguments.create({
            entityId: crypto.randomUUID(),
            forkedFromEntityId: crypto.randomUUID(),
            forkedFromArgumentId: crypto.randomUUID(),
            forkedFromArgumentVersion: 0,
            forkId,
        })

        const snap = core.snapshot()
        const restored = PropositCore.fromSnapshot(snap)

        expect(restored.forks.arguments.getAll()).toHaveLength(1)
        expect(restored.forks.arguments.getAll()[0].forkId).toBe(forkId)
    })

    it("should round-trip a full snapshot with all library types", () => {
        const core = new PropositCore()

        // Populate claims (one normal, one citation)
        const claim = core.claims.create({
            id: crypto.randomUUID(),
            type: "normal",
        })
        core.claims.freeze(claim.id)
        const source = core.claims.create({
            id: crypto.randomUUID(),
            type: "citation",
        })
        core.claims.freeze(source.id)

        // Populate citations
        core.citations.add({
            id: crypto.randomUUID(),
            claimId: claim.id,
            claimVersion: 0,
            supportingClaimId: source.id,
            supportingClaimVersion: 0,
        })

        // Populate arguments
        core.arguments.create({ id: crypto.randomUUID(), version: 0 })

        // Populate forks
        core.forks.arguments.create({
            entityId: crypto.randomUUID(),
            forkedFromEntityId: crypto.randomUUID(),
            forkedFromArgumentId: crypto.randomUUID(),
            forkedFromArgumentVersion: 0,
            forkId: crypto.randomUUID(),
        })

        const snap = core.snapshot()
        const restored = PropositCore.fromSnapshot(snap)

        expect(restored.claims.getAll()).toHaveLength(4) // 2× (frozen + successor)
        expect(restored.citations.getAll()).toHaveLength(1)
        expect(restored.arguments.getAll()).toHaveLength(1)
        expect(restored.forks.arguments.getAll()).toHaveLength(1)
    })

    it("should return ok validation for empty core", () => {
        const core = new PropositCore()
        const result = core.validate()
        expect(result.ok).toBe(true)
        expect(result.violations).toHaveLength(0)
    })

    it("should merge validation results from all libraries", () => {
        const core = new PropositCore()

        // Populate with valid data
        const claim = core.claims.create({
            id: crypto.randomUUID(),
            type: "normal",
        })
        core.claims.freeze(claim.id)
        const source = core.claims.create({
            id: crypto.randomUUID(),
            type: "citation",
        })
        core.claims.freeze(source.id)
        core.arguments.create({ id: crypto.randomUUID(), version: 0 })

        const result = core.validate()
        expect(result.ok).toBe(true)
    })

    it("should propagate config to internally constructed libraries", () => {
        // The config should thread through to ArgumentLibrary engine options.
        // We verify this indirectly by creating an argument engine and checking
        // it works properly with default config.
        const core = new PropositCore({
            checksumConfig: {
                argumentFields: new Set(["id", "version"]),
            },
        })
        const argId = crypto.randomUUID()
        const engine = core.arguments.create({ id: argId, version: 0 })
        expect(engine).toBeDefined()
        expect(engine.getArgument().id).toBe(argId)
    })

    describe("forkArgument", () => {
        const setupForFork = () => {
            const core = new PropositCore()

            // Create a normal claim and freeze it
            const claim = core.claims.create({
                id: crypto.randomUUID(),
                type: "normal",
            })
            const frozenResult = core.claims.freeze(claim.id)

            // Create a citation-typed claim (the source-side endpoint) and freeze it
            const source = core.claims.create({
                id: crypto.randomUUID(),
                type: "citation",
            })
            const frozenSource = core.claims.freeze(source.id)

            // Create a citation linking citing claim → source claim
            const cit = core.citations.add({
                id: crypto.randomUUID(),
                claimId: frozenResult.frozen.id,
                claimVersion: frozenResult.frozen.version,
                supportingClaimId: frozenSource.frozen.id,
                supportingClaimVersion: frozenSource.frozen.version,
            })

            // Create an argument with a variable referencing the frozen claim
            const arg = { id: crypto.randomUUID(), version: 0 }
            const engine = core.arguments.create(arg)
            const { result: premiseEngine } = engine.createPremise()
            const premiseId = premiseEngine.toPremiseData().id
            const { result: variable } = engine.addVariable({
                id: crypto.randomUUID(),
                symbol: "P",
                argumentId: arg.id,
                argumentVersion: 0,
                claimId: frozenResult.frozen.id,
                claimVersion: frozenResult.frozen.version,
            })
            premiseEngine.addExpression({
                id: crypto.randomUUID(),
                argumentId: arg.id,
                argumentVersion: 0,
                premiseId,
                type: "variable",
                variableId: variable.id,
                parentId: null,
                position: POSITION_INITIAL,
            })

            return {
                core,
                arg,
                engine,
                claim: frozenResult.frozen,
                source: frozenSource.frozen,
                cit,
                variable,
                premiseId,
            }
        }

        it("should fork an argument with cloned claims and citations", () => {
            const { core, arg, premiseId } = setupForFork()
            const newArgId = crypto.randomUUID()
            const result = core.forkArgument(arg.id, newArgId)

            expect(core.arguments.get(newArgId)).toBeDefined()
            expect(result.engine.getArgument().id).toBe(newArgId)
            // claimRemap covers the claim-bound variable's claim plus the
            // citation-typed source claim transitively pulled in.
            expect(result.claimRemap.size).toBe(2)
            expect(result.argumentFork).toBeDefined()
            expect(core.forks.arguments.getAll()).toHaveLength(1)
            expect(core.forks.premises.getAll().length).toBeGreaterThan(0)
            expect(core.forks.variables.getAll().length).toBeGreaterThan(0)
            expect(core.forks.claims.getAll()).toHaveLength(2)
            expect(core.forks.expressions.getAll().length).toBeGreaterThan(0)
            const exprFork = core.forks.expressions.getAll()[0]
            expect(exprFork.forkedFromPremiseId).toBe(premiseId)
        })

        it("should update forked variables to reference cloned claims", () => {
            const { core, arg, claim } = setupForFork()
            const newArgId = crypto.randomUUID()
            const result = core.forkArgument(arg.id, newArgId)

            const forkedVars = result.engine.getVariables()
            // createPremise auto-creates a premise-bound variable, so we have 2
            const claimBoundVars = forkedVars.filter(isClaimBound)
            expect(claimBoundVars).toHaveLength(1)
            const forkedVar = claimBoundVars[0]
            expect(forkedVar.claimId).not.toBe(claim.id)
            expect(result.claimRemap.get(claim.id)).toBe(forkedVar.claimId)
        })

        it("should throw when canFork returns false", () => {
            const core = new PropositCore()
            const arg = { id: crypto.randomUUID(), version: 0 }
            core.arguments.create(arg)

            // Replace with a no-fork engine
            const engine = core.arguments.remove(arg.id)
            class NoForkEngine extends ArgumentEngine {
                public override canFork(): boolean {
                    return false
                }
            }
            const noFork = new NoForkEngine(engine.getArgument(), core.claims)
            core.arguments.register(noFork)

            expect(() =>
                core.forkArgument(arg.id, crypto.randomUUID())
            ).toThrow(/not allowed/)
        })

        it("should throw when argument not found", () => {
            const core = new PropositCore()
            expect(() =>
                core.forkArgument("nonexistent", crypto.randomUUID())
            ).toThrow(/not found/)
        })

        it("should create cloned claim citations", () => {
            const { core, arg } = setupForFork()
            const citsBefore = core.citations.getAll().length
            core.forkArgument(arg.id, crypto.randomUUID())
            expect(core.citations.getAll().length).toBe(citsBefore + 1)
        })

        it("should dedup claims when multiple variables reference the same claim", () => {
            const core = new PropositCore()
            const claim = core.claims.create({
                id: crypto.randomUUID(),
                type: "normal",
            })

            const arg = { id: crypto.randomUUID(), version: 0 }
            const engine = core.arguments.create(arg)
            engine.createPremise()
            engine.addVariable({
                id: crypto.randomUUID(),
                symbol: "P",
                argumentId: arg.id,
                argumentVersion: 0,
                claimId: claim.id,
                claimVersion: claim.version,
            })
            engine.addVariable({
                id: crypto.randomUUID(),
                symbol: "Q",
                argumentId: arg.id,
                argumentVersion: 0,
                claimId: claim.id,
                claimVersion: claim.version,
            })

            const result = core.forkArgument(arg.id, crypto.randomUUID())
            expect(result.claimRemap.size).toBe(1)
            const forkedVars = result.engine.getVariables()
            const claimBoundVars = forkedVars.filter(isClaimBound)
            const claimIds = new Set(claimBoundVars.map((v) => v.claimId))
            expect(claimIds.size).toBe(1)
        })

        it("should merge extras into fork records", () => {
            const { core, arg } = setupForFork()
            const result = core.forkArgument(arg.id, crypto.randomUUID(), {
                argumentForkExtras: {
                    customTag: "test",
                } as Record<string, unknown>,
            })
            expect(
                (result.argumentFork as Record<string, unknown>).customTag
            ).toBe("test")
        })

        it("should be overridable by subclasses", () => {
            let hookCalled = false
            class CustomCore extends PropositCore {
                public override forkArgument(
                    ...args: Parameters<PropositCore["forkArgument"]>
                ) {
                    hookCalled = true
                    return super.forkArgument(...args)
                }
            }
            const core = new CustomCore()
            const claim = core.claims.create({
                id: crypto.randomUUID(),
                type: "normal",
            })
            const arg = { id: crypto.randomUUID(), version: 0 }
            const engine = core.arguments.create(arg)
            engine.createPremise()
            engine.addVariable({
                id: crypto.randomUUID(),
                symbol: "P",
                argumentId: arg.id,
                argumentVersion: 0,
                claimId: claim.id,
                claimVersion: claim.version,
            })

            core.forkArgument(arg.id, crypto.randomUUID())
            expect(hookCalled).toBe(true)
        })

        it("should record forkedFromEntityVersion on claim fork records", () => {
            const { core, arg, claim } = setupForFork()
            const currentClaimVersion = core.claims.getCurrent(
                claim.id
            )!.version
            core.forkArgument(arg.id, crypto.randomUUID())

            const claimForks = core.forks.claims.getAll()
            const matching = claimForks.find(
                (cf) => cf.forkedFromEntityId === claim.id
            )
            expect(matching).toBeDefined()
            expect(matching!.forkedFromEntityVersion).toBe(currentClaimVersion)
        })

        it("should propagate a custom forkId to all five fork record namespaces", () => {
            const { core, arg } = setupForFork()
            const customForkId = "custom-fork-id"
            core.forkArgument(arg.id, crypto.randomUUID(), {
                forkId: customForkId,
            })

            expect(
                core.forks.arguments
                    .getAll()
                    .every((r) => r.forkId === customForkId)
            ).toBe(true)
            expect(
                core.forks.premises
                    .getAll()
                    .every((r) => r.forkId === customForkId)
            ).toBe(true)
            expect(
                core.forks.expressions
                    .getAll()
                    .every((r) => r.forkId === customForkId)
            ).toBe(true)
            expect(
                core.forks.variables
                    .getAll()
                    .every((r) => r.forkId === customForkId)
            ).toBe(true)
            expect(
                core.forks.claims
                    .getAll()
                    .every((r) => r.forkId === customForkId)
            ).toBe(true)
        })

        // Behavior threads through PropositCore.forkArgument too,
        // via the shared `TForkArgumentOptions` shape passed down to
        // `forkArgumentEngine`.
        it("inherits behavior from the source engine through PropositCore.forkArgument", () => {
            const { core, arg, engine } = setupForFork()
            engine.setBehavior("permissive")
            const result = core.forkArgument(arg.id, crypto.randomUUID())
            expect(result.engine.behavior).toBe("permissive")
        })

        it("honors options.behavior override through PropositCore.forkArgument", () => {
            const { core, arg, engine } = setupForFork()
            engine.setBehavior("assistive")
            const result = core.forkArgument(arg.id, crypto.randomUUID(), {
                behavior: "permissive",
            })
            expect(engine.behavior).toBe("assistive")
            expect(result.engine.behavior).toBe("permissive")
        })
    })

    describe("diffArguments", () => {
        it("should diff two arguments", () => {
            const core = new PropositCore()
            const arg1 = { id: crypto.randomUUID(), version: 0 }
            const arg2 = { id: crypto.randomUUID(), version: 0 }
            core.arguments.create(arg1)
            core.arguments.create(arg2)

            const diff = core.diffArguments(arg1.id, arg2.id)
            expect(diff).toBeDefined()
            expect(diff.argument).toBeDefined()
        })

        it("should automatically pair forked entities via fork records", () => {
            const core = new PropositCore()
            const claim = core.claims.create({
                id: crypto.randomUUID(),
                type: "normal",
            })
            const arg = { id: crypto.randomUUID(), version: 0 }
            const engine = core.arguments.create(arg)
            engine.createPremise()
            engine.addVariable({
                id: crypto.randomUUID(),
                symbol: "P",
                argumentId: arg.id,
                argumentVersion: 0,
                claimId: claim.id,
                claimVersion: claim.version,
            })

            const newArgId = crypto.randomUUID()
            core.forkArgument(arg.id, newArgId)

            const diff = core.diffArguments(arg.id, newArgId)
            // Forked premises should be paired (not added/removed)
            expect(diff.premises.added).toHaveLength(0)
            expect(diff.premises.removed).toHaveLength(0)
        })

        it("should allow caller-provided matchers to override", () => {
            const core = new PropositCore()
            const arg1 = { id: crypto.randomUUID(), version: 0 }
            const arg2 = { id: crypto.randomUUID(), version: 0 }
            core.arguments.create(arg1)
            core.arguments.create(arg2)

            const neverMatch = () => false
            const diff = core.diffArguments(arg1.id, arg2.id, {
                premiseMatcher: neverMatch,
            })
            expect(diff).toBeDefined()
        })

        it("should throw when argument not found", () => {
            const core = new PropositCore()
            expect(() => core.diffArguments("a", "b")).toThrow(/not found/)
        })
    })

    // ---------------------------------------------------------------------------
    // generateId injection — ExpressionManager
    // ---------------------------------------------------------------------------

    // ---------------------------------------------------------------------------
    // generateId injection — PremiseEngine
    // ---------------------------------------------------------------------------

    describe("generateId injection — PremiseEngine", () => {
        it("uses injected generateId for toggleNegation wrapper IDs", () => {
            let counter = 0
            const generateId = () => `pe-id-${++counter}`

            const vm = new VariableManager()
            vm.addVariable(VAR_P as TCorePropositionalVariable)

            const pe = new PremiseEngine(
                {
                    id: "premise-1",
                    argumentId: ARG.id,
                    argumentVersion: ARG.version,
                    type: "freeform" as const,
                } as TCorePremise,
                { argument: ARG, variables: vm },
                { generateId }
            )

            // Add a single variable expression
            pe.addExpression(
                makeVarExpr("v-p", "var-p", { parentId: null, position: 0 })
            )

            // Toggle negation wraps it with a NOT — the NOT's ID should use generateId
            pe.toggleNegation("v-p")

            const allExprs = pe.getExpressions()
            const notExpr = allExprs.find(
                (e) => e.type === "operator" && e.operator === "not"
            )
            expect(notExpr).toBeDefined()
            expect(notExpr!.id).toMatch(/^pe-id-/)
        })
    })

    // ---------------------------------------------------------------------------
    // generateId injection — ArgumentEngine
    // ---------------------------------------------------------------------------

    describe("generateId injection — ArgumentEngine", () => {
        it("uses injected generateId for createPremise and auto-variable IDs", () => {
            let counter = 0
            const generateId = () => `ae-id-${++counter}`

            const engine = new ArgumentEngine(ARG, aLib(), {
                generateId,
            })

            const { result: pm } = engine.createPremise()

            // Premise ID should come from generateId
            expect(pm.getId()).toBe("ae-id-1")

            // Auto-created premise-bound variable should also use generateId
            const vars = engine.getVariables()
            expect(vars.length).toBe(1)
            expect(vars[0].id).toBe("ae-id-2")
        })

        it("falls back to default generateId when none provided", () => {
            const engine = new ArgumentEngine(ARG, aLib(), {
                behavior: "permissive",
            })
            const { result: pm } = engine.createPremise()

            // Default generates valid UUIDs
            expect(pm.getId()).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
            )
        })
    })
})

// ---------------------------------------------------------------------------
// generateId injection — ArgumentLibrary
// ---------------------------------------------------------------------------

describe("generateId injection — ArgumentLibrary", () => {
    it("threads generateId to engines created via create()", () => {
        let counter = 0
        const generateId = () => `al-id-${++counter}`

        const lib = new ArgumentLibrary(
            {
                claimLibrary: aLib(),
            },
            { generateId }
        )

        const engine = lib.create({ id: "arg-1", version: 0 })
        const { result: pm } = engine.createPremise()

        expect(pm.getId()).toBe("al-id-1")
    })

    it("threads generateId through fromSnapshot restoration", () => {
        let counter = 0
        const generateId = () => `al-id-${++counter}`

        // Create library with one engine + one premise
        const lib = new ArgumentLibrary(
            {
                claimLibrary: aLib(),
            },
            { generateId }
        )
        const engine = lib.create({ id: "arg-1", version: 0 })
        engine.createPremise()

        // Snapshot, then restore with a NEW generateId
        const snap = lib.snapshot()
        let restoreCounter = 0
        const restoreGenerateId = () => `restored-id-${++restoreCounter}`

        const restoredLib = ArgumentLibrary.fromSnapshot(
            snap,
            {
                claimLibrary: aLib(),
            },
            { generateId: restoreGenerateId }
        )

        // New mutations on the restored engine should use the new generateId
        const restoredEngine = restoredLib.get("arg-1")!
        const { result: newPm } = restoredEngine.createPremise()
        expect(newPm.getId()).toBe("restored-id-1")
    })

    it("threads generateId to restored PremiseEngines for post-restoration mutations", () => {
        let counter = 0
        const generateId = () => `orig-id-${++counter}`

        const claimLib = aLib()
        const lib = new ArgumentLibrary(
            {
                claimLibrary: claimLib,
            },
            { generateId }
        )
        const engine = lib.create({ id: "arg-1", version: 0 })
        engine.addVariable({
            id: "var-p",
            argumentId: "arg-1",
            argumentVersion: 0,
            symbol: "P",
            claimId: "claim-default",
            claimVersion: 0,
        })
        const { result: pm } = engine.createPremise()
        const premiseId = pm.getId()

        // Add a variable expression so toggleNegation has something to wrap
        pm.addExpression({
            id: "v-p",
            argumentId: "arg-1",
            argumentVersion: 0,
            premiseId,
            type: "variable",
            variableId: "var-p",
            parentId: null,
            position: 0,
        })

        // Snapshot, restore with a new generateId
        const snap = lib.snapshot()
        let restoreCounter = 0
        const restoreGenerateId = () => `snap-id-${++restoreCounter}`

        const restoredLib = ArgumentLibrary.fromSnapshot(
            snap,
            {
                claimLibrary: claimLib,
            },
            { generateId: restoreGenerateId }
        )

        // toggleNegation on a restored PremiseEngine should use the new generateId
        const restoredEngine = restoredLib.get("arg-1")!
        const restoredPm = restoredEngine.getPremise(premiseId)!
        restoredPm.toggleNegation("v-p")

        const allExprs = restoredPm.getExpressions()
        const notExpr = allExprs.find(
            (e) => e.type === "operator" && e.operator === "not"
        )
        expect(notExpr).toBeDefined()
        expect(notExpr!.id).toMatch(/^snap-id-/)
    })
})

// ---------------------------------------------------------------------------
// generateId injection — PropositCore
// ---------------------------------------------------------------------------

describe("generateId injection — PropositCore", () => {
    it("threads generateId to ArgumentLibrary for engine creation", () => {
        let counter = 0
        const generateId = () => `pc-id-${++counter}`

        const core = new PropositCore({ generateId })
        const engine = core.arguments.create({ id: "arg-1", version: 0 })
        const { result: pm } = engine.createPremise()

        expect(pm.getId()).toBe("pc-id-1")
    })

    it("uses generateId in forkArgument for library-level entities", () => {
        let counter = 0
        const generateId = () => `pc-id-${++counter}`

        const core = new PropositCore({ generateId })
        const engine = core.arguments.create({
            id: "pc-id-1",
            version: 0,
        })

        // Add a claim-bound variable and a premise
        const claim = core.claims.create({ id: "pc-id-2", type: "normal" })
        engine.addVariable({
            id: "pc-id-3",
            argumentId: "pc-id-1",
            argumentVersion: 0,
            symbol: "P",
            claimId: claim.id,
            claimVersion: claim.version,
        })
        engine.createPremise()

        // Fork — should use generateId for new claim, source, and fork IDs
        const result = core.forkArgument("pc-id-1")

        // All generated IDs should match our pattern
        expect(result.engine.getArgument().id).toMatch(/^pc-id-/)
        expect(result.claimRemap.size).toBeGreaterThanOrEqual(1)
        for (const newClaimId of result.claimRemap.values()) {
            expect(newClaimId).toMatch(/^pc-id-/)
        }
    })

    it("falls back to default generateId", () => {
        const core = new PropositCore()
        const engine = core.arguments.create({
            id: crypto.randomUUID(),
            version: 0,
        })
        const { result: pm } = engine.createPremise()

        expect(pm.getId()).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        )
    })
})

describe("PropositCore.forkArgument of a response", () => {
    // Y answers X.3, holds X's claim P as a premise, and contradicts X's P
    // through a link: incoherent, because the shared claim is one
    // proposition. A fork must keep it so.
    function setUp(registerTarget: boolean) {
        const core = new PropositCore()
        const target = build({
            id: "x",
            version: 3,
            lib: core.claims,
            conclusion: at("c", v("C")),
            premises: [at("p", v("P"))],
        })
        const response = build({
            id: "y",
            version: 1,
            lib: core.claims,
            respondsTo: target,
            premises: [v("P"), not(x("p"))],
        })
        core.arguments.register(response.engine)
        if (registerTarget) core.arguments.register(target.engine)
        return { core, target, response }
    }

    it("keeps the claims it shares with the argument it answers, so its checks answer as before", () => {
        const { core, target } = setUp(true)
        const targetSnapshot = target.engine.snapshot()
        const { engine: fork, claimRemap } = core.forkArgument("y", "y-fork")
        expect(claimRemap.has("claim-P")).toBe(false)
        expect(fork.checkResponseCoherent(targetSnapshot)).toMatchObject({
            coherent: false,
        })
        const linkId = fork.listPremises()[1].getId()
        expect(fork.checkLink(linkId, targetSnapshot).status).toBe("incoherent")
    })

    it("still clones a claim of its own that the argument answered does not use", () => {
        const { core } = setUp(true)
        core.claims.create({ id: "claim-own", type: "normal" } as never)
        const own = core.arguments.get("y")!
        own.addVariable({
            id: "y-own",
            symbol: "Own",
            argumentId: "y",
            argumentVersion: 1,
            claimId: "claim-own",
            claimVersion: 0,
        } as never)
        const { claimRemap } = core.forkArgument("y", "y-fork")
        expect(claimRemap.has("claim-own")).toBe(true)
        expect(claimRemap.has("claim-P")).toBe(false)
    })

    it("takes the argument answered from the options when the library does not hold it", () => {
        const { core, target } = setUp(false)
        const targetSnapshot = target.engine.snapshot()
        const { engine: fork, claimRemap } = core.forkArgument("y", "y-fork", {
            respondsToSnapshot: targetSnapshot,
        })
        expect(claimRemap.has("claim-P")).toBe(false)
        expect(fork.checkResponseCoherent(targetSnapshot)).toMatchObject({
            coherent: false,
        })
    })

    it("refuses to fork a response when the argument it answers cannot be found", () => {
        const { core } = setUp(false)
        expect(() => core.forkArgument("y", "y-fork")).toThrow(
            /argument it answers/
        )
    })
})
