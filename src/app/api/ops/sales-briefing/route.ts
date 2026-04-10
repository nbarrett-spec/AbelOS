export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// ──────────────────────────────────────────────────────────────────
// SALES MORNING BRIEFING — Today's opportunities & follow-ups
// ──────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const staffId = request.headers.get('x-staff-id') || ''

  try {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    const sevenDaysOut = new Date(now.getTime() + 7 * 86400000).toISOString()
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString()

    // ── 1. Summary counts (Deals only) ──
    const dealSummary: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(DISTINCT d."id")::int AS "activeDeals",
        COALESCE(SUM(d."dealValue"), 0)::float AS "pipelineValue",
        COUNT(DISTINCT CASE WHEN d."createdAt" >= $1::date AND d."createdAt" < $2::date THEN d."id" END)::int AS "newLeadsToday",
        COUNT(DISTINCT CASE WHEN d."expectedCloseDate" IS NOT NULL AND d."expectedCloseDate" >= $1::date AND d."expectedCloseDate" <= $3::date THEN d."id" END)::int AS "closingThisWeek"
      FROM "Deal" d
      WHERE d."ownerId" = $4
        AND d."stage"::text NOT IN ('LOST')
    `, todayStart, tomorrow, sevenDaysOut, staffId)

    // ── 1b. Follow-ups due count ──
    const followUpsCount: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(DISTINCT da."id")::int AS "followUpsDue"
      FROM "DealActivity" da
      JOIN "Deal" d ON da."dealId" = d."id"
      WHERE d."ownerId" = $1
        AND da."followUpDate" IS NOT NULL
        AND da."followUpDate" <= CURRENT_DATE
        AND da."followUpDone" = false
    `, staffId)

    // ── 1c. Quotes expiring (global — no Deal link in schema) ──
    const quotesExpiringCount: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS "quotesExpiring7d"
      FROM "Quote" q
      WHERE q."validUntil" IS NOT NULL
        AND q."validUntil" > CURRENT_DATE
        AND q."validUntil" <= (CURRENT_DATE + INTERVAL '7 days')
        AND q."status"::text NOT IN ('ORDERED', 'EXPIRED')
    `)

    const summary = {
      ...(dealSummary[0] || { activeDeals: 0, pipelineValue: 0, newLeadsToday: 0, closingThisWeek: 0 }),
      followUpsDue: followUpsCount[0]?.followUpsDue || 0,
      quotesExpiring7d: quotesExpiringCount[0]?.quotesExpiring7d || 0,
    }

    // ── 2. Deals by stage ──
    const dealsByStage: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        d."stage"::text AS stage,
        COUNT(*)::int AS count,
        COALESCE(SUM(d."dealValue"), 0)::float AS value
      FROM "Deal" d
      WHERE d."ownerId" = $1
        AND d."stage"::text NOT IN ('LOST')
      GROUP BY d."stage"
      ORDER BY d."stage" ASC
    `, staffId)

    // ── 3. Follow-ups due (last activity 7+ days ago) ──
    const followUpsDue: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        d."id" AS "dealId",
        d."companyName",
        d."stage"::text AS stage,
        d."dealValue" AS value,
        EXTRACT(DAY FROM NOW() - MAX(da."createdAt"))::int AS "daysSinceActivity",
        s."firstName" || ' ' || s."lastName" AS "ownerName"
      FROM "Deal" d
      LEFT JOIN "DealActivity" da ON d."id" = da."dealId"
      JOIN "Staff" s ON d."ownerId" = s."id"
      WHERE d."ownerId" = $1
        AND d."stage"::text NOT IN ('LOST')
      GROUP BY d."id", s."firstName", s."lastName"
      HAVING EXTRACT(DAY FROM NOW() - MAX(da."createdAt")) >= 7
      ORDER BY EXTRACT(DAY FROM NOW() - MAX(da."createdAt")) DESC
      LIMIT 15
    `, staffId)

    // ── 4. Quotes expiring in next 7 days ──
    const quotesExpiring: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        q."quoteNumber",
        b."companyName" AS "builderName",
        q."total",
        q."validUntil" AS "expiresAt",
        q."status"::text AS status
      FROM "Quote" q
      JOIN "Project" p ON q."projectId" = p."id"
      JOIN "Builder" b ON p."builderId" = b."id"
      WHERE q."validUntil" IS NOT NULL
        AND q."validUntil" > CURRENT_DATE
        AND q."validUntil" <= (CURRENT_DATE + INTERVAL '7 days')
        AND q."status"::text NOT IN ('ORDERED', 'EXPIRED')
      ORDER BY q."validUntil" ASC
      LIMIT 15
    `)

    // ── 5. Deals with expected close date this week ──
    const closingThisWeek: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        d."id" AS "dealId",
        d."dealNumber",
        d."companyName",
        d."stage"::text AS stage,
        d."dealValue" AS value,
        d."expectedCloseDate",
        s."firstName" || ' ' || s."lastName" AS "ownerName"
      FROM "Deal" d
      JOIN "Staff" s ON d."ownerId" = s."id"
      WHERE d."ownerId" = $1
        AND d."expectedCloseDate" IS NOT NULL
        AND d."expectedCloseDate" >= $2::date
        AND d."expectedCloseDate" <= $3::date
        AND d."stage"::text NOT IN ('LOST', 'WON')
      ORDER BY d."expectedCloseDate" ASC
      LIMIT 15
    `, staffId, todayStart, sevenDaysOut)

    // ── 6. Recent wins (moved to WON in last 7 days) ──
    const recentWins: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        d."id" AS "dealId",
        d."dealNumber",
        d."companyName",
        d."dealValue" AS value,
        d."actualCloseDate",
        s."firstName" || ' ' || s."lastName" AS "ownerName"
      FROM "Deal" d
      JOIN "Staff" s ON d."ownerId" = s."id"
      WHERE d."ownerId" = $1
        AND d."stage"::text = 'WON'
        AND d."actualCloseDate" IS NOT NULL
        AND d."actualCloseDate" >= $2::date
      ORDER BY d."actualCloseDate" DESC
      LIMIT 10
    `, staffId, new Date(now.getTime() - 7 * 86400000).toISOString())

    // ── 7. At-risk deals (value > 5000, no activity in 14+ days) ──
    const atRiskDeals: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        d."id" AS "dealId",
        d."dealNumber",
        d."companyName",
        d."stage"::text AS stage,
        d."dealValue" AS value,
        EXTRACT(DAY FROM NOW() - MAX(da."createdAt"))::int AS "daysSinceActivity",
        s."firstName" || ' ' || s."lastName" AS "ownerName"
      FROM "Deal" d
      LEFT JOIN "DealActivity" da ON d."id" = da."dealId"
      JOIN "Staff" s ON d."ownerId" = s."id"
      WHERE d."ownerId" = $1
        AND d."dealValue" > 5000
        AND d."stage"::text NOT IN ('LOST', 'WON')
      GROUP BY d."id", s."firstName", s."lastName"
      HAVING EXTRACT(DAY FROM NOW() - MAX(da."createdAt")) >= 14
      ORDER BY EXTRACT(DAY FROM NOW() - MAX(da."createdAt")) DESC
      LIMIT 10
    `, staffId)

    return safeJson({
      date: todayStart,
      summary,
      dealsByStage,
      followUpsDue,
      quotesExpiring,
      closingThisWeek,
      recentWins,
      atRiskDeals,
    })
  } catch (error: any) {
    console.error('[Sales Briefing] Error:', error)
    return NextResponse.json({ error: error.message || 'Briefing failed' }, { status: 500 })
  }
}
