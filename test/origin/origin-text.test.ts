import { describe, it, expect } from "vitest"
import {
    normalizeOriginText,
    codePointLength,
    sliceByCodePoints,
    buildCodePointIndex,
    sliceByCodePointsIndexed,
} from "../../src/lib/utils/origin-text.js"

// Invisible characters are written as escapes throughout. A literal in the
// source is unreadable in review and silently mutable by an editor, which is
// exactly the failure class this function exists to handle.

const BOM = "\uFEFF"
const ZWSP = "\u200B"
const ZWNJ = "\u200C"
const ZWJ = "\u200D"
const WORD_JOINER = "\u2060"
const SOFT_HYPHEN = "\u00AD"
const NEL = "\u0085"
const LINE_SEPARATOR = "\u2028"
const PARAGRAPH_SEPARATOR = "\u2029"
const VARIATION_SELECTOR_16 = "\uFE0F"
const VARIATION_SELECTOR_1 = "\uFE00"
const MONGOLIAN_FVS_1 = "\u180B"
const MONGOLIAN_LETTER_A = "ᠠ"
const COMBINING_ACUTE = "\u0301"
const KEYCAP = "\u20E3"
const BIDI_CONTROLS = [
    "\u061C",
    "\u200E",
    "\u200F",
    "\u202A",
    "\u202B",
    "\u202C",
    "\u202D",
    "\u202E",
    "\u2066",
    "\u2067",
    "\u2068",
    "\u2069",
] as const

const idempotenceFixtures: readonly [string, string][] = [
    ["crlf", "line one\r\nline two\r\nline three"],
    ["lone cr", "line one\rline two\rline three"],
    ["mixed line endings", "a\r\nb\rc\nd"],
    ["leading bom", `${BOM}the document text`],
    ["interior zero width no-break space", `the${BOM}document`],
    ["null bytes", "before\u0000 after\u0000 end"],
    ["other c0 controls", "a\u0001b\u0007c\u001Fd"],
    ["c1 controls", "a\u0080b\u009Fc"],
    ["del", "a\u007Fb"],
    ["next line", `one${NEL}two`],
    [
        "line and paragraph separators",
        `one${LINE_SEPARATOR}two${PARAGRAPH_SEPARATOR}three`,
    ],
    ["decomposed accents", `cafe${COMBINING_ACUTE} nai${COMBINING_ACUTE}vete`],
    ["astral plane", "\u{1D56C} theorem \u{1F44D} thumbs"],
    ["mixed indentation", "  spaces\n\ttab\n    four\n\t\ttwo tabs"],
    ["bidi controls", "safe\u202Etxet nedih\u202C tail"],
    ["isolate controls", "a\u2066b\u2069c\u061Cd"],
    ["bare tag characters", "plain\u{E0067}\u{E0062}text"],
    [
        "stray variation selector",
        `a${VARIATION_SELECTOR_16}b${VARIATION_SELECTOR_1}c`,
    ],
    ["bare mongolian fvs", `a${MONGOLIAN_FVS_1}b`],
    ["bare zero width joiner", `a${ZWJ}b${ZWNJ}c${ZWSP}d`],
    ["soft hyphen and word joiner", `co${SOFT_HYPHEN}operate${WORD_JOINER}now`],
    ["surrounding whitespace", "  \n\t the text \t\n  "],
    [
        "everything at once",
        `${BOM}  a\r\n b\u202Ec${ZWJ}\u{1F44D}e${COMBINING_ACUTE} \n`,
    ],
    ["empty", ""],
    ["whitespace only", "  \r\n\t  "],
]

describe("normalizeOriginText — idempotence", () => {
    for (const [label, text] of idempotenceFixtures) {
        it(`is idempotent — ${label}`, () => {
            const once = normalizeOriginText(text)
            expect(normalizeOriginText(once)).toBe(once)
        })
    }
})

