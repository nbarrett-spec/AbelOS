import { prisma } from '@/lib/prisma'

export interface ConsumeResult {
  jobId: string
  productId: string
  quantityRequested: number
  quantityConsumed: number
  reason?: string
}

/**
 * consume — flip PICKED → CONSUMED and decrement InventoryItem.onHand.
 *
 * This is the only function in the allocation module that touches onHand.
 * Consumed material is gone: it's been delivered, installed, or shipped.
 *
 * Safe to call repeatedly for the same (job, product) — the ON CONFLICT path
 * on pick.ts means a re-pick will create a fresh PICKED row only if there's
 * more to pick; calling consume again will hit "no_picked_row".
 */
export async function consume(
  jobId: string,
  productId: string,
  qty: number
): Promise<ConsumeResult> {
  const base: ConsumeResult = {
    jobId,
    productId,
    quantityRequested: qty,
    quantityConsumed: 0,
  }
  if (!jobId || !productId || qty <= 0) {
    return { ...base, reason: 'invalid_args' }
  }

  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id", "quantity"
       FROM "InventoryAllocation"
       WHERE "jobId" = $1 AND "productId" = $2 AND "status" = 'PICKED'
       LIMIT 1`,
    jobId, productId
  )
  if (rows.length === 0) {
    return { ...base, reason: 'no_picked_row' }
  }
  const row = rows[0]
  const pickedQty = Number(row.quantity) || 0
  const consumeQty = Math.min(qty, pickedQty)
  const remaining = pickedQty - consumeQty

  if (remaining === 0) {
    // Whole row → CONSUMED
    await prisma.$executeRawUnsafe(
      `UPDATE "InventoryAllocation"
         SET "status" = 'CONSUMED',
             "updatedAt" = NOW(),
             "notes" = COALESCE("notes", '') || ' | consumed ' || $2
         WHERE "id" = $1`,
      row.id, consumeQty
    )
  } else {
    // Split: shrink PICKED row, spawn a new CONSUMED row. CONSUMED is a
    // terminal status — not covered by the active-status partial unique idx
    // — so inserting a new CONSUMED row for the same (jobId, productId) pair
    // is fine. We leave PICKED row with `remaining`.
    await prisma.$executeRawUnsafe(
      `UPDATE "InventoryAllocation"
         SET "quantity" = $2,
             "updatedAt" = NOW()
         WHERE "id" = $1`,
      row.id, remaining
    )
    const newId = `ia_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
    await prisma.$executeRawUnsafe(
      `INSERT INTO "InventoryAllocation"
         ("id", "productId", "orderId", "jobId", "quantity",
          "allocationType", "status", "allocatedBy", "notes",
          "allocatedAt", "createdAt", "updatedAt")
       SELECT $1, $2,
              (SELECT "orderId" FROM "InventoryAllocation" WHERE "id" = $5),
              $3, $4,
              'JOB', 'CONSUMED', 'system-auto',
              'partial consume split',
              NOW(), NOW(), NOW()`,
      newId, productId, jobId, consumeQty, row.id
    )
  }

  // Decrement onHand — this is the only moment physical stock leaves.
  await prisma.$executeRawUnsafe(
    `UPDATE "InventoryItem"
       SET "onHand" = GREATEST(COALESCE("onHand", 0) - $1, 0),
           "updatedAt" = NOW()
       WHERE "productId" = $2`,
    consumeQty, productId
  )

  // Recompute committed/available — PICKED dropping off triggers a recompute
  try {
    await prisma.$executeRawUnsafe(
      `SELECT recompute_inventory_committed($1)`, productId
    )
  } catch {}

  return {
    ...base,
    quantityConsumed: consumeQty,
  }
}
