export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { startCronRun, finishCronRun } from '@/lib/cron'
import { fetchCalendarEvents, calendarEventToBrainEvent } from '@/lib/integrations/calendar'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/cron/calendar-sync
//
// Pulls calendar events for the configured user (CALENDAR_USER env, default
// n.barrett@abellumber.com) over a 24h-back / 14d-forward window.
//
// Pushes to Brain /brain/ingest/batch as `calendar` source events.
// Brain dedups by source_id (`cal:<google_event_id>`) so same events
// re-pushed don't duplicate.
//
// Schedule: every 30 min. Set in vercel.json.
// Auth: Bearer ${CRON_SECRET}
// ──────────────────────────────────────────────────────────────────────────

const BRAIN_BASE_URL = process.env.NUC_BRAIN_URL || 'https://brain.abellumber.com'

function validateCronAuth(req: NextRequest): boolean {
  return req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

export async function GET(req: NextRequest) {
  if (!validateCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startCronRun('calendar-sync', 'schedule')
  const started = Date.now()

  // 1) Pull from Google Calendar
  const sync = await fetchCalendarEvents({ lookbackHrs: 24, lookaheadDays: 14, max: 250 })
  if (!sync.ok) {
    await finishCronRun(runId, 'FAILURE', Date.now() - started, {
      error: sync.error || 'calendar fetch failed',
    })
    return NextResponse.json(
      { success: false, error: sync.error, fetchedAt: sync.fetchedAt },
      { status: 502 }
    )
  }

  // 2) Transform to Brain events
  const brainEvents = sync.events.map(calendarEventToBrainEvent)
  if (brainEvents.length === 0) {
    await finishCronRun(runId, 'SUCCESS', Date.now() - started, {
      result: { events: 0, sent: 0, window: `${sync.windowFrom} → ${sync.windowTo}` },
    })
    return NextResponse.json({
      success: true, fetched: 0, sent: 0, window: { from: sync.windowFrom, to: sync.windowTo },
    })
  }

  // 3) Push to Brain
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'AbelOS-CalendarSync/1.0',
  }
  const brainApiKey = process.env.BRAIN_API_KEY
  if (brainApiKey) {
    headers['X-API-Key'] = brainApiKey
    headers['Authorization'] = `Bearer ${brainApiKey}` // CF strips X-API-Key
  }
  const cfId = process.env.CF_ACCESS_CLIENT_ID
  const cfSecret = process.env.CF_ACCESS_CLIENT_SECRET
  if (cfId && cfSecret) {
    headers['CF-Access-Client-Id'] = cfId
    headers['CF-Access-Client-Secret'] = cfSecret
  }

  let sent = 0
  let lastStatus = 0
  let lastBody = ''
  try {
    const r = await fetch(`${BRAIN_BASE_URL}/brain/ingest/batch`, {
      method: 'POST',
      headers,
      body: JSON.stringify(brainEvents),
      signal: AbortSignal.timeout(45_000),
      redirect: 'manual',
    })
    lastStatus = r.status
    lastBody = (await r.text().catch(() => '')).slice(0, 200)
    if (r.ok) sent = brainEvents.length
  } catch (e: any) {
    lastBody = `fetch error: ${e?.message || e}`
  }

  const ok = sent > 0
  const result = {
    fetched: brainEvents.length,
    sent,
    brain_status: lastStatus,
    brain_body: lastBody,
    window: { from: sync.windowFrom, to: sync.windowTo },
  }
  await finishCronRun(
    runId,
    ok ? 'SUCCESS' : 'FAILURE',
    Date.now() - started,
    ok ? { result } : { result, error: lastBody || 'no events sent' }
  )
  return NextResponse.json({ success: ok, ...result }, { status: ok ? 200 : 502 })
}
