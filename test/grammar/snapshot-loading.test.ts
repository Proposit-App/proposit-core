// C7: Snapshot loading accepts any Structural state.
//
// Per spec §7.2:
//   - fromSnapshot / fromData load any snapshot whose Structural-tier
//     invariants hold. Evaluable / Derivable / Presentable violations
//     do NOT cause a load failure — they surface post-load via
//     engine.validate(tier).
//   - Structural violations (truly broken snapshots: dangling parentIds,
//     duplicate IDs, S-rule violations) throw an InvariantViolationError
//     at load time.
//   - No post-load normalization step. The snapshot loads as-is; if
//     the caller wants AN cleanup, they call engine.normalize() after.

import { describe, it, expect } from "vitest"
import { ArgumentEngine } from "../../src/lib/core/argument-engine.js"
import { ClaimLibrary } from "../../src/lib/core/claim-library.js"
import type { TExpressionInput } from "../../src/lib/core/expression-manager.js"

const ARG_ID = "arg-snap"
const ARG_VERSION = 1

function makeArg(): {
    id: string
    version: number
    checksum: string
    descendantChecksum: string | null
    combinedChecksum: string
} {
    return {
        id: ARG_ID,
        version: ARG_VERSION,
        checksum: "arg-cksum",
        descendantChecksum: null,
        combinedChecksum: "arg-cksum-combined",
    }
}

function opExpr(
    id: string,
    operator: "not" | "and" | "or" | "implies" | "iff",
    parentId: string | null,
    premiseId: string,
    position: number = 0
): TExpressionInput {
    return {
        id,
        argumentId: ARG_ID,
        argumentVersion: ARG_VERSION,
        premiseId,
        type: "operator",
        operator,
        parentId,
        position,
    }
}

function varExpr(
    id: string,
    variableId: string,
    parentId: string | null,
    premiseId: string,
    position: number = 0
): TExpressionInput {
    return {
        id,
        argumentId: ARG_ID,
        argumentVersion: ARG_VERSION,
        premiseId,
        type: "variable",
        variableId,
        parentId,
        position,
    }
}

