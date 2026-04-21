export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { generate, getOrGenerate, checkAIRateLimit } from '@/lib/ai/insights'
import { audit, getStaffFromHeaders } from '@/lib/audit'

/**
 * POST /api/ops/ai/exec-briefing
 * Body: { date?: string (YYYY-MM-DD), force?: boolean }
 *
 * ~150-word executive briefing in Abel's voice.
 * Cached per day.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = (await request.json().catch(() => ({}))) as {
      date?: string
      force?: boolean
    }
    const date = body.date || new Date().toISOString().slice(0, 10)

    const { staffId } = getStaffFromHeaders(request.headers)
    const rl = await checkAIRateLimit(staffId)
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'AI rate limit exceeded', resetIn: rl.resetIn },
        { status: 429 }
      )
    }

    const metrics = await gatherExecMetrics()
    const cacheKey = `exec-brief:${date}`

    const { result, cached, generatedAt } = await getOrGenerate({
      cacheKey,
      ttlSeconds: 86400, // 24h
      force: body.force,
      generate: async () => {
        const systemPrompt = buildExecSystemPrompt()
        const userPrompt = buildExecUserPrompt(date, metrics)
        return generate({
          endpoint: 'exec-briefing',
          systemPrompt,
          userPrompt,
          maxTokens: 500,
          inputKey: date,
          staffId,
          extendedOutput: false,
        })
      },
    })

    audit(request, 'GENERATE', 'AIInsight', date, { endpoint: 'exec-briefing', cached }).catch(() => {})

    return NextResponse.json({
      ok: true,
      cached,
      generatedAt,
      date,
      metrics,
      briefing: result.text,
      model: result.model,
      costEstimate: result.costEstimate,
    })
  } catch (err: any) {
    console.error('[ai/exec-briefing]', err)
    return NextResponse.json({ error: err?.message || 'internal' }, { status: 500 })
  }
}

async function gatherExecMetrics() {
  // Week-over-week: this week vs prior week.
  const revThisWeek = (await prisma.$queryRawUnsafe(
    `SELECT COALESCE(SUM("amount"),0)::float as total
     FROM "Payment" WHERE "receivedAt" >= date_trunc('week', CURRENT_DATE)`
  )) as any[]
  const revPriorWeek = (await prisma.$queryRawUnsafe(
    `SELECT COALESCE(SUM("amount"),0)::float as total
     FROM "Payment" WHERE "receivedAt" >= date_trunc('week', CURRENT_DATE) - INTERVAL '7 days'
       AND "receivedAt" < date_trunc('week', CURRENT_DATE)`
  )) as any[]
  const ordersThisWeek = (await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int as count, COALESCE(SUM("total"),0)::float as total
     FROM "Order" WHERE "createdAt" >= date_trunc('week', CURRENT_DATE)`
  )) as any[]
  const ordersPriorWeek = (await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int as count, COALESCE(SUM("total"),0)::float as total
     FROM "Order" WHERE "createdAt" >= date_trunc('week', CURRENT_DATE) - INTERVAL '7 days'
       AND "createdAt" < date_trunc('week', CURRENT_DATE)`
  )) as any[]
  const arRows = (await prisma.$queryRawUnsafe(
    `SELECT COALESCE(SUM("balanceDue"),0)::float as outstanding,
            COALESCE(SUM(CASE WHEN "dueDate" < CURRENT_DATE THEN "balanceDue" ELSE 0 END),0)::float as overdue,
            COUNT(*) FILTER (WHERE "dueDate" < CURRENT_DATE AND "status" NOT IN ('PAID','VOID','WRITE_OFF'))::int as overdue_count
     FROM "Invoice" WHERE "status" NOT IN ('PAID','VOID','WRITE_OFF')`
  )) as any[]

  // Top 5 risks: overdue invoices (amount)
  const topOverdue = (await prisma.$queryRawUnsafe(
    `SELECT i."invoiceNumber", b."companyName" as "builderName", i."balanceDue"::float, i."dueDate"
     FROM "Invoice" i LEFT JOIN "Builder" b ON i."builderId" = b."id"
     WHERE i."status" NOT IN ('PAID','VOID','WRITE_OFF') AND i."dueDate" < CURRENT_DATE
     ORDER BY i."balanceDue" DESC LIMIT 5`
  )) as any[]

  // Top 5 opportunities: largest open orders not yet invoiced
  const topOpportunities = (await prisma.$queryRawUnsafe(
    `SELECT o."orderNumber", b."companyName" as "builderName", o."total"::float, o."status"
     FROM "Order" o LEFT JOIN "Builder" b ON o."builderId" = b."id"
     WHERE o."status" IN ('QUOTED','CONFIRMED','IN_PRODUCTION','STAGED')
     ORDER BY o."total" DESC LIMIT 5`
  ).catch(() => [])) as any[]

  return {
    revThisWeek: Number(revThisWeek[0]?.total || 0),
    revPriorWeek: Number(revPriorWeek[0]?.total || 0),
    ordersThisWeek: { count: ordersThisWeek[0]?.count || 0, total: Number(ordersThisWeek[0]?.total || 0) },
    ordersPriorWeek: { count: ordersPriorWeek[0]?.count || 0, total: Number(ordersPriorWeek[0]?.total || 0) },
    ar: {
      outstanding: Number(arRows[0]?.outstanding || 0),
      overdue: Number(arRows[0]?.overdue || 0),
      overdueCount: arRows[0]?.overdue_count || 0,
    },
    topRisks: topOverdue.map((r) => ({
      invoiceNumber: r.invoiceNumber,
      builderName: r.builderName || 'Unknown',
      balanceDue: Number(r.balanceDue),
      dueDate: r.dueDate ? new Date(r.dueDate).toISOString().slice(0, 10) : null,
    })),
    topOpportunities: topOpportunities.map((o) => ({
      orderNumber: o.orderNumber,
      builderName: o.builderName || 'Unknown',
      total: Number(o.total),
      status: o.status,
    })),
  }
}

function buildExecSystemPrompt(): string {
  return `You are the Abel Lumber executive briefing writer, writing directly to Nate Barrett (Owner/GM). Abel supplies doors, trim, and hardware to DFW production and custom homebuilders.

Voice: quiet competence, dry wit, no oversell. Exactly how Nate writes internal notes.
- Lead with the number that matters most this week.
- One-sentence paragraphs hit. Use them.
- No "best-in-class," "world-class," "industry-leading." No exclamation points.
- Never say "we are excited to announce." Never say "partner" as a verb.
- Specific places, specific names, specific dollar amounts.
- Builder-to-builder tone. Assume the reader knows the business.

Structure (about 150 words total):
- One-sentence headline (what moved this week, with the number).
- 2-3 sentences on revenue/orders week-over-week.
- 2-3 sentences on the top collection risk (name the builder and the dollar amount).
- 2-3 sentences on the top opportunity (name the order/builder and the dollar amount).
- Close with one direct sentence: what to do first thing tomorrow.

Never invent numbers not provided in the data.`
}

function buildExecUserPrompt(date: string, m: any): string {
  const rev = m.revThisWeek
  const prev = m.revPriorWeek
  const rwow = prev > 0 ? ((rev - prev) / prev) * 100 : null
  const risksText = m.topRisks.length
    ? m.topRisks.map((r: any) => `- ${r.invoiceNumber} · ${r.builderName} · $${r.balanceDue.toLocaleString()} · due ${r.dueDate}`).join('\n')
    : '(none)'
  const oppsText = m.topOpportunities.length
    ? m.topOpportunities.map((o: any) => `- ${o.orderNumber} · ${o.builderName} · $${o.total.toLocaleString()} · ${o.status}`).join('\n')
    : '(none)'
  return `Brief date: ${date}

WEEK-OVER-WEEK
- Revenue this week: $${rev.toLocaleString()}
- Revenue prior week: $${prev.toLocaleString()}
- W/W change: ${rwow == null ? 'no baseline' : `${rwow >= 0 ? '+' : ''}${rwow.toFixed(1)}%`}
- Orders this week: ${m.ordersThisWeek.count} ($${m.ordersThisWeek.total.toLocaleString()})
- Orders prior week: ${m.ordersPriorWeek.count} ($${m.ordersPriorWeek.total.toLocaleString()})

AR
- Outstanding: $${m.ar.outstanding.toLocaleString()}
- Overdue: $${m.ar.overdue.toLocaleString()} (${m.ar.overdueCount} invoices)

TOP COLLECTION RISKS
${risksText}

TOP OPEN OPPORTUNITIES
${oppsText}

Write the ~150-word executive brief now.`
}
