// Changeset utilities, split by job: combining changesets and recording
// per-entity changes live in changeset-merge.ts; ordering a changeset into
// foreign-key-safe persistence operations lives in changeset-order.ts. This
// module re-exports both so existing import paths keep working.
export {
    composeChangesets,
    entityChangesFrom,
    mergeChangesets,
    recordEntityChange,
    withCurrentEntries,
    type TEntityChangeState,
} from "./changeset-merge.js"
export { orderChangeset, type TOrderedOperation } from "./changeset-order.js"
