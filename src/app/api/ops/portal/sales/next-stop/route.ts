export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * GET /api/ops/portal/sales/next-stop?builderId=...
 *
 * Single-request payload for the in-vehicle "next stop" card.
 * Bundles: builder summary, last 3 comms, open items, AR flag,
 * recent orders, pipeline deals, and (optionally cached) AI snapshot.
 *
 * AI snapshot is NOT generated here — the page hits /api/ops/ai/builder-snapshot
 * separately so this endpoint stays fast and the driver sees data instantly.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const builderId = searchParams.get('builderId')
    if (!builderId) {
      return NextResponse.json({ error: 'builderId required' }, { status: 400 })
    }

    // Builder
    const builderRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id","companyName","contactName","city","state","phone","email","builderType","paymentTerm","accountBalance","creditLimit","territory"
       FROM "Builder" WHERE "id" = $1 LIMIT 1`,
      builderId,
    )
    if (!builderRows[0]) {
      return NextResponse.json({ error: 'builder not found' }, { status: 404 })
    }
    const builder = builderRows[0]

    const [
      commsRows,
      activitiesRows,
      openQuotesRows,
      inFlightOrdersRows,
      invoiceRows,
      recentOrdersRows,
      dealsRows,
    ] = await Promise.all([
      // Last 3 CommunicationLog entries (email/phone/visit)
      prisma.$queryRawUnsafe(
        `SELECT cl."id", cl."channel", cl."direction", cl."subject", cl."body", cl."sentAt", cl."createdAt",
                cl."staffId", s."firstName" || ' ' || s."lastName" AS "staffName"
         FROM "CommunicationLog" cl
         LEFT JOIN "Staff" s ON s."id" = cl."staffId"
         WHERE cl."builderId" = $1
         ORDER BY COALESCE(cl."sentAt", cl."createdAt") DESC
         LIMIT 3`,
        builderId,
      ) as Promise<any[]>,
      // Also pull last 3 Activity rows as a fallback/merge source
      prisma.$queryRawUnsafe(
        `SELECT a."id", a."activityType", a."subject", a."notes", a."outcome", a."createdAt",
                a."staffId", s."firstName" || ' ' || s."lastName" AS "staffName"
         FROM "Activity" a
         LEFT JOIN "Staff" s ON s."id" = a."staffId"
         WHERE a."builderId" = $1
         ORDER BY a."createdAt" DESC
         LIMIT 3`,
        builderId,
      ) as Promise<any[]>,
      // Quotes SENT but not ordered/approved/expired
      prisma.$queryRawUnsafe(
        `SELECT q."id", q."quoteNumber", q."total", q."status", q."validUntil", q."createdAt"
         FROM "Quote" q
         JOIN "Project" p ON p."id" = q."projectId"
         WHERE p."builderId" = $1
           AND q."status"::text IN ('SENT','DRAFT')
         ORDER BY q."createdAt" DESC
         LIMIT 5`,
        builderId,
      ) as Promise<any[]>,
      // Orders in flight (not complete/cancelled)
      prisma.$queryRawUnsafe(
        `SELECT o."id","orderNumber","total","status","createdAt","deliveryDate"
         FROM "Order" o
         WHERE o."builderId" = $1
           AND o."status"::text NOT IN ('COMPLETE','CANCELLED','DELIVERED')
         ORDER BY o."createdAt" DESC
         LIMIT 5`,
        builderId,
      ) as Promise<any[]>,
      // Open invoices + overdue rollup
      prisma.$queryRawUnsafe(
        `SELECT
           COALESCE(SUM("total" - COALESCE("amountPaid",0)),0)::float          AS "outstanding",
           COALESCE(SUM(CASE WHEN "dueDate" < CURRENT_DATE - INTERVAL '30 days'
                             THEN "total" - COALESCE("amountPaid",0) ELSE 0 END),0)::float AS "overdue30",
           COALESCE(SUM(CASE WHEN "dueDate" < CURRENT_DATE - INTERVAL '60 days'
                             THEN "total" - COALESCE("amountPaid",0) ELSE 0 END),0)::float AS "overdue60",
           COUNT(*) FILTER (WHERE "dueDate" < CURRENT_DATE)::int                AS "overdueCount"
         FROM "Invoice"
         WHERE "builderId" = $1
           AND "status"::text IN ('ISSUED','SENT','PARTIALLY_PAID','OVERDUE')
           AND ("total" - COALESCE("amountPaid",0)) > 0`,
        builderId,
      ) as Promise<any[]>,
      // Last 5 orders (any status) for recent-orders list
      prisma.$queryRawUnsafe(
        `SELECT "id","orderNumber","total","status","createdAt"
         FROM "Order"
         WHERE "builderId" = $1
         ORDER BY "createdAt" DESC
         LIMIT 5`,
        builderId,
      ) as Promise<any[]>,
      // Open deals for this builder
      prisma.$queryRawUnsafe(
        `SELECT "id","dealNumber","stage","dealValue","expectedCloseDate","probability"
         FROM "Deal"
         WHERE "builderId" = $1
           AND "stage"::text NOT IN ('WON','LOST','ONBOARDED')
         ORDER BY "dealValue" DESC
         LIMIT 5`,
        builderId,
      ) as Promise<any[]>,
    ])

    // Merge comms + activities into a unified "touches" feed (last 3)
    type Touch = {
      id: string
      kind: string // email/call/visit/text/note/system
      subject: string | null
      summary: string | null
      at: string
      staffName: string | null
    }
    const channelToKind: Record<string, string> = {
      EMAIL: 'email',
      PHONE: 'call',
      TEXT: 'sms',
      IN_PERSON: 'visit',
      VIDEO_CALL: 'call',
      HYPHEN_NOTIFICATION: 'system',
      SYSTEM: 'system',
    }
    const activityToKind: Record<string, string> = {
      CALL: 'call',
      EMAIL: 'email',
      MEETING: 'visit',
      SITE_VISIT: 'visit',
      TEXT_MESSAGE: 'sms',
      NOTE: 'note',
      QUOTE_SENT: 'quote',
      QUOTE_FOLLOW_UP: 'quote',
      ISSUE_REPORTED: 'issue',
      ISSUE_RESOLVED: 'issue',
    }
    const touches: Touch[] = [
      ...(commsRows as any[]).map((c) => ({
        id: c.id,
        kind: channelToKind[c.channel] || 'note',
        subject: c.subject,
        summary: c.body ? String(c.body).slice(0, 180) : null,
        at: (c.sentAt || c.createdAt) as string,
        staffName: c.staffName || null,
      })),
      ...(activitiesRows as any[]).map((a) => ({
        id: a.id,
        kind: activityToKind[a.activityType] || 'note',
        subject: a.subject,
        summary: (a.notes || a.outcome) ? String(a.notes || a.outcome).slice(0, 180) : null,
        at: a.createdAt as string,
        staffName: a.staffName || null,
      })),
    ]
      .sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime())
      .slice(0, 3)

    const ar = (invoiceRows as any[])[0] || { outstanding: 0, overdue30: 0, overdue60: 0, overdueCount: 0 }

    const arFlag =
      Number(ar.overdue60) > 0
        ? 'CRITICAL'
        : Number(ar.overdue30) > 0
          ? 'WARNING'
          : null

    const lastTouchAt = touches[0]?.at || null

    return NextResponse.json({
      ok: true,
      builder: {
        id: builder.id,
        companyName: builder.companyName,
        contactName: builder.contactName,
        city: builder.city,
        state: builder.state,
        phone: builder.phone,
        email: builder.email,
        builderType: builder.builderType,
        paymentTerm: builder.paymentTerm,
        territory: builder.territory,
        lastTouchAt,
      },
      touches,
      openItems: {
        quotesPending: openQuotesRows.length,
        quotes: openQuotesRows,
        ordersInFlight: inFlightOrdersRows.length,
        orders: inFlightOrdersRows,
        openInvoicesTotal: Number(ar.outstanding),
        overdueInvoicesCount: Number(ar.overdueCount),
      },
      ar: {
        outstanding: Number(ar.outstanding),
        overdue30: Number(ar.overdue30),
        overdue60: Number(ar.overdue60),
        flag: arFlag,
      },
      recentOrders: recentOrdersRows,
      pipeline: dealsRows,
    })
  } catch (err: any) {
    console.error('[next-stop]', err)
    return NextResponse.json({ error: err?.message || 'internal' }, { status: 500 })
  }
}
