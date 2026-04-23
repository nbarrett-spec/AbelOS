export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * Read-only list of InventoryAllocation rows for a single Job, with SKU +
 * product name joined for the UI. Used by the Allocation panel on the Job
 * detail page.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id } = params
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT ia."id", ia."productId", ia."quantity",
              ia."status", ia."allocationType",
              ia."allocatedBy", ia."notes",
              ia."allocatedAt", ia."releasedAt", ia."updatedAt",
              p."sku", p."name" AS "productName", p."category",
              ii."onHand", ii."committed", ii."available"
         FROM "InventoryAllocation" ia
         LEFT JOIN "Product" p ON p."id" = ia."productId"
         LEFT JOIN "InventoryItem" ii ON ii."productId" = ia."productId"
        WHERE ia."jobId" = $1
        ORDER BY
          CASE ia."status"
            WHEN 'BACKORDERED' THEN 1
            WHEN 'RESERVED' THEN 2
            WHEN 'PICKED' THEN 3
            WHEN 'CONSUMED' THEN 4
            WHEN 'RELEASED' THEN 5
            ELSE 99 END,
          p."category" NULLS LAST,
          p."sku"`,
      id
    )

    // Quick summary for the badge row
    const summary = {
      total: rows.length,
      reserved: rows.filter((r) => r.status === 'RESERVED').length,
      picked: rows.filter((r) => r.status === 'PICKED').length,
      consumed: rows.filter((r) => r.status === 'CONSUMED').length,
      backordered: rows.filter((r) => r.status === 'BACKORDERED').length,
      released: rows.filter((r) => r.status === 'RELEASED').length,
      shortLines: rows.filter((r) => r.status === 'BACKORDERED').length,
    }

    return NextResponse.json({ summary, allocations: rows })
  } catch (err: any) {
    console.error('[allocations GET]', err)
    return NextResponse.json(
      { error: 'Failed to load allocations', details: err?.message },
      { status: 500 }
    )
  }
}
