import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/health — Liveness probe. Fast, no dependencies.
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'abel-os',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  })
}
