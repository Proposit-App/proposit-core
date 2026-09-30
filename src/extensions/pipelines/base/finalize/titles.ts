import { shortenToLength } from "../../../../lib/utils/strings.js"
import type {
    TClaimCanonicalizationOutput,
    TCompiledPremise,
    TConclusionSelectionOutput,
    TInferenceRelation,
} from "../stages/schemas.js"

// **Premise titles read as prose, not formulas.** A premise title is
// never a serialization of the compiled symbolic `formula`; it is
// human-facing prose. The machine `formula` field is left untouched.
//
// **An authored title is preferred; composition is the fallback.** A
// premise title names the *inferential move* — what the step does in the
// argument — which only the model that read the source can say. So the
// structured output that produces a premise carries a `title`: the
// relation for a relation-derived premise, the conclusion-selection slot
// for the conclusion premise. When a usable one is present it is used
// verbatim (trimmed, and clamped to `AUTHORED_PREMISE_TITLE_CAP`).
//
// When it is absent, empty, or whitespace-only, the title is composed
// from the LLM-authored claim titles that back the premise's variables —
// mirroring how `buildArgumentTitle` reuses the conclusion claim's
// title. Composition is lossless but redundant: consumers render the
// premise's expression tree directly beneath the header, so it restates
// the rows below it. It is the floor, not the goal — and it means a
// missing title never fails a run.
//
// **The conclusion title is guarded.** The model authors one conclusion
// title, for `conclusionCandidates[0]`, but the resolved
// `conclusionMiniId` is the first candidate that is a known normal claim
// — and may instead come from the relation-graph fallback. Using the
// authored title when a *different* claim won would label the conclusion
// premise with a description of some other claim, which is worse than a
// redundant-but-true composed title. So it is used only when the
// resolved id is strictly `conclusionCandidates[0]`.
//
// **Structure-walk, not string-substitution.** Each relation-derived
// premise (support / joint-support / derivation) is composed by walking
// the *relation* that produced it (`antecedents` → `consequent`, both claim
// miniIds, with the relation `type` giving the connective shape) rather
// than by parsing the `formula` string. The relation is the semantic
// origin of the premise and carries the logical structure directly, so
// composing from it avoids any fragile re-parse of the symbol string.
// The conclusion premise has no source relation (it is synthesized from
// a bare symbol), so it is composed by resolving that symbol to its
// claim title.
//
// **No role prefix.** The display layer renders a separate "Conclusion"
// chip, so a textual `Conclusion:` / `Support:` prefix on the prose is
// redundant; titles are pure prose.
//
// **No truncation of composed titles.** The pre-prose implementation
// capped titles at 50 chars, which mangled multi-claim premises
// mid-symbol. Composed prose titles are emitted in full. Only an
// authored title is clamped, and generously: it is a short phrase by
// instruction, so the cap is a backstop against a runaway generation,
// not a second opinion on the model's phrasing.

/**
 * Length cap for an authored premise title. The prompts ask for under
 * 60 characters; this leaves slack above that so a slightly long but
 * well-formed phrase survives intact.
 */
const AUTHORED_PREMISE_TITLE_CAP = 80

/**
 * Normalize a model-authored title: trim it, treat empty or
 * whitespace-only as absent, and clamp an over-long one rather than
 * rejecting it. A title that names a claim by its internal id ("Inference
 * from c1") is absent too, since a reader never sees those ids. Returns
 * `undefined` when there is nothing usable, which is the caller's cue to
 * compose a title instead.
 *
 * Clamping lives here rather than in the schema because the model is
 * only told the length in prose and can overshoot it: making the length a
 * validation gate would let one long string discard a completed
 * pipeline run. The value is typed `unknown` because a caller-composed
 * pipeline can populate these slots itself, with no schema check between
 * it and this read.
 */
/** A canonical claim id (`c1`, `c2`, ...) standing as a word of its own. */
const CLAIM_ID_PATTERN = /\bc\d+\b/

function resolveAuthoredTitle(authored: unknown): string | undefined {
    if (typeof authored !== "string") return undefined
    const trimmed = authored.trim()
    if (trimmed.length === 0) return undefined
    if (CLAIM_ID_PATTERN.test(trimmed)) return undefined
    return shortenToLength(trimmed, AUTHORED_PREMISE_TITLE_CAP)
}

/**
 * The form two titles are compared in when checking for duplicates:
 * surrounding space and letter case are ignored, so "Tacit consent" and
 * " tacit consent" count as the same title.
 */
export function titleKey(title: string): string {
    return title.trim().toLowerCase()
}

/**
 * The conclusion title the model authored, when it is safe to use.
 *
 * The model authors exactly one, describing `conclusionCandidates[0]`.
 * The resolved `conclusionMiniId` is the first candidate that is a known
 * normal claim, or a relation-graph fallback — so it is not necessarily
 * that first candidate. Anything but a strict match falls through to
 * composition, which can be redundant but is never about the wrong
 * claim.
 */
