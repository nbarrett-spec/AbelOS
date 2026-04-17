import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Redis } from '@upstash/redis'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/readiness — Readiness probe. Checks DB + Redis + external dependencies.
 */
export async function GET() {
  const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {}

  // DB
  const dbStart = Date.now()
  try {
    await prisma.$queryRaw`SELECT 1`
    checks.db = { ok: true, latencyMs: Date.now() - dbStart }
  } catch (err: any) {
    checks.db = { ok: false, latencyMs: Date.now() - dbStart, error: err?.message ?? 'unknown' }
  }

  // Redis (Upstash) — only check if configured
  if (process.env.UPSTASH_REDIS_REST_URL) {
    const redisStart = Date.now()
    try {
      const redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN!,
      })
      const pong = await redis.ping()
      checks.redis = {
        ok: pong === 'PONG',
        latencyMs: Date.now() - redisStart,
      }
    } catch (err: any) {
      checks.redis = { ok: false, latencyMs: Date.now() - redisStart, error: err?.message ?? 'unknown' }
    }
  }

  // Mark Redis as skipped if not configured (don't fail readiness for it)
  const criticalChecks = Object.entries(checks)
    .filter(([key]) => key === 'db') // Only DB is critical for readiness
    .every(([, c]) => c.ok)

  const allOk = Object.values(checks).every(c => c.ok)
  return NextResponse.json(
    {
      status: criticalChecks ? (allOk ? 'ready' : 'degraded') : 'not_ready',
      checks,
      timestamp: new Date().toISOString(),
    },
    { status: criticalChecks ? 200 : 503 }
  )
}
