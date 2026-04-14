import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/readiness — Readiness probe. Checks DB + external dependencies.
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

  // Optional: rate limiter / Redis
  // if (process.env.UPSTASH_REDIS_REST_URL) {
  //   const redisStart = Date.now()
  //   try {
  //     // TODO: add redis ping
  //     checks.redis = { ok: true, latencyMs: Date.now() - redisStart }
  //   } catch (err: any) {
  //     checks.redis = { ok: false, latencyMs: Date.now() - redisStart, error: err?.message ?? 'unknown' }
  //   }
  // }

  const allOk = Object.values(checks).every(c => c.ok)
  return NextResponse.json(
    { status: allOk ? 'ready' : 'degraded', checks, timestamp: new Date().toISOString() },
    { status: allOk ? 200 : 503 }
  )
}
