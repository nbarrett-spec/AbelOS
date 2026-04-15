export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

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
// the timeout short — 5s is plenty.
// ──────────────────────────────────────────────────────────────────────────

interface CheckResult {
  name: string
  ok: boolean
  /** Latency in ms if the check did a round-trip. */
  ms?: number
  /** Short error string on failure. */
  error?: string
}

// Env vars that MUST be present for the app to function. Missing any of
// these is a critical failure.
const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'NEXT_PUBLIC_APP_URL',
] as const

// Env vars that SHOULD be present but won't block traffic. Missing these
// degrade functionality but the app still serves.
const OPTIONAL_ENV_VARS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'SENDGRID_API_KEY',
  'CRON_SECRET',
] as const

async function checkDatabase(): Promise<CheckResult> {
  const started = Date.now()
  try {
    // Round-trip a trivial query. Prisma lazy-connects so this also
    // verifies the connection can be established.
    const rows: any[] = await prisma.$queryRawUnsafe(`SELECT 1 AS ok`)
    const ms = Date.now() - started
    if (Array.isArray(rows) && rows[0]?.ok === 1) {
      return { name: 'database', ok: true, ms }
    }
    return { name: 'database', ok: false, ms, error: 'unexpected query result' }
  } catch (e: any) {
    return {
      name: 'database',
      ok: false,
      ms: Date.now() - started,
      error: e?.message?.slice(0, 200) || String(e).slice(0, 200),
    }
  }
}

function checkRequiredEnv(): CheckResult {
  const missing = REQUIRED_ENV_VARS.filter((k) => !process.env[k])
  if (missing.length === 0) return { name: 'required-env', ok: true }
  return {
    name: 'required-env',
    ok: false,
    error: `missing: ${missing.join(', ')}`,
  }
}

function checkOptionalEnv(): CheckResult {
  const missing = OPTIONAL_ENV_VARS.filter((k) => !process.env[k])
  // Optional env is never "failed" — we just report which are missing.
  // The readiness probe itself still passes.
  return {
    name: 'optional-env',
    ok: true,
    error: missing.length > 0 ? `missing: ${missing.join(', ')}` : undefined,
  }
}

export async function GET() {
  const started = Date.now()

  const [db, requiredEnv, optionalEnv] = await Promise.all([
    checkDatabase(),
    Promise.resolve(checkRequiredEnv()),
    Promise.resolve(checkOptionalEnv()),
  ])

  const criticalChecks = [db, requiredEnv]
  const allOk = criticalChecks.every((c) => c.ok)
  const status = allOk ? 200 : 503

  return NextResponse.json(
    {
      status: allOk ? 'ready' : 'not_ready',
      service: 'abel-os',
      timestamp: new Date().toISOString(),
      totalMs: Date.now() - started,
      checks: [db, requiredEnv, optionalEnv],
    },
    { status }
  )
}
