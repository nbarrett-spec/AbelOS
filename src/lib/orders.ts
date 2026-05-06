// ─────────────────────────────────────────────────────────────────────────────
// src/lib/orders.ts — Order helpers
//
// Shared, schema-aware helpers for working with sales orders. These avoid
// duplicating the same join logic across manufacturing / scheduling / UI
// routes that each need to know "is this an order we actually build for, or
// is it pure stock pass-through?"
//
// Schema reminder (prisma/schema.prisma):
//   OrderItem.productId           → Product.id
//   BomEntry.parentId             → Product.id          (the manufactured assembly)
//   BomEntry.componentId          → Product.id          (the child component)
//
// "Has BOM items" means: at least one OrderItem on the order references a
// Product that is the *parent* of one or more BomEntry rows. Those orders go
// through manufacturing. Orders without any such items are stock-only — they
// still flow through staging / load / delivery, but should NOT show up on the
// manufacturing queue or generate a build sheet.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from './prisma'

/**
 * Returns true if the given order has at least one OrderItem whose Product
 * is the parent of a BomEntry — i.e. it has manufactured-in-house items.
 *
 * Single-order check. For batch use, prefer `orderIdsWithBomItems`.
 */
export async function orderHasBomItems(orderId: string): Promise<boolean> {
  const count = await prisma.bomEntry.count({
    where: {
      parent: {
        orderItems: {
          some: { orderId },
        },
      },
    },
  })
  return count > 0
}

/**
 * Batched version: given a list of order IDs, returns the set of IDs whose
 * orders have at least one BOM-parent OrderItem. Orders not in the returned
 * set are stock-only.
 *
 * One round-trip; uses raw SQL with DISTINCT for efficiency. Mirrors the
 * existing parameterized-SQL style used elsewhere in /api/ops/manufacturing.
 */
export async function orderIdsWithBomItems(orderIds: string[]): Promise<Set<string>> {
  if (orderIds.length === 0) return new Set()
  const rows = await prisma.$queryRawUnsafe<{ orderId: string }[]>(
    `SELECT DISTINCT oi."orderId"
       FROM "OrderItem" oi
       JOIN "BomEntry" be ON be."parentId" = oi."productId"
      WHERE oi."orderId" = ANY($1::text[])`,
    orderIds,
  )
  return new Set(rows.map((r) => r.orderId))
}
