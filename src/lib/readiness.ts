import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// Shared readiness logic — used by /api/health/ready (live probe) and
// /api/cron/uptime-probe (historical probe). Keeping the checks in one
// place means the uptime history actually reflects what the live probe
// returns.
// ──────────────────────────────────────────────────────────────────────────

export interface CheckResult {
  name: string
  ok: boolean
  ms?: number
  error?: string
}

export interface ReadinessSnapshot {
  status: 'ready' | 'not_ready'
  service: string
  timestamp: string
  totalMs: number
  checks: CheckResult[]
}

// Env vars that MUST be present for the app to function.
const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'NEXT_PUBLIC_APP_URL',
] as const

// Env vars that SHOULD be present but won't block traffic. These are the
// integrations that cause silent "feature just stopped working" bugs if a
// key gets rotated out — we want the readiness endpoint to surface that
// even though it doesn't 503.
const OPTIONAL_ENV_VARS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'RESEND_API_KEY',
  'ANTHROPIC_API_KEY',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'CRON_SECRET',
] as const

async function checkDatabase(): Promise<CheckResult> {
  const started = Date.now()
  try {
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
  return {
    name: 'optional-env',
    ok: true,
    error: missing.length > 0 ? `missing: ${missing.join(', ')}` : undefined,
  }
}

export async function runReadinessChecks(): Promise<ReadinessSnapshot> {
  const started = Date.now()

  const [db, requiredEnv, optionalEnv] = await Promise.all([
    checkDatabase(),
    Promise.resolve(checkRequiredEnv()),
    Promise.resolve(checkOptionalEnv()),
  ])

  const criticalChecks = [db, requiredEnv]
  const allOk = criticalChecks.every((c) => c.ok)

  return {
    status: allOk ? 'ready' : 'not_ready',
    service: 'abel-os',
    timestamp: new Date().toISOString(),
    totalMs: Date.now() - started,
    checks: [db, requiredEnv, optionalEnv],
  }
}
