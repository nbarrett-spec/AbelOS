export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

// GET /api/dashboard/analytics — Builder spending analytics
export async function GET(request: NextRequest) {
  const token = request.cookies.get('abel_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let session: any
  try { session = await verifyToken(token) } catch {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  const builderId = session.builderId

  try {
    // Monthly spending (last 12 months)
    const monthlySpendings: any[] = await prisma.$queryRawUnsafe(`
      SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') as month,
             COALESCE(SUM(total)::numeric, 0) as total,
             COUNT(*)::int as orders
      FROM "Order"
      WHERE "builderId" = $1
        AND "createdAt" >= NOW() - INTERVAL '12 months'
      GROUP BY date_trunc('month', "createdAt")
      ORDER BY month
    `, builderId)

    // Category breakdown
    let categorySpending: any[] = []
    try {
      categorySpending = await prisma.$queryRawUnsafe(`
        SELECT p.category,
               COALESCE(SUM(oi.total)::numeric, 0) as total,
               COUNT(DISTINCT oi."orderId")::int as orders,
               SUM(oi.quantity)::int as units
        FROM "OrderItem" oi
        JOIN "Product" p ON oi."productSku" = p.sku
        JOIN "Order" o ON oi."orderId" = o.id
        WHERE o."builderId" = $1
          AND o."createdAt" >= NOW() - INTERVAL '12 months'
        GROUP BY p.category
        ORDER BY total DESC
        LIMIT 10
      `, builderId)
    } catch (e: any) { console.warn('[Analytics] Failed to fetch category spending:', e?.message) }

    // Top products
    let topProducts: any[] = []
    try {
      topProducts = await prisma.$queryRawUnsafe(`
        SELECT p.sku, p.name, p.category,
               COALESCE(SUM(oi.total)::numeric, 0) as total,
               SUM(oi.quantity)::int as quantity,
               COUNT(DISTINCT oi."orderId")::int as orders
        FROM "OrderItem" oi
        JOIN "Product" p ON oi."productSku" = p.sku
        JOIN "Order" o ON oi."orderId" = o.id
        WHERE o."builderId" = $1
          AND o."createdAt" >= NOW() - INTERVAL '12 months'
        GROUP BY p.sku, p.name, p.category
        ORDER BY total DESC
        LIMIT 10
      `, builderId)
    } catch (e: any) { console.warn('[Analytics] Failed to fetch top products:', e?.message) }

    // Year-over-year comparison
    const yoyRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE(SUM(CASE WHEN "createdAt" >= NOW() - INTERVAL '12 months' THEN total ELSE 0 END)::numeric, 0) as "currentYear",
        COALESCE(SUM(CASE WHEN "createdAt" >= NOW() - INTERVAL '24 months' AND "createdAt" < NOW() - INTERVAL '12 months' THEN total ELSE 0 END)::numeric, 0) as "previousYear",
        COUNT(CASE WHEN "createdAt" >= NOW() - INTERVAL '12 months' THEN 1 END)::int as "currentOrders",
        COUNT(CASE WHEN "createdAt" >= NOW() - INTERVAL '24 months' AND "createdAt" < NOW() - INTERVAL '12 months' THEN 1 END)::int as "previousOrders"
      FROM "Order"
      WHERE "builderId" = $1
    `, builderId)

    // Average order value
    const avgRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE(AVG(total)::numeric, 0) as "avgOrderValue",
        COALESCE(MAX(total)::numeric, 0) as "maxOrder",
        COALESCE(MIN(total)::numeric, 0) as "minOrder"
      FROM "Order"
      WHERE "builderId" = $1
        AND "createdAt" >= NOW() - INTERVAL '12 months'
    `, builderId)

    // Payment timeliness
    let paymentStats: any = { onTime: 0, late: 0, avgDaysToPayStr: '—' }
    try {
      const pRows: any[] = await prisma.$queryRawUnsafe(`
        SELECT
          COUNT(CASE WHEN "paidAt" IS NOT NULL AND "paidAt" <= "dueDate" THEN 1 END)::int as "onTime",
          COUNT(CASE WHEN "paidAt" IS NOT NULL AND "paidAt" > "dueDate" THEN 1 END)::int as "late",
          ROUND(AVG(EXTRACT(EPOCH FROM ("paidAt" - "issuedAt")) / 86400)::numeric, 1) as "avgDays"
        FROM "Invoice"
        WHERE "builderId" = $1 AND "paidAt" IS NOT NULL
          AND "createdAt" >= NOW() - INTERVAL '12 months'
      `, builderId)
      if (pRows.length > 0) {
        paymentStats = {
          onTime: pRows[0].onTime || 0,
          late: pRows[0].late || 0,
          avgDaysToPayStr: pRows[0].avgDays ? `${pRows[0].avgDays} days` : '—',
        }
      }
    } catch (e: any) { console.warn('[Analytics] Failed to fetch payment stats:', e?.message) }

    return NextResponse.json({
      monthlySpending: monthlySpendings,
      categorySpending,
      topProducts,
      yearOverYear: yoyRows[0] || {},
      orderStats: avgRows[0] || {},
      paymentStats,
    })
  } catch (error: any) {
    console.error('Analytics error:', error)
    return NextResponse.json({ error: 'Failed to load analytics' }, { status: 500 })
  }
}
