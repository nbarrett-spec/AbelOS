/**
 * Allocation module — the write-side source of truth for the
 * `InventoryAllocation` ledger.
 *
 * Contract with sibling modules (Material Calendar, ATP shortage forecast,
 * PM dashboard, T-7 checkpoint): they READ from `InventoryAllocation`. The
 * functions in this directory are the only place that WRITES to it.
 *
 * Status machine (the `status` column):
 *   RESERVED    — material committed to job, still in stock
 *   BACKORDERED — material owed to job, not in stock today
 *   PICKED      — picked off shelf, staged but not consumed
 *   CONSUMED    — installed / shipped / gone (reduces onHand)
 *   RELEASED    — job canceled / completed; row is historic
 *
 * Every write is followed by `recompute_inventory_committed(productId)` so
 * InventoryItem.committed / available stay in sync without a nightly sweep
 * (the nightly sweep still runs as a drift catcher).
 */

export * from './allocate'
export * from './release'
export * from './reserve'
export * from './pick'
export * from './consume'
export type { AllocateResult, AllocatedRow, ShortfallRow } from './types'
