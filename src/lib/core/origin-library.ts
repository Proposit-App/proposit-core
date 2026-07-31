import { Value } from "typebox/value"
import type {
    TCoreOriginDocument,
    TCoreOriginLink,
    TCoreOriginAnchor,
    TOriginAnchorTargetType,
} from "../schemata/origin.js"
import {
    CoreOriginDocumentSchema,
    CoreOriginLinkSchema,
    CoreOriginAnchorSchema,
} from "../schemata/origin.js"
import type { TCoreChecksumConfig } from "../types/checksum.js"
import { DEFAULT_CHECKSUM_CONFIG } from "../consts.js"
import { entityChecksum } from "./checksum.js"
import { sha256Hex } from "../utils/sha256.js"
import type { TCodePointIndex } from "../utils/origin-text.js"
import {
    normalizeOriginText,
    buildCodePointIndex,
    sliceByCodePointsIndexed,
} from "../utils/origin-text.js"
import type {
    TOriginLibraryManagement,
    TOriginLibrarySnapshot,
} from "./interfaces/library.interfaces.js"
import type {
    TInvariantValidationResult,
    TInvariantViolation,
} from "../types/validation.js"
import {
    ORIGIN_DOCUMENT_SCHEMA_INVALID,
    ORIGIN_LINK_SCHEMA_INVALID,
    ORIGIN_ANCHOR_SCHEMA_INVALID,
    ORIGIN_DOCUMENT_DUPLICATE_ID,
    ORIGIN_LINK_DUPLICATE_ID,
    ORIGIN_ANCHOR_DUPLICATE_ID,
    ORIGIN_DOCUMENT_REF_NOT_FOUND,
    ORIGIN_DOCUMENT_DIGEST_MISMATCH,
    ORIGIN_DOCUMENT_TEXT_NOT_NORMALIZED,
    ORIGIN_ANCHOR_SPAN_OUT_OF_RANGE,
    ORIGIN_ANCHOR_QUOTE_MISMATCH,
    ORIGIN_ANCHOR_LINK_NOT_FOUND,
    ORIGIN_DOCUMENT_NOT_FOUND,
    ORIGIN_LINK_NOT_FOUND,
    ORIGIN_ANCHOR_NOT_FOUND,
    ORIGIN_DOCUMENT_IN_USE,
} from "../types/validation.js"
import { InvariantViolationError } from "./invariant-violation-error.js"

function argumentKey(argumentId: string, argumentVersion: number): string {
    return `${argumentId}@${argumentVersion}`
}

function targetKey(
    targetType: TOriginAnchorTargetType,
    targetId: string
): string {
    return `${targetType}:${targetId}`
}

/**
 * Holds the source texts arguments were built from, their per-version
 * associations, and the spans of those texts individual argument parts derive
 * from.
 *
 * Documents are immutable: there is no update path, because every anchor is
 * an offset into a document's exact text. Correcting a source means replacing
 * the document, which invalidates its anchors by design.
 *
 * The text is opaque content. This class digests it, measures it, and slices
 * it by index; it never parses, renders, or interprets it.
 *
 * An anchor is only meaningful alongside a link: the link carries the stance.
 * `validate()` therefore requires every anchor's
 * `(argumentId, argumentVersion, documentId)` to have a matching link, which
 * fixes the persistence order for consumers — document, then link, then
 * anchors — and makes removing a link that still has anchors a violation.
 *
 * Like the claim-connection libraries, this one mints no identifiers —
 * callers supply them — and takes no argument lookup: an argument library is
 * constructed after this one, so cross-checking argument existence here would
 * invert the dependency order. What it does enforce is everything decidable
 * from its own contents, most importantly that an anchor's span slices out
 * the anchor's own quote.
 */
export class OriginLibrary<
    TDocument extends TCoreOriginDocument = TCoreOriginDocument,
    TLink extends TCoreOriginLink = TCoreOriginLink,
    TAnchor extends TCoreOriginAnchor = TCoreOriginAnchor,
