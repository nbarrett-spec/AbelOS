/**
 * Google Calendar integration — service-account / domain-wide delegation.
 *
 * Mirrors src/lib/integrations/gmail.ts auth pattern: reuses the same
 * GOOGLE_SERVICE_ACCOUNT_KEY env var, impersonates the configured calendar
 * owner, and pulls events from the primary calendar.
 *
 * Used by /api/cron/calendar-sync.
 */

import crypto from 'node:crypto'
import { loadServiceAccountKey } from './gmail'

// ──────────────────────────────────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────────────────────────────────
const CAL_USER = process.env.CALENDAR_USER || process.env.GOOGLE_CAL_USER || 'n.barrett@abellumber.com'
const CAL_ID = process.env.CALENDAR_ID || 'primary'
const CAL_SCOPES = ['https://www.googleapis.com/auth/calendar.readonly']

const tokenCache = new Map<string, { token: string; expiresAt: number }>()

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────
export interface CalendarEvent {
  id: string
  summary?: string
  description?: string
  location?: string
  status?: string
  start?: { dateTime?: string; date?: string; timeZone?: string }
  end?: { dateTime?: string; date?: string; timeZone?: string }
  attendees?: Array<{ email: string; displayName?: string; responseStatus?: string }>
  organizer?: { email?: string; displayName?: string }
  htmlLink?: string
  hangoutLink?: string
  conferenceData?: { entryPoints?: Array<{ uri?: string; entryPointType?: string }> }
  created?: string
  updated?: string
  recurringEventId?: string
}

interface ServiceAccountKey {
  client_email: string
  private_key: string
  token_uri: string
}

// ──────────────────────────────────────────────────────────────────────────
// JWT mint + token exchange (duplicated from gmail.ts to avoid coupling;
// future refactor: extract to src/lib/integrations/google-auth.ts)
// ──────────────────────────────────────────────────────────────────────────
function createJwt(key: ServiceAccountKey, scopes: string[], userEmail: string): string {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: key.client_email,
    sub: userEmail,
    scope: scopes.join(' '),
    aud: key.token_uri,
    iat: now,
    exp: now + 3600,
  }
  const encode = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const signingInput = `${encode(header)}.${encode(payload)}`
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(signingInput)
    .sign(key.private_key, 'base64url')
  return `${signingInput}.${signature}`
}

// Returns either the access token, or a structured error so callers can
// surface the precise Google Workspace failure (DwD scope misconfig, etc.).
async function getAccessTokenOrError(userEmail: string): Promise<{ token: string } | { error: string; detail?: string }> {
  const cacheKey = `${userEmail}:cal`
  const cached = tokenCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) return { token: cached.token }

  const keyResult = loadServiceAccountKey()
  if ('error' in keyResult) {
    return { error: 'service_account_key', detail: keyResult.error }
  }

  try {
    const jwt = createJwt(keyResult, CAL_SCOPES, userEmail)
    const r = await fetch(keyResult.token_uri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }).toString(),
    })
    if (!r.ok) {
      const body = (await r.text().catch(() => '')).slice(0, 400)
      return { error: `token_exchange_${r.status}`, detail: body }
    }
    const j = await r.json()
    const expiresInMs = (j.expires_in ?? 3600) * 1000
    tokenCache.set(cacheKey, { token: j.access_token, expiresAt: Date.now() + expiresInMs })
    return { token: j.access_token }
  } catch (e: any) {
    return { error: 'token_fetch_threw', detail: e?.message?.slice(0, 200) }
  }
}

async function getAccessToken(userEmail: string): Promise<string | null> {
  const r = await getAccessTokenOrError(userEmail)
  return 'token' in r ? r.token : null
}

// ──────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────
export interface CalendarSyncResult {
  ok: boolean
  events: CalendarEvent[]
  error?: string
  fetchedAt: string
  windowFrom: string
  windowTo: string
}

/**
 * Fetch events from primary calendar within a time window.
 * Default: last 24h + next 14 days.
 */
