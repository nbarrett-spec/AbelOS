export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

interface VendorScorecard {
  vendorId: string
  vendorName: string
  vendorCode: string
  totalPOs: number
  onTimeRate: number // 0-100 percentage
  avgLeadDays: number
  spend30Days: number
  spend90Days: number
  spend365Days: number
  qualityIssues: number
  topProducts: Array<{
    sku: string
    productName: string
    orderCount: number
    totalQty: number
  }>
  trend: {
    previousMonth: number
    currentMonth: number
    percentChange: number
  }
}

/**
 * GET /api/ops/vendors/scorecard
 *
 * Returns vendor scorecards. Optional query param ?vendorId= for single vendor.
 * If no vendorId, returns summary scorecards for all active vendors.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams
    const vendorId = searchParams.get('vendorId')

    // Determine time windows
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
    const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const previousMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    if (vendorId) {
      // Single vendor scorecard
      const query = `
        SELECT
          v."id",
          v."name",
          v."code",
          COUNT(DISTINCT po."id")::int as "totalPOs",
          COALESCE(v."onTimeRate", 0)::float as "onTimeRate",
          COALESCE(v."avgLeadDays", 0)::float as "avgLeadDays",
          COALESCE(SUM(CASE WHEN po."createdAt" >= $2 THEN po."total" ELSE 0 END), 0)::float as "spend30Days",
          COALESCE(SUM(CASE WHEN po."createdAt" >= $3 THEN po."total" ELSE 0 END), 0)::float as "spend90Days",
          COALESCE(SUM(CASE WHEN po."createdAt" >= $4 THEN po."total" ELSE 0 END), 0)::float as "spend365Days"
        FROM "Vendor" v
        LEFT JOIN "PurchaseOrder" po ON po."vendorId" = v."id"
        WHERE v."id" = $1
        GROUP BY v."id", v."name", v."code", v."onTimeRate", v."avgLeadDays"
      `

      const vendorResult = await prisma.$queryRawUnsafe<any[]>(
        query,
        vendorId,
        thirtyDaysAgo.toISOString(),
        ninetyDaysAgo.toISOString(),
        oneYearAgo.toISOString()
      )

      if (!vendorResult || vendorResult.length === 0) {
        return NextResponse.json(
          { error: 'Vendor not found' },
          { status: 404 }
        )
      }

      const vendor = vendorResult[0]

      // Top products for this vendor
      const topProductsQuery = `
        SELECT
          p."sku",
          p."name" as "productName",
          COUNT(DISTINCT poi."purchaseOrderId")::int as "orderCount",
          SUM(poi."quantity")::int as "totalQty"
        FROM "PurchaseOrderItem" poi
        LEFT JOIN "PurchaseOrder" po ON poi."purchaseOrderId" = po."id"
        LEFT JOIN "Product" p ON poi."vendorSku" = p."sku"
        WHERE po."vendorId" = $1
        GROUP BY p."sku", p."name"
        ORDER BY "orderCount" DESC
        LIMIT 5
      `

      const topProducts = await prisma.$queryRawUnsafe<any[]>(
        topProductsQuery,
        vendorId
      )

      // Calculate trend (previous month vs current month)
      const trendQuery = `
        SELECT
          SUM(CASE WHEN po."createdAt" >= $2 AND po."createdAt" < $3 THEN po."total" ELSE 0 END)::float as "previousMonth",
          SUM(CASE WHEN po."createdAt" >= $4 THEN po."total" ELSE 0 END)::float as "currentMonth"
        FROM "PurchaseOrder" po
        WHERE po."vendorId" = $1
      `

      const trendResult = await prisma.$queryRawUnsafe<any[]>(
        trendQuery,
        vendorId,
        previousMonthStart.toISOString(),
        previousMonthEnd.toISOString(),
        currentMonthStart.toISOString()
      )

      const trend = trendResult[0] || { previousMonth: 0, currentMonth: 0 }
      const percentChange = trend.previousMonth > 0
        ? ((trend.currentMonth - trend.previousMonth) / trend.previousMonth) * 100
        : 0

      const scorecard: VendorScorecard = {
        vendorId: vendor.id,
        vendorName: vendor.name,
        vendorCode: vendor.code,
        totalPOs: vendor.totalPOs || 0,
        onTimeRate: Math.min(100, Math.max(0, vendor.onTimeRate || 85)),
        avgLeadDays: Math.round(vendor.avgLeadDays || 14),
        spend30Days: vendor.spend30Days || 0,
        spend90Days: vendor.spend90Days || 0,
        spend365Days: vendor.spend365Days || 0,
        qualityIssues: 0, // TODO: Query from quality issues table if it exists
        topProducts: topProducts.map(p => ({
          sku: p.sku || 'N/A',
          productName: p.productName || 'Unknown',
          orderCount: p.orderCount || 0,
          totalQty: p.totalQty || 0,
        })),
        trend: {
          previousMonth: Math.round(trend.previousMonth || 0),
          currentMonth: Math.round(trend.currentMonth || 0),
          percentChange: Math.round(percentChange * 10) / 10,
        },
      }

      return NextResponse.json(scorecard, { status: 200 })
    } else {
      // Summary scorecards for all active vendors
      const query = `
        SELECT
          v."id",
          v."name",
          v."code",
          COUNT(DISTINCT po."id")::int as "totalPOs",
          COALESCE(v."onTimeRate", 0)::float as "onTimeRate",
          COALESCE(v."avgLeadDays", 0)::float as "avgLeadDays",
          COALESCE(SUM(CASE WHEN po."createdAt" >= $1 THEN po."total" ELSE 0 END), 0)::float as "spend30Days",
          COALESCE(SUM(CASE WHEN po."createdAt" >= $2 THEN po."total" ELSE 0 END), 0)::float as "spend90Days",
          COALESCE(SUM(CASE WHEN po."createdAt" >= $3 THEN po."total" ELSE 0 END), 0)::float as "spend365Days"
        FROM "Vendor" v
        LEFT JOIN "PurchaseOrder" po ON po."vendorId" = v."id"
        WHERE v."active" = true
        GROUP BY v."id", v."name", v."code", v."onTimeRate", v."avgLeadDays"
        ORDER BY "spend90Days" DESC
      `

      const vendors = await prisma.$queryRawUnsafe<any[]>(
        query,
        thirtyDaysAgo.toISOString(),
        ninetyDaysAgo.toISOString(),
        oneYearAgo.toISOString()
      )

      const scorecards: VendorScorecard[] = vendors.map(v => ({
        vendorId: v.id,
        vendorName: v.name,
        vendorCode: v.code,
        totalPOs: v.totalPOs || 0,
        onTimeRate: Math.min(100, Math.max(0, v.onTimeRate || 85)),
        avgLeadDays: Math.round(v.avgLeadDays || 14),
        spend30Days: v.spend30Days || 0,
        spend90Days: v.spend90Days || 0,
        spend365Days: v.spend365Days || 0,
        qualityIssues: 0,
        topProducts: [],
        trend: {
          previousMonth: 0,
          currentMonth: 0,
          percentChange: 0,
        },
      }))

      return NextResponse.json(scorecards, { status: 200 })
    }
  } catch (error) {
    console.error('GET /api/ops/vendors/scorecard error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch vendor scorecard' },
      { status: 500 }
    )
  }
}
