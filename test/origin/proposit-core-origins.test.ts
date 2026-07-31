import { describe, it, expect } from "vitest"
import { PropositCore } from "../../src/lib/core/proposit-core.js"
import { OriginLibrary } from "../../src/lib/core/origin-library.js"
import { codePointLength } from "../../src/lib/utils/origin-text.js"
import type { TExpressionInput } from "../../src/lib/core/expression-manager.js"
import type { TCorePropositionalExpression } from "../../src/lib/schemata/index.js"

const SOURCE =
    "All swans observed so far are white. Therefore all swans are white."

function spanOf(quote: string) {
    const start = codePointLength(SOURCE.slice(0, SOURCE.indexOf(quote)))
    return {
        exact: quote,
        startCodePoint: start,
        endCodePoint: start + codePointLength(quote),
    }
}

describe("PropositCore origins slice", () => {
    it("exposes origins as a public field", () => {
        const core = new PropositCore()
        expect(core.origins).toBeInstanceOf(OriginLibrary)
    })

    it("includes an empty origins slot in a fresh snapshot", () => {
        const snapshot = new PropositCore().snapshot()
        expect(snapshot).toHaveProperty("origins")
        expect(snapshot.origins).toEqual({
            documents: [],
            links: [],
            anchors: [],
        })
    })

    it("keeps the other five slots alongside it", () => {
        const snapshot = new PropositCore().snapshot()
        expect(Object.keys(snapshot).sort()).toEqual([
            "arguments",
            "axioms",
            "citations",
            "claims",
            "forks",
            "origins",
        ])
    })

    it("merges origin violations into core.validate()", () => {
        const core = new PropositCore()
        expect(core.validate().ok).toBe(true)

        // Reach the failure through fromSnapshot: the library's own mutators
        // refuse to create an invalid entity in the first place.
        const restored = PropositCore.fromSnapshot({
            ...core.snapshot(),
            origins: {
                documents: [],
                links: [
                    {
                        id: "link-1",
                        argumentId: "arg-1",
                        argumentVersion: 0,
                        documentId: "missing",
                        stance: "seed",
                        checksum: "deadbeef",
                    },
                ],
                anchors: [],
            },
        })
        const result = restored.validate()
        expect(result.ok).toBe(false)
        expect(result.violations.map((v) => v.code)).toContain(
            "ORIGIN_DOCUMENT_REF_NOT_FOUND"
        )
    })

    it("propagates the checksum config into the origin library", () => {
        const core = new PropositCore({
            checksumConfig: { originDocumentFields: new Set(["ownerId"]) },
        })
        const withOwner = core.origins.addDocument({
            id: "doc-1",
            text: SOURCE,
            ownerId: "someone",
        } as Parameters<OriginLibrary["addDocument"]>[0])
        const plain = new PropositCore().origins.addDocument({
            id: "doc-1",
            text: SOURCE,
        })
        expect(withOwner.checksum).not.toBe(plain.checksum)
    })

    it("accepts a pre-constructed origin library", () => {
        const origins = new OriginLibrary()
        origins.addDocument({ id: "doc-1", text: SOURCE })
        const core = new PropositCore({ originLibrary: origins })
        expect(core.origins).toBe(origins)
        expect(core.snapshot().origins?.documents).toHaveLength(1)
    })
})

describe("PropositCore.fromSnapshot and a missing origins slot", () => {
    it("defaults to an empty origin library rather than throwing", () => {
        // Unlike a missing 'axioms' slot, absence here is unambiguous: nothing
        // ever held origin data, so there is nothing that could have been lost.
        // Refusing would also break every consumer that upgrades to this
        // release before persisting origin data of its own.
        const complete = new PropositCore().snapshot()
        const { origins: _origins, ...withoutOrigins } = complete

        const restored = PropositCore.fromSnapshot(
            withoutOrigins as typeof complete
        )
        expect(restored.origins).toBeInstanceOf(OriginLibrary)
        expect(restored.origins.getAllDocuments()).toEqual([])
        expect(restored.validate().ok).toBe(true)
    })

    it("still refuses a snapshot with a missing axioms slot", () => {
        const complete = new PropositCore().snapshot()
        const { axioms: _axioms, ...withoutAxioms } = complete
        expect(() =>
            PropositCore.fromSnapshot(withoutAxioms as typeof complete)
        ).toThrow(/LEGACY_MISSING_AXIOM_SLOT/)
    })
})

