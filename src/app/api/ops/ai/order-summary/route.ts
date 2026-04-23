export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { generate, getOrGenerate, checkAIRateLimit, isAIConfigured } from '@/lib/ai/insights'
import { audit, getStaffFromHeaders } from '@/lib/audit'

/**
 * POST /api/ops/ai/order-summary
 * Body: { orderId: string, force?: boolean }
 *
 * Returns a 3-sentence summary + 3 bullet action items.
 * Cached keyed by (orderId, updatedAt).
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  if (!isAIConfigured()) {
    return NextResponse.json({ error: 'AI not configured' }, { status: 503 })
  }

  try {
    const { orderId, force } = (await request.json().catch(() => ({}))) as {
      orderId?: string
      force?: boolean
    }
    if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 })

    const { staffId } = getStaffFromHeaders(request.headers)
    const rl = await checkAIRateLimit(staffId)
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'AI rate limit exceeded', resetIn: rl.resetIn },
        { status: 429 }
      )
    }

    // Pull order + line items + builder
    const order = (await prisma.$queryRawUnsafe(
      `SELECT o."id", o."orderNumber", o."status", o."total", o."subtotal",
              o."createdAt", o."updatedAt", o."requestedDeliveryDate", o."notes",
              b."companyName" as "builderName", b."id" as "builderId"
       FROM "Order" o
       LEFT JOIN "Builder" b ON o."builderId" = b."id"
       WHERE o."id" = $1
       LIMIT 1`,
      orderId
    )) as any[]
    if (!order[0]) return NextResponse.json({ error: 'order not found' }, { status: 404 })
    const o = order[0]

    const items = (await prisma.$queryRawUnsafe(
      `SELECT "productName","quantity","unitPrice","lineTotal"
       FROM "OrderItem" WHERE "orderId" = $1 LIMIT 50`,
      orderId
    )) as any[]

    const updatedAtKey = new Date(o.updatedAt).getTime()
    const cacheKey = `order:${orderId}:${updatedAtKey}`

    const { result, cached, generatedAt } = await getOrGenerate({
      cacheKey,
      ttlSeconds: 3600,
      force,
      generate: async () => {
        const systemPrompt = buildOrderSystemPrompt()
        const userPrompt = buildOrderUserPrompt(o, items)
        return generate({
          endpoint: 'order-summary',
          systemPrompt,
          userPrompt,
          maxTokens: 512,
          inputKey: `${orderId}:${updatedAtKey}`,
          staffId,
        })
      },
    })

    audit(request, 'GENERATE', 'AIInsight', orderId, { endpoint: 'order-summary', cached }).catch(() => {})

    return NextResponse.json({
      ok: true,
      cached,
      generatedAt,
      orderId,
      summary: result.text,
      model: result.model,
      costEstimate: result.costEstimate,
    })
  } catch (err: any) {
    console.error('[ai/order-summary]', err)
    return NextResponse.json({ error: err?.message || 'internal' }, { status: 500 })
  }
}

function buildOrderSystemPrompt(): string {
  return `You are an operations co-pilot for Abel Lumber (Abel Doors & Trim), a DFW door/trim/hardware supplier to production and custom homebuilders. Abel's voice is quiet competence, dry wit, no oversell.

Given one order's state, produce exactly:
1) A 3-sentence summary of what this order is, where it stands, and any risk signal (late ship, hold, margin compression, etc.).
2) Exactly 3 bullet action items — each starts with a verb, names a specific person or team when possible ("Dawn to...", "PM to..."), and includes a number (dollar amount, date, or quantity).

Format your response as:

SUMMARY
<three sentences>

ACTIONS
- <verb-led action with number>
- <verb-led action with number>
- <verb-led action with number>

Rules:
- Lead with the number when it matters.
- No "best-in-class" or marketing fluff.
- If data is thin, say so plainly.
- Never invent figures.`
}

function buildOrderUserPrompt(order: any, items: any[]): string {
  const lines = items
    .map((i: any) => `- ${i.productName} ×${i.quantity} @ $${Number(i.unitPrice).toLocaleString()} = $${Number(i.lineTotal).toLocaleString()}`)
    .join('\n')
  return `Order ${order.orderNumber}
Builder: ${order.builderName || 'Unknown'}
Status: ${order.status}
Total: $${Number(order.total || 0).toLocaleString()} (subtotal $${Number(order.subtotal || 0).toLocaleString()})
Created: ${order.createdAt ? new Date(order.createdAt).toISOString().slice(0, 10) : 'n/a'}
Last updated: ${order.updatedAt ? new Date(order.updatedAt).toISOString().slice(0, 10) : 'n/a'}
Requested delivery: ${order.requestedDeliveryDate ? new Date(order.requestedDeliveryDate).toISOString().slice(0, 10) : 'n/a'}
Notes: ${order.notes || '(none)'}

Line items:
${lines || '(none)'}`
}
