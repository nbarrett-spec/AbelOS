export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { parseRoles } from '@/lib/permissions'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/my-book — Sales Rep "My Book" feed
//
// Builders are linked to a sales rep via Deal.ownerId + Deal.builderId
// (Builder model itself has no salesRepId). A rep "owns" any builder for
// which they own at least one Deal that has been linked to a real Builder
// (builderId IS NOT NULL — typically WON/ONBOARDED, but we don't gate on
// stage so reps still see their pipeline-converted builders even if the
// Deal is stuck in WALKTHROUGH).
//
// ?staffId=<id>  — ADMIN / MANAGER only. Sales reps always see their own
//                  book regardless of this param.
// ?from=YYYY-MM-DD&to=YYYY-MM-DD — filters Recent Activity + YTD-style
//                                  revenue. Defaults: from = Jan 1 of the
//                                  current year, to = now.
// ──────────────────────────────────────────────────────────────────────────

interface BookBuilder {
  id: string
  companyName: string
  contactName: string
  city: string | null
  state: string | null
  status: string
  paymentTerm: string
  creditLimit: number | null
  accountBalance: number
  ytdRevenue: number
  arBalance: number
  overdueAmount: number
  lastOrderDate: string | null
  openQuotes: number
}

interface BookDeal {
  id: string
  dealNumber: string
  companyName: string
  stage: string
  probability: number
  dealValue: number
  expectedCloseDate: string | null
  builderId: string | null
  updatedAt: string
}

interface ActivityItem {
  kind: 'ORDER' | 'QUOTE' | 'INVOICE'
  id: string
  refNumber: string
  builderId: string | null
  companyName: string
  amount: number
  status: string
  at: string
}

interface BookResponse {
  staff: {
    id: string
    firstName: string
    lastName: string
    email: string
    title: string | null
    role: string
  }
  asOf: string
  range: { from: string; to: string }
  viewer: { id: string; isAdmin: boolean }
  reps?: Array<{ id: string; firstName: string; lastName: string; email: string }>
  kpis: {
    totalBuilders: number
    activeBuilders: number
    ytdRevenue: number
    openQuotes: number
    overdueInvoices: number
    overdueAmount: number
  }
  builders: BookBuilder[]
  deals: BookDeal[]
  recentActivity: ActivityItem[]
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const callerId = request.headers.get('x-staff-id') || ''
  const callerRolesStr = request.headers.get('x-staff-roles') || request.headers.get('x-staff-role') || ''
  const callerRoles = parseRoles(callerRolesStr)
  const isPrivileged = callerRoles.includes('ADMIN') || callerRoles.includes('MANAGER')

  const { searchParams } = new URL(request.url)
  const requestedId = searchParams.get('staffId') || ''
  const targetId = isPrivileged && requestedId ? requestedId : callerId

  if (!targetId) {
    return NextResponse.json({ error: 'Missing staff context' }, { status: 401 })
  }

  // Date range defaults: YTD (Jan 1 → now)
  const now = new Date()
  const startOfYear = new Date(now.getFullYear(), 0, 1)
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')
  const from = fromParam ? new Date(fromParam) : startOfYear
  const to = toParam ? new Date(`${toParam}T23:59:59.999Z`) : now

