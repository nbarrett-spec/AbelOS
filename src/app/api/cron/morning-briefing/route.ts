export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendEmail, wrap } from '@/lib/email'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Fetch all metrics
    const [revenue, orders, ar, pipeline, alerts, schedule] = await Promise.all([
      fetchRevenueMetrics(),
      fetchOrdersMetrics(),
      fetchARHealth(),
      fetchPipelineMetrics(),
      fetchAlerts(),
      fetchTodaySchedule(),
    ])

    // Format date for email subject
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const dateStr = yesterday.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })

    // Build HTML email
    const html = buildBriefingHTML({
      yesterday: yesterday,
      revenue,
      orders,
      ar,
      pipeline,
      alerts,
      schedule,
    })

    // Wrap in template and send
    const wrappedHtml = wrap(html)
    await sendEmail({
      to: 'n.barrett@abellumber.com,clint@abellumber.com',
      subject: `☀️ Abel Morning Brief — ${dateStr}`,
      html: wrappedHtml,
    })

    console.log('[morning-briefing] Email sent successfully', {
      revenue,
      orders,
      ar,
      pipeline,
      alerts,
      schedule,
    })

    return NextResponse.json({
      success: true,
      metrics: {
        revenue,
        orders,
        ar,
        pipeline,
        alerts,
        schedule,
      },
    })
  } catch (error) {
    console.error('[morning-briefing] Error:', error)
    return NextResponse.json(
      { error: 'Failed to generate briefing', details: String(error) },
      { status: 500 }
    )
  }
}

async function fetchRevenueMetrics() {
  const result = await prisma.$queryRawUnsafe<
    Array<{ yesterday: number; mtd: number }>
  >(`
    SELECT
      COALESCE(SUM(CASE WHEN i."issuedAt"::date = CURRENT_DATE - 1 THEN i."total" ELSE 0 END), 0)::float AS "yesterday",
      COALESCE(SUM(CASE WHEN EXTRACT(MONTH FROM i."issuedAt") = EXTRACT(MONTH FROM NOW()) AND EXTRACT(YEAR FROM i."issuedAt") = EXTRACT(YEAR FROM NOW()) THEN i."total" ELSE 0 END), 0)::float AS "mtd"
    FROM "Invoice" i
    WHERE i."status"::text = 'PAID'
  `)
  return result[0] || { yesterday: 0, mtd: 0 }
}

async function fetchOrdersMetrics() {
  const result = await prisma.$queryRawUnsafe<
    Array<{ newYesterday: number; openOrders: number; shippedYesterday: number }>
  >(`
    SELECT
      COUNT(CASE WHEN o."createdAt"::date = CURRENT_DATE - 1 THEN 1 END)::int AS "newYesterday",
      COUNT(CASE WHEN o."status"::text NOT IN ('DELIVERED','CANCELLED') THEN 1 END)::int AS "openOrders",
      COUNT(CASE WHEN o."updatedAt"::date = CURRENT_DATE - 1 AND o."status"::text = 'DELIVERED' THEN 1 END)::int AS "shippedYesterday"
    FROM "Order" o
  `)
  return result[0] || { newYesterday: 0, openOrders: 0, shippedYesterday: 0 }
}

async function fetchARHealth() {
  const result = await prisma.$queryRawUnsafe<
    Array<{ totalAR: number; overdue: number }>
  >(`
    SELECT
      COALESCE(SUM(i."total"), 0)::float AS "totalAR",
      COALESCE(SUM(CASE WHEN i."dueDate" < NOW() THEN i."total" ELSE 0 END), 0)::float AS "overdue"
    FROM "Invoice" i
    WHERE i."status"::text IN ('SENT', 'OVERDUE', 'PARTIALLY_PAID')
  `)

  const arData = result[0] || { totalAR: 0, overdue: 0 }

  // Calculate DSO: (Outstanding AR / Daily Revenue) where daily revenue is 30-day average
  const thirtyDayRevenue = await prisma.$queryRawUnsafe<
    Array<{ thirtyDayTotal: number }>
  >(`
    SELECT COALESCE(SUM(i."total"), 0)::float AS "thirtyDayTotal"
    FROM "Invoice" i
    WHERE i."status"::text = 'PAID'
      AND i."issuedAt" >= CURRENT_DATE - INTERVAL '30 days'
  `)

  const dailyRevenue =
    (thirtyDayRevenue[0]?.thirtyDayTotal || 0) / 30
  const dso = dailyRevenue > 0 ? Math.round(arData.totalAR / dailyRevenue) : 0

  return {
    totalAR: arData.totalAR,
    overdue: arData.overdue,
    dso,
  }
}

