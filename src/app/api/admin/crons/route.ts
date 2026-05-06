export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import { getCronSummaries, getCronRuns, detectCronDrift, REGISTERED_CRONS } from '@/lib/cron'
import { logAudit } from '@/lib/audit'

// GET  /api/admin/crons              → summary of all registered crons + drift
// GET  /api/admin/crons?name=mrp-nightly → recent runs for one cron
// POST /api/admin/crons { name }     → manually trigger a cron (ADMIN only)
//
// Mirrors /api/ops/admin/crons. Kept because the legacy /admin/crons page
// still points here. Both endpoints are ADMIN-gated via permissions.ts.

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
    console.error('[admin/crons] error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to load cron data' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

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

  const known = REGISTERED_CRONS.find((c) => c.name === name)
  if (!known) {
    return NextResponse.json({ error: `Unknown cron: ${name}` }, { status: 404 })
  }

  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  const proto = request.headers.get('x-forwarded-proto') || 'https'
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3000'
  const origin = `${proto}://${host}`
  const targetUrl = `${origin}/api/cron/${encodeURIComponent(name)}`

  const staffId = request.headers.get('x-staff-id') || 'unknown'
  logAudit({
    staffId,
    action: 'CRON_MANUAL_TRIGGER',
    entity: 'CronRun',
    entityId: name,
    details: { name, schedule: known.schedule, source: '/admin/crons' },
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
    console.error('[admin/crons] trigger failed:', error)
    return NextResponse.json({ error: error?.message || 'Failed to trigger cron', name }, { status: 500 })
  }
}
