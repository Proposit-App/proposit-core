// Unit tests for `createIngestionV1Pipeline`.
//
//   - The pipeline declares exactly one stage (`parse-argument`)
//     with empty deps and `outputSchema === extension.responseSchema`.
//   - Mock provider returns a known TParsedArgumentResponse-shaped
//     value: `executePipeline` returns the merged response with the
//     v1 empty `processingFailures` slot.
//   - Mock provider returns a schema-invalid output: the stage fails
//     with `OUTPUT_SCHEMA_INVALID`; result is `output: null`.
//   - Mock provider returns `{ argument: null, failureText: ... }`:
//     finalize passes it through with `processingFailures: []`.
//
// All tests run against the in-repo mock LlmProvider, NOT against a
// real OpenAI key. The golden-corpus e2e tests live in
// `./e2e.test.ts`.

import { describe, expect, it } from "vitest"
import {
    basicsExtension,
    createIngestionV1Pipeline,
    executePipeline,
} from "../../../src/lib/index.js"
import { createMockLlmProvider } from "../../mocks/llm.js"
import type { TParsedArgumentResponse } from "../../../src/lib/parsing/index.js"

const PARSE_STAGE_ID = "parse-argument"

function buildHappyResponse(): TParsedArgumentResponse {
    // Extension fields (title/body) live alongside the core fields
    // (`additionalProperties: true` on the parsed schemata), but the
    // exported core type only knows the core slots. Cast through
    // `unknown` so the test happy response can carry the extension
    // fields the basicsExtension schema expects.
    const response = {
        argument: {
            title: "Test argument",
            claims: [
                {
                    miniId: "c1",
                    role: "premise",
                    type: "normal",
                    title: "Claim 1",
                    body: "Body 1",
                },
                {
                    miniId: "c2",
                    role: "conclusion",
                    type: "normal",
                    title: "Claim 2",
                    body: "Body 2",
                },
            ],
            variables: [
                { miniId: "v1", symbol: "A", claimMiniId: "c1" },
                { miniId: "v2", symbol: "B", claimMiniId: "c2" },
            ],
            premises: [
                { miniId: "p1", formula: "A", title: "Premise 1" },
                { miniId: "p2", formula: "A implies B", title: "Premise 2" },
            ],
            conclusionPremiseMiniId: "p2",
        },
        uncategorizedText: null,
        selectionRationale: null,
        failureText: null,
    } as unknown as TParsedArgumentResponse
    return response
}

describe("createIngestionV1Pipeline — shape", () => {
    it("declares one stage (`parse-argument`) with empty deps and the extension's responseSchema", () => {
        const pipeline = createIngestionV1Pipeline(basicsExtension)
        expect(pipeline.stages).toHaveLength(1)
        const stage = pipeline.stages[0]
        expect(stage.id).toBe(PARSE_STAGE_ID)
        expect(stage.dependsOn).toEqual([])
        expect(stage.outputSchema).toBe(basicsExtension.responseSchema)
        expect(pipeline.finalize.dependsOn).toEqual([PARSE_STAGE_ID])
    })

    it("the pipeline output schema matches the extension's responseSchema", () => {
        const pipeline = createIngestionV1Pipeline(basicsExtension)
        expect(pipeline.outputSchema).toBe(basicsExtension.responseSchema)
    })
})

describe("createIngestionV1Pipeline — happy path", () => {
    it("returns the LLM's response with an empty processingFailures slot", async () => {
        const happy = buildHappyResponse()
        const llm = createMockLlmProvider({
            responses: {
                [PARSE_STAGE_ID]: [{ kind: "ok", output: happy }],
            },
        })
        const pipeline = createIngestionV1Pipeline(basicsExtension)
        const result = await executePipeline(
            pipeline,
            { text: "If A then B. A. Therefore B." },
            { llm }
        )

        expect(result.output).not.toBeNull()
        expect(result.failures).toEqual([])
        expect(result.stageOutcomes[PARSE_STAGE_ID]).toBe("completed")

        const out = result.output as TParsedArgumentResponse &
            Record<string, unknown>
        expect(out.argument).not.toBeNull()
        expect(out.processingFailures).toEqual([])
        // verbatim passthrough of the LLM-provided argument
        expect(out.argument).toEqual(happy.argument)
    })

    it("passes through a null-argument response (LLM declines to parse) with empty failures", async () => {
        const nullResponse: TParsedArgumentResponse = {
            argument: null,
            uncategorizedText: null,
            selectionRationale: null,
            failureText: "Input is not parseable as an argument.",
        }
        const llm = createMockLlmProvider({
            responses: {
                [PARSE_STAGE_ID]: [{ kind: "ok", output: nullResponse }],
            },
        })
        const pipeline = createIngestionV1Pipeline(basicsExtension)
        const result = await executePipeline(
            pipeline,
            { text: "Hello world." },
            { llm }
        )

        expect(result.output).not.toBeNull()
        const out = result.output as TParsedArgumentResponse &
            Record<string, unknown>
        expect(out.argument).toBeNull()
        expect(out.failureText).toBe("Input is not parseable as an argument.")
        expect(out.processingFailures).toEqual([])
        expect(result.failures).toEqual([])
    })
})

describe("createIngestionV1Pipeline — schema-invalid output", () => {
    it("fails the parse-argument stage with OUTPUT_SCHEMA_INVALID and returns null output", async () => {
        // Returns an output that fails the responseSchema (missing
        // required `argument` key entirely). Queue twice so both
        // attempts under the default `maxAttempts: 2` retry policy
        // surface the same schema-validation failure rather than
        // the second attempt hitting an empty-queue error from the
        // mock.
        const llm = createMockLlmProvider({
            responses: {
                [PARSE_STAGE_ID]: [
                    {
                        kind: "schema-invalid",
                        output: { broken: true } as unknown,
                    },
                    {
                        kind: "schema-invalid",
                        output: { broken: true } as unknown,
                    },
                ],
            },
        })
        const pipeline = createIngestionV1Pipeline(basicsExtension)
        const result = await executePipeline(
            pipeline,
            { text: "A. Therefore B." },
            { llm }
        )

        expect(result.output).toBeNull()
        expect(result.stageOutcomes[PARSE_STAGE_ID]).toBe("failed")
        const codes = result.failures.map((f) => f.code)
        // The schema-invalid output is first re-attempted by llmStage's
        // schema_validation retry; on the second failure the stage
        // throws LlmStageRetryExhaustedError and the executor records
        // OUTPUT_SCHEMA_INVALID as the failure code.
        expect(codes).toContain("OUTPUT_SCHEMA_INVALID")
    })
})

describe("createIngestionV1Pipeline — model override", () => {
    it("passes the caller's model override into the LLM request", async () => {
        const happy = buildHappyResponse()
        const calls: { model: string }[] = []
        const llm = createMockLlmProvider({
            responses: {
                [PARSE_STAGE_ID]: [{ kind: "ok", output: happy }],
            },
            onCall: (record) => {
                calls.push({ model: record.model })
            },
        })
        const pipeline = createIngestionV1Pipeline(basicsExtension, {
            model: "gpt-5.4-mini",
        })
        const result = await executePipeline(
            pipeline,
            { text: "Test." },
            { llm }
        )
        expect(result.output).not.toBeNull()
        expect(calls).toHaveLength(1)
        expect(calls[0].model).toBe("gpt-5.4-mini")
    })
})