export function resolveAuthoredConclusionTitle(
    conclusion: TConclusionSelectionOutput | undefined,
    relations: readonly TInferenceRelation[]
): string | undefined {
    if (conclusion === undefined) return undefined
    const { conclusionMiniId, conclusionCandidates } = conclusion
    if (conclusionMiniId === null) return undefined
    if (conclusionMiniId !== conclusionCandidates[0]) return undefined
    const authored = resolveAuthoredTitle(conclusion.title)
    if (authored === undefined) return undefined
    // The model can name the concluding step with the phrase it already
    // gave the step that reaches the conclusion. Two premises under one
    // title read as a duplicate, so that title is left to the step and the
    // conclusion falls back to its composed title.
    const key = titleKey(authored)
    const taken = relations.some((r) => {
        const title = resolveAuthoredTitle(r.title)
        return title !== undefined && titleKey(title) === key
    })
    return taken ? undefined : authored
}

export type TTitleComposerMaps = {
    /** claim miniId → display title (LLM `title`, else `axiom`). */
    claimTitleByMiniId: Map<string, string>
    /** assigned variable symbol → claim miniId. */
    claimMiniIdBySymbol: Map<string, string>
    /** claim miniId → assigned variable symbol (defensive fallback). */
    symbolByClaimMiniId: Map<string, string>
    /** relationId → the relation that produced a premise. */
    relationById: Map<string, TInferenceRelation>
}

/**
 * Resolve a claim miniId to its quoted display title, falling back to
 * the claim's assigned variable symbol (quoted) when no title is
 * authored — and to the bare claim miniId only if even the symbol is
 * unresolvable. (Used for the source/target slots of relation-derived
 * premises.) Never throws.
 */
function quotedClaimTitle(
    claimMiniId: string,
    maps: TTitleComposerMaps
): string {
    const title =
        maps.claimTitleByMiniId.get(claimMiniId) ??
        maps.symbolByClaimMiniId.get(claimMiniId) ??
        claimMiniId
    return `"${title}"`
}

export function buildPremiseTitle(
    premise: TCompiledPremise,
    maps: TTitleComposerMaps,
    /** Guard-resolved authored conclusion title, if one is usable. */
    authoredConclusionTitle: string | undefined,
    /** Title keys (`titleKey`) already given to earlier premises. */
    taken: ReadonlySet<string>
): string {
    if (premise.roleHint === "conclusion") {
        if (authoredConclusionTitle !== undefined) {
            return authoredConclusionTitle
        }
        // No usable authored title: the conclusion premise is a bare
        // symbol, so compose its prose title from the conclusion claim's
        // title (unquoted — the whole title is the proposition, not an
        // embedded clause). Fall back to the symbol when the claim title
        // is unresolvable.
        const symbol = premise.formula.trim()
        const claimMiniId = maps.claimMiniIdBySymbol.get(symbol)
        return (
            (claimMiniId !== undefined
                ? maps.claimTitleByMiniId.get(claimMiniId)
                : undefined) ?? symbol
        )
    }

    // Relation-derived premise: prefer the title the relation carries;
    // otherwise compose `If <antecedent> then <consequent>` by walking
    // the source relation. The antecedent is the `and`-joined source
    // claim titles; the consequent is the target claim title.
    const relation =
        premise.sourceRelationId !== null
            ? maps.relationById.get(premise.sourceRelationId)
            : undefined
    // A title an earlier step already carries is left to that step; this
    // one is composed instead, as the conclusion is.
    const authored = resolveAuthoredTitle(relation?.title)
    if (authored !== undefined && !taken.has(titleKey(authored))) {
        return authored
    }
    if (relation === undefined) {
        // No resolvable source relation — fall back to the raw formula
        // so the title is never empty. (Should not occur in practice:
        // every non-conclusion premise carries a sourceRelationId that
        // resolves; the bare-formula fallback is purely defensive.)
        return premise.formula
    }

    const antecedent = relation.antecedents
        .map((src) => quotedClaimTitle(src, maps))
        .join(" and ")
    const consequent = quotedClaimTitle(relation.consequent, maps)
    return `If ${antecedent} then ${consequent}`
}

export function buildClaimTitleByMiniId(
    canonicalClaims: TClaimCanonicalizationOutput["canonicalClaims"]
): Map<string, string> {
    const m = new Map<string, string>()
    for (const claim of canonicalClaims) {
        const record = claim as Record<string, unknown>
        const title =
            (record.title as string | undefined) ??
            (record.axiom as string | undefined)
        if (title !== undefined) {
            m.set(claim.miniId, title)
        }
    }
    return m
}

export function buildArgumentTitle(
    canonicalClaims: TClaimCanonicalizationOutput["canonicalClaims"],
    conclusionMiniId: string | null
): string {
    const cap = 50
    const conclusionClaim = canonicalClaims.find(
        (c) => c.miniId === conclusionMiniId
    ) as Record<string, unknown> | undefined
    const candidateTitle =
        (conclusionClaim?.title as string | undefined) ??
        (conclusionClaim?.axiom as string | undefined) ??
        "Argument"
    return shortenToLength(candidateTitle, cap)
}
