export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/ops/warehouse/cross-dock
//
// Powers the warehouse dashboard "cross-dock today" KPI card and the detail
// list on /ops/receiving. Returns:
//   - totalFlags          (count of all currently-flagged PO lines)
//   - expectedToday       (count whose PO expectedDate ≤ end-of-day today)
//   - lines[]             (per-line detail, joined vendor + jobs)
// ═══════════════════════════════════════════════════════════════════════════

interface CrossDockLineRow {
  poItemId: string
  poId: string
  poNumber: string
  vendorName: string | null
  status: string
  expectedDate: Date | null
  productId: string | null
  vendorSku: string
  description: string
  quantity: number
  receivedQty: number
  crossDockJobIds: string[] | null
  crossDockCheckedAt: Date | null
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const rows = await prisma.$queryRawUnsafe<CrossDockLineRow[]>(
      `
      SELECT
        poi."id"                AS "poItemId",
        po."id"                 AS "poId",
        po."poNumber",
        v."name"                AS "vendorName",
        po."status"::text       AS "status",
        po."expectedDate",
        poi."productId",
        poi."vendorSku",
        poi."description",
        poi."quantity",
        poi."receivedQty",
        poi."crossDockJobIds",
        poi."crossDockCheckedAt"
      FROM "PurchaseOrderItem" poi
      JOIN "PurchaseOrder" po ON po."id" = poi."purchaseOrderId"
      LEFT JOIN "Vendor" v ON v."id" = po."vendorId"
      WHERE poi."crossDockFlag" = true
        AND po."status" IN ('SENT_TO_VENDOR','APPROVED','PARTIALLY_RECEIVED')
      ORDER BY po."expectedDate" ASC NULLS LAST, po."poNumber" ASC
      `
    )

    // Resolve jobs in one pass.
    const jobIdSet = new Set<string>()
    for (const r of rows) {
      if (Array.isArray(r.crossDockJobIds)) {
        for (const id of r.crossDockJobIds) jobIdSet.add(id)
      }
    }

    const jobMap = new Map<
      string,
      {
        id: string
        jobNumber: string
        builderName: string | null
        scheduledDate: Date | null
        community: string | null
      }
    >()
    if (jobIdSet.size > 0) {
      const jobs = await prisma.$queryRawUnsafe<
        Array<{
          id: string
          jobNumber: string
          builderName: string | null
          scheduledDate: Date | null
          community: string | null
        }>
      >(
        `SELECT "id", "jobNumber", "builderName", "scheduledDate", "community"
         FROM "Job"
         WHERE "id" = ANY($1::text[])`,
        Array.from(jobIdSet)
      )
      for (const j of jobs) jobMap.set(j.id, j)
    }

    const endOfToday = new Date()
    endOfToday.setHours(23, 59, 59, 999)

    let expectedToday = 0
    const lines = rows.map((r) => {
      const jobIds = Array.isArray(r.crossDockJobIds) ? r.crossDockJobIds : []
      const jobs = jobIds
        .map((id) => jobMap.get(id))
        .filter((j): j is NonNullable<typeof j> => Boolean(j))
        .map((j) => ({
          id: j.id,
          jobNumber: j.jobNumber,
          builderName: j.builderName,
          community: j.community,
          scheduledDate: j.scheduledDate
            ? new Date(j.scheduledDate).toISOString()
            : null,
        }))

      if (r.expectedDate && new Date(r.expectedDate).getTime() <= endOfToday.getTime()) {
        expectedToday++
      }

      return {
        poItemId: r.poItemId,
        poId: r.poId,
        poNumber: r.poNumber,
        vendorName: r.vendorName,
        status: r.status,
        expectedDate: r.expectedDate ? new Date(r.expectedDate).toISOString() : null,
        productId: r.productId,
        vendorSku: r.vendorSku,
        description: r.description,
        quantity: r.quantity,
        receivedQty: r.receivedQty,
        remaining: Math.max(0, r.quantity - r.receivedQty),
        checkedAt: r.crossDockCheckedAt
          ? new Date(r.crossDockCheckedAt).toISOString()
          : null,
        jobs,
      }
    })

    return NextResponse.json({
      totalFlags: lines.length,
      expectedToday,
      lines,
    })
  } catch (error: any) {
    console.error('[GET /api/ops/warehouse/cross-dock]', error)
    return NextResponse.json(
      { error: 'Failed to load cross-dock feed' },
      { status: 500 }
    )
  }
}
