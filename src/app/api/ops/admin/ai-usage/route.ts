export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/ops/admin/ai-usage
 *
 * Returns:
 *   recent: last 100 AIInvocation rows
 *   byEndpoint: rollup by endpoint over last 30d
 *   byDay: daily cost + call count over last 14d
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Table may not exist until first generate() call — wrap in try to allow empty state
    const recent = (await prisma.$queryRawUnsafe(
      `SELECT ai.*, s."firstName" || ' ' || s."lastName" as "staffName"
       FROM "AIInvocation" ai
       LEFT JOIN "Staff" s ON ai."staffId" = s."id"
       ORDER BY ai."createdAt" DESC LIMIT 100`
    ).catch(() => [])) as any[]

    const byEndpoint = (await prisma.$queryRawUnsafe(
      `SELECT "endpoint",
              COUNT(*)::int as "calls",
              COALESCE(SUM("costEstimate"),0)::float as "totalCost",
              COALESCE(SUM("promptTokens"),0)::int as "promptTokens",
              COALESCE(SUM("completionTokens"),0)::int as "completionTokens",
              COALESCE(SUM("cacheReadTokens"),0)::int as "cacheReadTokens",
              COALESCE(SUM("cacheWriteTokens"),0)::int as "cacheWriteTokens",
              COALESCE(AVG("durationMs"),0)::int as "avgMs"
       FROM "AIInvocation"
       WHERE "createdAt" >= NOW() - INTERVAL '30 days'
       GROUP BY "endpoint" ORDER BY "totalCost" DESC`
    ).catch(() => [])) as any[]

    const byDay = (await prisma.$queryRawUnsafe(
      `SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') as "day",
              COUNT(*)::int as "calls",
              COALESCE(SUM("costEstimate"),0)::float as "totalCost"
       FROM "AIInvocation"
       WHERE "createdAt" >= NOW() - INTERVAL '14 days'
       GROUP BY day ORDER BY day DESC`
    ).catch(() => [])) as any[]

    const totals = (await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as "calls",
              COALESCE(SUM("costEstimate"),0)::float as "totalCost",
              COUNT(*) FILTER (WHERE "createdAt" >= CURRENT_DATE)::int as "todayCalls",
              COALESCE(SUM("costEstimate") FILTER (WHERE "createdAt" >= CURRENT_DATE),0)::float as "todayCost"
       FROM "AIInvocation"
       WHERE "createdAt" >= NOW() - INTERVAL '30 days'`
    ).catch(() => [])) as any[]

    return NextResponse.json({
      ok: true,
      totals: totals[0] || { calls: 0, totalCost: 0, todayCalls: 0, todayCost: 0 },
      byEndpoint,
      byDay,
      recent,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'internal' }, { status: 500 })
  }
}
