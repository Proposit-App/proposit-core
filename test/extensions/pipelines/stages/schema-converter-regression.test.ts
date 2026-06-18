// Regression test: every v2 LLM-stage outputSchema must (a) convert
// successfully via `typeboxToOpenAiSchema`, (b) produce a converted
// JSON Schema whose root is `{ "type": "object" }`, and (c) walk
// recursively without any strict-mode violations
// (`additionalProperties` non-false, `patternProperties` anywhere,
// `properties`/`required` mismatch). All three invariants come from
// concrete OpenAI 400 responses observed during fixture recording.
//
// Lambda-fold 1 (`Type.Tuple` → `SpanSchema { start, end }`):
//   The converter threw `UnsupportedSchemaError: "Tuple"` synchronously
//   at request-build time. `llmStage` classified it as
//   `LLM_NON_RETRYABLE_ERROR` (no `retryReason` tag), `segmentation`
//   failed after retry exhaustion, every downstream stage with a
//   required dep on `segmentation` cascade-skipped, and `finalize`
//   returned `output: null` in ~9 ms total per fixture with zero LLM
//   calls landing.
//
// Lambda-fold 3 (array-rooted → object-envelope outputSchemas):
//   With the converter no longer throwing, the v2 stages reached the
//   real OpenAI Responses API — which then returned 400
//   `invalid_json_schema`: "schema must be a JSON Schema of
//   'type: object', got 'type: array'". `classifyHttpError(400)`
//   returns `NonRetryableLlmError` (no `retryReason`), so the same
//   stage-failed → cascade-skip → output-null chain repeated, only
//   slower (84-926 ms per fixture because real HTTP roundtrips). Fix:
//   wrap each of the 5 originally-array-rooted LLM stage schemas in a
//   single-key envelope (`segments`, `mentions`, `sources`, `axioms`,
//   `relations`).
//
// Lambda-fold 4 (`Type.Record` → explicit list shapes):
//   Recording attempt #3 made it past segmentation (4 stages
//   completed) but `claim-canonicalization` then hit a different
//   strict-mode 400: "'required' is required to be supplied and to
//   be an array including every key in properties. Extra required
//   key 'mentionToClaim' supplied." OpenAI strict mode does not
//   support `additionalProperties` / `patternProperties` /
//   arbitrary-key Record-style objects. The converter's
//   `convertRecord` produces `{ type: "object", additionalProperties:
//   <V> }`; even though our `properties` and `required` lists agree
//   on the key, the API treats the inner schema (which carries
//   `additionalProperties: <V>`) as if it had no fixed properties
//   and reports `required` as having "extra" keys. Fix: replace
//   `Type.Record(...)` with explicit list shapes —
//   `mentionToClaim: Array<{ mentionId, claimMiniId }>`,
//   `ClaimTypeClassificationOutputSchema: { classifications:
//   Array<{ miniId, type, sourceString }> }`. Downstream readers
//   build a `Map` on receipt when they need keyed lookups.
//
// This test pins all three invariants so future stages can't
// reintroduce any of these classes of bug at fixture-recording time.

import { describe, expect, it } from "vitest"
import type { TSchema } from "typebox"
import { typeboxToOpenAiSchema } from "../../../../src/extensions/openai/structured-output.js"
import {
    AxiomIndicatorDetectionOutputSchema,
    CitationSourceDetectionOutputSchema,
    ClaimMentionExtractionOutputSchema,
    ClaimTypeClassificationOutputSchema,
    ConclusionSelectionOutputSchema,
    RelationExtractionOutputSchema,
    SegmentationOutputSchema,
} from "../../../../src/extensions/pipelines/base/stages/schemas.js"
import { createClaimCanonicalizationStage } from "../../../../src/extensions/pipelines/base/stages/claim-canonicalization.js"
import { basicsExtension } from "../../../../src/extensions/pipelines/base/basics-extension.js"

// Table-driven test: every v2 LLM-stage outputSchema. Adding a new
// LLM stage means appending one row here; both invariants are then
// pinned automatically. Deterministic stage outputSchemas
// (`variable-assignment`, `claim-reference-validation`,
// `formula-validation`) are intentionally absent — they never reach
// the OpenAI converter, so neither invariant applies.
function llmStageSchemas(): [name: string, schema: TSchema][] {
    const canonicalizationStage =
        createClaimCanonicalizationStage(basicsExtension)
    return [
        ["segmentation", SegmentationOutputSchema],
        ["claim-mention-extraction", ClaimMentionExtractionOutputSchema],
        ["citation-source-detection", CitationSourceDetectionOutputSchema],
        ["axiom-indicator-detection", AxiomIndicatorDetectionOutputSchema],
        ["claim-canonicalization (basics)", canonicalizationStage.outputSchema],
        ["claim-type-classification", ClaimTypeClassificationOutputSchema],
        ["relation-extraction", RelationExtractionOutputSchema],
        ["conclusion-selection", ConclusionSelectionOutputSchema],
    ]
}

describe("v2 LLM stages — outputSchema OpenAI-converter round trip", () => {
    for (const [name, schema] of llmStageSchemas()) {
        it(`${name}: typeboxToOpenAiSchema converts without throwing`, () => {
            expect(() => typeboxToOpenAiSchema(schema)).not.toThrow()
        })
    }
})

describe("v2 LLM stages — converted root must be type:object", () => {
    // Pins the lambda-fold 3 invariant: the OpenAI Responses-API
    // strict-mode `text.format.schema` field requires a `type: object`
    // root. Wrap each natural array shape in a single-key envelope so
    // the converted schema's root is the envelope's `object` rather
    // than the inner `array`.
    for (const [name, schema] of llmStageSchemas()) {
        it(`${name}: converted root is { type: "object" }`, () => {
            const converted = typeboxToOpenAiSchema(schema) as {
                type?: unknown
            }
            expect(converted.type).toBe("object")
        })
    }
})