describe("normalizeOriginText — encoding normalization", () => {
    it("folds every line-break form to LF without losing the break", () => {
        expect(normalizeOriginText("a\r\nb")).toBe("a\nb")
        expect(normalizeOriginText("a\rb")).toBe("a\nb")
        expect(normalizeOriginText(`a${NEL}b`)).toBe("a\nb")
        expect(normalizeOriginText(`a${LINE_SEPARATOR}b`)).toBe("a\nb")
        expect(normalizeOriginText(`a${PARAGRAPH_SEPARATOR}b`)).toBe("a\nb")
    })

    it("strips a BOM and an interior zero width no-break space", () => {
        expect(normalizeOriginText(`${BOM}text`)).toBe("text")
        expect(normalizeOriginText(`te${BOM}xt`)).toBe("text")
    })

    it("strips control characters but keeps LF and tab", () => {
        expect(normalizeOriginText("a\u0000b\u0001c")).toBe("abc")
        expect(normalizeOriginText("a\u007Fb\u0080c\u009Fd")).toBe("abcd")
        expect(normalizeOriginText("a\tb\nc")).toBe("a\tb\nc")
    })

    it("strips bidirectional controls", () => {
        for (const control of BIDI_CONTROLS) {
            expect(normalizeOriginText(`a${control}b`)).toBe("ab")
        }
    })

    it("strips zero-width characters, soft hyphen, and word joiner", () => {
        expect(normalizeOriginText(`a${ZWSP}b`)).toBe("ab")
        expect(normalizeOriginText(`a${ZWNJ}b`)).toBe("ab")
        expect(normalizeOriginText(`a${SOFT_HYPHEN}b`)).toBe("ab")
        expect(normalizeOriginText(`a${WORD_JOINER}b`)).toBe("ab")
    })

    it("composes to NFC", () => {
        expect(normalizeOriginText(`cafe${COMBINING_ACUTE}`)).toBe("café")
        expect(normalizeOriginText(`cafe${COMBINING_ACUTE}`)).toBe(
            normalizeOriginText("café")
        )
    })

    it("composes across a removed invisible character", () => {
        // Stripping must happen before NFC: removing the joiner puts the base
        // letter next to its combining mark, and a second pass must not then
        // find something new to compose.
        const once = normalizeOriginText(`e${ZWSP}${COMBINING_ACUTE}`)
        expect(once).toBe("é")
        expect(normalizeOriginText(once)).toBe(once)
    })

    it("trims leading and trailing whitespace only", () => {
        expect(normalizeOriginText("  text  ")).toBe("text")
        expect(normalizeOriginText("\n\ttext\n\t")).toBe("text")
    })
})

describe("normalizeOriginText — content preservation", () => {
    it("leaves a paragraph-structured document structurally intact", () => {
        const document = [
            "First paragraph   with   internal   runs\tand\ttabs.",
            "",
            "Second paragraph — with “smart quotes” and an ellipsis…",
            "",
            "    Indented third paragraph; punctuation: !?;-()[]{}",
        ].join("\n")
        expect(normalizeOriginText(document)).toBe(document)
    })

    it("does not collapse internal whitespace", () => {
        expect(normalizeOriginText("a     b")).toBe("a     b")
        expect(normalizeOriginText("a\t\t\tb")).toBe("a\t\t\tb")
        expect(normalizeOriginText("a\n\n\n\nb")).toBe("a\n\n\n\nb")
    })

    it("does not fold smart quotes, dashes, or case", () => {
        const text = "“Quoted” ‘single’ —em–en MiXeD CaSe"
        expect(normalizeOriginText(text)).toBe(text)
    })

    it("does not strip punctuation, diacritics, emoji, or non-ASCII", () => {
        const text = "Résumé: 日本語 — \u{1F600}!"
        expect(normalizeOriginText(text)).toBe(text)
    })

    it("does not replace a non-breaking space with an ordinary space", () => {
        expect(normalizeOriginText("a\u00A0b")).toBe("a\u00A0b")
    })
})

