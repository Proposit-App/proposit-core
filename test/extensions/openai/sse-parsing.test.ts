// Reading a Responses-API SSE stream: the terminal envelope, and the
// callbacks that fire while the stream is still open.

import { describe, it, expect } from "vitest"
import { readSseEnvelope } from "../../../src/extensions/openai/openai-parsing.js"

// Frames in the wire shape OpenAI documents for `response.output_text.delta`:
// the chunk sits in a top-level `delta` string beside `item_id`,
// `output_index`, `content_index` and `sequence_number`.
function deltaFrame(delta: string, sequenceNumber: number): object {
    return {
        type: "response.output_text.delta",
        item_id: "msg_1",
        output_index: 0,
        content_index: 0,
        delta,
        sequence_number: sequenceNumber,
        logprobs: [],
    }
}

const terminalEnvelope = {
    id: "resp_1",
    status: "completed",
    output: [
        {
            type: "message",
            content: [{ type: "output_text", text: '{"answer":"abc"}' }],
        },
    ],
}

function stream(frames: object[]): Response {
    const body = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("")
    return new Response(
        new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(body))
                controller.close()
            },
        }),
        { status: 200 }
    )
}

const frames = [
    deltaFrame('{"answer":', 1),
    deltaFrame('"abc"}', 2),
    { type: "response.completed", response: terminalEnvelope },
]

describe("readSseEnvelope — text deltas", () => {
    it("passes each delta to the callback, in frame order, and still returns the terminal envelope", async () => {
        const deltas: string[] = []
        const envelope = await readSseEnvelope(stream(frames), undefined, (d) =>
            deltas.push(d)
        )
        expect(deltas).toEqual(['{"answer":', '"abc"}'])
        expect(envelope).toEqual(terminalEnvelope)
    })

    it("returns the same envelope and throws nothing without a callback", async () => {
        await expect(readSseEnvelope(stream(frames))).resolves.toEqual(
            terminalEnvelope
        )
    })

    it("ignores a delta frame whose delta is not a string", async () => {
        const deltas: string[] = []
        await readSseEnvelope(
            stream([
                { type: "response.output_text.delta", delta: 42 },
                { type: "response.output_text.delta" },
                ...frames.slice(2),
            ]),
            undefined,
            (d) => deltas.push(d)
        )
        expect(deltas).toEqual([])
    })
})

describe("readSseEnvelope — a callback that throws", () => {
    // A stream that records whether it was cancelled, holding its frames
    // open after the first chunk as a live response would.
    function liveStream(): { response: Response; cancelled: () => boolean } {
        let wasCancelled = false
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(
                    new TextEncoder().encode(
                        frames
                            .slice(0, 2)
                            .map((f) => `data: ${JSON.stringify(f)}\n\n`)
                            .join("")
                    )
                )
            },
            cancel() {
                wasCancelled = true
            },
        })
        return {
            response: new Response(body, { status: 200 }),
            cancelled: () => wasCancelled,
        }
    }

    it("passes a delta callback's error through unchanged and cancels the stream", async () => {
        const live = liveStream()
        const error = new Error("render failed")
        await expect(
            readSseEnvelope(live.response, undefined, () => {
                throw error
            })
        ).rejects.toBe(error)
        expect(live.cancelled()).toBe(true)
    })

    it("passes a response-id callback's error through unchanged and cancels the stream", async () => {
        let wasCancelled = false
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(
                    new TextEncoder().encode(
                        `data: ${JSON.stringify({ type: "response.created", response: { id: "resp_1" } })}\n\n`
                    )
                )
            },
            cancel() {
                wasCancelled = true
            },
        })
        const error = new Error("store failed")
        await expect(
            readSseEnvelope(new Response(body, { status: 200 }), () => {
                throw error
            })
        ).rejects.toBe(error)
        expect(wasCancelled).toBe(true)
    })
})
