import { describe, it, expect, vi, afterEach } from "vitest"
import { PassThrough } from "node:stream"
import fs from "node:fs"

describe("requireConfirmation", () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it("should destroy the input stream after receiving 'confirm'", async () => {
        const stream = new PassThrough()
        vi.spyOn(fs, "createReadStream").mockReturnValue(
            stream as unknown as fs.ReadStream
        )
        vi.spyOn(process.stderr, "write").mockImplementation(() => true)
        const destroySpy = vi.spyOn(stream, "destroy")

        const { requireConfirmation } = await import("../../src/cli/output.js")
        const promise = requireConfirmation("Delete?")

        stream.push("confirm\n")
        await promise

        expect(destroySpy).toHaveBeenCalled()
    })

    it("should destroy the input stream when user aborts", async () => {
        const stream = new PassThrough()
        vi.spyOn(fs, "createReadStream").mockReturnValue(
            stream as unknown as fs.ReadStream
        )
        vi.spyOn(process.stderr, "write").mockImplementation(() => true)
        const exitSpy = vi
            .spyOn(process, "exit")
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            .mockImplementation((() => {}) as never)
        const destroySpy = vi.spyOn(stream, "destroy")

        const { requireConfirmation } = await import("../../src/cli/output.js")
        const promise = requireConfirmation("Delete?")

        stream.push("no\n")
        await promise

        expect(destroySpy).toHaveBeenCalled()
        expect(exitSpy).toHaveBeenCalledWith(1)
    })
})
