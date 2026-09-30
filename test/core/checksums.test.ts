import { describe, expect, it } from "vitest"
import { ArgumentEngine } from "../../src/lib/index"
import {
    DEFAULT_CHECKSUM_CONFIG,
    createChecksumConfig,
} from "../../src/lib/checksum-config"
import {
    computeHash,
    canonicalSerialize,
    entityChecksum,
} from "../../src/lib/core/checksum"
import { aLib } from "./fixtures"

// ---------------------------------------------------------------------------
// checksum utilities
// ---------------------------------------------------------------------------

describe("checksum utilities", () => {
    describe("computeHash", () => {
        it("produces consistent hash for same input", () => {
            expect(computeHash("hello")).toBe(computeHash("hello"))
        })

        it("produces different hash for different input", () => {
            expect(computeHash("a")).not.toBe(computeHash("b"))
        })

        it("returns 8-character hex string", () => {
            const hash = computeHash("test")
            expect(hash).toMatch(/^[0-9a-f]{8}$/)
        })
    })

    describe("canonicalSerialize", () => {
        it("sorts object keys", () => {
            const a = canonicalSerialize({ b: 2, a: 1 })
            const b = canonicalSerialize({ a: 1, b: 2 })
            expect(a).toBe(b)
        })

        it("handles nested objects", () => {
            const a = canonicalSerialize({ z: { b: 2, a: 1 }, a: 0 })
            const b = canonicalSerialize({ a: 0, z: { a: 1, b: 2 } })
            expect(a).toBe(b)
        })

        it("handles arrays (preserves order)", () => {
            const a = canonicalSerialize([3, 1, 2])
            expect(a).toBe("[3,1,2]")
        })

        it("handles null and primitives", () => {
            expect(canonicalSerialize(null)).toBe("null")
            expect(canonicalSerialize(42)).toBe("42")
            expect(canonicalSerialize("hello")).toBe('"hello"')
        })
    })

    describe("entityChecksum", () => {
        it("uses only specified fields", () => {
            const cs1 = entityChecksum(
                { id: "1", symbol: "P", extra: "ignored" },
                ["id", "symbol"]
            )
            const cs2 = entityChecksum(
                { id: "1", symbol: "P", extra: "different" },
                ["id", "symbol"]
            )
            expect(cs1).toBe(cs2)
        })

        it("differs when included fields differ", () => {
            const cs1 = entityChecksum({ id: "1", symbol: "P" }, [
                "id",
                "symbol",
            ])
            const cs2 = entityChecksum({ id: "1", symbol: "Q" }, [
                "id",
                "symbol",
            ])
            expect(cs1).not.toBe(cs2)
        })

        it("field order does not affect checksum", () => {
            const cs1 = entityChecksum({ id: "1", symbol: "P" }, [
                "symbol",
                "id",
            ])
            const cs2 = entityChecksum({ id: "1", symbol: "P" }, [
                "id",
                "symbol",
            ])
            expect(cs1).toBe(cs2)
        })

        it("skips fields not present on entity", () => {
            const cs1 = entityChecksum({ id: "1" }, ["id", "missing"])
            const cs2 = entityChecksum({ id: "1" }, ["id"])
            expect(cs1).toBe(cs2)
        })
    })

    describe("PremiseEngine — checksum", () => {
        it("returns consistent checksum for same state", () => {
            const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
                behavior: "permissive",
            })
            const { result: pm } = eng.createPremise()
            const cs1 = pm.checksum()
            const cs2 = pm.checksum()
            expect(cs1).toBe(cs2)
        })

        it("combinedChecksum changes when an expression is added", () => {
            const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
                behavior: "permissive",
            })
            const v = {
                id: "v1",
                symbol: "P",
                argumentId: "arg1",
                argumentVersion: 0,
                claimId: "claim-default",
                claimVersion: 0,
            }
            eng.addVariable(v)
            const { result: pm } = eng.createPremise()
            const before = pm.combinedChecksum()
            pm.addExpression({
                id: "e1",
                type: "variable",
                variableId: "v1",
                argumentId: "arg1",
                argumentVersion: 0,
                premiseId: "premise-1",
                parentId: null,
                position: 1,
            })
            const after = pm.combinedChecksum()
            expect(before).not.toBe(after)
        })

        it("premise checksum does not change when a variable is added (variables are argument-scoped)", () => {
            const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
                behavior: "permissive",
            })
            const { result: pm } = eng.createPremise()
            const before = pm.checksum()
            eng.addVariable({
                id: "v1",
                symbol: "P",
                argumentId: "arg1",
                argumentVersion: 0,
                claimId: "claim-default",
                claimVersion: 0,
            })
            const after = pm.checksum()
            expect(before).toBe(after)
        })

        it("identical premises built the same way produce same checksum", () => {
            const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
                behavior: "permissive",
            })
            const v1 = {
                id: "v1",
                symbol: "P",
                argumentId: "arg1",
                argumentVersion: 0,
                claimId: "claim-default",
                claimVersion: 0,
            }
            eng.addVariable(v1)
            const { result: pm1 } = eng.createPremiseWithId("p1")
            const { result: pm2 } = eng.createPremiseWithId("p2")
            // Different premise IDs do NOT change the checksum (id is excluded from default checksum config)
            expect(pm1.checksum()).toBe(pm2.checksum())
        })
    })

    describe("ArgumentEngine — checksum", () => {
        it("returns consistent checksum for same state", () => {
            const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
                behavior: "permissive",
            })
            expect(eng.checksum()).toBe(eng.checksum())
        })

        it("checksum changes when a premise is added", () => {
            const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
                behavior: "permissive",
            })
            const before = eng.checksum()
            eng.createPremise()
            const after = eng.checksum()
            expect(before).not.toBe(after)
        })

        it("checksum changes when conclusion is set", () => {
            const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
                behavior: "permissive",
            })
            // First premise is auto-set as conclusion
            eng.createPremise()
            const { result: pm2 } = eng.createPremise()
            const before = eng.checksum()
            // Switch conclusion to second premise — checksum should change
            eng.setConclusionPremise(pm2.getId())
            const after = eng.checksum()
            expect(before).not.toBe(after)
        })

        it("accepts custom checksum config", () => {
            const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
                checksumConfig: { argumentFields: new Set(["id"]) },
            })
            const cs = eng.checksum()
            expect(cs).toMatch(/^[0-9a-f]{8}$/)
        })
    })
})

