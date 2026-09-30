// Regression test: every LLM-stage outputSchema must (a) convert
// successfully via `typeboxToOpenAiSchema`, (b) produce a converted
// JSON Schema whose root is `{ "type": "object" }`, and (c) walk
// recursively without any strict-mode violations
// (`additionalProperties` non-false, `patternProperties` anywhere,
// `properties`/`required` mismatch). Each invariant matches a concrete
// OpenAI rejection:
//
// (a) No `Type.Tuple` (spans use `SpanSchema { start, end }`):
//   The converter throws `UnsupportedSchemaError: "Tuple"` synchronously
//   when the request is built. `llmStage` classifies it as
//   `LLM_NON_RETRYABLE_ERROR` (no `retryReason` tag), so `segmentation`
//   fails, every downstream stage with a required dependency on it is
//   skipped, and `finalize` returns `output: null` without any LLM call.
//
// (b) Object-rooted output schemas:
//   The OpenAI Responses API returns 400 `invalid_json_schema`: "schema
//   must be a JSON Schema of 'type: object', got 'type: array'".
//   `classifyHttpError(400)` returns `NonRetryableLlmError`, so the same
//   stage-failed → skip → output-null chain follows. Each naturally
//   array-shaped stage output is wrapped in a single-key envelope
//   (`segments`, `mentions`, `sources`, `axioms`, `relations`).
//
// (c) No `Type.Record` (explicit list shapes instead):
//   OpenAI strict mode does not support `additionalProperties` /
//   `patternProperties` / arbitrary-key Record-style objects. The
//   converter's `convertRecord` produces `{ type: "object",
//   additionalProperties: <V> }`, which the API rejects with a 400
//   ("'required' is required to be supplied and to be an array
//   including every key in properties. Extra required key
//   'mentionToClaim' supplied."). Keyed maps are therefore explicit
//   list shapes — `mentionToClaim: Array<{ mentionId, claimMiniId }>`,
//   `ClaimTypeClassificationOutputSchema: { classifications:
//   Array<{ miniId, type, sourceString }> }`. Downstream readers
//   build a `Map` on receipt when they need keyed lookups.
//
// This test pins all three invariants so a new stage can't
// reintroduce any of these classes of bug.

import { describe, expect, it } from "vitest"
import type { TSchema } from "typebox"
import { typeboxToOpenAiSchema } from "../../../../src/extensions/openai/structured-output.js"
import { getParsingResponseSchema } from "../../../../src/lib/parsing/schemata.js"
import { BasicsParsingSchema } from "../../../../src/extensions/basics/schemata.js"
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

// Table-driven test: every LLM-stage outputSchema. Adding a new
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

describe("LLM stages — outputSchema OpenAI-converter round trip", () => {
    for (const [name, schema] of llmStageSchemas()) {
        it(`${name}: typeboxToOpenAiSchema converts without throwing`, () => {
            expect(() => typeboxToOpenAiSchema(schema)).not.toThrow()
        })
    }
})

