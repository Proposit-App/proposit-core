import type { TCoreChecksumConfig } from "./checksum.js"
import type { TCorePositionConfig } from "../utils/position.js"
import type { TGrammarConfig } from "./grammar.js"

/** Options for `forkArgument`. */
export interface TForkArgumentOptions {
    /** ID generator for new entities. Defaults to `crypto.randomUUID`. */
    generateId?: () => string
    /** Checksum config override. If omitted, copied from source engine. */
    checksumConfig?: TCoreChecksumConfig
    /** Position config override. If omitted, copied from source engine. */
    positionConfig?: TCorePositionConfig
    /** Grammar config override. If omitted, copied from source engine. */
    grammarConfig?: TGrammarConfig
}

/** Maps original entity IDs to their forked counterparts. */
export interface TForkRemapTable {
    argumentId: { from: string; to: string }
    premises: Map<string, string>
    expressions: Map<string, string>
    variables: Map<string, string>
}