// ---------------------------------------------------------------------------
// Entity checksum fields
// ---------------------------------------------------------------------------

describe("entity checksum fields", () => {
    function setupPremise() {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        const v = {
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        }
        eng.addVariable(v)
        const { result: pm } = eng.createPremise()
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: null,
            position: 1,
        })
        return { eng, pm }
    }

    it("getExpressions returns expressions with checksums", () => {
        const { pm } = setupPremise()
        const exprs = pm.getExpressions()
        expect(exprs).toHaveLength(1)
        expect(exprs[0].checksum).toBeDefined()
        expect(typeof exprs[0].checksum).toBe("string")
        expect(exprs[0].checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("getExpression returns expression with checksum", () => {
        const { pm } = setupPremise()
        const expr = pm.getExpression("e1")
        expect(expr).toBeDefined()
        expect(expr!.checksum).toBeDefined()
        expect(expr!.checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("getRootExpression returns expression with checksum", () => {
        const { pm } = setupPremise()
        const root = pm.getRootExpression()
        expect(root).toBeDefined()
        expect(root!.checksum).toBeDefined()
        expect(root!.checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("getChildExpressions returns expressions with checksums", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        })
        eng.addVariable({
            id: "v2",
            symbol: "Q",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        })
        const { result: pm } = eng.createPremise()
        pm.addExpression({
            id: "op",
            type: "operator",
            operator: "and",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: null,
            position: 1,
        })
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "op",
            position: 1,
        })
        pm.addExpression({
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "op",
            position: 2,
        })
        const children = pm.getChildExpressions("op")
        expect(children).toHaveLength(2)
        expect(children[0].checksum).toMatch(/^[0-9a-f]{8}$/)
        expect(children[1].checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("getVariables returns variables with checksums", () => {
        const { pm } = setupPremise()
        const vars = pm.getVariables()
        expect(vars).toHaveLength(2) // 1 claim-bound + 1 auto premise-bound
        for (const v of vars) {
            expect(v.checksum).toBeDefined()
            expect(typeof v.checksum).toBe("string")
            expect(v.checksum).toMatch(/^[0-9a-f]{8}$/)
        }
    })

    it("toData includes premise-level checksum", () => {
        const { pm } = setupPremise()
        const data = pm.toPremiseData()
        expect(data.checksum).toBeDefined()
        expect(typeof data.checksum).toBe("string")
        expect(data.checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("toData expressions include entity checksums", () => {
        const { pm } = setupPremise()
        const expressions = pm.getExpressions()
        expect(expressions).toHaveLength(1)
        expect(expressions[0].checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("changeset expressions from addExpression include checksums", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        })
        const { result: pm } = eng.createPremise()
        const { changes } = pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: null,
            position: 1,
        })
        expect(changes.expressions?.added).toHaveLength(1)
        expect(changes.expressions?.added[0].checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("changeset expressions from removeExpression include checksums", () => {
        const { pm } = setupPremise()
        const { changes } = pm.removeExpression("e1", true)
        expect(changes.expressions?.removed).toHaveLength(1)
        expect(changes.expressions?.removed[0].checksum).toMatch(
            /^[0-9a-f]{8}$/
        )
    })

    it("changeset variables from addVariable include checksums", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        const { changes } = eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        })
        expect(changes.variables?.added).toHaveLength(1)
        expect(changes.variables?.added[0].checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("changeset variables from removeVariable include checksums", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        })
        const { changes } = eng.removeVariable("v1")
        expect(changes.variables?.removed).toHaveLength(1)
        expect(changes.variables?.removed[0].checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("addExpression result includes checksum", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        })
        const { result: pm } = eng.createPremise()
        const { result } = pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: null,
            position: 1,
        })
        expect(result.checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("addVariable result includes checksum", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        const { result } = eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        })
        expect(result.checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("ArgumentEngine getArgument includes argument-level checksum", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        eng.createPremise()
        const arg = eng.getArgument()
        expect(arg.checksum).toBeDefined()
        expect(arg.checksum).toMatch(/^[0-9a-f]{8}$/)
    })

    it("ArgumentEngine premise checksums via listPremises", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        eng.createPremise()
        const premises = eng.listPremises()
        expect(premises).toHaveLength(1)
        expect(premises[0].checksum()).toMatch(/^[0-9a-f]{8}$/)
    })

    it("expression checksum is consistent across getters", () => {
        const { pm } = setupPremise()
        const fromGetExpressions = pm.getExpressions()[0].checksum
        const fromGetExpression = pm.getExpression("e1")!.checksum
        const fromGetRoot = pm.getRootExpression()!.checksum
        expect(fromGetExpressions).toBe(fromGetExpression)
        expect(fromGetExpressions).toBe(fromGetRoot)
    })

    it("changeset modified expressions include checksums after collapse", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        })
        eng.addVariable({
            id: "v2",
            symbol: "Q",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        })
        const { result: pm } = eng.createPremise()
        pm.addExpression({
            id: "op",
            type: "operator",
            operator: "and",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: null,
            position: 1,
        })
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "op",
            position: 1,
        })
        pm.addExpression({
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "op",
            position: 2,
        })
        // Remove e1 -> operator collapses, e2 gets modified (reparented)
        const { changes } = pm.removeExpression("e1", true)
        expect(changes.expressions!.modified).toHaveLength(1)
        expect(changes.expressions!.modified[0].checksum).toMatch(
            /^[0-9a-f]{8}$/
        )
    })
})

