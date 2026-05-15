import type { TCoreChecksumConfig } from "./checksum.js"
import type { TCorePositionConfig } from "../utils/position.js"

/** Options for `forkArgument`. */
export interface TForkArgumentOptions {
    /** ID generator for new entities. Defaults to `crypto.randomUUID`. */
    generateId?: () => string
    /** Checksum config override. If omitted, copied from source engine. */
    checksumConfig?: TCoreChecksumConfig
    /** Position config override. If omitted, copied from source engine. */
    positionConfig?: TCorePositionConfig
    /**
     * Behavior override for the forked engine. If omitted, the forked
     * engine inherits the source engine's current `behavior` setting (the
     * principle of least surprise — a permissive source forks into a
     * permissive copy, an assistive source forks into an assistive copy).
     * Supplying this option overrides the inheritance — useful for
     * callers that want, for example, to fork a permissive editing state
     * into an assistive "publish-ready" copy.
     *
     * @since 1.0.0 (Phase D5)
     */
    behavior?: "assistive" | "permissive"
}

/** Maps original entity IDs to their forked counterparts. */
export interface TForkRemapTable {
    argumentId: { from: string; to: string }
    premises: Map<string, string>
    expressions: Map<string, string>
    variables: Map<string, string>
}
