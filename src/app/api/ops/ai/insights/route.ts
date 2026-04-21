export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// AI INSIGHTS API — Real-time intelligence from autonomous scans
//
// GET  /api/ops/ai/insights — fetch all insights with summary
// POST /api/ops/ai/insights — acknowledge/dismiss an insight
//
// Insights are computed live from Abel OS data on each request:
//   - MARGIN: Products with margin < 10%
//   - AR: Builders with >$50K overdue invoices
//   - INVENTORY: Items with onHand = 0
//   - SALES: Quotes sent but not followed up in 5+ days
//   - GROWTH: Builders with increasing order frequency
//   - COLLECTION: Invoices 30+ days past due without recent action
//
// Each insight has severity (CRITICAL|WARNING|INFO) and is tagged with:
//   entityType, entityId, entityLabel, impact ($ or %), source (scan type)
// ──────────────────────────────────────────────────────────────────────────

type InsightCategory = 'MARGIN' | 'AR' | 'INVENTORY' | 'SALES' | 'GROWTH' | 'COLLECTION'
type InsightSeverity = 'CRITICAL' | 'WARNING' | 'INFO'

interface Insight {
  id: string
  category: InsightCategory
  severity: InsightSeverity
  title: string
  description: string
  impact: string // $ amount or %
  entityType: string // 'product', 'builder', 'quote', 'invoice'
  entityId: string | null
  entityLabel: string | null
  createdAt: string
  source: string // 'margin_scan', 'ar_scan', etc.
}

interface InsightSummary {
  total: number
  critical: number
  warning: number
  info: number
  categories: Record<InsightCategory, number>
}

interface SuccessResponse {
  insights: Insight[]
  summary: InsightSummary
  generatedAt: string
}

// Generate unique insight ID
function generateInsightId(category: InsightCategory, entityId: string | null): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).slice(2, 8)
  return `insight_${category.toLowerCase()}_${timestamp}_${random}`
}