async function fetchPipelineMetrics() {
  const result = await prisma.$queryRawUnsafe<
    Array<{ openDeals: number; pipelineValue: number; wonYesterday: number }>
  >(`
    SELECT
      COUNT(CASE WHEN d."stage"::text NOT IN ('WON','LOST') THEN 1 END)::int AS "openDeals",
      COALESCE(SUM(CASE WHEN d."stage"::text NOT IN ('WON','LOST') THEN d."dealValue" ELSE 0 END), 0)::float AS "pipelineValue",
      COUNT(CASE WHEN d."stage"::text = 'WON' AND d."actualCloseDate"::date = CURRENT_DATE - 1 THEN 1 END)::int AS "wonYesterday"
    FROM "Deal" d
  `)
  return result[0] || { openDeals: 0, pipelineValue: 0, wonYesterday: 0 }
}

async function fetchAlerts() {
  const result = await prisma.$queryRawUnsafe<
    Array<{ alertCount: number }>
  >(`
    SELECT COUNT(*)::int AS "alertCount"
    FROM "AgentTask"
    WHERE status = 'PENDING' AND priority = 'HIGH'
  `)
  return result[0]?.alertCount || 0
}

async function fetchTodaySchedule() {
  const result = await prisma.$queryRawUnsafe<
    Array<{ todayJobs: number }>
  >(`
    SELECT COUNT(*)::int AS "todayJobs"
    FROM "Job"
    WHERE "scheduledDate"::date = CURRENT_DATE
      AND "status"::text NOT IN ('COMPLETED','CANCELLED')
  `)
  return result[0]?.todayJobs || 0
}

