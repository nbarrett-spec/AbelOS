// A-BIZ-9 — Cost-change detector for the price-review queue.
//
// When a vendor cost moves materially (>2% by default, configurable via
// PRICE_CHANGE_THRESHOLD_PCT), we drop a PENDING row into PriceChangeRequest
// with a suggested basePrice that preserves the target margin. Sales lead
// reviews + approves before the catalog price actually changes.
//
// Hook this into every place Product.cost gets written:
//   - InFlow CSV import (src/app/api/ops/import-inflow/route.ts)
//   - Bulk PRICE_LIST import (src/app/api/ops/import/run/route.ts)
//   - Anywhere else cost flows in (Boise watcher, manual edit, etc.)
//
// Caller pattern: never block the original update on this. Wrap in a
// fire-and-forget `.catch(() => {})` or await with try/swallow so a queue
// failure doesn't poison the cost write.

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

const DEFAULT_THRESHOLD_PCT = 2 // 2%
const DEFAULT_TARGET_MARGIN = 0.30 // 30%
const FLOOR_MARGIN = 0.05 // never compute a suggestion at <5% margin

export type PriceChangeSource =
  | 'cost-change'
  | 'manual'
  | 'vendor-update'
  | 'inflow-import'
  | 'price-list-import'
  | 'boise-watcher'

interface MaybeCreateInput {
  productId: string
  oldCost: number
  newCost: number
  source?: PriceChangeSource
}

interface MaybeCreateResult {
  created: boolean
  reason?: string
  requestId?: string
  oldPrice?: number
  suggestedPrice?: number
  marginPct?: number
  costDeltaPct?: number
}

/** Read the configured threshold percent. Defaults to 2%. */
function readThresholdPct(): number {
  const raw = process.env.PRICE_CHANGE_THRESHOLD_PCT
  if (!raw) return DEFAULT_THRESHOLD_PCT
  const n = parseFloat(raw)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_THRESHOLD_PCT
  return n
}

/** Compute suggested price: newCost / (1 - targetMargin). */
export function computeSuggestedPrice(newCost: number, targetMargin: number): number {
  const m = Math.min(Math.max(targetMargin || DEFAULT_TARGET_MARGIN, FLOOR_MARGIN), 0.95)
  if (!Number.isFinite(newCost) || newCost <= 0) return 0
  const raw = newCost / (1 - m)
  // Round to nearest cent
  return Math.round(raw * 100) / 100
}

/**
 * Maybe create a PriceChangeRequest row.
 *
 * Returns `{ created: false, reason }` when:
 *   - cost change is below threshold
 *   - oldCost is zero/missing (no baseline → not actionable)
 *   - newCost is invalid
 *   - product not found
 *   - a duplicate PENDING request already exists for this product (dedupe)
 *
 * Returns `{ created: true, requestId, ... }` on insert.
 *
 * Never throws to the caller — logs and returns `{ created: false }` on error.
 */
export async function maybeCreatePriceChangeRequest(
  input: MaybeCreateInput
): Promise<MaybeCreateResult> {
  try {
    const { productId, oldCost, newCost, source = 'cost-change' } = input

    if (!productId) return { created: false, reason: 'missing-productId' }
    if (!Number.isFinite(newCost) || newCost <= 0) {
      return { created: false, reason: 'invalid-newCost' }
    }
    if (!Number.isFinite(oldCost) || oldCost <= 0) {
      // No prior cost → nothing to compare against. Treat as a first-fill,
      // not a change. Catalog/import flows can capture this via the regular
      // update path; a review queue entry would just be noise.
      return { created: false, reason: 'no-baseline-cost' }
    }

    // Sub-cent moves aren't material no matter the percent.
    if (Math.abs(newCost - oldCost) < 0.01) {
      return { created: false, reason: 'no-change' }
    }

    const thresholdPct = readThresholdPct()
    const costDeltaPct = ((newCost - oldCost) / oldCost) * 100

    if (Math.abs(costDeltaPct) < thresholdPct) {
      return {
        created: false,
        reason: `below-threshold(${thresholdPct}%)`,
        costDeltaPct,
      }
    }

    // Pull current price + margin floor. We need this both for the snapshot
    // (oldPrice) and for the suggestion.
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, basePrice: true, minMargin: true },
    })
    if (!product) {
      return { created: false, reason: 'product-not-found' }
    }

    const targetMargin =
      Number.isFinite(product.minMargin) && (product.minMargin || 0) > 0
        ? Number(product.minMargin)
        : DEFAULT_TARGET_MARGIN

    const suggestedPrice = computeSuggestedPrice(newCost, targetMargin)
    const marginPct =
      suggestedPrice > 0 ? ((suggestedPrice - newCost) / suggestedPrice) * 100 : 0

    // Dedupe: if a PENDING request already exists for this product with the
    // same newCost (within a cent), skip — the operator hasn't acted on the
    // last one yet. Replace it with a refresh would also be reasonable, but
    // we prefer not to silently mutate review queue rows.
    const existing = await prisma.priceChangeRequest.findFirst({
      where: {
        productId,
        status: 'PENDING',
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, newCost: true },
    })
    if (existing && Math.abs(existing.newCost - newCost) < 0.01) {
      return { created: false, reason: 'duplicate-pending', requestId: existing.id }
    }

    const created = await prisma.priceChangeRequest.create({
      data: {
        productId,
        oldCost,
        newCost,
        oldPrice: product.basePrice,
        suggestedPrice,
        marginPct,
        status: 'PENDING',
        triggerSource: source,
      },
    })

    return {
      created: true,
      requestId: created.id,
      oldPrice: product.basePrice,
      suggestedPrice,
      marginPct,
      costDeltaPct,
    }
  } catch (err) {
    // Never block the originating cost write. Log and move on.
    try {
      logger.error('price_change_detector_failed', err, {
        productId: input.productId,
        oldCost: input.oldCost,
        newCost: input.newCost,
        source: input.source,
      })
    } catch {}
    return { created: false, reason: 'error' }
  }
}
