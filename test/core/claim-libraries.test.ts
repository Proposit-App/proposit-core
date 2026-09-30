import { describe, expect, it } from "vitest"
import { ClaimLibrary } from "../../src/lib/index"
import { ClaimCitationLibrary } from "../../src/lib/core/claim-citation-library"
import { Value } from "typebox/value"
import { CoreClaimSchema } from "../../src/lib/schemata"
import { CITATION_NOT_FOUND } from "../../src/lib/types/validation"
import { InvariantViolationError } from "../../src/lib/index"

// ---------------------------------------------------------------------------
// ClaimCitationLibrary
// ---------------------------------------------------------------------------
describe("ClaimCitationLibrary", () => {
    function makeFixtures() {
        const claimLib = new ClaimLibrary()
        const claim1 = claimLib.create({ id: "claim-1", type: "normal" })
        const claim2 = claimLib.create({ id: "claim-2", type: "normal" })
        const source1 = claimLib.create({ id: "source-1", type: "citation" })
        const source2 = claimLib.create({ id: "source-2", type: "citation" })
        const lib = new ClaimCitationLibrary(claimLib)
        return { claimLib, claim1, claim2, source1, source2, lib }
    }

    describe("add", () => {
        it("adds a citation and returns it with a checksum", () => {
            const { lib, claim1, source1 } = makeFixtures()
            const cit = lib.add({
                id: "cit-1",
                claimId: claim1.id,
                claimVersion: claim1.version,
                supportingClaimId: source1.id,
                supportingClaimVersion: source1.version,
            })
            expect(cit.id).toBe("cit-1")
            expect(cit.claimId).toBe("claim-1")
            expect(cit.supportingClaimId).toBe("source-1")
            expect(cit.checksum).toBeTruthy()
            expect(typeof cit.checksum).toBe("string")
        })

        it("throws on duplicate citation ID", () => {
            const { lib, claim1, source1 } = makeFixtures()
            lib.add({
                id: "cit-1",
                claimId: claim1.id,
                claimVersion: claim1.version,
                supportingClaimId: source1.id,
                supportingClaimVersion: source1.version,
            })
            expect(() =>
                lib.add({
                    id: "cit-1",
                    claimId: claim1.id,
                    claimVersion: claim1.version,
                    supportingClaimId: source1.id,
                    supportingClaimVersion: source1.version,
                })
            ).toThrow()
        })

        it("throws when citing claim does not exist in the claim lookup", () => {
            const { lib, source1 } = makeFixtures()
            expect(() =>
                lib.add({
                    id: "cit-1",
                    claimId: "nonexistent-claim",
                    claimVersion: 0,
                    supportingClaimId: source1.id,
                    supportingClaimVersion: source1.version,
                })
            ).toThrow()
        })

        it("throws when citing claim version does not exist", () => {
            const { lib, claim1, source1 } = makeFixtures()
            expect(() =>
                lib.add({
                    id: "cit-1",
                    claimId: claim1.id,
                    claimVersion: 999,
                    supportingClaimId: source1.id,
                    supportingClaimVersion: source1.version,
                })
            ).toThrow()
        })

        it("throws when source claim does not exist in the claim lookup", () => {
            const { lib, claim1 } = makeFixtures()
            expect(() =>
                lib.add({
                    id: "cit-1",
                    claimId: claim1.id,
                    claimVersion: claim1.version,
                    supportingClaimId: "nonexistent-source",
                    supportingClaimVersion: 0,
                })
            ).toThrow()
        })

        it("throws when source claim version does not exist", () => {
            const { lib, claim1, source1 } = makeFixtures()
            expect(() =>
                lib.add({
                    id: "cit-1",
                    claimId: claim1.id,
                    claimVersion: claim1.version,
                    supportingClaimId: source1.id,
                    supportingClaimVersion: 999,
                })
            ).toThrow()
        })
    })

    describe("remove", () => {
        it("removes a citation and returns it", () => {
            const { lib, claim1, source1 } = makeFixtures()
            const added = lib.add({
                id: "cit-1",
                claimId: claim1.id,
                claimVersion: claim1.version,
                supportingClaimId: source1.id,
                supportingClaimVersion: source1.version,
            })
            const removed = lib.remove("cit-1")
            expect(removed).toEqual(added)
            expect(lib.get("cit-1")).toBeUndefined()
        })

        it("throws when citation is not found", () => {
            const { lib } = makeFixtures()
            expect(() => lib.remove("nonexistent")).toThrow()
        })

        it("cleans up citing-claim index on remove", () => {
            const { lib, claim1, source1 } = makeFixtures()
            lib.add({
                id: "cit-1",
                claimId: claim1.id,
                claimVersion: claim1.version,
                supportingClaimId: source1.id,
                supportingClaimVersion: source1.version,
            })
            lib.remove("cit-1")
            expect(lib.getConnectionsForClaim(claim1.id)).toEqual([])
        })

        it("throws InvariantViolationError with code CITATION_NOT_FOUND when removing a missing id", () => {
            const { lib } = makeFixtures()
            let caught: unknown
            try {
                lib.remove("does-not-exist")
            } catch (e) {
                caught = e
            }
            expect(caught).toBeInstanceOf(InvariantViolationError)
            const err = caught as InvariantViolationError
            expect(err.violations[0].code).toBe(CITATION_NOT_FOUND)
        })
    })

    describe("getConnectionsForClaim", () => {
        it("returns all citations for a given citing-claim ID", () => {
            const { lib, claim1, claim2, source1, source2 } = makeFixtures()
            lib.add({
                id: "cit-1",
                claimId: claim1.id,
                claimVersion: claim1.version,
                supportingClaimId: source1.id,
                supportingClaimVersion: source1.version,
            })
            lib.add({
                id: "cit-2",
                claimId: claim1.id,
                claimVersion: claim1.version,
                supportingClaimId: source2.id,
                supportingClaimVersion: source2.version,
            })
            lib.add({
                id: "cit-3",
                claimId: claim2.id,
                claimVersion: claim2.version,
                supportingClaimId: source1.id,
                supportingClaimVersion: source1.version,
            })
            const result = lib.getConnectionsForClaim(claim1.id)
            expect(result).toHaveLength(2)
            expect(result.map((a) => a.id)).toContain("cit-1")
            expect(result.map((a) => a.id)).toContain("cit-2")
        })

        it("returns empty array when no citations exist for the citing claim", () => {
            const { lib, claim1 } = makeFixtures()
            expect(lib.getConnectionsForClaim(claim1.id)).toEqual([])
        })
    })

    describe("get", () => {
        it("returns the citation by ID", () => {
            const { lib, claim1, source1 } = makeFixtures()
            lib.add({
                id: "cit-1",
                claimId: claim1.id,
                claimVersion: claim1.version,
                supportingClaimId: source1.id,
                supportingClaimVersion: source1.version,
            })
            const result = lib.get("cit-1")
            expect(result).toBeDefined()
            expect(result!.id).toBe("cit-1")
        })

        it("returns undefined for unknown ID", () => {
            const { lib } = makeFixtures()
            expect(lib.get("nonexistent")).toBeUndefined()
        })
    })

    describe("getAll", () => {
        it("returns all citations", () => {
            const { lib, claim1, claim2, source1, source2 } = makeFixtures()
            lib.add({
                id: "cit-1",
                claimId: claim1.id,
                claimVersion: claim1.version,
                supportingClaimId: source1.id,
                supportingClaimVersion: source1.version,
            })
            lib.add({
                id: "cit-2",
                claimId: claim2.id,
                claimVersion: claim2.version,
                supportingClaimId: source2.id,
                supportingClaimVersion: source2.version,
            })
            expect(lib.getAll()).toHaveLength(2)
        })

        it("returns empty array when no citations exist", () => {
            const { lib } = makeFixtures()
            expect(lib.getAll()).toEqual([])
        })
    })

    describe("filter", () => {
        it("filters citations by predicate", () => {
            const { lib, claim1, claim2, source1, source2 } = makeFixtures()
            lib.add({
                id: "cit-1",
                claimId: claim1.id,
                claimVersion: claim1.version,
                supportingClaimId: source1.id,
                supportingClaimVersion: source1.version,
            })
            lib.add({
                id: "cit-2",
                claimId: claim2.id,
                claimVersion: claim2.version,
                supportingClaimId: source2.id,
                supportingClaimVersion: source2.version,
            })
            const result = lib.filter((a) => a.claimId === claim1.id)
            expect(result).toHaveLength(1)
            expect(result[0].id).toBe("cit-1")
        })

        it("returns empty array when predicate matches nothing", () => {
            const { lib, claim1, source1 } = makeFixtures()
            lib.add({
                id: "cit-1",
                claimId: claim1.id,
                claimVersion: claim1.version,
                supportingClaimId: source1.id,
                supportingClaimVersion: source1.version,
            })
            expect(lib.filter(() => false)).toEqual([])
        })
    })

    describe("snapshot / fromSnapshot", () => {
        it("round-trips through snapshot and fromSnapshot", () => {
            const { lib, claimLib, claim1, claim2, source1, source2 } =
                makeFixtures()
            lib.add({
                id: "cit-1",
                claimId: claim1.id,
                claimVersion: claim1.version,
                supportingClaimId: source1.id,
                supportingClaimVersion: source1.version,
            })
            lib.add({
                id: "cit-2",
                claimId: claim2.id,
                claimVersion: claim2.version,
                supportingClaimId: source2.id,
                supportingClaimVersion: source2.version,
            })
            const snap = lib.snapshot()
            expect(snap.connections).toHaveLength(2)

            const restored = ClaimCitationLibrary.fromSnapshot(snap, claimLib)
            expect(restored.getAll()).toHaveLength(2)
            expect(restored.get("cit-1")).toEqual(lib.get("cit-1"))
            expect(restored.get("cit-2")).toEqual(lib.get("cit-2"))
        })

        it("restores citing- and supporting-claim indexes correctly", () => {
            const { lib, claimLib, claim1, source1 } = makeFixtures()
            lib.add({
                id: "cit-1",
                claimId: claim1.id,
                claimVersion: claim1.version,
                supportingClaimId: source1.id,
                supportingClaimVersion: source1.version,
            })
            const snap = lib.snapshot()
            const restored = ClaimCitationLibrary.fromSnapshot(snap, claimLib)
            expect(restored.getConnectionsForClaim(claim1.id)).toHaveLength(1)
            expect(
                restored
                    .getAll()
                    .filter((c) => c.supportingClaimId === source1.id)
            ).toHaveLength(1)
        })

        it("snapshot of empty library returns empty array", () => {
            const { lib } = makeFixtures()
            expect(lib.snapshot()).toEqual({ connections: [] })
        })
    })

    describe("generic TCitation extension", () => {
        it("preserves extended fields through add, get, and snapshot", () => {
            const claimLib = new ClaimLibrary()
            const claim = claimLib.create({
                id: "claim-ext",
                type: "normal",
            })
            const source = claimLib.create({
                id: "source-ext",
                type: "citation",
            })

            type TExtCitation = {
                id: string
                claimId: string
                claimVersion: number
                supportingClaimId: string
                supportingClaimVersion: number
                checksum: string
                createdBy: string
            }

            const lib = new ClaimCitationLibrary<TExtCitation>(claimLib)
            const cit = lib.add({
                id: "cit-ext",
                claimId: claim.id,
                claimVersion: claim.version,
                supportingClaimId: source.id,
                supportingClaimVersion: source.version,
                createdBy: "user-1",
            })
            expect(cit.createdBy).toBe("user-1")

            const fetched = lib.get("cit-ext")
            expect(fetched?.createdBy).toBe("user-1")

            const snap = lib.snapshot()
            expect(snap.connections[0].createdBy).toBe("user-1")

            const restored = ClaimCitationLibrary.fromSnapshot<TExtCitation>(
                snap,
                claimLib
            )
            expect(restored.get("cit-ext")?.createdBy).toBe("user-1")
        })

        it("filter works on extended fields", () => {
            const claimLib = new ClaimLibrary()
            const claim = claimLib.create({
                id: "claim-ext2",
                type: "normal",
            })
            const source1 = claimLib.create({
                id: "source-ext2a",
                type: "citation",
            })
            const source2 = claimLib.create({
                id: "source-ext2b",
                type: "citation",
            })

            type TExtCitation = {
                id: string
                claimId: string
                claimVersion: number
                supportingClaimId: string
                supportingClaimVersion: number
                checksum: string
                tag: string
            }

            const lib = new ClaimCitationLibrary<TExtCitation>(claimLib)
            lib.add({
                id: "cit-ext-a",
                claimId: claim.id,
                claimVersion: claim.version,
                supportingClaimId: source1.id,
                supportingClaimVersion: source1.version,
                tag: "alpha",
            })
            lib.add({
                id: "cit-ext-b",
                claimId: claim.id,
                claimVersion: claim.version,
                supportingClaimId: source2.id,
                supportingClaimVersion: source2.version,
                tag: "beta",
            })
            const result = lib.filter((a) => a.tag === "alpha")
            expect(result).toHaveLength(1)
            expect(result[0].id).toBe("cit-ext-a")
        })
    })
})