function buildBriefingHTML(params: {
  yesterday: Date
  revenue: { yesterday: number; mtd: number }
  orders: { newYesterday: number; openOrders: number; shippedYesterday: number }
  ar: { totalAR: number; overdue: number; dso: number }
  pipeline: { openDeals: number; pipelineValue: number; wonYesterday: number }
  alerts: number
  schedule: number
}): string {
  const { revenue, orders, ar, pipeline, alerts, schedule, yesterday } = params

  const yesterdayStr = yesterday.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })

  const formatCurrency = (num: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(num)
  }

  const formatMetric = (num: number) => {
    return num.toLocaleString('en-US')
  }

  const statusColor = (isGood: boolean) => (isGood ? '#22c55e' : '#ef4444')

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1f2937; line-height: 1.6;">

      <h1 style="font-size: 24px; font-weight: 700; color: #3E2A1E; margin: 0 0 8px 0;">
        Morning Briefing
      </h1>
      <p style="margin: 0 0 24px 0; color: #6b7280; font-size: 14px;">
        ${yesterdayStr}
      </p>

      <!-- Revenue Section -->
      <div style="background: #f9fafb; border-left: 4px solid #C9822B; padding: 20px; margin-bottom: 20px; border-radius: 4px;">
        <h2 style="font-size: 14px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 16px 0;">
          Revenue Snapshot
        </h2>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <div>
            <p style="font-size: 12px; color: #9ca3af; margin: 0 0 4px 0; text-transform: uppercase;">Yesterday</p>
            <p style="font-size: 28px; font-weight: 700; color: #1f2937; margin: 0;">
              ${formatCurrency(revenue.yesterday)}
            </p>
          </div>
          <div>
            <p style="font-size: 12px; color: #9ca3af; margin: 0 0 4px 0; text-transform: uppercase;">Month to Date</p>
            <p style="font-size: 28px; font-weight: 700; color: #1f2937; margin: 0;">
              ${formatCurrency(revenue.mtd)}
            </p>
          </div>
        </div>
      </div>

      <!-- Orders Section -->
      <div style="background: #f9fafb; border-left: 4px solid #C9822B; padding: 20px; margin-bottom: 20px; border-radius: 4px;">
        <h2 style="font-size: 14px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 16px 0;">
          Orders
        </h2>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px;">
          <div>
            <p style="font-size: 12px; color: #9ca3af; margin: 0 0 4px 0; text-transform: uppercase;">New Yesterday</p>
            <p style="font-size: 28px; font-weight: 700; color: #1f2937; margin: 0;">
              ${formatMetric(orders.newYesterday)}
            </p>
          </div>
          <div>
            <p style="font-size: 12px; color: #9ca3af; margin: 0 0 4px 0; text-transform: uppercase;">Open Orders</p>
            <p style="font-size: 28px; font-weight: 700; color: #1f2937; margin: 0;">
              ${formatMetric(orders.openOrders)}
            </p>
          </div>
          <div>
            <p style="font-size: 12px; color: #9ca3af; margin: 0 0 4px 0; text-transform: uppercase;">Shipped Yesterday</p>
            <p style="font-size: 28px; font-weight: 700; color: #1f2937; margin: 0;">
              ${formatMetric(orders.shippedYesterday)}
            </p>
          </div>
        </div>
      </div>

      <!-- AR Health Section -->
      <div style="background: #f9fafb; border-left: 4px solid #C9822B; padding: 20px; margin-bottom: 20px; border-radius: 4px;">
        <h2 style="font-size: 14px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 16px 0;">
          AR Health
        </h2>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px;">
          <div>
            <p style="font-size: 12px; color: #9ca3af; margin: 0 0 4px 0; text-transform: uppercase;">Total Outstanding</p>
            <p style="font-size: 28px; font-weight: 700; color: #1f2937; margin: 0;">
              ${formatCurrency(ar.totalAR)}
            </p>
          </div>
          <div>
            <p style="font-size: 12px; color: #9ca3af; margin: 0 0 4px 0; text-transform: uppercase;">Overdue</p>
            <p style="font-size: 28px; font-weight: 700; color: ${ar.overdue > 0 ? '#ef4444' : '#22c55e'}; margin: 0;">
              ${formatCurrency(ar.overdue)}
            </p>
          </div>
          <div>
            <p style="font-size: 12px; color: #9ca3af; margin: 0 0 4px 0; text-transform: uppercase;">DSO</p>
            <p style="font-size: 28px; font-weight: 700; color: #1f2937; margin: 0;">
              ${ar.dso} days
            </p>
          </div>
        </div>
      </div>

      <!-- Pipeline Section -->
      <div style="background: #f9fafb; border-left: 4px solid #C9822B; padding: 20px; margin-bottom: 20px; border-radius: 4px;">
        <h2 style="font-size: 14px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 16px 0;">
          Pipeline
        </h2>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px;">
          <div>
            <p style="font-size: 12px; color: #9ca3af; margin: 0 0 4px 0; text-transform: uppercase;">Open Deals</p>
            <p style="font-size: 28px; font-weight: 700; color: #1f2937; margin: 0;">
              ${formatMetric(pipeline.openDeals)}
            </p>
          </div>
          <div>
            <p style="font-size: 12px; color: #9ca3af; margin: 0 0 4px 0; text-transform: uppercase;">Pipeline Value</p>
            <p style="font-size: 28px; font-weight: 700; color: #1f2937; margin: 0;">
              ${formatCurrency(pipeline.pipelineValue)}
            </p>
          </div>
          <div>
            <p style="font-size: 12px; color: #9ca3af; margin: 0 0 4px 0; text-transform: uppercase;">Won Yesterday</p>
            <p style="font-size: 28px; font-weight: 700; color: #22c55e; margin: 0;">
              ${formatMetric(pipeline.wonYesterday)}
            </p>
          </div>
        </div>
      </div>

      <!-- Alerts & Schedule Section -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
        <div style="background: #f9fafb; border-left: 4px solid #C9822B; padding: 20px; border-radius: 4px;">
          <h2 style="font-size: 14px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 12px 0;">
            Alerts
          </h2>
          <p style="font-size: 28px; font-weight: 700; color: ${alerts > 0 ? '#ef4444' : '#22c55e'}; margin: 0;">
            ${formatMetric(alerts)} High Priority
          </p>
        </div>
        <div style="background: #f9fafb; border-left: 4px solid #C9822B; padding: 20px; border-radius: 4px;">
          <h2 style="font-size: 14px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 12px 0;">
            Today's Schedule
          </h2>
          <p style="font-size: 28px; font-weight: 700; color: #1f2937; margin: 0;">
            ${formatMetric(schedule)} Jobs
          </p>
        </div>
      </div>

      <p style="font-size: 12px; color: #9ca3af; margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
        Generated at ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Chicago' })} CT
      </p>

    </div>
  `
}
