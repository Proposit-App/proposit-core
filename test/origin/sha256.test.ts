import { describe, it, expect } from "vitest"
import { createHash } from "node:crypto"
import { sha256Hex } from "../../src/lib/utils/sha256.js"

// `node:crypto` is used here only. `src/lib/` may not import it — the library
// implementation is pure TypeScript so it runs unchanged in a browser or React
// Native runtime, where neither `node:crypto` nor a synchronous `crypto.subtle`
// exists. These tests are what pin the two to the same output.

describe("sha256Hex", () => {
    // FIPS 180-4 published test vectors.
    it("matches the published vector for the empty string", () => {
        expect(sha256Hex("")).toBe(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        )
    })

    it("matches the published vector for 'abc'", () => {
        expect(sha256Hex("abc")).toBe(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        )
    })

    it("matches the published 448-bit vector", () => {
        expect(
            sha256Hex(
                "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"
            )
        ).toBe(
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        )
    })

    it("matches the published 896-bit vector", () => {
        expect(
            sha256Hex(
                "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu"
            )
        ).toBe(
            "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1"
        )
    })

    it("matches the published one-million-'a' vector", () => {
        expect(sha256Hex("a".repeat(1_000_000))).toBe(
            "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
        )
    })

    const nodeDigest = (text: string): string =>
        createHash("sha256").update(text, "utf8").digest("hex")

    const crossCheckFixtures: readonly [string, string][] = [
        ["empty", ""],
        ["ascii", "The quick brown fox jumps over the lazy dog."],
        ["exactly one block minus nine", "x".repeat(55)],
        ["exactly one block minus eight", "x".repeat(56)],
        ["exactly one block", "x".repeat(64)],
        ["exactly one block plus one", "x".repeat(65)],
        ["two byte code points", "café naïveté Ünicode"],
        ["three byte code points", "日本語のテキストです"],
        ["astral plane", "family 👨‍👩‍👧‍👦 flag 🏴󠁧󠁢󠁥󠁮󠁧󠁿 math 𝕬𝕭𝕮"],
        ["mixed newlines and tabs", "one\n\ttwo\n\n\tthree\n"],
        ["long", "paragraph text ✓ ".repeat(8000)],
    ]

    for (const [label, text] of crossCheckFixtures) {
        it(`agrees with node:crypto — ${label}`, () => {
            expect(sha256Hex(text)).toBe(nodeDigest(text))
        })
    }

    it("changes when a single character changes", () => {
        expect(sha256Hex("the original text")).not.toBe(
            sha256Hex("the original texts")
        )
        expect(sha256Hex("the original text")).not.toBe(
            sha256Hex("the origiual text")
        )
    })

    it("returns 64 lowercase hex characters", () => {
        expect(sha256Hex("anything at all")).toMatch(/^[0-9a-f]{64}$/)
    })
})