describe("createChecksumConfig", () => {
    it("returns defaults when given empty config", () => {
        const config = createChecksumConfig({})
        expect(config.expressionFields).toEqual(
            DEFAULT_CHECKSUM_CONFIG.expressionFields
        )
        expect(config.variableFields).toEqual(
            DEFAULT_CHECKSUM_CONFIG.variableFields
        )
        expect(config.premiseFields).toEqual(
            DEFAULT_CHECKSUM_CONFIG.premiseFields
        )
        expect(config.argumentFields).toEqual(
            DEFAULT_CHECKSUM_CONFIG.argumentFields
        )
        expect(config.roleFields).toEqual(DEFAULT_CHECKSUM_CONFIG.roleFields)
    })

    it("merges additional fields into defaults", () => {
        const config = createChecksumConfig({
            expressionFields: new Set(["customField"]),
        })
        // "id" is not in the default expressionFields, so it will not be present after merge
        expect(config.expressionFields!.has("id")).toBe(false)
        expect(config.expressionFields!.has("customField")).toBe(true)
    })

    it("does not duplicate fields already in defaults", () => {
        const config = createChecksumConfig({
            variableFields: new Set(["id", "extra"]),
        })
        const arr = [...config.variableFields!]
        expect(arr.filter((f) => f === "id")).toHaveLength(1)
        expect(config.variableFields!.has("extra")).toBe(true)
    })

    it("returns a new Set instance (not the same reference as defaults)", () => {
        const config = createChecksumConfig({})
        expect(config.expressionFields).not.toBe(
            DEFAULT_CHECKSUM_CONFIG.expressionFields
        )
    })
})

