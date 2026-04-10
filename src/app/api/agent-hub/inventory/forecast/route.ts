export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * GET /api/agent-hub/inventory/forecast
 * Demand forecast for next 30/60/90 days — computes from order history patterns.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams
    const period = parseInt(searchParams.get('period') || '30', 10) // 30, 60, or 90
    const productId = searchParams.get('productId')
    const belowReorder = searchParams.get('belowReorder') === 'true'

    // Get products with recent demand data
    let productFilter = ''
    const params: any[] = [period]

    if (productId) {
      productFilter = `AND p."id" = $2`
      params.push(productId)
    }

    // Calculate historical demand per product over the last 90 days and project forward
    const forecasts: any[] = await prisma.$queryRawUnsafe(`
      WITH product_demand AS (
        SELECT
          oi."productId",
          COUNT(DISTINCT o."id")::int AS "orderCount",
          COALESCE(SUM(oi."quantity"), 0)::int AS "totalQuantity",
          MIN(o."createdAt") AS "firstOrder",
          MAX(o."createdAt") AS "lastOrder"
        FROM "OrderItem" oi
        JOIN "Order" o ON o."id" = oi."orderId"
        WHERE o."createdAt" >= NOW() - INTERVAL '90 days'
          AND o."status"::text NOT IN ('CANCELLED')
        GROUP BY oi."productId"
      ),
      pipeline_demand AS (
        SELECT
          qi."productId",
          COALESCE(SUM(qi."quantity"), 0)::int AS "pipelineQuantity"
        FROM "QuoteItem" qi
        JOIN "Quote" q ON q."id" = qi."quoteId"
        WHERE q."status"::text IN ('SENT', 'DRAFT')
        GROUP BY qi."productId"
      )
      SELECT
        p."id" AS "productId",
        p."name",
        p."sku",
        p."category",
        COALESCE(i."onHand", 0) AS "stockQuantity",
        COALESCE(i."available", 0) AS "availableStock",
        COALESCE(i."reorderPoint", 0) AS "reorderPoint",
        COALESCE(i."reorderQty", 0) AS "reorderQty",
        p."cost",
        p."basePrice",
        COALESCE(pd."orderCount", 0) AS "recentOrderCount",
        COALESCE(pd."totalQuantity", 0) AS "demand90Days",
        COALESCE(pld."pipelineQuantity", 0) AS "pipelineDemand",
        ROUND(COALESCE(pd."totalQuantity", 0)::numeric / 90 * $1, 0)::int AS "predictedDemand",
        ROUND(COALESCE(pd."totalQuantity", 0)::numeric / 90 * $1 * 0.8, 0)::int AS "lowEstimate",
        ROUND(COALESCE(pd."totalQuantity", 0)::numeric / 90 * $1 * 1.2, 0)::int AS "highEstimate"
      FROM "Product" p
      LEFT JOIN "InventoryItem" i ON i."productId" = p."id"
      LEFT JOIN product_demand pd ON pd."productId" = p."id"
      LEFT JOIN pipeline_demand pld ON pld."productId" = p."id"
      WHERE p."active" = true
        ${productFilter}
      ORDER BY COALESCE(pd."totalQuantity", 0) DESC
      LIMIT 200
    `, ...params)

    // Enrich with stock health signals
    const enriched = forecasts.map(f => {
      const predicted = Number(f.predictedDemand) || 0
      const stock = Number(f.stockQuantity) || 0
      const reorderPoint = Number(f.reorderPoint) || 0
      const pipeline = Number(f.pipelineDemand) || 0

      const daysOfStock = predicted > 0 ? Math.floor(stock / (predicted / period) ) : 999
      const totalDemand = predicted + pipeline
      const willStockOut = stock < totalDemand
      const needsReorder = stock <= reorderPoint

      return {
        ...f,
        stockQuantity: stock,
        reorderPoint,
        predictedDemand: predicted,
        pipelineDemand: pipeline,
        totalExpectedDemand: totalDemand,
        daysOfStock,
        willStockOut,
        needsReorder,
        cost: Number(f.cost),
        basePrice: Number(f.basePrice),
        reorderValue: needsReorder ? Number(f.reorderQty) * Number(f.cost) : 0,
        signal: willStockOut ? 'CRITICAL' : needsReorder ? 'WARNING' : daysOfStock < period * 1.5 ? 'WATCH' : 'HEALTHY',
      }
    })

    // Filter if belowReorder requested
    const filtered = belowReorder
      ? enriched.filter(f => f.needsReorder || f.willStockOut)
      : enriched

    // Summary stats
    const critical = filtered.filter(f => f.signal === 'CRITICAL').length
    const warning = filtered.filter(f => f.signal === 'WARNING').length
    const totalReorderValue = filtered
      .filter(f => f.needsReorder)
      .reduce((sum, f) => sum + f.reorderValue, 0)

    return NextResponse.json({
      period,
      forecasts: filtered,
      summary: {
        totalProducts: filtered.length,
        critical,
        warning,
        healthy: filtered.length - critical - warning,
        totalReorderValue: Math.round(totalReorderValue * 100) / 100,
      },
    })
  } catch (error) {
    console.error('GET /api/agent-hub/inventory/forecast error:', error)
    return NextResponse.json({ error: 'Failed to generate forecast' }, { status: 500 })
  }
}

/**
 * POST /api/agent-hub/inventory/forecast
 * Persist a computed forecast snapshot for historical tracking.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { productId, periodDays, predictedDemand, confidenceLevel, basedOn } = body

    if (!productId || !periodDays || predictedDemand === undefined) {
      return NextResponse.json(
        { error: 'Missing required: productId, periodDays, predictedDemand' },
        { status: 400 }
      )
    }

    const id = `df_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const forecastDate = new Date()
    forecastDate.setDate(forecastDate.getDate() + periodDays)

    await prisma.$executeRawUnsafe(`
      INSERT INTO "DemandForecast" (
        "id", "productId", "forecastDate", "periodDays", "predictedDemand",
        "confidenceLevel", "basedOn", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW(), NOW())
    `,
      id, productId, forecastDate, periodDays, predictedDemand,
      confidenceLevel || 0.5, JSON.stringify(basedOn || {})
    )

    return NextResponse.json({ id, productId, forecastDate, predictedDemand }, { status: 201 })
  } catch (error) {
    console.error('POST /api/agent-hub/inventory/forecast error:', error)
    return NextResponse.json({ error: 'Failed to save forecast' }, { status: 500 })
  }
}