describe("ArgumentEngine.fromData / fromSnapshot — accepts any Structural state (C7)", () => {
    it("loads a snapshot with an E-1 violation (AND with 1 child) without throwing", () => {
        // Build via fromData so we don't need to round-trip a snapshot.
        const claimLib = new ClaimLibrary()
        claimLib.create({ id: "claim-p", type: "normal" })
        const argument = makeArg()
        const variables = [
            {
                id: "v-p",
                argumentId: ARG_ID,
                argumentVersion: ARG_VERSION,
                symbol: "P",
                claimId: "claim-p",
                claimVersion: 0,
            },
        ]
        const premises = [
            {
                id: "p-1",
                argumentId: ARG_ID,
                argumentVersion: ARG_VERSION,
                type: "freeform" as const,
            },
        ]
        // Tree: AND with only one child — an Evaluable violation (E-1).
        const expressions = [
            opExpr("and-root", "and", null, "p-1"),
            varExpr("v-p-expr", "v-p", "and-root", "p-1", 0),
        ]

        // Use permissive grammarConfig at load so the legacy load-time
        // normalize doesn't paper over the violation.
        const eng = ArgumentEngine.fromData(
            argument,
            claimLib,
            variables,
            premises,
            expressions,
            {},
            { behavior: "permissive" }
        )

        // Post-load: E-1 surfaces via the new tier-aware validate(). The
        // load itself did not throw.
        const violations = eng
            .validate("evaluable")
            .filter((v) => v.code === "E-1")
        expect(violations.length).toBeGreaterThan(0)
    })

    it("loads a snapshot with a P-1 violation (AND directly under OR) without throwing", () => {
        const claimLib = new ClaimLibrary()
        claimLib.create({ id: "claim-p", type: "normal" })
        claimLib.create({ id: "claim-q", type: "normal" })
        const argument = makeArg()
        const variables = [
            {
                id: "v-p",
                argumentId: ARG_ID,
                argumentVersion: ARG_VERSION,
                symbol: "P",
                claimId: "claim-p",
                claimVersion: 0,
            },
            {
                id: "v-q",
                argumentId: ARG_ID,
                argumentVersion: ARG_VERSION,
                symbol: "Q",
                claimId: "claim-q",
                claimVersion: 0,
            },
        ]
        const premises = [
            {
                id: "p-1",
                argumentId: ARG_ID,
                argumentVersion: ARG_VERSION,
                type: "freeform" as const,
            },
        ]
        // OR → AND → P,Q. AND is direct child of OR (P-1 violation).
        const expressions = [
            opExpr("or-root", "or", null, "p-1"),
            opExpr("and-1", "and", "or-root", "p-1", 0),
            varExpr("v-p-expr", "v-p", "and-1", "p-1", 0),
            varExpr("v-q-expr", "v-q", "and-1", "p-1", 1),
        ]

        const eng = ArgumentEngine.fromData(
            argument,
            claimLib,
            variables,
            premises,
            expressions,
            {},
            { behavior: "permissive" }
        )

        const violations = eng
            .validate("presentable")
            .filter((v) => v.code === "P-1")
        expect(violations.length).toBeGreaterThan(0)
    })

    it("does NOT auto-normalize at load time (lower-tier violations persist)", () => {
        // Same setup as the P-1 test, but assert that even in assistive
        // mode the AND stays directly under OR — no buffer auto-inserted
        // at load. AN runs on user-initiated normalize() / mutations,
        // not on load.
        const claimLib = new ClaimLibrary()
        claimLib.create({ id: "claim-p", type: "normal" })
        claimLib.create({ id: "claim-q", type: "normal" })
        const argument = makeArg()
        const variables = [
            {
                id: "v-p",
                argumentId: ARG_ID,
                argumentVersion: ARG_VERSION,
                symbol: "P",
                claimId: "claim-p",
                claimVersion: 0,
            },
            {
                id: "v-q",
                argumentId: ARG_ID,
                argumentVersion: ARG_VERSION,
                symbol: "Q",
                claimId: "claim-q",
                claimVersion: 0,
            },
        ]
        const premises = [
            {
                id: "p-1",
                argumentId: ARG_ID,
                argumentVersion: ARG_VERSION,
                type: "freeform" as const,
            },
        ]
        const expressions = [
            opExpr("or-root", "or", null, "p-1"),
            opExpr("and-1", "and", "or-root", "p-1", 0),
            varExpr("v-p-expr", "v-p", "and-1", "p-1", 0),
            varExpr("v-q-expr", "v-q", "and-1", "p-1", 1),
        ]

        // Default config (assistive grammar enabled). Pre-C7 this would
        // have auto-normalized at load and inserted a buffer; post-C7
        // it should not.
        const eng = ArgumentEngine.fromData(
            argument,
            claimLib,
            variables,
            premises,
            expressions,
            {}
        )
        const pe = eng.listPremises()[0]
        const and = pe.getExpressions().find((e) => e.id === "and-1")!
        expect(and.parentId).toBe("or-root")
    })

    it("loads a Presentable-clean snapshot with no violations", () => {
        const claimLib = new ClaimLibrary()
        claimLib.create({ id: "claim-p", type: "normal" })
        claimLib.create({ id: "claim-q", type: "normal" })
        const argument = makeArg()
        const variables = [
            {
                id: "v-p",
                argumentId: ARG_ID,
                argumentVersion: ARG_VERSION,
                symbol: "P",
                claimId: "claim-p",
                claimVersion: 0,
            },
            {
                id: "v-q",
                argumentId: ARG_ID,
                argumentVersion: ARG_VERSION,
                symbol: "Q",
                claimId: "claim-q",
                claimVersion: 0,
            },
        ]
        const premises = [
            {
                id: "p-1",
                argumentId: ARG_ID,
                argumentVersion: ARG_VERSION,
                type: "freeform" as const,
            },
        ]
        // Just AND(P, Q) — Presentable-valid.
        const expressions = [
            opExpr("and-root", "and", null, "p-1"),
            varExpr("v-p-expr", "v-p", "and-root", "p-1", 0),
            varExpr("v-q-expr", "v-q", "and-root", "p-1", 1),
        ]

        expect(() =>
            ArgumentEngine.fromData(
                argument,
                claimLib,
                variables,
                premises,
                expressions,
                { conclusionPremiseId: "p-1" }
            )
        ).not.toThrow()
    })
})
