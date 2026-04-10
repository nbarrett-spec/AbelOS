export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * GET /api/agent-hub/outreach/performance
 * Track outreach performance: open rates, reply rates, conversion by template/segment.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Overall stats
    const overall: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS "totalSteps",
        COUNT(CASE WHEN "sentAt" IS NOT NULL THEN 1 END)::int AS "sent",
        COUNT(CASE WHEN "openedAt" IS NOT NULL THEN 1 END)::int AS "opened",
        COUNT(CASE WHEN "repliedAt" IS NOT NULL THEN 1 END)::int AS "replied",
        COUNT(CASE WHEN "bouncedAt" IS NOT NULL THEN 1 END)::int AS "bounced"
      FROM "OutreachStep"
    `)

    const stats = overall[0] || { totalSteps: 0, sent: 0, opened: 0, replied: 0, bounced: 0 }
    const sent = Number(stats.sent) || 0

    // By template
    const byTemplate: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        "templateUsed",
        COUNT(*)::int AS "total",
        COUNT(CASE WHEN "sentAt" IS NOT NULL THEN 1 END)::int AS "sent",
        COUNT(CASE WHEN "openedAt" IS NOT NULL THEN 1 END)::int AS "opened",
        COUNT(CASE WHEN "repliedAt" IS NOT NULL THEN 1 END)::int AS "replied"
      FROM "OutreachStep"
      WHERE "templateUsed" IS NOT NULL
      GROUP BY "templateUsed"
      ORDER BY COUNT(CASE WHEN "repliedAt" IS NOT NULL THEN 1 END) DESC
    `)

    // Sequence status summary
    const seqSummary: any[] = await prisma.$queryRawUnsafe(`
      SELECT "status", COUNT(*)::int AS count
      FROM "OutreachSequence"
      GROUP BY "status"
    `)

    // Recent conversions (sequences that led to deals/orders)
    const recentConversions: any[] = await prisma.$queryRawUnsafe(`
      SELECT os."id", os."name", os."targetType", os."completedAt",
             pl."builderName", pl."address" AS "permitAddress"
      FROM "OutreachSequence" os
      LEFT JOIN "PermitLead" pl ON pl."id" = os."permitLeadId"
      WHERE os."status"::text = 'COMPLETED'
      ORDER BY os."completedAt" DESC NULLS LAST
      LIMIT 10
    `)

    return NextResponse.json({
      overall: {
        totalSteps: Number(stats.totalSteps),
        sent,
        opened: Number(stats.opened),
        replied: Number(stats.replied),
        bounced: Number(stats.bounced),
        openRate: sent > 0 ? Math.round((Number(stats.opened) / sent) * 100) : 0,
        replyRate: sent > 0 ? Math.round((Number(stats.replied) / sent) * 100) : 0,
        bounceRate: sent > 0 ? Math.round((Number(stats.bounced) / sent) * 100) : 0,
      },
      byTemplate: byTemplate.map(t => ({
        ...t,
        openRate: Number(t.sent) > 0 ? Math.round((Number(t.opened) / Number(t.sent)) * 100) : 0,
        replyRate: Number(t.sent) > 0 ? Math.round((Number(t.replied) / Number(t.sent)) * 100) : 0,
      })),
      sequenceStatus: seqSummary,
      recentConversions,
    })
  } catch (error) {
    console.error('GET /api/agent-hub/outreach/performance error:', error)
    return NextResponse.json({ error: 'Failed to fetch outreach performance' }, { status: 500 })
  }
}