/**
 * Recursive walk that asserts every object in the converted JSON
 * Schema tree satisfies OpenAI strict-mode rules:
 *
 *   - `additionalProperties` is either absent or literal `false`.
 *     The converter's only legitimate path for arbitrary-key
 *     objects (`Type.Record`) was `{ type: "object",
 *     additionalProperties: <V> }`, which violates strict mode and
 *     was rejected by the API. The lambda-fold 4 fix removes every
 *     `Type.Record` from the v2 stage schemas; this assertion is
 *     the test-time guard.
 *   - `patternProperties` is absent. Strict mode does not support
 *     it either.
 *   - Every key in `properties` is in `required`, and every key in
 *     `required` is in `properties` (the symmetric invariant —
 *     OpenAI's diagnostic at the time of lambda-fold 4 was "extra
 *     required key 'mentionToClaim' supplied" which is one
 *     direction; we pin both).
 *
 * Recurses through `properties`, `items`, and `anyOf` branches.
 * Throws with a path like `"claim-canonicalization.canonicalClaims.
 * anyOf[0].title"` so failures point at the exact violation.
 */
function walkConvertedSchema(schema: unknown, path: readonly string[]): void {
    if (schema === null || typeof schema !== "object") return
    const s = schema as Record<string, unknown>
    const pathStr = path.length === 0 ? "<root>" : path.join(".")

    if (s.additionalProperties !== undefined) {
        const ap = s.additionalProperties
        if (ap !== false) {
            throw new Error(
                `Strict-mode violation at ${pathStr}: additionalProperties must be \`false\` or omitted; got ${JSON.stringify(ap)}.`
            )
        }
    }
    if (s.patternProperties !== undefined) {
        throw new Error(
            `Strict-mode violation at ${pathStr}: patternProperties is not supported in OpenAI strict mode.`
        )
    }
    if (
        s.type === "object" &&
        s.properties !== undefined &&
        typeof s.properties === "object" &&
        s.properties !== null
    ) {
        const propsObj = s.properties as Record<string, unknown>
        const propKeys = Object.keys(propsObj)
        const required = Array.isArray(s.required)
            ? (s.required as string[])
            : []
        for (const key of propKeys) {
            if (!required.includes(key)) {
                throw new Error(
                    `Strict-mode violation at ${pathStr}: property "${key}" must be listed in \`required\` (strict mode requires every property to be required; use \`Type.Optional\` to widen the value type with null).`
                )
            }
        }
        for (const reqKey of required) {
            if (!propKeys.includes(reqKey)) {
                throw new Error(
                    `Strict-mode violation at ${pathStr}: required key "${reqKey}" is not declared in \`properties\`.`
                )
            }
        }
        for (const [key, value] of Object.entries(propsObj)) {
            walkConvertedSchema(value, [...path, key])
        }
    }
    if (Array.isArray(s.anyOf)) {
        for (const [i, member] of (s.anyOf as unknown[]).entries()) {
            walkConvertedSchema(member, [...path, `anyOf[${String(i)}]`])
        }
    }
    if (s.type === "array" && s.items !== undefined) {
        walkConvertedSchema(s.items, [...path, "items"])
    }
}

describe("v2 LLM stages — converted schema is strict-mode-compliant (recursive walk)", () => {
    for (const [name, schema] of llmStageSchemas()) {
        it(`${name}: passes the strict-mode invariants at every depth`, () => {
            const converted = typeboxToOpenAiSchema(schema)
            expect(() => walkConvertedSchema(converted, [name])).not.toThrow()
        })
    }
})

// Length steering on the REAL ingestion claim-record schema, not a
// synthetic string. The canonicalization output's `canonicalClaims`
// items are the basics claim union; its citation branch carries
// `title` (free text, maxLength 50) and `url` (an exact value,
// maxLength 500, `format: "uri"`). After conversion the free-text
// title must shrink toward its cap and restate the budget in its
// description, while the URL must keep its full original limit and
// gain no hint — the regression that motivated the steering (a claim
// title cut off mid-word) against the actual field set ingestion ships.
describe("ingestion claim-record schema — free-text length steering", () => {
    function citationClaimBranch(): Record<string, unknown> {
        const stage = createClaimCanonicalizationStage(basicsExtension)
        const converted = typeboxToOpenAiSchema(stage.outputSchema) as {
            properties: {
                canonicalClaims: { items: { anyOf: Record<string, unknown>[] } }
            }
        }
        const branches = converted.properties.canonicalClaims.items.anyOf
        // The citation branch is the one declaring a `url` property.
        const citation = branches.find((b) => {
            const props = (b as { properties?: Record<string, unknown> })
                .properties
            return props !== undefined && "url" in props
        })
        if (citation === undefined) {
            throw new Error(
                "expected a claim-record branch carrying a `url` property"
            )
        }
        return citation
    }

    it("shrinks the free-text `title` to 45 and appends the budget to its description", () => {
        const props = (
            citationClaimBranch() as {
                properties: {
                    title: { maxLength: number; description: string }
                }
            }
        ).properties
        // basics title maxLength 50 → floor(50 * 0.9) = 45.
        expect(props.title.maxLength).toBe(45)
        expect(props.title.description).toMatch(/at most 45 characters$/)
    })

    it("leaves the exact-value `url` at its original maxLength with no appended budget", () => {
        const props = (
            citationClaimBranch() as {
                properties: { url: { maxLength: number; description: string } }
            }
        ).properties
        expect(props.url.maxLength).toBe(500)
        expect(props.url.description).not.toMatch(/at most \d+ characters/)
    })
})