  try {
    // ── Staff record ──
    const staff = await prisma.staff.findUnique({
      where: { id: targetId },
      select: {
        id: true, firstName: true, lastName: true, email: true,
        title: true, role: true,
      },
    })
    if (!staff) return NextResponse.json({ error: 'Staff not found' }, { status: 404 })

    // ── Reps roster (only when caller is ADMIN/MANAGER, for the picker) ──
    let reps:
      | Array<{ id: string; firstName: string; lastName: string; email: string }>
      | undefined
    if (isPrivileged) {
      const repRows: any[] = await prisma.$queryRawUnsafe(`
        SELECT DISTINCT s.id, s."firstName", s."lastName", s.email
        FROM "Staff" s
        WHERE s.active = true
          AND (
            s.role::text IN ('SALES_REP', 'ADMIN', 'MANAGER')
            OR EXISTS (SELECT 1 FROM "Deal" d WHERE d."ownerId" = s.id)
          )
        ORDER BY s."lastName", s."firstName"
      `)
      reps = repRows.map((r) => ({
        id: r.id, firstName: r.firstName, lastName: r.lastName, email: r.email,
      }))
    }

    // ── Builders owned via Deal.ownerId ──
    // Builder ↔ Sales rep is materialized only through deals. ADMIN viewing
    // their own book gets every builder so they can sanity-check the system.
    const targetIsAdmin =
      staff.role === 'ADMIN' && targetId === callerId && isPrivileged

    const builderIdRows: any[] = targetIsAdmin
      ? await prisma.$queryRawUnsafe(`SELECT id FROM "Builder"`)
      : await prisma.$queryRawUnsafe(
          `SELECT DISTINCT d."builderId" AS id
           FROM "Deal" d
           WHERE d."ownerId" = $1 AND d."builderId" IS NOT NULL`,
          targetId,
        )

    const builderIds: string[] = builderIdRows.map((r) => r.id).filter(Boolean)

    let builders: BookBuilder[] = []
    if (builderIds.length > 0) {
      // Bulk fetch. Use Prisma model for the headline columns + a few raw
      // aggregates for revenue/AR (avoids N+1).
      const builderRows = await prisma.builder.findMany({
        where: { id: { in: builderIds } },
        select: {
          id: true, companyName: true, contactName: true,
          city: true, state: true, status: true, paymentTerm: true,
          creditLimit: true, accountBalance: true,
        },
        orderBy: { companyName: 'asc' },
      })

      // YTD revenue from Order.total within [from, to]
      const revenueRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT "builderId", COALESCE(SUM("total"), 0)::float AS ytd
         FROM "Order"
         WHERE "builderId" = ANY($1::text[])
           AND COALESCE("orderDate", "createdAt") BETWEEN $2 AND $3
         GROUP BY "builderId"`,
        builderIds, from, to,
      )
      const ytdMap = new Map<string, number>(
        revenueRows.map((r) => [r.builderId, Number(r.ytd) || 0]),
      )

      // Last order date
      const lastOrderRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT "builderId", MAX(COALESCE("orderDate", "createdAt")) AS last_at
         FROM "Order"
         WHERE "builderId" = ANY($1::text[])
         GROUP BY "builderId"`,
        builderIds,
      )
      const lastOrderMap = new Map<string, string | null>(
        lastOrderRows.map((r) => [r.builderId, r.last_at ? new Date(r.last_at).toISOString() : null]),
      )

      // AR balance + overdue amount from Invoice (open invoices only)
      const arRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT
           "builderId",
           COALESCE(SUM("balanceDue"), 0)::float AS ar_balance,
           COALESCE(SUM(CASE WHEN "dueDate" IS NOT NULL AND "dueDate" < NOW()
                              AND "balanceDue" > 0
                             THEN "balanceDue" ELSE 0 END), 0)::float AS overdue_amount
         FROM "Invoice"
         WHERE "builderId" = ANY($1::text[])
           AND "status"::text NOT IN ('PAID', 'VOID', 'WRITE_OFF')
         GROUP BY "builderId"`,
        builderIds,
      )
      const arMap = new Map<string, { ar: number; overdue: number }>(
        arRows.map((r) => [
          r.builderId,
          { ar: Number(r.ar_balance) || 0, overdue: Number(r.overdue_amount) || 0 },
        ]),
      )

      // Open quotes per builder (DRAFT, SENT) — Quote.projectId → Project.builderId
      const quoteRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT p."builderId" AS "builderId", COUNT(*)::int AS open_count
         FROM "Quote" q
         JOIN "Project" p ON p.id = q."projectId"
         WHERE p."builderId" = ANY($1::text[])
           AND q."status"::text IN ('DRAFT', 'SENT')
         GROUP BY p."builderId"`,
        builderIds,
      )
      const quoteMap = new Map<string, number>(
        quoteRows.map((r) => [r.builderId, Number(r.open_count) || 0]),
      )