> implements TOriginLibraryManagement<TDocument, TLink, TAnchor> {
    private documents: Map<string, TDocument>
    private links: Map<string, TLink>
    private anchors: Map<string, TAnchor>
    private linksByArgument: Map<string, Set<string>>
    private anchorsByArgument: Map<string, Set<string>>
    private anchorsByTarget: Map<string, Set<string>>
    /**
     * Documents whose stored text has been confirmed normalized and matching
     * its digest, keyed by id and pinned to the exact text that passed. A
     * document is immutable, so a body that has been checked once cannot
     * change — but keying on the text rather than the id alone is what stops a
     * tampered snapshot from inheriting a previous instance's verdict.
     */
    private verifiedDocumentBodies: Map<string, string>
    /** Code-point index per document, reused across that document's anchors. */
    private documentIndexes: Map<string, TCodePointIndex>
    /**
     * Violations present as of the last accepted state, so a mutation can be
     * judged on what it *introduced* rather than on whether everything is
     * clean afterwards. Carried between mutations rather than recomputed, so
     * this costs no extra `validate()` pass.
     */
    private knownViolationKeys: Set<string>
    private checksumConfig?: TCoreChecksumConfig

    constructor(options?: { checksumConfig?: TCoreChecksumConfig }) {
        this.documents = new Map()
        this.links = new Map()
        this.anchors = new Map()
        this.linksByArgument = new Map()
        this.anchorsByArgument = new Map()
        this.anchorsByTarget = new Map()
        this.verifiedDocumentBodies = new Map()
        this.documentIndexes = new Map()
        this.knownViolationKeys = new Set()
        this.checksumConfig = options?.checksumConfig
    }

    /** Stable identity for a violation, so two validation runs can be compared. */
    private static violationKey(violation: TInvariantViolation): string {
        return `${violation.code}|${violation.entityType}|${violation.entityId}`
    }

    private static addToIndex(
        index: Map<string, Set<string>>,
        key: string,
        id: string
    ): void {
        let bucket = index.get(key)
        if (!bucket) {
            bucket = new Set()
            index.set(key, bucket)
        }
        bucket.add(id)
    }

    private reindex(): void {
        this.linksByArgument = new Map()
        this.anchorsByArgument = new Map()
        this.anchorsByTarget = new Map()
        for (const link of this.links.values()) {
            OriginLibrary.addToIndex(
                this.linksByArgument,
                argumentKey(link.argumentId, link.argumentVersion),
                link.id
            )
        }
        for (const anchor of this.anchors.values()) {
            OriginLibrary.addToIndex(
                this.anchorsByArgument,
                argumentKey(anchor.argumentId, anchor.argumentVersion),
                anchor.id
            )
            OriginLibrary.addToIndex(
                this.anchorsByTarget,
                targetKey(anchor.targetType, anchor.targetId),
                anchor.id
            )
        }
    }

    private restoreFromSnapshot(
        snap: TOriginLibrarySnapshot<TDocument, TLink, TAnchor>
    ): void {
        this.documents = new Map(snap.documents.map((d) => [d.id, d]))
        this.links = new Map(snap.links.map((l) => [l.id, l]))
        this.anchors = new Map(snap.anchors.map((a) => [a.id, a]))
        for (const [id, text] of this.verifiedDocumentBodies) {
            if (this.documents.get(id)?.text !== text) {
                this.verifiedDocumentBodies.delete(id)
            }
        }
        for (const [id, index] of this.documentIndexes) {
            if (this.documents.get(id)?.text !== index.text) {
                this.documentIndexes.delete(id)
            }
        }
        this.reindex()
    }

    /**
     * Runs a mutation, then rolls back and throws if the mutation *introduced*
     * a violation.
     *
     * Introduced, not "left the library inconsistent". Demanding a clean
     * library after every mutation makes an already-inconsistent one
     * unrepairable: two anchors that both violate the same invariant each keep
     * the other's removal from being accepted, and every mutation fails
     * forever. A library that validates has to stay repairable, and a snapshot
     * assembled by a consumer — or written by an older build — can arrive
     * inconsistent through no fault of the mutation being attempted.
     *
     * One rule covers both directions: an `addAnchor` with no link introduces a
     * violation and is still refused on a broken library as on a clean one, and
     * a `removeLink` that orphans existing anchors introduces theirs.
     *
     * ponytail: validating the whole library after every mutation is O(n²) in
     * anchor count across a bulk import — each of n `addAnchor` calls re-checks
     * the n anchors already present. Each check is one short slice comparison
     * against a cached index, so a few thousand anchors is still milliseconds;
     * scope the validation to the entity that changed if a caller ever needs
     * tens of thousands. The document-body checks, which scaled with document
     * *size* rather than count, are already skipped once verified.
     */
    private withValidation<T>(fn: () => T): T {
        const snap = this.snapshot()
        const knownBefore = this.knownViolationKeys
        try {
            const result = fn()
            const violations = this.validate().violations
            const introduced = violations.filter(
                (v) => !knownBefore.has(OriginLibrary.violationKey(v))
            )
            if (introduced.length > 0) {
                this.restoreFromSnapshot(snap)
                this.knownViolationKeys = knownBefore
                throw new InvariantViolationError(introduced)
            }
            this.knownViolationKeys = new Set(
                violations.map((v) => OriginLibrary.violationKey(v))
            )
            return result
        } catch (e) {
            if (!(e instanceof InvariantViolationError)) {
                this.restoreFromSnapshot(snap)
                this.knownViolationKeys = knownBefore
            }
            throw e
        }
    }

    /**
     * Creates a document from raw text. The text is normalized and digested
     * here rather than by the caller, so every document in the library shares
     * one coordinate system and one identity rule.
     */
    public addDocument(
        document: Omit<TDocument, "checksum" | "digest">
    ): TDocument {
        return this.withValidation(() => {
            if (this.documents.has(document.id)) {
                throw new InvariantViolationError([
                    {
                        code: ORIGIN_DOCUMENT_DUPLICATE_ID,
                        message: `${ORIGIN_DOCUMENT_DUPLICATE_ID}: origin document with id ${document.id} already exists`,
                        entityType: "originDocument",
                        entityId: document.id,
                    },
                ])
            }
            const text = normalizeOriginText(document.text)
            const full = {
                ...document,
                text,
                digest: sha256Hex(text),
                checksum: "",
            } as TDocument
            full.checksum = entityChecksum(
                full as unknown as Record<string, unknown>,
                this.fieldsFor("originDocumentFields")
            )
            this.documents.set(full.id, full)
            // Recording the body as verified is what lets later mutations skip
            // re-scanning it, but seeding unconditionally would disable
            // ORIGIN_DOCUMENT_TEXT_NOT_NORMALIZED on the very pass meant to
            // check this document — and that check is what caught the
            // normalizer not being idempotent. One extra normalize per
            // document, once, rather than per mutation. The digest half needs
            // no check: it was computed from this exact string.
            if (normalizeOriginText(text) === text) {
                this.verifiedDocumentBodies.set(full.id, text)
            }
            return full
        })
    }

    public addLink(link: Omit<TLink, "checksum">): TLink {
        return this.withValidation(() => {
            if (this.links.has(link.id)) {
                throw new InvariantViolationError([
                    {
                        code: ORIGIN_LINK_DUPLICATE_ID,
                        message: `${ORIGIN_LINK_DUPLICATE_ID}: origin link with id ${link.id} already exists`,
                        entityType: "originLink",
                        entityId: link.id,
                    },
                ])
            }
            const full = { ...link, checksum: "" } as TLink
            full.checksum = entityChecksum(
                full as unknown as Record<string, unknown>,
                this.fieldsFor("originLinkFields")
            )
            this.links.set(full.id, full)
            OriginLibrary.addToIndex(
                this.linksByArgument,
                argumentKey(full.argumentId, full.argumentVersion),
                full.id
            )
            return full
        })
    }

    public addAnchor(anchor: Omit<TAnchor, "checksum">): TAnchor {
        return this.withValidation(() => {
            if (this.anchors.has(anchor.id)) {
                throw new InvariantViolationError([
                    {
                        code: ORIGIN_ANCHOR_DUPLICATE_ID,
                        message: `${ORIGIN_ANCHOR_DUPLICATE_ID}: origin anchor with id ${anchor.id} already exists`,
                        entityType: "originAnchor",
                        entityId: anchor.id,
                    },
                ])
            }
            const full = { ...anchor, checksum: "" } as TAnchor
            full.checksum = entityChecksum(
                full as unknown as Record<string, unknown>,
                this.fieldsFor("originAnchorFields")
            )
            this.anchors.set(full.id, full)
            OriginLibrary.addToIndex(
                this.anchorsByArgument,
                argumentKey(full.argumentId, full.argumentVersion),
                full.id
            )
            OriginLibrary.addToIndex(
                this.anchorsByTarget,
                targetKey(full.targetType, full.targetId),
                full.id
            )
            return full
        })
    }

    /**
     * Removes a document. Refuses while a link or an anchor still references
     * it — dropping it silently would leave dangling references that only
     * `validate()` would notice, and only later.
     */
    public removeDocument(id: string): TDocument {
        return this.withValidation(() => {
            const document = this.documents.get(id)
            if (!document) {
                throw new InvariantViolationError([
                    {
                        code: ORIGIN_DOCUMENT_NOT_FOUND,
                        message: `${ORIGIN_DOCUMENT_NOT_FOUND}: origin document with id "${id}" not found`,
                        entityType: "originDocument",
                        entityId: id,
                    },
                ])
            }
            const referenceCount =
                this.getAllLinks().filter((l) => l.documentId === id).length +
                this.getAllAnchors().filter((a) => a.documentId === id).length
            if (referenceCount > 0) {
                throw new InvariantViolationError([
                    {
                        code: ORIGIN_DOCUMENT_IN_USE,
                        message: `${ORIGIN_DOCUMENT_IN_USE}: origin document "${id}" is still referenced by ${referenceCount} link(s) or anchor(s)`,
                        entityType: "originDocument",
                        entityId: id,
                    },
                ])
            }
            this.documents.delete(id)
            this.verifiedDocumentBodies.delete(id)
            this.documentIndexes.delete(id)
            return document
        })
    }

    public removeLink(id: string): TLink {
        return this.withValidation(() => {
            const link = this.links.get(id)
            if (!link) {
                throw new InvariantViolationError([
                    {
                        code: ORIGIN_LINK_NOT_FOUND,
                        message: `${ORIGIN_LINK_NOT_FOUND}: origin link with id "${id}" not found`,
                        entityType: "originLink",
                        entityId: id,
                    },
                ])
            }
            this.links.delete(id)
            this.linksByArgument
                .get(argumentKey(link.argumentId, link.argumentVersion))
                ?.delete(id)
            return link
        })
    }

    public removeAnchor(id: string): TAnchor {
        return this.withValidation(() => {
            const anchor = this.anchors.get(id)
            if (!anchor) {
                throw new InvariantViolationError([
                    {
                        code: ORIGIN_ANCHOR_NOT_FOUND,
                        message: `${ORIGIN_ANCHOR_NOT_FOUND}: origin anchor with id "${id}" not found`,
                        entityType: "originAnchor",
                        entityId: id,
                    },
                ])
            }
            this.anchors.delete(id)
            this.anchorsByArgument
                .get(argumentKey(anchor.argumentId, anchor.argumentVersion))
                ?.delete(id)
            this.anchorsByTarget
                .get(targetKey(anchor.targetType, anchor.targetId))
                ?.delete(id)
            return anchor
        })
    }

    public getDocument(id: string): TDocument | undefined {
        return this.documents.get(id)
    }

    public getLink(id: string): TLink | undefined {
        return this.links.get(id)
    }

    public getAnchor(id: string): TAnchor | undefined {
        return this.anchors.get(id)
    }

    public getLinksForArgument(
        argumentId: string,
        argumentVersion: number
    ): TLink[] {
        const ids = this.linksByArgument.get(
            argumentKey(argumentId, argumentVersion)
        )
        if (!ids) return []
        return Array.from(ids)
            .map((id) => this.links.get(id))
            .filter((l): l is TLink => l !== undefined)
    }

    public getAnchorsForArgument(
        argumentId: string,
        argumentVersion: number
    ): TAnchor[] {
        const ids = this.anchorsByArgument.get(
            argumentKey(argumentId, argumentVersion)
        )
        if (!ids) return []
        return Array.from(ids)
            .map((id) => this.anchors.get(id))
            .filter((a): a is TAnchor => a !== undefined)
    }

    public getAnchorsForTarget(
        targetType: TOriginAnchorTargetType,
        targetId: string
    ): TAnchor[] {
        const ids = this.anchorsByTarget.get(targetKey(targetType, targetId))
        if (!ids) return []
        return Array.from(ids)
            .map((id) => this.anchors.get(id))
            .filter((a): a is TAnchor => a !== undefined)
    }

    public getAllDocuments(): TDocument[] {
        return Array.from(this.documents.values())
    }

    public getAllLinks(): TLink[] {
        return Array.from(this.links.values())
    }

    public getAllAnchors(): TAnchor[] {
        return Array.from(this.anchors.values())
    }

    public snapshot(): TOriginLibrarySnapshot<TDocument, TLink, TAnchor> {
        return {
            documents: this.getAllDocuments(),
            links: this.getAllLinks(),
            anchors: this.getAllAnchors(),
        }
    }

    /** Restores an origin library from a snapshot, rebuilding its indexes. */
    public static fromSnapshot<
        TDocument extends TCoreOriginDocument = TCoreOriginDocument,
        TLink extends TCoreOriginLink = TCoreOriginLink,
        TAnchor extends TCoreOriginAnchor = TCoreOriginAnchor,
    >(
        snapshot: TOriginLibrarySnapshot<TDocument, TLink, TAnchor>,
        options?: { checksumConfig?: TCoreChecksumConfig }
    ): OriginLibrary<TDocument, TLink, TAnchor> {
        const lib = new OriginLibrary<TDocument, TLink, TAnchor>(options)
        lib.restoreFromSnapshot(snapshot)
        // A loaded snapshot may already be inconsistent — this constructor
        // deliberately does not refuse it. Recording what is already wrong is
        // what lets a caller repair it one mutation at a time.
        lib.knownViolationKeys = new Set(
            lib.validate().violations.map((v) => OriginLibrary.violationKey(v))
        )
        return lib
    }

    public validate(): TInvariantValidationResult {
        const violations: TInvariantViolation[] = []

        for (const [id, document] of this.documents) {
            if (!Value.Check(CoreOriginDocumentSchema, document)) {
                violations.push({
                    code: ORIGIN_DOCUMENT_SCHEMA_INVALID,
                    message: `${ORIGIN_DOCUMENT_SCHEMA_INVALID}: origin document "${id}" does not conform to schema`,
                    entityType: "originDocument",
                    entityId: id,
                })
                continue
            }
            // Normalizing and digesting a document body is the only cost in
            // this method that scales with document *size*, and `validate()`
            // runs after every mutation. Documents are immutable, so a body
            // that has passed once cannot change; anything that could have
            // swapped it (fromSnapshot, a rollback) clears its entry first.
            if (this.verifiedDocumentBodies.get(id) === document.text) continue
            let bodyOk = true
            if (normalizeOriginText(document.text) !== document.text) {
                bodyOk = false
                violations.push({
                    code: ORIGIN_DOCUMENT_TEXT_NOT_NORMALIZED,
                    message: `${ORIGIN_DOCUMENT_TEXT_NOT_NORMALIZED}: origin document "${id}" holds text that is not in normalized form; every anchor offset into it is unsound`,
                    entityType: "originDocument",
                    entityId: id,
                })
            }
            if (sha256Hex(document.text) !== document.digest) {
                bodyOk = false
                violations.push({
                    code: ORIGIN_DOCUMENT_DIGEST_MISMATCH,
                    message: `${ORIGIN_DOCUMENT_DIGEST_MISMATCH}: origin document "${id}" carries a digest that does not match its text`,
                    entityType: "originDocument",
                    entityId: id,
                })
            }
            if (bodyOk) this.verifiedDocumentBodies.set(id, document.text)
        }

        for (const [id, link] of this.links) {
            if (!Value.Check(CoreOriginLinkSchema, link)) {
                violations.push({
                    code: ORIGIN_LINK_SCHEMA_INVALID,
                    message: `${ORIGIN_LINK_SCHEMA_INVALID}: origin link "${id}" does not conform to schema`,
                    entityType: "originLink",
                    entityId: id,
                })
                continue
            }
            if (!this.documents.has(link.documentId)) {
                violations.push({
                    code: ORIGIN_DOCUMENT_REF_NOT_FOUND,
                    message: `${ORIGIN_DOCUMENT_REF_NOT_FOUND}: origin link "${id}" references non-existent document "${link.documentId}"`,
                    entityType: "originLink",
                    entityId: id,
                })
            }
        }

        for (const [id, anchor] of this.anchors) {
            if (!Value.Check(CoreOriginAnchorSchema, anchor)) {
                violations.push({
                    code: ORIGIN_ANCHOR_SCHEMA_INVALID,
                    message: `${ORIGIN_ANCHOR_SCHEMA_INVALID}: origin anchor "${id}" does not conform to schema`,
                    entityType: "originAnchor",
                    entityId: id,
                })
                continue
            }
            const document = this.documents.get(anchor.documentId)
            if (!document) {
                violations.push({
                    code: ORIGIN_DOCUMENT_REF_NOT_FOUND,
                    message: `${ORIGIN_DOCUMENT_REF_NOT_FOUND}: origin anchor "${id}" references non-existent document "${anchor.documentId}"`,
                    entityType: "originAnchor",
                    entityId: id,
                })
                continue
            }
            // Built once per document and kept, for the same reason the body
            // checks are skipped: a document is immutable. The entry is keyed
            // to the exact text it was built from, not to the id alone, so
            // anything that ever puts a different body under a known id — a
            // restore, or a future replace — rebuilds instead of slicing
            // against the wrong string.
            let index = this.documentIndexes.get(document.id)
            if (index?.text !== document.text) {
                index = buildCodePointIndex(document.text)
                this.documentIndexes.set(document.id, index)
            }
            const documentLength = index.offsets.length - 1
            if (
                !Number.isInteger(anchor.startCodePoint) ||
                !Number.isInteger(anchor.endCodePoint) ||
                anchor.startCodePoint < 0 ||
                anchor.endCodePoint < anchor.startCodePoint ||
                anchor.endCodePoint > documentLength
            ) {
                violations.push({
                    code: ORIGIN_ANCHOR_SPAN_OUT_OF_RANGE,
                    message: `${ORIGIN_ANCHOR_SPAN_OUT_OF_RANGE}: origin anchor "${id}" spans [${anchor.startCodePoint}, ${anchor.endCodePoint}) of a document ${documentLength} code points long`,
                    entityType: "originAnchor",
                    entityId: id,
                })
                continue
            }
            const sliced = sliceByCodePointsIndexed(
                index,
                anchor.startCodePoint,
                anchor.endCodePoint
            )
            if (sliced !== anchor.exact) {
                violations.push({
                    code: ORIGIN_ANCHOR_QUOTE_MISMATCH,
                    message: `${ORIGIN_ANCHOR_QUOTE_MISMATCH}: origin anchor "${id}" spans text that is not its own quote — an anchor at an unverified offset`,
                    entityType: "originAnchor",
                    entityId: id,
                })
            }
            // The link carries the stance, and the stance is what decides
            // whether unanchored content means anything. An anchor whose
            // argument version is not linked to this document is provenance no
            // consumer can interpret, so it is a violation rather than a gap.
            const linked = this.getLinksForArgument(
                anchor.argumentId,
                anchor.argumentVersion
            ).some((l) => l.documentId === anchor.documentId)
            if (!linked) {
                violations.push({
                    code: ORIGIN_ANCHOR_LINK_NOT_FOUND,
                    message: `${ORIGIN_ANCHOR_LINK_NOT_FOUND}: origin anchor "${id}" targets ${anchor.argumentId}@${anchor.argumentVersion}, which has no link to document "${anchor.documentId}"`,
                    entityType: "originAnchor",
                    entityId: id,
                })
            }
        }

        return { ok: violations.length === 0, violations }
    }

    private fieldsFor(
        key: "originDocumentFields" | "originLinkFields" | "originAnchorFields"
    ): Set<string> {
        return this.checksumConfig?.[key] ?? DEFAULT_CHECKSUM_CONFIG[key]!
    }
}
