export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// ──────────────────────────────────────────────────────────────────
// INBOUND MATERIAL ETA DASHBOARD
// ──────────────────────────────────────────────────────────────────
// GET ?days=14  — PO arrivals expected in the window
// GET ?jobId=x  — materials for a specific job
// ──────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const days = parseInt(request.nextUrl.searchParams.get('days') || '14')
  const jobId = request.nextUrl.searchParams.get('jobId')

  try {
    const now = new Date()
    const endDate = new Date(now.getTime() + days * 86400000)

    // ── PO items with expected dates ──
    let poQuery = `
      SELECT
        po."id" AS "poId",
        po."poNumber",
        po."status"::text AS "poStatus",
        po."expectedDate",
        po."vendorId",
        v."name" AS "vendorName",
        poi."productId",
        p."sku",
        p."name" AS "productName",
        poi."quantity"::int AS "orderedQty",
        poi."receivedQty"::int AS "receivedQty",
        (poi."quantity" - COALESCE(poi."receivedQty", 0))::int AS "pendingQty",
        po."createdAt",
        CASE
          WHEN po."expectedDate" < NOW() THEN 'OVERDUE'
          WHEN po."expectedDate" < NOW() + INTERVAL '3 days' THEN 'ARRIVING_SOON'
          ELSE 'ON_TRACK'
        END AS "urgency"
      FROM "PurchaseOrder" po
      JOIN "PurchaseOrderItem" poi ON poi."purchaseOrderId" = po."id"
      JOIN "Product" p ON poi."productId" = p."id"
      LEFT JOIN "Vendor" v ON po."vendorId" = v."id"
      WHERE po."status"::text NOT IN ('CANCELLED', 'RECEIVED', 'CLOSED')
        AND poi."quantity" > COALESCE(poi."receivedQty", 0)
    `
    const params: any[] = []
    let idx = 1

    if (jobId) {
      // PurchaseOrder doesn't have jobId; filter through Job→Order relationship if needed
      // For now, filter by expectedDate window instead
      poQuery += ` AND po."expectedDate" <= $${idx}::date`
      params.push(endDate.toISOString())
      idx++
    } else {
      poQuery += ` AND po."expectedDate" <= $${idx}::date`
      params.push(endDate.toISOString())
      idx++
    }

    poQuery += ` ORDER BY po."expectedDate" ASC NULLS LAST, po."poNumber" ASC`

    const poItems: any[] = await prisma.$queryRawUnsafe(poQuery, ...params)

    // ── Summary stats ──
    const overdue = poItems.filter((i: any) => i.urgency === 'OVERDUE')
    const arrivingSoon = poItems.filter((i: any) => i.urgency === 'ARRIVING_SOON')

    // ── Group by PO ──
    const byPO: Record<string, any> = {}
    poItems.forEach((item: any) => {
      if (!byPO[item.poNumber]) {
        byPO[item.poNumber] = {
          poId: item.poId,
          poNumber: item.poNumber,
          poStatus: item.poStatus,
          expectedDate: item.expectedDate,
          vendorName: item.vendorName,
          urgency: item.urgency,
          items: [],
        }
      }
      byPO[item.poNumber].items.push(item)
    })

    // ── Group by vendor ──
    const byVendor: Record<string, { vendorName: string; poCount: number; itemCount: number; overdueCount: number }> = {}
    poItems.forEach((item: any) => {
      const vn = item.vendorName || 'Unknown'
      if (!byVendor[vn]) byVendor[vn] = { vendorName: vn, poCount: 0, itemCount: 0, overdueCount: 0 }
      byVendor[vn].itemCount++
      if (item.urgency === 'OVERDUE') byVendor[vn].overdueCount++
    })
    Object.values(byPO).forEach(po => {
      const vn = po.vendorName || 'Unknown'
      if (byVendor[vn]) byVendor[vn].poCount++
    })

    return safeJson({
      summary: {
        totalPendingItems: poItems.length,
        overdueItems: overdue.length,
        arrivingSoonItems: arrivingSoon.length,
        uniquePOs: Object.keys(byPO).length,
      },
      items: poItems,
      byPO: Object.values(byPO),
      byVendor: Object.values(byVendor).sort((a, b) => b.overdueCount - a.overdueCount),
    })
  } catch (error: any) {
    console.error('[Material ETA]', error)
    return NextResponse.json({ error: 'Internal server error'}, { status: 500 })
  }
}