describe("normalizeOriginText — invisible-character preservation boundary", () => {
    it("keeps a zero width joiner inside an emoji sequence", () => {
        const family = `\u{1F468}${ZWJ}\u{1F469}${ZWJ}\u{1F467}`
        expect(normalizeOriginText(family)).toBe(family)
        const profession = `\u{1F469}${ZWJ}\u{1F4BB}`
        expect(normalizeOriginText(profession)).toBe(profession)
        const skinToned = `\u{1F469}\u{1F3FD}${ZWJ}\u{1F680}`
        expect(normalizeOriginText(skinToned)).toBe(skinToned)
    })

    it("strips a bare zero width joiner in plain text", () => {
        expect(normalizeOriginText(`word${ZWJ}word`)).toBe("wordword")
    })

    it("keeps a variation selector doing legitimate work", () => {
        const keycap = `1${VARIATION_SELECTOR_16}${KEYCAP}`
        expect(normalizeOriginText(keycap)).toBe(keycap)
        const emojiPresentation = `❤${VARIATION_SELECTOR_16}`
        expect(normalizeOriginText(emojiPresentation)).toBe(emojiPresentation)
        const ideograph = `神${VARIATION_SELECTOR_1}`
        expect(normalizeOriginText(ideograph)).toBe(ideograph)
    })

    it("strips a stray variation selector after ordinary text", () => {
        expect(normalizeOriginText(`word${VARIATION_SELECTOR_16}word`)).toBe(
            "wordword"
        )
        expect(normalizeOriginText(`word${VARIATION_SELECTOR_1}word`)).toBe(
            "wordword"
        )
    })

    it("keeps a Mongolian free variation selector after Mongolian script", () => {
        const mongolian = `${MONGOLIAN_LETTER_A}${MONGOLIAN_FVS_1}`
        expect(normalizeOriginText(mongolian)).toBe(mongolian)
    })

    it("strips a Mongolian free variation selector after ordinary text", () => {
        expect(normalizeOriginText(`word${MONGOLIAN_FVS_1}word`)).toBe(
            "wordword"
        )
    })

    it("keeps an emoji tag sequence", () => {
        const englandFlag =
            "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}"
        expect(normalizeOriginText(englandFlag)).toBe(englandFlag)
    })

    it("strips a bare tag-character run in plain text", () => {
        expect(
            normalizeOriginText("plain\u{E0067}\u{E0062}\u{E0065}text")
        ).toBe("plaintext")
    })
})

describe("code-point slicing", () => {
    const astral = "a\u{1F44D}b\u{1D56C}c"

    it("counts code points, not UTF-16 code units", () => {
        expect(codePointLength(astral)).toBe(5)
        expect(astral.length).toBe(7)
        expect(codePointLength(astral)).not.toBe(astral.length)
    })

    it("slices by code point, and the same offsets sliced as code units differ", () => {
        expect(sliceByCodePoints(astral, 2, 4)).toBe("b\u{1D56C}")
        expect(astral.slice(2, 4)).not.toBe(sliceByCodePoints(astral, 2, 4))
    })

    it("slices the whole string and the empty span", () => {
        expect(sliceByCodePoints(astral, 0, codePointLength(astral))).toBe(
            astral
        )
        expect(sliceByCodePoints(astral, 3, 3)).toBe("")
    })

    it("clamps out-of-range offsets rather than throwing", () => {
        expect(sliceByCodePoints(astral, -5, 2)).toBe("a\u{1F44D}")
        expect(sliceByCodePoints(astral, 3, 999)).toBe("\u{1D56C}c")
        expect(sliceByCodePoints(astral, 4, 1)).toBe("")
    })

    it("agrees with the reusable index over every span", () => {
        const document = "\u{1F600} café\n日本 \u{1D56C}\ttail"
        const index = buildCodePointIndex(document)
        const total = codePointLength(document)
        for (let start = 0; start <= total; start++) {
            for (let end = start; end <= total; end++) {
                expect(sliceByCodePointsIndexed(index, start, end)).toBe(
                    sliceByCodePoints(document, start, end)
                )
            }
        }
    })
})
