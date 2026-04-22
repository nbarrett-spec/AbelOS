export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Total inventory value and metrics
    const totalsQuery = `
      SELECT
        COUNT(*)::int as "totalItems",
        SUM("onHand")::int as "totalUnits",
        SUM("onHand" * "unitCost")::float as "totalValue"
      FROM "InventoryItem"
      WHERE "status" != 'DISCONTINUED'
    `
    const totalsResult = await prisma.$queryRawUnsafe(totalsQuery)
    const totals = (totalsResult as any[])[0]

    // Breakdown by category
    const categoryQuery = `
      SELECT
        "category",
        COUNT(*)::int as "itemCount",
        SUM("onHand")::int as "units",
        SUM("onHand" * "unitCost")::float as "value"
      FROM "InventoryItem"
      WHERE "status" != 'DISCONTINUED' AND "category" IS NOT NULL
      GROUP BY "category"
      ORDER BY "value" DESC
    `
    const byCategory = await prisma.$queryRawUnsafe(categoryQuery)

    // Breakdown by location
    const locationQuery = `
      SELECT
        "location",
        SUM("onHand")::int as "units",
        SUM("onHand" * "unitCost")::float as "value"
      FROM "InventoryItem"
      WHERE "status" != 'DISCONTINUED'
      GROUP BY "location"
      ORDER BY "value" DESC
    `
    const byLocation = await prisma.$queryRawUnsafe(locationQuery)

    // Top 20 highest-value items
    const topItemsQuery = `
      SELECT
        "productId", "sku", "productName", "category",
        "onHand", "unitCost",
        ("onHand" * "unitCost")::float as "totalValue"
      FROM "InventoryItem"
      WHERE "status" != 'DISCONTINUED' AND "onHand" > 0
      ORDER BY "totalValue" DESC
      LIMIT 20
    `
    const topItems = await prisma.$queryRawUnsafe(topItemsQuery)

    // Zero-cost items (data quality flag)
    const zeroCostQuery = `
      SELECT COUNT(*)::int as "count"
      FROM "InventoryItem"
      WHERE "status" != 'DISCONTINUED' AND "onHand" > 0 AND "unitCost" = 0
    `
    const zeroCostResult = await prisma.$queryRawUnsafe(zeroCostQuery)
    const zeroCostItems = (zeroCostResult as any[])[0]?.count || 0

    // Slow-moving inventory (onHand > 0 AND lastReceivedAt > 90 days ago OR NULL)
    const slowMovingQuery = `
      SELECT
        "productId", "sku", "productName",
        "onHand", "unitCost",
        ("onHand" * "unitCost")::float as "totalValue",
        "lastReceivedAt"
      FROM "InventoryItem"
      WHERE
        "status" != 'DISCONTINUED'
        AND "onHand" > 0
        AND (
          "lastReceivedAt" IS NULL
          OR "lastReceivedAt" < NOW() - INTERVAL '90 days'
        )
      ORDER BY "totalValue" DESC
    `
    const slowMovingItems = await prisma.$queryRawUnsafe(slowMovingQuery)

    // Calculate slow-moving value
    const slowMovingValue = (slowMovingItems as any[]).reduce(
      (sum, item) => sum + (item.totalValue || 0),
      0
    )

    const totalValue = totals.totalValue || 0
    const totalUnits = totals.totalUnits || 0
    const totalItems = totals.totalItems || 0

    // Calculate percentages for categories
    const categories = (byCategory as any[]).map((cat) => ({
      category: cat.category,
      units: cat.units,
      value: cat.value,
      pct: totalValue > 0 ? ((cat.value / totalValue) * 100).toFixed(1) : '0',
      itemCount: cat.itemCount,
    }))

    const locations = (byLocation as any[]).map((loc) => ({
      location: loc.location,
      units: loc.units,
      value: loc.value,
      pct: totalValue > 0 ? ((loc.value / totalValue) * 100).toFixed(1) : '0',
    }))

    const topItemsList = (topItems as any[]).map((item) => ({
      productId: item.productId,
      sku: item.sku,
      productName: item.productName,
      category: item.category,
      onHand: item.onHand,
      unitCost: item.unitCost,
      totalValue: item.totalValue,
    }))

    return NextResponse.json(
      {
        totalValue: parseFloat(totalValue.toFixed(2)),
        totalItems,
        totalUnits,
        byCategory: categories,
        byLocation: locations,
        topItems: topItemsList,
        zeroCostItems,
        slowMovingItems: (slowMovingItems as any[]).map((item) => ({
          productId: item.productId,
          sku: item.sku,
          productName: item.productName,
          onHand: item.onHand,
          unitCost: item.unitCost,
          totalValue: item.totalValue,
          lastReceivedAt: item.lastReceivedAt,
        })),
        slowMovingValue: parseFloat(slowMovingValue.toFixed(2)),
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('GET /api/ops/inventory/valuation error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch valuation data' },
      { status: 500 }
    )
  }
}
