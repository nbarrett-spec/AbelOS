/**
 * GET /api/v1/engine/data/aegis/health
 * Quick round-trip check of the Neon DB connection with latency measurement.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyEngineToken } from '@/lib/engine-auth'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await verifyEngineToken(req)
  if (!auth.ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const start = Date.now()
  try {
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json({
      connected: true,
      dbLatencyMs: Date.now() - start,
      source: 'aegis/neon',
    })
  } catch (e: any) {
    return NextResponse.json({
      connected: false,
      error: String(e?.message || e),
      dbLatencyMs: Date.now() - start,
    })
  }
}
