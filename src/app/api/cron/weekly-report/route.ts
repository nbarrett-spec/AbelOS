export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendEmail, wrap } from '@/lib/email'

interface MetricsResult {
  revenueSummary: {
    thisWeek: number
    lastWeek: number
    percentChange: number
  }
  orders: {
    newThisWeek: number
    newLastWeek: number
    deliveredThisWeek: number
  }
  pipeline: {
    wonThisWeek: number
    lostThisWeek: number
    wonValue: number
    openDeals: number
    pipelineValue: number
  }
  arHealth: {
    totalAR: number
    overdue: number
    overdue30plus: number
    overdue60plus: number
  }
  topBuilders: Array<{
    companyName: string
    revenue: number
  }>
  newBuilders: Array<{
    companyName: string
    createdAt: Date
  }>
  inventory: {
    outOfStock: number
    lowStock: number
  }
  generatedAt: string
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

function getWeekStartDate(daysBack: number = 7): string {
  const now = new Date()
  const lastWeek = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000)
  return lastWeek.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function generateHTML(metrics: MetricsResult): string {
  const percentChange = metrics.revenueSummary.percentChange
  const revenueTrend = percentChange >= 0 ? '↑' : '↓'
  const revenueColor = percentChange >= 0 ? '#22c55e' : '#ef4444'

  const ordersThisWeek = metrics.orders.newThisWeek
  const ordersLastWeek = metrics.orders.newLastWeek
  const ordersChange = ordersLastWeek === 0 ? 0 : ((ordersThisWeek - ordersLastWeek) / ordersLastWeek) * 100
  const ordersTrend = ordersChange >= 0 ? '↑' : '↓'
  const ordersColor = ordersChange >= 0 ? '#22c55e' : '#ef4444'

  const topBuildersRows = metrics.topBuilders
    .map(
      (builder) =>
        `
    <tr style="border-bottom: 1px solid #e5e7eb;">
      <td style="padding: 12px; color: #1f2937; font-weight: 500;">${builder.companyName}</td>
      <td style="padding: 12px; text-align: right; color: #1f2937; font-weight: 600;">${formatCurrency(builder.revenue)}</td>
    </tr>
    `,
    )
    .join('')

  const newBuildersRows = metrics.newBuilders
    .map(
      (builder) =>
        `
    <tr style="border-bottom: 1px solid #e5e7eb;">
      <td style="padding: 12px; color: #1f2937;">${builder.companyName}</td>
      <td style="padding: 12px; color: #666; font-size: 13px;">${new Date(builder.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
    </tr>
    `,
    )
    .join('')

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Abel Weekly Report</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; background-color: #f9fafb; margin: 0; padding: 20px;">
  <div style="max-width: 900px; margin: 0 auto;">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #3E2A1E 0%, #2a1f15 100%); color: white; padding: 40px 20px; border-radius: 8px 8px 0 0; text-align: center;">
      <h1 style="margin: 0; font-size: 28px; font-weight: 600;">📊 Abel Weekly Ops Report</h1>
      <p style="margin: 8px 0 0 0; font-size: 14px; opacity: 0.9;">Week of ${getWeekStartDate(7)}</p>
      <p style="margin: 4px 0 0 0; font-size: 12px; opacity: 0.8;">Generated ${metrics.generatedAt}</p>
    </div>

    <!-- Revenue Summary Card -->
    <div style="background: white; border: 1px solid #e5e7eb; margin-top: 0; padding: 24px; border-radius: 0;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
        <h2 style="margin: 0; font-size: 18px; font-weight: 600; color: #1f2937;">Revenue Summary</h2>
        <div style="font-size: 32px; color: ${revenueColor}; font-weight: 700;">${revenueTrend}</div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px;">
        <div style="padding: 16px; background: #f3f4f6; border-radius: 6px; border-left: 4px solid #C9822B;">
          <div style="font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 4px;">This Week</div>
          <div style="font-size: 24px; font-weight: 700; color: #1f2937;">${formatCurrency(metrics.revenueSummary.thisWeek)}</div>
        </div>
        <div style="padding: 16px; background: #f3f4f6; border-radius: 6px; border-left: 4px solid #999;">
          <div style="font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 4px;">Last Week</div>
          <div style="font-size: 24px; font-weight: 700; color: #1f2937;">${formatCurrency(metrics.revenueSummary.lastWeek)}</div>
        </div>
        <div style="padding: 16px; background: #f3f4f6; border-radius: 6px; border-left: 4px solid ${revenueColor};">
          <div style="font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 4px;">Week-over-Week</div>
          <div style="font-size: 24px; font-weight: 700; color: ${revenueColor};">${formatPercent(percentChange)}</div>
        </div>
      </div>
    </div>

    <!-- Orders & Delivery Card -->
    <div style="background: white; border: 1px solid #e5e7eb; border-top: none; padding: 24px;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
        <h2 style="margin: 0; font-size: 18px; font-weight: 600; color: #1f2937;">Orders & Delivery</h2>
        <div style="font-size: 32px; color: ${ordersColor}; font-weight: 700;">${ordersTrend}</div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px;">
        <div style="padding: 16px; background: #f3f4f6; border-radius: 6px; border-left: 4px solid #C9822B;">
          <div style="font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 4px;">New Orders (This Week)</div>
          <div style="font-size: 24px; font-weight: 700; color: #1f2937;">${metrics.orders.newThisWeek}</div>
        </div>
        <div style="padding: 16px; background: #f3f4f6; border-radius: 6px; border-left: 4px solid #999;">
          <div style="font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 4px;">New Orders (Last Week)</div>
          <div style="font-size: 24px; font-weight: 700; color: #1f2937;">${metrics.orders.newLastWeek}</div>
        </div>
        <div style="padding: 16px; background: #f3f4f6; border-radius: 6px; border-left: 4px solid #10b981;">
          <div style="font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 4px;">Delivered (This Week)</div>
          <div style="font-size: 24px; font-weight: 700; color: #1f2937;">${metrics.orders.deliveredThisWeek}</div>
        </div>
      </div>
    </div>

    <!-- Sales Pipeline Card -->
    <div style="background: white; border: 1px solid #e5e7eb; border-top: none; padding: 24px;">
      <h2 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 600; color: #1f2937;">Sales Pipeline</h2>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
        <div style="padding: 16px; background: #f3f4f6; border-radius: 6px; border-left: 4px solid #10b981;">
          <div style="font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 4px;">Won (This Week)</div>
          <div style="font-size: 20px; font-weight: 700; color: #1f2937;">${metrics.pipeline.wonThisWeek} deals</div>
          <div style="font-size: 14px; color: #666; margin-top: 4px;">${formatCurrency(metrics.pipeline.wonValue)}</div>
        </div>
        <div style="padding: 16px; background: #f3f4f6; border-radius: 6px; border-left: 4px solid #ef4444;">
          <div style="font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 4px;">Lost (This Week)</div>
          <div style="font-size: 20px; font-weight: 700; color: #1f2937;">${metrics.pipeline.lostThisWeek} deals</div>
        </div>
        <div style="padding: 16px; background: #f3f4f6; border-radius: 6px; border-left: 4px solid #C9822B;">
          <div style="font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 4px;">Open Deals</div>
          <div style="font-size: 20px; font-weight: 700; color: #1f2937;">${metrics.pipeline.openDeals}</div>
        </div>
        <div style="padding: 16px; background: #f3f4f6; border-radius: 6px; border-left: 4px solid #3b82f6;">
          <div style="font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 4px;">Pipeline Value</div>
          <div style="font-size: 18px; font-weight: 700; color: #1f2937;">${formatCurrency(metrics.pipeline.pipelineValue)}</div>
        </div>
      </div>
    </div>

    <!-- AR Health Card -->
    <div style="background: white; border: 1px solid #e5e7eb; border-top: none; padding: 24px;">
      <h2 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 600; color: #1f2937;">AR Health</h2>
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 12px;">
        <div style="padding: 16px; background: #f3f4f6; border-radius: 6px; border-left: 4px solid #3b82f6;">
          <div style="font-size: 11px; color: #666; text-transform: uppercase; margin-bottom: 4px; font-weight: 600;">Total AR</div>
          <div style="font-size: 18px; font-weight: 700; color: #1f2937;">${formatCurrency(metrics.arHealth.totalAR)}</div>
        </div>
        <div style="padding: 16px; background: #fef3c7; border-radius: 6px; border-left: 4px solid #f59e0b;">
          <div style="font-size: 11px; color: #666; text-transform: uppercase; margin-bottom: 4px; font-weight: 600;">Overdue</div>
          <div style="font-size: 18px; font-weight: 700; color: #d97706;">${formatCurrency(metrics.arHealth.overdue)}</div>
        </div>
        <div style="padding: 16px; background: #fee2e2; border-radius: 6px; border-left: 4px solid #ef4444;">
          <div style="font-size: 11px; color: #666; text-transform: uppercase; margin-bottom: 4px; font-weight: 600;">30+ Days</div>
          <div style="font-size: 18px; font-weight: 700; color: #dc2626;">${formatCurrency(metrics.arHealth.overdue30plus)}</div>
        </div>
        <div style="padding: 16px; background: #fee2e2; border-radius: 6px; border-left: 4px solid #991b1b;">
          <div style="font-size: 11px; color: #666; text-transform: uppercase; margin-bottom: 4px; font-weight: 600;">60+ Days</div>
          <div style="font-size: 18px; font-weight: 700; color: #991b1b;">${formatCurrency(metrics.arHealth.overdue60plus)}</div>
        </div>
      </div>
    </div>

    <!-- Top Builders Card -->
    <div style="background: white; border: 1px solid #e5e7eb; border-top: none; padding: 24px;">
      <h2 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 600; color: #1f2937;">Top 5 Builders (This Week)</h2>
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="border-bottom: 2px solid #e5e7eb;">
            <th style="padding: 12px; text-align: left; font-weight: 600; font-size: 12px; color: #666; text-transform: uppercase;">Company</th>
            <th style="padding: 12px; text-align: right; font-weight: 600; font-size: 12px; color: #666; text-transform: uppercase;">Revenue</th>
          </tr>
        </thead>
        <tbody>
          ${topBuildersRows || '<tr><td style="padding: 12px; color: #999;">No data</td></tr>'}
        </tbody>
      </table>
    </div>

    <!-- New Builders Card -->
    <div style="background: white; border: 1px solid #e5e7eb; border-top: none; padding: 24px;">
      <h2 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 600; color: #1f2937;">New Builders (This Week)</h2>
      ${
        metrics.newBuilders.length > 0
          ? `
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="border-bottom: 2px solid #e5e7eb;">
            <th style="padding: 12px; text-align: left; font-weight: 600; font-size: 12px; color: #666; text-transform: uppercase;">Company</th>
            <th style="padding: 12px; text-align: left; font-weight: 600; font-size: 12px; color: #666; text-transform: uppercase;">Date Added</th>
          </tr>
        </thead>
        <tbody>
          ${newBuildersRows}
        </tbody>
      </table>
      `
          : '<p style="color: #999; font-size: 14px; margin: 0;">No new builders added this week</p>'
      }
    </div>

    <!-- Inventory Card -->
    <div style="background: white; border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
      <h2 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 600; color: #1f2937;">Inventory Alerts</h2>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div style="padding: 16px; background: #fee2e2; border-radius: 6px; border-left: 4px solid #dc2626;">
          <div style="font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 4px;">Out of Stock</div>
          <div style="font-size: 24px; font-weight: 700; color: #dc2626;">${metrics.inventory.outOfStock}</div>
        </div>
        <div style="padding: 16px; background: #fef3c7; border-radius: 6px; border-left: 4px solid #f59e0b;">
          <div style="font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 4px;">Low Stock</div>
          <div style="font-size: 24px; font-weight: 700; color: #d97706;">${metrics.inventory.lowStock}</div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div style="background: #f3f4f6; margin-top: 0; padding: 20px; text-align: center; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; border-top: none;">
      <p style="margin: 0; font-size: 12px; color: #666;">
        This report was automatically generated. Direct questions to <a href="mailto:n.barrett@abellumber.com" style="color: #C9822B; text-decoration: none;">n.barrett@abellumber.com</a>
      </p>
    </div>
  </div>
</body>
</html>
  `.trim()
}

export async function GET(request: NextRequest) {
  try {
    // Auth check
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const metrics: MetricsResult = {
      revenueSummary: {
        thisWeek: 0,
        lastWeek: 0,
        percentChange: 0,
      },
      orders: {
        newThisWeek: 0,
        newLastWeek: 0,
        deliveredThisWeek: 0,
      },
      pipeline: {
        wonThisWeek: 0,
        lostThisWeek: 0,
        wonValue: 0,
        openDeals: 0,
        pipelineValue: 0,
      },
      arHealth: {
        totalAR: 0,
        overdue: 0,
        overdue30plus: 0,
        overdue60plus: 0,
      },
      topBuilders: [],
      newBuilders: [],
      inventory: {
        outOfStock: 0,
        lowStock: 0,
      },
      generatedAt: new Date().toLocaleString('en-US', {
        timeZone: 'America/Chicago',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }),
    }

    // 1. Revenue Summary
    const revenueSummaryResults = await prisma.$queryRawUnsafe<
      Array<{ thisWeek: number; lastWeek: number }>
    >(`
      SELECT
        COALESCE(SUM(CASE WHEN i."issuedAt" >= NOW() - INTERVAL '7 days' THEN i."total" ELSE 0 END), 0)::float AS "thisWeek",
        COALESCE(SUM(CASE WHEN i."issuedAt" >= NOW() - INTERVAL '14 days' AND i."issuedAt" < NOW() - INTERVAL '7 days' THEN i."total" ELSE 0 END), 0)::float AS "lastWeek"
      FROM "Invoice" i WHERE i."status"::text = 'PAID'
    `)

    if (revenueSummaryResults.length > 0) {
      metrics.revenueSummary.thisWeek = revenueSummaryResults[0].thisWeek
      metrics.revenueSummary.lastWeek = revenueSummaryResults[0].lastWeek
      metrics.revenueSummary.percentChange =
        metrics.revenueSummary.lastWeek === 0
          ? 0
          : ((metrics.revenueSummary.thisWeek - metrics.revenueSummary.lastWeek) / metrics.revenueSummary.lastWeek) * 100
    }

    // 2. Orders
    const ordersResults = await prisma.$queryRawUnsafe<
      Array<{ newThisWeek: number; newLastWeek: number; deliveredThisWeek: number }>
    >(`
      SELECT
        COUNT(CASE WHEN o."createdAt" >= NOW() - INTERVAL '7 days' THEN 1 END)::int AS "newThisWeek",
        COUNT(CASE WHEN o."createdAt" >= NOW() - INTERVAL '14 days' AND o."createdAt" < NOW() - INTERVAL '7 days' THEN 1 END)::int AS "newLastWeek",
        COUNT(CASE WHEN o."status"::text = 'DELIVERED' AND o."updatedAt" >= NOW() - INTERVAL '7 days' THEN 1 END)::int AS "deliveredThisWeek"
      FROM "Order" o
    `)

    if (ordersResults.length > 0) {
      metrics.orders = ordersResults[0]
    }

    // 3. Sales Pipeline
    const pipelineResults = await prisma.$queryRawUnsafe<
      Array<{
        wonThisWeek: number
        lostThisWeek: number
        wonValue: number
        openDeals: number
        pipelineValue: number
      }>
    >(`
      SELECT
        COUNT(CASE WHEN d."stage"::text = 'WON' AND d."actualCloseDate" >= NOW() - INTERVAL '7 days' THEN 1 END)::int AS "wonThisWeek",
        COUNT(CASE WHEN d."stage"::text = 'LOST' AND d."lostDate" >= NOW() - INTERVAL '7 days' THEN 1 END)::int AS "lostThisWeek",
        COALESCE(SUM(CASE WHEN d."stage"::text = 'WON' AND d."actualCloseDate" >= NOW() - INTERVAL '7 days' THEN d."dealValue" ELSE 0 END), 0)::float AS "wonValue",
        COUNT(CASE WHEN d."stage"::text NOT IN ('WON','LOST') THEN 1 END)::int AS "openDeals",
        COALESCE(SUM(CASE WHEN d."stage"::text NOT IN ('WON','LOST') THEN d."dealValue" ELSE 0 END), 0)::float AS "pipelineValue"
      FROM "Deal" d
    `)

    if (pipelineResults.length > 0) {
      metrics.pipeline = pipelineResults[0]
    }

    // 4. AR Health
    const arResults = await prisma.$queryRawUnsafe<
      Array<{
        totalAR: number
        overdue: number
        overdue30plus: number
        overdue60plus: number
      }>
    >(`
      SELECT
        COALESCE(SUM(i."total"), 0)::float AS "totalAR",
        COALESCE(SUM(CASE WHEN i."dueDate" < NOW() THEN i."total" ELSE 0 END), 0)::float AS "overdue",
        COALESCE(SUM(CASE WHEN i."dueDate" < NOW() - INTERVAL '30 days' THEN i."total" ELSE 0 END), 0)::float AS "overdue30plus",
        COALESCE(SUM(CASE WHEN i."dueDate" < NOW() - INTERVAL '60 days' THEN i."total" ELSE 0 END), 0)::float AS "overdue60plus"
      FROM "Invoice" i WHERE i."status"::text IN ('SENT','OVERDUE','PARTIAL')
    `)

    if (arResults.length > 0) {
      metrics.arHealth = arResults[0]
    }

    // 5. Top 5 Builders
    const topBuildersResults = await prisma.$queryRawUnsafe<
      Array<{ companyName: string; revenue: number }>
    >(`
      SELECT b."companyName", COALESCE(SUM(i."total"), 0)::float AS "revenue"
      FROM "Invoice" i
      JOIN "Builder" b ON b."id" = i."builderId"
      WHERE i."status"::text = 'PAID' AND i."issuedAt" >= NOW() - INTERVAL '7 days'
      GROUP BY b."companyName"
      ORDER BY "revenue" DESC LIMIT 5
    `)

    metrics.topBuilders = topBuildersResults

    // 6. New Builders
    const newBuildersResults = await prisma.$queryRawUnsafe<
      Array<{ companyName: string; createdAt: Date }>
    >(`
      SELECT b."companyName", b."createdAt" FROM "Builder" b
      WHERE b."createdAt" >= NOW() - INTERVAL '7 days'
      ORDER BY b."createdAt" DESC
    `)

    metrics.newBuilders = newBuildersResults

    // 7. Inventory Alerts
    const inventoryResults = await prisma.$queryRawUnsafe<
      Array<{
        outOfStock: number
        lowStock: number
      }>
    >(`
      SELECT COUNT(CASE WHEN ii."onHand" <= 0 THEN 1 END)::int AS "outOfStock",
             COUNT(CASE WHEN ii."onHand" > 0 AND ii."onHand" <= ii."reorderPoint" THEN 1 END)::int AS "lowStock"
      FROM "InventoryItem" ii
      JOIN "Product" p ON p."id" = ii."productId" WHERE p."active" = true
    `)

    if (inventoryResults.length > 0) {
      metrics.inventory = inventoryResults[0]
    }

    // Generate HTML email
    const html = generateHTML(metrics)

    // Send email
    const weekStart = getWeekStartDate(7)
    const subject = `📊 Abel Weekly Ops Report — Week of ${weekStart}`

    // Send to both Nate and Clint
    await sendEmail({
      to: 'n.barrett@abellumber.com',
      subject,
      html: wrap(html),
    })
    await sendEmail({
      to: 'clint@abellumber.com',
      subject,
      html: wrap(html),
    })

    return NextResponse.json({
      success: true,
      message: 'Weekly report sent successfully',
      metrics,
      sentTo: ['n.barrett@abellumber.com', 'clint@abellumber.com'],
      subject,
    })
  } catch (error) {
    console.error('[weekly-report] Error:', error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    )
  }
}
