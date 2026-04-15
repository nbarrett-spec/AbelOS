export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { listRecentIncidents, listAlertRollups } from '@/lib/alert-history'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/admin/alert-history  → recent alert fire/clear timeline + rollups
//
// Backed by the AlertIncident table populated by snapshotAlerts() inside
// /api/ops/system-alerts. Each row represents a single fire→clear window
// for a specific alert id (e.g., "client-errors", "dead-letter").
//
// Query params:
//   ?since=24    hours back for the timeline, 1..720 (default 24)
//   ?rollup=168  hours back for the per-alert rollup, 1..720 (default 168
//                / 7 days — longer window to spot recurring offenders)
//   ?limit=200   row cap on the timeline, 1..1000 (default 200)
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const sinceHours = Math.min(
    Math.max(parseInt(searchParams.get('since') || '24'), 1),
    720
  )
  const rollupHours = Math.min(
    Math.max(parseInt(searchParams.get('rollup') || '168'), 1),
    720
  )
  const limit = Math.min(
    Math.max(parseInt(searchParams.get('limit') || '200'), 1),
    1000
  )

  const [incidents, rollups] = await Promise.all([
    listRecentIncidents(sinceHours, limit),
    listAlertRollups(rollupHours),
  ])

  const openCount = incidents.filter((i) => i.endedAt === null).length

  return NextResponse.json({
    sinceHours,
    rollupHours,
    limit,
    openCount,
    incidents,
    rollups,
  })
}
