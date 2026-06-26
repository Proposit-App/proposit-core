// Barrel export for the conversation primitive module.
//
// Subpath: @proposit/proposit-core/conversation

export { executeTurn } from "./turn.js"
export type { TTurnInput, TTurnResult, TExecuteTurnDeps } from "./turn.js"

export { createConversation } from "./conversation.js"
export type { TConversation } from "./conversation.js"
export { ConversationClosedError } from "./conversation.js"

export type { TMultiTurnInput, TMultiTurnOutput } from "./contract.js"
export type { TResponseId } from "../llm/types.js"