async function generateInsights(): Promise<Insight[]> {
  const insights: Insight[] = []
  const now = new Date()
  const fiveDaysAgo = new Date(now.getTime() - 5 * 86400000)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000)

  try {
    // ────────────────────────────────────────────────────────────────
    // 1. MARGIN ALERTS: Products where margin < 10%
    // ────────────────────────────────────────────────────────────────
    const lowMarginProducts: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        id,
        sku,
        name,
        cost,
        "basePrice",
        ("basePrice" - cost) AS margin_amount,
        CASE
          WHEN "basePrice" > 0 THEN ROUND((("basePrice" - cost) / "basePrice" * 100)::numeric, 1)
          ELSE 0
        END AS margin_pct
      FROM "Product"
      WHERE active = true
        AND cost > 0
        AND "basePrice" > 0
        AND ("basePrice" - cost) / "basePrice" < 0.10
      ORDER BY margin_pct ASC
      LIMIT 20
    `)

    for (const product of lowMarginProducts) {
      const marginPct = Number(product.margin_pct || 0)
      insights.push({
        id: generateInsightId('MARGIN', product.id),
        category: 'MARGIN',
        severity: marginPct < 0.05 ? 'CRITICAL' : 'WARNING',
        title: `Low margin: ${product.name}`,
        description: `Product margin is ${marginPct.toFixed(1)}% — below 10% threshold. Cost: $${product.cost.toFixed(2)}, Price: $${product.basePrice.toFixed(2)}.`,
        impact: `$${(product.margin_amount || 0).toFixed(2)} per unit`,
        entityType: 'product',
        entityId: product.id,
        entityLabel: product.sku,
        createdAt: now.toISOString(),
        source: 'margin_scan',
      })
    }

    // ────────────────────────────────────────────────────────────────
    // 2. AR RISK: Builders with >$50K overdue
    // ────────────────────────────────────────────────────────────────
    const arRiskBuilders: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        b."id",
        b."companyName",
        SUM(i."balanceDue")::float AS total_overdue
      FROM "Builder" b
      LEFT JOIN "Invoice" i ON b."id" = i."builderId"
      WHERE i."status"::text IN ('OVERDUE', 'SENT')
        AND i."dueDate" < NOW()
      GROUP BY b."id", b."companyName"
      HAVING SUM(i."balanceDue")::float > 50000
      ORDER BY total_overdue DESC
      LIMIT 10
    `)

    for (const builder of arRiskBuilders) {
      const overdueAmount = builder.total_overdue || 0
      insights.push({
        id: generateInsightId('AR', builder.id),
        category: 'AR',
        severity: overdueAmount > 100000 ? 'CRITICAL' : 'WARNING',
        title: `High AR exposure: ${builder.companyName}`,
        description: `Builder has $${overdueAmount.toFixed(0)} in overdue invoices. Consider placing account on hold or escalating.`,
        impact: `$${overdueAmount.toFixed(0)} at risk`,
        entityType: 'builder',
        entityId: builder.id,
        entityLabel: builder.companyName,
        createdAt: now.toISOString(),
        source: 'ar_scan',
      })
    }

    // ────────────────────────────────────────────────────────────────
    // 3. INVENTORY STOCKOUTS: Items where onHand = 0
    // ────────────────────────────────────────────────────────────────
    const stockouts: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        ii."id",
        ii."productId",
        ii."productName",
        ii."sku",
        ii."reorderPoint",
        ii."reorderQty",
        COUNT(oi."id") AS pending_orders
      FROM "InventoryItem" ii
      LEFT JOIN "OrderItem" oi ON ii."productId" = oi."productId"
        AND oi."createdAt" > NOW() - INTERVAL '14 days'
      WHERE ii."onHand" = 0
        AND ii."status"::text != 'DISCONTINUED'
      GROUP BY ii."id", ii."productId", ii."productName", ii."sku", ii."reorderPoint", ii."reorderQty"
      ORDER BY pending_orders DESC
      LIMIT 15
    `)

    for (const item of stockouts) {
      const pendingOrders = Number(item.pending_orders || 0)
      insights.push({
        id: generateInsightId('INVENTORY', item.productId),
        category: 'INVENTORY',
        severity: pendingOrders > 2 ? 'CRITICAL' : 'WARNING',
        title: `Stockout: ${item.sku}`,
        description: `${item.productName} is out of stock with ${pendingOrders} pending orders. Reorder point: ${item.reorderPoint}, Qty: ${item.reorderQty}.`,
        impact: `${pendingOrders} orders delayed`,
        entityType: 'inventory',
        entityId: item.productId,
        entityLabel: item.sku,
        createdAt: now.toISOString(),
        source: 'inventory_scan',
      })
    }

    // ────────────────────────────────────────────────────────────────
    // 4. STALE QUOTES: Sent but not followed up in 5+ days
    // ────────────────────────────────────────────────────────────────
    const staleQuotes: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        q."id",
        q."quoteNumber",
        p."projectName",
        b."companyName",
        q."createdAt",
        q."total",
        EXTRACT(DAY FROM NOW() - q."createdAt")::int AS days_old
      FROM "Quote" q
      JOIN "Project" p ON q."projectId" = p."id"
      JOIN "Builder" b ON p."builderId" = b."id"
      WHERE q."status"::text = 'SENT'
        AND q."createdAt" < NOW() - INTERVAL '5 days'
        AND NOT EXISTS (
          SELECT 1 FROM "Activity" a
          WHERE a."entityId" = q."id"
            AND a."entityType" = 'Quote'
            AND a."kind"::text IN ('FOLLOW_UP', 'EMAIL_SENT', 'CALL_MADE')
            AND a."createdAt" > NOW() - INTERVAL '5 days'
        )
      ORDER BY q."createdAt" ASC
      LIMIT 20
    `)

    for (const quote of staleQuotes) {
      const daysOld = quote.days_old || 0
      insights.push({
        id: generateInsightId('SALES', quote.id),
        category: 'SALES',
        severity: daysOld > 14 ? 'CRITICAL' : 'WARNING',
        title: `Stale quote: ${quote.quoteNumber}`,
        description: `Quote for ${quote.projectName} (${quote.companyName}) sent ${daysOld} days ago, no follow-up. Value: $${quote.total.toFixed(0)}.`,
        impact: `$${quote.total.toFixed(0)} pipeline at risk`,
        entityType: 'quote',
        entityId: quote.id,
        entityLabel: quote.quoteNumber,
        createdAt: now.toISOString(),
        source: 'sales_scan',
      })
    }

    // ────────────────────────────────────────────────────────────────
    // 5. GROWTH SIGNALS: Builders with increasing order frequency
    // ────────────────────────────────────────────────────────────────
    const growthBuilders: any[] = await prisma.$queryRawUnsafe(`
      WITH prior_month AS (
        SELECT
          o."builderId",
          COUNT(*) AS prior_count,
          SUM(o."total")::float AS prior_total
        FROM "Order" o
        WHERE o."createdAt" BETWEEN
          NOW() - INTERVAL '60 days' AND NOW() - INTERVAL '30 days'
        GROUP BY o."builderId"
      ),
      current_month AS (
        SELECT
          o."builderId",
          COUNT(*) AS current_count,
          SUM(o."total")::float AS current_total
        FROM "Order" o
        WHERE o."createdAt" > NOW() - INTERVAL '30 days'
        GROUP BY o."builderId"
      )
      SELECT
        b."id",
        b."companyName",
        COALESCE(pm.prior_count, 0)::int AS prior_count,
        COALESCE(cm.current_count, 0)::int AS current_count,
        COALESCE(cm.current_total, 0) AS current_total,
        ROUND((COALESCE(cm.current_count, 0)::float / NULLIF(COALESCE(pm.prior_count, 1), 0) * 100 - 100)::numeric, 0)::int AS growth_pct
      FROM "Builder" b
      LEFT JOIN prior_month pm ON b."id" = pm."builderId"
      LEFT JOIN current_month cm ON b."id" = cm."builderId"
      WHERE COALESCE(cm.current_count, 0) > COALESCE(pm.prior_count, 0)
        AND COALESCE(pm.prior_count, 0) > 0
      ORDER BY growth_pct DESC
      LIMIT 10
    `)

    for (const builder of growthBuilders) {
      const growthPct = Number(builder.growth_pct || 0)
      insights.push({
        id: generateInsightId('GROWTH', builder.id),
        category: 'GROWTH',
        severity: growthPct > 50 ? 'INFO' : 'INFO', // Always INFO, it's positive
        title: `Growth opportunity: ${builder.companyName}`,
        description: `Orders up ${growthPct}% month-over-month (${builder.prior_count} → ${builder.current_count}). Total volume: $${builder.current_total.toFixed(0)}. Consider deepening relationship.`,
        impact: `+${growthPct}% order growth`,
        entityType: 'builder',
        entityId: builder.id,
        entityLabel: builder.companyName,
        createdAt: now.toISOString(),
        source: 'growth_scan',
      })
    }

    // ────────────────────────────────────────────────────────────────
    // 6. COLLECTION NEEDS: Invoices 30+ days past due without action
    // ────────────────────────────────────────────────────────────────
    const collectionNeeds: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        i."id",
        i."invoiceNumber",
        b."companyName",
        i."balanceDue",
        i."dueDate",
        MAX(ca."sentAt")::timestamp AS last_action,
        EXTRACT(DAY FROM NOW() - i."dueDate")::int AS days_overdue
      FROM "Invoice" i
      JOIN "Builder" b ON i."builderId" = b."id"
      LEFT JOIN "CollectionAction" ca ON i."id" = ca."invoiceId"
      WHERE i."status"::text IN ('OVERDUE', 'SENT')
        AND i."dueDate" < NOW() - INTERVAL '30 days'
        AND (ca."sentAt" IS NULL OR ca."sentAt" < NOW() - INTERVAL '7 days')
      GROUP BY i."id", i."invoiceNumber", b."companyName", i."balanceDue", i."dueDate"
      ORDER BY days_overdue DESC
      LIMIT 15
    `)

    for (const invoice of collectionNeeds) {
      const daysOverdue = invoice.days_overdue || 0
      insights.push({
        id: generateInsightId('COLLECTION', invoice.id),
        category: 'COLLECTION',
        severity: daysOverdue > 60 ? 'CRITICAL' : daysOverdue > 45 ? 'WARNING' : 'WARNING',
        title: `Collection action needed: ${invoice.invoiceNumber}`,
        description: `${invoice.companyName} owes $${invoice.balanceDue.toFixed(0)} — ${daysOverdue} days overdue. No action in last 7 days. Consider escalation.`,
        impact: `$${invoice.balanceDue.toFixed(0)} uncollected`,
        entityType: 'invoice',
        entityId: invoice.id,
        entityLabel: invoice.invoiceNumber,
        createdAt: now.toISOString(),
        source: 'collection_scan',
      })
    }
  } catch (err) {
    console.error('Error generating insights:', err)
    // Return empty array on any query failure — insights are advisory, not critical
  }

  return insights
}

function summarizeInsights(insights: Insight[]): InsightSummary {
  const summary: InsightSummary = {
    total: insights.length,
    critical: 0,
    warning: 0,
    info: 0,
    categories: {
      MARGIN: 0,
      AR: 0,
      INVENTORY: 0,
      SALES: 0,
      GROWTH: 0,
      COLLECTION: 0,
    },
  }

  for (const insight of insights) {
    if (insight.severity === 'CRITICAL') summary.critical++
    else if (insight.severity === 'WARNING') summary.warning++
    else summary.info++

    summary.categories[insight.category]++
  }

  return summary
}

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/ai/insights
// ──────────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  try {
    const insights = await generateInsights()
    const summary = summarizeInsights(insights)

    // Sort by severity desc, then by createdAt desc
    insights.sort((a, b) => {
      const severityOrder = { CRITICAL: 0, WARNING: 1, INFO: 2 }
      const sevDiff =
        severityOrder[a.severity as InsightSeverity] - severityOrder[b.severity as InsightSeverity]
      if (sevDiff !== 0) return sevDiff
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })

    const response: SuccessResponse = {
      insights,
      summary,
      generatedAt: new Date().toISOString(),
    }

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    console.error('GET /api/ops/ai/insights error:', error)
    return NextResponse.json(
      { error: 'Failed to generate insights' },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/ai/insights
// Dismiss/acknowledge an insight. For now, just returns success.
// ──────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest): Promise<NextResponse> {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { insightId, action } = body

    if (!insightId || !action) {
      return NextResponse.json(
        { error: 'insightId and action required' },
        { status: 400 }
      )
    }

    // For now, acknowledge is fire-and-forget
    // In production, store dismissals in a table so they don't re-surface
    if (action === 'dismiss' || action === 'acknowledge') {
      audit(request, `INSIGHT_${action.toUpperCase()}`, 'Insight', insightId).catch(() => {})
      return NextResponse.json(
        { success: true, message: `Insight ${action}ed` },
        { status: 200 }
      )
    }

    return NextResponse.json(
      { error: 'Unknown action' },
      { status: 400 }
    )
  } catch (error) {
    console.error('POST /api/ops/ai/insights error:', error)
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    )
  }
}
