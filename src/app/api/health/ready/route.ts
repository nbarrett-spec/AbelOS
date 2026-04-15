export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { runReadinessChecks } from '@/lib/readiness'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/health/ready — Readiness probe.
//
// Unlike /api/health (liveness: "process is alive"), this endpoint verifies
// the server can actually serve traffic:
//   - Database connectivity (round-trip a trivial query)
//   - Critical env vars are defined
//
// Response is 200 if healthy, 503 if anything critical is broken. Response
// body always contains a per-check breakdown so external monitors can show
// which dependency failed.
//
// Point uptime monitors (UptimeRobot, BetterUptime, etc.) at this URL. Keep
// the timeout short — 5s is plenty. The probe logic is shared with the
// uptime-probe cron so the historical view matches the live probe.
// ──────────────────────────────────────────────────────────────────────────

export async function GET() {
  const snapshot = await runReadinessChecks()
  const status = snapshot.status === 'ready' ? 200 : 503
  return NextResponse.json(snapshot, { status })
}
