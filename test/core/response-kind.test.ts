import { describe, expect, it } from "vitest"
import { ArgumentEngine } from "../../src/lib/index"
import { DEFAULT_CHECKSUM_CONFIG } from "../../src/lib/checksum-config"
import type { TCoreChecksumConfig } from "../../src/lib/types/checksum"
import { ARG, aLib } from "./fixtures"

const TARGET = { argumentId: "arg-target", argumentVersion: 3 }

function response(
    respondsTo = TARGET,
    checksumConfig?: TCoreChecksumConfig
): ArgumentEngine {
    return new ArgumentEngine({ ...ARG, respondsTo }, aLib(), {
        behavior: "permissive",
        ...(checksumConfig ? { checksumConfig } : {}),
    })
}

describe("respondsTo belongs to the engine, not to extras", () => {
    it("is not one of the extras", () => {
        expect(response().getExtras()).not.toHaveProperty("respondsTo")
    })

    it("survives setExtras", () => {
        const eng = response()
        eng.setExtras({ title: "t" })
        expect(eng.getArgument().respondsTo).toEqual(TARGET)
        expect(eng.getExtras()).toEqual({ title: "t" })
    })

    it("survives updateExtras", () => {
        const eng = response()
        eng.updateExtras({ title: "t" })
        expect(eng.getArgument().respondsTo).toEqual(TARGET)
    })

    it("cannot be set through setExtras", () => {
        const standard = new ArgumentEngine(ARG, aLib())
        expect(() => standard.setExtras({ respondsTo: TARGET })).toThrow(
            /respondsTo/
        )
        expect(standard.getArgument()).not.toHaveProperty("respondsTo")
    })
})

describe("respondsTo is part of the argument checksum", () => {
    const configs: [string, TCoreChecksumConfig | undefined][] = [
        ["the default configuration", undefined],
        [
            "a partial configuration without argumentFields",
            { expressionFields: DEFAULT_CHECKSUM_CONFIG.expressionFields },
        ],
        [
            "a configuration stored before the field existed",
            { argumentFields: new Set(["version"]) },
        ],
    ]

    for (const [name, config] of configs) {
        it(`moves the checksum when the pinned target version changes, under ${name}`, () => {
            const before = response(TARGET, config).getArgument().checksum
            const after = response(
                { ...TARGET, argumentVersion: 4 },
                config
            ).getArgument().checksum
            expect(after).not.toBe(before)
        })

        it(`agrees after a snapshot round trip, under ${name}`, () => {
            const eng = response(TARGET, config)
            const restored = ArgumentEngine.fromSnapshot(
                eng.snapshot(),
                aLib(),
                "strict"
            )
            expect(restored.getArgument().checksum).toBe(
                eng.getArgument().checksum
            )
        })
    }
})