describe("PropositCore full-fidelity origin round-trip", () => {
    function buildCore() {
        const core = new PropositCore()
        core.claims.create({ id: "claim-1", type: "normal" })

        const engine = core.arguments.create({ id: "arg-1", version: 1 })
        engine.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-1",
            claimVersion: 0,
        })
        const { result: premise } = engine.createPremise({ id: "prem-1" })
        premise.addExpression({
            id: "expr-1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "prem-1",
            parentId: null,
            position: 1,
            enthymeme: true,
        } as TExpressionInput<TCorePropositionalExpression>)
        premise.setExtras({ ...premise.getExtras(), enthymeme: true })
        engine.flushChecksums()

        core.origins.addDocument({ id: "doc-1", text: SOURCE })
        core.origins.addLink({
            id: "link-seed",
            argumentId: "arg-1",
            argumentVersion: 1,
            documentId: "doc-1",
            stance: "seed",
        })
        core.origins.addLink({
            id: "link-representation",
            argumentId: "arg-1",
            argumentVersion: 2,
            documentId: "doc-1",
            stance: "representation",
        })
        core.origins.addAnchor({
            id: "anchor-expr",
            argumentId: "arg-1",
            argumentVersion: 1,
            documentId: "doc-1",
            targetType: "expression",
            targetId: "expr-1",
            ...spanOf("All swans observed so far are white."),
        })
        core.origins.addAnchor({
            id: "anchor-premise",
            argumentId: "arg-1",
            argumentVersion: 1,
            documentId: "doc-1",
            targetType: "premise",
            targetId: "prem-1",
            ...spanOf("all swans are white."),
        })
        return core
    }

    it("survives snapshot to fromSnapshot with every entity and checksum intact", () => {
        const core = buildCore()
        const snapshot = core.snapshot()
        const restored = PropositCore.fromSnapshot(snapshot)

        expect(restored.snapshot()).toEqual(snapshot)
        expect(restored.validate().ok).toBe(true)

        expect(restored.origins.getAllDocuments()).toHaveLength(1)
        expect(
            restored.origins
                .getLinksForArgument("arg-1", 1)
                .map((l) => l.stance)
        ).toEqual(["seed"])
        expect(
            restored.origins
                .getLinksForArgument("arg-1", 2)
                .map((l) => l.stance)
        ).toEqual(["representation"])
        expect(
            restored.origins.getAnchorsForTarget("expression", "expr-1")
        ).toHaveLength(1)
        expect(
            restored.origins.getAnchorsForTarget("premise", "prem-1")
        ).toHaveLength(1)
    })

    it("carries the enthymeme marks on both the expression and the premise", () => {
        const core = buildCore()
        const restored = PropositCore.fromSnapshot(core.snapshot())
        const argument = restored.snapshot().arguments.arguments[0]
        const premise = argument.premises[0]
        expect(premise.premise.enthymeme).toBe(true)
        const expression = premise.expressions.expressions.find(
            (e) => e.id === "expr-1"
        )
        expect(expression?.type).toBe("variable")
        expect(expression).toMatchObject({ enthymeme: true })
    })

    it("survives a JSON round-trip, the form a snapshot is stored in", () => {
        const core = buildCore()
        const snapshot = core.snapshot()
        const restored = PropositCore.fromSnapshot(
            JSON.parse(JSON.stringify(snapshot)) as typeof snapshot
        )
        // Only the origin slice is compared. An engine snapshot carries
        // non-serializable `config.generateId` function references that no
        // JSON round-trip preserves, which predates this work.
        expect(restored.snapshot().origins).toEqual(snapshot.origins)
        expect(restored.validate().ok).toBe(true)
        const premise = restored.snapshot().arguments.arguments[0].premises[0]
        expect(premise.premise.enthymeme).toBe(true)
    })
})
