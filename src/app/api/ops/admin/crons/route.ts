export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import { getCronSummaries, getCronRuns, detectCronDrift, REGISTERED_CRONS } from '@/lib/cron'
import { logAudit } from '@/lib/audit'

// GET  /api/ops/admin/crons              → summary of all registered crons + drift
// GET  /api/ops/admin/crons?name=mrp-nightly → recent runs for one cron
// POST /api/ops/admin/crons { name }     → manually trigger a cron (ADMIN only)
//
// Auth note: route is gated to ADMIN via API_ACCESS in src/lib/permissions.ts.
// The Run-now POST proxies to /api/cron/<name> with the CRON_SECRET so it
// exercises the exact same code path Vercel's scheduler hits — works for
// every cron uniformly without needing each route to expose its own
// staff-auth POST handler.

export async function GET(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const name = searchParams.get('name')
  const limit = Math.min(Number(searchParams.get('limit') || '25'), 100)

  try {
    if (name) {
      const runs = await getCronRuns(name, limit)
      return NextResponse.json({ name, runs })
    }

    const [summaries, drift] = await Promise.all([
      getCronSummaries(),
      detectCronDrift(),
    ])
    return NextResponse.json({ crons: summaries, drift })
  } catch (error: any) {
    console.error('[ops/admin/crons] error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to load cron data' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  // Only ADMIN — the staff-auth helper already prefix-matches API_ACCESS to
  // ['ADMIN'], but be defensive: re-check the role from headers in case
  // someone widens the prefix later.
  const rolesHeader = request.headers.get('x-staff-roles') || request.headers.get('x-staff-role') || ''
  const roles = rolesHeader.split(',').map((r) => r.trim()).filter(Boolean)
  if (!roles.includes('ADMIN')) {
    return NextResponse.json({ error: 'ADMIN role required' }, { status: 403 })
  }

  let body: any = null
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const name = String(body?.name || '').trim()
  if (!name) {
    return NextResponse.json({ error: 'name required' }, { status: 400 })
  }

  // Only allow names from the REGISTERED_CRONS allow-list. Stops a logged-in
  // ADMIN from poking around at arbitrary /api/cron/<anything> URLs through
  // this proxy.
  const known = REGISTERED_CRONS.find((c) => c.name === name)
  if (!known) {
    return NextResponse.json({ error: `Unknown cron: ${name}` }, { status: 404 })
  }

  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  // Best-effort origin reconstruction. Works on Vercel (forwarded headers)
  // and local dev. Falls back to localhost so dev `npm run dev` works.
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3000'
  const origin = `${proto}://${host}`
  const targetUrl = `${origin}/api/cron/${encodeURIComponent(name)}`

  // Audit log first so we have a record even if the trigger blows up.
  const staffId = request.headers.get('x-staff-id') || 'unknown'
  logAudit({
    staffId,
    action: 'CRON_MANUAL_TRIGGER',
    entity: 'CronRun',
    entityId: name,
    details: { name, schedule: known.schedule, source: '/ops/admin/crons' },
    severity: 'INFO',
  }).catch(() => {})

  try {
    const upstream = await fetch(targetUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cronSecret}` },
      cache: 'no-store',
    })
    const text = await upstream.text()
    let parsed: any = null
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = { raw: text.slice(0, 500) }
    }
    return NextResponse.json({
      ok: upstream.ok,
      status: upstream.status,
      name,
      result: parsed,
    }, { status: upstream.ok ? 200 : 502 })
  } catch (error: any) {
    console.error('[ops/admin/crons] trigger failed:', error)
    return NextResponse.json({ error: error?.message || 'Failed to trigger cron', name }, { status: 500 })
  }
}