describe("ArgumentEngine — checksumConfig Set reconstruction after JSON round-trip", () => {
    const ARG = { id: "arg-1", version: 1 }

    /** Simulate JSON round-trip: Sets become arrays */
    function jsonRoundTrip<T>(value: T): T {
        return JSON.parse(
            JSON.stringify(value, (_key, val: unknown) =>
                val instanceof Set ? [...val] : val
            )
        ) as T
    }

    it("fromSnapshot reconstructs checksumConfig field Sets from arrays", () => {
        const customConfig = {
            checksumConfig: {
                premiseFields: new Set(["premiseId", "createdOn"]),
                argumentFields: new Set(["id", "version"]),
            },
        }
        const engine = new ArgumentEngine(ARG, aLib(), customConfig)
        const snap = engine.snapshot()
        const serialized = jsonRoundTrip(snap)

        // Verify serialization turned Sets into arrays
        expect(serialized.config!.checksumConfig!.premiseFields).toBeInstanceOf(
            Array
        )

        const restored = ArgumentEngine.fromSnapshot(serialized, aLib())

        // The restored engine's snapshot should serialize Sets as arrays
        const restoredSnap = restored.snapshot()
        expect(
            Array.isArray(restoredSnap.config!.checksumConfig!.premiseFields)
        ).toBe(true)
        expect(
            Array.isArray(restoredSnap.config!.checksumConfig!.argumentFields)
        ).toBe(true)
        expect(restoredSnap.config!.checksumConfig!.premiseFields).toEqual(
            expect.arrayContaining(["premiseId", "createdOn"])
        )
        expect(restoredSnap.config!.checksumConfig!.argumentFields).toEqual(
            expect.arrayContaining(["id", "version"])
        )
    })

    it("fromData reconstructs checksumConfig field Sets from arrays", () => {
        const customConfig = {
            checksumConfig: {
                expressionFields: new Set(["id", "type", "customField"]),
                variableFields: new Set(["id", "symbol"]),
            },
        }
        const serializedConfig = jsonRoundTrip(customConfig)

        // Verify serialization turned Sets into arrays
        expect(serializedConfig.checksumConfig.expressionFields).toBeInstanceOf(
            Array
        )

        const engine = ArgumentEngine.fromData(
            ARG,
            aLib(),
            [],
            [],
            [],
            {},
            serializedConfig
        )

        const snap = engine.snapshot()
        expect(
            Array.isArray(snap.config!.checksumConfig!.expressionFields)
        ).toBe(true)
        expect(Array.isArray(snap.config!.checksumConfig!.variableFields)).toBe(
            true
        )
        expect(snap.config!.checksumConfig!.expressionFields).toEqual(
            expect.arrayContaining(["id", "type", "customField"])
        )
    })

    it("rollback reconstructs checksumConfig field Sets from arrays", () => {
        const customConfig = {
            checksumConfig: {
                roleFields: new Set(["conclusionPremiseId", "customRole"]),
            },
        }
        const engine = new ArgumentEngine(ARG, aLib(), customConfig)
        const snap = engine.snapshot()
        const serialized = jsonRoundTrip(snap)

        // Create a fresh engine to rollback into
        const engine2 = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        engine2.rollback(serialized)

        const restoredSnap = engine2.snapshot()
        expect(
            Array.isArray(restoredSnap.config!.checksumConfig!.roleFields)
        ).toBe(true)
        expect(restoredSnap.config!.checksumConfig!.roleFields).toEqual(
            expect.arrayContaining(["conclusionPremiseId", "customRole"])
        )
    })

    it("handles native JSON round-trip where snapshot serializes Sets as arrays", () => {
        const customConfig = {
            checksumConfig: {
                premiseFields: new Set(["premiseId", "createdOn"]),
                argumentFields: new Set(["id", "version"]),
            },
        }
        const engine = new ArgumentEngine(ARG, aLib(), customConfig)
        const snap = engine.snapshot()

        // Native JSON round-trip: snapshot already has arrays, so they survive
        const serialized = JSON.parse(JSON.stringify(snap)) as typeof snap

        // Verify fields survived as arrays, not empty objects
        expect(
            Array.isArray(serialized.config!.checksumConfig!.premiseFields)
        ).toBe(true)
        expect(serialized.config!.checksumConfig!.premiseFields).toEqual(
            expect.arrayContaining(["premiseId", "createdOn"])
        )
        expect(
            Array.isArray(serialized.config!.checksumConfig!.argumentFields)
        ).toBe(true)
        expect(serialized.config!.checksumConfig!.argumentFields).toEqual(
            expect.arrayContaining(["id", "version"])
        )

        // fromSnapshot should reconstruct Sets from the arrays
        const restored = ArgumentEngine.fromSnapshot(serialized, aLib())
        const restoredSnap = restored.snapshot()
        // After restoration, internal state has Sets, but snapshot serializes them back to arrays
        expect(
            Array.isArray(restoredSnap.config!.checksumConfig!.premiseFields)
        ).toBe(true)
        expect(
            Array.isArray(restoredSnap.config!.checksumConfig!.argumentFields)
        ).toBe(true)
    })

    it("fromSnapshot normalizes nested premise/expression-level configs after native JSON round-trip", () => {
        const customConfig = {
            checksumConfig: {
                expressionFields: new Set(["id", "type", "parentId"]),
                premiseFields: new Set(["id", "argumentId"]),
            },
        }
        const engine = new ArgumentEngine(ARG, aLib(), customConfig)
        engine.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
        })
        const { result: pm } = engine.createPremiseWithId("p1")
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            parentId: null,
            position: 0,
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "p1",
        })

        const snap = engine.snapshot()
        // Native JSON round-trip: Sets → {}
        const serialized = JSON.parse(JSON.stringify(snap)) as typeof snap

        // This should not throw — nested configs must be normalized
        const restored = ArgumentEngine.fromSnapshot(serialized, aLib())
        expect(restored.listPremiseIds()).toEqual(["p1"])
        expect(restored.getPremise("p1")!.getExpressions()).toHaveLength(1)
    })

    it("snapshot() serializes checksumConfig Sets as arrays at all levels", () => {
        const customConfig = {
            checksumConfig: {
                expressionFields: new Set(["id", "type", "parentId"]),
                premiseFields: new Set(["id", "argumentId"]),
                variableFields: new Set(["id", "symbol"]),
            },
        }
        const engine = new ArgumentEngine(ARG, aLib(), customConfig)
        engine.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
        })
        const { result: pm } = engine.createPremiseWithId("p1")
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            parentId: null,
            position: 0,
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "p1",
        })

        const snap = engine.snapshot()

        // Top-level config: Sets should be arrays
        const topConfig = snap.config!.checksumConfig!
        expect(Array.isArray(topConfig.premiseFields)).toBe(true)
        expect(topConfig.premiseFields).toEqual(
            expect.arrayContaining(["id", "argumentId"])
        )
        expect(Array.isArray(topConfig.variableFields)).toBe(true)
        expect(topConfig.variableFields).toEqual(
            expect.arrayContaining(["id", "symbol"])
        )

        // Variable manager config
        const varConfig = snap.variables.config!.checksumConfig!
        expect(Array.isArray(varConfig.variableFields)).toBe(true)

        // Premise-level config
        const premiseSnap = snap.premises[0]
        const premConfig = premiseSnap.config!.checksumConfig!
        expect(Array.isArray(premConfig.premiseFields)).toBe(true)

        // Expression-level config
        const exprConfig = premiseSnap.expressions.config!.checksumConfig!
        expect(Array.isArray(exprConfig.expressionFields)).toBe(true)
        expect(exprConfig.expressionFields).toEqual(
            expect.arrayContaining(["id", "type", "parentId"])
        )

        // Native JSON round-trip should preserve field names (no {} collapse)
        const serialized = JSON.parse(JSON.stringify(snap)) as typeof snap
        expect(serialized.config!.checksumConfig!.premiseFields).toEqual(
            expect.arrayContaining(["id", "argumentId"])
        )
        expect(
            serialized.premises[0].config!.checksumConfig!.premiseFields
        ).toEqual(expect.arrayContaining(["id", "argumentId"]))
        expect(
            serialized.premises[0].expressions.config!.checksumConfig!
                .expressionFields
        ).toEqual(expect.arrayContaining(["id", "type", "parentId"]))
    })

    it("rollback normalizes nested premise/expression-level configs after native JSON round-trip", () => {
        const customConfig = {
            checksumConfig: {
                expressionFields: new Set(["id", "type", "parentId"]),
                premiseFields: new Set(["id", "argumentId"]),
            },
        }
        const engine = new ArgumentEngine(ARG, aLib(), customConfig)
        engine.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
        })
        const { result: pm } = engine.createPremiseWithId("p1")
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            parentId: null,
            position: 0,
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "p1",
        })

        const snap = engine.snapshot()
        // Native JSON round-trip: Sets → {}
        const serialized = JSON.parse(JSON.stringify(snap)) as typeof snap

        const engine2 = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        // This should not throw — nested configs must be normalized
        engine2.rollback(serialized)
        expect(engine2.listPremiseIds()).toEqual(["p1"])
        expect(engine2.getPremise("p1")!.getExpressions()).toHaveLength(1)
    })
})