describe("Library persistence", () => {
    it("ClaimLibrary round-trips through snapshot", () => {
        const lib = new ClaimLibrary()
        lib.create({ id: "c1", type: "normal" })
        const snapshot = lib.snapshot()
        const restored = ClaimLibrary.fromSnapshot(snapshot)
        expect(restored.get("c1", 0)).toBeDefined()
        expect(restored.get("c1", 0)!.id).toBe("c1")
    })

    it("ClaimCitationLibrary round-trips through snapshot", () => {
        const claimLib = new ClaimLibrary()
        claimLib.create({ id: "c1", type: "normal" })
        claimLib.create({ id: "s1", type: "citation" })
        const ccLib = new ClaimCitationLibrary(claimLib)
        ccLib.add({
            id: "a1",
            claimId: "c1",
            claimVersion: 0,
            supportingClaimId: "s1",
            supportingClaimVersion: 0,
        })
        const snapshot = ccLib.snapshot()
        const restored = ClaimCitationLibrary.fromSnapshot(snapshot, claimLib)
        expect(restored.get("a1")).toBeDefined()
        expect(restored.getAll()).toHaveLength(1)
    })

    it("placeholder claims are injected for missing claim references", () => {
        const lib = new ClaimLibrary()
        const snapshot = lib.snapshot()
        snapshot.claims.push({
            id: "c-missing",
            version: 0,
            frozen: true,
            checksum: "",
            type: "normal",
        } as (typeof snapshot.claims)[number])
        const rebuilt = ClaimLibrary.fromSnapshot(snapshot)
        expect(rebuilt.get("c-missing", 0)).toBeDefined()
        expect(rebuilt.get("c-missing", 0)!.frozen).toBe(true)
    })
})

