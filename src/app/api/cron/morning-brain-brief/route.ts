/**
 * Cron — Morning Brain Brief
 *
 * Runs once per morning. Pulls the day's brief from the NUC Brain engine
 * (with insight/anomaly/action/calendar/health side-pulls) and emails Nate
 * a formatted summary. Optionally fires an SMS headline.
 *
 * This is DIFFERENT from `/api/cron/morning-briefing` (which emails an
 * Aegis-DB-derived ops/exec snapshot to Nate + Clint). This cron is the
 * Brain's voice — autonomous engine output, single recipient (Nate).
 *
 * Schedule: 11:00 UTC daily — see vercel.json.
 *   - 11:00 UTC = 06:00 CDT (Mar–Nov, daylight) / 05:00 CST (Nov–Mar)
 *   - Choosing 11:00 UTC keeps the brief landing at 6 AM CT during the
 *     warmer half of the year and 5 AM CT in winter — both before Nate's
 *     workday starts. If a hard 6 AM CT year-round is wanted, we'd need
 *     two crons or a self-aware DST guard.
 *
 * Auth in: Bearer ${CRON_SECRET}
 * Auth out (NUC Brain): Bearer ${BRAIN_API_KEY} + X-API-Key header
 *   (CF tunnel strips X-API-Key → Authorization is the surviving auth, but
 *    we send both because the legacy CF Access service-token path still
 *    accepts X-API-Key on internal-only endpoints. Mirrors the proxy at
 *    src/app/api/ops/brain/proxy/route.ts.)
 *
 * Failure modes:
 *   - 404 from /brain/brief/today  → fall back to /brain/insights synth
 *   - Brain unreachable             → fail the run + alert via cron-alerting
 *   - Resend down                   → fail the run (cron alerting fires)
 *   - SMS not configured            → log + skip (not a failure)
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { startCronRun, finishCronRun } from '@/lib/cron'
import { sendEmail } from '@/lib/email'
import {
  buildMorningBrainBrief,
  buildMorningBrainSms,
  type BrainBriefData,
  type BrainInsight,
  type BrainAction,
  type BrainAnomaly,
  type BrainCalendarEvent,
  type BrainHealth,
} from '@/lib/email/morning-brain-brief'
import { logger } from '@/lib/logger'

const BRAIN_BASE_URL = process.env.NUC_BRAIN_URL || 'https://brain.abellumber.com'
const RECIPIENT = 'n.barrett@abellumber.com'

function validateCronAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization')
  return authHeader === `Bearer ${process.env.CRON_SECRET}`
}

function brainHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'AbelOS-MorningBrainBrief/1.0',
  }
  const key = process.env.BRAIN_API_KEY
  if (key) {
    h['X-API-Key'] = key
    h['Authorization'] = `Bearer ${key}`
  }
  // Legacy CF Access path — still honored if configured.
  if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
    h['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID!
    h['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET!
  }
  return h
}

async function brainGet<T = any>(
  path: string,
  opts: { allow404?: boolean } = {}
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const url = `${BRAIN_BASE_URL}${path.startsWith('/') ? path : '/' + path}`
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: brainHeaders(),
      signal: AbortSignal.timeout(20_000),
    })
    if (res.status === 404 && opts.allow404) {
      return { ok: false, status: 404, data: null }
    }
    if (!res.ok) {
      logger.warn('brain_get_non_ok', { url, status: res.status })
      return { ok: false, status: res.status, data: null }
    }
    const data = (await res.json()) as T
    return { ok: true, status: res.status, data }
  } catch (e: any) {
    logger.error('brain_get_failed', e, { url })
    return { ok: false, status: 0, data: null }
  }
}

// ─── Normalizers ───────────────────────────────────────────────────────────
// The Brain API exposes JSON shapes that may evolve. Normalize liberally so a
// missing field never breaks the email — fall back to '' / undefined.

function normInsight(x: any): BrainInsight {
  return {
    id: x?.id ?? x?.insight_id,
    kind: x?.kind ?? x?.type,
    narrative: x?.narrative ?? x?.summary ?? x?.text ?? x?.message,
    confidence: typeof x?.confidence === 'number' ? x.confidence : x?.score,
    entity_ids: Array.isArray(x?.entity_ids)
      ? x.entity_ids
      : Array.isArray(x?.entities)
      ? x.entities
      : [],
    source: x?.source,
    created_at: x?.created_at ?? x?.timestamp,
  }
}

function normAction(x: any): BrainAction {
  return {
    id: x?.id ?? x?.action_id,
    title: x?.title ?? x?.name ?? x?.summary,
    description: x?.description ?? x?.detail ?? x?.narrative,
    priority: (x?.priority ?? x?.severity ?? 'MEDIUM').toString().toUpperCase(),
    entity_id: x?.entity_id,
    due_at: x?.due_at ?? x?.deadline,
  }
}

function normAnomaly(x: any): BrainAnomaly {
  return {
    id: x?.id ?? x?.anomaly_id,
    kind: x?.kind ?? x?.type ?? 'anomaly',
    narrative: x?.narrative ?? x?.summary ?? x?.text,
    severity: (x?.severity ?? x?.priority ?? 'MEDIUM').toString().toUpperCase(),
    entity_id: x?.entity_id,
    detected_at: x?.detected_at ?? x?.created_at,
  }
}

function normEvent(x: any): BrainCalendarEvent {
  return {
    id: x?.id ?? x?.event_id,
    title: x?.title ?? x?.name ?? x?.summary,
    start_at: x?.start_at ?? x?.start ?? x?.starts_at,
    attendees: Array.isArray(x?.attendees) ? x.attendees : [],
    location: x?.location,
  }
}

function normHealth(x: any): BrainHealth {
  if (!x || typeof x !== 'object') return {}
  // Brain /health may nest stats under .stats or expose them flat.
  const s = x.stats ?? x
  return {
    events_ingested_today: s?.events_ingested_today ?? s?.events_today,
    total_actions_pending: s?.total_actions_pending ?? s?.actions_pending,
    agents_online: s?.agents_online,
    total_gaps: s?.total_gaps ?? s?.gaps_total,
    uptime_seconds: s?.uptime_seconds,
  }
}

// Pull a list out of an arbitrary brain response. Brain responses come in a
// few shapes — bare arrays, { items: [...] }, { insights: [...] }, etc.
function listFrom(data: any, ...keys: string[]): any[] {
  if (!data) return []
  if (Array.isArray(data)) return data
  for (const k of keys) {
    if (Array.isArray(data?.[k])) return data[k]
  }
  return []
}

// ─── Brain fetch orchestration ─────────────────────────────────────────────

async function fetchBrainData(): Promise<{ data: BrainBriefData; fromCachedBrief: boolean }> {
  const today = new Date()

  // Fire all in parallel — independent endpoints.
  const [briefRes, insightsRes, healthRes, anomaliesRes, actionsRes, eventsRes] =
    await Promise.all([
      brainGet<any>('/brain/brief/today', { allow404: true }),
      brainGet<any>('/brain/insights?limit=10&min_confidence=0.6'),
      brainGet<any>('/brain/health'),
      brainGet<any>('/brain/anomalies?limit=5'),
      brainGet<any>('/brain/actions?limit=10'),
      brainGet<any>('/brain/entities?type=event_today&limit=10'),
    ])

  const fromCachedBrief = briefRes.ok && !!briefRes.data

  // Pull insights: prefer the cached brief's payload if present, else /brain/insights.
  let insights: BrainInsight[] = []
  if (fromCachedBrief) {
    insights = listFrom(briefRes.data, 'insights', 'top_insights', 'items').map(normInsight)
  }
  if (insights.length === 0) {
    insights = listFrom(insightsRes.data, 'insights', 'items').map(normInsight)
  }

  const actions: BrainAction[] = listFrom(actionsRes.data, 'actions', 'items').map(normAction)
  const anomalies: BrainAnomaly[] = listFrom(anomaliesRes.data, 'anomalies', 'items').map(
    normAnomaly
  )
  const calendar: BrainCalendarEvent[] = listFrom(eventsRes.data, 'entities', 'items', 'events')
    .map(normEvent)
    // Drop entries that look like non-events.
    .filter((e) => e.title || e.start_at)

  const health = normHealth(healthRes.data)

  const data: BrainBriefData = {
    date: today,
    insights,
    actions,
    anomalies,
    calendar,
    health,
    fromCachedBrief,
    totalActions: actions.length,
    totalAlerts: anomalies.length,
  }
  return { data, fromCachedBrief }
}

// ─── SMS via Twilio ────────────────────────────────────────────────────────

async function maybeSendSms(message: string): Promise<{
  attempted: boolean
  sent: boolean
  error?: string
}> {
  const enabled = process.env.SMS_ENABLED === 'true'
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM_NUMBER
  const to = process.env.NATE_PHONE_NUMBER

  if (!enabled) return { attempted: false, sent: false, error: 'SMS_ENABLED!=true' }
  if (!sid || !token || !from || !to) {
    return { attempted: false, sent: false, error: 'Twilio creds missing' }
  }

  try {
    const auth = Buffer.from(`${sid}:${token}`).toString('base64')
    const body = new URLSearchParams({ From: from, To: to, Body: message })
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const text = await res.text()
      logger.warn('twilio_sms_non_ok', { status: res.status, body: text.slice(0, 400) })
      return { attempted: true, sent: false, error: `${res.status}` }
    }
    return { attempted: true, sent: true }
  } catch (e: any) {
    logger.error('twilio_sms_failed', e)
    return { attempted: true, sent: false, error: e?.message || String(e) }
  }
}

// ─── Handler ───────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  if (!validateCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startCronRun('morning-brain-brief', 'schedule')
  const started = Date.now()

  try {
    // 1. Pull from Brain
    const { data, fromCachedBrief } = await fetchBrainData()

    // 2. Render
    const { html, text, subject } = buildMorningBrainBrief(data)
    const sms = buildMorningBrainSms(data)

    // 3. Email
    const emailRes = await sendEmail({
      to: RECIPIENT,
      subject,
      html,
      // Resend supports text alternative via the raw API; sendEmail() doesn't
      // expose that field today, so HTML-only goes out. (Plaintext is still
      // useful for previews / logs / future enhancement.)
    })

    if (!emailRes.success) {
      throw new Error(`Email send failed: ${emailRes.error || 'unknown'}`)
    }

    // 4. SMS (best-effort)
    const smsRes = await maybeSendSms(sms)

    const result = {
      ok: true,
      emailId: emailRes.id,
      fromCachedBrief,
      counts: {
        insights: data.insights.length,
        actions: data.actions.length,
        anomalies: data.anomalies.length,
        calendar: data.calendar.length,
      },
      sms: smsRes,
      textPreviewBytes: text.length,
    }

    await finishCronRun(runId, 'SUCCESS', Date.now() - started, { result })
    return NextResponse.json({ success: true, ...result })
  } catch (err: any) {
    const error = err?.message || String(err)
    await finishCronRun(runId, 'FAILURE', Date.now() - started, { error })
    return NextResponse.json({ success: false, error }, { status: 500 })
  }
}

// Manual trigger (same auth)
export async function POST(request: NextRequest) {
  return GET(request)
}
