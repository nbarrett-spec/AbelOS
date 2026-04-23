export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { generate, getOrGenerate, checkAIRateLimit, isAIConfigured } from '@/lib/ai/insights'
import { audit, getStaffFromHeaders } from '@/lib/audit'

/**
 * POST /api/ops/ai/builder-snapshot
 * Body: { builderId: string, force?: boolean }
 *
 * Returns a 1-paragraph health assessment with $$$ figures pulled server-side.
 * Flags payment velocity, order volume trend, pricing tier fit, growth signal.
 * Cached per day (builderId + yyyy-mm-dd).
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  if (!isAIConfigured()) {
    return NextResponse.json({ error: 'AI not configured' }, { status: 503 })
  }

  try {
    const { builderId, force } = (await request.json().catch(() => ({}))) as {
      builderId?: string
      force?: boolean
    }
    if (!builderId) return NextResponse.json({ error: 'builderId required' }, { status: 400 })

    const { staffId } = getStaffFromHeaders(request.headers)
    const rl = await checkAIRateLimit(staffId)
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'AI rate limit exceeded', resetIn: rl.resetIn },
        { status: 429 }
      )
    }

    // Pull builder + 90d metrics
    const builderRows = (await prisma.$queryRawUnsafe(
      `SELECT "id","companyName","builderType","paymentTerm","accountStatus","territory","createdAt"
       FROM "Builder" WHERE "id" = $1 LIMIT 1`,
      builderId
    )) as any[]
    if (!builderRows[0]) return NextResponse.json({ error: 'builder not found' }, { status: 404 })
    const builder = builderRows[0]

    const [orders90, orders180, arRows, paymentsRows] = await Promise.all([
      prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int as count, COALESCE(SUM("total"),0)::float as total
         FROM "Order" WHERE "builderId"=$1 AND "createdAt" >= NOW() - INTERVAL '90 days'`,
        builderId
      ) as Promise<any[]>,
      prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int as count, COALESCE(SUM("total"),0)::float as total
         FROM "Order" WHERE "builderId"=$1 AND "createdAt" >= NOW() - INTERVAL '180 days' AND "createdAt" < NOW() - INTERVAL '90 days'`,
        builderId
      ) as Promise<any[]>,
      prisma.$queryRawUnsafe(
        `SELECT COALESCE(SUM("total" - COALESCE("amountPaid",0)),0)::float as outstanding,
                COALESCE(SUM(CASE WHEN "dueDate" < CURRENT_DATE THEN "total" - COALESCE("amountPaid",0) ELSE 0 END),0)::float as overdue
         FROM "Invoice" WHERE "builderId"=$1 AND "status"::text IN ('ISSUED','SENT','PARTIALLY_PAID','OVERDUE') AND ("total" - COALESCE("amountPaid",0)) > 0`,
        builderId
      ) as Promise<any[]>,
      prisma.$queryRawUnsafe(
        `SELECT AVG(EXTRACT(EPOCH FROM (p."receivedAt" - i."issueDate")) / 86400.0)::float as avg_days_to_pay
         FROM "Payment" p JOIN "Invoice" i ON p."invoiceId" = i."id"
         WHERE i."builderId"=$1 AND p."receivedAt" >= NOW() - INTERVAL '180 days'`,
        builderId
      ) as Promise<any[]>,
    ])

    const today = new Date().toISOString().slice(0, 10)
    const cacheKey = `builder:${builderId}:${today}`

    const o90 = orders90[0] || { count: 0, total: 0 }
    const o180 = orders180[0] || { count: 0, total: 0 }
    const ar = arRows[0] || { outstanding: 0, overdue: 0 }
    const avgPay = Number(paymentsRows[0]?.avg_days_to_pay) || 0

    const metrics = {
      ordersLast90: { count: o90.count, total: Number(o90.total) },
      ordersPrior90: { count: o180.count, total: Number(o180.total) },
      revenueTrend: Number(o180.total) > 0
        ? ((Number(o90.total) - Number(o180.total)) / Number(o180.total)) * 100
        : null,
      arOutstanding: Number(ar.outstanding),
      arOverdue: Number(ar.overdue),
      avgDaysToPay: Math.round(avgPay * 10) / 10,
    }

    const { result, cached, generatedAt } = await getOrGenerate({
      cacheKey,
      ttlSeconds: 86400, // 24h
      force,
      generate: async () => {
        const systemPrompt = buildBuilderSystemPrompt()
        const userPrompt = buildBuilderUserPrompt(builder, metrics)
        return generate({
          endpoint: 'builder-snapshot',
          systemPrompt,
          userPrompt,
          maxTokens: 600,
          inputKey: `${builderId}:${today}`,
          staffId,
        })
      },
    })

    audit(request, 'GENERATE', 'AIInsight', builderId, { endpoint: 'builder-snapshot', cached }).catch(() => {})

    return NextResponse.json({
      ok: true,
      cached,
      generatedAt,
      builderId,
      metrics,
      snapshot: result.text,
      model: result.model,
      costEstimate: result.costEstimate,
    })
  } catch (err: any) {
    console.error('[ai/builder-snapshot]', err)
    return NextResponse.json({ error: err?.message || 'internal' }, { status: 500 })
  }
}

function buildBuilderSystemPrompt(): string {
  return `You are the Abel Lumber account-health AI. Abel supplies doors, trim, and hardware to DFW homebuilders. Your voice is quiet competence, dry wit, no oversell.

Given one builder's 90/180-day metrics, produce a ONE-PARAGRAPH (4-6 sentences) health assessment. You MUST:
- Open with the single most important number (revenue trend or AR risk, whichever is bigger).
- Flag four dimensions in order: payment velocity, order volume trend, pricing tier fit, growth signal.
- Use $ figures and percentages inline, never in a bullet list.
- Close with one sentence of recommendation — who should do what, by when.

Do not use headings. Do not use bullets. One paragraph only. Never invent numbers that weren't given to you.`
}

function buildBuilderUserPrompt(b: any, m: any): string {
  const trendText =
    m.revenueTrend == null ? 'no prior-period baseline' : `${m.revenueTrend >= 0 ? '+' : ''}${m.revenueTrend.toFixed(1)}% vs prior 90d`
  return `Builder: ${b.companyName}
Type: ${b.builderType} · Terms: ${b.paymentTerm} · Status: ${b.accountStatus} · Territory: ${b.territory || 'n/a'}
Customer since: ${b.createdAt ? new Date(b.createdAt).toISOString().slice(0, 10) : 'n/a'}

Last 90 days: ${m.ordersLast90.count} orders, $${m.ordersLast90.total.toLocaleString()}
Prior 90 days: ${m.ordersPrior90.count} orders, $${m.ordersPrior90.total.toLocaleString()}
Revenue trend: ${trendText}

AR outstanding: $${m.arOutstanding.toLocaleString()} (overdue $${m.arOverdue.toLocaleString()})
Average days-to-pay (last 180d): ${m.avgDaysToPay || 'n/a'}

Write the paragraph now.`
}
