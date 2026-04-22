export const dynamic = 'force-dynamic'

import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/inventory/[id]/purchase-history
//   PurchaseOrderItem rows + cost trend for last 6 POs + lead-time tracking.
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const productId = params.id
  if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 })

  try {
    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10) || 25))
    const offset = (page - 1) * limit

    // ── Recent PO items ──
    const items: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        poi."id", poi."quantity", poi."unitCost", poi."lineTotal",
        poi."receivedQty", poi."damagedQty", poi."vendorSku", poi."description",
        po."id" AS "poId", po."poNumber", po."status" AS "poStatus",
        po."orderedAt", po."expectedDate", po."receivedAt",
        po."total" AS "poTotal",
        v."id" AS "vendorId", v."name" AS "vendorName",
        v."avgLeadDays", v."onTimeRate"
      FROM "PurchaseOrderItem" poi
      JOIN "PurchaseOrder" po ON po."id" = poi."purchaseOrderId"
      LEFT JOIN "Vendor" v ON v."id" = po."vendorId"
      WHERE poi."productId" = $1
      ORDER BY po."orderedAt" DESC NULLS LAST
      LIMIT $2 OFFSET $3
    `, productId, limit, offset)

    const countRow: any[] = await prisma.$queryRawUnsafe(`
      SELECT CAST(COUNT(*) AS INTEGER) AS cnt
      FROM "PurchaseOrderItem" poi
      WHERE poi."productId" = $1
    `, productId)
    const total = Number(countRow[0]?.cnt || 0)

    // ── Cost trend: last 6 POs (ordered) ──
    const costTrend: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        po."poNumber", po."orderedAt",
        poi."unitCost",
        v."name" AS "vendorName"
      FROM "PurchaseOrderItem" poi
      JOIN "PurchaseOrder" po ON po."id" = poi."purchaseOrderId"
      LEFT JOIN "Vendor" v ON v."id" = po."vendorId"
      WHERE poi."productId" = $1
        AND po."orderedAt" IS NOT NULL
      ORDER BY po."orderedAt" DESC
      LIMIT 6
    `, productId)

    // ── Lead-time tracking: avg/min/max days from orderedAt -> receivedAt ──
    const leadTimeRow: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE(AVG(EXTRACT(EPOCH FROM (po."receivedAt" - po."orderedAt")) / 86400.0), 0) AS "avgDays",
        COALESCE(MIN(EXTRACT(EPOCH FROM (po."receivedAt" - po."orderedAt")) / 86400.0), 0) AS "minDays",
        COALESCE(MAX(EXTRACT(EPOCH FROM (po."receivedAt" - po."orderedAt")) / 86400.0), 0) AS "maxDays",
        CAST(COUNT(*) AS INTEGER) AS "sampleCount"
      FROM "PurchaseOrderItem" poi
      JOIN "PurchaseOrder" po ON po."id" = poi."purchaseOrderId"
      WHERE poi."productId" = $1
        AND po."orderedAt" IS NOT NULL
        AND po."receivedAt" IS NOT NULL
    `, productId)

    // ── Lifetime totals ──
    const totalsRow: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE(SUM(poi."receivedQty"), 0) AS "totalReceived",
        COALESCE(SUM(poi."quantity"), 0) AS "totalOrdered",
        COALESCE(AVG(poi."unitCost"), 0) AS "avgUnitCost",
        CAST(COUNT(DISTINCT po."id") AS INTEGER) AS "poCount"
      FROM "PurchaseOrderItem" poi
      JOIN "PurchaseOrder" po ON po."id" = poi."purchaseOrderId"
      WHERE poi."productId" = $1
    `, productId)

    return safeJson({
      items: items.map(r => ({
        id: r.id,
        quantity: Number(r.quantity || 0),
        unitCost: r.unitCost == null ? null : Number(r.unitCost),
        lineTotal: r.lineTotal == null ? null : Number(r.lineTotal),
        receivedQty: Number(r.receivedQty || 0),
        damagedQty: r.damagedQty == null ? null : Number(r.damagedQty),
        vendorSku: r.vendorSku,
        description: r.description,
        poId: r.poId,
        poNumber: r.poNumber,
        poStatus: r.poStatus,
        orderedAt: r.orderedAt,
        expectedDate: r.expectedDate,
        receivedAt: r.receivedAt,
        poTotal: r.poTotal == null ? null : Number(r.poTotal),
        vendorId: r.vendorId,
        vendorName: r.vendorName,
        avgLeadDays: r.avgLeadDays == null ? null : Number(r.avgLeadDays),
        onTimeRate: r.onTimeRate == null ? null : Number(r.onTimeRate),
      })),
      total,
      page,
      pageSize: limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      costTrend: costTrend
        .map(c => ({
          poNumber: c.poNumber,
          orderedAt: c.orderedAt,
          unitCost: c.unitCost == null ? null : Number(c.unitCost),
          vendorName: c.vendorName,
        }))
        .reverse(), // oldest -> newest for chart left-to-right
      leadTime: {
        avgDays: Math.round(Number(leadTimeRow[0]?.avgDays || 0) * 10) / 10,
        minDays: Math.round(Number(leadTimeRow[0]?.minDays || 0) * 10) / 10,
        maxDays: Math.round(Number(leadTimeRow[0]?.maxDays || 0) * 10) / 10,
        sampleCount: Number(leadTimeRow[0]?.sampleCount || 0),
      },
      totals: {
        totalReceived: Number(totalsRow[0]?.totalReceived || 0),
        totalOrdered: Number(totalsRow[0]?.totalOrdered || 0),
        avgUnitCost: Number(totalsRow[0]?.avgUnitCost || 0),
        poCount: Number(totalsRow[0]?.poCount || 0),
      },
    })
  } catch (error: any) {
    console.error('Inventory purchase-history error:', error)
    return NextResponse.json({ error: 'Internal server error', detail: String(error?.message || error) }, { status: 500 })
  }
}
