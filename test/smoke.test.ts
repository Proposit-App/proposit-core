import { describe, expect, it } from "vitest"

import { healthcheck } from "../src/index"

describe("healthcheck", () => {
    it("returns ok", () => {
        expect(healthcheck()).toBe("ok")
    })
})