describe("CoreClaimSchema type field", () => {
    it("rejects a claim without a type field", () => {
        const claim = {
            id: "00000000-0000-0000-0000-000000000001",
            version: 0,
            frozen: false,
            checksum: "abc",
        }
        expect(Value.Check(CoreClaimSchema, claim)).toBe(false)
    })
    it("accepts a claim with type: 'normal'", () => {
        const claim = {
            id: "00000000-0000-0000-0000-000000000001",
            version: 0,
            frozen: false,
            checksum: "abc",
            type: "normal" as const,
        }
        expect(Value.Check(CoreClaimSchema, claim)).toBe(true)
    })
    it("accepts a claim with type: 'citation'", () => {
        const claim = {
            id: "00000000-0000-0000-0000-000000000001",
            version: 0,
            frozen: false,
            checksum: "abc",
            type: "citation" as const,
        }
        expect(Value.Check(CoreClaimSchema, claim)).toBe(true)
    })
    it("rejects a claim with an unknown type", () => {
        const claim = {
            id: "00000000-0000-0000-0000-000000000001",
            version: 0,
            frozen: false,
            checksum: "abc",
            type: "axiom",
        }
        expect(Value.Check(CoreClaimSchema, claim)).toBe(false)
    })
})

describe("ClaimCitationLibrary strict source-side type", () => {
    it("rejects a citation where supportingClaimId references a normal claim", () => {
        const claimLib = new ClaimLibrary()
        const normalClaim = claimLib.create({ type: "normal" })
        const anotherNormalClaim = claimLib.create({ type: "normal" })
        const citationLib = new ClaimCitationLibrary({
            get: (id, version) => claimLib.get(id, version),
            getCurrent: (id) => claimLib.getCurrent(id),
        })
        expect(() =>
            citationLib.add({
                id: "00000000-0000-0000-0000-000000000010",
                claimId: normalClaim.id,
                claimVersion: normalClaim.version,
                supportingClaimId: anotherNormalClaim.id,
                supportingClaimVersion: anotherNormalClaim.version,
            })
        ).toThrow(/only 'citation' is permitted/)
    })
    it("accepts a citation where supportingClaimId references a citation claim", () => {
        const claimLib = new ClaimLibrary()
        const normalClaim = claimLib.create({ type: "normal" })
        const citationClaim = claimLib.create({ type: "citation" })
        const citationLib = new ClaimCitationLibrary({
            get: (id, version) => claimLib.get(id, version),
            getCurrent: (id) => claimLib.getCurrent(id),
        })
        expect(() =>
            citationLib.add({
                id: "00000000-0000-0000-0000-000000000011",
                claimId: normalClaim.id,
                claimVersion: normalClaim.version,
                supportingClaimId: citationClaim.id,
                supportingClaimVersion: citationClaim.version,
            })
        ).not.toThrow()
    })
})