      builders = builderRows.map((b) => {
        const ar = arMap.get(b.id) || { ar: 0, overdue: 0 }
        return {
          id: b.id,
          companyName: b.companyName,
          contactName: b.contactName,
          city: b.city,
          state: b.state,
          status: b.status,
          paymentTerm: b.paymentTerm,
          creditLimit: b.creditLimit,
          accountBalance: b.accountBalance,
          ytdRevenue: ytdMap.get(b.id) || 0,
          arBalance: ar.ar,
          overdueAmount: ar.overdue,
          lastOrderDate: lastOrderMap.get(b.id) || null,
          openQuotes: quoteMap.get(b.id) || 0,
        }
      })
    }

    // ── Pipeline: open Deals owned by this rep ──
    const openDealRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT d.id, d."dealNumber", d."companyName", d."stage"::text AS stage,
              d."probability", d."dealValue", d."expectedCloseDate",
              d."builderId", d."updatedAt"
       FROM "Deal" d
       WHERE d."ownerId" = $1
         AND d."stage"::text NOT IN ('WON', 'LOST', 'ONBOARDED')
       ORDER BY
         CASE d."stage"::text
           WHEN 'NEGOTIATION'    THEN 1
           WHEN 'BID_REVIEW'     THEN 2
           WHEN 'BID_SUBMITTED'  THEN 3
           WHEN 'WALKTHROUGH'    THEN 4
           WHEN 'DISCOVERY'      THEN 5
           WHEN 'PROSPECT'       THEN 6
           ELSE 7
         END,
         d."expectedCloseDate" NULLS LAST,
         d."updatedAt" DESC`,
      targetId,
    )
    const deals: BookDeal[] = openDealRows.map((d) => ({
      id: d.id,
      dealNumber: d.dealNumber,
      companyName: d.companyName,
      stage: d.stage,
      probability: Number(d.probability) || 0,
      dealValue: Number(d.dealValue) || 0,
      expectedCloseDate: d.expectedCloseDate
        ? new Date(d.expectedCloseDate).toISOString()
        : null,
      builderId: d.builderId,
      updatedAt: new Date(d.updatedAt).toISOString(),
    }))

    // ── Recent activity (orders, quotes, invoices) within range ──
    let recentActivity: ActivityItem[] = []
    if (builderIds.length > 0) {
      const activityCap = 60

      const orderActivity: any[] = await prisma.$queryRawUnsafe(
        `SELECT o.id, o."orderNumber" AS ref, o."builderId", b."companyName",
                o."total"::float AS amount, o."status"::text AS status,
                COALESCE(o."orderDate", o."createdAt") AS at
         FROM "Order" o
         JOIN "Builder" b ON b.id = o."builderId"
         WHERE o."builderId" = ANY($1::text[])
           AND COALESCE(o."orderDate", o."createdAt") BETWEEN $2 AND $3
         ORDER BY at DESC
         LIMIT $4`,
        builderIds, from, to, activityCap,
      )

      const quoteActivity: any[] = await prisma.$queryRawUnsafe(
        `SELECT q.id, q."quoteNumber" AS ref, p."builderId", b."companyName",
                q."total"::float AS amount, q."status"::text AS status,
                q."createdAt" AS at
         FROM "Quote" q
         JOIN "Project" p ON p.id = q."projectId"
         JOIN "Builder" b ON b.id = p."builderId"
         WHERE p."builderId" = ANY($1::text[])
           AND q."createdAt" BETWEEN $2 AND $3
         ORDER BY q."createdAt" DESC
         LIMIT $4`,
        builderIds, from, to, activityCap,
      )

      const invoiceActivity: any[] = await prisma.$queryRawUnsafe(
        `SELECT i.id, i."invoiceNumber" AS ref, i."builderId", b."companyName",
                i."total"::float AS amount, i."status"::text AS status,
                COALESCE(i."issuedAt", i."createdAt") AS at
         FROM "Invoice" i
         JOIN "Builder" b ON b.id = i."builderId"
         WHERE i."builderId" = ANY($1::text[])
           AND COALESCE(i."issuedAt", i."createdAt") BETWEEN $2 AND $3
         ORDER BY at DESC
         LIMIT $4`,
        builderIds, from, to, activityCap,
      )

      recentActivity = [
        ...orderActivity.map((r) => ({
          kind: 'ORDER' as const,
          id: r.id,
          refNumber: r.ref,
          builderId: r.builderId,
          companyName: r.companyName,
          amount: Number(r.amount) || 0,
          status: r.status,
          at: new Date(r.at).toISOString(),
        })),
        ...quoteActivity.map((r) => ({
          kind: 'QUOTE' as const,
          id: r.id,
          refNumber: r.ref,
          builderId: r.builderId,
          companyName: r.companyName,
          amount: Number(r.amount) || 0,
          status: r.status,
          at: new Date(r.at).toISOString(),
        })),
        ...invoiceActivity.map((r) => ({
          kind: 'INVOICE' as const,
          id: r.id,
          refNumber: r.ref,
          builderId: r.builderId,
          companyName: r.companyName,
          amount: Number(r.amount) || 0,
          status: r.status,
          at: new Date(r.at).toISOString(),
        })),
      ]
        .sort((a, b) => +new Date(b.at) - +new Date(a.at))
        .slice(0, 100)
    }

    // ── KPI roll-up ──
    const kpis = {
      totalBuilders: builders.length,
      activeBuilders: builders.filter((b) => b.status === 'ACTIVE').length,
      ytdRevenue: builders.reduce((s, b) => s + b.ytdRevenue, 0),
      openQuotes: builders.reduce((s, b) => s + b.openQuotes, 0),
      overdueInvoices: builders.filter((b) => b.overdueAmount > 0).length,
      overdueAmount: builders.reduce((s, b) => s + b.overdueAmount, 0),
    }

    const response: BookResponse = {
      staff,
      asOf: new Date().toISOString(),
      range: {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
      },
      viewer: { id: callerId, isAdmin: callerRoles.includes('ADMIN') },
      reps,
      kpis,
      builders,
      deals,
      recentActivity,
    }

    return NextResponse.json(response)
  } catch (error: any) {
    console.error('GET /api/ops/my-book error', error)
    return NextResponse.json(
      { error: 'Failed to load my-book', detail: error?.message },
      { status: 500 },
    )
  }
}
