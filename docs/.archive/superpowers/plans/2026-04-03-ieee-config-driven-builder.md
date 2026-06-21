# IEEE Config-Driven Segment Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 33 near-identical segment builder functions in `src/extensions/ieee/formatting.ts` with a single config-driven builder, reducing ~900 lines of boilerplate to ~200 lines of config + ~80 lines of engine.

**Architecture:** Define a `TSegmentTemplate` type that describes each segment (field name, role, style, formatter, prefix/suffix, conditional). Each reference type becomes a config array. A single `buildSegments(ref, template)` function interprets the config and produces `TCitationSegment[]`. The public API (`formatCitationParts`) is unchanged — existing tests must pass without modification.

**Tech Stack:** TypeScript, Vitest

---

## File Structure

| File                                       | Action | Responsibility                                                                                                         |
| ------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| `src/extensions/ieee/segment-templates.ts` | Create | Template type + 33 config arrays                                                                                       |
| `src/extensions/ieee/segment-builder.ts`   | Create | `buildSegments()` engine + shared helpers (`formatSingleAuthor`, `formatNamesInCitation`, `formatDate`, `IEEE_MONTHS`) |
| `src/extensions/ieee/formatting.ts`        | Modify | Remove 33 functions, replace BUILDERS map with config-driven dispatch; re-export shared helpers from segment-builder   |
| `test/extensions/ieee.test.ts`             | Modify | Add builder engine unit tests; existing formatCitationParts tests unchanged                                            |

### Import chain (no runtime cycles)

`segment-templates.ts` → type-only imports from `formatting.ts` and `references.ts`. `segment-builder.ts` → type-only imports from `formatting.ts`, `segment-templates.ts`, and `references.ts`; defines `formatSingleAuthor`, `formatNamesInCitation`, `formatDate`, `IEEE_MONTHS` as the canonical home. `formatting.ts` → runtime imports from `segment-builder.ts` and `segment-templates.ts`; re-exports the shared helpers for backward compatibility. All cross-file type imports use `import type` (erased at runtime). No runtime circular dependency exists.

---

### Task 1: Define the segment template type

**Files:**

- Create: `src/extensions/ieee/segment-templates.ts`

- [ ] **Step 1: Write the failing test**

In `test/extensions/ieee.test.ts`, add a new describe block at the bottom:

```typescript
describe("segment template config", () => {
    it("BOOK_TEMPLATE is a non-empty array", () => {
        const { BOOK_TEMPLATE } =
            await import("../src/extensions/ieee/segment-templates.js")
        expect(Array.isArray(BOOK_TEMPLATE)).toBe(true)
        expect(BOOK_TEMPLATE.length).toBeGreaterThan(0)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/extensions/ieee.test.ts -t "BOOK_TEMPLATE"`
Expected: FAIL — module not found

- [ ] **Step 3: Create the template type and Book config**

Create `src/extensions/ieee/segment-templates.ts`:

```typescript
import type { TCitationSegment } from "./formatting.js" // type-only import — no runtime cycle
import type { TAuthor } from "./references.js"

// ---------------------------------------------------------------------------
// Template types
// ---------------------------------------------------------------------------

/** How to extract and format a value from the reference object. */
export type TFieldSource =
    | { kind: "string"; field: string }
    | { kind: "date"; field: string }
    | { kind: "authors"; field: string }
    | { kind: "singleAuthor"; field: string }
    | { kind: "literal"; text: string }

/** One instruction in a segment template. */
export type TSegmentInstruction =
    | {
          type: "segment"
          source: TFieldSource
          role: TCitationSegment["role"]
          style?: TCitationSegment["style"]
      }
    | {
          type: "separator"
          text: string
      }
    | {
          type: "conditional"
          /** Field name to check for `!== undefined` */
          field: string
          /** If the field is an array, also check `.length > 0` */
          checkLength?: boolean
          /** Instructions to emit when the field is present */
          then: TSegmentInstruction[]
      }

export type TSegmentTemplate = TSegmentInstruction[]

// ---------------------------------------------------------------------------
// Per-type templates
// ---------------------------------------------------------------------------

export const BOOK_TEMPLATE: TSegmentTemplate = [
    {
        type: "segment",
        source: { kind: "authors", field: "authors" },
        role: "authors",
        style: "plain",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "title" },
        role: "title",
        style: "italic",
    },
    {
        type: "conditional",
        field: "edition",
        then: [
            { type: "separator", text: ", " },
            {
                type: "segment",
                source: { kind: "string", field: "edition" },
                role: "edition",
            },
            {
                type: "segment",
                source: { kind: "literal", text: " ed." },
                role: "suffix",
            },
        ],
    },
    {
        type: "conditional",
        field: "location",
        then: [
            { type: "separator", text: ", " },
            {
                type: "segment",
                source: { kind: "string", field: "location" },
                role: "location",
            },
        ],
    },
    { type: "separator", text: ": " },
    {
        type: "segment",
        source: { kind: "string", field: "publisher" },
        role: "publisher",
    },
    { type: "separator", text: ", " },
    {
        type: "segment",
        source: { kind: "string", field: "year" },
        role: "year",
    },
    { type: "separator", text: "." },
    {
        type: "conditional",
        field: "isbn",
        then: [
            { type: "separator", text: " " },
            {
                type: "segment",
                source: { kind: "string", field: "isbn" },
                role: "isbn",
            },
        ],
    },
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/extensions/ieee.test.ts -t "BOOK_TEMPLATE"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/extensions/ieee/segment-templates.ts test/extensions/ieee.test.ts
git commit -m "feat(ieee): add segment template type and Book config"
```

