// Conversation contract types — thin schema composition for multi-turn
// exchanges. Consumed by a consuming application's server adapter and
// any future interactive consumer.
//
// These are TypeBox-style shape descriptions, not class hierarchies.
// The types live in core because consumers depend on core, never the
// reverse.

import type { TResponseId } from "../llm/types.js"

/**
 * Extends an input shape `I` with optional `previousResponseId` so a
 * consumer can carry the upstream response chain alongside its payload.
 */
export type TMultiTurnInput<I> = I & { previousResponseId?: TResponseId }

/**
 * Extends an output shape `O` with a `responseId` field so the consumer
 * can record the provider response id for the next turn's chain.
 */
export type TMultiTurnOutput<O> = O & { responseId: TResponseId | null }