describe("ClaimCitationLibrary acyclicity", () => {
    function makeLibs() {
        const claimLib = new ClaimLibrary()
        const claimLookup = {
            get: (id: string, version: number) => claimLib.get(id, version),
            getCurrent: (id: string) => claimLib.getCurrent(id),
        }
        const citationLib = new ClaimCitationLibrary(claimLookup)
        return { claimLib, citationLib }
    }
    it("rejects a direct A↔B cycle", () => {
        const { claimLib, citationLib } = makeLibs()
        const a = claimLib.create({ type: "citation" })
        const b = claimLib.create({ type: "citation" })
        citationLib.add({
            id: "00000000-0000-0000-0000-000000000001",
            claimId: a.id,
            claimVersion: a.version,
            supportingClaimId: b.id,
            supportingClaimVersion: b.version,
        })
        expect(() =>
            citationLib.add({
                id: "00000000-0000-0000-0000-000000000002",
                claimId: b.id,
                claimVersion: b.version,
                supportingClaimId: a.id,
                supportingClaimVersion: a.version,
            })
        ).toThrow(/cycle/i)
    })
    it("rejects a transitive A→B→C→A cycle", () => {
        const { claimLib, citationLib } = makeLibs()
        const a = claimLib.create({ type: "citation" })
        const b = claimLib.create({ type: "citation" })
        const c = claimLib.create({ type: "citation" })
        citationLib.add({
            id: "00000000-0000-0000-0000-000000000010",
            claimId: a.id,
            claimVersion: a.version,
            supportingClaimId: b.id,
            supportingClaimVersion: b.version,
        })
        citationLib.add({
            id: "00000000-0000-0000-0000-000000000011",
            claimId: b.id,
            claimVersion: b.version,
            supportingClaimId: c.id,
            supportingClaimVersion: c.version,
        })
        expect(() =>
            citationLib.add({
                id: "00000000-0000-0000-0000-000000000012",
                claimId: c.id,
                claimVersion: c.version,
                supportingClaimId: a.id,
                supportingClaimVersion: a.version,
            })
        ).toThrow(/cycle/i)
    })
    it("treats version-different edges as projecting to the same ID-only graph", () => {
        const { claimLib, citationLib } = makeLibs()
        const a = claimLib.create({ type: "citation" })
        const b = claimLib.create({ type: "citation" })
        // First edge: A@v0 → B@v0
        citationLib.add({
            id: "00000000-0000-0000-0000-000000000020",
            claimId: a.id,
            claimVersion: 0,
            supportingClaimId: b.id,
            supportingClaimVersion: 0,
        })
        // Freeze A to bump it to a new version (v1)
        claimLib.freeze(a.id)
        // Try B@v0 → A@v1 — same ID-only cycle as the first edge's reverse
        expect(() =>
            citationLib.add({
                id: "00000000-0000-0000-0000-000000000021",
                claimId: b.id,
                claimVersion: 0,
                supportingClaimId: a.id,
                supportingClaimVersion: 1,
            })
        ).toThrow(/cycle/i)
    })
})