describe("LLM stages — converted root must be type:object", () => {
    // Pins invariant (b): the OpenAI Responses-API
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
 *     objects (`Type.Record`) is `{ type: "object",
 *     additionalProperties: <V> }`, which violates strict mode and
 *     is rejected by the API. The stage schemas carry no
 *     `Type.Record`; this assertion is the test-time guard.
 *   - `patternProperties` is absent. Strict mode does not support
 *     it either.
 *   - Every key in `properties` is in `required`, and every key in
 *     `required` is in `properties` (the symmetric invariant —
 *     OpenAI's "extra required key 'mentionToClaim' supplied"
 *     diagnostic covers one direction; we pin both).
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

describe("LLM stages — converted schema is strict-mode-compliant (recursive walk)", () => {
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
// `title` (free text, maxLength 50) and `url` (free text, maxLength
// 500). After conversion both shrink toward their cap and restate the
// budget in their description — the regression that motivated the
// steering (a claim title cut off mid-word) against the actual field
// set ingestion ships. The `url` field carries no `format`: it is
// serialized straight into OpenAI strict mode, which rejects any
// string `format` outside its fixed set. Length steering on a URL is
// acceptable — the post-hoc clamp still allows the full 500 chars, so
// the shrunk cap only nudges, it never truncates a valid URL.
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

    it("sends the free-text `title` with no maxLength and a 45-character budget in its description", () => {
        const props = (
            citationClaimBranch() as {
                properties: {
                    title: { maxLength?: number; description: string }
                }
            }
        ).properties
        // basics title maxLength 50 → floor(50 * 0.9) = 45, stated in
        // prose only: a model that enforces maxLength stops generating
        // at the cap and leaves the title cut off mid-word.
        expect(props.title).not.toHaveProperty("maxLength")
        expect(props.title.description).toMatch(/at most 45 characters$/)
    })

    it("sends the free-text `url` with no maxLength, a 450-character budget, and no `format` on the wire schema", () => {
        const props = (
            citationClaimBranch() as {
                properties: { url: { maxLength?: number; description: string } }
            }
        ).properties
        // basics url maxLength 500 → floor(500 * 0.9) = 450, in prose.
        expect(props.url).not.toHaveProperty("maxLength")
        expect(props.url.description).toMatch(/at most 450 characters$/)
        // The converted strict-mode wire schema must not carry a
        // `format` — OpenAI strict mode rejects formats outside its
        // fixed set.
        expect(props.url).not.toHaveProperty("format")
    })
})

// Collect every JSON-pointer path at which a `format` key appears,
// recursing through `properties`, `items`, and `anyOf` branches.
// OpenAI strict mode rejects any string `format` outside its fixed
// set (date-time, date, time, duration, email, hostname, ipv4, ipv6,
// uuid); `uri` is not in it, so a leaked `format: "uri"` → a 400 at
// request time.
function findFormatPaths(schema: unknown, path: readonly string[]): string[] {
    if (schema === null || typeof schema !== "object") return []
    const s = schema as Record<string, unknown>
    const here = path.length === 0 ? "<root>" : path.join(".")
    const hits: string[] = []
    if (s.format !== undefined) {
        hits.push(`${here} (format=${JSON.stringify(s.format)})`)
    }
    if (s.properties && typeof s.properties === "object") {
        for (const [key, value] of Object.entries(
            s.properties as Record<string, unknown>
        )) {
            hits.push(...findFormatPaths(value, [...path, key]))
        }
    }
    if (Array.isArray(s.anyOf)) {
        for (const [i, member] of (s.anyOf as unknown[]).entries()) {
            hits.push(
                ...findFormatPaths(member, [...path, `anyOf[${String(i)}]`])
            )
        }
    }
    if (s.items && typeof s.items === "object") {
        hits.push(...findFormatPaths(s.items, [...path, "items"]))
    }
    return hits
}

// The OpenAI-bound ingestion parse schema is built two ways that both
// reach the strict-mode `text.format.schema` slot, and NEITHER may
// carry a string `format`:
//
//   1. `getParsingResponseSchema(BasicsParsingSchema)` — a raw
//      `JSON.parse(JSON.stringify(...))` of the TypeBox node. A consumer
//      may send this directly as a strict-mode schema; it does
//      NOT pass through `typeboxToOpenAiSchema`, so any `format` on a
//      source String node serializes straight through to OpenAI.
//   2. `typeboxToOpenAiSchema(<stage schema>)` — the converter path
//      used by core's own OpenAI provider.
//
// A `format: "uri"` on the citation `url` field gets a 400
// (`'uri' is not a valid format`) from OpenAI strict mode, so the
// source TypeBox node carries no `format` and no derivation path can
// emit it. These tests guard both paths.
describe("OpenAI-bound parse schema carries no string `format`", () => {
    it("getParsingResponseSchema(BasicsParsingSchema) has no `format` anywhere", () => {
        const raw = getParsingResponseSchema(BasicsParsingSchema)
        const hits = findFormatPaths(raw, [])
        expect(hits).toEqual([])
    })

    for (const [name, schema] of llmStageSchemas()) {
        it(`${name}: converted schema has no \`format\` anywhere`, () => {
            const converted = typeboxToOpenAiSchema(schema)
            const hits = findFormatPaths(converted, [name])
            expect(hits).toEqual([])
        })
    }
})
