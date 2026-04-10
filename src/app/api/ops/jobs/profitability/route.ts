export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// ──────────────────────────────────────────────────────────────────
// JOB PROFITABILITY — Margin analysis for a single job
// ──────────────────────────────────────────────────────────────────
// GET ?jobId=xxx  — profitability for one job
// ──────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const jobId = request.nextUrl.searchParams.get('jobId')
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 })

  try {
    // ── 1. Order revenue ──
    const orderRevenue: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        o."id" AS "orderId",
        o."orderNumber",
        o."subtotal"::float,
        o."taxAmount"::float AS tax,
        o."total"::float,
        o."status"::text AS "orderStatus"
      FROM "Job" j
      JOIN "Order" o ON j."orderId" = o."id"
      WHERE j."id" = $1
    `, jobId)

    const order = orderRevenue[0] || null

    // ── 2. Line item detail with BOM cost ──
    const lineItems: any[] = order ? await prisma.$queryRawUnsafe(`
      SELECT
        oi."id",
        p."sku",
        p."name",
        oi."quantity"::int AS qty,
        COALESCE(oi."unitPrice", p."cost")::float AS "sellPrice",
        p."cost"::float AS "catalogCost",
        COALESCE(bom_cost(p."id"), p."cost", 0)::float AS "bomCost",
        (oi."quantity" * COALESCE(oi."unitPrice", p."cost"))::float AS "lineRevenue",
        (oi."quantity" * COALESCE(bom_cost(p."id"), p."cost", 0))::float AS "lineCost",
        CASE
          WHEN p."sku" LIKE 'ADT%' OR p."name" LIKE 'ADT %' THEN 'Assembled Door'
          WHEN p."name" ILIKE '%labor%' THEN 'Labor'
          ELSE 'Material'
        END AS "category"
      FROM "OrderItem" oi
      JOIN "Product" p ON oi."productId" = p."id"
      WHERE oi."orderId" = $1
      ORDER BY "lineRevenue" DESC
    `, order.orderId) : []

    // ── 3. Labor / installation costs ──
    const laborCosts: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS "installCount",
        SUM(CASE WHEN i."status"::text = 'COMPLETE' THEN 1 ELSE 0 END)::int AS "completedInstalls"
      FROM "Installation" i
      WHERE i."jobId" = $1
    `, jobId)

    // ── 4. Material picks (actual materials pulled) ──
    const materialPicks: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS "pickCount",
        COUNT(CASE WHEN mp."status"::text = 'PICKED' THEN 1 END)::int AS "pickedCount"
      FROM "MaterialPick" mp
      WHERE mp."jobId" = $1
    `, jobId)

    // ── Compute profitability ──
    const totalRevenue = order?.subtotal || 0
    const totalBomCost = lineItems.reduce((sum: number, li: any) => sum + (li.lineCost || 0), 0)
    const grossMargin = totalRevenue - totalBomCost
    const marginPct = totalRevenue > 0 ? (grossMargin / totalRevenue) * 100 : 0

    // Category breakdown
    const byCategory: Record<string, { revenue: number; cost: number; margin: number }> = {}
    lineItems.forEach((li: any) => {
      if (!byCategory[li.category]) byCategory[li.category] = { revenue: 0, cost: 0, margin: 0 }
      byCategory[li.category].revenue += li.lineRevenue || 0
      byCategory[li.category].cost += li.lineCost || 0
      byCategory[li.category].margin += (li.lineRevenue || 0) - (li.lineCost || 0)
    })

    return safeJson({
      jobId,
      order: order ? {
        orderId: order.orderId,
        orderNumber: order.orderNumber,
        subtotal: order.subtotal,
        tax: order.tax,
        total: order.total,
        status: order.orderStatus,
      } : null,
      profitability: {
        totalRevenue,
        totalBomCost: Math.round(totalBomCost * 100) / 100,
        grossMargin: Math.round(grossMargin * 100) / 100,
        marginPct: Math.round(marginPct * 10) / 10,
      },
      byCategory: Object.entries(byCategory).map(([cat, data]) => ({
        category: cat,
        revenue: Math.round(data.revenue * 100) / 100,
        cost: Math.round(data.cost * 100) / 100,
        margin: Math.round(data.margin * 100) / 100,
        marginPct: data.revenue > 0 ? Math.round((data.margin / data.revenue) * 1000) / 10 : 0,
      })),
      lineItems: lineItems.map((li: any) => ({
        ...li,
        lineMargin: Math.round(((li.lineRevenue || 0) - (li.lineCost || 0)) * 100) / 100,
        marginPct: li.lineRevenue > 0 ? Math.round(((li.lineRevenue - li.lineCost) / li.lineRevenue) * 1000) / 10 : 0,
      })),
      labor: laborCosts[0] || { installCount: 0, completedInstalls: 0 },
      materials: materialPicks[0] || { pickCount: 0, pickedCount: 0 },
    })
  } catch (error: any) {
    console.error('[Job Profitability] Error:', error)
    return NextResponse.json({ error: error.message || 'Profitability analysis failed' }, { status: 500 })
  }
}
