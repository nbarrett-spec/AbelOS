export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/health/uptime — A-OBS-8: External uptime probe target.
//
// Minimal, fast, no auth, no DB. Liveness only — answers "is the Vercel
// function able to respond at all?". For dependency-aware probing use
// /api/health/deep (DB + Redis + integration env-vars) or /api/health/ready
// (DB + critical env-vars).
//
// ─── Why this endpoint exists ─────────────────────────────────────────────
// /api/cron/uptime-probe is self-monitoring (Vercel hits Vercel) — useless
// when Vercel itself is down. This endpoint is the target for an EXTERNAL
// monitoring service running outside our infra.
//
// ─── Recommended external services to point at this URL ───────────────────
//   • BetterStack (formerly BetterUptime) — https://betterstack.com/uptime
//       Free tier: 10 monitors, 30s checks. Paid adds status page +
//       multi-region + webhooks/alerts. Recommended default.
//   • Checkly — https://checklyhq.com  (browser/API checks, multi-region)
//   • UptimeRobot — https://uptimerobot.com  (free tier: 50 monitors / 5min)
//   • Pingdom — paid, enterprise-grade
//
// Configuration template for the chosen service:
//   URL:           https://app.abellumber.com/api/health/uptime
//   Method:        GET
//   Interval:      60s (BetterStack default 30s also fine)
//   Timeout:       5s  (this endpoint typically responds in <50ms)
//   Expected:      HTTP 200 + body contains `"status":"ok"`
//   Alert channel: PagerDuty / SMS / email — Nate + Clint
//   Regions:       at minimum US-East + US-West to detect regional outages
//
// ─── Performance budget ───────────────────────────────────────────────────
// Target <50ms p99. No DB, no Redis, no fetch — anything that touches the
// network goes in /api/health/deep instead. If you find yourself adding a
// dependency check here, stop: that breaks the contract that this endpoint
// answers regardless of upstream state, which is the whole point.
// ──────────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    return NextResponse.json(
      {
        status: 'ok',
        timestamp: new Date().toISOString(),
      },
      {
        status: 200,
        headers: {
          // Prevent any CDN/edge layer from caching a stale "ok" past an
          // outage. Uptime monitors expect every probe to round-trip the
          // origin function.
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    )
  } catch {
    // Defensive only — there is no path that can throw above. Kept so
    // future edits cannot accidentally turn a probe into a 500.
    return NextResponse.json({ status: 'error' }, { status: 503 })
  }
}
