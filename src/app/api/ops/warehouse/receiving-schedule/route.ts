export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'

// W-17 — Inbound Receiving Schedule (next 14 days)

export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request, {
    allowedRoles: ['ADMIN', 'MANAGER', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH'],
  })
  if (auth.error) return auth.error

  try {
    const sql = `
      SELECT po."id", po."poNumber", po."total"::float AS total, po."status"::text AS status,
             po."expectedDate", po."createdAt",
             v."name" AS "vendorName",
             (SELECT COUNT(*) FROM "PurchaseOrderItem" poi WHERE poi."purchaseOrderId" = po."id")::int AS "itemCount"
      FROM "PurchaseOrder" po
      LEFT JOIN "Vendor" v ON v."id" = po."vendorId"
      WHERE po."expectedDate" IS NOT NULL
        AND po."expectedDate" >= NOW()::date
        AND po."expectedDate" < NOW()::date + INTERVAL '14 days'
        AND po."status"::text NOT IN ('CANCELLED', 'RECEIVED', 'DRAFT')
      ORDER BY po."expectedDate" ASC, po."createdAt" ASC
    `
    const pos: any[] = await prisma.$queryRawUnsafe(sql)

    // Build 14-day skeleton; group POs by date.
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const days: Array<{ date: string; isToday: boolean; isWeekend: boolean; pos: any[] }> = []

    for (let i = 0; i < 14; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() + i)
      const isoDate = d.toISOString().slice(0, 10)
      const dow = d.getDay()
      days.push({
        date: isoDate,
        isToday: i === 0,
        isWeekend: dow === 0 || dow === 6,
        pos: [],
      })
    }

    for (const po of pos) {
      const expected = new Date(po.expectedDate)
      const isoDate = expected.toISOString().slice(0, 10)
      const day = days.find((d) => d.date === isoDate)
      if (day) {
        day.pos.push({
          id: po.id,
          poNumber: po.poNumber,
          vendorName: po.vendorName || 'Unknown vendor',
          status: po.status,
          itemCount: po.itemCount,
          total: po.total,
          expectedDate: po.expectedDate,
        })
      }
    }

    const totals = {
      dayCount: days.length,
      poCount: pos.length,
      totalValue: pos.reduce((s: number, p: any) => s + Number(p.total || 0), 0),
    }

    return NextResponse.json({
      days,
      totals,
      generatedAt: new Date().toISOString(),
    })
  } catch (e: any) {
    console.error('[GET /api/ops/warehouse/receiving-schedule] error:', e?.message || e)
    return NextResponse.json({ error: 'failed to load schedule' }, { status: 500 })
  }
}