export async function fetchCalendarEvents(
  opts: { lookbackHrs?: number; lookaheadDays?: number; max?: number } = {}
): Promise<CalendarSyncResult> {
  const lookbackHrs = opts.lookbackHrs ?? 24
  const lookaheadDays = opts.lookaheadDays ?? 14
  const max = opts.max ?? 250
  const now = new Date()
  const timeMin = new Date(now.getTime() - lookbackHrs * 3600_000).toISOString()
  const timeMax = new Date(now.getTime() + lookaheadDays * 86400_000).toISOString()

  const empty: CalendarSyncResult = {
    ok: false, events: [],
    fetchedAt: now.toISOString(), windowFrom: timeMin, windowTo: timeMax,
  }

  const tokRes = await getAccessTokenOrError(CAL_USER)
  if ('error' in tokRes) {
    return { ...empty, error: `${tokRes.error}: ${tokRes.detail || ''}`.slice(0, 400) }
  }
  const token = tokRes.token

  try {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CAL_ID)}/events`)
    url.searchParams.set('timeMin', timeMin)
    url.searchParams.set('timeMax', timeMax)
    url.searchParams.set('singleEvents', 'true')        // expand recurring
    url.searchParams.set('orderBy', 'startTime')
    url.searchParams.set('maxResults', String(max))

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      return { ...empty, error: `calendar_api_${r.status}: ${body.slice(0, 200)}` }
    }
    const json = await r.json()
    const events: CalendarEvent[] = (json.items || []) as CalendarEvent[]
    return { ok: true, events, fetchedAt: now.toISOString(), windowFrom: timeMin, windowTo: timeMax }
  } catch (e: any) {
    return { ...empty, error: `fetch_failed: ${e?.message || e}` }
  }
}

/**
 * Format a CalendarEvent into a Brain ingest payload shape.
 */
export function calendarEventToBrainEvent(e: CalendarEvent) {
  const startStr = e.start?.dateTime || e.start?.date || ''
  const endStr = e.end?.dateTime || e.end?.date || ''
  const start = startStr ? new Date(startStr) : null
  const isFuture = start && start.getTime() > Date.now()
  const isToday = start && start.toDateString() === new Date().toDateString()
  const attendees = (e.attendees || [])
    .map(a => a.displayName || a.email)
    .filter(Boolean)
    .slice(0, 8)
    .join(', ')
  const meetUrl =
    e.hangoutLink ||
    e.conferenceData?.entryPoints?.find(p => p.entryPointType === 'video')?.uri ||
    ''

  const title =
    `${isToday ? '[TODAY] ' : isFuture ? '' : '[PAST] '}` +
    (e.summary || '(no title)').slice(0, 180)

  const content = [
    e.summary ? `Event: ${e.summary}` : '',
    startStr ? `Start: ${startStr}` : '',
    endStr ? `End: ${endStr}` : '',
    e.location ? `Location: ${e.location}` : '',
    meetUrl ? `Meet: ${meetUrl}` : '',
    attendees ? `Attendees: ${attendees}` : '',
    e.organizer?.email ? `Organizer: ${e.organizer.email}` : '',
    e.description ? `\nDescription:\n${e.description.slice(0, 800)}` : '',
  ].filter(Boolean).join('\n')

  return {
    source: 'calendar',
    source_id: `cal:${e.id}`,
    event_type: isFuture ? 'calendar_upcoming' : 'calendar_past',
    title,
    content,
    tags: [
      'calendar',
      isToday ? 'today' : isFuture ? 'upcoming' : 'past',
      e.status || 'confirmed',
    ].filter(Boolean),
    timestamp: startStr || e.created || undefined,
    priority: isToday ? 'P1' : 'P3',
    raw_data: {
      htmlLink: e.htmlLink,
      attendeeCount: e.attendees?.length || 0,
      hasMeetLink: !!meetUrl,
      organizer: e.organizer?.email,
      recurringEventId: e.recurringEventId,
    },
  }
}
