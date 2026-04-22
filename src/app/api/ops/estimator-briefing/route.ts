export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// ──────────────────────────────────────────────────────────────────
// ESTIMATOR MORNING BRIEFING — Takeoffs, quotes, and work summary
// ──────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().split('T')[0]
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString().split('T')[0]
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0]
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0]

    // ── 1. Takeoffs Awaiting Review ──
    const takeoffsToReview: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        t."id",
        p."name" AS "projectName",
        b."companyName" AS "builderName",
        p."planName",
        t."confidence",
        t."createdAt",
        (SELECT COUNT(*)::int FROM "TakeoffItem" ti WHERE ti."takeoffId" = t."id") AS "itemCount"
      FROM "Takeoff" t
      JOIN "Project" p ON t."projectId" = p."id"
      LEFT JOIN "Builder" b ON p."builderId" = b."id"
      WHERE t."status"::text = 'NEEDS_REVIEW'
      ORDER BY t."createdAt" ASC
      LIMIT 20
    `)

    // ── 2. Quotes in Draft Status ──
    const quotesInDraft: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        q."id",
        q."quoteNumber",
        b."companyName" AS "builderName",
        q."total",
        q."createdAt"
      FROM "Quote" q
      JOIN "Project" p ON q."projectId" = p."id"
      LEFT JOIN "Builder" b ON p."builderId" = b."id"
      WHERE q."status"::text = 'DRAFT'
      ORDER BY q."createdAt" DESC
      LIMIT 20
    `)

    // ── 3. Quotes Expiring Soon (within 7 days) ──
    const quotesExpiring: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        q."id",
        q."quoteNumber",
        b."companyName" AS "builderName",
        q."total",
        q."validUntil" AS "expiresAt"
      FROM "Quote" q
      JOIN "Project" p ON q."projectId" = p."id"
      LEFT JOIN "Builder" b ON p."builderId" = b."id"
      WHERE q."status"::text IN ('DRAFT', 'SENT')
        AND q."validUntil" >= CURRENT_DATE
        AND q."validUntil" < $1::date
      ORDER BY q."validUntil" ASC
    `, sevenDaysFromNow)

    // ── 4. New Projects Today (using Project as proxy for new requests) ──
    const newRequests: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        p."id",
        b."companyName" AS "builderName",
        p."name" AS "projectName",
        p."createdAt" AS "requestedAt"
      FROM "Project" p
      LEFT JOIN "Builder" b ON p."builderId" = b."id"
      WHERE p."createdAt" >= $1::date
        AND p."createdAt" < $2::date
      ORDER BY p."createdAt" DESC
    `, todayStart, todayEnd)

    // ── 5. Recent Completions (approved in last 7 days) ──
    const recentCompletions: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        t."id",
        p."name" AS "projectName",
        b."companyName" AS "builderName",
        COUNT(ti."id")::int AS "itemCount",
        t."confidence",
        t."reviewedAt"
      FROM "Takeoff" t
      JOIN "Project" p ON t."projectId" = p."id"
      LEFT JOIN "Builder" b ON p."builderId" = b."id"
      LEFT JOIN "TakeoffItem" ti ON ti."takeoffId" = t."id"
      WHERE t."status"::text = 'APPROVED'
        AND t."reviewedAt" >= $1::timestamp
      GROUP BY t."id", p."name", b."companyName"
      ORDER BY t."reviewedAt" DESC
      LIMIT 10
    `, sevenDaysAgo)

    // ── 6. Summary metrics ──
    const summaryMetrics: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        (SELECT COUNT(*)::int FROM "Takeoff" WHERE "status"::text = 'NEEDS_REVIEW') AS "takeoffsAwaitingReview",
        (SELECT COUNT(*)::int FROM "Quote" WHERE "status"::text = 'DRAFT') AS "quotesInDraft",
        (SELECT COUNT(*)::int FROM "Quote" WHERE "status"::text IN ('DRAFT', 'SENT') AND "validUntil" >= CURRENT_DATE AND "validUntil" < NOW() + INTERVAL '7 days') AS "quotesExpiringSoon",
        (SELECT COUNT(*)::int FROM "Project" WHERE "createdAt" >= $1::date AND "createdAt" < $2::date) AS "newRequestsToday",
        (SELECT AVG("confidence")::float FROM "Takeoff" WHERE "status"::text = 'NEEDS_REVIEW' AND "confidence" IS NOT NULL) AS "avgConfidenceScore"
    `, todayStart, todayEnd)

    const metrics = summaryMetrics[0] || {}

    // Low confidence takeoffs (< 85%)
    const lowConfidenceTakeoffs: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        t."id",
        p."name" AS "projectName",
        b."companyName" AS "builderName",
        t."confidence"
      FROM "Takeoff" t
      JOIN "Project" p ON t."projectId" = p."id"
      LEFT JOIN "Builder" b ON p."builderId" = b."id"
      WHERE t."status"::text = 'NEEDS_REVIEW'
        AND t."confidence" < 0.85
      ORDER BY t."confidence" ASC
    `)

    return safeJson({
      date: now.toISOString(),
      summary: {
        takeoffsAwaitingReview: metrics.takeoffsAwaitingReview || 0,
        quotesInDraft: metrics.quotesInDraft || 0,
        quotesExpiringSoon: metrics.quotesExpiringSoon || 0,
        pricingUpdates: 0,
        newRequestsToday: metrics.newRequestsToday || 0,
        avgConfidenceScore: metrics.avgConfidenceScore ? Math.round(metrics.avgConfidenceScore * 100) : 0,
      },
      takeoffsToReview: takeoffsToReview.map((t: any) => ({
        ...t,
        confidenceScore: t.confidence ? Math.round(t.confidence * 100) : 0,
      })),
      quotesInDraft,
      quotesExpiring,
      newRequests,
      recentCompletions: recentCompletions.map((rc: any) => ({
        ...rc,
        confidenceScore: rc.confidence ? Math.round(rc.confidence * 100) : 0,
      })),
      lowConfidenceTakeoffs: lowConfidenceTakeoffs.map((lc: any) => ({
        ...lc,
        confidenceScore: lc.confidence ? Math.round(lc.confidence * 100) : 0,
      })),
    })
  } catch (error: any) {
    console.error('Failed to fetch estimator briefing:', error)
    return NextResponse.json(
      { error: 'Failed to fetch estimator briefing' },
      { status: 500 }
    )
  }
}
