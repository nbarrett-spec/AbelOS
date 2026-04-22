export const dynamic = 'force-dynamic'

import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

/**
 * GET /api/ops/data-quality
 *
 * Comprehensive data quality audit that flags the root causes of crazy
 * dashboard numbers. Hit this from the browser and see exactly what's wrong.
 *
 * Checks:
 *   1. Product pricing sanity — cost/basePrice outliers, nulls, zeros, negative
 *   2. Inventory quantity sanity — onHand outliers, mismatches, ghost records
 *   3. Inventory valuation breakdown — what's driving the total value
 *   4. Order/revenue sanity — order total outliers, impossible values
 *   5. Invoice sanity — balanceDue outliers, status inconsistencies
 *   6. Orphaned records — orders without builders, jobs without orders, etc.
 *   7. Duplicate detection — same SKU/orderNumber/invoiceNumber appearing multiple times
 *   8. Aggregate sanity — cross-check totals against known business reality
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const issues: Array<{
      category: string
      severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
      title: string
      detail: string
      count: number
      impact?: string
      fix?: string
      samples?: any[]
    }> = []

    // ─── 1. PRODUCT PRICING SANITY ───────────────────────────────────

    // Products with no cost set (will show as $0 in inventory valuation)
    const noCost: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS cnt
      FROM "Product"
      WHERE active = true AND (cost IS NULL OR cost = 0)
    `)
    const noCostSamples: any[] = await prisma.$queryRawUnsafe(`
      SELECT id, sku, name, cost, "basePrice", category
      FROM "Product"
      WHERE active = true AND (cost IS NULL OR cost = 0)
      ORDER BY "basePrice" DESC NULLS LAST
      LIMIT 10
    `)
    if (noCost[0]?.cnt > 0) {
      issues.push({
        category: 'PRICING',
        severity: 'HIGH',
        title: 'Products with no cost set',
        detail: `${noCost[0].cnt} active products have NULL or $0 cost. Inventory valuation, margin calculations, and COGS are all wrong for these items.`,
        count: noCost[0].cnt,
        impact: 'Understates inventory value; margin shows 100% for these SKUs',
        fix: 'Set product.cost from vendor pricing or InFlow data',
        samples: noCostSamples,
      })
    }

    // Products with no basePrice (revenue calculations off)
    const noPrice: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS cnt
      FROM "Product"
      WHERE active = true AND ("basePrice" IS NULL OR "basePrice" = 0)
    `)
    if (noPrice[0]?.cnt > 0) {
      issues.push({
        category: 'PRICING',
        severity: 'HIGH',
        title: 'Products with no base price',
        detail: `${noPrice[0].cnt} active products have NULL or $0 basePrice.`,
        count: noPrice[0].cnt,
        impact: 'Revenue projections and quote generation use wrong prices',
        fix: 'Set basePrice from catalog or pricing sheets',
      })
    }

    // Products with suspiciously high cost (> $5,000)
    const highCost: any[] = await prisma.$queryRawUnsafe(`
      SELECT id, sku, name, cost, "basePrice", category
      FROM "Product"
      WHERE active = true AND cost > 5000
      ORDER BY cost DESC
      LIMIT 20
    `)
    if (highCost.length > 0) {
      issues.push({
        category: 'PRICING',
        severity: 'MEDIUM',
        title: 'Products with cost > $5,000',
        detail: `${highCost.length} products have unit cost above $5,000. Verify these aren't cent/dollar conversion errors.`,
        count: highCost.length,
        impact: 'Inflates inventory valuation if quantities are also high',
        fix: 'Review if costs should be divided by 100 (cents→dollars)',
        samples: highCost,
      })
    }

    // Products with negative cost or price
    const negativePricing: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS cnt
      FROM "Product"
      WHERE active = true AND (cost < 0 OR "basePrice" < 0)
    `)
    if (negativePricing[0]?.cnt > 0) {
      issues.push({
        category: 'PRICING',
        severity: 'CRITICAL',
        title: 'Products with negative cost or price',
        detail: `${negativePricing[0].cnt} products have negative cost or basePrice.`,
        count: negativePricing[0].cnt,
        impact: 'Corrupts every calculation touching these products',
        fix: 'Likely import error — set to absolute value or correct from source',
      })
    }

    // Products where cost > basePrice (negative margin)
    const negativeMargin: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS cnt
      FROM "Product"
      WHERE active = true
        AND cost > 0 AND "basePrice" > 0
        AND cost > "basePrice"
    `)
    const negativeMarginSamples: any[] = await prisma.$queryRawUnsafe(`
      SELECT id, sku, name, cost, "basePrice", category,
             ROUND((("basePrice" - cost) / NULLIF("basePrice",0) * 100)::numeric, 1) AS "marginPct"
      FROM "Product"
      WHERE active = true
        AND cost > 0 AND "basePrice" > 0
        AND cost > "basePrice"
      ORDER BY (cost - "basePrice") DESC
      LIMIT 10
    `)
    if (negativeMargin[0]?.cnt > 0) {
      issues.push({
        category: 'PRICING',
        severity: 'HIGH',
        title: 'Products with cost exceeding base price (negative margin)',
        detail: `${negativeMargin[0].cnt} products are priced below cost. Every sale loses money on paper.`,
        count: negativeMargin[0].cnt,
        impact: 'Margin analytics are meaningless for these SKUs',
        fix: 'Either cost or basePrice is wrong — check against vendor invoices',
        samples: negativeMarginSamples,
      })
    }

    // ─── 2. INVENTORY QUANTITY SANITY ────────────────────────────────

    // InventoryItem records with extremely high onHand (> 5,000 units)
    const highQty: any[] = await prisma.$queryRawUnsafe(`
      SELECT i.id, i."productId", i."productName", i.sku, i."onHand", i."unitCost",
             (i."onHand" * COALESCE(i."unitCost", 0))::float AS "extendedValue"
      FROM "InventoryItem" i
      WHERE i."onHand" > 5000
      ORDER BY i."onHand" DESC
      LIMIT 20
    `)
    if (highQty.length > 0) {
      issues.push({
        category: 'INVENTORY',
        severity: 'HIGH',
        title: 'Inventory items with > 5,000 units on hand',
        detail: `${highQty.length} items show extremely high quantities. Door/trim/hardware suppliers typically don't carry this much per SKU.`,
        count: highQty.length,
        impact: 'Massively inflates total inventory value and units counts',
        fix: 'Check if import doubled quantities, or if units should be something else',
        samples: highQty,
      })
    }

    // InventoryItem where unitCost doesn't match Product.cost
    const costMismatch: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS cnt
      FROM "InventoryItem" i
      JOIN "Product" p ON p.id = i."productId"
      WHERE i."unitCost" IS NOT NULL AND p."cost" IS NOT NULL
        AND ABS(i."unitCost" - p."cost") > 0.01
    `)
    if (costMismatch[0]?.cnt > 0) {
      const costMismatchSamples: any[] = await prisma.$queryRawUnsafe(`
        SELECT p.sku, p.name, p.cost AS "productCost", i."unitCost" AS "inventoryCost",
               ABS(i."unitCost" - p.cost)::float AS "difference"
        FROM "InventoryItem" i
        JOIN "Product" p ON p.id = i."productId"
        WHERE i."unitCost" IS NOT NULL AND p."cost" IS NOT NULL
          AND ABS(i."unitCost" - p."cost") > 0.01
        ORDER BY ABS(i."unitCost" - p."cost") DESC
        LIMIT 10
      `)
      issues.push({
        category: 'INVENTORY',
        severity: 'MEDIUM',
        title: 'InventoryItem.unitCost mismatches Product.cost',
        detail: `${costMismatch[0].cnt} items have different costs in Product vs InventoryItem. Which is correct?`,
        count: costMismatch[0].cnt,
        impact: 'Inventory valuation uses unitCost; margin calc uses Product.cost — they disagree',
        fix: 'Reconcile: one source of truth for cost (recommend InventoryItem.unitCost)',
        samples: costMismatchSamples,
      })
    }

    // Products with InventoryItem but onHand is negative
    const negativeOnHand: any[] = await prisma.$queryRawUnsafe(`
      SELECT i.id, i.sku, i."productName", i."onHand"
      FROM "InventoryItem" i
      WHERE i."onHand" < 0
      LIMIT 10
    `)
    if (negativeOnHand.length > 0) {
      issues.push({
        category: 'INVENTORY',
        severity: 'CRITICAL',
        title: 'Inventory items with negative on-hand',
        detail: `${negativeOnHand.length}+ items have negative on-hand quantities.`,
        count: negativeOnHand.length,
        impact: 'Subtracts from inventory value and available counts',
        fix: 'Reset to 0 or correct from physical count',
        samples: negativeOnHand,
      })
    }

    // ─── 3. INVENTORY VALUATION BREAKDOWN ────────────────────────────

    const valuationBreakdown: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS "totalItems",
        SUM(i."onHand")::int AS "totalUnits",
        COALESCE(SUM(i."onHand" * COALESCE(i."unitCost", p."cost", 0)), 0)::float AS "totalValue",
        COALESCE(AVG(COALESCE(i."unitCost", p."cost")), 0)::float AS "avgCost",
        MAX(COALESCE(i."unitCost", p."cost", 0))::float AS "maxCost",
        MAX(i."onHand")::int AS "maxOnHand",
        COUNT(CASE WHEN COALESCE(i."unitCost", p."cost") IS NULL OR COALESCE(i."unitCost", p."cost") = 0 THEN 1 END)::int AS "zeroCostItems"
      FROM "InventoryItem" i
      LEFT JOIN "Product" p ON p.id = i."productId"
    `)

    // Top 10 inventory items by extended value
    const topByValue: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        p.sku, p.name, p.category,
        i."onHand",
        COALESCE(i."unitCost", p."cost", 0)::float AS "unitCost",
        (i."onHand" * COALESCE(i."unitCost", p."cost", 0))::float AS "extendedValue"
      FROM "InventoryItem" i
      LEFT JOIN "Product" p ON p.id = i."productId"
      WHERE i."onHand" > 0
      ORDER BY (i."onHand" * COALESCE(i."unitCost", p."cost", 0)) DESC
      LIMIT 15
    `)

    const v = valuationBreakdown[0] || {}
    issues.push({
      category: 'VALUATION',
      severity: 'INFO' as any,
      title: 'Inventory valuation summary',
      detail: `Total: $${Number(v.totalValue || 0).toLocaleString()} across ${v.totalItems || 0} items (${v.totalUnits || 0} total units). Avg cost: $${Number(v.avgCost || 0).toFixed(2)}. Max cost: $${Number(v.maxCost || 0).toFixed(2)}. Max onHand: ${v.maxOnHand || 0}. Items with $0 cost: ${v.zeroCostItems || 0}.`,
      count: v.totalItems || 0,
      impact: 'This is the number shown on dashboards as inventory value',
      samples: topByValue,
    })

    // ─── 4. ORDER SANITY ─────────────────────────────────────────────

    // Orders with suspiciously high totals (> $100,000)
    const highOrders: any[] = await prisma.$queryRawUnsafe(`
      SELECT o.id, o."orderNumber", o.total::float, o.status::text, b."companyName",
             o."createdAt"
      FROM "Order" o
      LEFT JOIN "Builder" b ON o."builderId" = b.id
      WHERE o.total > 100000
      ORDER BY o.total DESC
      LIMIT 15
    `)
    if (highOrders.length > 0) {
      issues.push({
        category: 'ORDERS',
        severity: 'MEDIUM',
        title: 'Orders above $100K',
        detail: `${highOrders.length} orders have total > $100K. Verify these are real production orders, not test data.`,
        count: highOrders.length,
        samples: highOrders,
      })
    }

    // Orders with $0 or null total
    const zeroOrders: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS cnt
      FROM "Order"
      WHERE total IS NULL OR total = 0
    `)
    if (zeroOrders[0]?.cnt > 0) {
      issues.push({
        category: 'ORDERS',
        severity: 'HIGH',
        title: 'Orders with $0 or NULL total',
        detail: `${zeroOrders[0].cnt} orders have no value. These drag averages down and inflate order counts without contributing revenue.`,
        count: zeroOrders[0].cnt,
        impact: 'Average order value and revenue-per-order metrics are wrong',
        fix: 'Recalculate from line items, or mark as cancelled/void if test data',
      })
    }

    // Forecast vs real orders
    const forecastCount: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*) FILTER (WHERE "isForecast" = true)::int AS forecasts,
        COUNT(*) FILTER (WHERE "isForecast" = false OR "isForecast" IS NULL)::int AS real_orders,
        COALESCE(SUM(total) FILTER (WHERE "isForecast" = true), 0)::float AS forecast_value,
        COALESCE(SUM(total) FILTER (WHERE "isForecast" = false OR "isForecast" IS NULL), 0)::float AS real_value
      FROM "Order"
    `)
    const fc = forecastCount[0] || {}
    if (fc.forecasts > 0) {
      issues.push({
        category: 'ORDERS',
        severity: 'MEDIUM',
        title: 'Forecast orders mixed with real orders',
        detail: `${fc.forecasts} forecast orders ($${Number(fc.forecast_value || 0).toLocaleString()}) vs ${fc.real_orders} real orders ($${Number(fc.real_value || 0).toLocaleString()}). Dashboards that don't filter isForecast=false will overstate revenue.`,
        count: fc.forecasts,
        fix: 'Ensure dashboard queries filter WHERE "isForecast" = false',
      })
    }

    // ─── 5. INVOICE SANITY ───────────────────────────────────────────

    const invoiceSanity: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS total,
        COALESCE(SUM("balanceDue"), 0)::float AS "totalBalance",
        COUNT(CASE WHEN "balanceDue" > 50000 THEN 1 END)::int AS "over50k",
        COUNT(CASE WHEN "balanceDue" < 0 THEN 1 END)::int AS "negative",
        COUNT(CASE WHEN status::text = 'PAID' AND "balanceDue" > 0 THEN 1 END)::int AS "paidWithBalance",
        COALESCE(MAX("balanceDue"), 0)::float AS "maxBalance"
      FROM "Invoice"
    `)
    const inv = invoiceSanity[0] || {}
    if (inv.paidWithBalance > 0) {
      issues.push({
        category: 'INVOICES',
        severity: 'HIGH',
        title: 'Invoices marked PAID but still have balance due',
        detail: `${inv.paidWithBalance} invoices show status=PAID but balanceDue > 0. These inflate AR totals.`,
        count: inv.paidWithBalance,
        fix: 'Either set balanceDue to 0 for PAID invoices, or correct the status',
      })
    }
    if (inv.negative > 0) {
      issues.push({
        category: 'INVOICES',
        severity: 'MEDIUM',
        title: 'Invoices with negative balance',
        detail: `${inv.negative} invoices have negative balanceDue.`,
        count: inv.negative,
      })
    }

    // ─── 6. ORPHANED RECORDS ─────────────────────────────────────────

    const orphanedOrders: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS cnt
      FROM "Order" o
      LEFT JOIN "Builder" b ON o."builderId" = b.id
      WHERE b.id IS NULL
    `)
    if (orphanedOrders[0]?.cnt > 0) {
      issues.push({
        category: 'ORPHANS',
        severity: 'MEDIUM',
        title: 'Orders with no matching builder',
        detail: `${orphanedOrders[0].cnt} orders reference a builderId that doesn't exist.`,
        count: orphanedOrders[0].cnt,
        fix: 'Link to correct builder or assign to a catch-all "Unknown" builder',
      })
    }

    const orphanedInvoices: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS cnt
      FROM "Invoice" i
      LEFT JOIN "Builder" b ON i."builderId" = b.id
      WHERE b.id IS NULL
    `)
    if (orphanedInvoices[0]?.cnt > 0) {
      issues.push({
        category: 'ORPHANS',
        severity: 'MEDIUM',
        title: 'Invoices with no matching builder',
        detail: `${orphanedInvoices[0].cnt} invoices reference a builderId that doesn't exist.`,
        count: orphanedInvoices[0].cnt,
      })
    }

    // ─── 7. DUPLICATE DETECTION ──────────────────────────────────────

    const dupSkus: any[] = await prisma.$queryRawUnsafe(`
      SELECT sku, COUNT(*)::int AS cnt
      FROM "Product"
      WHERE active = true AND sku IS NOT NULL
      GROUP BY sku
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC
      LIMIT 10
    `)
    if (dupSkus.length > 0) {
      const totalDups = dupSkus.reduce((s, d) => s + d.cnt, 0)
      issues.push({
        category: 'DUPLICATES',
        severity: 'HIGH',
        title: 'Duplicate active product SKUs',
        detail: `${dupSkus.length} SKUs appear multiple times (${totalDups} total records). Inventory, pricing, and order items may be split across dupes.`,
        count: totalDups,
        fix: 'Merge duplicates: consolidate inventory, reassign order items, deactivate extras',
        samples: dupSkus,
      })
    }

    const dupInvoiceNums: any[] = await prisma.$queryRawUnsafe(`
      SELECT "invoiceNumber", COUNT(*)::int AS cnt
      FROM "Invoice"
      WHERE "invoiceNumber" IS NOT NULL
      GROUP BY "invoiceNumber"
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC
      LIMIT 10
    `)
    if (dupInvoiceNums.length > 0) {
      issues.push({
        category: 'DUPLICATES',
        severity: 'HIGH',
        title: 'Duplicate invoice numbers',
        detail: `${dupInvoiceNums.length} invoice numbers appear multiple times. AR totals are doubled.`,
        count: dupInvoiceNums.reduce((s, d) => s + d.cnt, 0),
        fix: 'Deduplicate — keep latest, void/remove extras',
        samples: dupInvoiceNums,
      })
    }

    // ─── 8. AGGREGATE SANITY CHECKS ──────────────────────────────────

    const aggregates: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        (SELECT COUNT(*)::int FROM "Product" WHERE active = true) AS "activeProducts",
        (SELECT COUNT(*)::int FROM "InventoryItem") AS "inventoryItems",
        (SELECT COUNT(*)::int FROM "Builder") AS "builders",
        (SELECT COUNT(*)::int FROM "Order") AS "orders",
        (SELECT COALESCE(SUM(total), 0)::float FROM "Order" WHERE status::text != 'CANCELLED') AS "totalOrderRevenue",
        (SELECT COUNT(*)::int FROM "Invoice") AS "invoices",
        (SELECT COALESCE(SUM("balanceDue"), 0)::float FROM "Invoice" WHERE status::text NOT IN ('PAID', 'VOID', 'WRITE_OFF')) AS "totalAR",
        (SELECT COUNT(*)::int FROM "Job") AS "jobs",
        (SELECT COUNT(*)::int FROM "Quote") AS "quotes",
        (SELECT COUNT(*)::int FROM "PurchaseOrder") AS "purchaseOrders"
    `)

    // Sort by severity
    const severityOrder: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
    issues.sort((a, b) => (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99))

    return safeJson({
      generatedAt: new Date().toISOString(),
      aggregates: aggregates[0] || {},
      issueCount: {
        total: issues.length,
        critical: issues.filter(i => i.severity === 'CRITICAL').length,
        high: issues.filter(i => i.severity === 'HIGH').length,
        medium: issues.filter(i => i.severity === 'MEDIUM').length,
      },
      issues,
    })
  } catch (error: any) {
    console.error('[Data Quality Audit] Error:', error)
    return NextResponse.json(
      { error: 'Data quality audit failed', detail: error.message },
      { status: 500 }
    )
  }
}
