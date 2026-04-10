import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/health — Public health check for uptime monitors and load balancers.
 * No authentication required.
 */
export async function GET() {
  const checks: Record<string, 'ok' | 'error'> = {}

  // Database connectivity
  try {
    await prisma.$queryRaw`SELECT 1`
    checks.database = 'ok'
  } catch {
    checks.database = 'error'
  }

  const allOk = Object.values(checks).every(v => v === 'ok')

  return NextResponse.json(
    {
      status: allOk ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: allOk ? 200 : 503 }
  )
}
