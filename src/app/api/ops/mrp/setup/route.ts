export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { audit } from '@/lib/audit'

/**
 * POST /api/ops/mrp/setup
 *
 * Idempotent — applies the MRP support indices in production. Called once
 * automatically by the /ops/mrp page on first load. Safe to re-run.
 */
export async function POST(_request: NextRequest) {
  const created: string[] = []
  const errors: string[] = []

  const statements: Array<[string, string]> = [
    ['Order_paymentStatus_idx', `CREATE INDEX IF NOT EXISTS "Order_paymentStatus_idx" ON "Order"("paymentStatus")`],
    ['Order_dueDate_idx', `CREATE INDEX IF NOT EXISTS "Order_dueDate_idx" ON "Order"("dueDate")`],
    ['PurchaseOrder_expectedDate_idx', `CREATE INDEX IF NOT EXISTS "PurchaseOrder_expectedDate_idx" ON "PurchaseOrder"("expectedDate")`],
    ['PurchaseOrder_receivedAt_idx', `CREATE INDEX IF NOT EXISTS "PurchaseOrder_receivedAt_idx" ON "PurchaseOrder"("receivedAt")`],
    ['Job_boltJobId_idx', `CREATE INDEX IF NOT EXISTS "Job_boltJobId_idx" ON "Job"("boltJobId")`],
    ['Job_inflowJobId_idx', `CREATE INDEX IF NOT EXISTS "Job_inflowJobId_idx" ON "Job"("inflowJobId")`],
    ['OrderItem_orderId_productId_idx', `CREATE INDEX IF NOT EXISTS "OrderItem_orderId_productId_idx" ON "OrderItem"("orderId", "productId")`],
    ['BomEntry_parentId_idx', `CREATE INDEX IF NOT EXISTS "BomEntry_parentId_idx" ON "BomEntry"("parentId")`],
    ['InventoryItem_productId_onHand_idx', `CREATE INDEX IF NOT EXISTS "InventoryItem_productId_onHand_idx" ON "InventoryItem"("productId", "onHand")`],
    ['PurchaseOrderItem_productId_idx', `CREATE INDEX IF NOT EXISTS "PurchaseOrderItem_productId_idx" ON "PurchaseOrderItem"("productId")`],
  ]

  for (const [name, sql] of statements) {
    try {
    // Audit log
    audit(request, 'CREATE', 'Mrp', undefined, { method: 'POST' }).catch(() => {})

      await prisma.$executeRawUnsafe(sql)
      created.push(name)
    } catch (err: any) {
      errors.push(`${name}: ${err?.message || err}`)
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    created,
    errors,
  })
}

export async function GET(request: NextRequest) {
  return POST(request)
}