describe("DEFAULT_CHECKSUM_CONFIG excludes entity id", () => {
    it("expression checksum does not change when id differs", () => {
        const eng1 = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        eng1.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        })
        const { result: pm1 } = eng1.createPremiseWithId("prem-shared")
        pm1.addExpression({
            id: "expr-AAA",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "prem-shared",
            parentId: null,
            position: 1,
        })

        const eng2 = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        eng2.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        })
        const { result: pm2 } = eng2.createPremiseWithId("prem-shared")
        pm2.addExpression({
            id: "expr-BBB",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "prem-shared",
            parentId: null,
            position: 1,
        })

        eng1.flushChecksums()
        eng2.flushChecksums()

        const e1 = pm1.getExpression("expr-AAA")!
        const e2 = pm2.getExpression("expr-BBB")!
        expect(e1.checksum).toBe(e2.checksum)
    })

    it("variable checksum does not change when id differs", () => {
        const eng1 = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        eng1.addVariable({
            id: "var-AAA",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        })

        const eng2 = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        eng2.addVariable({
            id: "var-BBB",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        })

        eng1.flushChecksums()
        eng2.flushChecksums()

        const v1 = eng1.getVariable("var-AAA")!
        const v2 = eng2.getVariable("var-BBB")!
        expect(v1.checksum).toBe(v2.checksum)
    })

    it("premise checksum does not change when id differs", () => {
        const eng1 = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        const { result: pm1 } = eng1.createPremiseWithId("prem-AAA")

        const eng2 = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        const { result: pm2 } = eng2.createPremiseWithId("prem-BBB")

        eng1.flushChecksums()
        eng2.flushChecksums()

        expect(pm1.checksum()).toBe(pm2.checksum())
    })

    it("argument checksum does not change when id differs", () => {
        const eng1 = new ArgumentEngine({ id: "arg-AAA", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        const eng2 = new ArgumentEngine({ id: "arg-BBB", version: 0 }, aLib(), {
            behavior: "permissive",
        })

        eng1.flushChecksums()
        eng2.flushChecksums()

        expect(eng1.checksum()).toBe(eng2.checksum())
    })

    it("DEFAULT_CHECKSUM_CONFIG field sets do not contain 'id'", () => {
        expect(DEFAULT_CHECKSUM_CONFIG.expressionFields!.has("id")).toBe(false)
        expect(DEFAULT_CHECKSUM_CONFIG.variableFields!.has("id")).toBe(false)
        expect(DEFAULT_CHECKSUM_CONFIG.premiseFields!.has("id")).toBe(false)
        expect(DEFAULT_CHECKSUM_CONFIG.argumentFields!.has("id")).toBe(false)
        expect(DEFAULT_CHECKSUM_CONFIG.claimFields!.has("id")).toBe(false)
        expect(DEFAULT_CHECKSUM_CONFIG.claimCitationFields!.has("id")).toBe(
            false
        )
    })
})
