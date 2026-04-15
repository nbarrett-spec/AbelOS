export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { muteAlert, unmuteAlert, listMutes } from '@/lib/alert-mutes'

// ──────────────────────────────────────────────────────────────────────────
// /api/admin/alert-mute
//
// GET    — list recent mutes (active + expired within the window)
// POST   — upsert a mute { alertId, durationHours, reason?, mutedBy? }
// DELETE — clear a mute, ?alertId=<id>
//
// All three verbs are staff-gated via checkStaffAuth. The library in
// src/lib/alert-mutes.ts handles validation, clamping duration to a
// sensible 5min..7d range, and swallowing DB errors back to structured
// ok/error responses.
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const sinceHours = parseInt(searchParams.get('since') || '168', 10) || 168
  const mutes = await listMutes(sinceHours)
  const now = new Date().toISOString()
  return NextResponse.json({
    sinceHours,
    now,
    total: mutes.length,
    active: mutes.filter((m) => m.mutedUntil > now).length,
    mutes,
  })
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid JSON body' },
      { status: 400 }
    )
  }

  const alertId = typeof body?.alertId === 'string' ? body.alertId.trim() : ''
  const durationHours =
    typeof body?.durationHours === 'number'
      ? body.durationHours
      : Number(body?.durationHours)
  const reason =
    typeof body?.reason === 'string' ? body.reason : undefined
  // Pull the operator identity from staff headers if api-auth set them;
  // fall back to the explicit field so a CLI client can override.
  const mutedBy =
    (typeof body?.mutedBy === 'string' && body.mutedBy) ||
    request.headers.get('x-user-email') ||
    request.headers.get('x-staff-email') ||
    'admin'

  if (!alertId) {
    return NextResponse.json(
      { ok: false, error: 'alertId is required' },
      { status: 400 }
    )
  }
  if (!Number.isFinite(durationHours) || durationHours <= 0) {
    return NextResponse.json(
      { ok: false, error: 'durationHours must be a positive number' },
      { status: 400 }
    )
  }

  const result = await muteAlert({ alertId, durationHours, reason, mutedBy })
  if (!result.ok) {
    return NextResponse.json(result, { status: 500 })
  }
  return NextResponse.json({
    ok: true,
    alertId,
    mutedUntil: result.mutedUntil,
    reason: reason ?? null,
    mutedBy,
  })
}

export async function DELETE(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const alertId = (searchParams.get('alertId') || '').trim()
  if (!alertId) {
    return NextResponse.json(
      { ok: false, error: 'alertId query param is required' },
      { status: 400 }
    )
  }

  const result = await unmuteAlert(alertId)
  if (!result.ok) {
    return NextResponse.json(result, { status: 500 })
  }
  return NextResponse.json({ ok: true, alertId })
}
