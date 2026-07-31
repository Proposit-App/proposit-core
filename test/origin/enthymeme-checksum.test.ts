import { describe, it, expect } from "vitest"
import { entityChecksum } from "../../src/lib/core/checksum.js"
import {
    DEFAULT_CHECKSUM_CONFIG,
    createChecksumConfig,
} from "../../src/lib/consts.js"
import { CHECKSUM_FIXTURES } from "./checksum-fixtures.js"

// The most dangerous change in this area is not a bug in new code — it is a
// silent shift in the checksum of every premise and expression that already
// exists. `entityChecksum` includes a field only `if (field in entity)`, and
// `createChecksumConfig` unions additional fields onto the defaults rather
// than replacing them, so adding an optional field to the schema and to the
// default field set is backward compatible with no migration.
//
// That guarantee holds only while an unmarked entity omits the key entirely.
// Persisting `enthymeme: null` makes `"enthymeme" in entity` true and changes
// every one of these hashes, breaking hierarchical checksums and sync
// detection everywhere.
//
// These golden values were recorded against the fixtures BEFORE the
// `enthymeme` field existed. They are not regenerated: re-recording them
// would convert the proof into a tautology. If one of them changes, a field
// selection changed, and that is a data migration rather than a bug fix.

const DEFAULT_GOLDENS: readonly [string, string, string][] = [
    ["variable expression", "2bc0d411", "2bc0d411"],
    ["operator expression", "e7a73190", "e7a73190"],
    ["formula expression", "f2e55d3a", "f2e55d3a"],
    ["freeform premise", "ccbffada", "ccbffada"],
    ["derivation premise", "73cdc6dc", "73cdc6dc"],
    ["premise carrying an app field", "d01d7ac6", "40f67cf7"],
    ["expression carrying an app field", "8af34272", "9a5156e6"],
]

const extendedConfig = createChecksumConfig({
    expressionFields: new Set(["appLabel"]),
    premiseFields: new Set(["appLabel"]),
})

function fieldsFor(kind: "expression" | "premise"): Set<string> {
    return kind === "expression"
        ? DEFAULT_CHECKSUM_CONFIG.expressionFields!
        : DEFAULT_CHECKSUM_CONFIG.premiseFields!
}

function extendedFieldsFor(kind: "expression" | "premise"): Set<string> {
    return kind === "expression"
        ? extendedConfig.expressionFields!
        : extendedConfig.premiseFields!
}

describe("enthymeme is checksum-neutral for entities that lack it", () => {
    for (const [index, [name, kind, entity]] of CHECKSUM_FIXTURES.entries()) {
        const [goldenName, defaultGolden, extendedGolden] =
            DEFAULT_GOLDENS[index]

        it(`${name} hashes to its pre-existing value under the default config`, () => {
            expect(name).toBe(goldenName)
            expect(entityChecksum(entity, fieldsFor(kind))).toBe(defaultGolden)
        })

        it(`${name} hashes to its pre-existing value under an app-extended config`, () => {
            expect(entityChecksum(entity, extendedFieldsFor(kind))).toBe(
                extendedGolden
            )
        })
    }

    it("covers both premises and expressions", () => {
        const kinds = new Set(CHECKSUM_FIXTURES.map(([, kind]) => kind))
        expect(kinds).toEqual(new Set(["expression", "premise"]))
    })
})

describe("a present enthymeme key does change the checksum", () => {
    for (const [name, kind, entity] of CHECKSUM_FIXTURES) {
        const baseline = entityChecksum(entity, fieldsFor(kind))

        it(`${name} — enthymeme: null hashes differently from absent`, () => {
            // The failure mode this guards: a persistence layer that
            // "normalizes" absence into null. `null` is a value, so the key is
            // present, the field enters the hash, and every stored checksum
            // shifts at once.
            expect(
                entityChecksum({ ...entity, enthymeme: null }, fieldsFor(kind))
            ).not.toBe(baseline)
        })

        it(`${name} — enthymeme: true hashes differently from absent`, () => {
            expect(
                entityChecksum({ ...entity, enthymeme: true }, fieldsFor(kind))
            ).not.toBe(baseline)
        })

        it(`${name} — enthymeme: false hashes differently from absent`, () => {
            // `false` is not "unmarked" either. Unmarking content must delete
            // the key, or the entity's checksum never returns to the value it
            // had before it was marked.
            expect(
                entityChecksum({ ...entity, enthymeme: false }, fieldsFor(kind))
            ).not.toBe(baseline)
        })

        it(`${name} — null, true, and false all differ from each other`, () => {
            const hashes = new Set(
                [null, true, false].map((value) =>
                    entityChecksum(
                        { ...entity, enthymeme: value },
                        fieldsFor(kind)
                    )
                )
            )
            expect(hashes.size).toBe(3)
        })
    }

    it("is reached through an app-extended config too", () => {
        const [, kind, entity] = CHECKSUM_FIXTURES[0]
        expect(
            entityChecksum(
                { ...entity, enthymeme: true },
                extendedFieldsFor(kind)
            )
        ).not.toBe(entityChecksum(entity, extendedFieldsFor(kind)))
    })
})
