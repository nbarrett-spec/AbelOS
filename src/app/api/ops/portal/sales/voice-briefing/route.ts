export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { isElevenLabsConfigured, generateBriefingAudio } from '@/lib/elevenlabs'

/**
 * POST /api/ops/portal/sales/voice-briefing
 * Body: { stops: [{ builderId, scheduledAt, companyName }], staffName? }
 *
 * Builds a short in-vehicle script from the day's stops — for each stop
 * includes last-touch age, open quote/invoice count — and synthesizes mp3.
 *
 * Graceful if ElevenLabs isn't configured: returns 503 with a plain-text
 * script the client can show instead.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json().catch(() => ({}))
    const stops: Array<{ builderId: string; scheduledAt?: string; companyName?: string }> = body.stops || []
    const staffName: string = body.staffName || 'team'

    if (!stops.length) {
      return NextResponse.json({ error: 'stops[] required' }, { status: 400 })
    }

    // Build per-stop briefing lines
    const lines: string[] = []
    for (let i = 0; i < stops.length; i++) {
      const s = stops[i]
      const idx = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth'][i] || `Stop ${i + 1}`

      const [builderRows, ar, lastTouch, openQuotes]: any[] = await Promise.all([
        prisma.$queryRawUnsafe(
          `SELECT "companyName" FROM "Builder" WHERE "id"=$1 LIMIT 1`,
          s.builderId,
        ),
        prisma.$queryRawUnsafe(
          `SELECT COALESCE(SUM("total" - COALESCE("amountPaid",0)),0)::float AS "outstanding",
                  COUNT(*) FILTER (WHERE "dueDate" < CURRENT_DATE)::int  AS "overdueCount"
           FROM "Invoice" WHERE "builderId"=$1 AND "status"::text IN ('ISSUED','SENT','PARTIALLY_PAID','OVERDUE')
             AND ("total" - COALESCE("amountPaid",0)) > 0`,
          s.builderId,
        ),
        prisma.$queryRawUnsafe(
          `SELECT MAX(at) AS last FROM (
             SELECT COALESCE("sentAt","createdAt") AS at FROM "CommunicationLog" WHERE "builderId"=$1
             UNION ALL
             SELECT "createdAt" AS at FROM "Activity" WHERE "builderId"=$1
           ) x`,
          s.builderId,
        ),
        prisma.$queryRawUnsafe(
          `SELECT COUNT(*)::int AS n FROM "Quote" q
           JOIN "Project" p ON p."id" = q."projectId"
           WHERE p."builderId" = $1 AND q."status"::text IN ('SENT','DRAFT')`,
          s.builderId,
        ),
      ])
      const name = builderRows?.[0]?.companyName || s.companyName || 'this builder'

      const timeStr = s.scheduledAt
        ? new Date(s.scheduledAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        : null
      const overdue = Number(ar?.[0]?.overdueCount || 0)
      const outstanding = Number(ar?.[0]?.outstanding || 0)
      const quotes = Number(openQuotes?.[0]?.n || 0)
      const last = lastTouch?.[0]?.last ? new Date(lastTouch[0].last) : null
      const daysAgo = last ? Math.max(0, Math.floor((Date.now() - last.getTime()) / 86400000)) : null

      const pieces: string[] = []
      pieces.push(`${idx}${timeStr ? ` at ${timeStr}` : ''} with ${name}.`)
      if (daysAgo !== null) {
        pieces.push(`Last touched ${daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo} days ago`}.`)
      } else {
        pieces.push(`No recent touch on record.`)
      }
      if (quotes > 0) pieces.push(`${quotes} open quote${quotes === 1 ? '' : 's'}.`)
      if (overdue > 0) pieces.push(`${overdue} overdue invoice${overdue === 1 ? '' : 's'}, ${formatMoney(outstanding)} outstanding.`)
      if (quotes === 0 && overdue === 0) pieces.push(`No open issues.`)
      lines.push(pieces.join(' '))
    }

    const intro = `Morning ${staffName}. ${stops.length} stop${stops.length === 1 ? '' : 's'} today.`
    const scriptText = [intro, ...lines].join(' ')

    if (!isElevenLabsConfigured()) {
      return NextResponse.json(
        { ok: false, configured: false, script: scriptText },
        { status: 503 },
      )
    }

    const audio = await generateBriefingAudio({ staffName, briefingText: lines.join(' ') })
    if ('error' in audio) {
      return NextResponse.json({ ok: false, error: audio.error, script: scriptText }, { status: 502 })
    }

    return new Response(audio.audio, {
      status: 200,
      headers: {
        'Content-Type': audio.contentType,
        'Content-Length': audio.byteLength.toString(),
        'Cache-Control': 'private, no-store',
        'X-Briefing-Script': Buffer.from(scriptText).toString('base64'),
      },
    })
  } catch (err: any) {
    console.error('[voice-briefing]', err)
    return NextResponse.json({ error: err?.message || 'internal' }, { status: 500 })
  }
}

function formatMoney(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US')
}
