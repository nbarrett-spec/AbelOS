export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

// ─────────────────────────────────────────────────────────────────────────────
// Vendor scorecard detail: every PO for a vendor with actual vs promised
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: { vendorId: string } },
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams
    const daysParam = parseInt(searchParams.get('days') || '90', 10)
    const days = Number.isFinite(daysParam) && daysParam > 0 && daysParam <= 730 ? daysParam : 90
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const vendorRows = await prisma.$queryRawUnsafe<Array<{
      id: string; name: string; code: string
    }>>(
      `SELECT "id", "name", "code" FROM "Vendor" WHERE "id" = $1 LIMIT 1`,
      params.vendorId,
    )
    if (!vendorRows || vendorRows.length === 0) {
      return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    }
    const vendor = vendorRows[0]

    const poRows = await prisma.$queryRawUnsafe<Array<{
      id: string
      poNumber: string
      status: string
      total: number
      orderedAt: Date | null
      expectedDate: Date | null
      receivedAt: Date | null
      createdAt: Date
    }>>(
      `
      SELECT po."id", po."poNumber", po."status"::text AS status,
             po."total"::float AS total,
             po."orderedAt", po."expectedDate", po."receivedAt", po."createdAt"
      FROM "PurchaseOrder" po
      WHERE po."vendorId" = $1
        AND (po."orderedAt" >= $2 OR (po."orderedAt" IS NULL AND po."createdAt" >= $2))
      ORDER BY COALESCE(po."orderedAt", po."createdAt") DESC
      LIMIT 500
      `,
      params.vendorId,
      since,
    )

    const purchaseOrders = poRows.map((r) => {
      const orderedAt = r.orderedAt ? new Date(r.orderedAt).toISOString() : null
      const expectedDate = r.expectedDate ? new Date(r.expectedDate).toISOString() : null
      const receivedAt = r.receivedAt ? new Date(r.receivedAt).toISOString() : null
      // Days from order to received (actual) and order to expected (promised)
      let actualLeadDays: number | null = null
      let promisedLeadDays: number | null = null
      let slipDays: number | null = null
      if (r.orderedAt && r.receivedAt) {
        actualLeadDays = Math.round(((+new Date(r.receivedAt) - +new Date(r.orderedAt)) / 86400000) * 10) / 10
      }
      if (r.orderedAt && r.expectedDate) {
        promisedLeadDays = Math.round(((+new Date(r.expectedDate) - +new Date(r.orderedAt)) / 86400000) * 10) / 10
      }
      if (r.receivedAt && r.expectedDate) {
        slipDays = Math.round(((+new Date(r.receivedAt) - +new Date(r.expectedDate)) / 86400000) * 10) / 10
      }
      const onTime =
        r.receivedAt && r.expectedDate
          ? new Date(r.receivedAt) <= new Date(r.expectedDate)
          : null
      return {
        id: r.id,
        poNumber: r.poNumber,
        status: r.status,
        total: Number(r.total || 0),
        orderedAt,
        expectedDate,
        receivedAt,
        createdAt: new Date(r.createdAt).toISOString(),
        actualLeadDays,
        promisedLeadDays,
        slipDays,
        onTime, // true/false/null
      }
    })

    return NextResponse.json({
      vendor,
      windowDays: days,
      since: since.toISOString(),
      purchaseOrders,
    })
  } catch (error) {
    console.error('GET /api/ops/vendors/scorecard/[vendorId] error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch vendor scorecard detail' },
      { status: 500 },
    )
  }
}
