export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, apiLimiter } from '@/lib/rate-limit'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/health/deep — Deep health probe (A-OBS-3).
//
// Pings each integration the platform depends on. The cheap probes (env-var
// presence) tell us a key was rotated out; the live probes (DB, Redis) tell
// us the upstream service is actually reachable.
//
// Status logic:
//   - unhealthy  → DB query failed (we cannot serve traffic)
//   - degraded   → any optional integration missing/slow (>500ms) but DB ok
//   - healthy    → DB ok and every probed integration is reachable + fast
//
// Network calls are wrapped in a 3s timeout so a hung dependency cannot
// stall the probe itself. Each check is independently try/caught — one
// failure never tanks the whole response.
//
// Public endpoint (uptime monitors hit it without auth) but rate-limited
// to keep it from being abused as a DB-load amplifier.
// ──────────────────────────────────────────────────────────────────────────

const NETWORK_TIMEOUT_MS = 3000
const SLOW_THRESHOLD_MS = 500

type CheckStatus = 'healthy' | 'degraded' | 'unhealthy' | 'configured' | 'missing_key' | 'not_configured'

interface Check {
  status: CheckStatus
  latencyMs?: number
  error?: string
}

type Checks = Record<string, Check>

/**
 * Race a promise against a timeout. Returns a typed result so callers can
 * branch on timeout vs. real result without throwing.
 */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race<T>([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function checkDatabase(): Promise<Check> {
  const started = Date.now()
  try {
    const rows: any[] = await withTimeout(
      prisma.$queryRawUnsafe(`SELECT 1 AS ok`),
      NETWORK_TIMEOUT_MS
    )
    const latencyMs = Date.now() - started
    if (Array.isArray(rows) && rows[0]?.ok === 1) {
      return { status: 'healthy', latencyMs }
    }
    return { status: 'unhealthy', latencyMs, error: 'unexpected query result' }
  } catch (e: any) {
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - started,
      error: (e?.message || String(e)).slice(0, 200),
    }
  }
}

async function checkRedis(): Promise<Check> {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    return { status: 'not_configured' }
  }
  const started = Date.now()
  try {
    // Using the REST API directly with AbortController so we get a
    // hard timeout (the @upstash/redis client doesn't expose one).
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS)
    try {
      const res = await fetch(`${url}/ping`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
        cache: 'no-store',
      })
      const latencyMs = Date.now() - started
      if (!res.ok) {
        return {
          status: 'unhealthy',
          latencyMs,
          error: `HTTP ${res.status}`,
        }
      }
      const body = (await res.json().catch(() => null)) as { result?: string } | null
      if (body?.result !== 'PONG') {
        return {
          status: 'unhealthy',
          latencyMs,
          error: `unexpected ping response: ${JSON.stringify(body)?.slice(0, 80)}`,
        }
      }
      return {
        status: latencyMs > SLOW_THRESHOLD_MS ? 'degraded' : 'healthy',
        latencyMs,
      }
    } finally {
      clearTimeout(t)
    }
  } catch (e: any) {
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - started,
      error: (e?.message || String(e)).slice(0, 200),
    }
  }
}

/**
 * Env-var presence check — cheap, non-network. If a key is set we report
 * "configured"; if missing, "missing_key". We don't actually call the
 * service: a real ping per request would burn API quota and money.
 */
function checkEnvVar(name: string): Check {
  return process.env[name] ? { status: 'configured' } : { status: 'missing_key' }
}

/**
 * Stytch check — Stytch has no env-var convention in this repo today
 * (it's referenced in role metadata only). Report not_configured so the
 * shape stays stable for the multi-tenant cutover when Stytch lands.
 */
function checkStytch(): Check {
  if (process.env.STYTCH_PROJECT_ID || process.env.STYTCH_SECRET) {
    return { status: 'configured' }
  }
  return { status: 'not_configured' }
}

function deriveOverallStatus(checks: Checks): 'healthy' | 'degraded' | 'unhealthy' {
  // DB failure is fatal — we cannot serve traffic without it.
  if (checks.database?.status === 'unhealthy') return 'unhealthy'

  // Any missing key, slow check, or unhealthy non-DB check → degraded.
  for (const c of Object.values(checks)) {
    if (c.status === 'unhealthy' || c.status === 'missing_key' || c.status === 'degraded') {
      return 'degraded'
    }
    if (c.latencyMs !== undefined && c.latencyMs > SLOW_THRESHOLD_MS) {
      return 'degraded'
    }
  }
  return 'healthy'
}

export async function GET(request: NextRequest) {
  // Light rate limit — uptime monitors hit this every minute, so 60/min
  // per IP is plenty. Stops random scrapers from amplifying DB load.
  const limited = await checkRateLimit(request, apiLimiter, 60, 'health-deep')
  if (limited) return limited

  // Run probes in parallel — bounded by NETWORK_TIMEOUT_MS each.
  const [database, redis] = await Promise.all([checkDatabase(), checkRedis()])

  // Neon IS the database, but report it as a separate key so monitors
  // that key off "neon" specifically still see a value.
  const neon = database

  const checks: Checks = {
    database,
    redis,
    resend: checkEnvVar('RESEND_API_KEY'),
    anthropic: checkEnvVar('ANTHROPIC_API_KEY'),
    stripe: checkEnvVar('STRIPE_SECRET_KEY'),
    stytch: checkStytch(),
    sentry: checkEnvVar('SENTRY_DSN'),
    neon,
  }

  const status = deriveOverallStatus(checks)
  const httpStatus = status === 'unhealthy' ? 503 : 200

  return NextResponse.json(
    {
      status,
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: httpStatus }
  )
}