---

### Task 2: Implement the buildSegments engine

**Files:**

- Create: `src/extensions/ieee/segment-builder.ts`
- Modify: `test/extensions/ieee.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `test/extensions/ieee.test.ts`:

```typescript
import { buildSegments } from "../src/extensions/ieee/segment-builder.js"
import { BOOK_TEMPLATE } from "../src/extensions/ieee/segment-templates.js"

describe("buildSegments", () => {
    it("produces identical output to bookSegments for a full Book reference", () => {
        const ref = {
            type: "Book" as const,
            title: "AI Fundamentals",
            year: "2024",
            authors: [
                { givenNames: "Jane", familyName: "Smith" },
                { givenNames: "Bob", familyName: "Wilson" },
            ],
            edition: "3rd",
            publisher: "MIT Press",
            location: "Cambridge, MA",
            isbn: "9780262046824",
        }
        const fromConfig = buildSegments(
            ref as unknown as Record<string, unknown>,
            BOOK_TEMPLATE
        )
        const fromOriginal = formatCitationParts(ref).segments
        expect(fromConfig).toEqual(fromOriginal)
    })

    it("produces identical output for a minimal Book (no optional fields)", () => {
        const ref = {
            type: "Book" as const,
            title: "AI Fundamentals",
            year: "2024",
            authors: [{ givenNames: "Jane", familyName: "Smith" }],
            publisher: "MIT Press",
        }
        const fromConfig = buildSegments(
            ref as unknown as Record<string, unknown>,
            BOOK_TEMPLATE
        )
        const fromOriginal = formatCitationParts(ref).segments
        expect(fromConfig).toEqual(fromOriginal)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/extensions/ieee.test.ts -t "buildSegments"`
Expected: FAIL — module not found

- [ ] **Step 3: Implement buildSegments**

Create `src/extensions/ieee/segment-builder.ts`. This file is the canonical home for the shared formatting helpers (`formatSingleAuthor`, `formatNamesInCitation`, `formatDate`, `IEEE_MONTHS`) to avoid a circular import with `formatting.ts`.

```typescript
import type { TCitationSegment } from "./formatting.js" // type-only — erased at runtime, no cycle
import type {
    TSegmentInstruction,
    TSegmentTemplate,
} from "./segment-templates.js"
import type { TAuthor } from "./references.js"

// ---------------------------------------------------------------------------
// Shared formatting helpers (canonical home — formatting.ts re-exports these)
// ---------------------------------------------------------------------------

export const IEEE_MONTHS = [
    "Jan.",
    "Feb.",
    "Mar.",
    "Apr.",
    "May",
    "Jun.",
    "Jul.",
    "Aug.",
    "Sep.",
    "Oct.",
    "Nov.",
    "Dec.",
]

export function formatDate(d: Date): string {
    const month = IEEE_MONTHS[d.getMonth()]
    const day = d.getDate()
    const year = d.getFullYear()
    return `${month} ${day}, ${year}`
}

/**
 * Format a single structured author into IEEE citation style.
 * Given names are abbreviated to initials with periods: "Jane Marie" → "J. M."
 * Suffix is appended without comma: "W. P. Pratt Jr."
 */
export function formatSingleAuthor(author: TAuthor): string {
    const initials = author.givenNames
        .split(/\s+/)
        .map((name) => `${name.charAt(0)}.`)
        .join(" ")
    const name = `${initials} ${author.familyName}`
    return author.suffix ? `${name} ${author.suffix}` : name
}

/**
 * Format an array of structured author names into IEEE citation style.
 * 7+ authors → first author + " et al."
 * 2 authors → "A and B"
 * 3–6 authors → "A, B, C, and D"
 */
export function formatNamesInCitation(authors: TAuthor[]): string {
    if (authors.length === 0) return ""
    if (authors.length > 6) {
        return `${formatSingleAuthor(authors[0])} et al.`
    }
    const formatted = authors.map(formatSingleAuthor)
    if (formatted.length === 1) return formatted[0]
    if (formatted.length === 2) return `${formatted[0]} and ${formatted[1]}`
    return `${formatted.slice(0, -1).join(", ")}, and ${formatted[formatted.length - 1]}`
}

// ---------------------------------------------------------------------------
// Template engine
// ---------------------------------------------------------------------------

function resolveSource(
    ref: Record<string, unknown>,
    source: TSegmentInstruction & { type: "segment" }
): string {
    const src = source.source
    switch (src.kind) {
        case "string":
            return ref[src.field] as string
        case "date":
            return formatDate(ref[src.field] as Date)
        case "authors":
            return formatNamesInCitation(ref[src.field] as TAuthor[])
        case "singleAuthor":
            return formatSingleAuthor(ref[src.field] as TAuthor)
        case "literal":
            return src.text
    }
}

function emitInstructions(
    ref: Record<string, unknown>,
    instructions: TSegmentInstruction[],
    segs: TCitationSegment[]
): void {
    for (const instr of instructions) {
        switch (instr.type) {
            case "separator":
                segs.push({ text: instr.text, role: "separator" })
                break
            case "segment": {
                const seg: TCitationSegment = {
                    text: resolveSource(ref, instr),
                    role: instr.role,
                }
                if (instr.style) seg.style = instr.style
                segs.push(seg)
                break
            }
            case "conditional": {
                const value = ref[instr.field]
                if (value === undefined) break
                if (
                    instr.checkLength &&
                    Array.isArray(value) &&
                    value.length === 0
                )
                    break
                emitInstructions(ref, instr.then, segs)
                break
            }
        }
    }
}

export function buildSegments(
    ref: Record<string, unknown>,
    template: TSegmentTemplate
): TCitationSegment[] {
    const segs: TCitationSegment[] = []
    emitInstructions(ref, template, segs)
    return segs
}
```

**Note on prefix/suffix:** The original builder functions emit prefix/suffix text as _separate_ segments (e.g., `{ text: " ed.", role: "suffix" }` is its own `segs.push()` call). The `TSegmentInstruction` type does NOT have prefix/suffix fields — instead, these are modeled as separate `{ type: "segment", source: { kind: "literal" }, role: "prefix" | "suffix" }` instructions in the template. The `BOOK_TEMPLATE` already does this correctly.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/extensions/ieee.test.ts -t "buildSegments"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/extensions/ieee/segment-builder.ts test/extensions/ieee.test.ts
git commit -m "feat(ieee): implement buildSegments engine"
```

---

### Task 3: Port all 33 reference types to templates

**Files:**

- Modify: `src/extensions/ieee/segment-templates.ts`
- Modify: `test/extensions/ieee.test.ts`

This task ports all remaining 32 reference types (Book is done). Each template must produce output byte-identical to the original function.

- [ ] **Step 1: Write parity tests for all 33 types**

Add to the `buildSegments` describe block in `test/extensions/ieee.test.ts`. Use the existing `validBook()`, `validWebsite()`, `validPatent()`, `validJournalArticle()` helpers and add helpers for the rest. The test structure for each type:

```typescript
it("matches original output for Website", () => {
    const ref = { ...validWebsite(), accessedDate: new Date("2024-06-15") }
    const { WEBSITE_TEMPLATE } =
        await import("../src/extensions/ieee/segment-templates.js")
    const fromConfig = buildSegments(
        ref as unknown as Record<string, unknown>,
        WEBSITE_TEMPLATE
    )
    const fromOriginal = formatCitationParts(ref).segments
    expect(fromConfig).toEqual(fromOriginal)
})
```

Write one such test per reference type. Include both "all optional fields present" and "minimal required fields" variants for types with optional fields (Book, JournalArticle, ConferencePaper, etc.).

The complete list of template constants to test: `BOOK_TEMPLATE`, `WEBSITE_TEMPLATE`, `BOOK_CHAPTER_TEMPLATE`, `HANDBOOK_TEMPLATE`, `TECHNICAL_REPORT_TEMPLATE`, `STANDARD_TEMPLATE`, `THESIS_TEMPLATE`, `PATENT_TEMPLATE`, `DICTIONARY_TEMPLATE`, `ENCYCLOPEDIA_TEMPLATE`, `JOURNAL_ARTICLE_TEMPLATE`, `MAGAZINE_ARTICLE_TEMPLATE`, `NEWSPAPER_ARTICLE_TEMPLATE`, `CONFERENCE_PAPER_TEMPLATE`, `CONFERENCE_PROCEEDINGS_TEMPLATE`, `DATASET_TEMPLATE`, `SOFTWARE_TEMPLATE`, `ONLINE_DOCUMENT_TEMPLATE`, `BLOG_TEMPLATE`, `SOCIAL_MEDIA_TEMPLATE`, `PREPRINT_TEMPLATE`, `VIDEO_TEMPLATE`, `PODCAST_TEMPLATE`, `COURSE_TEMPLATE`, `PRESENTATION_TEMPLATE`, `INTERVIEW_TEMPLATE`, `PERSONAL_COMMUNICATION_TEMPLATE`, `EMAIL_TEMPLATE`, `LAW_TEMPLATE`, `COURT_CASE_TEMPLATE`, `GOVERNMENT_PUBLICATION_TEMPLATE`, `DATASHEET_TEMPLATE`, `PRODUCT_MANUAL_TEMPLATE`.

- [ ] **Step 2: Run tests to verify they all fail**

Run: `pnpm vitest run test/extensions/ieee.test.ts -t "matches original output"`
Expected: FAIL — templates not found

- [ ] **Step 3: Add all 32 remaining templates to segment-templates.ts**

Port each original function to its config equivalent. Here are the key patterns to follow:

**Authors (multi):** `{ type: "segment", source: { kind: "authors", field: "authors" }, role: "authors", style: "plain" }`

**Authors (single — blog, course, etc.):** `{ type: "segment", source: { kind: "singleAuthor", field: "author" }, role: "authors", style: "plain" }` — note the field name varies: `author`, `instructor`, `presenter`, `interviewee`, `person`, `sender`.

**Optional authors with length check (dataset, software, etc.):**

```typescript
{
    type: "conditional",
    field: "authors",
    checkLength: true,
    then: [
        { type: "segment", source: { kind: "authors", field: "authors" }, role: "authors", style: "plain" },
        { type: "separator", text: ", " },
    ],
}
```

**Editors with length check + suffix (bookChapter, conferenceProceedings):**

```typescript
{
    type: "conditional",
    field: "editors",
    checkLength: true,
    then: [
        { type: "segment", source: { kind: "authors", field: "editors" }, role: "misc" },
        { type: "segment", source: { kind: "literal", text: ", Eds." }, role: "suffix" },
    ],
}
```

**Date fields:** `{ type: "segment", source: { kind: "date", field: "date" }, role: "date" }` — field name varies: `date`, `dateEnacted`, `postDate`, `releaseDate`.

**Separator-prefixed fields (volume, issue, pages, doi):**

```typescript
{ type: "separator", text: ", vol. " },
{ type: "segment", source: { kind: "string", field: "volume" }, role: "volume" },
```

(Wrapped in a `conditional` when the field is optional.)

**Literal prefix segments:** `{ type: "segment", source: { kind: "literal", text: "Rep. " }, role: "prefix" }`

**Online available pattern:**

```typescript
{ type: "segment", source: { kind: "literal", text: "[Online]. Available: " }, role: "prefix" },
{ type: "segment", source: { kind: "string", field: "url" }, role: "url", style: "link" },
```

**Accessed date pattern:**

```typescript
{ type: "segment", source: { kind: "literal", text: "Accessed: " }, role: "prefix" },
{ type: "segment", source: { kind: "date", field: "accessedDate" }, role: "accessedDate" },
```

Export every template constant. Follow the `SCREAMING_SNAKE_CASE` naming convention since these are hard-coded configuration constants.

- [ ] **Step 4: Run tests to verify they all pass**

Run: `pnpm vitest run test/extensions/ieee.test.ts -t "matches original output"`
Expected: PASS (all 33)

- [ ] **Step 5: Commit**

```bash
git add src/extensions/ieee/segment-templates.ts test/extensions/ieee.test.ts
git commit -m "feat(ieee): port all 33 reference types to segment templates"
```

---

### Task 4: Switch formatting.ts to use config-driven dispatch

**Files:**

- Modify: `src/extensions/ieee/formatting.ts`
- Modify: `src/extensions/ieee/segment-builder.ts` (if formatDate/IEEE_MONTHS need deduplication)

- [ ] **Step 1: Run all existing tests to establish baseline**

Run: `pnpm vitest run test/extensions/ieee.test.ts`
Expected: PASS (all existing tests)

- [ ] **Step 2: Replace BUILDERS map with config-driven dispatch**

In `src/extensions/ieee/formatting.ts`:

1. Remove the original `formatSingleAuthor`, `formatNamesInCitation`, `sep`, `IEEE_MONTHS`, `formatDate` implementations and all 33 `*Segments` functions and the `BUILDERS` map and the `TSegmentBuilder` type alias.

2. Replace the imports and top section with:

```typescript
// IEEE Citation Formatting — structured segment output
// Follows IEEE Reference Guide patterns for all 33 reference types.

import type { TIEEEReference, TReferenceType } from "./references.js"
import { buildSegments } from "./segment-builder.js"
import * as templates from "./segment-templates.js"

// Re-export shared helpers for backward compatibility (canonical home is segment-builder.ts)
export {
    formatSingleAuthor,
    formatNamesInCitation,
    formatDate,
    IEEE_MONTHS,
} from "./segment-builder.js"
```

3. Keep the `TCitationSegment` and `TCitationFormatResult` type exports unchanged.

4. Replace the builder dispatch with config-driven dispatch:

```typescript
const TEMPLATES: Record<TReferenceType, templates.TSegmentTemplate> = {
    Book: templates.BOOK_TEMPLATE,
    Website: templates.WEBSITE_TEMPLATE,
    BookChapter: templates.BOOK_CHAPTER_TEMPLATE,
    Handbook: templates.HANDBOOK_TEMPLATE,
    TechnicalReport: templates.TECHNICAL_REPORT_TEMPLATE,
    Standard: templates.STANDARD_TEMPLATE,
    Thesis: templates.THESIS_TEMPLATE,
    Patent: templates.PATENT_TEMPLATE,
    Dictionary: templates.DICTIONARY_TEMPLATE,
    Encyclopedia: templates.ENCYCLOPEDIA_TEMPLATE,
    JournalArticle: templates.JOURNAL_ARTICLE_TEMPLATE,
    MagazineArticle: templates.MAGAZINE_ARTICLE_TEMPLATE,
    NewspaperArticle: templates.NEWSPAPER_ARTICLE_TEMPLATE,
    ConferencePaper: templates.CONFERENCE_PAPER_TEMPLATE,
    ConferenceProceedings: templates.CONFERENCE_PROCEEDINGS_TEMPLATE,
    Dataset: templates.DATASET_TEMPLATE,
    Software: templates.SOFTWARE_TEMPLATE,
    OnlineDocument: templates.ONLINE_DOCUMENT_TEMPLATE,
    Blog: templates.BLOG_TEMPLATE,
    SocialMedia: templates.SOCIAL_MEDIA_TEMPLATE,
    Preprint: templates.PREPRINT_TEMPLATE,
    Video: templates.VIDEO_TEMPLATE,
    Podcast: templates.PODCAST_TEMPLATE,
    Course: templates.COURSE_TEMPLATE,
    Presentation: templates.PRESENTATION_TEMPLATE,
    Interview: templates.INTERVIEW_TEMPLATE,
    PersonalCommunication: templates.PERSONAL_COMMUNICATION_TEMPLATE,
    Email: templates.EMAIL_TEMPLATE,
    Law: templates.LAW_TEMPLATE,
    CourtCase: templates.COURT_CASE_TEMPLATE,
    GovernmentPublication: templates.GOVERNMENT_PUBLICATION_TEMPLATE,
    Datasheet: templates.DATASHEET_TEMPLATE,
    ProductManual: templates.PRODUCT_MANUAL_TEMPLATE,
}

/**
 * Build a structured citation for any IEEE reference type.
 * Returns an array of typed segments that consumers can render into
 * plain text, HTML, or any other format.
 */
export function formatCitationParts(
    ref: TIEEEReference
): TCitationFormatResult {
    const template = TEMPLATES[ref.type]
    return {
        type: ref.type,
        segments: buildSegments(
            ref as unknown as Record<string, unknown>,
            template
        ),
    }
}
```

**Import chain (no runtime cycles):** `segment-templates.ts` → type-only imports from `formatting.ts` and `references.ts`. `segment-builder.ts` → type-only imports from `formatting.ts`, `segment-templates.ts`, and `references.ts`. `formatting.ts` → runtime imports from `segment-builder.ts` and `segment-templates.ts`; re-exports shared helpers. All `import type` statements are erased at runtime — no circular dependency.

- [ ] **Step 3: Run all existing tests**

Run: `pnpm vitest run test/extensions/ieee.test.ts`
Expected: PASS (all tests, including original `formatCitationParts` tests)

- [ ] **Step 4: Run full check suite**

Run: `pnpm run check`
Expected: PASS (typecheck, lint, test, build)

- [ ] **Step 5: Commit**

```bash
git add src/extensions/ieee/formatting.ts src/extensions/ieee/segment-builder.ts
git commit -m "refactor(ieee): replace 33 segment builders with config-driven dispatch"
```

---

### Task 5: Clean up parity tests

**Files:**

- Modify: `test/extensions/ieee.test.ts`

- [ ] **Step 1: Remove parity tests that compared config output vs. original**

The parity tests from Task 3 compared `buildSegments(ref, TEMPLATE)` against `formatCitationParts(ref).segments`. Now that `formatCitationParts` uses `buildSegments` internally, these tests are tautological. Remove the `buildSegments` parity describe block. Keep the `BOOK_TEMPLATE is a non-empty array` test and the original `formatCitationParts` tests — those test the actual behavior.

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run test/extensions/ieee.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/extensions/ieee.test.ts
git commit -m "chore(ieee): remove tautological parity tests after switchover"
```

---

### Task 6: Verify line count reduction

- [ ] **Step 1: Check line counts**

Run: `wc -l src/extensions/ieee/formatting.ts src/extensions/ieee/segment-builder.ts src/extensions/ieee/segment-templates.ts`

Expected: formatting.ts should be ~100-120 lines (down from 1168). segment-builder.ts ~70-80 lines. segment-templates.ts ~500-600 lines. Total ~700-800 (down from 1168 in a single file), with much better maintainability.

- [ ] **Step 2: Run full check**

Run: `pnpm run check`
Expected: PASS

- [ ] **Step 3: Commit (if any final adjustments needed)**

---

## Known IEEE compliance deviations (pre-existing, preserved by this refactoring)

This refactoring produces byte-identical output to the original 33 builder functions. The following deviations from the IEEE Reference Style Guide exist in the original code and are intentionally preserved here. They are candidates for a separate follow-up:

1. **Trailing period after URL** — `productManualSegments` unconditionally appends `"."` even when the output ends with a URL. IEEE rule: "References ending with a URL have no trailing period."
2. **Course format** — The existing format (`instructor, title, institution, courseCode, term, year.`) does not match IEEE's course format (`Name of University. (Year). Title of course. [Online]. Available: URL` for online courses).
3. **Video `[Online Video]` tag** — The existing code uses `[Online]. Available:` instead of IEEE's `[Online Video]. Available:` tag for online video references.
4. **Website `[Online.]` tag** — IEEE website format uses `[Online.]` (period inside bracket), but the code uses `[Online]. Available:` (period outside) for all types including websites.
5. **Social media** — IEEE treats social media as website references. The existing code uses a much simpler format that omits the post text as a title.
6. **Thesis degree suffix** — The code always appends `" thesis"` to the degree field, so `"Ph.D."` becomes `"Ph.D. thesis"`. IEEE distinguishes between `"M.S. thesis"`, `"Ph.D. dissertation"`, and `"Ph.D. thesis"` — the degree field value determines the correct suffix.