describe("ClaimLibrary type immutability", () => {
    it("rejects an update that changes the type field", () => {
        const claimLib = new ClaimLibrary()
        const c = claimLib.create({ type: "normal" })
        expect(() =>
            claimLib.update(c.id, { type: "citation" } as never)
        ).toThrow(/type is immutable/)
    })
    it("allows an update that does not change the type field", () => {
        const claimLib = new ClaimLibrary()
        const c = claimLib.create({ type: "normal" })
        // Update some other field via additionalProperties
        expect(() =>
            claimLib.update(c.id, { customField: "new value" } as never)
        ).not.toThrow()
    })
    it("allows an update that re-asserts the same type", () => {
        const claimLib = new ClaimLibrary()
        const c = claimLib.create({ type: "normal" })
        expect(() =>
            claimLib.update(c.id, { type: "normal" } as never)
        ).not.toThrow()
    })
})

describe("ClaimLibrary legacy snapshot detection", () => {
    it("emits LEGACY_CLAIM_MISSING_TYPE when restoring a snapshot with a typeless claim", () => {
        const legacySnapshot = {
            claims: [
                {
                    id: "00000000-0000-0000-0000-000000000001",
                    version: 0,
                    frozen: false,
                    checksum: "abc",
                    // type field intentionally missing
                },
            ],
        }
        expect(() =>
            ClaimLibrary.fromSnapshot(
                legacySnapshot as Parameters<
                    typeof ClaimLibrary.fromSnapshot
                >[0]
            )
        ).toThrow(/missing the 'type' field|pre-v0\.10\.0/)
    })
    it("accepts a snapshot where every claim has a type field", () => {
        const validSnapshot = {
            claims: [
                {
                    id: "00000000-0000-0000-0000-000000000001",
                    version: 0,
                    frozen: false,
                    checksum: "abc",
                    type: "normal" as const,
                },
            ],
        }
        expect(() =>
            ClaimLibrary.fromSnapshot(
                validSnapshot as Parameters<typeof ClaimLibrary.fromSnapshot>[0]
            )
        ).not.toThrow()
    })
})
